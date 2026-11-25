// Card data helpers. Pure functions, no DOM, so they stay testable with node.

export const SIZES = ["small", "medium", "large"];

export const SIZE_LABELS = { small: "Small", medium: "Medium", large: "Large" };

/** Best time bonus available at each game size. The clock face is scaled to it. */
export const MAX_MINUTES = { small: 12, medium: 18, large: 30 };

/**
 * A duplicated card joins the hand as a second copy of the same card, so its
 * instance id carries a suffix: "t3" and "t3~1" are both the same Red bonus.
 */
export function baseId(id) {
  const text = String(id);
  const cut = text.indexOf("~");
  return cut === -1 ? text : text.slice(0, cut);
}

/** Look up the card behind an instance id. */
export function cardOf(cardsById, id) {
  return cardsById.get(baseId(id));
}

/**
 * What playing each power up does. `discards` cards have to be picked from the
 * hand first, `draw` cards then arrive straight into the hand, `expand` raises
 * the hand limit, and `duplicate` copies a picked hand card. Randomize, Veto
 * and Move are settled at the table, so the app only lets go of the card.
 */
export const POWER_PLAY = {
  Randomize: {},
  Veto: {},
  Move: {},
  Duplicate: { duplicate: 1 },
  "Discard 1 Draw 2": { discards: 1, draw: 2 },
  "Discard 2 Draw 3": { discards: 2, draw: 3 },
  "Draw 1 Expand 1": { draw: 1, expand: 1 },
};

/**
 * Curse text carries per-size ranges, e.g. "[S10, M20, L30]" or "[S5 M10 L15]"
 * (one card is missing its L marker). Every match is replaced with the value
 * for the selected game size.
 */
const RANGE = /\[\s*S\s*([\d.]+)\s*[, ]\s*M\s*([\d.]+)\s*[, ]\s*(?:L\s*)?([\d.]+)\s*\]/gi;

export function minutesFor(card, size) {
  if (!card.minutes) return 0;
  return card.minutes[size] ?? card.minutes.medium;
}

/** How full the clock on a time card is, from 0 to 1. */
export function clockFraction(card, size) {
  const max = MAX_MINUTES[size] ?? MAX_MINUTES.medium;
  return Math.min(1, Math.max(0, minutesFor(card, size) / max));
}

/** "Curse of the Mediocre Travel Agent" -> "Mediocre Travel Agent". */
export function curseName(title) {
  return String(title)
    .replace(/^curse of the\s+/i, "")
    .replace(/^curse of\s+/i, "");
}

/** Total minutes of the time bonus cards in hand. */
export function handMinutes(hand, cardsById, size) {
  let total = 0;
  for (const id of hand) {
    const card = cardOf(cardsById, id);
    if (card && card.kind === "time") total += minutesFor(card, size);
  }
  return total;
}

export function formatEffect(text, size) {
  if (!text) return "";

  const index = SIZES.indexOf(size);
  const pick = index === -1 ? 1 : index;

  return text.replace(RANGE, (_match, small, medium, large) => [small, medium, large][pick]);
}

/** The short string on a hand card. */
export function shortLabel(card, size) {
  if (card.kind === "time") return `${minutesFor(card, size)}m`;
  if (card.kind === "power") return card.short ?? card.name;
  return curseName(card.title);
}

/** Long description for screen readers and aria labels. */
export function fullLabel(card, size) {
  if (card.kind === "time") return `${card.color} time bonus, ${minutesFor(card, size)} minutes`;
  if (card.kind === "power") return `Power up: ${card.name}`;
  return `Curse ${card.number}: ${card.title}`;
}
