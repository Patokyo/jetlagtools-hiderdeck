// DOM rendering. Card faces, the fan behind the live card, the hand strip.

import {
  cardOf,
  clockFraction,
  copyable,
  curseName,
  formatEffect,
  fullLabel,
  handScore,
  minutesFor,
  shortLabel,
} from "./cards.js?v=43";

let toastTimer = null;

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

// Filled 24x24 glyphs, one per power up. Keyed by the card name in cards.json.
const POWER_ICONS = {
  Randomise:
    '<path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>',
  Veto:
    '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9A7.9 7.9 0 0 1 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1A7.9 7.9 0 0 1 20 12c0 4.42-3.58 8-8 8z"/>',
  Duplicate:
    '<path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/>',
  Move:
    '<path d="M10 9h4V6h3l-5-5-5 5h3v3zm-1 1H6V7l-5 5 5 5v-3h3v-4zm14 2-5-5v3h-3v4h3v3l5-5zm-9 3h-4v3H7l5 5 5-5h-3v-3z"/>',
  "Discard 1 Draw 2":
    '<path d="M16 17.01V10h-2v7.01h-3L15 21l4-3.99h-3zM9 3 5 6.99h3V14h2V6.99h3L9 3z"/>',
  "Discard 2 Draw 3":
    '<path d="M12 6v3l4-4-4-4v3a8 8 0 0 0-8 8c0 1.57.46 3.03 1.24 4.26L6.7 14.8A5.87 5.87 0 0 1 6 12a6 6 0 0 1 6-6zm6.76 1.74L17.3 9.2c.44.84.7 1.79.7 2.8a6 6 0 0 1-6 6v-3l-4 4 4 4v-3a8 8 0 0 0 8-8c0-1.57-.46-3.03-1.24-4.26z"/>',
  "Draw 1 Expand 1":
    '<path d="M21 11V3h-8l3.29 3.29-10 10L3 13v8h8l-3.29-3.29 10-10L21 11z"/>',
};
const POWER_FALLBACK =
  '<path d="M12 2 9.2 8.6 2 9.4l5.4 4.9L5.8 22 12 18l6.2 4-1.6-7.7L22 9.4l-7.2-.8L12 2z"/>';

// Two sheets: the one symbol everyone reads as copy.
const COPY_ICON =
  '<path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/>';

function svgEl(className, viewBox = "0 0 24 24") {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", className);
  return svg;
}

function svgNode(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

function powerIcon(name, className) {
  const svg = svgEl(className);
  svg.setAttribute("fill", "currentColor");
  svg.innerHTML = POWER_ICONS[name] ?? POWER_FALLBACK;
  return svg;
}

/**
 * A clock face whose filled wedge grows with the time bonus, scaled so the best
 * card for the current game size fills it. 25 of 30 minutes is most of a clock.
 */
function clockIcon(card, size) {
  const fraction = clockFraction(card, size);
  const svg = svgEl("card__clock", "0 0 100 100");
  svg.setAttribute("fill", "currentColor");

  svg.append(
    svgNode("circle", {
      cx: 50,
      cy: 50,
      r: 44,
      fill: "none",
      stroke: "currentColor",
      "stroke-opacity": 0.16,
      "stroke-width": 9,
    }),
  );

  if (fraction >= 0.999) {
    svg.append(svgNode("circle", { cx: 50, cy: 50, r: 44 }));
  } else if (fraction > 0) {
    const angle = fraction * Math.PI * 2;
    const x = (50 + 44 * Math.sin(angle)).toFixed(2);
    const y = (50 - 44 * Math.cos(angle)).toFixed(2);
    const largeArc = fraction > 0.5 ? 1 : 0;
    svg.append(svgNode("path", { d: `M50 50 L50 6 A44 44 0 ${largeArc} 1 ${x} ${y} Z` }));
  }

  svg.append(
    svgNode("circle", { cx: 50, cy: 50, r: 44, fill: "none", stroke: "currentColor", "stroke-width": 3 }),
    svgNode("circle", { cx: 50, cy: 50, r: 5, fill: "#fff", stroke: "currentColor", "stroke-width": 2 }),
  );
  return svg;
}

/**
 * The index in the card's top left. It carries the same few words as the hand
 * strip, so a card parked in the fan can be told apart by the corner it leaves
 * showing. Decorative: the card's own label already says all of this.
 */
function cornerIndex(card, size) {
  const el = node("div", "card__corner");
  el.setAttribute("aria-hidden", "true");

  if (card.kind === "power") {
    el.append(powerIcon(card.name, "card__corner-icon"));
  }
  el.append(node("span", "card__corner-text", shortLabel(card, size)));
  return el;
}

function fillCard(el, card, size, units) {
  el.classList.add("card", `card--${card.kind}`);
  el.dataset.id = card.id;
  el.dataset.kind = card.kind;
  el.append(cornerIndex(card, size));

  if (card.kind === "time") {
    el.dataset.color = card.color;

    const main = node("div", "card__main");
    main.append(
      clockIcon(card, size),
      node("div", "card__points", `${minutesFor(card, size)}m`),
      node("div", "card__caption", "Time bonus"),
    );
    // The band carries the colour; the colour name would just repeat it.
    el.append(node("div", "card__band"), main);
    return el;
  }

  if (card.kind === "power") {
    el.append(
      powerIcon(card.name, "card__icon"),
      node("span", "card__kind", "Power up"),
      node("h2", "card__title", card.name),
    );
    if (card.description) {
      el.append(node("p", "card__desc", formatEffect(card.description, size, units)));
    }
    return el;
  }

  const cost = node("div", "card__cost");
  cost.append(
    node("span", "card__cost-label", "Casting cost"),
    node("span", "card__cost-text", formatEffect(card.cost, size, units) || "None"),
  );

  el.append(
    node("span", "card__kind", "Curse"),
    node("h2", "card__title", card.title),
    node("p", "card__effect", formatEffect(card.effect, size, units)),
    cost,
  );
  return el;
}

export function createCardEl(card, size, units = "metric", onCopy = null) {
  const el = fillCard(document.createElement("article"), card, size, units);
  el.setAttribute("aria-label", fullLabel(card, size));

  if (onCopy && copyable(card)) {
    // A card carrying a button of its own is a group, not a picture, or the
    // button would be hidden from assistive tech.
    el.setAttribute("role", "group");
    el.classList.add("card--copyable");
    el.append(copyButton(card, onCopy));
  } else {
    el.setAttribute("role", "img");
  }

  return el;
}

/**
 * The copy button in the bottom right of a card the seekers have to receive:
 * every curse, and Move. The two sheets are the whole label, so the accessible
 * name carries the card's own title.
 */
function copyButton(card, onCopy) {
  const el = node("button", "card__copy");
  el.type = "button";
  el.title = "Copy to clipboard";
  el.setAttribute(
    "aria-label",
    `Copy ${card.kind === "curse" ? card.title : card.name} to the clipboard`,
  );

  const svg = svgEl("card__copy-icon");
  svg.setAttribute("fill", "currentColor");
  svg.innerHTML = COPY_ICON;
  el.append(svg);

  el.addEventListener("click", (event) => {
    // The card around it decides on drags; this is a press of its own.
    event.stopPropagation();
    onCopy(card);
  });

  return el;
}

/** A drawn-but-undecided card, peeking out behind the live one. It is dragged, never tapped. */
export function createPeekEl(card, depth, size, units = "metric") {
  const el = fillCard(document.createElement("button"), card, size, units);
  el.type = "button";
  el.classList.add("card--peek");
  el.style.setProperty("--depth", String(depth));
  el.setAttribute("aria-label", `Drag ${fullLabel(card, size)}`);
  return el;
}

/**
 * Shrink a card's body text until it fits the card. Curse text ranges from a
 * few words to a paragraph, and the card is a fixed aspect ratio, so this is
 * measured rather than guessed.
 */
export function fitCard(el) {
  for (const [selector, start, min] of [
    [".card__effect", 15.5, 7],
    [".card__desc", 13, 8],
  ]) {
    const text = el.querySelector(selector);
    if (!text) continue;

    let size = start;
    text.style.fontSize = `${size}px`;
    while (size > min && text.scrollHeight > text.clientHeight) {
      size -= 0.5;
      text.style.fontSize = `${size}px`;
    }
  }
}

/**
 * The fan of cards in play but not yet decided. Newest sits closest behind the
 * live card; each older one steps further left. Only the live card is removed
 * by this module's caller, so peeks are rebuilt in place.
 *
 * `onGrab` wires a drag straight onto the peek, so one can be moved through the
 * fan, kept or discarded without being brought forward first.
 */
export function renderPeek(
  state,
  container,
  cardsById,
  size,
  units = "metric",
  onGrab = null,
) {
  if (!container) return;
  // Drives the centring offset: no fan means no shift, so the single card is
  // centred; the shift grows so the card plus its fan stays centred.
  container.style.setProperty("--fan", String(state.pending.length));
  // A card on its way off the table is mid-flight: leave it to finish.
  for (const el of container.querySelectorAll(".card--peek:not(.is-leaving)")) el.remove();

  state.pending.forEach((id, index) => {
    const card = cardOf(cardsById, id);
    if (!card) return;

    const depth = state.pending.length - index;
    const el = createPeekEl(card, depth, size, units);
    onGrab?.(el, id);
    container.append(el);
    fitCard(el);
  });
}

/**
 * The hand strip at the bottom. With nothing in play these can be pressed to
 * bring a card forward for reading; the card being read is marked.
 */
/** The little face of a kept card: minutes, an icon plus name, or a curse name. */
function fillMini(el, card, size) {
  if (card.kind === "time") {
    el.append(node("span", "mini__minutes", `${minutesFor(card, size)}m`));
  } else if (card.kind === "power") {
    el.append(
      powerIcon(card.name, "mini__icon"),
      node("span", "mini__name", shortLabel(card, size)),
    );
  } else {
    el.append(node("span", "mini__name", curseName(card.title)));
  }
}

export function renderHand(
  state,
  container,
  cardsById,
  onFocus,
  size,
  pick = null,
  onGrab = null,
) {
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

  // The card being read is already the one on the table, so its mini would be
  // a second copy of it: the strip carries only what is still waiting in hand.
  const reading = state.review ? state.active : null;

  for (const id of state.hand) {
    if (id === reading) continue;

    const card = cardOf(cardsById, id);
    if (!card) continue;

    // While a played card is asking for cards, the hand is a chooser: only the
    // cards it can actually take are live, so a tap can't swap the card being
    // read out from under the pick.
    const selectable =
      pick !== null && id !== state.active && (pick.kind == null || card.kind === pick.kind);
    const inert = pick !== null && !selectable && id !== state.active;
    const pressable = selectable || (pick === null && interactive);

    const el = document.createElement(pressable ? "button" : "div");
    if (pressable) {
      el.type = "button";
      el.className = "mini mini--button";
    } else {
      el.className = "mini";
    }
    if (inert) el.classList.add("is-inert");

    el.dataset.id = id;
    el.dataset.kind = card.kind;
    if (card.kind === "time") el.dataset.color = card.color;
    fillMini(el, card, size);

    if (selectable) {
      const picked = pick.picked.includes(id);
      el.classList.add("is-pick");
      if (picked) el.classList.add("is-picked");
      el.setAttribute("aria-pressed", String(picked));
      el.setAttribute(
        "aria-label",
        `${pick.mode === "duplicate" ? "Duplicate" : "Discard"} ${fullLabel(card, size)}`,
      );
      el.addEventListener("click", () => pick.onPick(id));
      // Picking the card that makes room is also a drag: sideways to sort the
      // hand, up to discard it, down to set it aside.
      if (pick.mode === "replace") onGrab?.(el, id);
    } else if (pressable) {
      el.setAttribute("aria-label", `Read ${fullLabel(card, size)}`);
      el.addEventListener("click", () => onFocus(id));
      onGrab?.(el, id);
    } else {
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", fullLabel(card, size));
    }

    container.append(el);
  }
}

export function renderHud(state, els, cardsById, size) {
  els.hand.textContent = `${state.hand.length}/${state.handLimit}`;
  if (!els.time) return;

  // A Duplicate in hand is worth another copy of the best bonus, so the number
  // the hider is playing for is the score, not just the sum of the time cards.
  const score = handScore(state.hand, cardsById, size);
  els.time.textContent = `${score.total}m`;

  const label = score.copies
    ? `Total time bonus in hand: ${score.total} minutes, ${score.bonus} of them from a Duplicate`
    : `Total time bonus in hand: ${score.total} minutes`;
  els.time.setAttribute("aria-label", label);
  els.time.title = label;
}

const TOAST_MS = 1900;

/** The bottom toast: a short confirmation that fades on its own. */
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
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), TOAST_MS);
}
