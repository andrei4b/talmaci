/* firebase-config.js — Firebase web app config.
 * These values are identifiers, not secrets: they're safe to ship in client
 * code. Data protection comes from Firestore security rules, not from hiding
 * this config. Exposed as a global so auth.js can initialize Firebase.
 *
 * Replace these placeholders with your own Firebase project's web app
 * config (Firebase console → Project settings → Your apps → SDK setup and
 * configuration). See README.md for the full setup walkthrough. */
window.FIREBASE_CONFIG = {
  apiKey: "REPLACE_WITH_YOUR_API_KEY",
  authDomain: "REPLACE_WITH_YOUR_PROJECT.firebaseapp.com",
  projectId: "REPLACE_WITH_YOUR_PROJECT",
  storageBucket: "REPLACE_WITH_YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "REPLACE_WITH_YOUR_SENDER_ID",
  appId: "REPLACE_WITH_YOUR_APP_ID"
};
