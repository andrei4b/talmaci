/* utils.js — small DOM/data helpers shared across the app.
 * Global-IIFE-exposing-a-plain-object pattern, no build step, no imports. */
(function () {

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

window.Utils = { $, $all, el, escapeHtml, toast, debounce };

})();
