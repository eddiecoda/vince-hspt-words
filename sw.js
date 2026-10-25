/* Service worker: makes the app installable and usable offline.
   Only same-origin GET requests inside this app's folder are handled. Everything else (formsubmit.co, any cross-origin
   request, POSTs) is never intercepted or cached, so the daily words log goes straight to the network as before.
   index.html / words.json (and other HTML) are network-first so new words always come through; other app files are cache-first. */
var VERSION = '2026-10-25-pwa1';
var CACHE = 'vince-hspt-words-' + VERSION;
var SHELL = ['./', 'index.html', 'style.css', 'app.js', 'srs.js', 'wordlog.js', 'words.json', 'manifest.json',
  'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL.map(function (u) { return new Request(u, { cache: 'reload' }); })); })
    .catch(function () {}).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('vince-hspt-words-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function networkFirst(req, key) {
  return fetch(req).then(function (res) {
    if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(key, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(key, { ignoreSearch: true }).then(function (hit) { return hit || Response.error(); });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                       // POSTs (e.g. the words log) are never touched
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;         // never intercept formsubmit.co or any cross-origin request
  var scope = new URL(self.registration.scope);
  if (url.pathname.indexOf(scope.pathname) !== 0) return;  // stay inside this app's folder
  var path = url.pathname.slice(scope.pathname.length);
  if (req.mode === 'navigate' || path === '' || path === 'index.html') {
    e.respondWith(networkFirst(req, 'index.html'));
    return;
  }
  if (path === 'words.json') {
    e.respondWith(networkFirst(req, 'words.json'));        // app.js adds ?v=Date.now(); cached copy is the offline fallback
    return;
  }
  e.respondWith(caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (res) {
      if (res && res.ok && res.type === 'basic') { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    });
  }));
});
