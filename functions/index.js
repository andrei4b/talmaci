/* functions/index.js — Cloud Functions for Tălmaci.
 *
 * translateWithDeepL: a callable function that proxies a translation
 * request to DeepL. Runs server-side so the DeepL API key never appears
 * in client code (this repo is public), and so the browser doesn't have
 * to make a cross-origin request DeepL's API isn't set up to allow.
 *
 * Setup:
 *   1. Get a DeepL API key at deepl.com/pro-api (Free tier: 500k
 *      chars/month). Free-tier keys end in ":fx" — this function detects
 *      that suffix and calls api-free.deepl.com instead of api.deepl.com
 *      automatically, so you don't need to configure which one.
 *   2. Store it as a secret (never commit it):
 *        firebase functions:secrets:set DEEPL_API_KEY
 *   3. Deploy: firebase deploy --only functions
 *
 * See README.md for the full walkthrough. */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

const DEEPL_API_KEY = defineSecret('DEEPL_API_KEY');

exports.translateWithDeepL = onCall({ secrets: [DEEPL_API_KEY] }, async (request) => {
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

  const apiKey = DEEPL_API_KEY.value();
  const apiHost = apiKey.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';

  let res;
  try {
    res = await fetch(`https://${apiHost}/v2/translate`, {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: [text],
        source_lang: 'EN',
        target_lang: 'RO'
      })
    });
  } catch (err) {
    throw new HttpsError('unavailable', 'Nu am putut contacta DeepL: ' + err.message);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new HttpsError('unavailable', `DeepL a răspuns cu eroare (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const translatedText = data && data.translations && data.translations[0] && data.translations[0].text;
  if (!translatedText) {
    throw new HttpsError('internal', 'Răspuns neașteptat de la DeepL.');
  }

  return { translatedText };
});
