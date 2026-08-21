/* utils.js — small DOM/data helpers shared across the app.
 * Global-IIFE-exposing-a-plain-object pattern, no build step, no imports. */
(function () {

// Text glyphs like "←"/"⋮" render inconsistently across devices/fonts
// (different weight, baseline, centering) — SVG icons look the same
// everywhere, matching the tab-bar/row icons already used elsewhere.
const icons = {
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>`,
  kebab: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>`
};

/* A song is either a translation of something or a composition of our own.
 * Songs created before the distinction existed carry no `kind` and are all
 * translations, so the default lives here rather than at each call site. */
function songKind(song) {
  return (song && song.kind === 'original') ? 'original' : 'translation';
}
function isOriginal(song) { return songKind(song) === 'original'; }

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

window.Utils = { $, $all, el, escapeHtml, toast, debounce, copyToClipboard, openSheet, closeSheet, closeSheetThen, icons,
                 songKind, isOriginal };

})();
