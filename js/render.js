// DOM rendering. Card faces, the fan behind the live card, the hand strip.

import { formatEffect, fullLabel, minutesFor, shortLabel } from "./cards.js?v=5";

let toastTimer = null;

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function fillCard(el, card, size) {
  el.classList.add("card", `card--${card.kind}`);
  el.dataset.id = card.id;
  el.dataset.kind = card.kind;

  if (card.kind === "time") {
    el.dataset.color = card.color;

    const main = node("div", "card__main");
    main.append(
      node("div", "card__points", `${minutesFor(card, size)}m`),
      node("div", "card__caption", "Time bonus"),
    );
    el.append(node("div", "card__band", card.color), main);
    return el;
  }

  if (card.kind === "power") {
    el.append(node("span", "card__kind", "Power up"), node("h2", "card__title", card.name));
    return el;
  }

  const cost = node("div", "card__cost");
  cost.append(
    node("span", "card__cost-label", "Casting cost"),
    node("span", "card__cost-text", card.cost || "None"),
  );

  el.append(
    node("span", "card__kind", `Curse ${card.number}`),
    node("h2", "card__title", card.title),
    node("p", "card__effect", formatEffect(card.effect, size)),
    cost,
  );
  return el;
}

export function createCardEl(card, size) {
  const el = fillCard(document.createElement("article"), card, size);
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", fullLabel(card, size));
  return el;
}

/** A drawn-but-undecided card, peeking out behind the live one. Tapping focuses it. */
export function createPeekEl(card, depth, size) {
  const el = fillCard(document.createElement("button"), card, size);
  el.type = "button";
  el.classList.add("card--peek");
  el.style.setProperty("--depth", String(depth));
  el.setAttribute("aria-label", `Focus ${fullLabel(card, size)}`);
  return el;
}

/**
 * Shrink a card's body text until it fits the card. Curse text ranges from a
 * few words to a paragraph, and the card is a fixed aspect ratio, so this is
 * measured rather than guessed.
 */
export function fitCard(el) {
  const effect = el.querySelector(".card__effect");
  if (!effect) return;

  let size = 13;
  effect.style.fontSize = `${size}px`;
  while (size > 6.5 && effect.scrollHeight > effect.clientHeight) {
    size -= 0.5;
    effect.style.fontSize = `${size}px`;
  }
}

/**
 * The fan of cards in play but not yet decided. Newest sits closest behind the
 * live card; each older one steps further left. Only the live card is removed
 * by this module's caller, so peeks are rebuilt in place.
 */
export function renderPeek(state, container, cardsById, onFocus, size) {
  if (!container) return;
  // Drives the centring offset: no fan means no shift, so the single card is
  // centred; the shift grows so the card plus its fan stays centred.
  container.style.setProperty("--fan", String(state.pending.length));
  for (const el of container.querySelectorAll(".card--peek")) el.remove();

  state.pending.forEach((id, index) => {
    const card = cardsById.get(id);
    if (!card) return;

    const depth = state.pending.length - index;
    const el = createPeekEl(card, depth, size);
    el.addEventListener("click", () => onFocus(id));
    container.append(el);
    fitCard(el);
  });
}

/**
 * The hand strip at the bottom. With nothing in play these can be pressed to
 * bring a card forward for reading; the card being read is marked.
 */
export function renderHand(state, container, cardsById, onFocus, size) {
  if (!container) return;
  container.replaceChildren();

  if (state.hand.length === 0) {
    container.hidden = true;
    return;
  }

  // Reading is only available when the table is idle, or while another hand
  // card is already being read (pressing another one switches to it).
  const interactive = state.active === null || state.review;
  container.hidden = false;

  for (const id of state.hand) {
    const card = cardsById.get(id);
    if (!card) continue;

    const el = document.createElement(interactive ? "button" : "div");
    if (interactive) {
      el.type = "button";
      el.className = "mini mini--button";
    } else {
      el.className = "mini";
    }

    el.dataset.id = id;
    el.dataset.kind = card.kind;
    if (card.kind === "time") el.dataset.color = card.color;
    el.textContent = shortLabel(card, size);

    if (state.review && state.active === id) {
      el.classList.add("is-reading");
      el.setAttribute("aria-current", "true");
    }

    if (interactive) {
      el.setAttribute("aria-label", `Read ${fullLabel(card, size)}`);
      el.addEventListener("click", () => onFocus(id));
    } else {
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", fullLabel(card, size));
    }

    container.append(el);
  }
}

export function renderHud(state, els) {
  els.deck.textContent = String(state.deck.length);
  els.hand.textContent = `${state.hand.length}/${state.handLimit}`;
}

export function showToast(message) {
  let el = document.querySelector(".toast");

  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.append(el);
  }

  el.textContent = message;
  // Force a reflow so re-showing the same toast replays the transition.
  void el.offsetWidth;
  el.classList.add("is-visible");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 1900);
}
