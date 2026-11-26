// Offline cache. The deck is used underground, where the first load would
// otherwise fail, so every asset is precached and served from here.
//
// Bump VERSION together with the ?v= stamp in index.html: a new name installs
// a fresh cache and activate drops the old one, so a release never mixes files
// from two versions.

const VERSION = "v43";
const CACHE = `hiderdeck-${VERSION}`;

// Cache keys are absolute, so the same URL strings the page requests are used.
const ROOT = new URL("./", self.location).href;

const ASSETS = [
  ROOT,
  `${ROOT}index.html`,
  `${ROOT}manifest.webmanifest`,
  `${ROOT}css/reset.css?v=43`,
  `${ROOT}css/layout.css?v=43`,
  `${ROOT}css/card.css?v=43`,
  `${ROOT}js/app.js?v=43`,
  `${ROOT}js/cards.js?v=43`,
  `${ROOT}js/deck.js?v=43`,
  `${ROOT}js/gestures.js?v=43`,
  `${ROOT}js/render.js?v=43`,
  `${ROOT}js/storage.js?v=43`,
  `${ROOT}data/cards.json`,
  `${ROOT}assets/favicon.svg`,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // One missing file must not fail the whole install.
      .then((cache) => Promise.all(ASSETS.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The page itself goes to the network first, so a new deploy is picked up as
  // soon as there is signal; the cached copy is the offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(`${ROOT}index.html`, copy));
          return response;
        })
        .catch(() =>
          caches
            .match(`${ROOT}index.html`)
            .then((hit) => hit ?? caches.match(ROOT))
            .then((hit) => hit ?? Response.error()),
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
