const CACHE = 'food-tracker-v4';
const ASSETS = [
  './', './index.html', './app.js', './foods.json', './manifest.json', './icon.png',
  './fonts/satoshi-400_normal.woff2', './fonts/satoshi-400_italic.woff2',
  './fonts/satoshi-500_normal.woff2', './fonts/satoshi-700_normal.woff2'
];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

function fetchWithTimeout(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('network timeout')), NETWORK_TIMEOUT_MS);
    fetch(request).then(res => { clearTimeout(timer); resolve(res); }, err => { clearTimeout(timer); reject(err); });
  });
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const isOwnAsset = url.origin === self.location.origin;

  e.respondWith(
    fetchWithTimeout(e.request).then(res => {
      // Only cache our own static assets — not third-party API responses, which
      // shouldn't be served stale and would otherwise grow the cache unbounded.
      if (isOwnAsset && e.request.method === 'GET') {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
