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
 * notifySongActivity: notifications to everyone
 * working on a song but whoever changed it — observations, text edits,
 * new versions, status changes, someone joining — and replies to an
 * observation, to the others in its thread. See below.
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

/* Notifications, to the members on a song's `workers` but the one who did
 * the thing, on every device where they turned them on (users/{uid}/devices,
 * see js/push.js). Never for a personal song, which has no team.
 *
 * All of it from the activity log (js/activity.js), which every change to
 * a shared song writes an entry to: an observation left, a version's text
 * or the original edited, a version added, the status changed, someone
 * else joining the song. The log is written apart from the change itself,
 * and a write of it that fails is not retried, so neither is the
 * notification — accepted for having one place that decides them all.
 *
 * Text is saved every few seconds, so text edits notify a member at most
 * once an hour per song (TEXT_EVERY_MS), whoever made them; the log
 * already folds one person's run of saves into one entry. Everything else
 * notifies every time.
 *
 * Data only, shown by the app's own service worker. A token Firebase says
 * is no longer valid (the app uninstalled, its data cleared, permission
 * taken back) is removed, so it is not tried again. Each run logs what it
 * did — read with `gcloud logging read`; `firebase functions:log` leaves
 * runs out.
 *
 * In europe-west1 because the database is in eur3, and a Firestore trigger
 * has to run in a region its database's location can reach. */
const DEAD_TOKEN = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token'
]);
const REGION = 'europe-west1';
const TEXT_EVERY_MS = 60 * 60 * 1000;
const STATUS_LABELS = { draft: 'Ciornă', review: 'În revizie', final: 'Final' };

async function _song(songId) {
  const snap = await admin.firestore().collection('songs').doc(songId).get();
  return snap.exists && snap.data().shared !== false ? snap.data() : null;
}

function _recipients(song, by) {
  return (Array.isArray(song.workers) ? song.workers : []).filter(uid => uid && uid !== by);
}

/* `data` is what the service worker shows: title, body, songId, and
 * versionId for an observation (which opens them). All strings, as FCM requires. */
async function _send(where, recipients, data) {
  const db = admin.firestore();
  if (!recipients.length) { logger.info('Nobody to notify', where); return; }
  const devices = (await Promise.all(recipients.map(uid =>
    db.collection('users').doc(uid).collection('devices').get()
      .then(snap => snap.docs.map(d => ({ ref: d.ref, token: d.data().token || d.id })))
  ))).flat();
  if (!devices.length) { logger.info('No devices for', { ...where, recipients }); return; }

  const res = await admin.messaging().sendEachForMulticast({
    tokens: devices.map(d => d.token),
    data,
    webpush: { headers: { Urgency: 'high', TTL: String(3 * 24 * 3600) } }
  });
  logger.info('Sent', { ...where, recipients, devices: devices.map(d => d.ref.path.split('/')[1]),
    sent: res.successCount, failed: res.responses.filter(r => !r.success).map(r => r.error && r.error.code) });
  await Promise.all(res.responses.map((r, i) =>
    !r.success && r.error && DEAD_TOKEN.has(r.error.code) ? devices[i].ref.delete().catch(() => {}) : null
  ));
}

/* Of `recipients`, those not told of a text edit to this song in the last
 * hour, marked as told now. One document per member and song,
 * pushThrottle/{uid}_{songId} { textAt }, which no rule lets a browser
 * read or write. A transaction, so two edits at once tell nobody twice. */
async function _dueForText(songId, recipients, now) {
  const db = admin.firestore();
  const due = await Promise.all(recipients.map(uid => db.runTransaction(async (t) => {
    const ref = db.collection('pushThrottle').doc(`${uid}_${songId}`);
    const snap = await t.get(ref);
    if (snap.exists && now - (snap.data().textAt || 0) < TEXT_EVERY_MS) return false;
    t.set(ref, { textAt: now });
    return true;
  }).catch(() => false)));
  return recipients.filter((_, i) => due[i]);
}

// An observation's text, short enough for a notification.
async function _noteText(e) {
  if (!e.versionId || !e.noteId) return '';
  const snap = await admin.firestore().collection('songs').doc(e.songId)
    .collection('versions').doc(e.versionId).collection('notes').doc(e.noteId).get();
  const text = String((snap.exists && snap.data().text) || '').replace(/\s+/g, ' ').trim();
  return text.length > 160 ? text.slice(0, 159) + '…' : text;
}

// The author as the app shows a member beside a song (Auth.shortName in
// js/auth.js): the first name. byName is their whole name, or the part of
// their email before the @ when they have none, which is kept as it is.
function _firstName(e) {
  return String(e.byName || '').trim().split(/\s+/)[0] || 'Cineva';
}

// Where an observation is: its version, and its verse when it is on one.
function _noteWhere(e) {
  return `„${e.versionTitle || 'o versiune'}”` + (e.section ? ` (${e.section})` : '');
}

/* A reply goes to the others in its thread — whoever left an observation
 * in it — rather than to everyone working on the song. */
async function _threadPeople(e) {
  const notes = admin.firestore().collection('songs').doc(e.songId)
    .collection('versions').doc(e.versionId).collection('notes');
  const [first, replies] = await Promise.all([
    notes.doc(e.threadId).get(),
    notes.where('parentId', '==', e.threadId).get()
  ]);
  const people = new Set(replies.docs.map(d => d.data().by));
  if (first.exists) people.add(first.data().by);
  people.delete(e.by);
  return [...people].filter(Boolean);
}

/* What each logged action says, or null for those that do not notify. An
 * observation's entry names the observation from release 128 on, and its
 * text is added to it then; one from an older release says only where. */
function _describe(e) {
  const who = _firstName(e);
  const v = `„${e.versionTitle || 'o versiune'}”`;
  switch (e.action) {
    case 'note_added': return e.reply
      ? `${who} a răspuns la o observație la ${_noteWhere(e)}`
      : `${who} a lăsat o observație la ${_noteWhere(e)}`;
    case 'version_text': return `${who} a editat ${v}`;
    case 'original_text': return `${who} a editat originalul`;
    case 'version_added': return `${who} a adăugat ${v}`;
    case 'status': return `${who} a marcat melodia ca „${STATUS_LABELS[e.status] || e.status}”`;
    case 'working': return e.working ? `${who} lucrează acum la ea` : null;
    default: return null;
  }
}

exports.notifySongActivity = onDocumentCreated(
  { document: 'groups/{groupId}/activity/{entryId}', region: REGION },
  async (event) => {
    const e = event.data && event.data.data();
    const body = e && e.songId && _describe(e);
    if (!body) return;
    const song = await _song(e.songId);
    if (!song) return;
    const where = { kind: e.action, songId: e.songId, by: e.by, workers: song.workers || [] };
    const reply = e.action === 'note_added' && e.reply && e.versionId && e.threadId;
    let recipients = reply ? await _threadPeople(e) : _recipients(song, e.by);
    const text = e.action === 'version_text' || e.action === 'original_text';
    if (text) recipients = await _dueForText(e.songId, recipients, Date.now());
    // No tag, so none replaces another: on a Mac, Chrome swaps a tagged
    // one in silently, and a second status change in a row went unseen.
    const data = { title: song.title || e.songTitle || 'Fără titlu', body, songId: e.songId };
    if (e.action === 'note_added' && e.versionId) {
      const said = await _noteText(e).catch(() => '');
      if (said) data.body = `${_firstName(e)}${e.reply ? ' a răspuns' : ''} la ${_noteWhere(e)}: ${said}`;
      data.versionId = e.versionId;
    }
    await _send(where, recipients, data);
  }
);
