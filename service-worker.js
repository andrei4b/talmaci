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
 * get the latest deploy, offline users still get the last-seen version.
 *
 * The network attempt is raced against a timeout (see NETWORK_TIMEOUT_MS
 * below) rather than awaited outright. A phone waking from a long sleep
 * often has a connection that stalls instead of failing outright — Wi-Fi or
 * cellular still reconnecting — and a stalled fetch() may not reject for a
 * long time. Without the race, every shell file (the HTML/JS needed just to
 * start rendering) would hang right along with it, leaving the page blank
 * until the connection either recovers or times out on its own — which is
 * exactly the "white screen after being idle a while" symptom this fixes.
 * Force-quitting the app only "fixed" it before by giving the network a
 * fresh attempt once connectivity was actually back. */
const CACHE_NAME = 'talmaci-shell-v76';
const NETWORK_TIMEOUT_MS = 1500;
// The Bible text (~4 MB) and the rhyme index (~5.7 MB) are static, so unlike
// the rest of the shell they are served cache-first: no re-download on every
// cold start, and no waiting on a slow network. A changed file ships by
// bumping CACHE_NAME, which makes install fetch it fresh into the new cache.
const BIBLE_URL = './data/bible-cornilescu.json';
const RHYME_URL = './data/rhyme-index.json';
const CACHE_FIRST = ['/data/bible-cornilescu.json', '/data/rhyme-index.json'];
const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/utils.js',
  './js/firebase-config.js',
  './js/auth.js',
  './js/db.js',
  './js/sections.js',
  './js/translate.js',
  './js/ro-phonetics.js',
  './js/rhyme.js',
  './js/songs.js',
  './js/rime-tab.js',
  './js/sinonime-tab.js',
  './js/bible-tab.js',
  './js/song-detail.js',
  './js/app.js',
  BIBLE_URL,
  RHYME_URL,
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

  const path = new URL(req.url).pathname;
  if (CACHE_FIRST.some(p => path.endsWith(p))) {
    event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE_NAME).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  // cache: 'no-store' bypasses the browser's own HTTP cache, not just this
  // service worker's cache — a plain fetch() can still be served from HTTP
  // cache under the hood depending on GitHub Pages' response headers,
  // silently defeating "network-first" without this.
  //
  // Caching the response is chained off the network fetch itself, not off
  // whichever side of the race below wins — so a slow response that loses
  // the race still updates the cache once it finally arrives, instead of
  // being thrown away.
  const networkFetch = fetch(req, { cache: 'no-store' }).then(res => {
    if (res.ok && res.type === 'basic') {
      caches.open(CACHE_NAME).then(cache => cache.put(req, res.clone()));
    }
    return res;
  }).catch(() => null);

  const timeout = new Promise(resolve => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));

  event.respondWith(
    Promise.race([networkFetch, timeout]).then(res => res || caches.match(req))
  );
});
