// atlas:service-worker-kill-switch
//
// Companion Atlas's service worker kill switch.
//
// To retire the worker from every browser that installed it:
//
//   1. copy this file over viewer-react/public/sw.js;
//   2. delete the registerServiceWorker() call, and its import, from viewer-react/src/main.tsx;
//   3. deploy, and leave it in place for weeks.
//
// Nothing else has to change. The first line above is how viewer-react/scripts/check-pwa.mjs (so
// `npm run build`, the image build and the deploy workflow) and the unit tests recognise this
// file: with it as public/sw.js they stop requiring what it has none of on purpose (an offline
// page, a precache list, a cache fingerprint, a registration in the bundle). The manifest and the
// head tags are still checked.
//
// Reverting the commit that added the worker is NOT enough. With /sw.js gone, a browser's update
// check gets a 404, the update fails, and the old worker stays installed and keeps answering page
// loads. A worker only goes away when the browser finds a new /sw.js that removes it, and a
// browser looks for one on a later visit, so the file has to stay up until every returning
// visitor has been seen.
//
// This worker has no fetch handler, so while it is installed every request goes straight to the
// network. On activation it deletes the offline caches (ci-atlas-offline-*) and unregisters
// itself. viewer-react/test/pwa-service-worker.test.ts runs this file, so it cannot rot unnoticed.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('ci-atlas-offline-')).map((key) => caches.delete(key))))
      .then(() => self.registration.unregister())
  );
});
