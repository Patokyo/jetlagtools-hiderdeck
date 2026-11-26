// Deck rules. Pure functions only — no DOM, so this stays testable with plain node.

import { baseId } from "./cards.js?v=35";

export const SCHEMA_VERSION = 5;
export const DEFAULT_HAND_LIMIT = 6;
export const MAX_PENDING = 5;
/** Tentacles is the four-draw question, and the only one that keeps two cards. */
export const TENTACLES_DRAWS = 4;
export const TENTACLES_KEEPS = 2;

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
    review: false,
    // How many cards have been drawn for the question being answered, and how
    // many of them have been kept. Both go back to zero when the question ends.
    drawn: 0,
    kept: 0,
    pending: [],
    hand: [],
    discard: [],
    updatedAt: Date.now(),
  };
}

export function canDraw(state) {
  return !state.review && state.deck.length > 0 && state.pending.length < MAX_PENDING;
}

/** A card in play can always be kept; a full hand just has to give one up. */
export function canKeep(state) {
  return state.active !== null;
}

/** Move the top card of the deck into play. Returns why nothing was drawn. */
export function drawCard(state) {
  if (state.active !== null || state.review) return { state, cardId: null, reason: "busy" };
  if (state.deck.length === 0) return { state, cardId: null, reason: "empty" };

  const [cardId, ...deck] = state.deck;
  return {
    state: { ...state, deck, active: cardId, updatedAt: Date.now() },
    cardId,
    reason: null,
  };
}

/**
 * Draw over whatever is in play: the current card drops to the bottom strip
 * (pending) and a new one comes up. A full hand doesn't block drawing — the
 * card is only in play until it is kept, and keeping asks what to replace.
 * If the draw is impossible nothing moves, so a refused draw never costs you
 * the focused card.
 *
 * Every draw in the same question adds to `drawn`, which is what tells a photo
 * question (one card) from a Thermometer (two) or Tentacles (four).
 */
export function drawOver(state) {
  if (state.review) return { state, cardId: null, reason: "review" };
  if (state.deck.length === 0) return { state, cardId: null, reason: "empty" };
  if (state.pending.length >= MAX_PENDING) return { state, cardId: null, reason: "stacked" };

  const base = state.active === null ? state : parkActive(state).state;
  const result = drawCard(base);
  if (!result.cardId) return result;

  return {
    state: { ...result.state, drawn: result.state.drawn + 1, updatedAt: Date.now() },
    cardId: result.cardId,
    reason: null,
  };
}

/** Send the card in play to the bottom strip without deciding it. */
export function parkActive(state) {
  if (state.active === null || state.review) return { state, cardId: null };
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
    state: { ...state, pending, active: cardId, review: false, updatedAt: Date.now() },
    cardId,
  };
}

/**
 * Bring a kept card forward to read it. It stays in hand — so the hand count
 * and strip do not change — and blocks drawing until it is put back or played.
 */
export function focusHand(state, cardId) {
  if (!state.hand.includes(cardId)) return { state, cardId: null, reason: "missing" };
  if (state.active !== null && !state.review) return { state, cardId: null, reason: "busy" };

  return {
    state: { ...state, active: cardId, review: true, updatedAt: Date.now() },
    cardId,
    reason: null,
  };
}

/**
 * Put a kept card somewhere else in the hand. `beforeId` is the card it should
 * sit in front of, or null for the end of the strip. Hand order is only how the
 * hand reads, so nothing else about the run changes — and a card dropped back
 * where it came from leaves the same state behind, which the caller can test
 * by identity.
 */
export function reorderHand(state, cardId, beforeId = null) {
  if (!state.hand.includes(cardId) || cardId === beforeId) return state;

  const hand = state.hand.filter((id) => id !== cardId);
  const at = beforeId === null ? hand.length : hand.indexOf(beforeId);
  hand.splice(at === -1 ? hand.length : at, 0, cardId);

  if (hand.every((id, i) => id === state.hand[i])) return state;
  return { ...state, hand, updatedAt: Date.now() };
}

/**
 * The card in play is stored in hand. With the hand already at its limit the
 * caller has to name the card being replaced (`replace`), so keeping can never
 * push the hand past the limit; without one nothing moves and the reason is
 * "replace", which is the cue to ask which card makes room.
 */
export function keepActive(state, { replace = null } = {}) {
  // A reviewed card already lives in hand: keeping it just puts it back.
  if (state.review) {
    return {
      state: { ...state, active: null, review: false, updatedAt: Date.now() },
      cardId: state.active,
    };
  }

  if (!canKeep(state)) return { state, cardId: null, reason: "idle" };

  const full = state.hand.length >= state.handLimit;
  if (full && (replace === null || !state.hand.includes(replace))) {
    return { state, cardId: null, reason: "replace" };
  }

  const cardId = state.active;
  // One to three draws keep a single card and throw the rest away; Tentacles
  // draws four and keeps two, so its first keep leaves the rest in play.
  const kept = state.kept + 1;
  const done = kept >= (state.drawn >= TENTACLES_DRAWS ? TENTACLES_KEEPS : 1);
  const leftover = done ? state.pending : [];
  return {
    state: {
      ...state,
      active: null,
      pending: done ? [] : state.pending,
      drawn: done ? 0 : state.drawn,
      kept: done ? 0 : kept,
      hand: [...state.hand.filter((id) => id !== replace), cardId],
      discard: [...state.discard, ...leftover, ...(replace === null ? [] : [replace])],
      updatedAt: Date.now(),
    },
    cardId,
    replaced: replace,
    discarded: leftover,
    reason: null,
  };
}

/**
 * Swipe-up escape hatch: throw away the card in play and everything parked
 * behind it, without deciding any of them one at a time. With `hand` the rest
 * of the hand goes too, which is what playing Move does.
 */
export function discardAllInPlay(state, { hand = false } = {}) {
  const inPlay = [...(state.active === null ? [] : [state.active]), ...state.pending];
  // A card being read is in `active` and in the hand, so it only counts once.
  const handIds = hand ? state.hand.filter((id) => id !== state.active) : [];
  const ids = [...inPlay, ...handIds];
  if (ids.length === 0) return { state, count: 0, handDiscarded: [] };

  const leaving = new Set(ids);
  return {
    state: {
      ...state,
      active: null,
      review: false,
      pending: [],
      drawn: 0,
      kept: 0,
      hand: state.hand.filter((id) => !leaving.has(id)),
      discard: [...state.discard, ...ids],
      updatedAt: Date.now(),
    },
    count: ids.length,
    handDiscarded: handIds,
  };
}

/** A free instance id for a duplicated card, e.g. "t3" -> "t3~1". */
export function nextCopyId(state, id) {
  const used = new Set([...state.deck, ...state.pending, ...state.hand, ...state.discard]);
  if (state.active !== null) used.add(state.active);

  for (let n = 1; ; n += 1) {
    const candidate = `${id}~${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * Play the power up being read. The card leaves the hand, the picked cards are
 * discarded with it, `draw` cards come straight off the deck into the hand,
 * `expand` raises the hand limit, and `duplicateOf` puts a copy of a hand card
 * back into the hand. Nothing moves if a pick is not actually in the hand.
 */
export function playPower(
  state,
  cardId,
  { discards = [], draw = 0, expand = 0, duplicateOf = null } = {},
) {
  if (state.active !== cardId || !state.review) return { state, cardId: null, reason: "idle" };

  const others = state.hand.filter((id) => id !== cardId);
  const picks = new Set(discards);
  if (picks.size !== discards.length || !discards.every((id) => others.includes(id))) {
    return { state, cardId: null, reason: "discards" };
  }
  if (duplicateOf !== null && !others.includes(duplicateOf)) {
    return { state, cardId: null, reason: "duplicate" };
  }

  const leaving = new Set([cardId, ...discards]);
  let hand = state.hand.filter((id) => !leaving.has(id));
  if (duplicateOf !== null) hand = [...hand, nextCopyId(state, duplicateOf)];

  const count = Math.max(0, Math.min(draw, state.deck.length));
  const drawn = state.deck.slice(0, count);
  hand = [...hand, ...drawn];

  return {
    state: {
      ...state,
      active: null,
      review: false,
      deck: state.deck.slice(count),
      hand,
      handLimit: state.handLimit + expand,
      discard: [...state.discard, cardId, ...discards],
      updatedAt: Date.now(),
    },
    cardId,
    drawn,
    reason: null,
  };
}

/**
 * Play the curse being read, paying its casting cost. `discards` names the
 * cards handed over: they leave the hand with the curse and join the discard
 * pile, so the cost can't be skipped. `need` and `kind` are the cost's rules —
 * the wrong number of cards, or a card of the wrong kind, is refused and the
 * curse stays in hand. `kindOf(id)` resolves a hand card's kind.
 */
export function playCurse(
  state,
  cardId,
  { discards = [], need = 0, kind = null, kindOf = () => null } = {},
) {
  if (state.active !== cardId || !state.review) return { state, cardId: null, reason: "idle" };

  const others = state.hand.filter((id) => id !== cardId);
  const picks = new Set(discards);
  if (picks.size !== discards.length || !discards.every((id) => others.includes(id))) {
    return { state, cardId: null, reason: "discards" };
  }
  if (discards.length !== need) return { state, cardId: null, reason: "discards" };
  if (kind !== null && !discards.every((id) => kindOf(id) === kind)) {
    return { state, cardId: null, reason: "discards" };
  }

  const leaving = new Set([cardId, ...discards]);
  return {
    state: {
      ...state,
      active: null,
      review: false,
      hand: state.hand.filter((id) => !leaving.has(id)),
      discard: [...state.discard, cardId, ...discards],
      updatedAt: Date.now(),
    },
    cardId,
    paid: discards,
    reason: null,
  };
}

/** The card in play is thrown away for good. */
export function discardActive(state) {
  if (state.active === null) return { state, cardId: null };
  const cardId = state.active;

  // Playing a card from hand: it leaves the hand and joins the discard pile.
  if (state.review) {
    return {
      state: {
        ...state,
        active: null,
        review: false,
        hand: state.hand.filter((id) => id !== cardId),
        discard: [...state.discard, cardId],
        updatedAt: Date.now(),
      },
      cardId,
    };
  }

  // Skipping a drawn card: the next card of the question comes forward. With
  // nothing left in play the question is over and the counts start again.
  if (state.drawn > 0) {
    const [next, ...pending] = state.pending;
    const open = next !== undefined;
    return {
      state: {
        ...state,
        active: next ?? null,
        pending,
        drawn: open ? state.drawn : 0,
        kept: open ? state.kept : 0,
        discard: [...state.discard, cardId],
        updatedAt: Date.now(),
      },
      cardId,
      next: next ?? null,
    };
  }

  return {
    state: { ...state, active: null, discard: [...state.discard, cardId], updatedAt: Date.now() },
    cardId,
  };
}

export function deckSize(state) {
  return state.deck.length + state.pending.length + (state.active && !state.review ? 1 : 0);
}

/**
 * Validate a persisted run before trusting it: right schema, known card ids,
 * no card duplicated across deck/pending/hand/discard.
 *
 * v1 had no pending list and v2 no review flag; those saves are upgraded
 * rather than thrown away.
 */
export function sanitize(raw, validIds) {
  if (!raw || typeof raw !== "object") return null;
  if (!Number.isInteger(raw.v) || raw.v < 1 || raw.v > SCHEMA_VERSION) return null;

  const { deck, hand, discard, active, handLimit } = raw;
  const pending = raw.v === 1 ? [] : raw.pending;
  const review = raw.v >= 3 ? raw.review === true : false;
  if (!Array.isArray(deck) || !Array.isArray(hand) || !Array.isArray(discard)) return null;
  if (!Array.isArray(pending)) return null;
  if (typeof handLimit !== "number" || !Number.isFinite(handLimit) || handLimit < 1) return null;

  // v5 counts the draws and keeps of the question in play. Older saves only
  // knew whether the cards in play were one question, so whatever is in play
  // becomes a question of that many cards.
  const drawn = raw.v >= 5 ? raw.drawn : active !== null && !review ? 1 + pending.length : 0;
  const kept = raw.v >= 5 ? raw.kept : 0;
  if (!Number.isInteger(drawn) || drawn < 0 || drawn > MAX_PENDING + 1) return null;
  if (!Number.isInteger(kept) || kept < 0 || kept > drawn) return null;

  // Instance ids carry a "~n" suffix when a card was duplicated; the card
  // behind it is the id before the suffix.
  const isId = (id) => typeof id === "string" && validIds.has(baseId(id));
  if (!deck.every(isId) || !hand.every(isId) || !discard.every(isId) || !pending.every(isId))
    return null;
  if (active !== null && !isId(active)) return null;

  // A reviewed card is in hand *and* shown in play. Any other card in play must
  // not also be in hand.
  if (review && (active === null || !hand.includes(active))) return null;
  if (!review && active !== null && hand.includes(active)) return null;

  const inPlay = active !== null && !review ? [active] : [];
  const seen = new Set([...deck, ...hand, ...discard, ...pending, ...inPlay]);
  if (seen.size !== deck.length + hand.length + discard.length + pending.length + inPlay.length)
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
    review,
    drawn,
    kept,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
  };
}
