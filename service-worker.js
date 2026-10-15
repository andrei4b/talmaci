/* service-worker.js — app-shell offline caching.
 * Never caches Firebase/Google API traffic (auth, Firestore) — only the
 * static shell (plus the Firebase SDK and Google Fonts it loads), so the
 * app installs fast and opens offline, while data always comes from the
 * network.
 *
 * Network-first, not cache-first: the fetch handler always tries the
 * network and only falls back to the cache when offline. A cache-first
 * strategy sounds more "offline-friendly" but means every shell file
 * (styles.css, the js/*.js files) gets frozen at whatever it was on first
 * install — the browser only re-checks this script for updates when its
 * own bytes change, so editing styles.css/app.js/etc. alone never
 * refreshes what's cached. Network-first fixes that: online users always
 * get the latest deploy, offline users still get the last-seen version.
 * The app's own scripts and stylesheet are now the exception: their URLs
 * carry the release (?v=), so it is the page that decides which release
 * runs, and the stored copy of each is served first — see the fetch handler.
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
// The release, also in the ?v= of every app file index.html loads — bump
// the two together (see index.html).
const CACHE_NAME = 'talmaci-shell-v156';
const NETWORK_TIMEOUT_MS = 1500;
// The Bible text (~4 MB) and the rhyme index (~5.7 MB) are static, so unlike
// the rest of the shell they are served cache-first: no re-download on every
// cold start, and no waiting on a slow network. They are kept in a cache of
// their own that a new CACHE_NAME leaves alone, so a release of the app
// downloads only the app's files — a few hundred KB rather than ten MB — and
// the Actualizează bar (js/update.js), which waits for that download, comes
// up in seconds. Bump DATA_CACHE when either file is rebuilt: install then
// fetches both afresh into the new cache, and activation drops the old one.
const DATA_CACHE = 'talmaci-data-v1';
const DATA_FILES = ['./data/bible-cornilescu.json', './data/rhyme-index.json'];
const CACHE_FIRST = ['/data/bible-cornilescu.json', '/data/rhyme-index.json'];
// Up to this release the two were stored in each release's own cache.
const LAST_RELEASE_WITH_DATA = 152;
// The Bible dictionaries (data/biblic/) are 28 MB in all, far too much to
// install up front, so their chunks are cached as they are opened — in a
// cache of their own that a new CACHE_NAME leaves alone, so a deploy does
// not throw away every entry read so far. Bump this when they are rebuilt.
const BIBLIC_CACHE = 'talmaci-biblic-v1';
const BIBLIC_PATH = '/data/biblic/';
// Caches the page keeps for itself, which activation must leave alone like
// BIBLIC_CACHE: the English dictionary's looked-up words (js/engleza-tab.js).
const PAGE_CACHE_PREFIX = 'talmaci-mw-';
// The page itself, its stylesheet and its scripts are not listed here:
// install reads them off index.html (see _cacheShell), so what is stored is
// always exactly the set of URLs that page asks for, ?v= and all.
const SHELL_FILES = [
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

/* Stores index.html and the app files it loads, as one release. The same
 * copy of the page is stored that the file list was read from, so the
 * cached page and its files can't come from two different deploys. */
async function _cacheShell(cache) {
  const res = await fetch('./index.html', { cache: 'no-store' });
  if (!res.ok) throw new Error('index.html: ' + res.status);
  const html = await res.text();
  const files = [...html.matchAll(/(?:src|href)="(\.\/(?:js\/[^"]+|styles\.css[^"]*))"/g)].map(m => m[1]);
  await cache.addAll(files.map(f => new Request(f, { cache: 'no-store' })));
  const page = () => new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  await Promise.all([cache.put('./', page()), cache.put('./index.html', page())]);
}

/* Stores the Bible and the rhyme index in DATA_CACHE, downloading only what
 * it lacks — so after the first install, normally nothing. A phone coming
 * from release LAST_RELEASE_WITH_DATA or earlier has both in that release's
 * cache, the same files, and they are copied from there rather than
 * downloaded once more. */
async function _cacheData() {
  const cache = await caches.open(DATA_CACHE);
  const older = (await caches.keys()).filter(k => {
    const m = k.match(/^talmaci-shell-v(\d+)$/);
    return m && Number(m[1]) <= LAST_RELEASE_WITH_DATA;
  });
  await Promise.all(DATA_FILES.map(async (url) => {
    if (await cache.match(url)) return;
    for (const name of older) {
      const hit = await (await caches.open(name)).match(url);
      if (hit) return cache.put(url, hit);
    }
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(url + ': ' + res.status);
    await cache.put(url, res);
  }));
}

// The Firebase SDK is cross-origin and needed to render anything at all
// (its <script> tags block parsing), so it's precached up front too, rather
// than only once it's first fetched. cache.addAll() rejects opaque (no-cors)
// responses, so these are fetched and stored by hand — and best-effort, so a
// gstatic hiccup never fails the whole install. Keep in sync with the
// <script> tags in index.html.
const CDN_FILES = [
  'https://www.gstatic.com/firebasejs/11.1.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/11.1.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/11.1.0/firebase-functions-compat.js',
  'https://www.gstatic.com/firebasejs/11.1.0/firebase-messaging-compat.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.all([
        cache.addAll(SHELL_FILES),
        _cacheShell(cache),
        _cacheData(),
        // Each URL names its SDK version, so a copy the last release
        // stored is the same file, and is carried over rather than fetched.
        ...CDN_FILES.map(url =>
          caches.match(url)
            .then(hit => hit || fetch(new Request(url, { mode: 'no-cors' })))
            .then(res => cache.put(url, res)).catch(() => {})
        )
      ]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k !== CACHE_NAME && k !== DATA_CACHE && k !== BIBLIC_CACHE && !k.startsWith(PAGE_CACHE_PREFIX))
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Static, versioned cross-origin assets: the Firebase SDK and Google Fonts
// (stylesheet + font files). Checked before _isBypassed, which would
// otherwise send them straight to the network like the API traffic.
function _isCdnAsset(url) {
  return url.startsWith('https://www.gstatic.com/firebasejs/') ||
    /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url);
}

function _isBypassed(url) {
  return /googleapis\.com|gstatic\.com|firebaseio\.com|firebaseapp\.com/.test(url);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Cache-first for the CDN assets — immutable once fetched, so there's no
  // freshness to chase. They used to be bypassed entirely, which left them
  // as the one part of a cold start with no cache and no timeout: the SDK
  // scripts block parsing and the fonts stylesheet blocked first paint, so
  // a stalled connection held the page blank white on them alone. The
  // scripts are plain <script> tags (no crossorigin attribute), so their
  // responses are opaque (status 0) and must be cached anyway. A cache miss
  // is raced against the same timeout as the shell, for the same reason.
  if (_isCdnAsset(req.url)) {
    event.respondWith(caches.match(req).then(hit => {
      if (hit) return hit;
      const networkFetch = fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => null);
      const timeout = new Promise(resolve => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));
      return Promise.race([networkFetch, timeout]).then(res => res || Response.error());
    }));
    return;
  }

  if (_isBypassed(req.url)) return;

  const path = new URL(req.url).pathname;
  if (path.includes(BIBLIC_PATH)) {
    event.respondWith(caches.open(BIBLIC_CACHE).then(cache => cache.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }))));
    return;
  }
  if (CACHE_FIRST.some(p => path.endsWith(p))) {
    event.respondWith(caches.open(DATA_CACHE).then(cache => cache.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }))));
    return;
  }

  // An app file of one release (?v=, see index.html): its stored copy is
  // that release's file, so it comes first, and the network only when there
  // is none. Network-first would break the release apart: GitHub Pages
  // ignores the query and answers every ?v= with the newest file, so a page
  // of the last release — served from the cache when it missed its window
  // on a slow start — ran the new release's code. For the same reason only
  // install stores these, never this handler: a newer file must not be
  // stored under an older release's URL.
  if (/[?&]v=\d/.test(new URL(req.url).search) && (path.includes('/js/') || path.endsWith('/styles.css'))) {
    event.respondWith(caches.match(req).then(hit => hit || fetch(req, { cache: 'no-store' })));
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

  // Past the timeout, the stored copy — but only of this very URL. A file
  // of a release not stored yet (a new page, loaded while the worker still
  // holds the last one) has none, and then the network is waited for
  // rather than failing: it is the only place that file can come from.
  event.respondWith(
    Promise.race([networkFetch, timeout])
      .then(res => res || caches.match(req).then(hit => hit || networkFetch))
      .then(res => res || Response.error())
  );
});

// The page asks which release this worker holds (see js/update.js), to
// tell whether it is newer than the one the page is running.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'talmaci-release' && event.ports[0]) {
    event.ports[0].postMessage({ release: Number(CACHE_NAME.match(/\d+$/)[0]) });
  }
});

/* Notifications — about a song this member is working on: an observation
 * left, its text edited, a version added, its status changed, someone
 * joining (see js/push.js and functions/index.js). Firebase Cloud
 * Messaging delivers them as data only, { data: {...} }, and they are
 * shown here. Every push is shown: Safari takes the permission away from
 * a site whose pushes show nothing. A tag from the sender would make a
 * new one replace the last, but none is sent any more: on a Mac the
 * replacement comes in silently. An observation's carries its versionId,
 * and tapping it opens that version's. */
self.addEventListener('push', (event) => {
  let d = {};
  try { d = (event.data && event.data.json() || {}).data || {}; } catch (_) {}
  const title = d.title || 'Tălmaci';
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || 'O observație nouă.',
    icon: './icons/icon-192.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { hash: !d.songId ? '#/'
      : d.versionId ? `#/song/${encodeURIComponent(d.songId)}/notes/${encodeURIComponent(d.versionId)}`
      : `#/song/${encodeURIComponent(d.songId)}` }
  }));
});

// To the song, with the version's observations open: in a window of the
// app already open, if there is one, without loading it again.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const hash = (event.notification.data && event.notification.data.hash) || '#/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find(w => w.url.startsWith(self.registration.scope));
    if (win) {
      win.postMessage({ type: 'talmaci-open', hash });
      return win.focus();
    }
    return self.clients.openWindow(new URL('./' + hash, self.registration.scope).href);
  })());
});
