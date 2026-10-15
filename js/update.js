/* update.js — moving to a new release without closing the app.
 *
 * An app left open in the background keeps the release it was started
 * with: coming back to it does not load the page again, and the browser
 * looks for a new service-worker.js only on loading a page (and about once
 * a day). So on coming back to the foreground the worker is fetched again
 * here. A deploy bumps its CACHE_NAME, so a new release's worker installs,
 * storing the new page and every file it loads, and takes over (it skips
 * waiting and claims the page — see service-worker.js).
 *
 * The page is then told by the bar at the top, and moves only when its
 * Actualizează is tapped, never on its own: something may be half-written.
 * By then the whole release is stored, so the reload is quick, and even
 * on a stalled network the page it falls back to is the new one.
 *
 * Whether the worker in control is newer is asked of the worker itself,
 * not taken from its taking over: a page loaded off the network after a
 * deploy is already the new release while the worker is still the last
 * one, and the new worker taking over afterwards brings it nothing. The
 * same check runs from the account menu, on demand. */
(function () {
const { el } = window.Utils;
const sw = 'serviceWorker' in navigator ? navigator.serviceWorker : null;

// The release this page is running, read off the ?v= of this script — the
// number bumped with every deploy (see index.html). Shown in the account
// menu, so a phone still running an older release can be told.
const release = (() => {
  const s = document.currentScript;
  const m = s && s.src.match(/[?&]v=(\d+)/);
  return m ? m[1] : '';
})();

// Coming back more often than this does not ask again.
const CHECK_GAP_MS = 60 * 1000;
let _lastCheck = 0;
// The newer release the worker holds, once one is known.
let _newer = 0;
let _bar = null;

// The release a worker holds, or 0 when it does not say (a worker of
// release 149 or earlier, which was never asked).
function _workerRelease(worker) {
  if (!worker) return Promise.resolve(0);
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(0), 3000);
    channel.port1.onmessage = (e) => { clearTimeout(timer); resolve(Number(e.data && e.data.release) || 0); };
    worker.postMessage({ type: 'talmaci-release' }, [channel.port2]);
  });
}

async function _compare(worker) {
  const r = await _workerRelease(worker);
  if (release && r > Number(release)) { _newer = r; _showBar(); }
  return _newer;
}

// Until the worker is in use or has failed to install.
function _settled(worker) {
  return new Promise(resolve => {
    const done = () => { if (worker.state === 'activated' || worker.state === 'redundant') resolve(); };
    worker.addEventListener('statechange', done);
    done();
  });
}

/* Fetches the worker again and waits for a new one to install, then
 * compares. onDownloading is called if there is one, as installing
 * downloads the whole release. Rejects when the worker cannot be fetched
 * (no connection). Resolves with the newer release, or 0. */
async function check(onDownloading) {
  if (_newer) return _newer;
  const reg = sw && await sw.getRegistration();
  if (!reg) return 0;
  _lastCheck = Date.now();
  await reg.update();
  const w = reg.installing || reg.waiting;
  if (w) {
    if (onDownloading) onDownloading();
    await _settled(w);
  }
  return _compare(reg.active);
}

function apply() { location.reload(); }

function newer() { return _newer; }

function _showBar() {
  if (_bar) return;
  _bar = el('div', { class: 'update-bar', role: 'status' }, [
    el('span', { class: 'update-bar__text' }, ['Versiune nouă disponibilă']),
    el('button', { class: 'update-bar__btn', onclick: apply }, ['Actualizează'])
  ]);
  document.body.appendChild(_bar);
  // #app moves down by the bar's height rather than being covered by it.
  document.documentElement.style.setProperty('--update-bar-h', _bar.offsetHeight + 'px');
  document.body.classList.add('has-update-bar');
}

if (sw) {
  sw.addEventListener('controllerchange', () => { _compare(sw.controller); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || _newer) return;
    if (Date.now() - _lastCheck < CHECK_GAP_MS) return;
    check().catch(() => {});
  });
}

window.Update = { release, check, newer, apply };

})();
