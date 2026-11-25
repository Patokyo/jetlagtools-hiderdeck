// Card data helpers. Pure functions, no DOM, so they stay testable with node.

export const SIZES = ["small", "medium", "large"];

export const SIZE_LABELS = { small: "Small", medium: "Medium", large: "Large" };

/** Best time bonus available at each game size. The clock face is scaled to it. */
export const MAX_MINUTES = { small: 12, medium: 18, large: 30 };

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
    const card = cardsById.get(id);
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
