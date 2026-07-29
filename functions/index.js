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
 * See README.md for the full walkthrough. */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { Translate } = require('@google-cloud/translate').v2;

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
