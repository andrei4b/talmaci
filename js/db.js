/* db.js — Firestore data layer for songs and their translation versions.
 *
 * Song doc shape (collection "songs"):
 *   {
 *     title: string,
 *     kind: 'translation' | 'original',
 *                               // 'original' is a composition of our own:
 *                               // no source text, one box in the Text tab.
 *                               // Absent on songs written before this
 *                               // existed, which are all translations —
 *                               // read it through Utils.songKind, never
 *                               // directly, so that default is applied in
 *                               // one place. Nothing backfills it: the
 *                               // song list is filtered in the browser,
 *                               // and a Firestore where() would instead
 *                               // have skipped every doc missing the
 *                               // field.
 *     originalVerses: [{ mark, lyrics }],
 *                               // the English source, verse by verse (see
 *                               // verses.js); empty for 'original'. Until
 *                               // release 158 it was one string,
 *                               // originalText, and the versions' text
 *                               // too — tools/migrate-verses made them
 *                               // lists.
 *     groupId: string,
 *     shared: boolean,          // visible to the whole group, vs personal —
 *                               // read it through Utils.isShared for
 *                               // display, which treats absent as shared.
 *                               // listSongs itself needs it explicit, not
 *                               // just as a default: unlike `kind`, this
 *                               // field is queried on directly (see
 *                               // firestore.rules), so a song predating
 *                               // it had to be backfilled with shared:
 *                               // true by a one-time migration rather
 *                               // than left to a client-side default.
 *     status: 'draft' | 'review' | 'final',
 *                               // where the song stands; absent reads as
 *                               // 'draft' — see Utils.songStatus.
 *     workers: uid[],           // who has said they are working on it;
 *                               // absent means nobody. These two, unlike
 *                               // everything else here, any group member
 *                               // may change on a shared song — see
 *                               // setSongStatus and firestore.rules.
 *     versionOrder: versionId[],
 *                               // the order the versions are shown in, as
 *                               // last arranged in the version sheet;
 *                               // absent until someone does. A version
 *                               // missing from it (made since) comes after
 *                               // the ones in it, oldest first — see
 *                               // Utils.orderVersions. Like status, any
 *                               // group member may change it on a shared
 *                               // song — see setVersionOrder.
 *     demoUrl: string,          // optional link to a recording of the song;
 *                               // '' or absent when there is none. Always
 *                               // saved through Utils.normalizeUrl, so it
 *                               // is an http(s) URL when present.
 *     createdBy: uid,
 *     createdAt: number (ms),
 *     updatedAt: number (ms)
 *   }
 *
 * Versions live in a subcollection so multiple people can edit different
 * versions of the same song without racing on one big doc. Every song is
 * created with a "Versiunea 1" already in it — see addSong:
 *   songs/{songId}/versions/{versionId}
 *   {
 *     title: string,             // shown in the version switcher
 *     verses: [{ mark, lyrics }], // the Romanian translation for this
 *                                 // version, verse by verse
 *     createdBy: uid,
 *     createdAt: number (ms),
 *     updatedAt: number (ms)
 *   }
 *
 * Each version of a shared song has the team's observations on it, in the
 * order they were left — on the whole version, or on one of its verses —
 * and the replies to them, which make each a thread (see threads.js):
 *   songs/{songId}/versions/{versionId}/notes/{noteId}
 *   {
 *     text: string,
 *     by: uid,
 *     byName: string,            // the author's name when it was written
 *     at: number (ms),
 *     anchor?: {                 // on a verse: what it was left on, to
 *       key, name, nth, pos,     // find the verse again after edits —
 *       quote                    // see Threads.anchorFor; replies carry
 *     },                         // their thread's too
 *     parentId?: string,         // a reply: the observation it answers
 *     editedAt?: number (ms),    // when its author last changed its text
 *     hearts?: uid[]             // who has given it a heart
 *   }
 * and each member's own record of when they last read a song's, so the
 * button can mark what is new to them on any device — a version's as a
 * whole, or one thread's, read on its own from its verse:
 *   users/{uid}/seen/{songId}
 *   { [versionId]: number (ms), [versionId + ':' + threadId]: number (ms) }
 *
 * Sheet music attached to a song — images or PDFs, any number of them,
 * added by any member who can see the song. The file itself is in Cloud
 * Storage, at the same path as its description here (see storage.rules):
 *   songs/{songId}/scores/{scoreId}
 *   {
 *     name: string,              // the file's name as it was picked
 *     type: string,              // 'application/pdf' or an image/* type
 *     size: number (bytes),
 *     path: string,              // where the file is in Cloud Storage
 *     url: string,               // its download link — see addScore
 *     by: uid,
 *     byName: string,
 *     at: number (ms)
 *   }
 *
 * The Rime/Sinonime/Biblie tabs have no persisted fields yet — their data
 * model will be added once that functionality is specified. */
(function () {

function fs() { return firebase.firestore(); }

/* Offline, reads come from the device's copy (see auth.js), and only from
 * it: asked the usual way, Firestore first spends about ten seconds trying
 * the server. A document that was never read here is not in the copy, and
 * fails as a missing connection would. A query cannot fail that way — it
 * answers with whatever of it is on the device, which may be nothing — so
 * the two that matter say themselves when they have nothing to go on. */
function _get(ref) {
  return window.Utils.isOffline() ? ref.get({ source: 'cache' }) : ref.get();
}

// Whether this account's song list has been read here from the server into
// the device's copy, so that offline an empty list from it means no songs,
// not none yet. auth.js forgets it when it clears the copy.
const SYNCED_PREFIX = 'talmaci.songsSynced:';
function _listSynced(uid) {
  try { return localStorage.getItem(SYNCED_PREFIX + uid) === '1'; } catch (_) { return false; }
}
function _markListSynced(uid) {
  try { localStorage.setItem(SYNCED_PREFIX + uid, '1'); } catch (_) {}
}

// Two queries, not one — see firestore.rules for why a single
// groupId-only query can no longer be proven safe against a rule that also
// depends on `shared`/`createdBy` per document. Each of these two is
// provable on its own: one via shared == true, one via createdBy == you.
// A song that's both mine and shared matches both, so results are merged
// by id rather than concatenated.
async function listSongs(groupId, myUid) {
  if (!groupId) return [];
  const byId = new Map();
  const add = (snap) => snap.docs.forEach(d => byId.set(d.id, { id: d.id, ...d.data() }));

  const offline = window.Utils.isOffline();
  const persistent = await window.Auth.persistence();
  if (offline && !(persistent && _listSynced(myUid))) window.Utils.requireOnline();
  const queries = [_get(fs().collection('songs').where('groupId', '==', groupId).where('shared', '==', true))];
  if (myUid) queries.push(_get(fs().collection('songs').where('groupId', '==', groupId).where('createdBy', '==', myUid)));
  (await Promise.all(queries)).forEach(add);
  if (!offline && persistent) _markListSynced(myUid);

  const songs = [...byId.values()];
  songs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return songs;
}

/* Null for a song that is not there for this member. A deleted song is
 * refused as a missing permission, not reported missing: the read rule
 * looks at the document's own groupId and shared fields, and a document
 * that does not exist has none (see firestore.rules). Another member's
 * personal song, or one made personal since, is refused the same way.
 * Either way it is gone as far as this member is concerned, and the two
 * cannot be told apart from here. */
async function getSong(songId) {
  let snap;
  try {
    snap = await _get(fs().collection('songs').doc(songId));
  } catch (err) {
    if (err && err.code === 'permission-denied') return null;
    throw err;
  }
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

// Just the group's name, for the "which list" switcher label — nothing
// else about a group is used anywhere in the app yet.
async function getGroup(groupId) {
  if (!groupId) return null;
  const snap = await _get(fs().collection('groups').doc(groupId));
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function addSong({ title, originalVerses, kind, shared, demoUrl, workers, groupId, createdBy }) {
  const now = Date.now();
  const ref = await fs().collection('songs').add({
    title: title || '',
    kind: kind === 'original' ? 'original' : 'translation',
    originalVerses: originalVerses || [],
    groupId,
    shared: shared !== false,
    demoUrl: demoUrl || '',
    workers: Array.isArray(workers) ? workers : [],
    createdBy,
    createdAt: now,
    updatedAt: now
  });
  // Every song starts with one version. Without it the song opened on a
  // disabled version switcher with nothing to switch to, and "Adaugă
  // versiune" lives inside that switcher's own sheet — so there was no way
  // to make the first one.
  await addVersion(ref.id, { title: 'Versiunea 1', verses: [], createdBy });
  return ref.id;
}

async function updateSong(songId, patch) {
  await fs().collection('songs').doc(songId).update({
    ...patch,
    updatedAt: Date.now()
  });
}

/* A song's status and who is working on it. Written on their own, and
 * without touching updatedAt: they are the only fields firestore.rules
 * lets any group member change, and the rule allows exactly these. The
 * worker list goes through arrayUnion/arrayRemove, so two people taking a
 * song on at once both end up on it. */
async function setSongStatus(songId, status) {
  await fs().collection('songs').doc(songId).update({ status });
}
async function setWorking(songId, uid, working) {
  const FV = firebase.firestore.FieldValue;
  await fs().collection('songs').doc(songId).update({
    workers: working ? FV.arrayUnion(uid) : FV.arrayRemove(uid)
  });
}

// The versions' order, which like status is the group's to arrange, so
// it is written on its own and without touching updatedAt for the same
// reason — firestore.rules allows exactly this field.
async function setVersionOrder(songId, versionIds) {
  await fs().collection('songs').doc(songId).update({ versionOrder: versionIds });
}

function _versionsRef(songId) {
  return fs().collection('songs').doc(songId).collection('versions');
}

// Firestore doesn't cascade-delete subcollections when you delete a
// document, so the versions have to be cleared out by hand first —
// otherwise they'd be orphaned (unreachable, but still taking up storage).
async function deleteSong(songId) {
  const versionsSnap = await _versionsRef(songId).get();
  await Promise.all(versionsSnap.docs.map(d => deleteVersion(songId, d.id)));
  // Refused only while the rules that allow sheet music are not published
  // yet, and then none can have been added either.
  const scoresSnap = await _scoresRef(songId).get().catch(err => {
    if (err.code === 'permission-denied') return { docs: [] };
    throw err;
  });
  await Promise.all(scoresSnap.docs.map(d => deleteScore(songId, { id: d.id, ...d.data() })));
  await fs().collection('songs').doc(songId).delete();
}

// Every song has a version, so none at all, offline, means a song whose
// versions were never read on this device.
async function listVersions(songId) {
  const snap = await _get(_versionsRef(songId).orderBy('createdAt', 'asc'));
  if (snap.empty) window.Utils.requireOnline();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function addVersion(songId, { title, verses, createdBy }) {
  const now = Date.now();
  const ref = await _versionsRef(songId).add({
    title: title || 'Versiune nouă',
    verses: verses || [],
    createdBy,
    createdAt: now,
    updatedAt: now
  });
  return ref.id;
}

/* The texts being written, which unlike every other change go out offline
 * too: Firestore keeps them on the device and sends them when the
 * connection is back. Offline they return once the change is made here
 * rather than waiting on the server, which would be until then; `sent` is
 * the server's answer, for whoever wants to know how it went. */
function _queued(write) {
  const sent = write();
  if (!window.Utils.isOffline()) return sent.then(() => ({ queued: false, sent }));
  return Promise.resolve({ queued: true, sent });
}
function setVersionVerses(songId, versionId, verses) {
  return _queued(() => _versionsRef(songId).doc(versionId).update({ verses, updatedAt: Date.now() }));
}
function setOriginalVerses(songId, verses) {
  return _queued(() => fs().collection('songs').doc(songId).update({ originalVerses: verses, updatedAt: Date.now() }));
}

async function updateVersion(songId, versionId, patch) {
  await _versionsRef(songId).doc(versionId).update({
    ...patch,
    updatedAt: Date.now()
  });
}

// Its observations first: the rule that lets a version's creator clear
// them out reads the version, which has to still be there.
async function deleteVersion(songId, versionId) {
  const notesSnap = await _notesRef(songId, versionId).get();
  await Promise.all(notesSnap.docs.map(d => d.ref.delete()));
  await _versionsRef(songId).doc(versionId).delete();
}

function _notesRef(songId, versionId) {
  return _versionsRef(songId).doc(versionId).collection('notes');
}

/* A version's observations, kept live: `onChange` gets them, sorted by
 * when they were left, now — from the device's copy first when it has
 * them — and again after every change to any, until the function returned
 * is called. Sorted here rather than by the query, so a read that fails
 * for want of an index can't be what keeps them off screen. */
function watchNotes(songId, versionId, onChange, onError) {
  return _notesRef(songId, versionId).onSnapshot(
    snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.at - b.at)),
    err => { if (onError) onError(err); }
  );
}

async function addNote(songId, versionId, { text, by, byName, anchor, parentId }) {
  const note = { text, by, byName: byName || '', at: Date.now() };
  if (anchor) note.anchor = anchor;
  if (parentId) note.parentId = parentId;
  const ref = await _notesRef(songId, versionId).add(note);
  return { id: ref.id, ...note };
}

async function deleteNote(songId, versionId, noteId) {
  await _notesRef(songId, versionId).doc(noteId).delete();
}

// Gives an observation your heart, or takes it back.
async function setNoteHeart(songId, versionId, noteId, uid, on) {
  const FV = firebase.firestore.FieldValue;
  await _notesRef(songId, versionId).doc(noteId).update({ hearts: on ? FV.arrayUnion(uid) : FV.arrayRemove(uid) });
}

// Changes an observation's text — its author's own only.
async function editNote(songId, versionId, noteId, text) {
  const patch = { text, editedAt: Date.now() };
  await _notesRef(songId, versionId).doc(noteId).update(patch);
  return patch;
}

function _seenRef(uid, songId) {
  return fs().collection('users').doc(uid).collection('seen').doc(songId);
}

// { versionId: ms, 'versionId:threadId': ms } — when this member last
// read each version's notes, and threads read on their own.
async function getSeen(uid, songId) {
  const snap = await _get(_seenRef(uid, songId));
  return snap.exists ? snap.data() : {};
}

// `patch`: those of the same keys read now, with when.
async function markSeen(uid, songId, patch) {
  await _seenRef(uid, songId).set(patch, { merge: true });
}

// Every other write fails at once when there is no connection, rather
// than leaving whatever awaits it waiting until there is one.
// ---- sheet music ----

const SCORE_MAX_BYTES = 20 * 1024 * 1024;

function _scoresRef(songId) {
  return fs().collection('songs').doc(songId).collection('scores');
}

// What a picked file is, as storage.rules accepts it, or '' when it is
// neither an image nor a PDF. Some Android file pickers give a PDF no type.
function scoreType(file) {
  const type = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : '');
  return type === 'application/pdf' || type.startsWith('image/') ? type : '';
}

async function listScores(songId) {
  const snap = await _scoresRef(songId).orderBy('at', 'asc').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* Uploads `file` and describes it beside the song's versions. The download
 * link is kept in the description so that opening a file is a link opened
 * from the tap itself: asked for afterwards, it would come too late for
 * the browser to let a new tab open. `onProgress` hears the fraction sent. */
async function addScore(songId, file, { by, byName }, onProgress) {
  const ref = _scoresRef(songId).doc();
  const path = `songs/${songId}/scores/${ref.id}`;
  const fileRef = firebase.storage().ref(path);
  const type = scoreType(file);
  const task = fileRef.put(file, {
    contentType: type,
    // Shown in the browser rather than downloaded, under its own name.
    contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    customMetadata: { by }
  });
  if (onProgress) task.on('state_changed', snap => onProgress(snap.bytesTransferred / snap.totalBytes));
  await task;
  try {
    const score = { name: file.name, type, size: file.size, path, url: await fileRef.getDownloadURL(), by, byName, at: Date.now() };
    await ref.set(score);
    return { id: ref.id, ...score };
  } catch (err) {
    fileRef.delete().catch(() => {});
    throw err;
  }
}

// The file first: if its description then fails to go, trying again still
// works, where the other way round would leave a file nobody can see.
async function deleteScore(songId, score) {
  await firebase.storage().ref(score.path).delete().catch(err => {
    if (err.code !== 'storage/object-not-found') throw err;
  });
  await _scoresRef(songId).doc(score.id).delete();
}

const _online = (fn) => async (...args) => { window.Utils.requireOnline(); return fn(...args); };

window.Db = {
  listSongs, getSong, getGroup, listVersions, watchNotes, getSeen,
  setVersionVerses, setOriginalVerses,
  ...Object.fromEntries(Object.entries({
    addSong, updateSong, deleteSong, setSongStatus, setWorking, setVersionOrder,
    addVersion, updateVersion, deleteVersion, addNote, deleteNote, editNote, setNoteHeart, markSeen,
    listScores, addScore, deleteScore
  }).map(([name, fn]) => [name, _online(fn)])),
  scoreType, SCORE_MAX_BYTES
};

})();
