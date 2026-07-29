# Tălmaci - Your Song Translation Toolkit

A PWA for translating songs from English to Romanian, shared across a
translation team. Sign in with Google, and everyone in your group works
from the same song library — each song opens into four tabs: **Text**,
**Rime**, **Sinonime**, and **Biblie**. No build step: plain HTML/CSS/JS,
backed by Firebase (Authentication + Firestore).

This is a skeleton: the **Text** tab has working functionality (view the
original, edit and save the Romanian translation); **Rime**, **Sinonime**,
and **Biblie** are placeholders, ready for their functionality to be
specified.

## Run it locally

Any static file server works. From this folder:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in your browser. On a phone, use **Add to
Home Screen** (Safari) or the install prompt (Chrome/Android) to install it
as an app.

You'll need your own Firebase project's config in `js/firebase-config.js`
(see below) for sign-in and data to work — the app renders a sign-in screen
but nothing else without it.

## Firebase setup

This app needs a Firebase project with **Authentication** (Google Sign-In
provider enabled) and **Firestore** turned on.

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com).
2. Authentication → Sign-in method → enable **Google**.
3. Authentication → Settings → Authorized domains → add your GitHub Pages
   domain (e.g. `yourusername.github.io`) and keep `localhost` for local
   testing.
4. Build → Firestore Database → Create database (start in production mode;
   the rules in this repo lock it down).
5. Project settings → General → Your apps → add a **Web app**, then copy
   its config object into `js/firebase-config.js` as `window.FIREBASE_CONFIG`
   (this is a public client key, safe to commit — Firestore's security
   rules are the real access boundary, not this key).
6. Publish `firestore.rules` (in this repo, for reference) to your project
   in the Firebase console — Firestore → Rules → paste → Publish. This repo
   copy does **not** auto-deploy; you must paste it in yourself whenever it
   changes.
7. Create the first group and its admin by hand (there's no self-serve
   "create a group" flow): add a `/groups/{id}` document, then a
   `/users/{yourUid}` document with `role: "admin"` and `groupId` pointing
   at it.

## DeepL "Mot-a-mot" translations (optional)

A song's kebab menu (and a prompt right after you save a song, or edit its
original text) can generate a literal machine translation into a version
named **"Mot-a-mot"** — a starting point to work from, not a substitute for
the real translation. This calls DeepL through a Cloud Function
(`functions/index.js`), never directly from the browser, since a DeepL key
shouldn't be exposed in this repo's public client code and DeepL's API
isn't set up for direct browser calls anyway. Skip this section entirely if
you don't want the feature — the rest of the app works without it.

1. Get a DeepL API key at [deepl.com/pro-api](https://www.deepl.com/pro-api)
   (the Free tier gives 500,000 characters/month at no cost).
2. Upgrade your Firebase project to the **Blaze** (pay-as-you-go) plan —
   Cloud Functions need it, even though this function's usage will likely
   stay within Blaze's free monthly quota. Firebase console → your project
   → the upgrade prompt at the bottom of the left sidebar.
3. Install the Firebase CLI and sign in (needs Node 18+ locally; the
   functions themselves run on Node 20 regardless of your local version):
   ```bash
   npm install -g firebase-tools
   firebase login
   ```
4. Store your DeepL key as a secret (never commit it — it's not in any file
   in this repo):
   ```bash
   firebase functions:secrets:set DEEPL_API_KEY
   ```
5. Install the function's dependencies and deploy:
   ```bash
   cd functions && npm install && cd ..
   firebase deploy --only functions
   ```
6. That's it — the "Mot-a-mot" prompts and the kebab menu button will start
   working. No client-side config needed; `js/deepl.js` calls the deployed
   function by name.

If a translation ever fails (DeepL down, quota exceeded, function not
deployed yet), it just shows an error toast — nothing else about the app is
affected.

## Deploy it for real use

This repo includes `.github/workflows/deploy-pages.yml`, which deploys to
GitHub Pages automatically on every push to `main`. In the repo's Settings →
Pages, set **Source** to "GitHub Actions" once. After that, every push
publishes the new version.

Once deployed over HTTPS, visit the URL on your phone and add it to your
home screen. The app shell (not the data) then works offline, via the
service worker.

## Groups & roles

- **Sign-in** is Google-only. A brand-new sign-in with no profile lands on
  a "join your group" screen where they redeem an **invite code**.
- **Groups**: every song belongs to exactly one group; everyone in a group
  sees and can edit all of that group's songs. There's no self-serve way to
  create a new group — the app owner creates each group by hand, enforced
  by `firestore.rules` denying `/groups` writes outright.
- **Admin**: can generate invite codes and (once that screen is built)
  promote/demote members. Unlike worship-setlist, songs are **not**
  admin-gated — any group member can add, edit, or delete songs, since
  translation is collaborative team work.
- All of this is enforced server-side in `firestore.rules`, not just hidden
  in the UI.

## Project structure

```
index.html                Entry point
styles.css                 All styling (design tokens at the top)
manifest.webmanifest        PWA install metadata
service-worker.js          App-shell offline caching (bypasses Firebase/
                             Google API traffic — never caches your data)
firestore.rules             Security rules (reference copy — publish to
                             the Firebase console manually, see above)
js/firebase-config.js        Your Firebase project's public web config
js/auth.js                    Firebase Auth + user profile (role, group)
js/db.js                       Firestore data layer (songs, versions)
js/deepl.js                     Client for the translateWithDeepL function
js/utils.js                      DOM helpers, toast
js/songs.js                       Main page: song list, search, add song
js/song-detail.js                  Song page: Text/Rime/Sinonime/Biblie tabs
js/app.js                           Sign-in/join gating, routing, account menu
functions/index.js                   Cloud Function: DeepL proxy (optional,
                                       see "DeepL Mot-a-mot" above)
icons/                                 App icons (192, 512, maskable 512 —
                                        placeholder "T" mark, swap for real
                                        artwork)
```

No npm install, no bundler — open `index.html` in a browser (via a local
server, not `file://`, since service workers require http/https) and it
runs.

## What's next

- **Rime** tab: rhyme lookup for Romanian words in the translation.
- **Sinonime** tab: synonym lookup for Romanian words in the translation.
- **Biblie** tab: Bible cross-references relevant to the text.
- Real app icons (the current ones are a generated placeholder).
