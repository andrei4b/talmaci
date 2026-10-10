/* translate.js — thin client for the translateText Cloud Function.
 * See functions/index.js for the server-side proxy this calls. */
(function () {

async function translate(text) {
  const fn = firebase.functions().httpsCallable('translateText');
  const res = await fn({ text });
  return res.data.translatedText;
}

// Generates (or, if one already exists AND belongs to this user — or this
// user is an admin — refreshes) the song's "Mot-a-mot" version from its
// current original text. Shared by songs.js (offered right after creating
// a song) and song-detail.js (offered after editing the original text, and
// via the kebab menu's manual button).
//
// Versions can only be edited by whoever created them (or an admin), so if
// an existing "Mot-a-mot" belongs to someone else, this creates a new one
// of your own instead of trying to overwrite theirs.
/* Puts the original's section marks back into a machine translation under
 * their Romanian names. Left alone, Google turns "[Chorus]" into "[Cor]"
 * and "[Verse 2]" into "[Versetul 2]". The translation keeps the original's line breaks, so the
 * marks are found by line; if the line counts ever disagree, by order
 * among the bracketed lines instead, and failing both they are left be. */
function _romanianSections(originalText, translatedText) {
  const S = window.Sections;
  const marks = S.list(originalText);
  if (!marks.length) return translatedText;
  const lines = translatedText.split('\n');
  if (lines.length === String(originalText).split('\n').length) {
    marks.forEach(m => { lines[m.line] = '[' + S.romanian(m) + ']'; });
    return lines.join('\n');
  }
  const at = lines.map((l, i) => S.isMarker(l) ? i : -1).filter(i => i >= 0);
  if (at.length !== marks.length) return translatedText;
  at.forEach((i, k) => { lines[i] = '[' + S.romanian(marks[k]) + ']'; });
  return lines.join('\n');
}

async function generateMotAMotVersion(songId, originalText, existingVersions, createdBy, isAdmin) {
  const translatedText = _romanianSections(originalText, await translate(originalText));
  const existing = (existingVersions || []).find(v =>
    v.title === 'Mot-a-mot' && (v.createdBy === createdBy || isAdmin));
  if (existing) {
    await window.Db.updateVersion(songId, existing.id, { text: translatedText });
    return { ...existing, text: translatedText };
  }
  const id = await window.Db.addVersion(songId, { title: 'Mot-a-mot', text: translatedText, createdBy });
  const now = Date.now();
  return { id, title: 'Mot-a-mot', text: translatedText, createdBy, createdAt: now, updatedAt: now };
}

window.Translator = { translate, generateMotAMotVersion };

})();
