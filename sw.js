/*
 * Service worker — מאפשר שימוש אופליין ו"התקנה" כאפליקציה.
 * שומר במטמון רק את הקבצים הסטטיים של האתר עצמו. לא נוגע בנתונים (הם ב-IndexedDB, מוצפנים).
 * שם המטמון עם קידומת ייחודית, כי כמה פרויקטים ב-github.io חולקים את אותו origin.
 */
'use strict';
var PREFIX = 'matzpen-fin-v1-';
var CACHE = PREFIX + '1.0.0';
var ASSETS = [
  './', './index.html', './core.js', './app.js', './vendor/chart.umd.min.js', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf(PREFIX) === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// stale-while-revalidate: עונים מהמטמון מיד, ומעדכנים ברקע מהשרת של האתר עצמו
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var scope = self.registration.scope;
  if (req.url.indexOf(scope) !== 0) return;
  e.respondWith(caches.open(CACHE).then(function (cache) {
    return cache.match(req, { ignoreSearch: true }).then(function (cached) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      }).catch(function () { return cached || (req.mode === 'navigate' ? cache.match('./index.html') : undefined); });
      return cached || net;
    });
  }));
});
