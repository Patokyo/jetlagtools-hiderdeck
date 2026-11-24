# jetlagtools-hiderdeck

A virtual hider deck for Jet Lag: Hide + Seek home games.

A single-page card deck for the [Jet Lag: The Game](https://www.youtube.com/@JetLagTheGame) hider deck. 100 cards, swipe down to draw, drag the card around, swipe up to discard it or swipe down to keep it.

Static site. No backend, no build step, no framework. Deployed to GitHub Pages.

---

## The interaction

| Gesture | Result |
| --- | --- |
| Swipe down anywhere on the screen | The next card slides down from the top of the screen into view |
| Drag the card | Repositions/rotates it freely while held |
| Release high (swipe up past the threshold) | Card is **discarded** to the discard pile |
| Release low (swipe down past the threshold) | Card is **kept** in hand |
| Release in the dead zone | Card snaps back, decision not made |

Rules the app has to enforce:

- **Hand limit** — drawing is blocked once the hand is full. The card stays in the deck.
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
.nojekyll
css/
  reset.css
  layout.css
  card.css
js/
  app.js          # wiring: listeners, boot
  deck.js         # deck + shuffle + draw/discard/keep rules (pure, no DOM)
  gestures.js     # pointer tracking, thresholds, velocity
  render.js       # card element creation + transform updates
  storage.js      # localStorage load/save + schema versioning
data/
  cards.json      # the 100 cards
assets/
  card-back.svg
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
  v: 1,                 // schema version, for future migrations
  seed: 123456789,      // shuffle seed; regenerate to reshuffle
  deck: ["013", "007", ...],   // remaining card ids, in draw order
  hand: ["042", ...],          // card ids currently held
  discard: ["099", ...],       // card ids discarded
  handLimit: 6,
  updatedAt: 1764050000000
}
```

If `v` doesn't match the current version, or the JSON is corrupt, fall back to a fresh deck rather than half-loading a broken run.

---

## Running locally

ES modules don't load from `file://`, so use any static server:

```bash
python3 -m http.server 8000
# or
npx serve .
```

Then open <http://localhost:8000>.

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

- [ ] `data/cards.json` — the 100 cards
- [ ] Deck: seeded shuffle, draw, keep, discard, hand limit
- [ ] Gestures: pull-down-to-draw, drag, swipe up/down to resolve
- [ ] Card stack rendering + snap-back animation
- [ ] `localStorage` persistence + resume prompt
- [ ] Reset / new run button
- [ ] Offline: serve from cache (a service worker is the last thing added, not the first)

---

## License

GNU GPL v3.0 — see [LICENSE](LICENSE).
