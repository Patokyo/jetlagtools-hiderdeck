// App wiring: load the deck, restore state, handle the swipe gestures.

import {
  DEFAULT_HAND_LIMIT,
  MAX_PENDING,
  TENTACLES_DRAWS,
  TENTACLES_KEEPS,
  createRun,
  discardActive,
  discardAllInPlay,
  drawOver,
  focusHand,
  focusPending,
  keepActive,
  playCurse,
  playPower,
  reorderHand,
  sanitize,
} from "./deck.js?v=36";
import {
  POWER_PLAY,
  SIZES,
  UNITS,
  cardOf,
  curseCost,
  curseText,
  formatEffect,
} from "./cards.js?v=36";
import { trackDrag } from "./gestures.js?v=36";
import { createCardEl, fitCard, renderHand, renderHud, renderPeek, showToast } from "./render.js?v=36";
import { clear, load, loadSettings, save, saveSettings } from "./storage.js?v=36";

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
const tray = document.getElementById("tray");
const resetButton = document.getElementById("reset");
const settingsOpen = document.getElementById("settings-open");
const settingsDialog = document.getElementById("settings");
const sizeInputs = [...document.querySelectorAll('input[name="size"]')];
const unitsSwitch = document.getElementById("units-switch");
const undoButton = document.getElementById("undo");
const hudEls = {
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
  undoButton.addEventListener("click", undoLast);
  bindTrayDraw();
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
  clearHandDrags();
  renderHud(app.run, hudEls, app.cards, app.size);
  renderPeek(app.run, stackEl, app.cards, focusCard, app.size, app.units, attachPeekGrab);
  renderHand(
    app.run,
    handEl,
    app.cards,
    focusHandCardFromTap,
    app.size,
    pickState(),
    attachHandGrab,
  );
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
      return !target.closest(".card, .hand, .hud, .toast, .tray");
    },
    onMove: ({ y }) => {
      pullHint(y);
    },
    onEnd: ({ y, vx, vy, moved }) => {
      settleHint();
      if (!moved) return;

      const vertical = Math.abs(vx) < Math.abs(vy);
      const pulledDown = y > DRAW_DISTANCE || (vy > FLICK_VELOCITY && vertical);
      const pushedUp = y < -DRAW_DISTANCE || (vy < -FLICK_VELOCITY && vertical);

      if (pushedUp) discardInPlay();
      else if (pulledDown) tryDraw();
    },
    onCancel: settleHint,
  });
}

/** Follow the pull with the hint line, so the gesture has some give to it. */
function pullHint(y) {
  const pull = Math.max(0, Math.min(y, 140));
  hint.style.transform = `translateY(${Math.min(pull * 0.25, 18)}px)`;
  hint.style.opacity = String(1 - Math.min(pull / 280, 0.55));
}

function settleHint() {
  hint.style.transform = "";
  hint.style.opacity = "";
}

/**
 * The pull handle under the hand. The card in play covers most of a phone
 * screen, which leaves bare table as a thin border around it — no place to aim
 * a thumb. The tray sits where the thumb already rests, is tall enough to hit
 * without looking, and a downward swipe anywhere on it draws with the same
 * distance and flick as a swipe on the table itself.
 */
function bindTrayDraw() {
  trackDrag(tray, {
    onMove: ({ y }) => pullHint(y),
    onEnd: ({ y, vx, vy, moved }) => {
      settleHint();
      if (!moved) return;

      const vertical = Math.abs(vx) < Math.abs(vy);
      if (y > DRAW_DISTANCE || (vy > FLICK_VELOCITY && vertical)) tryDraw();
    },
    onCancel: settleHint,
  });
}

function tryDraw() {
  const result = drawOver(app.run);
  if (!result.cardId) {
    if (result.reason === "review") {
      showToast("Finish with this card first");
    } else if (result.reason === "stacked") {
      showToast(`${MAX_PENDING} cards in play — decide one first`);
    } else {
      showToast("The deck is empty");
    }
    updateIdleHint();
    return;
  }

  pushUndo();
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
  // Playing Move by swiping the table has to take the hand with it, the same
  // as playing it off the card.
  const move = played?.kind === "power" && played.name === "Move";
  const result = discardAllInPlay(app.run, { hand: move });
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

function focusHandCardFromTap(cardId) {
  // The click that follows a real drag must not bring the card forward too.
  if (performance.now() - handDragAt < CLICK_GUARD_MS) return;
  focusHandCard(cardId);
}

/* --- lifting a card out of the hand ---------------------------------- */

const PLAY_OVERSHOOT = 48; // px past the table that counts as a swipe up
const FOCUS_PROGRESS = 0.55; // how grown a released card has to be to stay up
const CLICK_GUARD_MS = 500; // the click that ends a drag is not a tap
const REORDER_SLOP = 6; // px of travel before a drag picks a direction
const REORDER_EDGE = 44; // px from the strip's edge that scrolls it
const REORDER_SCROLL = 8; // px the strip scrolls per frame at the edge

// Drags wired onto the minis of the last render, so a redraw can drop them.
let handDragDetach = [];
// When the last real drag on a hand card ended.
let handDragAt = 0;

function clearHandDrags() {
  for (const detach of handDragDetach) detach();
  handDragDetach = [];
}

/**
 * A kept card can be lifted out of the strip and carried up to the table, or
 * dragged sideways to put it somewhere else in the hand. Upwards it grows to
 * full size on the way, stays there when let go near the top, is played when
 * swiped past the table, and drops back into the hand when let go low. Sideways
 * it stays mini sized and the rest of the strip opens a gap where it would
 * land. A press with no drag is still just a tap, which brings it forward.
 */
function attachHandGrab(el, cardId) {
  let ghost = null;
  // Which way the drag went: "lift" for the table, "sort" along the strip.
  let mode = null;
  let sort = null;

  function release() {
    if (sort) stopSort(sort);
    sort = null;
    if (ghost) {
      ghost.el.remove();
      ghost = null;
    }
    el.style.display = "";
    el.style.opacity = "";
  }

  handDragDetach.push(
    trackDrag(el, {
      onStart: () => {
        ghost = liftMini(cardId, el);
        if (ghost) el.style.opacity = "0";
        mode = null;
        sort = null;
      },
      onMove: (payload) => {
        if (!ghost) return;

        // The first real movement picks the gesture: sideways reorders the
        // hand, upwards carries the card to the table.
        if (!mode) {
          if (Math.hypot(payload.x, payload.y) < REORDER_SLOP) return;
          mode = Math.abs(payload.x) > Math.abs(payload.y) ? "sort" : "lift";
          if (mode === "sort") sort = startSort(ghost, el);
        }

        if (sort) dragSort(sort, ghost, payload.x);
        else dragGhost(ghost, payload);
      },
      onEnd: (payload) => {
        if (!ghost) return;
        const { x, y, vx, vy, moved } = payload;

        if (!moved) {
          release();
          return;
        }

        handDragAt = performance.now();
        setIntent(ghost.el, "");

        if (sort) {
          finishSort(sort, ghost, cardId);
          sort = null;
          ghost = null;
          return;
        }

        if (wouldPlay(ghost, { y, vx, vy })) {
          ghost.el.remove();
          ghost = null;
          if (!playFromHand(cardId, x)) el.style.opacity = "";
          return;
        }

        if (progressOf(ghost, y) >= FOCUS_PROGRESS) {
          settleGhost(ghost, el, cardId);
          ghost = null;
          return;
        }

        returnGhost(ghost, el);
        ghost = null;
      },
      onCancel: release,
    }),
  );
}

/* --- reordering the hand --------------------------------------------- */

/**
 * A sideways drag takes the card out of the strip's flow and leaves a dashed
 * gap of the same size in its place, so the rest of the hand slides over as the
 * card passes it. The card itself only follows x: it stays mini sized and level
 * with the strip, and where the gap ends up is where the card is dropped.
 */
function startSort(ghost, el) {
  const slot = document.createElement("div");
  slot.className = "mini mini--slot";
  slot.setAttribute("aria-hidden", "true");

  el.after(slot);
  el.style.display = "none";

  return { ghost, slot, el, strip: el.parentElement, beforeId: null, centre: 0, dir: 0, timer: 0 };
}

/** The minis a carried card can land between, in strip order. */
function sortSiblings(sort) {
  return [...sort.strip.children].filter((node) => node !== sort.slot && node !== sort.el);
}

/** Drop the gap in front of the first mini the card's centre is left of. */
function placeSlot(sort, centre) {
  sort.centre = centre;

  let ref = null;
  for (const node of sortSiblings(sort)) {
    const box = node.getBoundingClientRect();
    if (centre < box.left + box.width / 2) {
      ref = node;
      break;
    }
  }

  sort.strip.insertBefore(sort.slot, ref);
  sort.beforeId = ref ? ref.dataset.id : null;
}

function dragSort(sort, ghost, x) {
  placeGhost(ghost.el, ghost.x + x, ghost.y, ghost.scale);

  const card = ghost.el.getBoundingClientRect();
  const centre = card.left + card.width / 2;
  placeSlot(sort, centre);

  // A strip too wide to fit keeps scrolling while the card is held near either
  // end, so it can be carried past what is on screen.
  const strip = sort.strip.getBoundingClientRect();
  const edge = Math.min(REORDER_EDGE, strip.width / 4);
  sort.dir = centre < strip.left + edge ? -1 : centre > strip.right - edge ? 1 : 0;

  if (sort.dir && !sort.timer) sort.timer = setInterval(() => scrollSort(sort), 16);
  else if (!sort.dir && sort.timer) stopScroll(sort);
}

function scrollSort(sort) {
  const before = sort.strip.scrollLeft;
  sort.strip.scrollLeft = before + sort.dir * REORDER_SCROLL;
  if (sort.strip.scrollLeft !== before) placeSlot(sort, sort.centre);
}

function stopScroll(sort) {
  clearInterval(sort.timer);
  sort.timer = 0;
}

/** Take the gap and the ghost away, leaving the strip as it was drawn. */
function stopSort(sort) {
  stopScroll(sort);
  sort.slot.remove();
  sort.el.style.display = "";
}

/** Let go: the hand takes the gap's place, and the strip redraws in that order. */
function finishSort(sort, ghost, cardId) {
  const { beforeId } = sort;
  stopSort(sort);
  sort.el.style.opacity = "";
  ghost.el.remove();

  const next = reorderHand(app.run, cardId, beforeId);
  if (next === app.run) return;

  app.run = next;
  persist();
  renderTable();
}

/** A full size copy of the card, placed and scaled exactly over its mini. */
function liftMini(cardId, miniEl) {
  const card = cardOf(app.cards, cardId);
  if (!card) return null;

  const el = createCardEl(card, app.size, app.units);
  el.dataset.id = cardId;
  el.classList.add("card--live", "card--ghost");
  stackEl.append(el);
  fitCard(el);

  const full = el.getBoundingClientRect();
  const mini = miniEl.getBoundingClientRect();
  if (!full.height || !mini.height) {
    el.remove();
    return null;
  }

  const x = mini.left + mini.width / 2 - (full.left + full.width / 2);
  const y = mini.top + mini.height / 2 - (full.top + full.height / 2);
  const scale = mini.height / full.height;

  el.style.transition = "none";
  placeGhost(el, x, y, scale);
  return { el, x, y, scale, travel: Math.max(1, y) };
}

function placeGhost(el, x, y, scale) {
  el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
}

/** How grown a dragged hand card is: 0 in the strip, 1 at home on the table. */
function progressOf(ghost, y) {
  return Math.min(1, Math.max(0, -y / ghost.travel));
}

function dragGhost(ghost, { x, y, vx, vy }) {
  const progress = progressOf(ghost, y);
  // Growth is quick at first so the card is readable early, and exact at the
  // top so it lands on its resting place rather than jumping into it.
  const grown = 1 - (1 - progress) ** 2;
  placeGhost(ghost.el, ghost.x + x, ghost.y + y, ghost.scale + (1 - ghost.scale) * grown);
  setIntent(ghost.el, wouldPlay(ghost, { y, vx, vy }) ? "discard" : "");
}

/** A push past the table, or a hard flick once grown, plays the card. */
function wouldPlay(ghost, { y, vx, vy }) {
  if (-y - ghost.travel > PLAY_OVERSHOOT) return true;
  return Math.abs(vx) < Math.abs(vy) && vy <= -FLICK_VELOCITY && progressOf(ghost, y) >= 0.6;
}

/** Let go near the top: the card settles at full size and stays in play. */
function settleGhost(ghost, miniEl, cardId) {
  const { el } = ghost;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.remove();
    miniEl.style.opacity = "";
    focusHandCard(cardId);
  };

  el.style.transition = "transform 200ms cubic-bezier(.22,.9,.24,1)";
  placeGhost(el, 0, 0, 1);
  el.addEventListener("transitionend", finish, { once: true });
  setTimeout(finish, 240);
}

/** Let go low: the card slides back down into the strip. */
function returnGhost(ghost, miniEl) {
  const { el } = ghost;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.remove();
    miniEl.style.opacity = "";
  };

  el.style.transition = "transform 220ms cubic-bezier(.22,.9,.24,1)";
  placeGhost(el, ghost.x, ghost.y, ghost.scale);
  el.addEventListener("transitionend", finish, { once: true });
  setTimeout(finish, 260);
}

/**
 * Played straight out of the hand: the card becomes the one being read, then
 * resolves like any played hand card, so power ups run their effect and curses
 * pay their casting cost. Returns false if the card could not be brought up.
 */
function playFromHand(cardId, x) {
  const focused = focusHand(app.run, cardId);
  if (!focused.cardId) return false;

  pushUndo();
  app.run = focused.state;
  persist();
  app.pick = null;

  app.cardEl?.remove();
  app.cardEl = null;

  renderTable();
  showCard(cardId, { animate: false });
  resolveCard(app.cardEl, "discard", x);
  return true;
}

function showCard(cardId, { animate = true } = {}) {
  const card = cardOf(app.cards, cardId);
  if (!card) return;

  const el = createCardEl(card, app.size, app.units, copyCard);
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
      : app.run.drawn > 0
        ? questionHint()
        : "Drag up to discard · down to keep",
  );
}

/**
 * The hint for an open question. How many cards were drawn decides what is
 * being asked: one is a photo question, two a Thermometer or Radar, three a
 * Measuring or Matching, four Tentacles, which keeps two.
 */
function questionHint() {
  const { drawn, kept } = app.run;
  if (drawn >= TENTACLES_DRAWS) {
    return kept > 0 ? `Kept ${kept} · keep 1 more` : `Keep 2 of ${drawn} · up skips this card`;
  }
  return drawn > 1 ? `Keep 1 of ${drawn} · up skips this card` : "Keep 1 · draw again for 2 or 3";
}

/* --- resolving ------------------------------------------------------- */

/** How far a card has to travel before letting go keeps or discards it. */
function cardThreshold(el) {
  return Math.max(72, (el.offsetHeight || 420) * 0.16);
}

/** What letting go right now would do, or null to put the card back. */
function releaseAction(el, { y, vx, vy }) {
  const threshold = cardThreshold(el);
  const flick = Math.abs(vx) < Math.abs(vy);
  if (y <= -threshold || (flick && vy <= -FLICK_VELOCITY)) return "discard";
  if (y >= threshold || (flick && vy >= FLICK_VELOCITY)) return "keep";
  return null;
}

/** Follow the finger, lighting up what letting go would do. */
function dragCardTo(el, x, y) {
  const threshold = cardThreshold(el);
  el.style.transform = `translate(${x}px, ${y}px) rotate(${x * 0.02}deg)`;
  setIntent(el, y <= -threshold ? "discard" : y >= threshold ? "keep" : "");
}

/** Let go of the card being decided. */
function endCardDrag(el, { x, y, vx, vy, moved }) {
  const action = moved && Math.abs(y) >= TAP_SLOP ? releaseAction(el, { y, vx, vy }) : null;
  if (action) resolveCard(el, action, x);
  else snapBack(el);
}

function bindCardDrag(el) {
  trackDrag(el, {
    // The copy button is a press, not a drag: leaving it to the card would
    // swallow the tap before it could become a click.
    allow: (event) =>
      !(event.target instanceof Element) || !event.target.closest(".card__copy"),
    onStart: () => {
      el.style.transition = "none";
    },
    onMove: ({ x, y }) => dragCardTo(el, x, y),
    onEnd: (payload) => endCardDrag(el, payload),
    onCancel: () => snapBack(el),
  });
}

/** Put a grabbed parked card back where the fan has it. */
function snapPeek(el) {
  setIntent(el, "");
  el.style.transition = "translate 260ms cubic-bezier(.22,1.1,.36,1)";
  el.style.translate = "";
  el.style.zIndex = "";
}

/**
 * A parked card can be grabbed straight out of the fan. It stays where it is —
 * at its own place in the fan, no jump to the front — and follows the finger
 * from there, so the same gesture can end in a keep or a discard.
 */
function attachPeekGrab(el, cardId) {
  trackDrag(el, {
    onStart: () => {
      el.style.transition = "none";
      el.style.zIndex = "40";
    },
    onMove: ({ x, y }) => {
      // The standalone translate property composes with the fan's transform,
      // so the carried card keeps its own step and lean while it moves.
      el.style.translate = `${x}px ${y}px`;
      const threshold = cardThreshold(el);
      setIntent(el, y <= -threshold ? "discard" : y >= threshold ? "keep" : "");
    },
    onEnd: ({ x, y, vx, vy, moved }) => {
      const action = moved && Math.abs(y) >= TAP_SLOP ? releaseAction(el, { y, vx, vy }) : null;
      if (action) {
        resolvePending(el, cardId, action, x);
        return;
      }
      snapPeek(el);
      // A press with no drag still simply brings the card forward.
      if (!moved) focusCard(cardId);
    },
    onCancel: () => snapPeek(el),
  });
}

/**
 * Cards a keep throws away are marked before the table is redrawn, so the
 * re-render leaves them alone long enough to fly off.
 */
function liftLeaving(ids, extra = null) {
  const pool = [...stackEl.querySelectorAll(".card:not(.is-leaving)")];
  if (extra && !pool.includes(extra)) pool.unshift(extra);

  const leaving = [];
  for (const id of ids ?? []) {
    const node = pool.find((el) => el.dataset.id === id && !leaving.includes(el));
    if (!node) continue;
    node.classList.add("is-leaving");
    node.style.zIndex = "35";
    leaving.push(node);
  }
  return leaving;
}

/** Send a card up out of the screen, keeping its place in the fan as it goes. */
function flyOut(el, action, x = 0) {
  const offset = Math.max(-60, Math.min(60, x * 0.35));
  el.style.transition = `translate ${EXIT_MS}ms ease-in, opacity ${EXIT_MS}ms ease-in`;
  el.style.translate = `${offset}px ${action === "keep" ? "130%" : "-130%"}`;
  el.style.opacity = "0";
  el.addEventListener("transitionend", () => el.remove(), { once: true });
  setTimeout(() => el.remove(), EXIT_MS + 120);
}

/**
 * Keep or discard a parked card that was grabbed, without bringing it to the
 * front first: focus it in the run, run the same rule, then redraw once.
 */
function resolvePending(el, cardId, action, x) {
  const previous = app.cardEl;
  const focused = focusPending(app.run, cardId);
  if (!focused.cardId) {
    snapPeek(el);
    return;
  }

  const result = action === "keep" ? keepActive(focused.state) : discardActive(focused.state);
  if (!result.cardId) {
    snapPeek(el);
    // A full hand can still keep a card, but only by giving one up first.
    if (result.reason === "replace") {
      focusCard(cardId);
      if (app.cardEl) beginReplace(app.cardEl);
    }
    return;
  }

  pushUndo();
  app.run = result.state;
  persist();
  app.pick = null;
  app.cardEl = null;

  // The card that was in play is rebuilt from the run, unless this keep threw
  // it away with the rest of the draw.
  const leaving = liftLeaving(result.discarded, previous);
  if (previous && !leaving.includes(previous)) previous.remove();

  setIntent(el, "");
  el.classList.add("is-leaving");
  el.style.zIndex = "40";

  renderTable();
  flyOut(el, action, x);
  for (const node of leaving) flyOut(node, "discard");

  if (app.run.active !== null) showCard(app.run.active, { animate: false });
  else promoteTopPending();
  updateIdleHint();

  if (action === "keep") showToast(keptMessage(result));
  else showToast(result.next ? "Skipped" : "Discarded");
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

  // A keep can throw the rest of the draw away; those cards leave upwards
  // rather than blinking out of existence.
  const leaving = liftLeaving(result.discarded);
  renderTable();
  setIntent(el, "");
  app.cardEl = null;

  flyAway(el, action, x);
  for (const node of leaving) flyOut(node, "discard");
  if (action === "keep") showToast(keptMessage(result));
  else showToast(result.next ? "Skipped" : "Discarded");
  updateIdleHint();

  // Skipping a dealt card brings the next one forward; otherwise whatever was
  // parked behind comes forward on its own.
  if (app.run.active !== null) showCard(app.run.active, { animate: false });
  else promoteTopPending();
}

/**
 * Keeping ends most questions and throws the rest of the draw away, so the
 * toast says what happened. A Tentacles keep still has one card to pick.
 */
function keptMessage(result) {
  if (app.run.drawn > 0) return `Kept ${app.run.kept} of ${TENTACLES_KEEPS}`;
  if (result.discarded?.length) return `Kept · discarded ${result.discarded.length}`;
  return "Kept";
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

const FLY_IN_MS = 480;
const FLY_IN_STAGGER = 90;

/**
 * Cards drawn straight into the hand come in from the top of the screen, so a
 * power up that draws is followed into the hand instead of the new cards just
 * turning up there. Runs on the freshly rendered minis, after the redraw.
 */
function flyInToHand(ids) {
  if (!handEl || ids.length === 0) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  ids.forEach((id, index) => {
    const el = handEl.querySelector(`.mini[data-id="${CSS.escape(id)}"]`);
    if (!el || typeof el.animate !== "function") return;

    el.animate(
      [
        { transform: "translateY(-115vh) scale(0.9)", opacity: 0 },
        { transform: "translateY(-45vh) scale(0.94)", opacity: 1, offset: 0.55 },
        { transform: "none", opacity: 1 },
      ],
      {
        duration: FLY_IN_MS,
        delay: index * FLY_IN_STAGGER,
        easing: "cubic-bezier(.22,.9,.28,1)",
        fill: "backwards",
      },
    );
  });
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

  // Move throws the rest of the hand away as it leaves; there is nothing to
  // pick, the whole hand goes.
  if (plan.discardHand) {
    finishPower(el, { discards: others }, x);
    return;
  }

  // Randomise and Veto are settled at the table: the app just lets go of the
  // card. Draw 1 Expand 1 needs no choice, so it happens now.
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
  flyInToHand(result.drawn);

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
 * Played cards that the seekers need to read go to the clipboard, so the hider
 * can text them over without retyping anything.
 */
function copyText(text, okMessage, failMessage) {
  if (!navigator.clipboard?.writeText) {
    showToast(failMessage);
    return;
  }

  navigator.clipboard.writeText(text).then(
    () => showToast(okMessage),
    (err) => {
      console.warn("[deck] could not copy to the clipboard", err);
      showToast(failMessage);
    },
  );
}

/**
 * The copy button on a curse or on Move: the text as the seekers should get it.
 * Copying is a press of its own rather than something that happens as the card
 * is played, which is also the gesture iOS wants before it allows a clipboard
 * write. The text is built on the press, so it matches the current settings.
 */
function copyCard(card) {
  const text =
    card.kind === "curse"
      ? curseText(card, app.size, app.units)
      : formatEffect(card.description, app.size, app.units);

  copyText(
    text,
    `${card.kind === "curse" ? "Curse" : card.name} copied to clipboard`,
    "Could not copy to the clipboard",
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
  if (app.cardEl) return;

  const { deck, hand, handLimit, pending } = app.run;

  if (pending.length) setHint("Tap a card · swipe up discards all");
  else if (deck.length === 0 && hand.length) setHint("Tap a card below to read it");
  else if (deck.length === 0) setHint("The deck is empty");
  else if (hand.length >= handLimit) setHint("Hand full — keep swaps a card out");
  else if (hand.length) setHint("Swipe down to draw · tap a hand card");
  else setHint("Swipe down to draw");
}
