/* service-worker.js — app-shell offline caching.
 * Never caches Firebase/Google API traffic (auth, Firestore) — only the
 * static shell, so the app installs fast and opens offline, while data
 * always comes from the network.
 *
 * Network-first, not cache-first: the fetch handler always tries the
 * network and only falls back to the cache when offline. A cache-first
 * strategy sounds more "offline-friendly" but means every shell file
 * (styles.css, the js/*.js files) gets frozen at whatever it was on first
 * install — the browser only re-checks this script for updates when its
 * own bytes change, so editing styles.css/app.js/etc. alone never
 * refreshes what's cached. Network-first fixes that: online users always
 * get the latest deploy, offline users still get the last-seen version. */
const CACHE_NAME = 'talmaci-shell-v29';
const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/utils.js',
  './js/firebase-config.js',
  './js/auth.js',
  './js/db.js',
  './js/translate.js',
  './js/ro-phonetics.js',
  './js/rhyme.js',
  './js/songs.js',
  './js/rime-tab.js',
  './js/sinonime-tab.js',
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
    // cache: 'no-store' bypasses the browser's own HTTP cache, not just
    // this service worker's cache — a plain fetch() can still be served
    // from HTTP cache under the hood depending on GitHub Pages' response
    // headers, silently defeating "network-first" without this.
    fetch(req, { cache: 'no-store' }).then(res => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
