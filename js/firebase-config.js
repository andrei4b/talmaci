/* firebase-config.js — Firebase web app config.
 * These values are identifiers, not secrets: they're safe to ship in client
 * code. Data protection comes from Firestore security rules, not from hiding
 * this config. Exposed as a global so auth.js can initialize Firebase.
 *
 * Replace these placeholders with your own Firebase project's web app
 * config (Firebase console → Project settings → Your apps → SDK setup and
 * configuration). See README.md for the full setup walkthrough. */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyB1y3IBVEgGYPvgvZPdAdXzlNp-q5Z0Pls",
  authDomain: "talmaci.firebaseapp.com",
  projectId: "talmaci",
  storageBucket: "talmaci.firebasestorage.app",
  messagingSenderId: "741806141674",
  appId: "1:741806141674:web:dc0c141968b89735dce793"
};

// The public half of the Web Push key pair, for notifications (see
// js/push.js): Firebase console → Project settings → Cloud Messaging → Web
// Push certificates → Generate key pair. Public too. While empty, the app
// offers no notifications.
window.FIREBASE_VAPID_KEY = 'BCSci_oQnmnJazj2dDPWOAiVbdlaEX-udrzKMH_U8Y34WPu06tK1IcOd4mztzjSi2XSTZAHj9DcVAsgSCgiuvgk';
