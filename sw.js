const CACHE = 'food-tracker-v6';
const ASSETS = [
  './', './index.html', './app.js', './config.js', './foods.json', './workouts.json', './manifest.json', './icon.png',
  './fonts/satoshi-400_normal.woff2', './fonts/satoshi-400_italic.woff2',
  './fonts/satoshi-500_normal.woff2', './fonts/satoshi-700_normal.woff2',
  './fonts/cormorant-normal.woff2', './fonts/cormorant-italic.woff2'
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

  // Cross-origin requests (USDA search) are never cached, so don't wrap them in our
  // own-asset timeout/fallback logic — that combination produced a hard network error
  // on any slow response instead of just letting the browser's own fetch behavior run.
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetchWithTimeout(e.request).then(res => {
      if (e.request.method === 'GET') {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
