# Tălmaci — Atelier de versuri

A PWA for writing Romanian song lyrics, shared across a team. Sign in with
Google, and everyone in your group works from the same library. A song is
either a **translation** of an English original, which opens with the
source alongside the text, or a **composition** of your own, which opens
with a single box; the list filters by either. No build step: plain
HTML/CSS/JS, backed by Firebase (Authentication + Firestore).

Four tabs sit under every screen — **Text**, **Rime**, **Sinonime**,
**Biblie** — so they are reachable from the song list without opening
anything.

**Text**, **Rime** and **Sinonime** work. Text edits a song's lyrics across
multiple named versions, so several people can draft in parallel. Sections
(verse, chorus, bridge…) are marked in the text itself by a line such as
`[Refren]` — the form lyrics pasted from the web already use. Typing `[`
at the start of a line offers the section names, the original's next one
first, and the source panel sets the marks apart; see `js/sections.js`.
A translation can also be shown **pe strofe** (the button beside the
song's menu): each verse of the original above its verse of the
translation, paired by position, with a note where the two sides'
counts or section marks disagree. Rime
looks a word up in a 210k-word index built from dexonline and returns its
perfect rhymes, with the stressed syllable marked; its index is built
offline, see `tools/rhyme/README.md`. Sinonime shows dexonline's *Dicționar
de sinonime* in the app — no local index and no search field of ours,
because every redistributable synonym dataset turned out markedly worse
than that dictionary, whose text is not among the data dexonline
distributes. **Biblie** is still a placeholder.

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

## Notifications for observations (optional)

Anyone working on a song can get a notification, on each device where they
turn it on from the account menu, when someone else leaves an observation
on one of its versions. Android and desktop browsers get them as they are;
an iPhone or iPad only once the app is added to the Home Screen (iOS 16.4
or later). See `js/push.js` and `notifyObservation` in `functions/index.js`.

1. Firebase console → Project settings → Cloud Messaging → Web Push
   certificates → **Generate key pair**, and put the key into
   `js/firebase-config.js` as `window.FIREBASE_VAPID_KEY`. Until then the
   app offers no notifications.
2. Publish `firestore.rules` (it lets each member store their devices).
3. `firebase deploy --only functions`.

## Google Translate "Mot-a-mot" translations (optional)

A song's kebab menu can generate a literal machine translation into a version
named **"Mot-a-mot"** — a starting point to work from, not a substitute for
the real translation. This calls the Google Cloud Translation API through a
Cloud Function (`functions/index.js`), never directly from the browser.
Unlike the DeepL version this replaced, there's no API key to manage at
all — the function authenticates as its own Google Cloud service account.
Skip this section entirely if you don't want the feature — the rest of the
app works without it.

1. In the [Google Cloud Console](https://console.cloud.google.com) for this
   Firebase project, go to **APIs & Services → Library**, search for
   **Cloud Translation API**, and enable it.
2. **IAM & Admin → IAM** → find the service account your functions run as
   (for 2nd-gen functions, usually the one ending in
   `@<project-id>.iam.gserviceaccount.com` named "Default compute service
   account") → **Edit principal** → **Add another role** → grant
   **Cloud Translation API User**.
3. Upgrade your Firebase project to the **Blaze** (pay-as-you-go) plan —
   Cloud Functions need it. Firebase console → your project → the upgrade
   prompt at the bottom of the left sidebar. Cloud Translation itself has a
   free tier (500,000 characters/month, resets monthly), so normal usage
   shouldn't cost anything either.
4. Install the Firebase CLI and sign in (needs Node 18+ locally; the
   functions themselves run on Node 20 regardless of your local version):
   ```bash
   npm install -g firebase-tools
   firebase login
   ```
5. Install the function's dependencies and deploy:
   ```bash
   cd functions && npm install && cd ..
   firebase deploy --only functions
   ```
6. That's it — the kebab menu's "Mot-a-mot" button will start working. No client-side config needed; `js/translate.js` calls the
   deployed function by name.

If a translation ever fails (API not enabled yet, IAM role missing, quota
exceeded, function not deployed), it just shows an error toast — nothing
else about the app is affected.

## English dictionary (Dicționare → Engleză)

The Dicționare tab's Engleză view uses Merriam-Webster's **Collegiate
Dictionary**, their main dictionary, for the English original. The
English one is looked up through a second Cloud Function, `defineEnglish`,
which keeps the API key out of the page. It needs the same Blaze plan and
Firebase CLI as the translation function above.

1. Register for a free key at
   [dictionaryapi.com](https://dictionaryapi.com/register/index) and pick
   **Collegiate Dictionary** as one of the two references. The free tier is
   non-commercial and allows 1,000 lookups a day.
2. Store the key as a secret (the CLI prompts for it):
   ```bash
   firebase functions:secrets:set MW_COLLEGIATE_KEY
   ```
3. Deploy:
   ```bash
   firebase deploy --only functions
   ```

Until that is done the Engleză view shows an error under the search field,
and nothing else is affected.

Merriam-Webster doesn't report how much of the daily limit is used, so the
function counts its own lookups, one Firestore document per UTC day
(`usage/mw-YYYY-MM-DD`), and the view shows the count under the search field.
The count is for the whole app, since the key is shared by every group.

## Bible dictionary (Dicționare → Biblic)

Easton's Bible Dictionary (1897), with the International Standard Bible
Encyclopedia (1915) under a "Mai mult (ISBE)" button for the same word. Both
are public domain, from CrossWire's SWORD modules; see
`data/BIBLIC-LICENSE.md`. Verse references open the verse in the Biblie tab.

Nothing to set up: the data is static, in `data/biblic/`. It is 28 MB in all,
so it is cut into chunks of about 200 KB that load as entries are opened, and
the service worker keeps them for offline use. To rebuild it from the
modules in `data/build-inputs/`:

```bash
node tools/biblic/build-index.js
```

After a rebuild, bump `BIBLIC_CACHE` in `service-worker.js`.

## Deploy it for real use

This repo includes `.github/workflows/deploy-pages.yml`, which deploys to
GitHub Pages automatically on every push to `main`. In the repo's Settings →
Pages, set **Source** to "GitHub Actions" once. After that, every push
publishes the new version.

Once deployed over HTTPS, visit the URL on your phone and add it to your
home screen. It then works offline: the service worker keeps the app, the
Bible and the rhyme index, and Firestore keeps a copy of the songs already
opened on that device (IndexedDB), so they open and can be edited without a
connection — the edits are sent when it is back. Other changes (new songs,
status, notes…) need the connection. Signing out clears the device's copy.

## Song status

A song's menu has **Stare**: where the song stands — *Ciornă*, *În revizie*
or *Final* — and who is working on it, which anyone adds or removes
themselves from with one tap. The song list shows both under each title
(a draft with nobody on it shows nothing). Unlike the rest of a song,
any group member may change these two on a shared song; `firestore.rules`
allows exactly those fields, so **paste the updated rules into the
Firebase console** (Firestore → Rules → Publish) for this to work for
members who did not create the song.

The same goes for the order of a song's versions, which anyone arranges by
dragging the handle beside each one in the **Versiuni** sheet.

## Groups & roles

- **Sign-in** is Google-only. A brand-new sign-in with no profile lands on
  a "join your group" screen where they redeem an **invite code**.
- **Groups**: every song belongs to exactly one group; everyone in a group
  sees and can edit all of that group's songs. There's no self-serve way to
  create a new group — the app owner creates each group by hand, enforced
  by `firestore.rules` denying `/groups` writes outright.
- **Super-admin**: the app owner's Google account (andrei4.bulzan@gmail.com,
  hard-coded in `firestore.rules` and `js/auth.js`). Only they can generate
  invite codes and promote/demote members (**Gestionează membrii**), and
  they have every admin power over songs too. It is not stored in a
  profile, so nothing written to Firestore can grant it.
- **Admin**: may edit or delete any shared song or version, and delete
  any observation, not just their own.
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
js/translate.js                 Client for the translateText function
js/utils.js                      DOM helpers, toast, sheet stack
js/ro-phonetics.js                Romanian G2P, syllables, stress — shared
                                    by the app AND the index build script
js/rhyme.js                        Loads the rhyme index, answers queries
js/songs.js                         Main page: song list, search, add song
js/song-detail.js                    Song page: the text and its editor
js/engleza-tab.js                    Dicționare → Engleză (Merriam-Webster)
js/biblic-tab.js                     Dicționare → Biblic (Easton's, ISBE)
js/app.js                             Sign-in/join gating, routing, account
functions/index.js                     Cloud Functions: Google Translate and
                                         Merriam-Webster proxies (optional,
                                         see above)
tools/rhyme/                            Offline build for the rhyme index —
                                          dev-only, never ships
data/biblic/                             Generated Bible dictionaries (public
                                           domain, see BIBLIC-LICENSE.md)
data/rhyme-index.json                    Generated rhyme dataset (GPL v2+,
                                           see RHYME-INDEX-LICENSE.md)
icons/                                    App icons (192, 512, maskable 512 —
                                            placeholder "T" mark)
```

No npm install, no bundler — open `index.html` in a browser (via a local
server, not `file://`, since service workers require http/https) and it
runs.

## Rime (rhyme finder)

Romanian words rhyme when they sound identical from the last **stressed**
vowel onward — and Romanian never writes stress, which is the whole
difficulty. Matching word endings is not enough: *cámeră* and *himéră* share
"-eră" but are stressed differently and do not rhyme.

The Rime tab solves that with a prebuilt index of dexonline inflected
forms, the great majority carrying stress attested rather than guessed.
Results are sorted by how common the word actually is.

Word frequency is blended from two corpora on purpose: OpenSubtitles for
spoken Romanian and Wikipedia for written/literary Romanian. Subtitles
alone rank words like *preamărit* or *nemărginit* dead last simply because
they never occur in film dialogue — which is precisely the vocabulary a
song text wants. Forms attested in neither corpus are dropped entirely,
since dexonline lists every archaic and regional inflection and those were
noise as suggestions.

- **Rime perfecte** — identical from the stressed vowel on.
- **Asonanțe** — matching vowels, differing consonants. Disabled for
  one-syllable words, where a single vowel matches nearly everything.
- **Silabe** — restrict results to a syllable count, for fitting a fixed
  metrical slot.

The index (~5.3 MB) loads in the background once the app is idle after
boot, like the Bible, so a search does not wait on it; the service worker
keeps it cached, so it downloads again only when a new version ships. See `tools/rhyme/README.md` to rebuild it
and `data/RHYME-INDEX-LICENSE.md` for sources and attribution.

## What's next

- **Biblie** tab: Bible cross-references relevant to the text.
- Real app icons (the current ones are a generated placeholder).
