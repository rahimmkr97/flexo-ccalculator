// FlexoCalculator — offline app-shell cache.
// Bump CACHE_NAME whenever index.html changes so installed devices pick up the update.
const CACHE_NAME = "flexocalculator-product-v22";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

// App shell: cache-first, so the app still opens with no signal.
// Everything else (fonts, jsPDF, Firebase, Firestore calls): network-first,
// since those need to stay live and shouldn't be served stale.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isShellRequest = url.origin === self.location.origin;

  if (!isShellRequest) return; // let cross-origin requests (fonts/CDN/Firestore) go straight to the network

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
