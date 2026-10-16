/* translate.js — thin client for the translateText Cloud Function.
 * See functions/index.js for the server-side proxy this calls. */
(function () {

async function translate(text) {
  window.Utils.requireOnline();
  const fn = firebase.functions().httpsCallable('translateText');
  const res = await fn({ text });
  return res.data.translatedText;
}

// Generates (or, if one already exists AND belongs to this user — or this
// user is an admin — refreshes) the song's "Mot-a-mot" version from its
// current original, from the song's kebab menu (song-detail.js).
//
// Versions can only be edited by whoever created them (or an admin), so if
// an existing "Mot-a-mot" belongs to someone else, this creates a new one
// of your own instead of trying to overwrite theirs.
//
// Verse by verse, all at once: each verse's lyrics go to Google on their
// own and come back as its verse, so the translation has the original's
// verses however many blank lines are in them, and each keeps its mark,
// under its Romanian name ("Chorus" becomes "Refren", where Google would
// have made it "Cor").
async function generateMotAMotVersion(songId, originalVerses, existingVersions, createdBy, isAdmin) {
  const verses = await Promise.all(originalVerses.map(async (v) => {
    const sec = window.Verses.section(v);
    return {
      mark: sec ? window.Sections.romanian(sec) : v.mark,
      lyrics: v.lyrics.trim() ? await translate(v.lyrics) : ''
    };
  }));
  const existing = (existingVersions || []).find(v =>
    v.title === 'Mot-a-mot' && (v.createdBy === createdBy || isAdmin));
  if (existing) {
    await window.Db.updateVersion(songId, existing.id, { verses });
    return { ...existing, verses };
  }
  const id = await window.Db.addVersion(songId, { title: 'Mot-a-mot', verses, createdBy });
  const now = Date.now();
  return { id, title: 'Mot-a-mot', verses, createdBy, createdAt: now, updatedAt: now };
}

window.Translator = { translate, generateMotAMotVersion };

})();
