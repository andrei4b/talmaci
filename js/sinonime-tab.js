/* sinonime-tab.js — the Sinonime tab: dexonline's "Dicționar de sinonime",
 * one word at a time.
 *
 * A search field of ours, matching the song list's and the Rime tab's down
 * to the class, and under it dexonline's own page for whatever is typed.
 *
 * The results are not read, parsed or reshaped, and that is deliberate
 * rather than lazy. dexonline's terms — printed on the page itself —
 * forbid taking data from the site by automated means, excepting the
 * datasets it publishes for the purpose, and this dictionary is in none of
 * them. Their page also sends no CORS header, so a browser could not fetch
 * it even if the terms allowed. Showing it is a reader reading their site,
 * which is what it is for, and it carries their attribution and their
 * donate link along with it.
 *
 * Empty field lands on the dictionary's own page, which is a reasonable
 * thing to look at while deciding what to search for.
 */
(function () {
const { el, debounce } = window.Utils;

const SOURCE_URL = 'https://dexonline.ro/source/sinonime';
const WORD_URL = 'https://dexonline.ro/definitie-sinonime/';

let _query = '';
let _frame = null;

function _urlFor(word) {
  const w = (word || '').trim();
  return w ? WORD_URL + encodeURIComponent(w) : SOURCE_URL;
}

/* Build a fresh iframe rather than reassigning src on the one already in
 * the page. Navigating a live frame pushes onto the joint session history,
 * which would put every word searched in front of the hardware back button
 * — and getting back out of the app to the song list took some care to fix.
 * A new element carrying its src from birth adds nothing to history. */
function _frameFor(word) {
  return el('iframe', {
    class: 'syn__frame',
    src: _urlFor(word),
    title: 'dexonline — Dicționar de sinonime',
    referrerpolicy: 'no-referrer-when-downgrade'
  });
}

function _show(word) {
  const next = _frameFor(word);
  if (_frame && _frame.parentNode) _frame.replaceWith(next);
  _frame = next;
}

function render(host) {
  const input = el('input', {
    class: 'search-bar__input',
    type: 'search',
    placeholder: 'Scrie un cuvânt…',
    value: _query,
    oninput: debounce((e) => {
      _query = e.target.value;
      _show(_query);
    }, 400)
  });
  host.appendChild(el('div', { class: 'search-bar' }, [input]));

  // Reuse the frame across tab switches when it is already showing the
  // right word, so a glance at the Text tab does not reload dexonline.
  if (!_frame || _frame.getAttribute('src') !== _urlFor(_query)) {
    _frame = _frameFor(_query);
  }
  host.appendChild(_frame);
  return _frame;
}

window.SinonimeTab = { render };

})();
