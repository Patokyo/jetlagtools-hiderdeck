// Card data helpers. Pure functions, no DOM, so they stay testable with node.

export const SIZES = ["small", "medium", "large"];

export const SIZE_LABELS = { small: "Small", medium: "Medium", large: "Large" };

/** Distances are written metric-first, with the imperial reading as an option. */
export const UNITS = ["metric", "imperial"];

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
 * Casting costs that make the player give up cards from the hand, keyed by the
 * cost text in cards.json with case, punctuation and spacing flattened, so
 * "Discard 2 cards" and "Discard two cards" land on the same plan.
 *
 * `need` is how many cards must be picked, `kind` restricts what may be paid
 * with (null means any card), and `all` takes the rest of the hand at once.
 */
export const CURSE_COSTS = {
  "discard a card": { need: 1, kind: null },
  "discard 1 card": { need: 1, kind: null },
  "discard two cards": { need: 2, kind: null },
  "discard 2 cards": { need: 2, kind: null },
  "discard a time bonus card": { need: 1, kind: "time" },
  "discard a power up card": { need: 1, kind: "power" },
  "discard your hand": { all: true, kind: null },
};

function costKey(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The card-paying plan for a curse, or null when its cost is paid at the table
 * (a photo, a roll of the die, seekers standing somewhere) or it has none.
 */
export function curseCost(cost) {
  return CURSE_COSTS[costKey(cost)] ?? null;
}

/**
 * Curse text carries per-size ranges, e.g. "[S10, M20, L30]" or "[S5 M10 L15]"
 * (one card is missing its L marker). Every match is replaced with the value
 * for the selected game size.
 */
const RANGE = /\[\s*S\s*([\d.]+)\s*[, ]\s*M\s*([\d.]+)\s*[, ]\s*(?:L\s*)?([\d.]+)\s*\]/gi;

/** A distance given in both units, e.g. "[S1, M5, L30]mi [S0.3, M1.5, L9.1]km". */
const DISTANCE_PAIR =
  /\[\s*S\s*([\d.]+)\s*[, ]\s*M\s*([\d.]+)\s*[, ]\s*L\s*([\d.]+)\s*\]\s*mi\s+\[\s*S\s*([\d.]+)\s*[, ]\s*M\s*([\d.]+)\s*[, ]\s*L\s*([\d.]+)\s*\]\s*km/gi;

/** Feet with a metric reading in brackets, e.g. "1,000ft (300 meters)". */
const FEET_PAREN = /([\d,]+)\s*ft\s*\(\s*([\d,]+)\s*(m|meters?|metres?)\s*\)/gi;

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

/**
 * What the hand is worth when the hider is caught: every time bonus counts, and
 * a Duplicate in hand copies one of them. The best copy is the biggest bonus,
 * which is the number a player is actually playing for.
 */
export function handScore(hand, cardsById, size) {
  let base = 0;
  let best = 0;
  let copies = 0;

  for (const id of hand) {
    const card = cardOf(cardsById, id);
    if (!card) continue;

    if (card.kind === "time") {
      const minutes = minutesFor(card, size);
      base += minutes;
      if (minutes > best) best = minutes;
    } else if (card.kind === "power" && card.name === "Duplicate") {
      copies += 1;
    }
  }

  const bonus = copies * best;
  return { base, bonus, copies, best, total: base + bonus };
}

/** The hand's score as text, ready to paste to the seekers. */
export function scoreText(hand, cardsById, size) {
  const { copies, best, total } = handScore(hand, cardsById, size);
  if (total === 0) return "No time bonus in hand yet.";

  const lines = [`Time bonus in hand: ${total} min`];
  const parts = [];
  for (const id of hand) {
    const card = cardOf(cardsById, id);
    if (card && card.kind === "time") parts.push(`${card.color} ${minutesFor(card, size)}m`);
  }
  if (parts.length) lines.push(parts.join(" · "));
  if (copies) lines.push(`Duplicate ×${copies} copies the best bonus: +${copies * best}m`);

  return lines.join("\n");
}

/**
 * Card text for the selected game size and unit system. Distances are written
 * once per unit in cards.json; only the chosen one survives, so a metric player
 * never sees miles and an imperial player never sees kilometres.
 */
export function formatEffect(text, size, units = "metric") {
  if (!text) return "";

  const index = SIZES.indexOf(size);
  const pick = index === -1 ? 1 : index;
  const metric = units !== "imperial";

  return String(text)
    .replace(DISTANCE_PAIR, (_match, smi, mmi, lmi, skm, mkm, lkm) =>
      metric
        ? `${[skm, mkm, lkm][pick]}km`
        : `${[smi, mmi, lmi][pick]}mi`,
    )
    .replace(FEET_PAREN, (_match, feet, metres, unit) =>
      metric ? `${metres}${unit.toLowerCase() === "m" ? "m" : " meters"}` : `${feet}ft`,
    )
    .replace(RANGE, (_match, small, medium, large) => [small, medium, large][pick]);
}

/**
 * The curse as text, ready to paste into a message to the seekers. A cost the
 * hider pays with cards is their own business, so only costs that are conditions
 * on the seekers make it into the copy.
 */
export function curseText(card, size, units = "metric") {
  const lines = [card.title];

  const effect = formatEffect(card.effect, size, units);
  if (effect) lines.push(effect);

  const cost = formatEffect(card.cost, size, units);
  if (cost && !curseCost(card.cost)) lines.push(`Casting cost: ${cost}`);

  return lines.join("\n");
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
