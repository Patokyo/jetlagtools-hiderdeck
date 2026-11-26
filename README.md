# jetlagtools-hiderdeck

A virtual hider deck for Jet Lag: Hide + Seek home games.

A single-page card deck for the [Jet Lag: The Game](https://www.youtube.com/@JetLagTheGame) hider deck. 100 cards, swipe down to draw, drag the card around, swipe up to discard it or swipe down to keep it.

Static site. No backend, no build step, no framework. Deployed to GitHub Pages.

---

## The interaction

| Gesture | Result |
| --- | --- |
| Swipe down anywhere on the table | Draws the next card. If a card is already in play it drops slightly left and behind the new one, so drawing again is how a multi-card question is set up |
| Tap or swipe down on the handle under the hand | Draws the next card: a plain press is enough, and so is the same distance and flick as the table. The card in play covers most of a phone screen, so this is the one draw target that is always under your thumb |
| Drag a card peeking out on the left | Grabs it where it sits — no jump to the front — and carries it: down keeps it, up discards it, sideways moves it through the row of cards in play. Let go where it was picked up and it stays in exactly that place |
| Drag any card in play | One drag, both jobs. Sideways it moves through the row of cards in play — the card on the table included — with the others stepping over to open a gap where it would land; up or down it arms the keep or the discard. Letting go does whichever the release asks for: drop it in the gap, or, once it is pulled a card's height up or down, keep or discard it. A keep or discard takes the card out of the row, so the gap closes and the cards left behind keep their order |
| Tap a card in your hand | Brings it forward to read, and its mini leaves the strip while it is up. Drawing is blocked while it is forward: drag up to **play** it (hand → discard), drag down to put it back |
| Drag a card sideways in your hand | Reorders the hand. The card stays mini sized and follows the finger while the rest of the strip opens a gap where it would land; letting go drops it there, and holding it near an edge scrolls a strip too wide to fit |
| Drag a card out of your hand | It grows to full size as it climbs towards the table. Let go near the top and it stays there as the card being read; swipe it up past the table to **play** it; let it back down low and it slides into the hand |
| Tap the copy symbol on a card | Curses and Move carry one in their bottom right corner: it puts that card's text on the clipboard, ready to send to the seekers |
| Tap the gear in the HUD | Picks the game size. Small, medium and large change every card's values, and the choice is kept for the next run |
| Swipe up anywhere on the table | Discards everything still undecided: the live card and the whole fan |
| Drag the focused card | Repositions/rotates it freely while held |
| Release high (swipe up past the threshold) | Card is **discarded** to the discard pile |
| Release low (swipe down past the threshold) | Card is **kept** — it slides down into the hand strip |
| Release in the dead zone | Card snaps back, decision not made |
| Tap **Undo** in the HUD | Restores the run as it was before the last draw, discard, keep or play. Top right, dimmed until there is something to put back |

Rules the app has to enforce:

- **Sorting and deciding are the same drag** — sideways movement orders the row and up or down arms the keep or the discard, both from the first movement, so neither waits for the other; the release decides which one happened. A keep or a discard takes the card out of the row, which is why the gap closes behind it: the cards it leaves keep their order.
- **The cards in play sort as one row** — the fan and the card on the table are a single row with the card being decided at the front, and a sideways drag moves any of them along it, so the front card can be sent back and any card can be brought to the front. That order is only how the cards read, which one is being decided, and which comes forward when the table clears, so nothing else about the run changes — and a card dropped back where it came from leaves the state untouched.
- **Several cards in play** — you can draw before deciding. Each undecided card steps left and behind the new one, far enough that the index in its top-left corner stays readable; a card only comes to the front by being dragged there, and dragging one decides it there without bringing it forward first. Five can be in play at once (`MAX_PENDING`) — beyond that the fan would have to stack cards on top of each other, out of reach.
- **The hand is the strip at the bottom** — keeping a card sends it down there, so the hand is visible against the limit rather than only a counter. Undecided cards are not in the hand: they cost nothing until you keep one.
- **Reading the hand** — pressing a kept card brings it forward full size without taking it out of the hand, so the count stays honest; only its mini leaves the strip, because the card itself is already on the table and a second copy of it would read as two. While it is forward no card can be drawn; playing it moves it to the discard pile and putting it back leaves the hand unchanged. A kept card can also be dragged straight out of the strip: it is a full size card scaled down over its mini, so it grows as it climbs towards the table, and letting go near the top leaves it there to read. Swiping it further up plays it, and letting go low drops it back into the hand.
- **Hand order is yours** — the strip is a row the player arranges: a card can be dragged sideways and dropped anywhere in it, and the order is saved with the rest of the run, so a refresh keeps it. It is presentation only, so it isn't an undo step and it never changes what is in hand. A sideways drag belongs to the card, not to the scroll box, so a strip too wide to fit scrolls itself while a card is held near either end.
- **Power ups play themselves** — Draw 1 Expand 1 draws its card straight into the hand and raises the hand limit by one. Discard 1 Draw 2 and Discard 2 Draw 3 can't be played without that many other cards in hand; once played they ask you to tap the cards to give up, then discard them and draw straight into the hand. Duplicate asks for a card in hand and puts a copy of it back into the hand. Randomise and Veto simply leave the hand, because their effect happens at the table. Move throws the rest of the hand away as it leaves — the card says to discard your hand.
- **Questions are counted from the draws** — a question costs one to four cards and the app keeps track of how many you have drawn, so there is nothing to choose before drawing. Draw one and keep it: a photo question, nothing else happens. Draw two and keep one: the other is discarded at once (Thermometer, Radar). Draw three and keep one: both others go (Measuring, Matching). Draw four and keep one: nothing is discarded yet, because Tentacles keeps two — keeping the second throws the remaining two away. Skipping a card discards it and brings the next one forward; swiping up on the table abandons the whole draw.
- **Every move is undoable** — the Undo button in the HUD restores the run as it was before the last draw, discard, keep or played card. It's a fixed button rather than a toast: it never covers the card or the hand, and it can be hit without reading anything. It dims once used, because only one step is kept.
- **The draw handle is always reachable** — a card in play covers most of a phone screen, which leaves bare table as a thin border around it and no good place to aim a thumb. The tray under the hand is a real target for that reason: a grabber bar with the hint, 44px tall, sitting where the thumb already rests, where a press or a downward swipe draws — drawing never depends on a drag. It is taken out of the table's own drag, so one swipe can never draw twice, and it is a button, so Enter and Space draw from the keyboard too.
- **Swipe up clears the table** — an upward swipe on the table, rather than on a card, discards every undecided card at once. It's the bail-out for a draw you don't want to sort through; kept cards are never touched by it.
- **Hand limit** — a full hand still lets you draw; the card is only in play until you keep it. Keeping into a full hand asks you to pick a card already in the hand to throw away first, so the hand never grows past its limit by keeping: the hand rises to the middle of the screen for that choice while the card being kept waits off the bottom edge with only its top showing, so there is nothing to do but pick the card that goes. The hand still sorts with a sideways drag while that choice is open, and a card can be decided from there as well: swiping one up discards it as the card that makes room, and swiping one down parks it at the bottom edge as a card you are not discarding, one tap from coming back into the choice. Drawing never costs you the card in play: it only leaves play when you keep or discard it.
- **Curses pay their casting cost in cards** — a curse whose cost is "Discard a card", "Discard 2 cards", "Discard a time bonus", "Discard a powerup" or "Discard your hand" can't be played until those cards are picked, exactly like the power ups that discard to draw. The picks go to the discard pile with the curse, and if the hand can't pay, the curse stays in hand. "Discard your hand" needs no picking: it takes the rest of the hand with it.
- **Copying is a press, not a side effect** — curses and Move are the cards the seekers have to be sent, so their faces carry a small two-sheet button in the bottom right corner. Pressing it puts the card's text on the clipboard with the current size and units applied; nothing is copied when the card is played. A press is also the only thing the clipboard allows: iOS refuses a write that happens as a drag ends, so a button is what makes copying work on the phone at all.
- **Discard tracking** — discarded cards are removed from play and recorded, not recycled. The count is not shown in the HUD, which keeps only deck, hand and the hand's score. A Duplicate in hand counts as a second copy of the best time bonus, so the number is what the hider is actually playing for.
- **Persistence** — deck order, hand, discard pile and hand limit are cached in `localStorage` so a refresh (or a closed tab) resumes exactly where the player left off.

---

## The deck

`data/cards.json` holds the real 100 cards:

| Kind | Count | Composition |
| --- | --- | --- |
| Time bonus | 55 | Red ×25 (2/3/5 min), Orange ×15 (4/6/10), Yellow ×10 (6/9/15), Green ×3 (8/12/20), Blue ×2 (12/18/30) |
| Power up | 21 | Randomise ×4, Veto ×4, Duplicate ×2, Move ×1, Discard 1 Draw 2 ×4, Discard 2 Draw 3 ×4, Draw 1 Expand 1 ×2 |
| Curse | 24 | Each with its title, effect and casting cost |

### Card faces

- **Time bonus** — a colour band, a clock face and the minutes. The band's colour is the label, so the face never spells the colour out. The clock's filled wedge scales to the best bonus for the chosen game size, so 25 of 30 minutes is most of a clock and 2 of 12 is a sliver.
- **Power up** — an icon for the power (shuffle for Randomise, a crossed circle for Veto, and so on), the name, and a line explaining what playing it does.
- **Curse** — a purple stripe across the top edge, so curses are obvious in the fan, plus the title, effect and casting cost. The text is set as large as the card allows and shrinks only when the effect runs long.
- **Hand strip** — each kept card is a miniature: minutes for a time bonus, the icon and short name for a power up, and for a curse the name without its "Curse of the" prefix.

The three time-bonus values and the `[S…, M…, L…]` ranges inside curse text are the small, medium and large game values. Choosing a size in settings re-renders every card on the table with the values for that size — including cards already in hand — without touching the run state, so the deck, hand and discard pile survive a size change.

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
manifest.webmanifest # installable app metadata
sw.js               # offline cache; bump its VERSION with the ?v= stamp
serve.sh            # localhost dev server (python3, falls back to npx serve)
.nojekyll
css/
  reset.css         # reset only
  layout.css        # stage, HUD, hint, toast
  card.css          # playing-card face + drag states
js/
  app.js            # wiring: boot, gesture → rule → render
  cards.js          # size-aware card text helpers (pure, no DOM)
  deck.js           # shuffle/draw/keep/discard/sanitize (pure, no DOM)
  gestures.js       # pointer tracking, thresholds, velocity
  render.js         # card element, HUD, toast
  storage.js        # localStorage load/save + versioning
data/
  cards.json        # the 100 cards: 55 bonuses, 21 power ups, 24 curses
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
  v: 5,                 // schema version, for future migrations
  seed: 123456789,      // shuffle seed; regenerate to reshuffle
  deck: ["013", "007", ...],   // remaining card ids, in draw order
  active: "013",               // the card in focus, or null
  review: false,               // true when active is a kept card being read
  drawn: 0,                    // cards drawn for the question being answered
  kept: 0,                     // how many of them have been kept (2 for Tentacles)
  pending: ["007", "042"],     // drawn but undecided, oldest first; fanned behind the live card
  hand: ["042", ...],          // card ids kept
  discard: ["099", ...],       // card ids discarded
  handLimit: 6,
  updatedAt: 1764050000000
}
```

If `v` doesn't match the current version, the JSON is corrupt, an id is unknown, or the same card appears twice, the save is rejected and a fresh run is created rather than half-loading a broken one.

A duplicated card is a second copy of the same card, so its id carries a `~n` suffix (`t3` and `t3~1` are both the Red bonus); the card behind an id is looked up by the part before the suffix, and the save validation accepts both forms.

Hand limit defaults to **6** (`DEFAULT_HAND_LIMIT` in `js/deck.js`) and only counts kept cards. Drawing moves a card into `active`; swiping down again parks it in `pending` and draws the next one, so you can pull several cards before deciding. `pending` is rendered as the fan behind the live card, and the strip at the bottom renders `hand` — the two are separate: the hand is what you keep, the fan is what is still in play. Focusing a parked card swaps it with whatever is in `active`, so the fan never duplicates a card. A reviewed card is the one case where a card sits in both `hand` and `active`, which is why `review` exists. v1 saves (no `pending`), v2 saves (no `review`), v3 saves (no question tracking) and v4 saves (a boolean `deal` instead of the counts) are upgraded in place.

---

## Running locally

ES modules don't load from `file://`, so it has to be served over http:

```bash
./serve.sh          # http://localhost:8080
./serve.sh 3000     # or pick a port
```

The script uses `python3 -m http.server` and falls back to `npx serve`. Then open <http://localhost:8080>. Drag with a mouse works the same as a finger.

---

## Installing it on a phone

The site is a plain web app, so "installing" just means adding it to the home screen. It then launches without browser chrome and, thanks to `sw.js`, opens with no signal.

**iPhone / iPad (Safari only — Chrome and Firefox on iOS can't add to the home screen):**

1. Open the site in Safari over https.
2. Tap the **Share** button in the toolbar.
3. Scroll down and tap **Add to Home Screen**, then **Add**.

What makes that work is in `index.html`: `apple-mobile-web-app-capable` gives it the standalone launch and `apple-mobile-web-app-title` is the label under the icon. There is deliberately no `apple-mobile-web-app-status-bar-style`: `black-translucent` is deprecated and, from iOS 26 on, no longer draws the page under the status bar — it lays a blurred band over the top of it and reports a zero top safe-area inset, so the buttons end up under the blur. Without it iOS gives the bar the page's own colour and starts the table below it. The glass band still reaches about 50px past the status bar and the safe-area inset reads zero, so an installed app lifts the HUD by `--hud-extra` and the card height gives the same height back, keeping the table the size it is in a browser tab. `viewport-fit=cover` and the `env(safe-area-inset-*)` padding still keep the bottom controls clear of the home indicator. iOS ignores `display` in the manifest and uses those meta tags instead, and it ignores the manifest's SVG icon — it looks for an `apple-touch-icon` PNG and otherwise uses a screenshot of the page.

**Android (Chrome):** the manifest is read directly, so Chrome offers an install prompt (menu → **Install app**). It uses the SVG icon and `display: standalone`.

On both, the first load with signal caches everything; after that the app opens offline. The cache is tied to the `?v=` stamp, so a release only replaces it once the new page has been fetched once.

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
- [x] Questions counted from the draws (1–3 keep 1, 4 keeps 2)
- [x] Undo the last move from the HUD
- [x] Score the hand (Duplicate doubling)
- [x] Offline: service worker + manifest, so it installs and runs without signal

---

## License

GNU GPL v3.0 — see [LICENSE](LICENSE).
