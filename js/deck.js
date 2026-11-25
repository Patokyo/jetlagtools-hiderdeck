// Deck rules. Pure functions only — no DOM, so this stays testable with plain node.

export const SCHEMA_VERSION = 1;
export const DEFAULT_HAND_LIMIT = 6;

/** Small deterministic PRNG so a shuffle can be reproduced from a seed. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(ids, seed) {
  const random = mulberry32(seed);
  const out = ids.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function newSeed() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Date.now() >>> 0;
}

export function createRun(ids, { handLimit = DEFAULT_HAND_LIMIT } = {}) {
  const seed = newSeed();
  return {
    v: SCHEMA_VERSION,
    seed,
    handLimit,
    deck: shuffle(ids, seed),
    active: null,
    hand: [],
    discard: [],
    updatedAt: Date.now(),
  };
}

export function canDraw(state) {
  return state.active === null && state.deck.length > 0 && state.hand.length < state.handLimit;
}

export function canKeep(state) {
  return state.active !== null && state.hand.length < state.handLimit;
}

/** Move the top card of the deck into play. Returns why nothing was drawn. */
export function drawCard(state) {
  if (state.active !== null) return { state, cardId: null, reason: "busy" };
  if (state.deck.length === 0) return { state, cardId: null, reason: "empty" };
  if (state.hand.length >= state.handLimit) return { state, cardId: null, reason: "full" };

  const [cardId, ...deck] = state.deck;
  return {
    state: { ...state, deck, active: cardId, updatedAt: Date.now() },
    cardId,
    reason: null,
  };
}

/** The card in play is stored in hand. */
export function keepActive(state) {
  if (!canKeep(state)) return { state, cardId: null };
  const cardId = state.active;
  return {
    state: { ...state, active: null, hand: [...state.hand, cardId], updatedAt: Date.now() },
    cardId,
  };
}

/** The card in play is thrown away for good. */
export function discardActive(state) {
  if (state.active === null) return { state, cardId: null };
  const cardId = state.active;
  return {
    state: { ...state, active: null, discard: [...state.discard, cardId], updatedAt: Date.now() },
    cardId,
  };
}

export function deckSize(state) {
  return state.deck.length + (state.active ? 1 : 0);
}

/**
 * Validate a persisted run before trusting it: right schema, known card ids,
 * no card duplicated across deck/hand/discard.
 */
export function sanitize(raw, validIds) {
  if (!raw || typeof raw !== "object" || raw.v !== SCHEMA_VERSION) return null;

  const { deck, hand, discard, active, handLimit } = raw;
  if (!Array.isArray(deck) || !Array.isArray(hand) || !Array.isArray(discard)) return null;
  if (typeof handLimit !== "number" || !Number.isFinite(handLimit) || handLimit < 1) return null;

  const isId = (id) => typeof id === "string" && validIds.has(id);
  if (!deck.every(isId) || !hand.every(isId) || !discard.every(isId)) return null;
  if (active !== null && !isId(active)) return null;

  const seen = new Set([...deck, ...hand, ...discard, ...(active ? [active] : [])]);
  if (seen.size !== deck.length + hand.length + discard.length + (active ? 1 : 0)) return null;

  return {
    v: SCHEMA_VERSION,
    seed: Number.isFinite(raw.seed) ? raw.seed : 0,
    handLimit,
    deck,
    hand,
    discard,
    active: active ?? null,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
  };
}
