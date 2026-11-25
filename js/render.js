// DOM rendering. Builds card faces, keeps the HUD in sync, shows toasts.

let toastTimer = null;

export function createCardEl(card) {
  const el = document.createElement("article");
  el.className = "card";
  el.dataset.id = card.id;
  el.dataset.parity = Number(card.label) % 2 === 0 ? "even" : "odd";
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", `Card ${card.label}`);

  const tl = document.createElement("span");
  tl.className = "card__corner card__corner--tl";
  tl.textContent = card.label;

  const br = document.createElement("span");
  br.className = "card__corner card__corner--br";
  br.textContent = card.label;

  const number = document.createElement("span");
  number.className = "card__number";
  number.textContent = card.label;

  el.append(tl, br, number);
  return el;
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
