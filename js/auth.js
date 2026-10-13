/* auth.js — Firebase Authentication + user profile (role, group).
 *
 * Follows the same global-IIFE-exposing-a-plain-object pattern as utils.js.
 * Depends on the Firebase compat SDK (firebase-app/auth/firestore) and
 * window.FIREBASE_CONFIG being loaded first (see index.html script order).
 *
 * A signed-in user is only "in the app" once they have a /users/{uid} profile
 * doc, which carries their role ('admin'|'user') and groupId. A brand-new
 * sign-in has no profile until they redeem an invite code, joining as a
 * regular user of that group — there is no self-serve way to create a new
 * group; the app owner does that by hand (Firebase console / a script). */
(function () {

firebase.initializeApp(window.FIREBASE_CONFIG);
const auth = firebase.auth();
const fs = firebase.firestore();

// Firestore keeps what it has read on the device, in IndexedDB, so a song
// opened once can be opened again offline, and a change made offline waits
// there — across a restart of the app — until the connection is back. It
// has to be asked for before Firestore is first used, which is here;
// _loadProfile, the first use, waits for it. synchronizeTabs lets two tabs
// share the copy rather than the second being refused it. Where IndexedDB
// is unavailable (some private modes) it is refused, and Firestore keeps to
// memory, as before.
//
// Signing out marks the copy to be cleared (see signOut), and it is cleared
// here, at the next start, before anything has opened it — clearing it in
// a running page means shutting Firestore down first, and a page whose
// reload did not follow was left signing the next account in with no
// Firestore at all. If it is still in use (another tab of the app), this
// start goes without it, from memory, and the next one tries again: opening
// it now would wait on that clearing for as long as the other tab is open.
const CLEAR_KEY = 'talmaci.clearDeviceCopy';
const CLEAR_TIMEOUT_MS = 3000;
let _persistent = false;
const _persistence = (async () => {
  if (_flagged(CLEAR_KEY)) {
    const cleared = await _withTimeout(fs.clearPersistence(), CLEAR_TIMEOUT_MS).then(() => true, () => false);
    if (!cleared) return false;
    try {
      localStorage.removeItem(CLEAR_KEY);
      // What db.js noted about the copy went with it.
      Object.keys(localStorage).filter(k => k.startsWith('talmaci.songsSynced:')).forEach(k => localStorage.removeItem(k));
    } catch (_) {}
  }
  try {
    await fs.enablePersistence({ synchronizeTabs: true });
    _persistent = true;
    return true;
  } catch (_) {
    return false;
  }
})();
function _flagged(key) {
  try { return localStorage.getItem(key) === '1'; } catch (_) { return false; }
}
function isPersistent() { return _persistent; }
// For a decision that cannot wait for the answer to be in, at boot.
function persistence() { return _persistence; }

// Keep the sign-in across app restarts. LOCAL is already the SDK's default
// in a browser, but it's set explicitly so that can't silently change, and
// the browser is asked to treat this site's storage as persistent: by
// default it may evict IndexedDB (where Firebase keeps the sign-in) under
// storage pressure or for sites that haven't been visited in a while,
// which looks exactly like "I have to sign in again after a long time".
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

let _fbUser = null;   // firebase.User | null
let _profile = null;  // { role, groupId, email, displayName, createdAt } | null

const _listeners = [];
function onChange(fn) { _listeners.push(fn); }
function _notify() { _listeners.forEach(fn => { try { fn(currentUser()); } catch (_) {} }); }

// Resolves once the initial auth state AND (if signed in) the first profile
// fetch have settled — the boot sequence waits on this before deciding which
// screen to show.
let _readyResolve;
const _ready = new Promise((res) => { _readyResolve = res; });
let _settledOnce = false;

// The profile is mirrored to localStorage so a failed fetch (phone just woke
// up and its connection is still stalled/offline) doesn't get mistaken for
// "this account has no profile" — which would drop a signed-in member onto
// the join-with-invite-code screen. Only a successful read that finds no
// doc counts as "no profile". The key is prefixed with the app's name since
// other apps may share this origin (e.g. on GitHub Pages).
const PROFILE_CACHE_PREFIX = 'talmaci.profileCache:';
function _readCachedProfile(uid) {
  try { return JSON.parse(localStorage.getItem(PROFILE_CACHE_PREFIX + uid) || 'null'); } catch (_) { return null; }
}
function _writeCachedProfile(uid, profile) {
  try {
    if (profile) localStorage.setItem(PROFILE_CACHE_PREFIX + uid, JSON.stringify(profile));
    else localStorage.removeItem(PROFILE_CACHE_PREFIX + uid);
  } catch (_) {}
}

// A stalled connection doesn't fail a get() fast — it can take ~10s per
// attempt, all of it spent on the boot spinner. When there's a cached
// profile to fall back to anyway, each attempt is cut short instead.
const PROFILE_FETCH_TIMEOUT_MS = 4000;
function _withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ]);
}

/* Whether this account is in a group is decided only by a read from the
 * server that finds no profile. Asked the usual way, Firestore may answer
 * from the device's copy (see below) whenever it believes itself offline,
 * and a missing profile there proves nothing. And a read that fails proves
 * nothing either: right after a sign-in, Firestore may still be switching
 * accounts, and a new account on this device has no stored profile to fall
 * back to (signing out removes it). Either used to land a member on the
 * join screen; now a failure is reported as one, with a way to try again. */
let _profileFailed = false;
let _profileError = null;

async function _loadProfile() {
  _profileFailed = false;
  _profileError = null;
  await _persistence;   // Firestore's first use; see above
  if (!_fbUser) { _profile = null; return; }
  const user = _fbUser;
  const uid = user.uid;
  const hasCache = !!_readCachedProfile(uid);
  // Offline there is no point holding the boot spinner through attempts
  // that cannot succeed.
  if (hasCache && navigator.onLine === false) { _profile = _readCachedProfile(uid); return; }
  const waits = [1000, 2500];
  for (let attempt = 0; ; attempt++) {
    try {
      const get = fs.collection('users').doc(uid).get({ source: 'server' });
      const snap = await (hasCache ? _withTimeout(get, PROFILE_FETCH_TIMEOUT_MS) : get);
      if (_fbUser !== user) return;   // another account signed in meanwhile
      _profile = snap.exists ? snap.data() : null;
      _writeCachedProfile(uid, _profile);
      return;
    } catch (err) {
      _profileError = err;
      if (attempt >= waits.length) break;
      await new Promise(r => setTimeout(r, waits[attempt]));
      if (_fbUser !== user) return;
    }
  }
  // Every attempt at the server failed. Firestore asked the usual way may
  // still answer, from the device's copy if need be — and a profile found
  // there is this member's, even if not the latest, so it is trusted;
  // only "no profile" has to come from the server.
  try {
    const snap = await _withTimeout(fs.collection('users').doc(uid).get(), PROFILE_FETCH_TIMEOUT_MS);
    if (_fbUser !== user) return;
    if (snap.exists) {
      _profile = snap.data();
      _writeCachedProfile(uid, _profile);
      return;
    }
  } catch (err) {
    _profileError = err;
  }
  // Then the last profile we saw, and when there is none, say so rather
  // than take it for no profile at all.
  _profile = _readCachedProfile(uid);
  _profileFailed = !_profile;
}

function profileFailed() { return _profileFailed; }
// What went wrong, for the screen that says it — so a failure that keeps
// happening can be reported as it is.
function profileError() {
  const e = _profileError;
  return e ? [e.code, e.message].filter(Boolean).join(': ') : '';
}

/* A member's name and email, as everyone else sees them, are copied into
 * their profile from their Google account when they join. Firebase does not
 * follow a later change to either on its own: it refreshes the Google
 * details only at a sign-in, and only among the provider's own (providerData),
 * not the user's top-level name. So on each start, what Google last gave is
 * written where the app reads it — the profile, and the user's own name,
 * which this member's notes and activity are signed with. Best-effort: on a
 * failure the old name simply stays until the next start. */
function _googleIdentity() {
  const g = (_fbUser.providerData || []).find(p => p && p.providerId === 'google.com') || {};
  return { displayName: g.displayName || _fbUser.displayName || '', email: g.email || _fbUser.email || '' };
}

async function _syncIdentity() {
  if (!_fbUser || !_profile || navigator.onLine === false) return;
  const user = _fbUser;
  const { displayName, email } = _googleIdentity();
  if (displayName && displayName !== user.displayName) user.updateProfile({ displayName }).catch(() => {});
  const patch = {};
  if (displayName && displayName !== _profile.displayName) patch.displayName = displayName;
  if (email && email !== _profile.email) patch.email = email;
  if (!Object.keys(patch).length) return;
  try {
    await fs.collection('users').doc(user.uid).update(patch);
    if (_fbUser !== user || !_profile) return;
    Object.assign(_profile, patch);
    _writeCachedProfile(user.uid, _profile);
    _members = null;   // the group's list held this member under the old name
  } catch (_) { /* rules not published yet, or offline after all */ }
}

auth.onAuthStateChanged(async (user) => {
  if (_leaving) return;   // signing out; the page is about to reload
  _fbUser = user;
  await _loadProfile();
  _syncIdentity();
  if (!_settledOnce) { _settledOnce = true; _readyResolve(); }
  _notify();
});

function ready() { return _ready; }

function currentUser() {
  if (!_fbUser) return null;
  return {
    uid: _fbUser.uid,
    email: _fbUser.email || '',
    displayName: _fbUser.displayName || '',
    role: _profile ? _profile.role : null,
    groupId: _profile ? _profile.groupId : null
  };
}

function isAdmin() { return !!(_profile && _profile.role === 'admin'); }
function currentGroupId() { return _profile ? _profile.groupId : null; }

async function signInWithGoogle() {
  window.Utils.requireOnline();
  const provider = new firebase.auth.GoogleAuthProvider();
  await auth.signInWithPopup(provider);
  // onAuthStateChanged handles profile load + notify.
}

// The account's songs are on the device, and whoever signs in next on it
// must not find them there, so signing out has the copy cleared at the
// next start (see _persistence), and starts it. That needs the connection:
// changes made offline and not yet sent would go with the copy, so they
// are sent first. The page being left draws nothing more — no sign-in
// screen for someone to use before the reload.
let _leaving = false;
async function signOut() {
  window.Utils.requireOnline();
  if (_persistent) {
    await _withTimeout(fs.waitForPendingWrites(), 5000).catch(() => {});
    try { localStorage.setItem(CLEAR_KEY, '1'); } catch (_) {}
    _leaving = true;
  }
  if (_fbUser) _writeCachedProfile(_fbUser.uid, null);
  try {
    await auth.signOut();
  } catch (err) {
    _leaving = false;
    try { localStorage.removeItem(CLEAR_KEY); } catch (_) {}
    throw err;
  }
  if (_leaving) location.reload();
}

async function refreshProfile() {
  await _loadProfile();
  _notify();
  return _profile;
}

// Redeem an invite code -> join its group as a regular user.
async function redeemInvite(code) {
  window.Utils.requireOnline();
  if (!_fbUser) throw new Error('Not signed in');
  const trimmed = String(code || '').trim().toUpperCase();
  if (!trimmed) throw new Error('Enter an invite code');
  const inviteSnap = await fs.collection('invites').doc(trimmed).get();
  if (!inviteSnap.exists) throw new Error('That invite code isn’t valid');
  const invite = inviteSnap.data();
  await fs.collection('users').doc(_fbUser.uid).set({
    email: _fbUser.email || '',
    displayName: _fbUser.displayName || '',
    role: 'user',
    groupId: invite.groupId,
    createdAt: Date.now()
  });
  await refreshProfile();
}

// Admin-only: mint a short, human-typable invite code for the current group.
async function createInvite() {
  window.Utils.requireOnline();
  if (!isAdmin()) throw new Error('Only admins can create invites');
  const code = _genInviteCode();
  await fs.collection('invites').doc(code).set({
    groupId: currentGroupId(),
    createdBy: _fbUser.uid,
    createdAt: Date.now()
  });
  return code;
}

function _genInviteCode() {
  // Excludes visually ambiguous chars (0/O, 1/I) for easy verbal/typed sharing.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// Admin-only: every profile in the current group, for a future "Manage
// members" / promote-to-admin screen.
async function listGroupMembers() {
  const groupId = currentGroupId();
  if (!groupId) return [];
  const offline = window.Utils.isOffline();
  const snap = await fs.collection('users').where('groupId', '==', groupId).get(offline ? { source: 'cache' } : undefined);
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

/* The group's members, fetched once and shared by everything that shows a
 * member's name — who is working on a song, in the list and on the song.
 * Refetched only when the group changes, i.e. on another account. A failed
 * fetch is not kept, so the next caller tries again. */
let _members = null;   // { groupId, promise } | null
function groupMembers() {
  const groupId = currentGroupId();
  if (!_members || _members.groupId !== groupId) {
    const entry = { groupId, promise: null };
    // Offline they come from the device and may be fewer, so they are not
    // kept either: the next caller, online, asks again.
    const offline = window.Utils.isOffline();
    entry.promise = listGroupMembers().then(members => {
      if (offline && _members === entry) _members = null;
      return members;
    }, () => {
      if (_members === entry) _members = null;
      return [];
    });
    _members = entry;
  }
  return _members.promise;
}

// A member as shown beside a song: their first name, or failing that the
// part of their email before the @.
function shortName(member) {
  if (!member) return 'Cineva';
  const name = (member.displayName || '').trim().split(/\s+/)[0];
  return name || (member.email || '').split('@')[0] || 'Cineva';
}

// Admin-only: flip another (or your own) member's role. The Firestore rule
// only allows this update to touch the role field.
async function setMemberRole(uid, role) {
  window.Utils.requireOnline();
  if (!isAdmin()) throw new Error('Only admins can change roles');
  await fs.collection('users').doc(uid).update({ role });
  if (uid === _fbUser.uid) await refreshProfile();
}

window.Auth = {
  ready, onChange, currentUser, isAdmin, currentGroupId, isPersistent, persistence, profileFailed, profileError,
  signInWithGoogle, signOut, refreshProfile,
  redeemInvite, createInvite,
  listGroupMembers, setMemberRole, groupMembers, shortName
};

})();
