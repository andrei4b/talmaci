/* translate.js — thin client for the translateText Cloud Function.
 * See functions/index.js for the server-side proxy this calls. */
(function () {

async function translate(text) {
  const fn = firebase.functions().httpsCallable('translateText');
  const res = await fn({ text });
  return res.data.translatedText;
}

// Generates (or, if one already exists, refreshes) the song's "Mot-a-mot"
// version from its current original text. Shared by songs.js (offered
// right after creating a song) and song-detail.js (offered after editing
// the original text, and via the kebab menu's manual button).
async function generateMotAMotVersion(songId, originalText, existingVersions, createdBy) {
  const translatedText = await translate(originalText);
  const existing = (existingVersions || []).find(v => v.title === 'Mot-a-mot');
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
