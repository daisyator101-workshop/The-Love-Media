// Android only offers "Install app" when the site has a service worker, so this
// one exists to satisfy that check. It deliberately caches nothing: requests fall
// through to the network untouched, which keeps range requests for video working
// and means a new deploy is picked up on the next load instead of being served
// from an old cache.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // No respondWith on purpose: let the browser handle the request normally.
  if (!event.request) return;
});
