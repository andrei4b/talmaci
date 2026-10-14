/* functions/index.js — Cloud Functions for Tălmaci.
 *
 * translateText: a callable function that proxies a translation request to
 * the Google Cloud Translation API. Runs server-side purely to keep this
 * off the client's plate — unlike DeepL (which this replaced), Cloud
 * Translation needs no API key at all here: it authenticates as the
 * function's own service account (Application Default Credentials), so
 * there's nothing to store as a secret.
 *
 * Setup:
 *   1. In the Google Cloud Console for this Firebase project, enable the
 *      "Cloud Translation API" (APIs & Services → Library → search for it
 *      → Enable).
 *   2. Grant the Cloud Functions service account the "Cloud Translation
 *      API User" role (IAM & Admin → IAM → find the service account
 *      ending in "@<project>.iam.gserviceaccount.com" used by your
 *      functions — usually the default compute service account for
 *      2nd-gen functions → Edit → Add role → Cloud Translation API User).
 *   3. Deploy: firebase deploy --only functions
 *
 * defineEnglish: a callable function that looks a word up in
 * Merriam-Webster's Collegiate Dictionary. Proxied for the key, not for
 * CORS — their API answers browsers directly — since a key in the page
 * would be anyone's to read and spend, and the free tier is 1000 calls a
 * day. It is kept as a secret:
 *   firebase functions:secrets:set MW_COLLEGIATE_KEY
 *
 * notifyObservation: sends a notification when someone leaves an
 * observation on a version of a song, to the devices of everyone working
 * on that song but its author. See below.
 *
 * See README.md for the full walkthrough. */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { Translate } = require('@google-cloud/translate').v2;

admin.initializeApp();

const MW_COLLEGIATE_KEY = defineSecret('MW_COLLEGIATE_KEY');

const translate = new Translate();

exports.translateText = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Trebuie să fii autentificat.');
  }

  const text = (request.data && request.data.text || '').trim();
  if (!text) {
    throw new HttpsError('invalid-argument', 'Lipsește textul de tradus.');
  }
  if (text.length > 20000) {
    throw new HttpsError('invalid-argument', 'Textul e prea lung pentru o singură traducere.');
  }

  let translatedText;
  try {
    [translatedText] = await translate.translate(text, { from: 'en', to: 'ro' });
  } catch (err) {
    throw new HttpsError('unavailable', 'Nu am putut contacta Google Translate: ' + err.message);
  }

  if (!translatedText) {
    throw new HttpsError('internal', 'Răspuns neașteptat de la Google Translate.');
  }

  return { translatedText };
});

/* How many lookups have gone to Merriam-Webster today, so the app can show
 * how much of the free tier's 1000 a day is left. They report nothing of
 * the kind themselves — no header, no endpoint — so it is counted here,
 * one Firestore document per day: usage/mw-2026-10-12 { count }. The key
 * is one for the whole app, so the count is too, across every group.
 *
 * The day is UTC's. When Merriam-Webster's own day turns over is not
 * documented; if theirs is another timezone's, the two drift apart by a
 * few hours around midnight. The Admin SDK writes past the security
 * rules, and no rule lets a browser read or write these documents. */
const MW_DAILY_LIMIT = 1000;

function _usageDoc() {
  return admin.firestore().collection('usage').doc('mw-' + new Date().toISOString().slice(0, 10));
}

async function _usedToday() {
  const snap = await _usageDoc().get();
  return (snap.exists && snap.data().count) || 0;
}

/* The entries as Merriam-Webster sends them, for the client to lay out.
 * A word they do not have comes back as an array of spelling suggestions
 * (plain strings) instead, which is passed on the same way. With
 * { usage: true } instead of a word, it only reports today's count. */
exports.defineEnglish = onCall({ secrets: [MW_COLLEGIATE_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Trebuie să fii autentificat.');
  }

  if (request.data && request.data.usage) {
    return { used: await _usedToday(), limit: MW_DAILY_LIMIT };
  }

  const word = (request.data && request.data.word || '').trim();
  if (!word) {
    throw new HttpsError('invalid-argument', 'Lipsește cuvântul.');
  }
  if (word.length > 100) {
    throw new HttpsError('invalid-argument', 'Cuvântul e prea lung.');
  }

  // Counted before the request rather than after it succeeds: a call that
  // fails on their side has still been made with the key.
  await _usageDoc().set({ count: admin.firestore.FieldValue.increment(1) }, { merge: true });

  const url = 'https://www.dictionaryapi.com/api/v3/references/collegiate/json/' +
    encodeURIComponent(word) + '?key=' + encodeURIComponent(MW_COLLEGIATE_KEY.value());
  let body;
  try {
    const res = await fetch(url);
    body = await res.text();
  } catch (err) {
    throw new HttpsError('unavailable', 'Nu am putut contacta Merriam-Webster: ' + err.message);
  }

  // A bad or missing key is answered with a plain-text message, not JSON.
  let entries;
  try {
    entries = JSON.parse(body);
  } catch (err) {
    throw new HttpsError('failed-precondition', 'Merriam-Webster a refuzat cererea: ' + body.slice(0, 200));
  }
  return {
    entries: Array.isArray(entries) ? entries : [],
    used: await _usedToday(),
    limit: MW_DAILY_LIMIT
  };
});

/* A new observation on a version → a notification to each member on the
 * song's `workers` but the one who left it, on every device where they
 * turned them on (users/{uid}/devices, see js/push.js). Nothing for a
 * personal song, which has no team; the rules let nobody leave one there.
 *
 * Data only, shown by the app's own service worker. A token Firebase says
 * is no longer valid (the app uninstalled, its data cleared, permission
 * taken back) is removed, so it is not tried again.
 *
 * In europe-west1 because the database is in eur3, and a Firestore trigger
 * has to run in a region its database's location can reach. */
const DEAD_TOKEN = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token'
]);

exports.notifyObservation = onDocumentCreated(
  { document: 'songs/{songId}/versions/{versionId}/notes/{noteId}', region: 'europe-west1' },
  async (event) => {
    const note = event.data && event.data.data();
    if (!note) return;
    const { songId, versionId } = event.params;
    const db = admin.firestore();
    const songRef = db.collection('songs').doc(songId);
    const [songSnap, versionSnap] = await Promise.all([songRef.get(), songRef.collection('versions').doc(versionId).get()]);
    if (!songSnap.exists) return;
    const song = songSnap.data();
    if (song.shared === false) return;

    const recipients = (Array.isArray(song.workers) ? song.workers : []).filter(uid => uid && uid !== note.by);
    // What each run did, for when a notification someone expected never
    // came: `firebase functions:log --only notifyObservation`.
    const where = { songId, versionId, by: note.by, workers: song.workers || [] };
    if (!recipients.length) { logger.info('Nobody to notify', where); return; }

    // [{ uid, ref, token }] for every device of every recipient.
    const devices = (await Promise.all(recipients.map(uid =>
      db.collection('users').doc(uid).collection('devices').get()
        .then(snap => snap.docs.map(d => ({ ref: d.ref, token: d.data().token || d.id })))
    ))).flat();
    if (!devices.length) { logger.info('No devices for', { ...where, recipients }); return; }

    const versionTitle = (versionSnap.exists && versionSnap.data().title) || 'o versiune';
    const text = String(note.text || '').replace(/\s+/g, ' ').trim();
    const body = `${note.byName || 'Cineva'} la „${versionTitle}”: ` + (text.length > 160 ? text.slice(0, 159) + '…' : text);

    const res = await admin.messaging().sendEachForMulticast({
      tokens: devices.map(d => d.token),
      data: { title: song.title || 'Fără titlu', body, songId, versionId },
      webpush: { headers: { Urgency: 'high', TTL: String(3 * 24 * 3600) } }
    });
    logger.info('Sent', { ...where, recipients, devices: devices.map(d => d.ref.path.split('/')[1]),
      sent: res.successCount, failed: res.responses.filter(r => !r.success).map(r => r.error && r.error.code) });
    await Promise.all(res.responses.map((r, i) =>
      !r.success && r.error && DEAD_TOKEN.has(r.error.code) ? devices[i].ref.delete().catch(() => {}) : null
    ));
  }
);
