// App wiring: load the deck, restore state, handle the swipe gestures.

import {
  DEFAULT_HAND_LIMIT,
  MAX_PENDING,
  createRun,
  discardActive,
  discardAllInPlay,
  drawOver,
  focusHand,
  focusPending,
  keepActive,
  sanitize,
} from "./deck.js?v=4";
import { trackDrag } from "./gestures.js?v=4";
import { createCardEl, renderHand, renderHud, renderPeek, showToast } from "./render.js?v=4";
import { clear, load, save } from "./storage.js?v=4";

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
const hudEls = {
  deck: document.getElementById("deck-count"),
  hand: document.getElementById("hand-count"),
  discard: document.getElementById("discard-count"),
};

const app = {
  cards: new Map(),
  run: null,
  cardEl: null,
};

boot().catch((err) => {
  console.error("[deck] failed to start", err);
  showToast("Could not start the deck");
});

async function boot() {
  resetButton.addEventListener("click", newRun);

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

  const stored = sanitize(load(), new Set(app.cards.keys()));
  app.run = stored ?? createRun([...app.cards.keys()], { handLimit: DEFAULT_HAND_LIMIT });
  // Wire input before rendering: a rendering problem must never leave the
  // table unresponsive, which is what a stale index.html used to cause.
  bindTableDraw();
  renderTable();
  save(app.run);

  if (app.run.active) showCard(app.run.active, { animate: false });
  else updateIdleHint();
}

/** HUD, the fan behind the live card, and the hand strip. */
function renderTable() {
  renderHud(app.run, hudEls);
  renderPeek(app.run, stackEl, app.cards, focusCard);
  renderHand(app.run, handEl, app.cards, focusHandCard);
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

function tryDraw() {
  const result = drawOver(app.run);
  if (!result.cardId) {
    if (result.reason === "review") {
      showToast("Finish with this card first");
    } else if (result.reason === "full") {
      showToast(`Hand is full (${app.run.handLimit}/${app.run.handLimit})`);
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
  const result = discardAllInPlay(app.run);
  if (result.count === 0) {
    showToast("Nothing in play");
    return;
  }

  app.run = result.state;
  persist();

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

  app.run = result.state;
  persist();

  app.cardEl?.remove();
  app.cardEl = null;

  renderTable();
  // Coming forward is a change of focus, not a new draw: no drop from the top.
  showCard(result.cardId, { animate: false });
}

/** Press a kept card to read it. It stays in hand and blocks drawing. */
function focusHandCard(cardId) {
  if (app.cardEl?.dataset.id === cardId) return;

  const result = focusHand(app.run, cardId);
  if (!result.cardId) {
    if (result.reason === "busy") showToast("Decide the card in play first");
    return;
  }

  app.run = result.state;
  persist();

  app.cardEl?.remove();
  app.cardEl = null;

  renderTable();
  showCard(result.cardId, { animate: false });
}

function showCard(cardId, { animate = true } = {}) {
  const card = app.cards.get(cardId);
  if (!card) return;

  const el = createCardEl(card);
  el.classList.add("card--live");
  stackEl.append(el);
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
  renderHud(app.run, hudEls);
  setHint(
    app.run.review ? "Drag up to play · down puts it back" : "Drag up to discard · down to keep",
  );
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

  const result = action === "keep" ? keepActive(app.run) : discardActive(app.run);
  if (!result.cardId) {
    snapBack(el);
    return;
  }

  app.run = result.state;
  persist();
  renderTable();
  setIntent(el, "");
  app.cardEl = null;

  const offset = Math.max(-60, Math.min(60, x * 0.35));
  el.style.transition = `transform ${EXIT_MS}ms ease-in, opacity ${EXIT_MS}ms ease-in`;
  el.style.transform = `translate(${offset}px, ${action === "keep" ? "130%" : "-130%"}) rotate(${
    action === "keep" ? 7 : -7
  }deg)`;
  el.style.opacity = "0";

  // transitionend can be skipped (reduced motion / backgrounded tab); the timer is the fallback.
  el.addEventListener("transitionend", () => el.remove(), { once: true });
  setTimeout(() => el.remove(), EXIT_MS + 120);

  updateIdleHint();
}

function snapBack(el) {
  setIntent(el, "");
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

  app.run = createRun([...app.cards.keys()], { handLimit: DEFAULT_HAND_LIMIT });
  persist();
  renderTable();
  updateIdleHint();
  showToast("New run");
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
  else if (hand.length >= handLimit) setHint("Hand full — tap a card below");
  else if (hand.length) setHint("Swipe down to draw · tap a hand card");
  else setHint("Swipe down to draw");
}
