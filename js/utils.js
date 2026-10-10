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

window.Utils = { $, $all, el, menuLabel, normalizeUrl, escapeHtml, toast, debounce, copyToClipboard, openSheet, closeSheet, closeSheetThen, icons,
                 songKind, isOriginal, isShared };

})();
