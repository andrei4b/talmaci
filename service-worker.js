/* service-worker.js — app-shell offline caching.
 * Never caches Firebase/Google API traffic (auth, Firestore) — only the
 * static shell, so the app installs fast and opens offline, while data
 * always comes from the network. */
const CACHE_NAME = 'talmaci-shell-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/utils.js',
  './js/firebase-config.js',
  './js/auth.js',
  './js/db.js',
  './js/songs.js',
  './js/song-detail.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function _isBypassed(url) {
  return /googleapis\.com|gstatic\.com|firebaseio\.com|firebaseapp\.com/.test(url);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || _isBypassed(req.url)) return;

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
