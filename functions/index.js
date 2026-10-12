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
 * Merriam-Webster's Learner's Dictionary. Proxied for the key, not for
 * CORS — their API answers browsers directly — since a key in the page
 * would be anyone's to read and spend, and the free tier is 1000 calls a
 * day. It is kept as a secret:
 *   firebase functions:secrets:set MW_LEARNERS_KEY
 *
 * See README.md for the full walkthrough. */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { Translate } = require('@google-cloud/translate').v2;

const MW_LEARNERS_KEY = defineSecret('MW_LEARNERS_KEY');

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

/* The entries as Merriam-Webster sends them, for the client to lay out.
 * A word they do not have comes back as an array of spelling suggestions
 * (plain strings) instead, which is passed on the same way. */
exports.defineEnglish = onCall({ secrets: [MW_LEARNERS_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Trebuie să fii autentificat.');
  }

  const word = (request.data && request.data.word || '').trim();
  if (!word) {
    throw new HttpsError('invalid-argument', 'Lipsește cuvântul.');
  }
  if (word.length > 100) {
    throw new HttpsError('invalid-argument', 'Cuvântul e prea lung.');
  }

  const url = 'https://www.dictionaryapi.com/api/v3/references/learners/json/' +
    encodeURIComponent(word) + '?key=' + encodeURIComponent(MW_LEARNERS_KEY.value());
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
  return { entries: Array.isArray(entries) ? entries : [] };
});
