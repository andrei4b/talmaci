/* utils.js — small DOM/data helpers shared across the app.
 * Global-IIFE-exposing-a-plain-object pattern, no build step, no imports. */
(function () {

// Text glyphs like "←"/"⋮" render inconsistently across devices/fonts
// (different weight, baseline, centering) — SVG icons look the same
// everywhere, matching the tab-bar/row icons already used elsewhere.
const icons = {
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>`,
  kebab: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>`,
  // Kebab-menu item icons — same stroke style as the tab-bar icons.
  refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 4v5h-5"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`,
  headphones: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>`,
  sparkles: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.6L18.5 9.5l-4.7 1.9L12 16l-1.8-4.6L5.5 9.5l4.7-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>`,
  userPlus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>`,
  users: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/></svg>`,
  // The Rime and Sinonime tab icons, shared with the editor's lookup
  // buttons so the two always read as the same destination.
  rime: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>`,
  sinonime: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v14M3 13l4 4 4-4"/><path d="M17 21V7M13 11l4-4 4 4"/></svg>`,
  // An open book — the Biblie tab, and the Bible dictionary in the
  // editor's lookup.
  bible: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5A2.5 2.5 0 0 1 4.5 2H12v18H4.5A2.5 2.5 0 0 0 2 22z"/><path d="M22 4.5A2.5 2.5 0 0 0 19.5 2H12v18h7.5a2.5 2.5 0 0 1 2.5 2z"/></svg>`,
  // A book with an A — the Dicționare tab, and the English dictionary in
  // the editor's lookup.
  dictionary: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/><path d="m8 13 4-7 4 7"/><path d="M9.1 11h5.7"/></svg>`,
  // A clock with a back-arrow — the activity log, in the account menu.
  history: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/></svg>`,
  // A bell — notifications, in the account menu; struck through when off.
  bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
  bellOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8.7 3A6 6 0 0 1 18 8c0 2.8.5 4.9 1.1 6.4"/><path d="M17 17H3s3-2 3-9c0-.8.1-1.5.4-2.2"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/></svg>`,
  // Two sheets, one over the other — a text copied, from a song's menu or
  // above its columns.
  copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>`,
  // A flag — a song's status, in its menu.
  flag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4"/><path d="M4 4h12l-2 4 2 4H4"/></svg>`,
  offline: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2l20 20"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M5 12.9a10 10 0 0 1 5.2-2.8"/><path d="M14.4 10.1A10 10 0 0 1 19 12.9"/><path d="M1.5 9.3a15 15 0 0 1 4.3-2.8"/><path d="M10.7 5.1A15 15 0 0 1 22.5 9.3"/><path d="M12 20h.01"/></svg>`,
  logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>`
};

/* A song is either a translation of something or a composition of our own.
 * Songs created before the distinction existed carry no `kind` and are all
 * translations, so the default lives here rather than at each call site. */
function songKind(song) {
  return (song && song.kind === 'original') ? 'original' : 'translation';
}
function isOriginal(song) { return songKind(song) === 'original'; }

// Visible to the whole group, vs personal. Absent (every song written
// before this existed) defaults to shared — same reasoning as songKind.
function isShared(song) { return !song || song.shared !== false; }

// Where a song stands, from first draft to done — team coordination, set
// by hand. Absent (every song written before this existed) reads as a
// draft, like the defaults above.
const SONG_STATUSES = [
  { id: 'draft',  label: 'Ciornă' },
  { id: 'review', label: 'În revizie' },
  { id: 'final',  label: 'Final' }
];
function songStatus(song) {
  const s = song && song.status;
  return SONG_STATUSES.some(x => x.id === s) ? s : 'draft';
}
function statusLabel(id) {
  return (SONG_STATUSES.find(x => x.id === id) || SONG_STATUSES[0]).label;
}
// Who has said they are working on a song, by uid. Absent means nobody.
function songWorkers(song) {
  return Array.isArray(song && song.workers) ? song.workers : [];
}
// A song's versions in the order they were last arranged in, given them
// oldest first as Db.listVersions brings them. Those the arrangement does
// not name — made since, or before anyone arranged them — keep that order
// after the rest; ids in it of versions since deleted are just skipped.
function orderVersions(song, versions) {
  const order = Array.isArray(song && song.versionOrder) ? song.versionOrder : [];
  const rank = (v) => { const i = order.indexOf(v.id); return i < 0 ? order.length : i; };
  return versions.map((v, i) => ({ v, i }))
    .sort((a, b) => rank(a.v) - rank(b.v) || a.i - b.i)
    .map(x => x.v);
}

function $(sel, root) { return (root || document).querySelector(sel); }
function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (v == null || v === false) return;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  });
  // Chrome's address/payment autofill suggestion bar otherwise pops up over
  // sheet buttons on any text input inside a modal — off by default unless
  // a caller explicitly opts in.
  if ((tag === 'input' || tag === 'textarea') && !node.hasAttribute('autocomplete')) {
    node.setAttribute('autocomplete', 'off');
  }
  (children || []).forEach(c => {
    if (c == null) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

let _toastTimer = null;
function toast(message, opts) {
  const root = $('#toast-root');
  if (!root) return;
  root.innerHTML = '';
  const kind = (opts && opts.kind) || 'info';
  root.appendChild(el('div', { class: `toast toast--${kind}` }, [message]));
  root.classList.add('toast-root--visible');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => root.classList.remove('toast-root--visible'), 2600);
}

function debounce(fn, wait) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const ta = el('textarea', { style: 'position:fixed;left:-9999px' });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    ta.remove();
    return ok;
  }
}

/* Copies, and says so — unless Android already does: from Android 13 it
 * shows its own "Copied" whenever text reaches the clipboard, and a toast
 * of ours beside it said the same thing twice. Browsers no longer tell
 * which Android it is (every one reads as 10), so the older ones, which
 * say nothing, go without. A failure is always told. */
const OS_TELLS_COPIED = /Android/i.test(navigator.userAgent);
async function copyWithToast(text, done) {
  const ok = await copyToClipboard(text);
  if (!ok) toast('Nu am putut copia.', { kind: 'error' });
  else if (!OS_TELLS_COPIED) toast(done);
  return ok;
}

// ---- Sheet/modal stack + hardware back button support (same pattern as
// worship-setlist) ----
// Opening a sheet pushes a history entry, so the phone's back button or
// swipe-back gesture closes it instead of leaving the page/app. Closing it
// ourselves (Anulează, tapping the backdrop, a completed action) consumes
// that entry with history.back() — _skipNextPopstates tells the popstate
// listener the resulting event is our own doing, not a real back press, so
// it doesn't try to close the sheet a second time.
const _sheetStack = [];
let _skipNextPopstates = 0;

function openSheet(sheetEl) {
  document.body.appendChild(sheetEl);
  _sheetStack.push(sheetEl);
  history.pushState({ sheet: true }, '');
}

function closeSheet(sheetEl, _fromPopstate) {
  const idx = _sheetStack.lastIndexOf(sheetEl);
  if (idx !== -1) _sheetStack.splice(idx, 1);
  sheetEl.remove();
  if (!_fromPopstate) {
    _skipNextPopstates++;
    history.back();
  }
}

/* Close a sheet and then go somewhere, in that order.
 *
 * closeSheet unwinds the sheet's history entry with history.back(), which
 * is asynchronous: assigning location.hash straight afterwards looks like
 * it works, then the pop lands and puts the old route back. Saving a song
 * with no source text did exactly that and stayed on the list, and a
 * composition takes that path every time.
 *
 * So the navigation waits for the pop it is racing with. */
function closeSheetThen(sheetEl, fn) {
  if (_sheetStack.lastIndexOf(sheetEl) === -1) { fn(); return; }   // already closed
  window.addEventListener('popstate', () => fn(), { once: true });
  closeSheet(sheetEl);
}

window.addEventListener('popstate', () => {
  if (_skipNextPopstates > 0) { _skipNextPopstates--; return; }
  if (_sheetStack.length) {
    closeSheet(_sheetStack[_sheetStack.length - 1], true);
  }
});

// A demo link as typed by a person: trims, adds https:// when no scheme was
// typed, and accepts only http(s) so a saved link can never be a javascript:
// URL. Returns '' for empty input and null for something that isn't a link.
function normalizeUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : 'https://' + raw;
  try {
    const u = new URL(withScheme);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.') ? u.href : null;
  } catch (_) { return null; }
}

// Content for a kebab-menu button: icon, then label. Pairs with .btn--menu.
function menuLabel(icon, text) {
  return [el('span', { class: 'menu-ico', html: icon, 'aria-hidden': 'true' }), el('span', {}, [text])];
}

/* ---- no connection ----
 * Firestore, the Cloud Functions and dexonline need the network. The app
 * itself, the Bible and the rhyme index do not: the service worker keeps
 * them. navigator.onLine is only believed when it says offline — "online"
 * means a network is attached, not that it reaches anything — so a request
 * that failed for want of a connection is also told by its error. */
const OFFLINE_HINT = 'Rimele și Biblia merg și fără internet.';

function isOffline() { return navigator.onLine === false; }

// Thrown before a request that cannot succeed. Firestore would otherwise
// wait: a read gives up only after about ten seconds, and a write is held
// until the connection is back, leaving whatever awaits it hanging.
function requireOnline() {
  if (!isOffline()) return;
  const err = new Error('Nu ai conexiune la internet.');
  err.code = 'offline';
  throw err;
}

function isNetworkError(err) {
  if (isOffline()) return true;
  const code = String((err && err.code) || '');
  return code === 'offline' || code === 'unavailable' || code === 'functions/unavailable' ||
    /failed to fetch|networkerror|load failed|network.request.failed|client is offline/i.test((err && err.message) || '');
}

// "Nu am putut salva textul: …", with the reason in words when it is the
// connection rather than the SDK's English.
function failText(what, err) {
  return what + ': ' + (isNetworkError(err) ? 'nu ai conexiune la internet.' : ((err && err.message) || String(err)));
}

/* What a screen shows in place of what it could not load. With `retry`,
 * that is run again when the connection comes back, if the notice is still
 * on screen, and offered as a button for when the browser never notices
 * that it went (a network that is attached but reaches nothing). */
function offlineNotice(opts) {
  const o = opts || {};
  const node = el('div', { class: 'empty-state offline' }, [
    el('span', { class: 'offline__icon', html: icons.offline, 'aria-hidden': 'true' }),
    el('p', {}, [o.text || 'Nu ai conexiune la internet.']),
    el('p', { class: 'empty-state__hint' }, [o.hint || OFFLINE_HINT]),
    o.retry ? el('button', { class: 'btn', onclick: () => o.retry() }, ['Încearcă din nou']) : null
  ]);
  if (o.retry) {
    window.addEventListener('online', () => { if (node.isConnected) o.retry(); }, { once: true });
  }
  return node;
}

window.Utils = { $, $all, el, menuLabel, normalizeUrl, escapeHtml, toast, debounce, copyToClipboard, copyWithToast, openSheet, closeSheet, closeSheetThen, icons,
                 songKind, isOriginal, isShared, SONG_STATUSES, songStatus, statusLabel, songWorkers, orderVersions,
                 OFFLINE_HINT, isOffline, requireOnline, isNetworkError, failText, offlineNotice };

})();
