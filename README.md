# jetlagtools-hiderdeck

A virtual hider deck for Jet Lag: Hide + Seek home games.

A single-page card deck for the [Jet Lag: The Game](https://www.youtube.com/@JetLagTheGame) hider deck. 100 cards, swipe down to draw, drag the card around, swipe up to discard it or swipe down to keep it.

Static site. No backend, no build step, no framework. Deployed to GitHub Pages.

---

## The interaction

| Gesture | Result |
| --- | --- |
| Swipe down anywhere on the table | Draws the next card. If a card is already in play it drops slightly left and behind the new one |
| Tap a card peeking out on the left | Refocuses it — straight to the front, no re-entry animation — and the card that was in focus takes its place behind |
| Tap a card in your hand | Brings it forward to read. Drawing is blocked while it is forward: drag up to **play** it (hand → discard), drag down to put it back |
| Swipe up anywhere on the table | Discards everything still undecided: the live card and the whole fan |
| Drag the focused card | Repositions/rotates it freely while held |
| Release high (swipe up past the threshold) | Card is **discarded** to the discard pile |
| Release low (swipe down past the threshold) | Card is **kept** — it slides down into the hand strip |
| Release in the dead zone | Card snaps back, decision not made |

Rules the app has to enforce:

- **Several cards in play** — you can draw before deciding. Each undecided card drops slightly left and behind the new one, so the stack stays readable; tapping a peeking card brings it forward. Five can be in play at once (`MAX_PENDING`) — beyond that the fan would have to stack cards on top of each other, out of reach.
- **The hand is the strip at the bottom** — keeping a card sends it down there, so the hand is visible against the limit rather than only a counter. Undecided cards are not in the hand: they cost nothing until you keep one.
- **Reading the hand** — pressing a kept card brings it forward full size without taking it out of the hand, so the count stays honest. While it is forward no card can be drawn; playing it moves it to the discard pile and putting it back leaves the hand unchanged.
- **Swipe up clears the table** — an upward swipe on the table, rather than on a card, discards every undecided card at once. It's the bail-out for a draw you don't want to sort through; kept cards are never touched by it.
- **Hand limit** — drawing is blocked once the hand is full. The card stays in the deck, and the focused card is not parked (a refused draw never costs you the card in play).
- **Discard tracking** — discarded cards are removed from play and recorded, not recycled.
- **Persistence** — deck order, hand, discard pile and hand limit are cached in `localStorage` so a refresh (or a closed tab) resumes exactly where the player left off.

---

## What to build it with

**Plain HTML + CSS + JavaScript (ES modules). No framework, no bundler.**

This is a one-screen app with a custom physics-y gesture and a tiny state object. That is the case where frameworks *cost* you more than they give you:

- **Gestures** — `React`/`Svelte` re-rendering fights a card that you are dragging at 60fps. Without one, you own the DOM node and write `transform` inside a `requestAnimationFrame` loop. Nothing else touches it.
- **State** — the whole app state is a few arrays. It's a plain object plus `localStorage`, not a state-management problem.
- **Deploy** — GitHub Pages serves ES modules natively. No build step means push-to-deploy with zero config, and the deployed artifact is identical to what you test locally.
- **Longevity** — zero dependencies means zero dependency churn. This should still work in five years.

Libraries you do **not** need: a gesture library, a state library, an animation library, a bundler, an offline plugin. Use the platform:

- `Pointer Events` (`pointerdown` / `pointermove` / `pointerup` + `setPointerCapture`) — one code path for touch, mouse and pen.
- `touch-action: none` + `overscroll-behavior: none` — kills page scroll and mobile pull-to-refresh while dragging.
- CSS `transform` + `transition` — cheap, GPU-composited movement. Only JS-driven while a finger is down.
- `localStorage` — state is a few KB. `IndexedDB` is overkill until it isn't.
- A seeded PRNG (e.g. `mulberry32`) for shuffling, so a run is reproducible and a save file could be as small as a seed.

---

## Structure options

Pick one before writing the app. All three deploy fine to Pages.

### Option A — Flat (3 files)

```text
index.html
style.css
app.js
cards.json
```

Everything in one script. Fastest possible start, and honestly fine for a first prototype. It stops being fine when gestures, rendering, state and persistence all live in the same file — which for this app is roughly day three.

### Option B — Small module split, no build ← **recommended**

```text
index.html
serve.sh            # localhost dev server (python3, falls back to npx serve)
.nojekyll
css/
  reset.css         # reset only
  layout.css        # stage, HUD, hint, toast
  card.css          # playing-card face + drag states
js/
  app.js            # wiring: boot, gesture → rule → render
  deck.js           # shuffle/draw/keep/discard/sanitize (pure, no DOM)
  gestures.js       # pointer tracking, thresholds, velocity
  render.js         # card element, HUD, toast
  storage.js        # localStorage load/save + versioning
data/
  cards.json        # the 100 cards (ids "1"–"100")
assets/
  favicon.svg
```

Native ES modules, `<script type="module" src="js/app.js">`. No npm, no install, no build. `deck.js` stays DOM-free so it can be unit-tested with `node --test` later without any tooling. Each file lands in the 50–150 line range, which is the sweet spot for something you'll come back to in six months.

### Option C — Framework + build (Vite + React/Svelte)

```text
src/
  App.svelte
  lib/{deck,gestures,storage}.js
  data/cards.json
vite.config.js
package.json
```

Correct answer if this grows into a multi-screen tool (editing decks, stats, share links). Costs you `node_modules`, a build step, and an extra CI job on Pages. For a 100-card swipe app it's ceremony — and you'd still hand-write the gesture logic.

---

## State model

One versioned object, saved on every mutation (debounced ~200ms):

```js
{
  v: 3,                 // schema version, for future migrations
  seed: 123456789,      // shuffle seed; regenerate to reshuffle
  deck: ["013", "007", ...],   // remaining card ids, in draw order
  active: "013",               // the card in focus, or null
  review: false,               // true when active is a kept card being read
  pending: ["007", "042"],     // drawn but undecided, oldest first; fanned behind the live card
  hand: ["042", ...],          // card ids kept
  discard: ["099", ...],       // card ids discarded
  handLimit: 6,
  updatedAt: 1764050000000
}
```

If `v` doesn't match the current version, the JSON is corrupt, an id is unknown, or the same card appears twice, the save is rejected and a fresh run is created rather than half-loading a broken one.

Hand limit defaults to **6** (`DEFAULT_HAND_LIMIT` in `js/deck.js`) and only counts kept cards. Drawing moves a card into `active`; swiping down again parks it in `pending` and draws the next one, so you can pull several cards before deciding. `pending` is rendered as the fan behind the live card, and the strip at the bottom renders `hand` — the two are separate: the hand is what you keep, the fan is what is still in play. Focusing a parked card swaps it with whatever is in `active`, so the fan never duplicates a card. A reviewed card is the one case where a card sits in both `hand` and `active`, which is why `review` exists. v1 saves (no `pending`) and v2 saves (no `review`) are upgraded in place.

---

## Running locally

ES modules don't load from `file://`, so it has to be served over http:

```bash
./serve.sh          # http://localhost:8080
./serve.sh 3000     # or pick a port
```

The script uses `python3 -m http.server` and falls back to `npx serve`. Then open <http://localhost:8080>. Drag with a mouse works the same as a finger.

---

## Branches

| Branch | Purpose |
| --- | --- |
| `main` | Deployable. Every push deploys to GitHub Pages. |
| `dev` | Integration branch for work in progress. Merge into `main` when it's shippable. |

---

## Deployment

`.github/workflows/deploy.yml` publishes the repo root to GitHub Pages on every push to `main`.

One-time setup on GitHub: **Settings → Pages → Source → GitHub Actions**. No base path config needed as long as the app uses relative URLs (`./js/app.js`, not `/js/app.js`) — important because Pages serves project sites from `/<repo>/`.

---

## Roadmap

- [x] `data/cards.json` — the 100 cards, labelled 1–100
- [x] Deck: seeded shuffle, draw, keep, discard, hand limit
- [x] Gestures: pull-down-to-draw, drag, swipe up/down to resolve
- [x] Card rendering + snap-back animation
- [x] `localStorage` persistence (resumes mid-run on refresh)
- [x] New run button
- [ ] Review the kept hand as cards (currently counts only)
- [ ] Offline: serve from cache (a service worker is the last thing added, not the first)

---

## License

GNU GPL v3.0 — see [LICENSE](LICENSE).
