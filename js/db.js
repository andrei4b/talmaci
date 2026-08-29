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
 *     originalText: string,     // English source text; empty for 'original'
 *     translatedText: string,   // legacy single-translation field, no longer
 *                                // written — kept only so pre-versions data
 *                                // isn't lost; see listVersions' migration.
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
 *     text: string,              // the Romanian translation for this version
 *     createdBy: uid,
 *     createdAt: number (ms),
 *     updatedAt: number (ms)
 *   }
 *
 * The Rime/Sinonime/Biblie tabs have no persisted fields yet — their data
 * model will be added once that functionality is specified. */
(function () {

function fs() { return firebase.firestore(); }

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

  const queries = [fs().collection('songs').where('groupId', '==', groupId).where('shared', '==', true).get()];
  if (myUid) queries.push(fs().collection('songs').where('groupId', '==', groupId).where('createdBy', '==', myUid).get());
  (await Promise.all(queries)).forEach(add);

  const songs = [...byId.values()];
  songs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return songs;
}

async function getSong(songId) {
  const snap = await fs().collection('songs').doc(songId).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

// Just the group's name, for the "which list" switcher label — nothing
// else about a group is used anywhere in the app yet.
async function getGroup(groupId) {
  if (!groupId) return null;
  const snap = await fs().collection('groups').doc(groupId).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function addSong({ title, originalText, kind, shared, groupId, createdBy }) {
  const now = Date.now();
  const ref = await fs().collection('songs').add({
    title: title || '',
    kind: kind === 'original' ? 'original' : 'translation',
    originalText: originalText || '',
    translatedText: '',
    groupId,
    shared: shared !== false,
    createdBy,
    createdAt: now,
    updatedAt: now
  });
  // Every song starts with one version. Without it the song opened on a
  // disabled version switcher with nothing to switch to, and "Adaugă
  // versiune" lives inside that switcher's own sheet — so there was no way
  // to make the first one.
  await addVersion(ref.id, { title: 'Versiunea 1', text: '', createdBy });
  return ref.id;
}

async function updateSong(songId, patch) {
  await fs().collection('songs').doc(songId).update({
    ...patch,
    updatedAt: Date.now()
  });
}

function _versionsRef(songId) {
  return fs().collection('songs').doc(songId).collection('versions');
}

// Firestore doesn't cascade-delete subcollections when you delete a
// document, so the versions have to be cleared out by hand first —
// otherwise they'd be orphaned (unreachable, but still taking up storage).
async function deleteSong(songId) {
  const versionsSnap = await _versionsRef(songId).get();
  await Promise.all(versionsSnap.docs.map(d => d.ref.delete()));
  await fs().collection('songs').doc(songId).delete();
}

async function listVersions(songId) {
  const snap = await _versionsRef(songId).orderBy('createdAt', 'asc').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function addVersion(songId, { title, text, createdBy }) {
  const now = Date.now();
  const ref = await _versionsRef(songId).add({
    title: title || 'Versiune nouă',
    text: text || '',
    createdBy,
    createdAt: now,
    updatedAt: now
  });
  return ref.id;
}

async function updateVersion(songId, versionId, patch) {
  await _versionsRef(songId).doc(versionId).update({
    ...patch,
    updatedAt: Date.now()
  });
}

async function deleteVersion(songId, versionId) {
  await _versionsRef(songId).doc(versionId).delete();
}

window.Db = {
  listSongs, getSong, getGroup, addSong, updateSong, deleteSong,
  listVersions, addVersion, updateVersion, deleteVersion
};

})();
