// Card data helpers. Pure functions, no DOM, so they stay testable with node.

export const SIZES = ["small", "medium", "large"];

export const SIZE_LABELS = { small: "Small", medium: "Medium", large: "Large" };

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
  return `#${card.number}`;
}

/** Long description for screen readers and aria labels. */
export function fullLabel(card, size) {
  if (card.kind === "time") return `${card.color} time bonus, ${minutesFor(card, size)} minutes`;
  if (card.kind === "power") return `Power up: ${card.name}`;
  return `Curse ${card.number}: ${card.title}`;
}
