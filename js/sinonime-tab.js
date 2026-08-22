/* sinonime-tab.js — the Sinonime tab: dexonline's synonym dictionary, shown
 * in the app.
 *
 * There is no local index and no search field of our own. Both were tried
 * and both were worse than the thing they stood in for: the synonym data
 * that can actually be redistributed — RoWordNet, and dexonline's own
 * Relation table — gives thin, noisy lists, while the dictionary worth
 * reading, Seche's "Dicționar de sinonime", is in neither of dexonline's
 * distributable channels and cannot be shipped. Its page can be opened,
 * though, and dexonline carries a search box of its own, so a second one
 * here would only be in the way.
 *
 * Nothing is taken or copied. The page is served by dexonline straight to
 * the reader, with its own attribution and its own funding intact.
 *
 * The frame is built once and kept, then re-attached on later renders. The
 * other tabs hold their state across a trip to the Text tab and this one
 * should too — rebuilding the element would reload dexonline and throw away
 * whatever you had looked up.
 *
 * Nothing of ours sits around it: no toolbar, no "open in browser". The
 * page is the tab.
 */
(function () {
const { el } = window.Utils;

const START_URL = 'https://dexonline.ro/source/sinonime';

let _frame = null;

function render(host) {
  if (!_frame) {
    _frame = el('iframe', {
      class: 'syn__frame',
      src: START_URL,
      title: 'dexonline — Dicționar de sinonime',
      referrerpolicy: 'no-referrer-when-downgrade'
    });
  }
  host.appendChild(_frame);
  return _frame;
}

window.SinonimeTab = { render };

})();
