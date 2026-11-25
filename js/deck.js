// Deck rules. Pure functions only — no DOM, so this stays testable with plain node.

export const SCHEMA_VERSION = 2;
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
    pending: [],
    hand: [],
    discard: [],
    updatedAt: Date.now(),
  };
}

export function canDraw(state) {
  return state.deck.length > 0 && state.hand.length < state.handLimit;
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

/**
 * Draw over whatever is in play: the current card drops to the bottom strip
 * (pending) and a new one comes up. If the draw is impossible nothing moves,
 * so an empty deck or a full hand can't cost you the focused card.
 */
export function drawOver(state) {
  if (!canDraw(state)) {
    return { state, cardId: null, reason: state.deck.length === 0 ? "empty" : "full" };
  }
  const base = state.active === null ? state : parkActive(state).state;
  return drawCard(base);
}

/** Send the card in play to the bottom strip without deciding it. */
export function parkActive(state) {
  if (state.active === null) return { state, cardId: null };
  const cardId = state.active;
  return {
    state: { ...state, active: null, pending: [...state.pending, cardId], updatedAt: Date.now() },
    cardId,
  };
}

/** Bring a pending card back into play, leaving the previous one in its place. */
export function focusPending(state, cardId) {
  const index = state.pending.indexOf(cardId);
  if (index === -1) return { state, cardId: null };

  const pending = state.pending.slice();
  if (state.active === null) pending.splice(index, 1);
  else pending[index] = state.active;

  return {
    state: { ...state, pending, active: cardId, updatedAt: Date.now() },
    cardId,
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
  return state.deck.length + state.pending.length + (state.active ? 1 : 0);
}

/**
 * Validate a persisted run before trusting it: right schema, known card ids,
 * no card duplicated across deck/pending/hand/discard.
 *
 * v1 had no pending list; those saves are upgraded rather than thrown away.
 */
export function sanitize(raw, validIds) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.v !== 1 && raw.v !== SCHEMA_VERSION) return null;

  const { deck, hand, discard, active, handLimit } = raw;
  const pending = raw.v === 1 ? [] : raw.pending;
  if (!Array.isArray(deck) || !Array.isArray(hand) || !Array.isArray(discard)) return null;
  if (!Array.isArray(pending)) return null;
  if (typeof handLimit !== "number" || !Number.isFinite(handLimit) || handLimit < 1) return null;

  const isId = (id) => typeof id === "string" && validIds.has(id);
  if (!deck.every(isId) || !hand.every(isId) || !discard.every(isId) || !pending.every(isId))
    return null;
  if (active !== null && !isId(active)) return null;

  const seen = new Set([
    ...deck,
    ...hand,
    ...discard,
    ...pending,
    ...(active ? [active] : []),
  ]);
  if (seen.size !== deck.length + hand.length + discard.length + pending.length + (active ? 1 : 0))
    return null;

  return {
    v: SCHEMA_VERSION,
    seed: Number.isFinite(raw.seed) ? raw.seed : 0,
    handLimit,
    deck,
    pending,
    hand,
    discard,
    active: active ?? null,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
  };
}
