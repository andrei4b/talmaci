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

async function _loadProfile() {
  if (!_fbUser) { _profile = null; return; }
  try {
    const snap = await fs.collection('users').doc(_fbUser.uid).get();
    _profile = snap.exists ? snap.data() : null;
  } catch (_) {
    _profile = null;
  }
}

auth.onAuthStateChanged(async (user) => {
  _fbUser = user;
  await _loadProfile();
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
  const provider = new firebase.auth.GoogleAuthProvider();
  await auth.signInWithPopup(provider);
  // onAuthStateChanged handles profile load + notify.
}

async function signOut() {
  await auth.signOut();
}

async function refreshProfile() {
  await _loadProfile();
  _notify();
  return _profile;
}

// Redeem an invite code -> join its group as a regular user.
async function redeemInvite(code) {
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
  const snap = await fs.collection('users').where('groupId', '==', groupId).get();
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

// Admin-only: flip another (or your own) member's role. The Firestore rule
// only allows this update to touch the role field.
async function setMemberRole(uid, role) {
  if (!isAdmin()) throw new Error('Only admins can change roles');
  await fs.collection('users').doc(uid).update({ role });
  if (uid === _fbUser.uid) await refreshProfile();
}

window.Auth = {
  ready, onChange, currentUser, isAdmin, currentGroupId,
  signInWithGoogle, signOut, refreshProfile,
  redeemInvite, createInvite,
  listGroupMembers, setMemberRole
};

})();
