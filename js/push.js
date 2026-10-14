/* push.js — notifications on this device when someone leaves an
 * observation on a version of a song you are working on.
 *
 * Turned on per device, from the account menu: the browser asks for
 * permission, Firebase Cloud Messaging gives this device a token, and the
 * token is stored under the member, users/{uid}/devices/{token}
 *   { token, at: number (ms) }
 * The token is the document's id too, so a device that turns them on again
 * writes the same document rather than a second one. The sending is done
 * by a Cloud Function (notifyObservation in functions/index.js), which
 * looks these up for everyone on the song's `workers` but the author.
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
 * from time to time; each start compares and stores the new one. */
(function () {

// The key pair's public half, from Firebase console → Project settings →
// Cloud Messaging → Web Push certificates. Public, like the rest of the
// config; empty means the feature is not set up, and the menu leaves it out.
function _vapidKey() { return window.FIREBASE_VAPID_KEY || ''; }

const KEY_PREFIX = 'talmaci.pushToken:';

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

window.Push = { configured, supported, needsInstall, isOn, enable, disable, refresh, forget };

})();
