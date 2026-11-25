// App wiring: load the deck, restore state, handle the swipe gestures.

import {
  DEFAULT_HAND_LIMIT,
  MAX_PENDING,
  createRun,
  dealCards,
  discardActive,
  discardAllInPlay,
  drawOver,
  focusHand,
  focusPending,
  keepActive,
  playCurse,
  playPower,
  sanitize,
} from "./deck.js?v=16";
import {
  POWER_PLAY,
  SIZES,
  UNITS,
  cardOf,
  curseCost,
  curseText,
} from "./cards.js?v=16";
import { trackDrag } from "./gestures.js?v=16";
import { createCardEl, fitCard, renderHand, renderHud, renderPeek, showToast } from "./render.js?v=16";
import { clear, load, loadSettings, save, saveSettings } from "./storage.js?v=16";

const DRAW_DISTANCE = 64; // px of downward swipe on the table to pull a card
const FLICK_VELOCITY = 1.1; // px/ms
const TAP_SLOP = 12; // below this the drag counts as a tap, not a swipe
const EXIT_MS = 320;

const stage = document.getElementById("stage");
// Falls back to the older containers so a browser holding a cached copy of
// index.html still gets a working table instead of a silently dead one.
const stackEl = document.getElementById("stack") ?? document.getElementById("slot");
const handEl = document.getElementById("hand");
const hint = document.getElementById("hint");
const resetButton = document.getElementById("reset");
const settingsOpen = document.getElementById("settings-open");
const settingsDialog = document.getElementById("settings");
const sizeInputs = [...document.querySelectorAll('input[name="size"]')];
const unitsSwitch = document.getElementById("units-switch");
const dealBar = document.getElementById("deal");
const dealChips = [...document.querySelectorAll("[data-deal]")];
const undoButton = document.getElementById("undo");
const hudEls = {
  deck: document.getElementById("deck-count"),
  hand: document.getElementById("hand-count"),
  time: document.getElementById("time-total"),
};

const app = {
  cards: new Map(),
  run: null,
  cardEl: null,
  size: "medium",
  // "metric" or "imperial": which half of each card's distance pair is shown.
  units: "metric",
  // Set while a card being played (or kept into a full hand) is waiting for
  // hand cards to be picked.
  pick: null,
  // The run as it was before the last change that moved cards, for undo.
  undo: null,
};

boot().catch((err) => {
  console.error("[deck] failed to start", err);
  showToast("Could not start the deck");
});

async function boot() {
  resetButton.addEventListener("click", newRun);
  bindSettings();
  bindDeal();
  undoButton.addEventListener("click", undoLast);
  registerServiceWorker();

  try {
    const response = await fetch("./data/cards.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`cards.json returned ${response.status}`);
    const data = await response.json();

    for (const card of data.cards) app.cards.set(card.id, card);
  } catch (err) {
    console.error("[deck] could not load cards", err);
    setHint("Could not load cards.json");
    showToast("Could not load the deck");
    return;
  }

  const settings = loadSettings();
  if (SIZES.includes(settings.size)) app.size = settings.size;
  if (UNITS.includes(settings.units)) app.units = settings.units;
  unitsSwitch.checked = app.units === "imperial";

  const stored = sanitize(load(), new Set(app.cards.keys()));
  app.run = stored ?? createRun([...app.cards.keys()], { handLimit: DEFAULT_HAND_LIMIT });
  // Wire input before rendering: a rendering problem must never leave the
  // table unresponsive, which is what a stale index.html used to cause.
  bindTableDraw();
  renderTable();
  renderUndo();
  save(app.run);

  if (app.run.active) showCard(app.run.active, { animate: false });
  else updateIdleHint();
}

/** HUD, the fan behind the live card, and the hand strip. */
function renderTable() {
  renderHud(app.run, hudEls, app.cards, app.size);
  renderPeek(app.run, stackEl, app.cards, focusCard, app.size, app.units);
  renderHand(app.run, handEl, app.cards, focusHandCard, app.size, pickState());
  renderDealBar();
}

/** The deal chips only make sense on an idle table with cards left to deal. */
function renderDealBar() {
  const idle = app.run.active === null && app.run.pending.length === 0;
  dealBar.hidden = !(idle && app.run.deck.length > 0);
}

/** Hand cards become buttons while a card is asking which ones to use. */
function pickState() {
  if (!app.pick) return null;
  const { mode, need, picked, kind = null } = app.pick;
  return { mode, need, picked, kind, onPick: pickCard };
}

/* --- drawing --------------------------------------------------------- */

function bindTableDraw() {
  trackDrag(stage, {
    // Swiping down anywhere means anywhere that isn't a card or the HUD.
    allow: (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return false;
      return !target.closest(".card, .hand, .hud, .toast");
    },
    onMove: ({ y }) => {
      const pull = Math.max(0, Math.min(y, 140));
      hint.style.transform = `translateY(${Math.min(pull * 0.25, 18)}px)`;
      hint.style.opacity = String(1 - Math.min(pull / 280, 0.55));
    },
    onEnd: ({ y, vx, vy, moved }) => {
      hint.style.transform = "";
      hint.style.opacity = "";
      if (!moved) return;

      const vertical = Math.abs(vx) < Math.abs(vy);
      const pulledDown = y > DRAW_DISTANCE || (vy > FLICK_VELOCITY && vertical);
      const pushedUp = y < -DRAW_DISTANCE || (vy < -FLICK_VELOCITY && vertical);

      if (pushedUp) discardInPlay();
      else if (pulledDown) tryDraw();
    },
    onCancel: () => {
      hint.style.transform = "";
      hint.style.opacity = "";
    },
  });
}

/* --- dealing a question ----------------------------------------------- */

/**
 * Every question costs more than one draw (a photo one, Matching and Measuring
 * three), and you keep a single card. Dealing is that in one tap: the cards
 * come up together, keeping one throws the rest away.
 */
function bindDeal() {
  for (const chip of dealChips) {
    chip.addEventListener("click", () => deal(Number(chip.dataset.deal)));
  }
}

function deal(count) {
  const result = dealCards(app.run, count);

  if (!result.cardId) {
    if (result.reason === "empty") showToast("The deck is empty");
    else if (result.reason === "review") showToast("Put the card being read back first");
    else showToast("Decide the cards in play first");
    updateIdleHint();
    return;
  }

  pushUndo();
  app.run = result.state;
  persist();

  app.pick = null;
  app.cardEl?.remove();
  app.cardEl = null;

  renderTable();
  showCard(result.cardId);
}

function tryDraw() {
  const result = drawOver(app.run);
  if (!result.cardId) {
    if (result.reason === "review") {
      showToast("Finish with this card first");
    } else if (result.reason === "deal") {
      showToast("Keep one of the dealt cards first");
    } else if (result.reason === "stacked") {
      showToast(`${MAX_PENDING} cards in play — decide one first`);
    } else {
      showToast("The deck is empty");
    }
    updateIdleHint();
    return;
  }

  app.run = result.state;
  persist();

  // The card that was live has been parked: it is now part of the fan.
  app.cardEl?.remove();
  app.cardEl = null;

  renderTable();
  showCard(result.cardId);
}

function discardInPlay() {
  const playingHandCard = app.run.review;
  const played = playingHandCard ? cardOf(app.cards, app.run.active) : null;
  const result = discardAllInPlay(app.run);
  if (result.count === 0) {
    showToast("Nothing in play");
    return;
  }

  pushUndo();
  app.run = result.state;
  persist();
  app.pick = null;

  app.cardEl?.remove();
  app.cardEl = null;

  renderTable();
  updateIdleHint();
  if (played?.kind === "curse") copyCurse(played);
  showToast(
    playingHandCard
      ? "Card played"
      : result.count === 1
        ? "Discarded 1 card"
        : `Discarded ${result.count} cards`,
  );
}

/* --- focusing a parked card ------------------------------------------ */

function focusCard(cardId) {
  if (app.cardEl?.dataset.id === cardId) return;

  const result = focusPending(app.run, cardId);
  if (!result.cardId) return;

  app.pick = null;
  app.run = result.state;
  persist();

  app.cardEl?.remove();
  app.cardEl = null;

  renderTable();
  // Coming forward is a change of focus, not a new draw: no drop from the top.
  showCard(result.cardId, { animate: false });
}

/**
 * A card being resolved can leave others parked behind it. Once the table is
 * clear again the nearest one comes forward on its own, so the fan is never
 * left sitting there with nothing focused.
 */
function promoteTopPending() {
  if (app.run.active !== null || app.run.review) return false;

  const top = app.run.pending.at(-1);
  if (!top) return false;

  const result = focusPending(app.run, top);
  if (!result.cardId) return false;

  app.pick = null;
  app.run = result.state;
  persist();

  app.cardEl?.remove();
  app.cardEl = null;

  renderTable();
  // It was already on the table, just further back: no drop from the top.
  showCard(result.cardId, { animate: false });
  return true;
}

/** Press a kept card to read it. It stays in hand and blocks drawing. */
function focusHandCard(cardId) {
  if (app.cardEl?.dataset.id === cardId) return;

  const result = focusHand(app.run, cardId);
  if (!result.cardId) {
    if (result.reason === "busy") showToast("Decide the card in play first");
    return;
  }

  app.pick = null;
  app.run = result.state;
  persist();

  app.cardEl?.remove();
  app.cardEl = null;

  renderTable();
  showCard(result.cardId, { animate: false });
}

function showCard(cardId, { animate = true } = {}) {
  const card = cardOf(app.cards, cardId);
  if (!card) return;

  const el = createCardEl(card, app.size, app.units);
  el.dataset.id = cardId;
  el.classList.add("card--live");
  stackEl.append(el);
  fitCard(el);
  app.cardEl = el;

  if (animate) {
    el.style.transform = "translateY(-140%)";
    requestAnimationFrame(() => {
      el.style.transition = "transform 360ms cubic-bezier(.22,.9,.24,1)";
      el.style.transform = "translateY(0)";
      el.addEventListener(
        "transitionend",
        () => {
          el.style.transition = "";
        },
        { once: true },
      );
    });
  }

  bindCardDrag(el);
  renderHud(app.run, hudEls, app.cards, app.size);
  setHint(
    app.run.review
      ? "Drag up to play · down puts it back"
      : app.run.deal
        ? dealHint()
        : "Drag up to discard · down to keep",
  );
}

/** How a question's deal reads on the hint line. */
function dealHint() {
  const left = 1 + app.run.pending.length;
  return left > 1 ? `Keep 1 of ${left} · up skips this card` : "Swipe down to keep";
}

/* --- resolving ------------------------------------------------------- */

function bindCardDrag(el) {
  const height = el.offsetHeight || 420;
  const threshold = Math.max(72, height * 0.16);

  trackDrag(el, {
    onStart: () => {
      el.style.transition = "none";
    },
    onMove: ({ x, y }) => {
      el.style.transform = `translate(${x}px, ${y}px) rotate(${x * 0.02}deg)`;
      setIntent(el, y <= -threshold ? "discard" : y >= threshold ? "keep" : "");
    },
    onEnd: ({ x, y, vx, vy, moved }) => {
      if (!moved || Math.abs(y) < TAP_SLOP) {
        snapBack(el);
        return;
      }

      const wantsDiscard = y <= -threshold || (vy <= -FLICK_VELOCITY && Math.abs(vx) < Math.abs(vy));
      const wantsKeep =
        !wantsDiscard && (y >= threshold || (vy >= FLICK_VELOCITY && Math.abs(vx) < Math.abs(vy)));

      if (wantsDiscard) resolveCard(el, "discard", x);
      else if (wantsKeep) resolveCard(el, "keep", x);
      else snapBack(el);
    },
    onCancel: () => snapBack(el),
  });
}

function resolveCard(el, action, x) {
  if (app.cardEl !== el) return;

  // Cards played from hand can have effects on the hand, so they are resolved
  // by kind: power ups run their own effect, curses have to pay their cost.
  const playing =
    action === "discard" && app.run.review ? cardOf(app.cards, app.run.active) : null;

  if (playing) {
    if (playing.kind === "power") {
      playPowerUp(el, playing, x);
      return;
    }
    if (playing.kind === "curse" && curseCost(playing.cost)) {
      playCurseCard(el, playing, x);
      return;
    }
  }

  const result = action === "keep" ? keepActive(app.run) : discardActive(app.run);
  if (!result.cardId) {
    // A full hand can still keep a card, but only by giving one up first.
    if (result.reason === "replace") beginReplace(el);
    else snapBack(el);
    return;
  }

  pushUndo();
  app.run = result.state;
  persist();
  app.pick = null;
  renderTable();
  setIntent(el, "");
  app.cardEl = null;

  flyAway(el, action, x);
  if (playing?.kind === "curse") copyCurse(playing);
  else if (action === "keep") showToast("Kept");
  else showToast(result.next ? "Skipped" : "Discarded");
  updateIdleHint();

  // Skipping a dealt card brings the next one forward; otherwise whatever was
  // parked behind comes forward on its own.
  if (app.run.active !== null) showCard(app.run.active, { animate: false });
  else promoteTopPending();
}

/** Slide a resolved card off the table and drop it from the DOM. */
function flyAway(el, action, x) {
  const offset = Math.max(-60, Math.min(60, x * 0.35));
  el.style.transition = `transform ${EXIT_MS}ms ease-in, opacity ${EXIT_MS}ms ease-in`;
  el.style.transform = `translate(${offset}px, ${action === "keep" ? "130%" : "-130%"}) rotate(${
    action === "keep" ? 7 : -7
  }deg)`;
  el.style.opacity = "0";

  // transitionend can be skipped (reduced motion / backgrounded tab); the timer is the fallback.
  el.addEventListener("transitionend", () => el.remove(), { once: true });
  setTimeout(() => el.remove(), EXIT_MS + 120);
}

/* --- power ups and curse costs --------------------------------------- */

/**
 * Playing a power up can need input: which cards to discard, or which card to
 * copy. Ask for that first; everything else resolves right away.
 */
function playPowerUp(el, card, x) {
  const plan = POWER_PLAY[card.name] ?? {};
  const others = app.run.hand.filter((id) => id !== app.run.active);

  if (plan.duplicate) {
    if (others.length === 0) {
      snapBack(el);
      showToast("Needs another card in hand");
      return;
    }

    app.pick = { mode: "duplicate", need: 1, picked: [] };
    beginPick(el, "Tap a card to duplicate");
    return;
  }

  if (plan.discards) {
    if (others.length < plan.discards) {
      snapBack(el);
      showToast(`Needs ${plan.discards} more card${plan.discards === 1 ? "" : "s"} in hand`);
      return;
    }

    app.pick = { mode: "discard", need: plan.discards, picked: [] };
    beginPick(el, `Tap ${plan.discards} card${plan.discards === 1 ? "" : "s"} to discard`);
    return;
  }

  // Randomize, Veto and Move are settled at the table: the app just lets go of
  // the card. Draw 1 Expand 1 needs no choice, so it happens now.
  finishPower(el, {}, x);
}

function beginPick(el, message) {
  snapBack(el);
  renderTable();
  setHint(message);

  // A played card that still needs cards picked is committed, not still being
  // read: park it half off the top edge so the hand is what the player acts on.
  // Keeping into a full hand is not a play, so that one stays in place.
  if (app.pick && app.pick.mode !== "replace") liftCard(el);
}

/**
 * Sit the card being played with its centre on the top edge of the screen, so
 * half of it hangs out of view while the hand pays its cost. It can't be
 * swiped from there: the pick has to be finished first.
 */
function liftCard(el) {
  // Measure the resting place with the snap-back transition off, or the
  // half-finished drag position is counted into the offset.
  el.style.transition = "none";
  el.style.transform = "none";
  void el.offsetHeight;
  const { top, height } = el.getBoundingClientRect();

  el.style.transform = `translateY(${-(top + height / 2)}px)`;
  el.style.transition = "transform 320ms cubic-bezier(.22,1.1,.36,1)";
  el.style.pointerEvents = "none";
  el.classList.add("is-playing");
}

/**
 * A curse whose casting cost is cards can't leave the hand until those cards
 * are picked: the cost is part of playing it, not an optional extra.
 */
function playCurseCard(el, card, x) {
  const plan = curseCost(card.cost);
  const others = app.run.hand.filter((id) => id !== app.run.active);
  const eligible =
    plan.kind === null ? others : others.filter((id) => cardOf(app.cards, id)?.kind === plan.kind);

  if (plan.all) {
    // "Discard your hand" takes the rest of the hand: there is nothing to pick.
    finishCurse(el, { discards: others }, x);
    return;
  }

  if (eligible.length < plan.need) {
    snapBack(el);
    showToast(costShortfall(plan));
    return;
  }

  app.pick = { mode: "curse", need: plan.need, kind: plan.kind, picked: [] };
  beginPick(el, costPrompt(plan));
}

function costPrompt(plan) {
  if (plan.kind === "time") return "Tap a time bonus to discard";
  if (plan.kind === "power") return "Tap a power up to discard";
  return `Tap ${plan.need} ${plan.need === 1 ? "card" : "cards"} to discard`;
}

function costShortfall(plan) {
  if (plan.kind === "time") return "Needs a time bonus card in hand";
  if (plan.kind === "power") return "Needs a power up card in hand";
  return plan.need === 1
    ? "Needs another card in hand"
    : `Needs ${plan.need} cards in hand`;
}

/** A tap on a hand card while a pick is running. */
function pickCard(id) {
  const pick = app.pick;
  if (!pick || !app.cardEl) return;

  if (pick.mode === "duplicate") {
    finishPower(app.cardEl, { duplicateOf: id });
    return;
  }

  if (pick.mode === "replace") {
    finishReplace(id);
    return;
  }

  pick.picked = pick.picked.includes(id)
    ? pick.picked.filter((other) => other !== id)
    : [...pick.picked, id];

  if (pick.picked.length === pick.need) {
    if (pick.mode === "curse") finishCurse(app.cardEl, { discards: pick.picked });
    else finishPower(app.cardEl, { discards: pick.picked });
    return;
  }

  renderTable();
  setHint(`Tap ${pick.need - pick.picked.length} more to discard`);
}

/** Keeping into a full hand: ask which card makes room. */
function beginReplace(el) {
  app.pick = { mode: "replace", need: 1, picked: [] };
  beginPick(el, "Hand full — tap a card to replace");
}

function finishReplace(replaceId) {
  const el = app.cardEl;
  const result = keepActive(app.run, { replace: replaceId });

  app.pick = null;
  if (!result.cardId) {
    if (el) snapBack(el);
    renderTable();
    return;
  }

  pushUndo();
  app.run = result.state;
  persist();
  renderTable();
  if (el) {
    setIntent(el, "");
    app.cardEl = null;
    flyAway(el, "keep", 0);
  }
  updateIdleHint();
  promoteTopPending();
  showToast("Kept · replaced 1 card");
}

function finishCurse(el, { discards = [] } = {}, x = 0) {
  const card = cardOf(app.cards, app.run.active);
  const plan = curseCost(card?.cost);
  const need = plan?.all ? discards.length : (plan?.need ?? 0);
  const result = playCurse(app.run, app.run.active, {
    discards,
    need,
    kind: plan?.kind ?? null,
    kindOf: (id) => cardOf(app.cards, id)?.kind ?? null,
  });

  app.pick = null;
  if (!result.cardId) {
    snapBack(el);
    renderTable();
    showToast("Could not pay the casting cost");
    return;
  }

  pushUndo();
  app.run = result.state;
  persist();
  renderTable();
  setIntent(el, "");
  app.cardEl = null;
  flyAway(el, "discard", x);
  if (card?.kind === "curse") copyCurse(card);
  updateIdleHint();

  showToast(
    discards.length
      ? `Curse played · discarded ${discards.length}`
      : `${card?.title ?? "Curse"} played`,
  );
}

function finishPower(el, { discards = [], duplicateOf = null } = {}, x = 0) {
  const card = cardOf(app.cards, app.run.active);
  const plan = POWER_PLAY[card?.name] ?? {};
  const result = playPower(app.run, app.run.active, {
    discards,
    draw: plan.draw ?? 0,
    expand: plan.expand ?? 0,
    duplicateOf,
  });

  app.pick = null;
  if (!result.cardId) {
    snapBack(el);
    renderTable();
    return;
  }

  pushUndo();
  app.run = result.state;
  persist();
  renderTable();
  setIntent(el, "");
  app.cardEl = null;
  flyAway(el, "discard", x);
  updateIdleHint();

  const parts = [];
  if (discards.length) parts.push(`Discarded ${discards.length}`);
  if (duplicateOf !== null) parts.push("card duplicated");
  if (result.drawn.length) parts.push(`drew ${result.drawn.length}`);
  if (plan.expand) parts.push(`hand ${app.run.handLimit}`);
  if (parts.length === 0) parts.push(`${card?.name ?? "Power up"} played`);

  const message = parts.join(" · ");
  showToast(`${message[0].toUpperCase()}${message.slice(1)}`);
}

/**
 * A played curse goes to the clipboard, so the hiders can text it to the
 * seekers without retyping it.
 */
function copyCurse(card) {
  if (!navigator.clipboard?.writeText) {
    showToast("Could not copy the curse");
    return;
  }

  navigator.clipboard.writeText(curseText(card, app.size, app.units)).then(
    () => showToast("Curse copied to clipboard"),
    (err) => {
      console.warn("[deck] could not copy the curse", err);
      showToast("Could not copy the curse");
    },
  );
}

function snapBack(el) {
  setIntent(el, "");
  el.classList.remove("is-playing");
  el.style.pointerEvents = "";
  el.style.transition = "transform 320ms cubic-bezier(.22,1.1,.36,1)";
  el.style.transform = "translate(0, 0) rotate(0deg)";
  el.style.opacity = "";
}

function setIntent(el, intent) {
  if (intent) el.dataset.intent = intent;
  else delete el.dataset.intent;
}

/* --- state ----------------------------------------------------------- */

function newRun() {
  if (!confirm("Start a new run? The current hand and discard pile are lost.")) return;

  clear();
  app.cardEl?.remove();
  app.cardEl = null;
  app.pick = null;

  app.run = createRun([...app.cards.keys()], { handLimit: DEFAULT_HAND_LIMIT });
  app.undo = null;
  renderUndo();
  persist();
  renderTable();
  updateIdleHint();
  showToast("New run");
}

/* --- settings -------------------------------------------------------- */

function bindSettings() {
  settingsOpen.addEventListener("click", () => {
    for (const input of sizeInputs) input.checked = input.value === app.size;
    unitsSwitch.checked = app.units === "imperial";
    if (typeof settingsDialog.showModal === "function") settingsDialog.showModal();
    else settingsDialog.setAttribute("open", "");
  });

  for (const input of sizeInputs) {
    input.addEventListener("change", () => {
      if (input.checked) setSize(input.value);
    });
  }

  unitsSwitch.addEventListener("change", () => {
    setUnits(unitsSwitch.checked ? "imperial" : "metric");
  });

  settingsDialog.addEventListener("click", (event) => {
    if (event.target === settingsDialog) settingsDialog.close();
  });
}

function setSize(size) {
  if (!SIZES.includes(size) || size === app.size) return;

  app.size = size;
  saveSettings({ size: app.size, units: app.units });
  refreshFaces();

  showToast(`${size[0].toUpperCase()}${size.slice(1)} game`);
}

function setUnits(units) {
  if (!UNITS.includes(units) || units === app.units) {
    unitsSwitch.checked = app.units === "imperial";
    return;
  }

  app.units = units;
  unitsSwitch.checked = units === "imperial";
  saveSettings({ size: app.size, units: app.units });
  refreshFaces();

  showToast(units === "metric" ? "Metric measurements" : "Imperial measurements");
}

/** Redraw the table after a display setting changes. */
function refreshFaces() {
  app.pick = null;
  renderTable();
  if (app.run.active) {
    app.cardEl?.remove();
    app.cardEl = null;
    showCard(app.run.active, { animate: false });
  } else {
    updateIdleHint();
  }
}

/* --- undo ------------------------------------------------------------- */

/**
 * Every change that moves cards keeps the run as it was before it, so a
 * mis-swiped card can be put back from the HUD. Runs are immutable, so the
 * snapshot is just the previous object.
 */
function pushUndo() {
  app.undo = app.run;
  renderUndo();
}

/** The button is only live while there is a previous run to restore. */
function renderUndo() {
  undoButton.disabled = !app.undo;
}

function undoLast() {
  if (!app.undo) return;

  app.run = app.undo;
  app.undo = null;
  renderUndo();
  app.pick = null;
  app.cardEl?.remove();
  app.cardEl = null;

  persist();
  renderTable();
  if (app.run.active !== null) showCard(app.run.active, { animate: false });
  else updateIdleHint();
  showToast("Undone");
}

/* --- offline ---------------------------------------------------------- */

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("[deck] no offline cache", err);
    });
  });
}

function persist() {
  save(app.run);
}

function setHint(text) {
  hint.textContent = text;
  hint.hidden = !text;
}

function updateIdleHint() {
  renderDealBar();
  if (app.cardEl) return;

  const { deck, hand, handLimit, pending } = app.run;

  if (pending.length) setHint("Tap a card · swipe up discards all");
  else if (deck.length === 0 && hand.length) setHint("Tap a card below to read it");
  else if (deck.length === 0) setHint("The deck is empty");
  else if (hand.length >= handLimit) setHint("Hand full — keep swaps a card out");
  else if (hand.length) setHint("Swipe down to draw · tap a hand card");
  else setHint("Swipe down to draw");
}
