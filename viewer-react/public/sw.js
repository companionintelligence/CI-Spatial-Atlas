// Companion Atlas's service worker.
//
// It does two things and nothing else:
//
//   1. It gives the browser the fetch handler some of them still look for before
//      they offer to install the app (public/manifest.webmanifest has the rest).
//   2. When a page load cannot reach the network at all (offline, or the host
//      is down), it answers with /offline/ instead of the browser's error page.
//
// What it deliberately does NOT do, because each of these has stranded visitors on
// a stale build somewhere else, or would hold something it should never hold:
//
//   - It never caches the app. HTML, scripts, styles, Cesium (/cesium/*, which index.html
//     loads as a blocking script, so a cached shell without it could not even start),
//     globe imagery, 3D models and story files all go to the network exactly as they would
//     without a worker, so a deploy is live on the next load and the HTTP cache rules of
//     whatever serves this stay the only cache policy.
//   - It never touches a Companion Memory server, an Atlas API or a Portal sign-in: those
//     are other origins or /memory and /api paths, and a request this worker does not
//     name is left to the browser. There is no list of API paths to forget to extend.
//   - It never writes to the cache after install. The only cache entries are the three
//     files below, fetched once, so no URL a visitor opens (?memory=, ?token=, ?story=)
//     is ever stored.
//
// Retiring it: ship a sw.js that calls self.registration.unregister() and delete the
// registration in src/pwa/registerServiceWorker.ts. Until then an old copy of this file
// is harmless: it serves a static page and nothing else.
//
// Served from the site root so its scope is the whole origin.
//
// A browser fetches the precached files again only when this file changes, and the offline
// page is not fingerprinted, so CACHE carries a fingerprint of them: the first 12 hex digits
// of a sha256 over, for each PRECACHE url in order, the url, a NUL byte, the file's bytes with
// every CR (0x0D) removed, and a NUL byte. The CRs are dropped so that a checkout with CRLF
// line endings (core.autocrlf, an editor that saves them) computes the name Linux and macOS
// CI compute. test/pwa-service-worker.test.ts recomputes it and fails, naming the value to
// paste here, when a precached file changed and this line did not.

const CACHE = 'ci-atlas-offline-301ce18a938e';
const OFFLINE_URL = '/offline/';
const PRECACHE = [OFFLINE_URL, '/offline/offline.css', '/offline/mark.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // `reload`: take the files from the network, not from the HTTP cache.
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
  );
  // Nothing about the app is cached, so there is no build for the new worker to
  // disagree with: it can take over at once.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith('ci-atlas-offline-') && key !== CACHE).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// A navigation answered with a redirected response fails ("a redirected response was
// used for a request whose redirect mode is not 'follow'"). /offline/ is the canonical
// URL on every host this ships to, but a host that redirects it would otherwise break
// the one page this worker exists to serve.
const unredirected = (response) =>
  response.redirected
    ? new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers })
    : response;

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Network first, and the network's answer is final: a 404 or a 500 from a server
    // that did answer is shown as it is. Only a failed request gets the offline page.
    event.respondWith(
      fetch(request).catch(async () => {
        const offline = await caches.match(OFFLINE_URL);
        return offline ? unredirected(offline) : Response.error();
      })
    );
    return;
  }

  // The offline page's own stylesheet and mark, which must load with no network.
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
  }
});
