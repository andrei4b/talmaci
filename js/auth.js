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
// has to be asked for before Firestore is first used, which is here.
// synchronizeTabs lets two tabs share the copy rather than the second
// being refused it. Where IndexedDB is unavailable (some private modes) it
// is refused, and Firestore keeps to memory, as before.
let _persistent = false;
const _persistence = fs.enablePersistence({ synchronizeTabs: true })
  .then(() => { _persistent = true; return true; }, () => false);
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

async function _loadProfile() {
  if (!_fbUser) { _profile = null; return; }
  const uid = _fbUser.uid;
  const hasCache = !!_readCachedProfile(uid);
  // Offline there is no point holding the boot spinner through two
  // attempts that cannot succeed.
  if (hasCache && navigator.onLine === false) { _profile = _readCachedProfile(uid); return; }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const get = fs.collection('users').doc(uid).get();
      const snap = await (hasCache ? _withTimeout(get, PROFILE_FETCH_TIMEOUT_MS) : get);
      _profile = snap.exists ? snap.data() : null;
      _writeCachedProfile(uid, _profile);
      return;
    } catch (_) {
      if (attempt === 0) await new Promise(r => setTimeout(r, 1500));
    }
  }
  // Both attempts failed — fall back to the last profile we saw.
  _profile = _readCachedProfile(uid);
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
// must not find them there, so signing out clears that copy — which needs
// the connection, or changes made offline and not yet sent would go with
// it. Firestore cannot be used again in the same page after it is cleared,
// hence the reload.
async function signOut() {
  window.Utils.requireOnline();
  if (_fbUser) _writeCachedProfile(_fbUser.uid, null);
  await auth.signOut();
  if (!_persistent) return;
  try {
    await fs.waitForPendingWrites();
    await fs.terminate();
    await fs.clearPersistence();
    // What db.js noted about the copy went with it.
    Object.keys(localStorage).filter(k => k.startsWith('talmaci.songsSynced:')).forEach(k => localStorage.removeItem(k));
  } catch (_) { /* another tab still has it open; it is left */ }
  location.reload();
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
  ready, onChange, currentUser, isAdmin, currentGroupId, isPersistent, persistence,
  signInWithGoogle, signOut, refreshProfile,
  redeemInvite, createInvite,
  listGroupMembers, setMemberRole, groupMembers, shortName
};

})();
