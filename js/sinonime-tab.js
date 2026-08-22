/* sinonime-tab.js — the Sinonime tab: dexonline's "Dicționar de sinonime",
 * shown in the app.
 *
 * The page fills the tab and nothing of ours sits over it — dexonline has
 * its own search box, so a second one only got in the way. The one control
 * we add is in the topbar: a reset that returns to the dictionary's front
 * page after you have followed links away from it.
 *
 * The page is not read, parsed or reshaped, which is a decision rather than
 * an omission. dexonline's terms — printed on the page itself — forbid
 * taking data from the site by automated means except through the datasets
 * it publishes for the purpose, and this dictionary is in none of them.
 * Their pages send no CORS header either, so a browser could not fetch one
 * even where the terms allowed. Showing the page is a reader reading their
 * site, and it carries their attribution and their donate link with it.
 */
(function () {
const { el } = window.Utils;

const SOURCE_URL = 'https://dexonline.ro/source/sinonime';

// A house rather than a refresh arrow: the button goes to one particular
// page, it does not reload whatever you are looking at.
const HOME_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/><path d="M9.5 21v-6h5v6"/></svg>`;

let _frame = null;

/* A fresh element rather than reassigning src on the live one. Navigating a
 * frame already in the page pushes onto the joint session history, which
 * would put dexonline in front of the hardware back button — and getting
 * that button to go from a song up to the song list took some care. */
function _newFrame() {
  return el('iframe', {
    class: 'syn__frame',
    src: SOURCE_URL,
    title: 'dexonline — Dicționar de sinonime',
    referrerpolicy: 'no-referrer-when-downgrade'
  });
}

// Back to the dictionary's front page, wherever the frame has wandered to.
// Cross-origin, so its history cannot be read or rewound from here; a new
// frame is the only way back, and it is the behaviour wanted anyway.
function reset() {
  const next = _newFrame();
  if (_frame && _frame.parentNode) _frame.replaceWith(next);
  _frame = next;
}

// Offered to the shell, which puts it in the topbar beside the account menu.
function actions() {
  return [el('button', {
    class: 'btn btn--icon',
    'aria-label': 'Înapoi la dicționar',
    title: 'Înapoi la dicționar',
    html: HOME_ICON,
    onclick: reset
  })];
}

function render(host) {
  if (!_frame) _frame = _newFrame();
  // Only when it is not already there. appendChild on a node that is
  // already a child MOVES it, and a moved iframe is an unmounted one as far
  // as the browser is concerned — it reloads, losing the page you were on.
  // That is the whole reason the layer outlives the render.
  if (_frame.parentNode !== host) host.appendChild(_frame);
  return _frame;
}

window.SinonimeTab = { render, actions, reset };

})();
