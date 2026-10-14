/* push.js — notifications on this device about the songs you are working
 * on: an observation left, the text edited, a version added, the status
 * changed, someone joining (see functions/index.js for what is sent).
 *
 * Turned on per device, from the account menu: the browser asks for
 * permission, Firebase Cloud Messaging gives this device a token, and the
 * token is stored under the member, users/{uid}/devices/{token}
 *   { token, at: number (ms) }
 * The token is the document's id too, so a device that turns them on again
 * writes the same document rather than a second one. The sending is done
 * by a Cloud Function (notifySongActivity in functions/index.js), which
 * looks these up for everyone on the song's `workers` but whoever made the
 * change.
 *
 * The messages carry data only, and the app's own service worker shows
 * them (see its 'push' handler) — there is no firebase-messaging-sw.js.
 *
 * On iPhone and iPad a page can only receive them once installed to the
 * Home Screen (iOS 16.4 or later); in a Safari tab PushManager is absent,
 * and the menu says so instead of offering the switch.
 *
 * Whether this device has them on is remembered in localStorage, per
 * member, with the token it was given. Firebase may hand out a new token
 * from time to time; each start compares and stores the new one.
 *
 * They are also offered (see offer) when a member marks themselves as
 * working on a shared song, the moment they start to matter: our own sheet
 * first, and the browser's prompt only from its button. The browser's
 * prompt, once refused, can never be shown again, and one shown unasked
 * is refused far more often — Chrome goes on to hide a site's prompts. */
(function () {
const { el, toast, openSheet, closeSheet, failText } = window.Utils;

// The key pair's public half, from Firebase console → Project settings →
// Cloud Messaging → Web Push certificates. Public, like the rest of the
// config; empty means the feature is not set up, and the menu leaves it out.
function _vapidKey() { return window.FIREBASE_VAPID_KEY || ''; }

const KEY_PREFIX = 'talmaci.pushToken:';
// When the offer was last answered "Nu acum" on this device, per member,
// or 'off' once they turned them off in the menu, after which it is never
// made again: the menu is where they will look for them.
const ASKED_PREFIX = 'talmaci.pushAsked:';
const ASK_AGAIN_MS = 30 * 24 * 3600 * 1000;

function _asked(uid) {
  try { return localStorage.getItem(ASKED_PREFIX + uid) || ''; } catch (_) { return ''; }
}
function _setAsked(uid, value) {
  try { localStorage.setItem(ASKED_PREFIX + uid, value); } catch (_) {}
}

function _stored(uid) {
  try { return localStorage.getItem(KEY_PREFIX + uid) || ''; } catch (_) { return ''; }
}
function _store(uid, token) {
  try {
    if (token) localStorage.setItem(KEY_PREFIX + uid, token);
    else localStorage.removeItem(KEY_PREFIX + uid);
  } catch (_) {}
}

function _devicesRef(uid) {
  return firebase.firestore().collection('users').doc(uid).collection('devices');
}

function configured() { return !!_vapidKey() && !!firebase.messaging; }

// Whether this browser can receive them at all as it is now running.
function supported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// An iPhone or iPad in a Safari tab, which could once installed.
function needsInstall() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && !supported();
}

function isOn() {
  const user = window.Auth.currentUser();
  return !!(user && _stored(user.uid)) && supported() && Notification.permission === 'granted';
}

async function _token() {
  const registration = await navigator.serviceWorker.ready;
  return firebase.messaging().getToken({ vapidKey: _vapidKey(), serviceWorkerRegistration: registration });
}

async function _save(uid, token) {
  await _devicesRef(uid).doc(token).set({ token, at: Date.now() });
  _store(uid, token);
}

/* Called from a tap, which iOS requires for the permission prompt. Throws
 * with a message for the member when they cannot be turned on. */
async function enable() {
  window.Utils.requireOnline();
  const user = window.Auth.currentUser();
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'Notificările sunt blocate pentru aplicație. Le poți permite din setările browserului sau ale telefonului.'
      : 'Nu ai permis notificările.');
  }
  const token = await _token();
  if (!token) throw new Error('Nu am primit un identificator de la Firebase.');
  await _save(user.uid, token);
}

async function disable() {
  window.Utils.requireOnline();
  const user = window.Auth.currentUser();
  const token = _stored(user.uid);
  if (token) await _devicesRef(user.uid).doc(token).delete();
  _store(user.uid, '');
  _setAsked(user.uid, 'off');
  try { await firebase.messaging().deleteToken(); } catch (_) { /* gone already */ }
}

/* On each start: a device that has them on keeps its stored token current.
 * Permission taken back in the settings meanwhile turns them off here too. */
async function refresh() {
  const user = window.Auth.currentUser();
  if (!user || !configured() || !_stored(user.uid) || window.Utils.isOffline()) return;
  try {
    if (!supported() || Notification.permission !== 'granted') {
      await _devicesRef(user.uid).doc(_stored(user.uid)).delete();
      _store(user.uid, '');
      return;
    }
    const token = await _token();
    if (token && token !== _stored(user.uid)) {
      await _devicesRef(user.uid).doc(_stored(user.uid)).delete().catch(() => {});
      await _save(user.uid, token);
    }
  } catch (_) { /* tried again at the next start */ }
}

/* Before signing out, so the next account on this device does not get the
 * last one's notifications. Never in the way of signing out. */
async function forget() {
  const user = window.Auth.currentUser();
  if (!user || !_stored(user.uid)) return;
  try { await disable(); } catch (_) { _store(user.uid, ''); }
}

// A tap on a notification while the app is open: the worker asks the page
// to go to the song rather than loading it again.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'talmaci-open' && typeof e.data.hash === 'string') {
      location.hash = e.data.hash;
    }
  });
}

/* After a member marks themselves as working on a shared song. Nothing
 * when they are on here already, when the browser has them blocked (it
 * would not ask), or when the offer was answered lately. */
function offer() {
  const user = window.Auth.currentUser();
  if (!user || !configured() || isOn()) return;
  const asked = _asked(user.uid);
  if (asked === 'off' || (asked && Date.now() - Number(asked) < ASK_AGAIN_MS)) return;
  const install = needsInstall();
  if (!install && (!supported() || Notification.permission === 'denied')) return;

  const later = () => { _setAsked(user.uid, String(Date.now())); closeSheet(overlay); };
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) later(); } });
  const actions = install
    ? [el('button', { class: 'btn btn--primary', onclick: later }, ['Am înțeles'])]
    : [
        el('button', { class: 'btn', onclick: later }, ['Nu acum']),
        el('button', {
          class: 'btn btn--primary',
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            try {
              await enable();
              closeSheet(overlay);
              toast('Notificările sunt pornite pe acest dispozitiv.');
            } catch (err) {
              // Refused at the browser's prompt, which will not ask again:
              // neither does this. Closed without an answer, or a failure
              // after it, it is asked again later, like "Nu acum".
              _setAsked(user.uid, Notification.permission === 'denied' ? 'off' : String(Date.now()));
              closeSheet(overlay);
              toast(failText('Nu am putut porni notificările', err), { kind: 'error' });
            }
          }
        }, ['Activează'])
      ];
  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Vrei să afli ce se schimbă la melodiile tale?']),
    el('p', { class: 'sheet__text' }, [install
      ? 'Pe iPhone, notificările merg doar din aplicația adăugată pe ecranul principal: Partajează → Adaugă pe ecranul principal. Apoi le pornești din meniul contului.'
      : 'Îți trimitem o notificare când, la o melodie la care lucrezi, cineva lasă o observație, îți răspunde sau îți dă o inimă, adaugă o versiune, schimbă starea, i se alătură sau editează textul (editările, cel mult o dată pe oră). Le poți opri oricând din meniul contului.']),
    el('div', { class: 'sheet__actions' }, actions)
  ]));
  openSheet(overlay);
}

window.Push = { configured, supported, needsInstall, isOn, enable, disable, refresh, forget, offer };

})();
