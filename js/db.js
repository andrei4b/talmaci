/* db.js — Firestore data layer for songs.
 *
 * Song doc shape (collection "songs"):
 *   {
 *     title: string,
 *     originalText: string,     // English source text (Text tab)
 *     translatedText: string,   // Romanian translation (Text tab)
 *     groupId: string,
 *     createdBy: uid,
 *     createdAt: number (ms),
 *     updatedAt: number (ms)
 *   }
 *
 * The Rime/Sinonime/Biblie tabs have no persisted fields yet — their data
 * model will be added once that functionality is specified. */
(function () {

function fs() { return firebase.firestore(); }

async function listSongs(groupId) {
  if (!groupId) return [];
  const snap = await fs().collection('songs').where('groupId', '==', groupId).get();
  const songs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  songs.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  return songs;
}

async function getSong(songId) {
  const snap = await fs().collection('songs').doc(songId).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function addSong({ title, originalText, groupId, createdBy }) {
  const now = Date.now();
  const ref = await fs().collection('songs').add({
    title: title || '',
    originalText: originalText || '',
    translatedText: '',
    groupId,
    createdBy,
    createdAt: now,
    updatedAt: now
  });
  return ref.id;
}

async function updateSong(songId, patch) {
  await fs().collection('songs').doc(songId).update({
    ...patch,
    updatedAt: Date.now()
  });
}

async function deleteSong(songId) {
  await fs().collection('songs').doc(songId).delete();
}

window.Db = { listSongs, getSong, addSong, updateSong, deleteSong };

})();
