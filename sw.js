self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(fetch(req, { cache: 'reload' }));
  }
});
