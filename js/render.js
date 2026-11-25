// DOM rendering. Card faces, the fan behind the live card, the hand strip.

let toastTimer = null;

function parityOf(card) {
  return Number(card.label) % 2 === 0 ? "even" : "odd";
}

function faceParts(card) {
  const tl = document.createElement("span");
  tl.className = "card__corner card__corner--tl";
  tl.textContent = card.label;

  const br = document.createElement("span");
  br.className = "card__corner card__corner--br";
  br.textContent = card.label;

  const number = document.createElement("span");
  number.className = "card__number";
  number.textContent = card.label;

  return [tl, br, number];
}

export function createCardEl(card) {
  const el = document.createElement("article");
  el.className = "card";
  el.dataset.id = card.id;
  el.dataset.parity = parityOf(card);
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", `Card ${card.label}`);
  el.append(...faceParts(card));
  return el;
}

/** A drawn-but-undecided card, peeking out behind the live one. Tapping focuses it. */
export function createPeekEl(card, depth) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "card card--peek";
  el.dataset.id = card.id;
  el.dataset.parity = parityOf(card);
  el.style.setProperty("--depth", String(depth));
  el.setAttribute("aria-label", `Focus card ${card.label}`);
  el.append(...faceParts(card));
  return el;
}

/**
 * The fan of cards in play but not yet decided. Newest sits closest behind the
 * live card; each older one steps further left. Only the live card is removed
 * by this module's caller, so peeks are rebuilt in place.
 */
export function renderPeek(state, container, cardsById, onFocus) {
  if (!container) return;
  // Drives the centring offset: no fan means no shift, so the single card is
  // centred; the shift grows so the card plus its fan stays centred.
  container.style.setProperty("--fan", String(state.pending.length));
  for (const el of container.querySelectorAll(".card--peek")) el.remove();

  state.pending.forEach((id, index) => {
    const card = cardsById.get(id);
    if (!card) return;

    const depth = state.pending.length - index;
    const el = createPeekEl(card, depth);
    el.addEventListener("click", () => onFocus(id));
    container.append(el);
  });
}

/**
 * The hand strip at the bottom. With nothing in play these can be pressed to
 * bring a card forward for reading; the card being read is marked.
 */
export function renderHand(state, container, cardsById, onFocus) {
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
    el.dataset.parity = parityOf(card);
    el.textContent = card.label;

    if (state.review && state.active === id) {
      el.classList.add("is-reading");
      el.setAttribute("aria-current", "true");
    }

    if (interactive) {
      el.setAttribute("aria-label", `Read card ${card.label}`);
      el.addEventListener("click", () => onFocus(id));
    } else {
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", `Card ${card.label} in hand`);
    }

    container.append(el);
  }
}

export function renderHud(state, els) {
  els.deck.textContent = String(state.deck.length);
  els.hand.textContent = `${state.hand.length}/${state.handLimit}`;
  els.discard.textContent = String(state.discard.length);
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
