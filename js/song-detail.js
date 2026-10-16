/* song-detail.js — one song, opened from the list: its header and its
 * text: the source on one side and the translation on the other, or a
 * single box when the song is a composition of our own.
 *
 * This is what the Text tab shows once you open a song; the list is what
 * it shows before that. The tab bar itself belongs to the app shell
 * (app.js), which keeps it on screen everywhere, so nothing here knows
 * about Rime, Sinonime or Biblie any more.
 *
 * Either way the text supports multiple named versions (so several people
 * can draft in parallel) via the version switcher below the box — see
 * db.js's versions subcollection. */
(function () {
const { el, toast, debounce, openSheet, closeSheet, closeSheetThen, icons, menuLabel, normalizeUrl, isOriginal, orderVersions,
        isShared, SONG_STATUSES, songStatus, statusLabel, songWorkers,
        isNetworkError, failText, offlineNotice } = window.Utils;

// A verse not written yet, holding its place in its row (see write).
const STAND_IN = { mark: '…', lyrics: '' };

const ROW_ICONS = {
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  delete: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`,
  // Six dots — something to take hold of and drag.
  drag: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>`
};

// Two stacked pairs of lines — the original over its translation.

// A magnifier — looks the word at the caret up in Rime, Sinonime or the
// English dictionary.
const LOOKUP_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>`;

// A speech bubble — the team's observations on a version.
// A tag with a plus: a mark to add, on a verse that has none.
const ADD_LABEL_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3H4v8l9 9 7-7-8-8z"/><circle cx="8" cy="7" r="1"/><path d="M19 2v6M16 5h6"/></svg>`;
const NOTES_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H10l-5 4v-4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 8.5h10M7 12.5h6"/></svg>`;

// A heart — given to an observation; filled once it is yours.
const HEART_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.6-9.6-9.3A5.2 5.2 0 0 1 12 6.6a5.2 5.2 0 0 1 9.6 4.6c-2.1 4.7-9.6 9.3-9.6 9.3z"/></svg>`;

// The sections offered when marking one, in the order a song usually runs.
// Strofa is left out: it is offered numbered, as the next one due.
const SECTION_CHOICES = ['Pre-refren', 'Refren', 'Bridge', 'Intro', 'Interludiu', 'Final'];
const SECTION_CHOICES_EN = ['Pre-Chorus', 'Chorus', 'Bridge', 'Intro', 'Interlude', 'Outro'];

const UNDO_REDO_ICONS = {
  undo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>`,
  redo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>`
};

let _song = null;
let _versions = [];       // [{ id, title, text, createdAt, updatedAt }]

/* The team's observations on each version (see db.js), by version id, and
 * when you last read each version's — the two together are what puts the
 * dot on a version's button. The observations are kept live while the
 * song is on screen (see _watchNotes); when they were last read is fetched
 * with the song. */
let _notes = new Map();
let _seen = {};
let _activeVersionId = null;

// Remembers which version was last viewed, per song, per device — a
// personal UI preference, not shared team data, so this is localStorage
// rather than Firestore. Falls back to the last version in the list —
// unless they have been arranged, the most recently created — if
// nothing's remembered, or if the remembered one no longer exists.
function _rememberedVersionKey(songId) {
  return `talmaci:lastVersion:${songId}`;
}
function _rememberVersion(songId, versionId) {
  try {
    if (versionId) localStorage.setItem(_rememberedVersionKey(songId), versionId);
    else localStorage.removeItem(_rememberedVersionKey(songId));
  } catch (_) { /* localStorage unavailable (private browsing etc.) — fine, just no memory */ }
}
function _recallVersion(songId) {
  try { return localStorage.getItem(_rememberedVersionKey(songId)); } catch (_) { return null; }
}

// Undo/redo history for the translation textarea — scoped to whichever
// version is active, reset when the active version actually changes (see
// _syncUndoState), but preserved across incidental re-renders of the same
// version (e.g. after renaming it).
//
// The original text, editable in place too, keeps a history of its own,
// scoped to the song: undo steps back through whichever of the two was
// edited last, never one on behalf of the other.
function _newHistory(verses) {
  return { undo: [], redo: [], last: verses || [], pending: false };
}
let _undoStateVersionId;
let _versionHistory = _newHistory();
let _originalHistory = null;
let _originalHistorySongId = null;
// With every version on screen at once (see _showingVerseGrid), each
// keeps its own history; these are the ones not active right now. Dropped
// whenever _syncUndoState starts the active version's history afresh.
let _otherHistories = new Map();

// Scroll position of the verses. Reset inside _syncUndoState, right
// alongside the undo history, since both are scoped to "which version"
// the same way.
let _versesScrollTop = 0;

/* On a big screen every version gets a column of its own — beside the
 * original, for a translation — so each row lines up the same verse in all
 * of them; see _renderVersesView. The active version is then simply the
 * one last written in: the switcher names it, and undo and the lookup act
 * on it. Resizing across the breakpoint redraws the song page it is on. */
const WIDE = window.matchMedia('(min-width: 1024px)');
let _shellRoot = null;
function _showingVerseGrid() {
  return WIDE.matches && _versions.length > 1;
}
WIDE.addEventListener('change', () => {
  if (_song && _shellRoot && _shellRoot.isConnected) _renderShell(_shellRoot);
});

/* `openNotesFor`, a version id, opens that version's observations once
 * the song is on screen — from a tapped notification. `entered`: the song
 * is being arrived at (see _renderRoute in app.js), so it is read afresh
 * even if it is the one last open, which may have changed since. */
async function render(root, songId, openNotesFor, entered) {
  if (!entered && _song && _song.id === songId) {
    // A tab switch back, or a "back" from Rime/Sinonime/Biblie — not a
    // real navigation. Redraw from what's already loaded instead of
    // hitting Firestore again; "Reîmprospătează" in the kebab menu is
    // there for when a fresh copy is wanted without leaving.
    _showNotesFor(openNotesFor);
    _renderShell(root);
    if (openNotesFor) _rewatchNotes();
    _openNotesFor(openNotesFor);
    return;
  }
  // Undo starts from the texts as they are read now, the song last open
  // included, as it would for any other.
  _undoStateVersionId = undefined;
  _originalHistory = null;
  // And its observations' listeners start afresh with it, in case one
  // ended while the song was off screen.
  _unwatchNotes();
  // Set once the song turns out not to be there, so leaving it takes its
  // entry out of the history rather than leaving it to be gone back to.
  let gone = false;
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'topbar' }, [
    el('button', {
      class: 'btn btn--icon',
      'aria-label': 'Înapoi',
      html: icons.back,
      // Up to the list, which is not the same as back now that a song can
      // also be reached from the other tabs — see goUpToList in app.js.
      onclick: () => window.App.goUpToList(gone)
    }),
    el('h1', { class: 'topbar__title' }, ['Se încarcă…'])
  ]));
  root.appendChild(el('div', { class: 'loading-state' }, [
    el('div', { class: 'spinner' })
  ]));

  try {
    _song = await window.Db.getSong(songId);
    _versions = _song ? orderVersions(_song, await window.Db.listVersions(songId)) : [];
    // Their verses in the shape the rest expects, whatever was stored.
    if (_song) _song.originalVerses = window.Verses.read(_song.originalVerses);
    _versions.forEach(v => { v.verses = window.Verses.read(v.verses); });

    const remembered = _versions.some(v => v.id === openNotesFor) ? openNotesFor : _recallVersion(songId);
    const rememberedStillExists = remembered && _versions.some(v => v.id === remembered);
    _activeVersionId = rememberedStillExists ? remembered
      : (_versions.length ? _versions[_versions.length - 1].id : null);
  } catch (err) {
    _song = null;
    if (isNetworkError(err)) {
      root.querySelector('.topbar__title').textContent = 'Fără internet';
      root.querySelector('.loading-state').replaceWith(offlineNotice({
        text: 'Melodia nu a mai fost deschisă pe acest dispozitiv.',
        hint: 'Fără internet se deschid doar melodiile deschise deja. Rimele și Biblia merg oricând.',
        retry: () => render(root, songId)
      }));
      return;
    }
    // Anything else that went wrong, shown in place of the spinner so the
    // page never keeps loading forever.
    root.querySelector('.topbar__title').textContent = 'Eroare';
    root.querySelector('.loading-state').replaceWith(el('div', { class: 'empty-state' }, [
      el('p', {}, [failText('Nu am putut încărca melodia', err)]),
      el('button', { class: 'btn', onclick: () => render(root, songId, openNotesFor, true) }, ['Încearcă din nou'])
    ]));
    return;
  }

  if (!_song) {
    // Deleted, or not visible to this member (see Db.getSong). Reached by
    // going back to a song deleted on another device, or deleted here
    // before deleting stopped leaving it in the history. The list's copy
    // forgets it too, or it would stay there to be opened again.
    window.Songs.noteDeleted(songId);
    gone = true;
    root.querySelector('.topbar__title').textContent = 'Melodie indisponibilă';
    root.querySelector('.loading-state').replaceWith(el('div', { class: 'empty-state' }, [
      el('p', {}, ['Melodia nu mai există.']),
      el('p', { class: 'empty-state__hint' }, ['A fost ștearsă, sau nu este vizibilă pentru contul tău.']),
      el('button', { class: 'btn', onclick: () => window.App.goUpToList(true) }, ['Înapoi la listă'])
    ]));
    return;
  }

  _showNotesFor(openNotesFor);
  _renderShell(root);
  // A tapped notification's observations open once it is known when you
  // last read them: opened before, every one of them was marked new.
  const seenRead = _loadNotes();
  if (openNotesFor) seenRead.then(() => { if (_songOnScreen() && _song.id === songId) _openNotesFor(openNotesFor); });
}

// Brings the version up whose observations a notification is about.
function _showNotesFor(versionId) {
  if (!_versions.some(v => v.id === versionId)) return;
  _activeVersionId = versionId;
  _rememberVersion(_song.id, versionId);
}

function _openNotesFor(versionId) {
  const version = _versions.find(v => v.id === versionId);
  if (version && _hasNotes()) _openNotes(version);
}

function _renderShell(root) {
  _shellRoot = root;
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'topbar' }, [
    el('button', {
      class: 'btn btn--icon',
      'aria-label': 'Înapoi',
      html: icons.back,
      // Up to the list, which is not the same as back now that a song can
      // also be reached from the other tabs — see goUpToList in app.js.
      onclick: () => window.App.goUpToList()
    }),
    el('h1', { class: 'topbar__title' }, [_song.title || 'Fără titlu']),
    el('button', {
      class: 'btn btn--icon',
      'aria-label': 'Meniu melodie',
      html: icons.kebab,
      onclick: () => _openSongMenu(root)
    })
  ]));

  // No tab bar here any more: it belongs to the app shell, which draws it
  // under every screen including the song list. A song page is simply what
  // the Text tab shows once you open something.
  const content = el('div', { class: 'tab-content' });
  root.appendChild(content);
  _renderTextTab(content);
}

/* ---- observations ---- */

// Only a shared song has a team to leave them.
function _hasNotes() {
  return !!_song && isShared(_song);
}

// When you last read the song's observations; they themselves come live.
async function _loadNotes() {
  const songId = _song.id;
  // The names to put on the notes and on who is working, in hand before
  // either sheet is opened.
  window.Auth.groupMembers();
  if (!_hasNotes()) return;
  try {
    const seen = await window.Db.getSeen(window.Auth.currentUser().uid, songId);
    if (!_song || _song.id !== songId) return;
    _seen = seen;
    _syncNoteDots();
  } catch (_) { /* no dots until they are read */ }
}

/* The open song's observations, live: a listener on each version's, so a
 * reply, a heart or a thread marked done by someone else shows up by
 * itself — on the verse buttons, the dots, and in an open sheet (each of
 * which registers in _noteRedraws while it is up). Kept in step with the
 * versions whenever the text is drawn, and stopped for another song, or
 * at the first change after the song has left the screen; coming back to
 * it draws it again, which starts them anew. */
let _noteWatch = { songId: null, stops: new Map() };
const _noteRedraws = new Set();

// Stops the listeners. The song's observations are kept as they were, to
// be brought up to date when it is drawn again; for another song, or no
// song at all, `forget` drops them.
function _unwatchNotes(forget) {
  _noteWatch.stops.forEach(stop => stop());
  _noteWatch.stops = new Map();
  if (forget) _noteWatch.songId = null;
}

function _watchNotes() {
  if (!_hasNotes()) { _unwatchNotes(true); _notes = new Map(); _seen = {}; return; }
  if (_noteWatch.songId !== _song.id) {
    _unwatchNotes(true);
    _noteWatch.songId = _song.id;
    _notes = new Map();
    _seen = {};
  }
  const songId = _song.id;
  const ids = new Set(_versions.map(v => v.id));
  for (const [id, stop] of _noteWatch.stops) {
    if (!ids.has(id)) { stop(); _noteWatch.stops.delete(id); _notes.delete(id); }
  }
  _versions.forEach(v => {
    if (_noteWatch.stops.has(v.id)) return;
    const stop = window.Db.watchNotes(songId, v.id, (list) => {
      if (!_song || _song.id !== songId) return;
      if (!_songOnScreen()) { _unwatchNotes(); return; }
      _notes.set(v.id, list);
      _syncNoteDots();
      _noteRedraws.forEach(redraw => redraw(v.id));
    }, (err) => {
      // Firestore ends a listener for good on an error — a sign-in that
      // lapsed for a moment after the app sat idle, say. Left in place it
      // would never bring anything again; dropped, it is started anew.
      console.warn('Observations stopped coming in:', err && (err.code || err.message));
      if (_noteWatch.stops.get(v.id) === stop) _noteWatch.stops.delete(v.id);
      setTimeout(() => { if (_songOnScreen() && _song.id === songId) _watchNotes(); }, WATCH_RETRY_MS);
    });
    _noteWatch.stops.set(v.id, stop);
  });
}
const WATCH_RETRY_MS = 5000;

function _songOnScreen() {
  return !!_song && !!_shellRoot && _shellRoot.isConnected;
}

/* The listeners started afresh, for when the ones running may have
 * fallen behind: the app back on screen after a while away — a phone
 * puts a backgrounded app's connection to sleep — or a notification
 * tapped, which should show what it is about. A new listener answers
 * from the device's copy first and then from the server. */
function _rewatchNotes() {
  if (!_songOnScreen()) return;
  _unwatchNotes();
  _watchNotes();
}
const AWAY_MS = 30 * 1000;
let _hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { _hiddenAt = Date.now(); return; }
  if (_hiddenAt && Date.now() - _hiddenAt >= AWAY_MS) _rewatchNotes();
  _hiddenAt = 0;
});

/* A version's observations as threads (see threads.js), each found in the
 * version's text as it reads now: `loc` is where its verse is, or null for
 * a thread on the whole version. */
function _threadsOf(version) {
  const verses = version.verses || [];
  return window.Threads.group(_notes.get(version.id) || []).map(t => {
    t.loc = t.anchor ? window.Threads.locate(verses, t.anchor) : null;
    return t;
  });
}

// When you last read a thread: all of its version's at once, or that one
// on its own, from its verse — whichever was later.
function _seenAt(seen, versionId, threadId) {
  return Math.max(seen[versionId] || 0, seen[versionId + ':' + threadId] || 0);
}

// Someone else's observation in a thread since you last read it.
function _threadUnread(versionId, t, seen) {
  const me = window.Auth.currentUser().uid;
  const at = _seenAt(seen || _seen, versionId, t.id);
  return t.notes.some(n => n.by !== me && n.at > at);
}

function _hasUnread(versionId) {
  return window.Threads.group(_notes.get(versionId) || []).some(t => _threadUnread(versionId, t));
}

function _syncNoteDots() {
  document.querySelectorAll('.notes-btn[data-version]').forEach(b => {
    b.classList.toggle('notes-btn--unread', _hasUnread(b.dataset.version));
  });
  _syncVerseNotes();
}

/* The button that opens a version's observations: in the row under the
 * box, or — `inHead` — beside the version's name above its column. */
function _notesButton(version, inHead) {
  if (!version || !_hasNotes()) return null;
  return el('button', {
    class: 'notes-btn ' + (inHead ? 'notes-btn--head' : 'version-switcher__nav')
      + (_hasUnread(version.id) ? ' notes-btn--unread' : ''),
    'data-version': version.id,
    'aria-label': 'Observații',
    title: 'Observații',
    html: NOTES_ICON,
    onmousedown: (e) => e.preventDefault(),
    onclick: () => _openNotes(version)
  });
}

// A version's name above its column, with its observations at the right.
function _headRow(head, version) {
  return el('div', { class: 'text-tab__headrow' }, [head, _notesButton(version, true)]);
}

/* The verse view's button on each verse of a version, for the
 * observations on that verse: faint while there are none, with the number
 * still open once there are, and the dot while any are unread. What each
 * shows is worked out again from the version's text whenever the
 * observations change, and soon after the text does. */
let _verseNoteButtons = [];

function _verseNotesButton(version, indexNow) {
  const btn = el('button', {
    class: 'verse-notes',
    'aria-label': 'Observații la strofă',
    title: 'Observații la strofă',
    html: NOTES_ICON,
    onmousedown: (e) => e.preventDefault(),
    onclick: () => _openNotes(version, indexNow())
  });
  btn.appendChild(el('span', { class: 'verse-notes__count' }));
  btn._version = version;
  // Its verse's index as it is now: a verse written above moves it down.
  btn._index = indexNow;
  _verseNoteButtons.push(btn);
  return btn;
}

function _syncVerseNotes() {
  _verseNoteButtons = _verseNoteButtons.filter(b => b.isConnected);
  const threads = new Map();
  _verseNoteButtons.forEach(b => {
    const v = b._version;
    if (!threads.has(v.id)) threads.set(v.id, _threadsOf(v));
    const here = threads.get(v.id).filter(t => t.loc && t.loc.at.includes(b._index()));
    const open = here.filter(t => !t.resolved).length;
    b.classList.toggle('verse-notes--some', open > 0);
    b.classList.toggle('verse-notes--unread', here.some(t => _threadUnread(v.id, t)));
    b.lastChild.textContent = open ? String(open) : '';
  });
}
const _syncVerseNotesSoon = debounce(_syncVerseNotes, 500);

/* Marks a version's observations read — all of them, or only the threads
 * named, read from their verse. */
function _markNotesSeen(versionId, threadIds) {
  const list = _notes.get(versionId) || [];
  // Never behind the newest one, in case its writer's clock runs ahead.
  const at = Math.max(Date.now(), ...list.map(n => n.at));
  const patch = {};
  if (threadIds) threadIds.forEach(id => { patch[versionId + ':' + id] = at; });
  else patch[versionId] = at;
  if (!Object.keys(patch).length) return;
  Object.assign(_seen, patch);
  _syncNoteDots();
  window.Db.markSeen(window.Auth.currentUser().uid, _song.id, patch).catch(() => {});
}

// uid -> short name of everyone in the group, as far as is known yet.
function _memberNames(members) {
  return new Map((members || window.Auth.knownMembers()).map(m => [m.uid, window.Auth.shortName(m)]));
}

// uid -> whole name, for the initials on their observations.
function _memberFullNames(members) {
  return new Map((members || window.Auth.knownMembers()).map(m => [m.uid, m.displayName || '']));
}

// The colors initials are drawn on: muted enough to sit beside the text,
// dark enough for white letters, and told apart from one another.
const AVATAR_COLORS = ['#2C3E66', '#B5652A', '#3F7A52', '#8A4B6E', '#3E7C8C', '#7A6230', '#5A5AA0', '#A04A3D'];

// A check mark — a thread dealt with.
const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

// The start of an observation, for a line that only reminds of it.
function _excerpt(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

// "1 mesaj", "3 mesaje", "20 de mesaje".
function _messages(n) {
  if (n === 1) return '1 mesaj';
  return n % 100 === 0 || n % 100 >= 20 ? `${n} de mesaje` : `${n} mesaje`;
}

/* A version's observations — or, with `verseIndex`, those on one of its
 * verses, and room to leave one there. Each is a thread: the observation,
 * the replies to it, and whether it has been dealt with; a thread dealt
 * with is folded to one line. On the whole version, a thread on a verse
 * names it, and says when the verse has changed since or is no longer in
 * the text, with the words it was left on to compare. */
function _openNotes(version, verseIndex) {
  const song = _song;
  const me = window.Auth.currentUser().uid;
  const onVerse = verseIndex != null;
  // What a new observation here remembers of its verse, as it reads now.
  const anchorNow = () => onVerse ? window.Threads.anchorFor(version.verses || [], verseIndex) : null;
  const verseAnchor = anchorNow();
  // What had been read before this opened, so what is new stays marked
  // while the sheet is up.
  const seenBefore = { ..._seen };

  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  const list = el('ul', { class: 'note-list' });
  const placeholder = onVerse ? 'O observație despre această strofă…' : 'O observație pentru echipă…';
  const input = el('textarea', {
    class: 'field__input note-input',
    rows: 3,
    maxlength: 4000,
    placeholder
  });
  const addBtn = el('button', { class: 'btn btn--primary' }, ['Adaugă']);
  const replyBar = el('div', { class: 'note-reply-to' });
  replyBar.hidden = true;
  // Current names from the start: the name stored with a note is its
  // author's when it was written, and drawing that first showed an old
  // name for a moment whenever the author had changed theirs since.
  let names = _memberNames();
  let fullNames = _memberFullNames();
  // The thread being answered, if any; the folded threads opened to read;
  // the threads showing the words they were left on.
  let replyTo = null;
  const unfolded = new Set();
  const quoted = new Set();

  const whoOf = (n) => n.by === me ? 'Tu' : (names.get(n.by) || window.Auth.shortName({ displayName: n.byName }));
  // Its author, an admin, or whoever may delete the version or the song.
  const canDelete = (n) => n.by === me || window.Auth.isAdmin()
    || version.createdBy === me || song.createdBy === me;

  function shown() {
    const all = _threadsOf(version);
    return onVerse ? all.filter(t => t.loc && t.loc.at.includes(verseIndex)) : all;
  }

  /* One observation: its author's initials in a colored circle, then their
   * name · when, what they wrote, and a gray row of what can be done with
   * it — answer, mark the thread done (on its first), give a heart. */
  function noteItem(n, t, isReply) {
    // Two taps to delete: the first only asks.
    const del = canDelete(n) ? el('button', {
      class: 'note__delete',
      'aria-label': 'Șterge observația',
      title: 'Șterge',
      html: ROW_ICONS.delete,
      onclick: async () => {
        if (!del.classList.contains('note__delete--confirm')) {
          del.classList.add('note__delete--confirm');
          del.textContent = 'Șterge';
          return;
        }
        del.disabled = true;
        try {
          await window.Db.deleteNote(song.id, version.id, n.id);
          _notes.set(version.id, (_notes.get(version.id) || []).filter(x => x.id !== n.id));
          draw();
          _syncNoteDots();
        } catch (err) {
          del.disabled = false;
          toast(failText('Nu am putut șterge observația', err), { kind: 'error' });
        }
      }
    }) : null;
    const fresh = n.by !== me && n.at > _seenAt(seenBefore, version.id, t.id);
    const isFirst = n === t.root;
    return el('div', { class: 'note' + (isReply ? ' note--reply' : '') + (fresh ? ' note--new' : '') }, [
      avatar(n),
      el('div', { class: 'note__body' }, [
        el('div', { class: 'note__meta' }, [
          fresh ? el('span', { class: 'note__newdot', title: 'Nou' }) : null,
          el('strong', { class: 'note__who' }, [whoOf(n)]),
          el('span', { class: 'note__sep', 'aria-hidden': 'true' }, ['·']),
          el('time', {
            class: 'note__when',
            datetime: new Date(n.at).toISOString(),
            title: new Date(n.at).toLocaleString('ro-RO')
          }, [window.Activity.formatWhen(n.at, Date.now())]),
          del
        ]),
        el('div', { class: 'note__text' }, [n.text]),
        el('div', { class: 'note__actions' }, [
          el('button', { class: 'note__action', onclick: () => startReply(t) }, ['Răspunde']),
          isFirst ? el('button', { class: 'note__action', onclick: () => resolve(t, !t.resolved) },
            [t.resolved ? 'Redeschide' : 'Rezolvă']) : null,
          heartButton(n)
        ])
      ])
    ]);
  }

  /* A member's initials on a color of their own, the same everywhere: who
   * said what, before reading any names. */
  function avatar(n) {
    const full = fullNames.get(n.by) || n.byName || whoOf(n);
    const words = String(full).trim().split(/\s+/).filter(Boolean);
    const initials = ((words[0] || '?')[0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
    let hash = 0;
    for (const ch of String(n.by || full)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return el('span', {
      class: 'note__avatar',
      style: `background:${AVATAR_COLORS[hash % AVATAR_COLORS.length]}`,
      'aria-hidden': 'true'
    }, [initials]);
  }

  /* The heart on an observation: yours given or not, and how many there
   * are, with who gave them on hover. Changed on screen straight away and
   * put back should the save fail. */
  function heartButton(n) {
    const btn = el('button', { class: 'note__action note__heart' });
    const paint = () => {
      const hearts = n.hearts || [];
      const mine = hearts.includes(me);
      btn.classList.toggle('note__heart--mine', mine);
      btn.setAttribute('aria-pressed', mine ? 'true' : 'false');
      btn.setAttribute('aria-label', mine ? 'Retrage inima' : 'Dă o inimă');
      btn.title = hearts.length
        ? hearts.map(uid => uid === me ? 'Tu' : (names.get(uid) || 'Cineva')).join(', ')
        : 'Dă o inimă';
      btn.innerHTML = HEART_ICON;
      if (hearts.length) btn.appendChild(el('span', { class: 'note__hearts' }, [String(hearts.length)]));
    };
    btn.onclick = async () => {
      const before = n.hearts || [];
      const on = !before.includes(me);
      n.hearts = on ? [...before, me] : before.filter(uid => uid !== me);
      paint();
      try {
        await window.Db.setNoteHeart(song.id, version.id, n.id, me, on);
      } catch (err) {
        n.hearts = before;
        if (btn.isConnected) paint();
        toast(failText('Nu am putut salva inima', err), { kind: 'error' });
      }
    };
    paint();
    return btn;
  }

  /* Where a thread on a verse is, at the top of its card: on the whole
   * version, the verse's name and a line of its words; on either, a pill
   * when the verse has changed since or is gone, with the words it was
   * left on. The line opens to the whole verse. */
  function whereItem(t, card) {
    const state = !t.loc.at.length ? 'Nu mai e în text'
      : t.loc.changed ? 'Schimbată între timp' : '';
    if (onVerse && !state) return;
    const showing = quoted.has(t.id);
    // Its lyrics, blank lines and all when it is open, and on one line
    // without them when it is not.
    const all = String(t.anchor.quote || '').split('\n').filter(l => !window.Sections.isMarker(l));
    const lines = all.filter(l => l.trim());
    const toggle = () => { if (showing) quoted.delete(t.id); else quoted.add(t.id); draw(); };
    card.appendChild(el('div', { class: 'thread__where' }, [
      onVerse ? null : el('span', { class: 'thread__section' }, [window.Threads.label(t.anchor)]),
      state ? el('span', { class: 'thread__state' }, [state]) : null
    ]));
    if (!lines.length) return;
    card.appendChild(el('button', {
      class: 'thread__quote' + (showing ? ' thread__quote--open' : ''),
      'aria-expanded': showing ? 'true' : 'false',
      title: showing ? 'Ascunde' : 'Arată toată strofa',
      onclick: toggle
    }, [
      state ? el('span', { class: 'thread__quote-label' }, ['Atunci: ']) : null,
      showing ? all.join('\n').trim() : lines.join(' / ')
    ]));
  }

  function threadItem(t) {
    const folded = t.resolved && !unfolded.has(t.id);
    const li = el('li', { class: 'thread' + (t.resolved ? ' thread--resolved' : '') });
    if (folded) {
      const first = t.notes[0];
      li.appendChild(el('button', {
        class: 'thread__folded',
        onclick: () => { unfolded.add(t.id); draw(); }
      }, [
        el('span', { class: 'thread__check', html: CHECK_ICON }),
        t.anchor && !onVerse ? el('span', { class: 'thread__section' }, [window.Threads.label(t.anchor)]) : null,
        el('span', { class: 'thread__gist' }, [whoOf(first) + ': ' + _excerpt(first.text, 60)]),
        el('span', { class: 'thread__count' }, [_messages(t.notes.length)])
      ]));
      return li;
    }
    if (t.resolved) {
      const by = t.root.resolvedBy === me ? 'tine' : (names.get(t.root.resolvedBy) || 'cineva');
      li.appendChild(el('div', { class: 'thread__resolved' }, [
        el('span', { class: 'thread__check', html: CHECK_ICON }),
        el('span', {}, [`Rezolvat de ${by}`]),
        el('button', {
          class: 'note__action thread__fold',
          onclick: () => { unfolded.delete(t.id); draw(); }
        }, ['Strânge'])
      ]));
    }
    if (t.anchor) whereItem(t, li);
    if (!t.root) {
      li.appendChild(el('div', { class: 'note note--gone' }, [
        el('span', { class: 'note__avatar note__avatar--gone', 'aria-hidden': 'true' }),
        el('span', { class: 'note__body' }, ['Observația a fost ștearsă.'])
      ]));
    }
    t.notes.forEach(n => li.appendChild(noteItem(n, t, n !== t.root)));
    return li;
  }

  function draw() {
    const keep = list.scrollTop;
    const threads = shown();
    list.innerHTML = '';
    if (!threads.length) {
      list.appendChild(el('li', { class: 'note-list__empty' }, [
        onVerse ? 'Nicio observație la această strofă.' : 'Nicio observație încă.'
      ]));
      return;
    }
    threads.forEach(t => list.appendChild(threadItem(t)));
    list.scrollTop = keep;
  }

  function markSeen() {
    if (onVerse) _markNotesSeen(version.id, shown().map(t => t.id));
    else _markNotesSeen(version.id);
  }

  function startReply(t) {
    replyTo = t;
    const first = t.notes[0];
    replyBar.innerHTML = '';
    replyBar.append(
      el('span', { class: 'note-reply-to__text' }, [
        'Răspuns pentru ', el('strong', {}, [whoOf(first)]), ': ' + _excerpt(first.text, 50)
      ]),
      el('button', {
        class: 'note-reply-to__close',
        'aria-label': 'Renunță la răspuns',
        title: 'Renunță',
        onmousedown: (e) => e.preventDefault(),
        onclick: cancelReply
      }, ['×'])
    );
    replyBar.hidden = false;
    input.placeholder = 'Răspunsul tău…';
    input.focus();
  }

  function cancelReply() {
    replyTo = null;
    replyBar.hidden = true;
    input.placeholder = placeholder;
  }

  async function resolve(t, value) {
    try {
      Object.assign(t.root, await window.Db.setNoteResolved(song.id, version.id, t.root.id, value, me));
      if (value) unfolded.delete(t.id);
      draw();
      _syncNoteDots();
    } catch (err) {
      toast(failText(value ? 'Nu am putut marca observația ca rezolvată' : 'Nu am putut redeschide observația', err),
        { kind: 'error' });
    }
  }

  async function add() {
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    const user = window.Auth.currentUser();
    const thread = replyTo;
    // A reply carries its thread's anchor too, so the thread keeps its
    // verse should its first observation be deleted.
    const anchor = thread ? thread.anchor : anchorNow();
    addBtn.disabled = true;
    try {
      const note = await window.Db.addNote(song.id, version.id, {
        text, by: user.uid, byName: user.displayName || (user.email || '').split('@')[0] || '',
        anchor, parentId: thread ? thread.id : null
      });
      // Unless the listener has brought it in already.
      const had = _notes.get(version.id) || [];
      if (!had.some(x => x.id === note.id)) _notes.set(version.id, [...had, note]);
      const extra = { versionTitle: version.title || '', versionId: version.id, noteId: note.id };
      if (anchor) extra.section = window.Threads.label(anchor);
      if (thread) { extra.reply = true; extra.threadId = thread.id; }
      window.Activity.log(song, 'note_added', extra);
      // Answering a thread that was done opens it again.
      if (thread && thread.resolved) {
        window.Db.setNoteResolved(song.id, version.id, thread.root.id, false, user.uid)
          .then(patch => { Object.assign(thread.root, patch); draw(); _syncNoteDots(); })
          .catch(() => {});
      }
      input.value = '';
      cancelReply();
      draw();
      markSeen();
      list.scrollTop = list.scrollHeight;
    } catch (err) {
      toast(failText('Nu am putut adăuga observația', err), { kind: 'error' });
    }
    addBtn.disabled = false;
  }
  addBtn.onclick = add;
  // Enter is a new line; Ctrl/Cmd+Enter sends.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add(); }
    if (e.key === 'Escape' && replyTo) { e.preventDefault(); e.stopPropagation(); cancelReply(); }
  });

  // A verse without a mark is found again by its words and its place
  // alone; a mark lets its observations follow it through any rewrite.
  const hint = onVerse && !verseAnchor.key && _canEditVersion(version)
    ? el('p', { class: 'sheet__text note-hint' }, [
        'Strofa nu are marcaj. Marcheaz-o ([Refren], [Strofa 2]…) ca observațiile să o urmeze și după ce textul se schimbă.'
      ])
    : null;

  overlay.appendChild(el('div', { class: 'sheet sheet--notes' }, [
    el('h2', { class: 'sheet__title sheet__title--row' }, [
      el('span', {}, ['Observații']),
      el('span', { class: 'sheet__title-accent' }, [version.title || 'Fără titlu'])
    ]),
    onVerse ? el('div', { class: 'thread__where note-verse' }, [
      'La', el('span', { class: 'thread__section' }, [window.Threads.label(verseAnchor)])
    ]) : null,
    hint,
    list,
    replyBar,
    input,
    el('div', { class: 'sheet__actions' }, [
      el('button', { class: 'btn', onclick: () => closeSheet(overlay) }, ['Închide']),
      addBtn
    ])
  ]));
  draw();
  openSheet(overlay);
  list.scrollTop = list.scrollHeight;
  // The keyboard shrinks the list, not the field: keep its newest notes,
  // the ones just above the field, in sight as it does — unless a reply
  // was started further up, which should stay where it is.
  input.addEventListener('focus', () => {
    if (replyTo) return;
    const toBottom = () => { list.scrollTop = list.scrollHeight; };
    toBottom();
    setTimeout(toBottom, 300);
  });
  if (WIDE.matches) input.focus();
  markSeen();

  // Whatever comes in while it is up is drawn straight away, and read: the
  // list stays where it was, or keeps to the bottom if it was there.
  const redraw = (versionId) => {
    if (!overlay.isConnected) { _noteRedraws.delete(redraw); return; }
    if (versionId !== version.id) return;
    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 8;
    draw();
    if (atBottom) list.scrollTop = list.scrollHeight;
    if (shown().some(t => _threadUnread(version.id, t))) markSeen();
  };
  _noteRedraws.add(redraw);

  // The names to put on them, as they are now.
  window.Auth.groupMembers()
    .then(members => {
      names = _memberNames(members);
      fullNames = _memberFullNames(members);
      if (overlay.isConnected) draw();
    })
    .catch(() => {});
}

function _activeVersion() {
  return _versions.find(v => v.id === _activeVersionId) || null;
}

// Editing/deleting a version is limited to whoever created it, or an
// admin — enforced for real in firestore.rules; this just drives the UI
// (disabling the textarea, hiding the edit/delete icons) to match.
function _canEditVersion(version) {
  if (!version) return false;
  if (window.Auth.isAdmin()) return true;
  return version.createdBy === window.Auth.currentUser().uid;
}

// Resets the undo/redo history whenever the active version actually
// changes, but leaves it alone on incidental re-renders of the same
// version (e.g. after renaming it), so in-progress undo history survives.
function _syncUndoState(active) {
  if (_undoStateVersionId === _activeVersionId) return;
  _undoStateVersionId = _activeVersionId;
  _versionHistory = _newHistory(active ? active.verses : []);
  _otherHistories = new Map();
  _versesScrollTop = 0;
}

// The history of any version, the active one's being _versionHistory.
function _historyFor(version) {
  if (version.id === _undoStateVersionId) return _versionHistory;
  if (!_otherHistories.has(version.id)) _otherHistories.set(version.id, _newHistory(version.verses));
  return _otherHistories.get(version.id);
}

// Makes a version active by writing in its column, with every version on
// screen: its history moves in as the active one, keeping both histories,
// where a switch from the version list starts afresh.
function _makeActive(version) {
  if (version.id === _activeVersionId) return;
  const history = _historyFor(version);
  if (_undoStateVersionId) _otherHistories.set(_undoStateVersionId, _versionHistory);
  _otherHistories.delete(version.id);
  _versionHistory = history;
  _activeVersionId = _undoStateVersionId = version.id;
  _rememberVersion(_song.id, version.id);
}

// The editor for one version's text. Its saves are bound to that version,
// not to whichever is active when the typing pause ends.
function _versionDoc(version, history) {
  return _editedText({
    verses: version ? (version.verses || []) : [],
    history,
    canEdit: _canEditVersion(version),
    write: (t) => { if (version) version.verses = t; },
    save: (t) => _saveVersionText(version && version.id, history, t)
  });
}

/* The word to look up from the editor: the one under the caret, or, when
 * something is selected, the last word of the selection — the end of a
 * line is where the rhyme lives. Letters only, so a hyphenated clitic
 * splits off ("cântă-mi" gives "cântă" with the caret on it) and
 * punctuation touching the word is left out. Null when the caret sits
 * between words. */
function _wordAtCaret(ta) {
  const text = ta.value;
  const start = ta.selectionStart, end = ta.selectionEnd;
  if (start !== end) {
    const words = text.slice(start, end).match(/\p{L}+/gu);
    if (words) return words[words.length - 1];
  }
  const isLetter = (ch) => !!ch && /\p{L}/u.test(ch);
  let a = end, b = end;
  while (isLetter(text[a - 1])) a--;
  while (isLetter(text[b])) b++;
  return a < b ? text.slice(a, b) : null;
}

/* A box the reader may not change but may still put the caret in, to
 * look a word up. `readonly` would not do: a phone draws no caret in it.
 * So the box stays editable to the browser, with no on-screen keyboard,
 * and any edit — a hardware key, a paste, a drop — is refused before it
 * lands, or put back if it lands anyway, before any other handler sees it. */
function _viewOnly(ta) {
  ta.inputMode = 'none';
  ta.spellcheck = false;
  // Taken again on focus: a redraw may have set new text since.
  let kept = ta.value;
  ta.addEventListener('focus', () => { kept = ta.value; });
  ta.addEventListener('beforeinput', (e) => e.preventDefault());
  ta.addEventListener('input', (e) => {
    e.stopImmediatePropagation();
    if (ta.value !== kept) ta.value = kept;
  }, true);
  return ta;
}

/* Rime or Sinonime for the word at the caret, without retyping it — or,
 * in the original, its English definition or Bible dictionary entry. One button for all of them
 * keeps the row under the text short; the sheet it opens names the word,
 * so a caret a letter off shows before the trip, not after. The other tab
 * keeps the word and Text keeps its place, so the tab bar is the way back. */
function _openLookup(ta) {
  const word = _wordAtCaret(ta);
  if (!word) {
    toast('Pune cursorul pe un cuvânt.');
    return;
  }
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  const go = (tab) => closeSheetThen(overlay, () => {
    if (tab === 'rime') window.RimeTab.search(word);
    else if (tab === 'engleza') window.EnglezaTab.search(word);
    else if (tab === 'biblic') window.BiblicTab.search(word);
    else window.SinonimeTab.show(word);
    window.App.openTab(tab);
  });
  // The original is in English, so rhymes and synonyms from Romanian
  // dictionaries are no use there; the Bible dictionary is English too.
  const english = !!ta.closest('.editor--source');
  overlay.appendChild(el('div', { class: 'sheet' }, english ? [
    el('button', { class: 'btn btn--wide btn--menu', onclick: () => go('engleza') },
      menuLabel(icons.dictionary, 'Definiția pentru „' + word + '”')),
    el('button', { class: 'btn btn--wide btn--menu', onclick: () => go('biblic') },
      menuLabel(icons.bible, 'Dicționar biblic pentru „' + word + '”'))
  ] : [
    el('button', { class: 'btn btn--wide btn--menu', onclick: () => go('rime') },
      menuLabel(icons.rime, 'Rime pentru „' + word + '”')),
    el('button', { class: 'btn btn--wide btn--menu', onclick: () => go('sinonime') },
      menuLabel(icons.sinonime, 'Sinonime pentru „' + word + '”'))
  ]));
  openSheet(overlay);
}

// A verse's section, by its Romanian name, if it is marked.
function _verseKind(verse) {
  const sec = window.Verses.section(verse);
  return sec ? sec.kind : null;
}

/* What a verse is marked as, for pairing it with its verse in another
 * text: its kind and number, or its name when it is not a kind we know.
 * Null for a verse with no mark, and for a stand-in "[…]", which pairs
 * as one does. */
function _pairMark(verse) {
  const sec = window.Verses.section(verse);
  if (!sec || sec.text === '…') return null;
  return sec.kind ? { kind: sec.kind, number: sec.number } : { name: sec.text.toLowerCase() };
}

const _sameSection = (a, b) => a.kind ? a.kind === b.kind : !b.kind && a.name === b.name;
// The same section, and not told apart by a number: Verse 2 and Strofa 2,
// Verse and Strofa 1, but not Verse 1 and Strofa 2.
const _sameMark = (a, b) => _sameSection(a, b)
  && (a.number === b.number || a.number == null || b.number == null);

/* The verses of two texts lined up, by their marks: [i, j] for a verse of
 * each that go together, [i, null] or [null, j] for one with nothing
 * beside it, in the order the rows read. `a` and `b` are the marks of
 * each text's verses (see _pairMark).
 *
 * A marked verse goes with the verse marked the same on the other side —
 * Verse 2 with Strofa 2, Chorus with Refren — and if the other side has
 * that section at all, with nothing else. So a chorus written out three
 * times in the original and once in the translation leaves the two
 * repeats beside nothing, and the verses after them stay paired with
 * their own. Verses with no mark, or whose mark the other side does not
 * use, pair by position, as they come. Of the ways of pairing them, the
 * one with the most and best pairs wins; between equals, the one that
 * pairs earlier. */
function _pairVerses(a, b) {
  const has = (marks, m) => marks.some(x => x && _sameMark(x, m));
  const score = (x, y) => {
    if (!x && !y) return 4;
    if (!x) return has(a, y) ? 0 : 2;
    if (!y) return has(b, x) ? 0 : 2;
    if (_sameMark(x, y)) return x.number === y.number ? 6 : 5;
    return has(a, y) || has(b, x) ? 0 : 1;
  };
  const n = a.length, m = b.length;
  const best = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  const pair = (i, j) => { const s = score(a[i], b[j]); return s ? s + best[i + 1][j + 1] : -1; };
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) best[i][j] = Math.max(best[i + 1][j], best[i][j + 1], pair(i, j));
  }
  const rows = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && best[i][j] === pair(i, j)) rows.push([i++, j++]);
    else if (i < n && (j === m || best[i][j] === best[i + 1][j])) rows.push([i++, null]);
    else rows.push([null, j++]);
  }
  return rows;
}

/* The rows of the verse view: each verse of the original, in order, with
 * the verse of every version that goes with it, and a version's verse
 * with none in the original in a row of its own, where it falls among
 * them. { o: the original's verse or null, t: each version's or null } */
function _verseRows(orig, versions) {
  const paired = versions.map(() => new Array(orig.length).fill(null));
  // A version's unpaired verses, by the original verse they come before.
  const extra = versions.map(() => Array.from({ length: orig.length + 1 }, () => []));
  versions.forEach((v, c) => {
    let next = 0;
    _pairVerses(orig, v).forEach(([i, j]) => {
      if (i == null) extra[c][next].push(j);
      else { next = i + 1; if (j != null) paired[c][i] = j; }
    });
  });
  const rows = [];
  for (let i = 0; i <= orig.length; i++) {
    const most = Math.max(0, ...extra.map(e => e[i].length));
    for (let x = 0; x < most; x++) rows.push({ o: null, t: extra.map(e => e[i][x] ?? null) });
    if (i < orig.length) rows.push({ o: i, t: paired.map(p => p[i]) });
  }
  return rows;
}

// Grows a verse box to fit its text, so the page scrolls rather than the box.
function _fitHeight(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

/* One text being edited on the Text tab — the version or the original —
 * with its own undo history and its own autosave.
 *
 * A typed edit takes one undo checkpoint per pause in typing (matching the
 * save debounce), not one per keystroke — otherwise undo would only ever
 * step back a single character at a time. An edit made in one go — a
 * picked section — is saved at once as a single step; a checkpoint still
 * pending from typing its "[" already holds the text from before it.
 *
 * The debounced save saves whatever the text is when the pause ends, not
 * what it was at the keystroke that scheduled it: an edit committed at
 * once must not be overtaken by a stale pending save.
 *
 * The text is its list of verses (see verses.js), and every edit makes a
 * new list rather than changing the one it had: the history keeps each
 * list as it was. */
function _editedText({ verses, history, canEdit, write, save }) {
  const debouncedSave = debounce(() => save(doc.verses), 600);
  const doc = {
    verses, history, canEdit,
    onChange: () => {},
    showHistory: () => {},          // the view redraws what undo landed on
    onStep: () => {},               // told of each undo (true) or redo
    typed(next) {
      if (!history.pending) {
        history.undo.push(history.last);
        history.redo = [];
        history.pending = true;
      }
      doc.verses = next;
      write(next);
      debouncedSave();
      doc.onChange();
    },
    replaced(next) {
      if (!history.pending) history.undo.push(doc.verses);
      history.redo = [];
      doc.settle(next);
    },
    settle(next) {
      doc.verses = next;
      write(next);
      history.last = next;
      history.pending = false;
      save(next);
      doc.onChange();
    },
    // Undo moves from `from` to `to`; redo the other way round.
    step(from, to) {
      if (!from.length) return;
      to.push(doc.verses);
      const t = from.pop();
      doc.settle(t);
      doc.onStep(from === history.undo);
      doc.showHistory(t);
    }
  };
  return doc;
}

function _renderTextTab(content) {
  _watchNotes();
  const active = _activeVersion();
  const canEdit = _canEditVersion(active);
  _syncUndoState(active);

  // preventDefault on mousedown (fires before the click would shift focus
  // to the button) keeps the textarea — and so the on-screen keyboard —
  // focused when tapping undo/redo, instead of dismissing the keyboard.
  const keepFocus = (e) => e.preventDefault();
  const undoBtn = el('button', {
    class: 'version-switcher__nav',
    'aria-label': 'Anulează',
    html: UNDO_REDO_ICONS.undo,
    disabled: true,
    onmousedown: keepFocus
  });
  const redoBtn = el('button', {
    class: 'version-switcher__nav',
    'aria-label': 'Refă',
    html: UNDO_REDO_ICONS.redo,
    disabled: true,
    onmousedown: keepFocus
  });

  // Same focus handling as undo/redo, and for a second reason too: the
  // selection has to still be in the textarea when the click reads it.
  const lookupBtn = el('button', {
    class: 'version-switcher__nav',
    'aria-label': 'Caută cuvântul',
    title: 'Caută cuvântul',
    html: LOOKUP_ICON,
    onmousedown: keepFocus
  });

  // Enabled even with nothing to switch between. New songs are created
  // with a version, but a song from before that is not, and this button
  // is the only door to "Adaugă versiune" — disabling it was what sealed
  // those songs off with no way to start writing in them.
  const currentBtn = el('button', {
    class: 'version-switcher__current',
    onclick: () => _openVersionList(content)
  }, [active ? (active.title || 'Fără titlu') : 'Adaugă o versiune']);
  // With every version in a column of its own, each has its button above
  // it instead.
  const switcher = el('div', { class: 'version-switcher' }, [
    currentBtn,
    _showingVerseGrid() ? null : _notesButton(active, false),
    lookupBtn,
    undoBtn,
    redoBtn
  ]);

  /* ---- the texts being edited ----
   * Two of them: the version, and a translation's original, edited in
   * place in the verse view. Each is written onto its record as it
   * changes, not only once a save comes back, so a re-render in between —
   * a trip to Rime — starts from what was typed rather than from the last
   * save.
   *
   * Undo and redo act on whichever was focused last, the version unless
   * the original has been. */
  if (!_originalHistory || _originalHistorySongId !== _song.id) {
    _originalHistory = _newHistory(_song.originalVerses);
    _originalHistorySongId = _song.id;
  }
  const versionDoc = _versionDoc(active, _versionHistory);
  const originalDoc = _editedText({
    verses: _song.originalVerses,
    history: _originalHistory,
    canEdit: _canEditSong(),
    write: (t) => { _song.originalVerses = t; },
    save: (t) => _saveOriginalText(t)
  });
  let current = versionDoc;
  const syncButtons = () => {
    undoBtn.disabled = !current.canEdit || !current.history.undo.length;
    redoBtn.disabled = !current.canEdit || !current.history.redo.length;
  };
  versionDoc.onChange = originalDoc.onChange = syncButtons;
  const focusDoc = (doc) => { if (current !== doc) { current = doc; syncButtons(); } };
  syncButtons();

  // Whichever view is showing fills this in.
  let lookupTarget = () => null;    // the box the lookup reads its word from

  undoBtn.onclick = () => current.step(current.history.undo, current.history.redo);
  redoBtn.onclick = () => current.step(current.history.redo, current.history.undo);
  lookupBtn.onclick = () => {
    const ta = lookupTarget();
    if (ta) _openLookup(ta);
    else toast('Pune cursorul pe un cuvânt.');
  };

  // Writing in a version's column, with every version on screen, makes it
  // the active one.
  const activate = (version, doc) => {
    _makeActive(version);
    currentBtn.textContent = version.title || 'Fără titlu';
    focusDoc(doc);
  };

  const body = _renderVersesView({
    active, canEdit,
    version: versionDoc, original: originalDoc, focusDoc, activate,
    setShowHistory: (fn) => { versionDoc.showHistory = fn; },
    setLookupTarget: (fn) => { lookupTarget = fn; }
  });
  content.appendChild(el('div', { class: 'text-tab-wrap' }, [body.el, switcher]));
  body.mounted();
}

/* The Text tab: a song verse by verse. For a translation, each verse of
 * the original above its verse of the translation — or, on a big screen
 * with more than one version, beside its verse in every version, one
 * column each (see _showingVerseGrid), so the rows line the same verse up
 * across all of them with nothing to scroll in step. A composition has no
 * original: its verses one under another, or its versions side by side.
 *
 * Each side is a list of verses (see verses.js), each its own box, paired
 * by their section marks where they have them and otherwise by position
 * (see _pairVerses): a chorus written out once in the translation stands
 * beside the original's first, and the repeats are left beside nothing.
 * A box holds its verse's lyrics as typed or pasted, blank lines and all;
 * its section mark shows above it, and is picked from a list (see
 * _openLabelPicker).
 *
 * An empty box is where a verse not written yet goes: writing in it puts
 * one into that side's list, after the verse it has above — the original
 * too, which is written here like any other side. A row whose marks still
 * disagree says so.
 *
 * On a shared song each verse a version has written takes observations of
 * its own, from the button in its corner (see _verseNotesButton). */
function _renderVersesView(ctx) {
  // One side of the rows: the original or a version. `cells` are its boxes
  // in row order, each with the index of the verse it shows (`k`, null
  // while empty); rebuilt only on a full redraw.
  const side = (doc, editable, inOriginal) => ({ doc, editable, inOriginal, cells: [] });
  // A composition is not a translation of anything: no original side.
  const hasOrig = !isOriginal(_song);
  const orig = side(ctx.original, hasOrig && ctx.original.canEdit, true);
  const grid = _showingVerseGrid();
  const trs = grid
    ? _versions.map(v => {
        const doc = v.id === _activeVersionId ? ctx.version : _versionDoc(v, _historyFor(v));
        return Object.assign(side(doc, _canEditVersion(v), false), { version: v, title: v.title || 'Fără titlu' });
      })
    : [side(ctx.version, !!ctx.active && ctx.canEdit, false)];
  const sides = hasOrig ? [orig, ...trs] : trs;
  // Where the original may be written in, a verse of it can be put in
  // between any two rows (see insertBefore).
  const canInsert = hasOrig && orig.editable;
  // The side across from one: the original for a version, and for the
  // original the version being worked on.
  const otherOf = (s) => s.inOriginal
    ? trs.find(t => !t.version || t.version.id === _activeVersionId) || trs[0]
    : orig;
  const verseOf = (s, k) => s.doc.verses[k];
  // Each side's column, counted from 1.
  const colOf = (s) => s.inOriginal ? 1 : trs.indexOf(s) + (hasOrig ? 2 : 1);
  let lastBox = null;

  const list = el('div', { class: 'verses' + (hasOrig ? '' : ' verses--solo') });
  const wrap = el('div', { class: 'verses-wrap' + (grid ? ' verses-wrap--all' : '') }, [list]);
  wrap.addEventListener('scroll', () => { _versesScrollTop = wrap.scrollTop; });
  // Every column as wide as the others, and never narrower than a line of
  // lyrics needs: past what fits, the rows scroll sideways together.
  const ncols = sides.length;
  const columns = `repeat(${ncols}, minmax(260px, 1fr))`;
  const heads = [];
  // Nor wider than a line of lyrics reads well: with few versions, the
  // rows stay that wide, in the middle.
  if (grid) {
    list.style.minWidth = `${ncols * 260 + 4}px`;
    list.style.maxWidth = `${ncols * 480 + 4}px`;
  }

  // The mark on the other side's verse in a cell's row, named in this
  // side's language, or null when that verse has none.
  function markAcross(cell) {
    const o = cell.row.get(otherOf(cell.side));
    if (!o || o.k == null) return null;
    const sec = window.Verses.section(verseOf(o.side, o.k));
    if (!sec || sec.text === '…') return null;
    return cell.side.inOriginal ? window.Sections.english(sec) : window.Sections.romanian(sec);
  }

  // The nearest cell above one, on its side, that has a verse; or null.
  function cellAbove(cell) {
    const cs = cell.side.cells;
    for (let x = cs.indexOf(cell) - 1; x >= 0; x--) if (cs[x].k != null) return cs[x];
    return null;
  }

  /* Writes a verse into its cell's side, and returns the side's verses.
   * An empty cell gets a verse of its own once there is more than blank
   * space to keep (null till then), after the verse its side has above
   * it. Without a mark it pairs by position, so any empty cells it passed
   * on the way, beside verses that have no mark either, first get a
   * stand-in each: "[…]", a mark that is plainly something to replace,
   * which keeps it in its row. */
  function write(cell, value) {
    const s = cell.side;
    const verses = s.doc.verses.slice();
    if (cell.k != null) {
      verses[cell.k] = value;
      return verses;
    }
    if (!window.Verses.text(value).trim()) return null;
    const cs = s.cells, above = cellAbove(cell);
    const fill = [];
    if (!_pairMark(value)) {
      for (let x = (above ? cs.indexOf(above) : -1) + 1; x < cs.indexOf(cell); x++) {
        const o = cs[x].row.get(otherOf(s));
        if (o && o.k != null && !_pairMark(verseOf(o.side, o.k))) fill.push(cs[x]);
      }
    }
    const added = [...fill.map(c => [c, STAND_IN]), [cell, value]];
    const p = above ? above.k + 1 : 0;
    verses.splice(p, 0, ...added.map(([, v]) => v));
    cs.forEach(c => { if (c.k != null && c.k >= p) c.k += added.length; });
    added.forEach(([c], n) => {
      c.k = p + n;
      if (c !== cell) { c.label = c.written = '[…]'; c.show(''); }
    });
    return verses;
  }

  /* A verse emptied and left: it goes from its side's verses, and its row
   * from the page once no side has a verse there. Without a mark, beside a verse
   * with none either, it would take every verse after it out of the row
   * it pairs in, so that one keeps a stand-in, "[…]", as a skipped verse
   * does (see write).
   *
   * Done in place rather than by redrawing: the box the tap went to is
   * already taking focus, and stays the box it was, and where it was on
   * screen — the rows are scrolled by whatever went from above it.
   *
   * `whole`: the row is going as a whole (see the box's blur), so there
   * is nothing to keep a place for. */
  function vacate(cell, next, whole) {
    const s = cell.side;
    const across = cell.row.get(otherOf(s));
    const pairsByPlace = !whole && across && across.k != null && !_pairMark(verseOf(across.side, across.k));
    const later = s.cells.slice(s.cells.indexOf(cell) + 1)
      .some(c => c.k != null && !_pairMark(verseOf(s, c.k)));
    if (pairsByPlace && later) {
      cell.label = cell.written = '[…]';
      s.doc.replaced(write(cell, STAND_IN));
      cell.show('');
      return;
    }

    const anchor = next && list.contains(next) ? next : null;
    const top = anchor && anchor.getBoundingClientRect().top;

    const k = cell.k;
    const verses = s.doc.verses.slice();
    verses.splice(k, 1);
    cell.k = null;
    cell.label = cell.written = null;
    s.cells.forEach(c => { if (c.k != null && c.k > k) c.k--; });
    s.doc.replaced(verses);

    const row = cell.row;
    if (!row.more && [...row.values()].every(c => c.k == null)) {
      dropRow(row);
    } else {
      // Still a row, with this box empty in it, and nothing left to note.
      const ed = cell.box.parentNode;
      ed.classList.remove('verse__editor--notes');
      ed.querySelectorAll('.verse-notes').forEach(b => b.remove());
      row.el.querySelectorAll('.verses__note--pair').forEach(n => n.remove());
      const facing = s.inOriginal ? trs.some(t => (row.get(t) || {}).k != null) : across && across.k != null;
      cell.box.placeholder = !facing ? '' : s.inOriginal ? 'Fără pereche în original' : 'Traducerea…';
      cell.show('');
    }
    if (anchor) wrap.scrollTop += anchor.getBoundingClientRect().top - top;
    _syncVerseNotes();
  }

  /* The box for a cell: its section mark above it, the lyrics in it, undo
   * through its side's own history. A side that may not be edited is
   * view-only where it has verses, rather than disabled, so it is not
   * dimmed. */
  function verseBox(cell, placeholder, mounted) {
    const s = cell.side;
    const ta = el('textarea', {
      class: 'field__input verse__box',
      rows: 1,
      placeholder,
      disabled: !s.editable && cell.k == null
    });
    if (!s.editable && cell.k != null) _viewOnly(ta);
    cell.box = ta;
    const labelBtn = el('button', {
      class: 'verse__label',
      type: 'button',
      // Keeps the caret in the box, and the keyboard up, through the pick.
      onmousedown: (e) => e.preventDefault(),
      onclick: () => {
        if (!s.editable || mirrored) return;
        const upTo = cell.k != null ? cell.k : (a => a ? a.k + 1 : 0)(cellAbove(cell));
        const above = window.Verses.toText(s.doc.verses.slice(0, upTo));
        _openLabelPicker({
          current: cell.label || (cell.k == null ? suggested() : null),
          removable: !!cell.label,
          suggested: markAcross(cell),
          above,
          inOriginal: s.inOriginal,
          pick: relabel
        });
      }
    });
    const editor = el('div', {
      class: 'editor verse__editor' + (s.inOriginal ? ' editor--source verse__editor--source' : '')
    }, [labelBtn, ta]);

    /* A translation's marks are the original's, in Romanian: each verse
     * shows, and is written with, the mark the verse across has, or none
     * when that has none — nothing to pick. Only a verse the original
     * does not have keeps a mark of its own; and an emptied one keeps its
     * stand-in (see vacate). */
    const mirrored = hasOrig && !s.inOriginal;
    // The mark an empty box would start its verse with: the one across.
    const suggested = () => {
      const m = s.editable && !cell.unmarked && markAcross(cell);
      return m ? '[' + m + ']' : null;
    };
    // The mark the verse has now, or would start with.
    const markNow = () => {
      if (mirrored) {
        const o = cell.row.get(orig);
        if (!o || o.k == null) return cell.label;
        const m = markAcross(cell);
        return m ? '[' + m + ']' : ta.value.trim() ? null : cell.label;
      }
      return cell.label || (cell.k == null ? suggested() : null);
    };
    // The verse as it goes into its side's list: its mark — kept here, as
    // in the picker, in its brackets — and the lyrics as typed.
    const verseOut = (mark) => ({ mark: mark ? mark.trim().slice(1, -1) : '', lyrics: ta.value });
    /* Shows the cell as it is: its mark above the box — the one it would
     * start with, faintly, while it is empty — and `lyrics`, when given,
     * in it. Where marks are picked, a side that may be edited offers one
     * to every verse that has none. */
    cell.show = (lyrics) => {
      if (lyrics != null) ta.value = lyrics;
      const mark = markNow();
      const sec = mark && window.Sections.parse(mark);
      const name = !sec ? '' : sec.text === '…' ? '…' : sec.text;
      const offer = !mark && !mirrored && s.editable && cell.k != null;
      // A mark to add sits in the box's corner, out of the lyrics' way,
      // and is written out only where a box beside it has a mark (see
      // .verse__label--offer in the stylesheet). With nothing to show, the
      // label still holds a line's height, for when the row keeps its
      // place, to start level with a box beside it that has a mark.
      if (offer) {
        labelBtn.replaceChildren(
          el('span', { class: 'verse__label-icon', html: ADD_LABEL_ICON }),
          el('span', { class: 'verse__label-text' }, ['+ Etichetă']));
      } else {
        labelBtn.textContent = name || '\u00a0';
      }
      labelBtn.hidden = !name && !offer;
      labelBtn.disabled = !s.editable || mirrored;
      labelBtn.classList.toggle('verse__label--faint', cell.k == null || !mark);
      labelBtn.classList.toggle('verse__label--stand-in', name === '…');
      labelBtn.classList.toggle('verse__label--offer', offer);
      labelBtn.title = offer ? 'Adaugă o etichetă'
        : name === '…' ? 'Loc păstrat pentru o strofă nescrisă: alege o etichetă sau scrie versurile' : '';
      editor.classList.toggle('verse__editor--labelled', !!name);
      editor.classList.toggle('verse__editor--offer', offer);
      _fitHeight(ta);
    };

    // The cell's mark and lyrics from its verse. `written` is the mark as
    // it is stored; `label`, as it is to be.
    const v = cell.k != null ? verseOf(s, cell.k) : null;
    cell.label = cell.written = v && v.mark ? '[' + v.mark + ']' : null;
    cell.show(v ? v.lyrics : '');

    // The box into its side's verses: as typed, or `once`, a step of its
    // own. A verse new in the row for one more, or in the last row, makes
    // room for the next (see promote, makeRoom).
    const commit = (once) => {
      const made = cell.k == null, had = cell.written, mark = markNow();
      const next = write(cell, verseOut(mark));
      if (next == null) return false;
      cell.label = cell.written = mark;
      if (once) s.doc.replaced(next); else s.doc.typed(next);
      if (made || mark !== had) cell.show();
      // The original's mark changed: so do its translations' beside it.
      if (s.inOriginal && mark !== had) {
        trs.forEach(t => { const tc = cell.row.get(t); if (tc) tc.follow(); });
      }
      if (made) {
        if (cell.row.more) promote(cell);
        else { makeRoom(cell); if (s.inOriginal) settleRow(cell); }
      }
      return true;
    };

    // A translation's verse, its mark following the original's.
    cell.follow = () => {
      if (cell.k != null && s.editable && markNow() !== cell.written) commit(true);
      cell.show();
    };

    // A mark picked from the list, or none — which an empty box keeps to,
    // rather than starting with the one across after all.
    function relabel(mark) {
      cell.label = mark;
      cell.unmarked = !mark;
      if (!mark && !ta.value.trim()) {
        if (cell.k != null) vacate(cell, null); else cell.show();
        return;
      }
      commit(true);
      cell.show();
    }

    ta.addEventListener('input', () => {
      // A mark typed or pasted as the box's first line, the way lyrics
      // from the web come, is taken out of the lyrics and becomes the
      // verse's own.
      const lines = ta.value.split('\n');
      if (lines.length > 1 && window.Sections.isMarker(lines[0]) && s.editable) {
        const caret = Math.max(0, ta.selectionEnd - lines[0].length - 1);
        cell.label = lines[0].trim();
        ta.value = lines.slice(1).join('\n');
        ta.setSelectionRange(caret, caret);
        cell.show();
      }
      // Blank lines, typed or pasted, stay where they are: in its verse.
      commit();
      _fitHeight(ta);
      if (!s.inOriginal) _syncVerseNotesSoon();
    });
    ta.addEventListener('focus', () => {
      // The lookup reads from any side: the original's words go to the
      // English dictionary, a version's to Rime and Sinonime. Writing in a
      // version's column makes it the active one.
      lastBox = ta;
      lyricsOnFocus = ta.value;
      if (s.version) {
        ctx.activate(s.version, s.doc);
        heads.forEach(h => h.classList.toggle('text-tab__head--active', h.side === s));
      } else {
        ctx.focusDoc(s.doc);
      }
    });
    // What the box held when it gained focus: a verse emptied since, as
    // against one that was only ever a mark (an "[Interlude]", say).
    let lyricsOnFocus = '';
    ta.addEventListener('blur', (e) => {
      // A row made to write a verse in (see insertBefore), left with
      // none written: back out it goes.
      if (cell.row.inserted && !ta.value.trim() && [...cell.row.values()].every(c => c.k == null)) {
        dropRow(cell.row);
        return;
      }
      if (!s.editable || cell.k == null || ta.value.trim()) return;
      // A verse left with nothing in it is no longer a verse — nor is a
      // translation's left with only the mark it takes from the original.
      const bare = mirrored ? cell.label !== '[…]' : !cell.label;
      if (bare) { vacate(cell, e.relatedTarget); return; }
      // A marked verse of the original, or of a composition, emptied with
      // nothing written beside it either: the row goes, mark and all, with
      // any mark or stand-in beside it that you may remove.
      const others = [...cell.row.values()].filter(c => c !== cell);
      if (!mirrored && lyricsOnFocus.trim() && others.every(c => !c.box || !c.box.value.trim())) {
        others.filter(c => c.k != null && c.side.editable).forEach(c => vacate(c, e.relatedTarget, true));
        vacate(cell, e.relatedTarget, true);
      }
    });

    mounted.push(() => _fitHeight(ta));
    // A version's verse, written already, takes observations of its own.
    const notesOn = !s.inOriginal && cell.k != null && _hasNotes() ? (s.version || _activeVersion()) : null;
    if (notesOn) {
      editor.classList.add('verse__editor--notes');
      editor.appendChild(_verseNotesButton(notesOn, () => cell.k));
    }
    return editor;
  }

  // In the grid every cell is set in its own column, an empty one too, so
  // a version with no verse in a row leaves a gap rather than letting the
  // next column slide into its place.
  const place = (cell, col) => { if (grid) cell.style.gridColumn = String(col); return cell; };
  const gap = (s, col) => place(el('div', {
    class: 'verse__gap' + (s.inOriginal ? ' verse__gap--source' : '')
  }), col);

  // The rows on the page, in order.
  let rowList = [];

  // A side's cell in a row; a side's cells are kept in the order of rows.
  // A row not on the page yet counts as the last.
  const rowAt = (row) => rowList.includes(row) ? rowList.indexOf(row) : Infinity;
  function cellIn(s, row, k) {
    const cell = { side: s, row, k, box: null, label: null, written: null };
    row.set(s, cell);
    let i = s.cells.length;
    while (i > 0 && rowAt(s.cells[i - 1].row) > rowAt(row)) i--;
    s.cells.splice(i, 0, cell);
    return cell;
  }

  // An empty box of the original: with no original yet, the first asks
  // for it.
  let askedForOriginal = false;
  function originalPlaceholder(more) {
    if (!orig.doc.verses.length) {
      const first = !askedForOriginal;
      askedForOriginal = true;
      return first ? 'Lipește sau scrie textul original…' : '';
    }
    return more ? 'Strofa următoare din original…' : 'Fără pereche în original';
  }

  // An empty box of a version, beside verse `o` of the original, or in the
  // row for one more.
  function versionPlaceholder(s, o, more) {
    if (more) return s.doc.verses.length ? 'Strofa următoare…' : hasOrig ? 'Traducerea…' : 'Versurile tale…';
    if (o == null) return '';
    // A section this version has written once already, elsewhere.
    const om = _pairMark(o);
    if (om && s.doc.verses.some(v => { const m = _pairMark(v); return m && _sameMark(m, om); })) {
      return window.Sections.romanian(window.Verses.section(o)) + ' — deja tradus';
    }
    return 'Traducerea…';
  }

  /* One row of the view, added at the bottom: `r` is what each side has
   * in it (see _verseRows). The row for one more verse has a box on each
   * side named in `room`, by column. Returns the row: its cells by side,
   * and `el`. */
  function addRow(r, mounted, room) {
    const row = new Map();
    const o = r.o != null ? verseOf(orig, r.o) : null;
    const pair = el('div', { class: 'verse' + (grid ? ' verse--grid' : '') });
    if (grid) pair.style.gridTemplateColumns = columns;
    row.el = pair;
    row.more = !!r.more;

    // Past the original's last verse, its box says why a version's verse
    // has nothing beside it, or offers room for one more.
    if (hasOrig) {
      if (!r.more || room[0]) {
        const ph = o == null ? originalPlaceholder(r.more) : '';
        pair.appendChild(place(verseBox(cellIn(orig, row, r.o), ph, mounted), 1));
      } else if (grid) {
        pair.appendChild(gap(orig, 1));
      }
    }

    // By every original verse — empty where the version has no verse
    // for it yet — and by its own verses that have none there. With no
    // original, versions side by side pair by position, so each has a box
    // in every row, to write its verse of that row in.
    trs.forEach((s, c) => {
      const k = r.t[c];
      if (r.more ? !room[colOf(s) - 1] : k == null && o == null && hasOrig) {
        if (grid) pair.appendChild(gap(s, colOf(s)));
        return;
      }
      const ph = k == null ? versionPlaceholder(s, o, r.more) : '';
      pair.appendChild(place(verseBox(cellIn(s, row, k), ph, mounted), colOf(s)));
    });

    const ok = o != null ? _verseKind(o) : null;
    const clash = ok ? trs.map((s, c) => ({ s, k: r.t[c] != null ? _verseKind(verseOf(s, r.t[c])) : null }))
      .filter(x => x.k && x.k !== ok) : [];
    if (clash.length) {
      pair.appendChild(el('p', { class: 'verses__note verses__note--pair' }, [
        grid ? `Aici originalul are ${ok}; ` + clash.map(x => `${x.s.title}: ${x.k}`).join(', ') + '.'
             : `Aici originalul are ${ok}, traducerea ${clash[0].k}.`
      ]));
    }
    if (canInsert && rowList.length && !row.more) list.appendChild(row.ins = inserter(row));
    list.appendChild(pair);
    rowList.push(row);
    return row;
  }

  // Puts a box into a row in place, in its column: over the gap there in
  // the grid, else first for the original and last for a version.
  function putBox(row, box, col) {
    const g = grid && [...row.el.children].find(x => x.classList.contains('verse__gap') && x.style.gridColumn === String(col));
    if (g) g.replaceWith(place(box, col));
    else if (col === 1) row.el.prepend(place(box, col));
    else row.el.insertBefore(place(box, col), row.el.querySelector('.verses__note'));
  }

  /* The row for one more verse at the end, beside nothing: a box on each
   * side that may take one and has a verse in the row above (`above`), or
   * on each that may, with no rows yet. None, and there is no such row. */
  function addMoreRow(above, mounted) {
    const room = sides.map(s => s.editable && (!above || (above.get(s) || {}).k != null));
    if (room.some(Boolean)) addRow({ o: null, t: trs.map(() => null), more: true }, mounted, room);
  }

  /* The row for one more verse, once one is written in it: a row like
   * any other, with a box for its verse on every side it has a place
   * for, and a new row for one more under it. Done in place, so the box
   * being written in stays the one it is. */
  function promote(cell) {
    const row = cell.row;
    row.more = false;
    const mounted = [];
    if (canInsert && rowList.indexOf(row) > 0) row.el.before(row.ins = inserter(row));
    boxesFor(row, mounted);
    addMoreRow(row, mounted);
    mounted.forEach(f => f());
  }

  // A box for its verse on every side a row has a place for.
  function boxesFor(row, mounted) {
    if (hasOrig && !row.has(orig)) putBox(row, verseBox(cellIn(orig, row, null), originalPlaceholder(false), mounted), 1);
    const oc = row.get(orig);
    const o = oc && oc.k != null ? verseOf(orig, oc.k) : null;
    if (oc && oc.k == null) oc.box.placeholder = originalPlaceholder(false);
    trs.forEach(s => {
      const tc = row.get(s);
      if (tc) {
        if (tc.k == null) { tc.box.placeholder = versionPlaceholder(s, o, false); tc.show(); }
      } else if (o != null) {
        putBox(row, verseBox(cellIn(s, row, null), versionPlaceholder(s, o, false), mounted), colOf(s));
      }
    });
  }

  /* A verse written in the last row: its side has written as far as the
   * end now, so the row for one more takes a box of its side too — or
   * there is one such row again, if there was none. */
  function makeRoom(cell) {
    const s = cell.side;
    const end = rowList[rowList.length - 1];
    if (!end || !s.editable) return;
    const mounted = [];
    if (!end.more) {
      if (end === cell.row) addMoreRow(cell.row, mounted);
    } else if (rowList[rowList.length - 2] === cell.row && !end.has(s)) {
      const ph = s.inOriginal ? originalPlaceholder(true) : versionPlaceholder(s, null, true);
      putBox(end, verseBox(cellIn(s, end, null), ph, mounted), colOf(s));
    }
    mounted.forEach(f => f());
  }

  /* Between two rows, a "+" to write a verse of the original there: a
   * row of its own, put in before `row`, with an empty box of the
   * original to write it in. It shows under the row being written in
   * (see .verses__insert in the stylesheet), so a tap keeps the caret
   * where it is until the new box takes it — and the keyboard stays up. */
  function inserter(row) {
    return el('div', { class: 'verses__insert' }, [el('button', {
      class: 'verses__insert-btn',
      type: 'button',
      title: 'Adaugă o strofă aici',
      'aria-label': 'Adaugă o strofă aici',
      onmousedown: (e) => e.preventDefault(),
      onclick: () => insertBefore(row),
      // Drawn, not typed: a "+" in the font sits off its middle.
      html: '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 1.5v9M1.5 6h9"/></svg>'
    })]);
  }

  function insertBefore(row) {
    if (!rowList.includes(row)) return;
    const mounted = [];
    const fresh = addRow({ o: null, t: trs.map(() => null) }, mounted);
    const at = row.ins || row.el;
    if (fresh.ins) at.before(fresh.ins);
    at.before(fresh.el);
    rowList.pop();
    rowList.splice(rowList.indexOf(row), 0, fresh);
    sides.forEach(x => x.cells.sort((a, b) => rowAt(a.row) - rowAt(b.row)));
    fresh.inserted = true;
    const box = fresh.get(orig).box;
    box.placeholder = 'Strofa nouă din original…';
    mounted.forEach(f => f());
    box.focus();
  }

  // A row off the page, with the "+" before it; the first row has none.
  function dropRow(row) {
    if (row.ins) row.ins.remove();
    row.el.remove();
    rowList = rowList.filter(r => r !== row);
    sides.forEach(x => { x.cells = x.cells.filter(c => c.row !== row); });
    const first = rowList[0];
    if (first && first.ins) { first.ins.remove(); first.ins = null; }
  }

  /* A verse new in the original, in a row that was not the one for one
   * more — put in between two (see insertBefore), or beside a version's
   * verse that had none: a box beside it on every version. Without a
   * mark it pairs by position, and so would take the next verse with no
   * mark of each version from further down, and every such verse after
   * it up a row. A version that may be edited keeps them where they are
   * with a stand-in beside it, "[…]", as a skipped verse has (see write);
   * one that may not moves up until its author puts one there. */
  function settleRow(cell) {
    const row = cell.row;
    const mounted = [];
    boxesFor(row, mounted);
    if (!_pairMark(verseOf(orig, cell.k))) {
      const below = rowList.slice(rowList.indexOf(row) + 1);
      trs.forEach(t => {
        const tc = row.get(t);
        if (!t.editable || !tc || tc.k != null) return;
        if (!below.some(r => { const c = r.get(t); return c && c.k != null && !_pairMark(verseOf(t, c.k)); })) return;
        const was = t.doc.verses;
        tc.label = tc.written = '[…]';
        t.doc.replaced(write(tc, STAND_IN));
        tc.show('');
        tied.push({ depth: orig.doc.history.undo.length, doc: t.doc, was, now: t.doc.verses });
      });
    }
    mounted.forEach(f => f());
  }

  /* The stand-ins a verse new in the original put beside it (see
   * settleRow) are part of the step that wrote it: undone with it, so the
   * rows under it do not move, and done again with it — each only while
   * its version has not been written in since. */
  const tied = [];
  orig.doc.onStep = (undo) => {
    const depth = orig.doc.history.undo.length;
    tied.forEach(x => {
      const h = x.doc.history;
      if (undo && depth < x.depth && x.doc.verses === x.now && h.undo[h.undo.length - 1] === x.was) {
        x.doc.step(h.undo, h.redo);
      } else if (!undo && depth >= x.depth && x.doc.verses === x.was && h.redo[h.redo.length - 1] === x.now) {
        x.doc.step(h.redo, h.undo);
      }
    });
  };

  function draw() {
    sides.forEach(s => { s.cells = []; });
    list.innerHTML = '';
    heads.length = 0;
    rowList = [];
    askedForOriginal = false;
    const mounted = [];
    const marksOf = (s) => s.doc.verses.map(_pairMark);
    const rows = _verseRows(hasOrig ? marksOf(orig) : [], trs.map(marksOf));

    // Who is in which column, kept in view while the rows scroll by.
    if (grid) {
      const row = el('div', { class: 'verses__heads' }, [
        hasOrig ? place(_headRow(el('div', { class: 'text-tab__head' }, ['Original']), null), 1) : null
      ]);
      row.style.gridTemplateColumns = columns;
      trs.forEach(s => {
        const h = el('div', {
          class: 'text-tab__head' + (s.version.id === _activeVersionId ? ' text-tab__head--active' : '')
        }, [s.title]);
        h.side = s;
        heads.push(h);
        row.appendChild(place(_headRow(h, s.version), colOf(s)));
      });
      list.appendChild(row);
    }

    let last = null;
    rows.forEach(r => { last = addRow(r, mounted); });
    addMoreRow(last, mounted);
    // A composition with no version yet has nowhere to write.
    if (!rowList.length && !ctx.active) {
      list.appendChild(el('p', { class: 'verses__note verses__note--empty' }, [
        hasOrig ? 'Creează o versiune pentru a începe traducerea.' : 'Creează o versiune ca să începi.'
      ]));
    }
    return mounted;
  }

  ctx.setLookupTarget(() => lastBox && lastBox.isConnected ? lastBox : null);
  // Undo can change any verse, add one or remove one, so it redraws them
  // all rather than working out which box it touched.
  function redraw() {
    const keep = wrap.scrollTop;
    draw().forEach(f => f());
    wrap.scrollTop = keep;
    _syncVerseNotes();
  }
  ctx.setShowHistory(redraw);
  ctx.original.showHistory = redraw;
  trs.forEach(s => { s.doc.showHistory = redraw; });

  const pending = draw();
  return {
    el: wrap,
    mounted() {
      pending.forEach(f => f());
      void wrap.offsetHeight;
      wrap.scrollTop = _versesScrollTop;
      _syncVerseNotes();
    }
  };
}

/* The section marks a verse can take, to pick from: the one the verse
 * across has first — so the translation keeps in step with the original —
 * then a verse numbered on from the verses above, the usual sections, and
 * any name at all. The original is in English, so it is offered the
 * English names. `current` is the verse's mark now ("[Refren]") or null;
 * `above`, its side's text before it; `pick(mark)` is told the choice,
 * null for none. */
function _openLabelPicker({ current, removable, suggested, above, inOriginal, pick }) {
  const verseNo = window.Sections.list(above).filter(s => s.kind === 'Strofa').length + 1;
  const names = [...new Set([
    suggested,
    (inOriginal ? 'Verse ' : 'Strofa ') + verseNo,
    ...(inOriginal ? SECTION_CHOICES_EN : SECTION_CHOICES)
  ].filter(Boolean))];
  const now = current && window.Sections.parse(current);
  const nowName = now && now.text !== '…' ? now.text : null;

  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  const done = (mark) => { closeSheet(overlay); pick(mark); };
  // Buttons that leave the caret where it was, as the label itself does.
  const keep = (e) => e.preventDefault();
  const chips = el('div', { class: 'label-picker' }, names.map(n => el('button', {
    class: 'seg' + (n === nowName ? ' seg--active' : n === suggested ? ' seg--suggested' : ''),
    onmousedown: keep,
    onclick: () => done('[' + n + ']')
  }, [n])));

  // Any other name, typed. Brackets and line breaks would make it
  // something other than one mark, so they do not go in.
  const input = el('input', {
    class: 'field__input',
    placeholder: 'Altă etichetă…',
    maxlength: '36',
    enterkeyhint: 'done',
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); useTyped(); } }
  });
  if (nowName && !names.includes(nowName)) input.value = nowName;
  const useTyped = () => {
    const name = input.value.replace(/[\[\]\n]/g, '').trim();
    if (name) done('[' + name + ']');
  };

  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Eticheta strofei']),
    chips,
    el('div', { class: 'label-picker__other' }, [
      input,
      el('button', { class: 'btn', onclick: useTyped }, ['Gata'])
    ]),
    removable ? el('button', { class: 'btn btn--wide btn--menu', onmousedown: keep, onclick: () => done(null) }, ['Fără etichetă']) : null
  ]));
  openSheet(overlay);
}

function _refreshTextTab(content) {
  content.innerHTML = '';
  _renderTextTab(content);
}

/* Text typed offline is saved all the same: Firestore keeps the change on
 * the device and sends it when the connection is back (see Db._queued).
 * Kept on the device survives the app being closed; where Firestore could
 * not have the device's storage (Auth.isPersistent) it is only in memory,
 * so leaving the app with any of it unsent asks first. */
let _unsent = 0;
let _toldQueued = false;

function _queued(sent, what) {
  if (!_toldQueued) {
    _toldQueued = true;
    toast(window.Auth.isPersistent()
      ? 'Fără internet: textul e păstrat pe dispozitiv și se salvează când revine conexiunea.'
      : 'Fără internet: textul se salvează când revine conexiunea. Nu închide aplicația.');
  }
  _unsent++;
  sent.catch(err => toast(failText(what, err), { kind: 'error' }))
    .finally(() => { _unsent--; });
}

window.addEventListener('online', () => { _toldQueued = false; });
window.addEventListener('beforeunload', (e) => {
  if (!_unsent || window.Auth.isPersistent()) return;
  e.preventDefault();
  e.returnValue = '';
});

// The song is read once, up front, so what follows the save is about the
// song it was made on even if another has been opened meanwhile.
async function _saveVersionText(versionId, history, verses) {
  if (!versionId) return;
  const song = _song;
  try {
    const { queued, sent } = await window.Db.setVersionVerses(song.id, versionId, verses);
    if (queued) _queued(sent, 'Nu am putut salva textul');
    const version = _versions.find(v => v.id === versionId);
    window.Activity.log(song, 'version_text', { versionTitle: version ? version.title : '' }, versionId);
    // The version's text is kept current as it is typed (see the Text
    // tab), so it is not set back here to whatever this save carried.
    history.last = verses;
    history.pending = false;
  } catch (err) {
    toast(failText('Nu am putut salva textul', err), { kind: 'error' });
  }
}

// The original text, edited in place on the Text tab. The song list keeps
// its own copy for the snippet under each title, so it is told as well.
async function _saveOriginalText(verses) {
  const song = _song;
  try {
    const { queued, sent } = await window.Db.setOriginalVerses(song.id, verses);
    if (queued) _queued(sent, 'Nu am putut salva originalul');
    window.Songs.noteUpdated(song.id, { originalVerses: verses });
    window.Activity.log(song, 'original_text', null, 'original');
    if (_originalHistory && _originalHistorySongId === song.id) {
      _originalHistory.last = verses;
      _originalHistory.pending = false;
    }
  } catch (err) {
    toast(failText('Nu am putut salva originalul', err), { kind: 'error' });
  }
}

function _openVersionList(content) {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });

  const rows = _versions.map(v => {
    // Rename/delete are limited to whoever created the version (or an
    // admin), matching the firestore.rules restriction — shown disabled
    // for everyone else rather than hidden, so it's clear the option
    // exists but isn't available to you.
    const editable = _canEditVersion(v);
    return el('div', { class: 'version-row', 'data-id': v.id }, [
      _versions.length > 1 ? el('span', {
        class: 'version-row__handle',
        'aria-hidden': 'true',
        html: ROW_ICONS.drag,
        onpointerdown: (e) => _dragVersionRow(e, content)
      }) : null,
      el('button', {
        class: 'version-row__title' + (v.id === _activeVersionId ? ' version-row__title--active' : ''),
        onclick: () => { _activeVersionId = v.id; _rememberVersion(_song.id, v.id); closeSheet(overlay); _refreshTextTab(content); }
      }, [v.title || 'Fără titlu']),
      el('button', {
        class: 'version-row__icon',
        'aria-label': 'Redenumește versiunea',
        disabled: !editable,
        html: ROW_ICONS.edit,
        // Waits for the close to actually finish (its own history pop)
        // before opening the next sheet — doing it right away would race
        // that pop and leave the history stack corrupted, which is what
        // made saving a rename kick all the way back out to the song list.
        onclick: () => closeSheetThen(overlay, () => _openRenameVersion(content, v))
      }),
      el('button', {
        class: 'version-row__icon version-row__icon--danger',
        'aria-label': 'Șterge versiunea',
        disabled: !editable || _versions.length < 2,
        html: ROW_ICONS.delete,
        onclick: () => {
          if (!editable || _versions.length < 2) return;
          closeSheetThen(overlay, () => _confirmDeleteVersion(content, v));
        }
      })
    ]);
  });

  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Versiuni']),
    el('div', { class: 'version-list' }, rows),
    el('button', {
      class: 'btn btn--wide',
      onclick: () => closeSheetThen(overlay, () => _openAddVersion(content))
    }, ['+ Adaugă versiune'])
  ]));
  openSheet(overlay);
}

/* Drags a row of the version sheet by its handle. The row follows the
 * finger, and the others make way as it passes their middle; let go, and
 * the order the rows are in is the versions' order, saved on the song for
 * the whole group (see Db.setVersionOrder). Pointer capture keeps the
 * moves coming to the handle wherever the finger goes, and the handle's
 * touch-action keeps the sheet from scrolling under it instead.
 *
 * The dragged row itself never moves in the page: the rows it passes are
 * moved to its other side instead. Taking the row out and putting it back,
 * even in the same breath, takes the pointer capture away from its handle,
 * and from then on the moves and the letting go landed on whatever was
 * under the finger — so a row dragged upwards stayed hanging over the
 * sheet's title, with an empty place where it belonged. The drag also ends
 * on lostpointercapture, which comes after every way a press can finish,
 * so nothing is left half-dragged if the capture goes for another reason.
 * And the row is kept within the list while it's held, so it is never
 * drawn anywhere it couldn't be dropped. */
function _dragVersionRow(e, content) {
  if (e.button !== 0) return;
  e.preventDefault();
  const handle = e.currentTarget;
  const row = handle.closest('.version-row');
  const list = row.parentNode;
  const grab = e.clientY - row.getBoundingClientRect().top;
  handle.setPointerCapture(e.pointerId);
  row.classList.add('version-row--dragging');

  const middle = (r) => { const b = r.getBoundingClientRect(); return b.top + b.height / 2; };
  const move = (ev) => {
    const y = ev.clientY;
    let next = row.nextElementSibling;
    while (next && y > middle(next)) { list.insertBefore(next, row); next = row.nextElementSibling; }
    let prev = row.previousElementSibling;
    while (prev && y < middle(prev)) { list.insertBefore(prev, row.nextElementSibling); prev = row.previousElementSibling; }
    row.style.transform = '';
    const slot = row.getBoundingClientRect();
    const bounds = list.getBoundingClientRect();
    const top = Math.min(Math.max(y - grab, bounds.top), bounds.bottom - slot.height);
    row.style.transform = `translateY(${top - slot.top}px)`;
  };
  const end = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', end);
    handle.removeEventListener('pointercancel', end);
    handle.removeEventListener('lostpointercapture', end);
    row.style.transform = '';
    row.classList.remove('version-row--dragging');
    const ids = Array.from(list.children, r => r.dataset.id);
    if (ids.every((id, i) => id === _versions[i].id)) return;
    _saveVersionOrder(content, list, ids);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('lostpointercapture', end);
}

// Shown in the new order at once; if it can't be saved, the rows go back
// to where they were.
async function _saveVersionOrder(content, list, ids) {
  const song = _song;
  const before = _versions;
  const byId = new Map(before.map(v => [v.id, v]));
  _versions = ids.map(id => byId.get(id));
  _refreshTextTab(content);
  try {
    await window.Db.setVersionOrder(song.id, ids);
    song.versionOrder = ids;
  } catch (err) {
    if (_song !== song) return;
    _versions = before;
    _refreshTextTab(content);
    before.forEach(v => { const r = list.querySelector(`[data-id="${v.id}"]`); if (r) list.appendChild(r); });
    toast(failText('Nu am putut schimba ordinea versiunilor', err), { kind: 'error' });
  }
}

function _confirmDeleteVersion(content, version) {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheetThen(overlay, () => _openVersionList(content)); } });

  const sheet = el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Ștergi versiunea?']),
    el('p', { class: 'sheet__text' }, [
      `Sigur vrei să ștergi versiunea „${version.title || 'Fără titlu'}”? Textul ei se pierde definitiv.`
    ]),
    el('div', { class: 'sheet__actions' }, [
      el('button', { class: 'btn', onclick: () => closeSheetThen(overlay, () => _openVersionList(content)) }, ['Anulează']),
      el('button', {
        class: 'btn btn--danger-solid',
        onclick: async () => {
          try {
            await window.Db.deleteVersion(_song.id, version.id);
            window.Activity.log(_song, 'version_deleted', { versionTitle: version.title || '' });
            _versions = _versions.filter(v => v.id !== version.id);
            if (_activeVersionId === version.id) {
              _activeVersionId = _versions.length ? _versions[_versions.length - 1].id : null;
              _rememberVersion(_song.id, _activeVersionId);
            }
            closeSheetThen(overlay, () => {
              _refreshTextTab(content);
              _openVersionList(content);
            });
          } catch (err) {
            toast(failText('Nu am putut șterge versiunea', err), { kind: 'error' });
          }
        }
      }, ['Șterge'])
    ])
  ]);
  overlay.appendChild(sheet);
  openSheet(overlay);
}

function _openAddVersion(content) {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  const defaultTitle = `Versiunea ${_versions.length + 1}`;
  const titleInput = el('input', { class: 'field__input', type: 'text', value: defaultTitle });

  const sheet = el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Versiune nouă']),
    el('label', { class: 'field' }, [el('span', { class: 'field__label' }, ['Titlu']), titleInput]),
    el('div', { class: 'sheet__actions' }, [
      el('button', { class: 'btn', onclick: () => closeSheet(overlay) }, ['Anulează']),
      el('button', {
        class: 'btn btn--primary',
        onclick: async () => {
          const title = titleInput.value.trim() || defaultTitle;
          try {
            const id = await window.Db.addVersion(_song.id, {
              title,
              verses: [],
              createdBy: window.Auth.currentUser().uid
            });
            const now = Date.now();
            // With its creator, as listVersions would bring it: that is
            // who may write in it, and without it the version you just
            // made would be read-only to you until the song is reloaded.
            _versions.push({ id, title, verses: [], createdBy: window.Auth.currentUser().uid, createdAt: now, updatedAt: now });
            window.Activity.log(_song, 'version_added', { versionTitle: title });
            _activeVersionId = id;
            _rememberVersion(_song.id, id);
            closeSheet(overlay);
            _refreshTextTab(content);
          } catch (err) {
            toast(failText('Nu am putut crea versiunea', err), { kind: 'error' });
          }
        }
      }, ['Creează'])
    ])
  ]);
  overlay.appendChild(sheet);
  openSheet(overlay);
  titleInput.focus();
  titleInput.select();
}

function _openRenameVersion(content, version) {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  const titleInput = el('input', { class: 'field__input', type: 'text', value: version.title || '' });

  const sheet = el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Redenumește versiunea']),
    el('label', { class: 'field' }, [el('span', { class: 'field__label' }, ['Titlu']), titleInput]),
    el('div', { class: 'sheet__actions' }, [
      el('button', { class: 'btn', onclick: () => closeSheetThen(overlay, () => _openVersionList(content)) }, ['Anulează']),
      el('button', {
        class: 'btn btn--primary',
        onclick: async () => {
          const title = titleInput.value.trim() || version.title;
          try {
            await window.Db.updateVersion(_song.id, version.id, { title });
            if (title !== version.title) window.Activity.log(_song, 'version_renamed', { versionTitle: title });
            version.title = title;
            closeSheetThen(overlay, () => {
              _refreshTextTab(content);
              _openVersionList(content);
            });
          } catch (err) {
            toast(failText('Nu am putut redenumi versiunea', err), { kind: 'error' });
          }
        }
      }, ['Salvează'])
    ])
  ]);
  overlay.appendChild(sheet);
  openSheet(overlay);
  titleInput.focus();
  titleInput.select();
}

// Editing (rename, original text) or deleting a song is limited to
// whoever created it, or an admin — enforced for real in firestore.rules;
// this just drives the UI (disabling the relevant menu items) to match.
function _canEditSong() {
  return window.Auth.isAdmin() || _song.createdBy === window.Auth.currentUser().uid;
}

function _openSongMenu(root) {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  const canEdit = _canEditSong();
  const original = isOriginal(_song);

  overlay.appendChild(el('div', { class: 'sheet' }, [
    // Anyone who can see the song may set this, unlike the items below —
    // it is how the group says where a song stands.
    el('button', {
      class: 'btn btn--wide btn--menu',
      onclick: () => closeSheetThen(overlay, () => _openStatusSheet())
    }, menuLabel(icons.flag, 'Stare: ' + statusLabel(songStatus(_song)))),
    el('button', {
      class: 'btn btn--wide btn--menu',
      // After the sheet's history entry is gone: a song found deleted
      // leaves the page, and that must not race the sheet's own pop.
      onclick: () => closeSheetThen(overlay, () => _refreshSong(root))
    }, menuLabel(icons.refresh, 'Reîmprospătează')),
    el('button', {
      class: 'btn btn--wide btn--menu',
      onclick: () => {
        if (!_song.demoUrl) {
          toast('Nu e salvat niciun link. Adaugă-l din „Editează melodia”.');
          return;
        }
        // Opened synchronously from the tap: a popup opened after the
        // sheet's async history unwind would no longer count as a user
        // gesture and could be blocked.
        window.open(_song.demoUrl, '_blank', 'noopener');
        closeSheet(overlay);
      }
    }, menuLabel(icons.headphones, 'Ascultă melodia')),
    el('button', {
      class: 'btn btn--wide btn--menu',
      disabled: !canEdit,
      onclick: () => { if (!canEdit) return; closeSheetThen(overlay, () => _openEditSong(root)); }
    }, menuLabel(icons.edit, 'Editează melodia')),
    // Any member's to read, unlike the whole group's log. A personal song
    // has none, since it is never logged.
    isShared(_song) ? el('button', {
      class: 'btn btn--wide btn--menu',
      onclick: () => closeSheetThen(overlay, () => window.Activity.openForSong(_song))
    }, menuLabel(icons.history, 'Jurnal')) : null,
    // A source text is something a composition does not have, so the
    // generate item is absent rather than disabled — "Adaugă mai întâi
    // textul original" is a confusing thing to be told about your own lyrics.
    original ? null : el('button', {
      class: 'btn btn--wide btn--menu',
      onclick: async () => {
        closeSheet(overlay);
        if (!window.Verses.hasLyrics(_song.originalVerses)) {
          toast('Adaugă mai întâi textul original.', { kind: 'error' });
          return;
        }
        toast('Se generează traducerea…');
        await _generateMotAMot(root);
      }
    }, menuLabel(icons.sparkles, 'Generează traducere Mot-a-mot')),
    el('button', {
      class: 'btn btn--wide btn--menu btn--danger',
      disabled: !canEdit,
      onclick: () => { if (!canEdit) return; closeSheetThen(overlay, () => _confirmDeleteSong()); }
    }, menuLabel(icons.trash, 'Șterge melodia'))
  ].filter(Boolean)));
  openSheet(overlay);
}

/* Where the song stands, and who is working on it. Like the edit sheet,
 * nothing is saved until Salvează: the taps only change what the sheet
 * shows, and Anulează leaves the song as it was. Only what actually
 * changed is written, and the song list's copy is kept in step, so going
 * back shows it too. */
function _openStatusSheet() {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  const me = window.Auth.currentUser().uid;
  // Your own name is known right away, without waiting on the members.
  const myName = window.Auth.shortName(window.Auth.currentUser());
  const statusRow = el('div', { class: 'pill-row' });
  const workersText = el('p', { class: 'sheet__text' });
  const workBtn = el('button', { class: 'btn btn--wide' });
  // uid -> short name, once the members are in — at once if already known.
  let names = window.Auth.knownMembers().length ? _memberNames() : null;

  // The choices in the sheet, starting from the song as it is.
  const wasWorking = songWorkers(_song).includes(me);
  let status = songStatus(_song);
  let working = wasWorking;

  function paint() {
    statusRow.innerHTML = '';
    SONG_STATUSES.forEach(s => statusRow.appendChild(el('button', {
      class: 'seg' + (s.id === status ? ' seg--active' : ''),
      onclick: () => { status = s.id; paint(); }
    }, [s.label])));

    const others = songWorkers(_song).filter(uid => uid !== me);
    const shown = working ? [me, ...others] : others;
    workersText.textContent = !shown.length ? 'Nimeni deocamdată.'
      : shown.map(uid => uid === me ? myName : (names && names.get(uid)) || '…').join(', ');
    workBtn.textContent = working ? 'Nu mai lucrez la ea' : 'Lucrez la ea';
  }
  workBtn.addEventListener('click', () => { working = !working; paint(); });

  const saveBtn = el('button', { class: 'btn btn--primary' }, ['Salvează']);
  saveBtn.addEventListener('click', async () => {
    const statusChanged = status !== songStatus(_song);
    const workingChanged = working !== wasWorking;
    if (!statusChanged && !workingChanged) { closeSheet(overlay); return; }
    saveBtn.disabled = true;
    try {
      if (statusChanged) {
        await window.Db.setSongStatus(_song.id, status);
        _note({ status });
        window.Activity.log(_song, 'status', { status });
      }
      if (workingChanged) {
        await window.Db.setWorking(_song.id, me, working);
        const others = songWorkers(_song).filter(uid => uid !== me);
        _note({ workers: working ? [...others, me] : others });
        window.Activity.log(_song, 'working', { working });
      }
      // Just joined a shared song: the moment notifications start to matter.
      if (workingChanged && working && isShared(_song)) closeSheetThen(overlay, () => window.Push.offer());
      else closeSheet(overlay);
    } catch (err) {
      saveBtn.disabled = false;
      toast(failText('Nu am putut salva starea', err), { kind: 'error' });
    }
  });

  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Stare']),
    statusRow,
    el('div', { class: 'field' }, [el('span', { class: 'field__label' }, ['Lucrează la ea']), workersText]),
    workBtn,
    el('div', { class: 'sheet__actions' }, [
      el('button', { class: 'btn', onclick: () => closeSheet(overlay) }, ['Anulează']),
      saveBtn
    ])
  ]));
  paint();
  openSheet(overlay);

  window.Auth.groupMembers().then(members => {
    names = _memberNames(members);
    if (overlay.isConnected) paint();
  });
}

// A change to the song made here, told to the song list's cached copy too.
function _note(patch) {
  Object.assign(_song, patch);
  window.Songs.noteUpdated(_song.id, patch);
}

function _confirmDeleteSong() {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Ștergi melodia?']),
    el('p', { class: 'sheet__text' }, [
      isOriginal(_song)
        ? `Sigur vrei să ștergi „${_song.title || 'Fără titlu'}”? Toate versiunile se pierd definitiv.`
        : `Sigur vrei să ștergi „${_song.title || 'Fără titlu'}”? Textul original și toate versiunile de traducere se pierd definitiv.`
    ]),
    el('div', { class: 'sheet__actions' }, [
      el('button', { class: 'btn', onclick: () => closeSheet(overlay) }, ['Anulează']),
      el('button', {
        class: 'btn btn--danger-solid',
        onclick: async () => {
          try {
            await window.Db.deleteSong(_song.id);
            window.Activity.log(_song, 'song_deleted');
            window.Songs.noteDeleted(_song.id);
            closeSheetThen(overlay, () => window.App.goUpToList(true));
          } catch (err) {
            toast(failText('Nu am putut șterge melodia', err), { kind: 'error' });
          }
        }
      }, ['Șterge'])
    ])
  ]));
  openSheet(overlay);
}

// Re-fetches the song + its versions from Firestore — there are no live
// listeners, so this is how you pick up a change someone else just made.
// Keeps the current tab (unlike render(), which is also used for
// navigating to a brand-new song and resets to the Text tab).
async function _refreshSong(root) {
  try {
    const refreshed = await window.Db.getSong(_song.id);
    if (!refreshed) {
      toast('Melodia nu mai există.', { kind: 'error' });
      window.Songs.noteDeleted(_song.id);
      window.App.goUpToList(true);
      return;
    }
    _song = refreshed;
    window.Songs.noteUpdated(_song.id, refreshed);
    _versions = orderVersions(_song, await window.Db.listVersions(_song.id));
    if (!_versions.find(v => v.id === _activeVersionId)) {
      _activeVersionId = _versions.length ? _versions[_versions.length - 1].id : null;
    }
    _renderShell(root);
    _loadNotes();
    toast('Actualizat.');
  } catch (err) {
    toast(failText('Nu am putut actualiza', err), { kind: 'error' });
  }
}

// The song's own details. Its original text is not among them: that is
// edited in place on the Text tab, beside the translation.
function _openEditSong(root) {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  const titleInput = el('input', { class: 'field__input', type: 'text', value: _song.title || '' });
  const demoInput = el('input', { class: 'field__input', type: 'url', placeholder: 'https://…', autocapitalize: 'off', autocomplete: 'off', value: _song.demoUrl || '' });

  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Editează melodia']),
    el('label', { class: 'field' }, [el('span', { class: 'field__label' }, ['Titlu']), titleInput]),
    el('label', { class: 'field' }, [el('span', { class: 'field__label' }, ['Link demo']), demoInput]),
    el('div', { class: 'sheet__actions' }, [
      el('button', { class: 'btn', onclick: () => closeSheet(overlay) }, ['Anulează']),
      el('button', {
        class: 'btn btn--primary',
        onclick: async () => {
          const title = titleInput.value.trim();
          if (!title) { toast('Introdu un titlu.', { kind: 'error' }); return; }
          const demoUrl = normalizeUrl(demoInput.value);
          if (demoUrl === null) { toast('Linkul demo nu este valid.', { kind: 'error' }); return; }

          const patch = {};
          if (title !== (_song.title || '')) patch.title = title;
          if (demoUrl !== (_song.demoUrl || '')) patch.demoUrl = demoUrl;
          if (!Object.keys(patch).length) { closeSheet(overlay); return; }

          try {
            await window.Db.updateSong(_song.id, patch);
            Object.assign(_song, patch);
            window.Activity.log(_song, 'song_edited', { fields: Object.keys(patch) });
            window.Songs.noteUpdated(_song.id, patch);
            closeSheetThen(overlay, () => _renderShell(root));
          } catch (err) {
            toast(failText('Nu am putut salva melodia', err), { kind: 'error' });
          }
        }
      }, ['Salvează'])
    ])
  ]));
  openSheet(overlay);
}

// Calls Google Translate and creates/updates the "Mot-a-mot" version, from
// the kebab menu's button.
async function _generateMotAMot(root) {
  try {
    const v = await window.Translator.generateMotAMotVersion(_song.id, _song.originalVerses, _versions, window.Auth.currentUser().uid, window.Auth.isAdmin());
    const idx = _versions.findIndex(x => x.id === v.id);
    if (idx >= 0) _versions[idx] = v; else _versions.push(v);
    _activeVersionId = v.id;
    _rememberVersion(_song.id, v.id);
    _renderShell(root);
    toast('Traducere Mot-a-mot generată.');
  } catch (err) {
    toast(failText('Nu am putut genera traducerea', err), { kind: 'error' });
  }
}

// Drops the open song so the next account never sees it (see Songs.reset).
function reset() {
  _unwatchNotes(true);
  _notes = new Map();
  _seen = {};
  _song = null;
  _versions = [];
  _activeVersionId = null;
  _undoStateVersionId = undefined;
  _versionHistory = _newHistory();
  _originalHistory = null;
  _originalHistorySongId = null;
  _otherHistories = new Map();
  _versesScrollTop = 0;
}

window.SongDetail = { render, reset };

})();
