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
const { el, toast, debounce, openSheet, closeSheet, closeSheetThen, icons, menuLabel, normalizeUrl, isOriginal,
        isShared, SONG_STATUSES, songStatus, statusLabel, songWorkers,
        isNetworkError, failText, offlineNotice } = window.Utils;

const ROW_ICONS = {
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  delete: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`
};

// Two stacked pairs of lines — the original over its translation.
const VERSES_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="7" rx="1.5"/><rect x="3" y="14" width="18" height="7" rx="1.5"/><path d="M7 6.5h10M7 17.5h7"/></svg>`;

// A magnifier — looks the word at the caret up in Rime, Sinonime or the
// English dictionary.
const LOOKUP_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>`;

// A speech bubble — the team's observations on a version.
const NOTES_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H10l-5 4v-4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 8.5h10M7 12.5h6"/></svg>`;

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
 * dot on a version's button. Fetched with the song, after it is on screen,
 * and again for one version whenever its observations are opened. */
let _notes = new Map();
let _seen = {};
let _activeVersionId = null;

// Remembers which version was last viewed, per song, per device — a
// personal UI preference, not shared team data, so this is localStorage
// rather than Firestore. Falls back to the most recently created version
// (Db.listVersions returns them createdAt-ascending) if nothing's
// remembered, or if the remembered one no longer exists.
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
function _newHistory(text) {
  return { undo: [], redo: [], last: text || '', pending: false };
}
let _undoStateVersionId;
let _versionHistory = _newHistory('');
let _originalHistory = null;
let _originalHistorySongId = null;
// With every version on screen at once (see _showingAllVersions), each
// keeps its own history; these are the ones not active right now. Dropped
// whenever _syncUndoState starts the active version's history afresh.
let _otherHistories = new Map();

// Scroll position of the original-text panel and the translation box.
// _translationScrollTop resets inside _syncUndoState, right alongside the
// undo history, since both are scoped to "which version" the same way;
// _originalScrollTop is scoped to the song instead (the original doesn't
// change between versions of the same song) and is reset below, only when
// render() is actually loading a different song.
let _originalScrollTop = 0;
let _translationScrollTop = 0;
let _versesScrollTop = 0;
// Scroll positions of the version columns, by version id, for the same
// reason, when every version is on screen; scoped to the song.
let _columnScrollTops = new Map();

// Which view the Text tab shows a translation in: 'whole' — the original
// beside the translation, each in one piece — or 'verses', each verse of
// the original above its verse of the translation. A way of working, not
// a property of the song, so it is remembered per device for every song.
const VIEW_KEY = 'talmaci:textView';
let _view = (() => { try { return localStorage.getItem(VIEW_KEY) || 'whole'; } catch (_) { return 'whole'; } })();

// Whether this song is shown verse by verse. Only a translation that has
// an original yet can be: a new song has nothing to pair, so it opens in
// the whole view, where its original is written, whatever was last used.
function _showingVerses() {
  return _view === 'verses' && !isOriginal(_song) && !!(_song.originalText || '').trim();
}

/* On a big screen the whole view shows every version side by side, each
 * its own column after the original, rather than one at a time. The
 * active version is then simply the one last written in: the switcher
 * names it, and undo and the lookup act on it. Resizing across the
 * breakpoint redraws the song page it is on. */
const WIDE = window.matchMedia('(min-width: 1024px)');
let _shellRoot = null;
function _showingAllVersions() {
  return WIDE.matches && !_showingVerses() && _versions.length > 1;
}
/* The verse view's counterpart: on a big screen, every version gets a
 * column of its own beside the original, so each row lines up the same
 * verse in all of them — see _renderVersesView. */
function _showingVerseGrid() {
  return WIDE.matches && _showingVerses() && _versions.length > 1;
}
WIDE.addEventListener('change', () => {
  if (_song && _shellRoot && _shellRoot.isConnected) _renderShell(_shellRoot);
});

async function render(root, songId) {
  if (_song && _song.id === songId) {
    // A tab switch back, or a "back" from Rime/Sinonime/Biblie — not a
    // real navigation. Redraw from what's already loaded instead of
    // hitting Firestore again; "Reîmprospătează" in the kebab menu is
    // there for when a fresh copy is actually wanted.
    _renderShell(root);
    return;
  }
  _originalScrollTop = 0;
  _columnScrollTops = new Map();
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
    el('h1', { class: 'topbar__title' }, ['Se încarcă…'])
  ]));
  root.appendChild(el('div', { class: 'loading-state' }, [
    el('div', { class: 'spinner' })
  ]));

  try {
    _song = await window.Db.getSong(songId);
    _versions = _song ? await window.Db.listVersions(songId) : [];

    // One-time migration: a song saved before versions existed may still
    // carry its translation in the legacy translatedText field. Turn it
    // into "Versiunea 1" instead of losing it.
    if (_song && _versions.length === 0 && _song.translatedText) {
      const id = await window.Db.addVersion(songId, {
        title: 'Versiunea 1',
        text: _song.translatedText,
        createdBy: window.Auth.currentUser().uid
      });
      const now = Date.now();
      _versions = [{ id, title: 'Versiunea 1', text: _song.translatedText,
        createdBy: window.Auth.currentUser().uid, createdAt: now, updatedAt: now }];
    }

    const remembered = _recallVersion(songId);
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
    toast(failText('Nu am putut încărca melodia', err), { kind: 'error' });
  }

  if (!_song) {
    root.appendChild(el('div', { class: 'empty-state' }, ['Melodia nu a fost găsită.']));
    return;
  }

  _renderShell(root);
  _loadNotes();
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
    // Only a translation has an original to pair its verses with.
    isOriginal(_song) ? null : el('button', {
      class: 'btn btn--icon' + (_showingVerses() ? ' btn--icon-on' : ''),
      'aria-label': 'Pe strofe',
      'aria-pressed': _showingVerses() ? 'true' : 'false',
      title: _showingVerses() ? 'Textul întreg' : 'Pe strofe',
      html: VERSES_ICON,
      onclick: () => {
        if (!(_song.originalText || '').trim()) {
          toast('Scrie mai întâi textul original.');
          return;
        }
        _view = _showingVerses() ? 'whole' : 'verses';
        try { localStorage.setItem(VIEW_KEY, _view); } catch (_) { /* just not remembered */ }
        _renderShell(root);
      }
    }),
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

async function _loadNotes() {
  const song = _song;
  // The names to put on the notes and on who is working, in hand before
  // either sheet is opened.
  window.Auth.groupMembers();
  _notes = new Map();
  _seen = {};
  if (!_hasNotes()) return;
  const uid = window.Auth.currentUser().uid;
  try {
    const [seen, lists] = await Promise.all([
      window.Db.getSeen(uid, song.id),
      Promise.all(_versions.map(v => window.Db.listNotes(song.id, v.id)))
    ]);
    if (_song !== song) return;
    _seen = seen;
    _versions.forEach((v, i) => _notes.set(v.id, lists[i]));
    _syncNoteDots();
  } catch (_) { /* no dots, and the sheet fetches its own */ }
}

// Someone else's observation left since you last read the version's.
function _hasUnread(versionId) {
  const me = window.Auth.currentUser().uid;
  const seen = _seen[versionId] || 0;
  return (_notes.get(versionId) || []).some(n => n.by !== me && n.at > seen);
}

function _syncNoteDots() {
  document.querySelectorAll('.notes-btn[data-version]').forEach(b => {
    b.classList.toggle('notes-btn--unread', _hasUnread(b.dataset.version));
  });
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

function _markNotesSeen(versionId) {
  const list = _notes.get(versionId) || [];
  // Never behind the newest one, in case its writer's clock runs ahead.
  const at = Math.max(Date.now(), ...list.map(n => n.at));
  _seen[versionId] = at;
  _syncNoteDots();
  window.Db.markSeen(window.Auth.currentUser().uid, _song.id, versionId, at).catch(() => {});
}

// uid -> short name of everyone in the group, as far as is known yet.
function _memberNames(members) {
  return new Map((members || window.Auth.knownMembers()).map(m => [m.uid, window.Auth.shortName(m)]));
}

function _openNotes(version) {
  const song = _song;
  const me = window.Auth.currentUser().uid;
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  const list = el('ul', { class: 'note-list' });
  const input = el('textarea', {
    class: 'field__input note-input',
    rows: 3,
    maxlength: 4000,
    placeholder: 'O observație pentru echipă…'
  });
  const addBtn = el('button', { class: 'btn btn--primary' }, ['Adaugă']);
  // Current names from the start: the name stored with a note is its
  // author's when it was written, and drawing that first showed an old
  // name for a moment whenever the author had changed theirs since.
  let names = _memberNames();

  // Its author, an admin, or whoever may delete the version or the song.
  const canDelete = (n) => n.by === me || window.Auth.isAdmin()
    || version.createdBy === me || song.createdBy === me;

  function draw() {
    const notes = _notes.get(version.id) || [];
    list.innerHTML = '';
    if (!notes.length) {
      list.appendChild(el('li', { class: 'note-list__empty' }, ['Nicio observație încă.']));
      return;
    }
    const now = Date.now();
    notes.forEach(n => {
      const who = n.by === me ? 'Tu' : (names.get(n.by) || window.Auth.shortName({ displayName: n.byName }));
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
          } catch (err) {
            del.disabled = false;
            toast(failText('Nu am putut șterge observația', err), { kind: 'error' });
          }
        }
      }) : null;
      list.appendChild(el('li', { class: 'note' }, [
        el('div', { class: 'note__meta' }, [
          el('strong', {}, [who]),
          el('time', {
            class: 'note__when',
            datetime: new Date(n.at).toISOString(),
            title: new Date(n.at).toLocaleString('ro-RO')
          }, [window.Activity.formatWhen(n.at, now)]),
          del
        ]),
        el('div', { class: 'note__text' }, [n.text])
      ]));
    });
  }

  async function add() {
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    const user = window.Auth.currentUser();
    addBtn.disabled = true;
    try {
      const note = await window.Db.addNote(song.id, version.id, {
        text, by: user.uid, byName: user.displayName || (user.email || '').split('@')[0] || ''
      });
      _notes.set(version.id, [...(_notes.get(version.id) || []), note]);
      window.Activity.log(song, 'note_added', { versionTitle: version.title || '' });
      input.value = '';
      draw();
      _markNotesSeen(version.id);
      list.lastChild.scrollIntoView({ block: 'nearest' });
    } catch (err) {
      toast(failText('Nu am putut adăuga observația', err), { kind: 'error' });
    }
    addBtn.disabled = false;
  }
  addBtn.onclick = add;
  // Enter is a new line; Ctrl/Cmd+Enter sends.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add(); }
  });

  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title sheet__title--row' }, [
      el('span', {}, ['Observații']),
      el('span', { class: 'sheet__title-accent' }, [version.title || 'Fără titlu'])
    ]),
    list,
    input,
    el('div', { class: 'sheet__actions' }, [
      el('button', { class: 'btn', onclick: () => closeSheet(overlay) }, ['Închide']),
      addBtn
    ])
  ]));
  draw();
  openSheet(overlay);
  if (WIDE.matches) input.focus();
  _markNotesSeen(version.id);

  // What was loaded with the song may be behind: fetch this version's
  // again, and the names to put on them.
  Promise.all([window.Db.listNotes(song.id, version.id), window.Auth.groupMembers()])
    .then(([notes, members]) => {
      if (_song !== song) return;
      names = _memberNames(members);
      _notes.set(version.id, notes);
      if (overlay.isConnected) { draw(); _markNotesSeen(version.id); }
      else _syncNoteDots();
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
  _versionHistory = _newHistory(active ? active.text : '');
  _otherHistories = new Map();
  _translationScrollTop = 0;
  _versesScrollTop = 0;
}

// The history of any version, the active one's being _versionHistory.
function _historyFor(version) {
  if (version.id === _undoStateVersionId) return _versionHistory;
  if (!_otherHistories.has(version.id)) _otherHistories.set(version.id, _newHistory(version.text));
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
    text: version ? (version.text || '') : '',
    history,
    canEdit: _canEditVersion(version),
    write: (t) => { if (version) version.text = t; },
    save: (t) => _saveVersionText(version && version.id, history, t)
  });
}

/* Where an undo or redo actually changed the text.
 *
 * The two versions share a prefix and a suffix; everything between them is
 * what moved. The caret goes at the end of that span in the NEW text, which
 * is where the edit being undone or redone left off — after the character
 * redo just put back, or at the gap undo just opened.
 *
 * Both texts are whole documents rather than recorded edits, so the span
 * has to be recovered by comparison. That also makes it right for edits
 * that are neither pure insertions nor pure deletions. */
function _changedCaret(oldText, newText) {
  const max = Math.min(oldText.length, newText.length);
  let pre = 0;
  while (pre < max && oldText[pre] === newText[pre]) pre++;
  let suf = 0;
  while (suf < max - pre &&
         oldText[oldText.length - 1 - suf] === newText[newText.length - 1 - suf]) suf++;
  return newText.length - suf;
}

/* Put the caret's line on screen if it is not already.
 *
 * Measured by truncating the value at the caret and reading scrollHeight,
 * which is the height of everything above it. Counting "\n" would be
 * cheaper but wrong the moment a line soft-wraps, and these are lyrics in
 * a narrow column on a phone. The truncation is reverted in the same tick,
 * so nothing is painted.
 *
 * Only scrolls when the caret is outside the visible band — an undo you can
 * already see should not make the view jump. */
function _scrollCaretIntoView(ta, pos) {
  const full = ta.value;
  const keptScroll = ta.scrollTop;
  ta.value = full.slice(0, pos);
  const caretBottom = ta.scrollHeight;
  ta.value = full;
  ta.scrollTop = keptScroll;              // the round trip resets it

  const cs = getComputedStyle(ta);
  const lineHeight = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) * 1.4) || 20;
  const view = ta.clientHeight;
  const above = caretBottom - lineHeight < ta.scrollTop;
  const below = caretBottom > ta.scrollTop + view;
  if (above || below) {
    ta.scrollTop = Math.max(0, caretBottom - view / 2);
  }
}

/* Swap the textarea to another point in its history and show where that
 * changed things. Without this the caret landed at the end of the text and
 * the view stayed put, so on anything longer than a screen an undo looked
 * like nothing had happened. */
function _applyHistoryText(ta, text) {
  const caret = _changedCaret(ta.value, text);
  ta.value = text;
  // Scroll BEFORE placing the caret. The measurement reassigns .value, and
  // assigning it drops any selection to the end of the field, so setting
  // the caret first would silently undo this whole function.
  _scrollCaretIntoView(ta, caret);
  // Focus is not taken here. On a phone that would raise the keyboard just
  // because you tapped undo — the same reason the buttons block mousedown.
  // The selection is stored either way and is waiting when the field is
  // next focused.
  try { ta.setSelectionRange(caret, caret); } catch (e) { /* not focusable yet */ }
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

/* A text with its section marks set apart from the lyrics, so the shape
 * of the song shows at a glance. Written as they were typed ("Chorus",
 * "Verse 2"), only without their brackets. Lines rawFrom..rawTo are left
 * exactly as typed: the editor's caret is on them, and a caret can only
 * sit in text drawn the way the textarea itself lays it out.
 *
 * Each verse — a run of non-blank lines, as _verses counts them — is
 * wrapped in a span of its own, which changes nothing about where its
 * lines fall but lets the editor find where on the page it is. */
function _renderMarkedText(text, rawFrom, rawTo) {
  const nodes = [];
  let verse = null;
  String(text || '').split('\n').forEach((line, i) => {
    const sec = (i >= rawFrom && i <= rawTo) ? null : window.Sections.parse(line);
    const node = sec ? el('span', { class: 'section-label' }, [sec.text]) : line;
    if (verse && line.trim()) { verse.append('\n', node); return; }
    if (i) nodes.push('\n');
    verse = line.trim() ? el('span', { class: 'editor__verse' }, [node]) : null;
    nodes.push(verse || node);
  });
  return nodes;
}

// Which line of a text an offset falls on, counting from 0.
function _lineAt(text, pos) {
  let n = 0;
  for (let i = text.indexOf('\n'); i >= 0 && i < pos; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

// What the mirror has to share with the textarea for its lines to fall
// exactly where the textarea's do.
const MIRROR_METRICS = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
  'wordSpacing', 'tabSize', 'textIndent', 'paddingTop', 'paddingRight', 'paddingBottom',
  'paddingLeft', 'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth'];

/* Formatted section marks inside the editor.
 *
 * A textarea cannot style part of its text, so the text is drawn twice: a
 * mirror behind the textarea shows it with the marks formatted, and the
 * textarea on top keeps its caret, selection and keyboard but paints its
 * own glyphs transparent. Everything else stays a plain textarea — undo,
 * autosave, the section strip and the lookup all work on it as before.
 *
 * The two only line up while they share every metric that places a line,
 * so those are copied from the textarea's computed style rather than
 * restated in CSS, along with the width a desktop scrollbar takes. The
 * marks drawn smaller still keep their line's height: a line box is never
 * shorter than its block's own line-height.
 *
 * Returns a repaint to call after any change made without an input event —
 * undo, redo, a picked section. It also carries what the columns of the
 * whole view need to follow one another (see _linkColumns): `band(k)`
 * shades verse k (null for none), and `verses()` is where each verse sits,
 * top to bottom, in the box's own scrolled content. */
function _attachMirror(ta, mirror) {
  let rawLines = '';
  let bandVerse = null;
  const bandEl = el('div', { class: 'editor__band' });

  // Each verse's span, measured against the mirror's content rather than
  // the screen, so the result holds however far the box is scrolled.
  function verses() {
    const box = mirror.getBoundingClientRect();
    const origin = box.top + mirror.clientTop - mirror.scrollTop;
    return [...mirror.querySelectorAll('.editor__verse')].map(v => {
      const r = v.getBoundingClientRect();
      return { top: r.top - origin, bottom: r.bottom - origin };
    });
  }

  // Draws the band behind the verse it marks; called after every paint,
  // since a paint replaces everything in the mirror.
  function placeBand() {
    const at = bandVerse === null ? null : verses()[bandVerse];
    if (!at) { bandEl.remove(); return; }
    bandEl.style.top = (at.top - 4) + 'px';
    bandEl.style.height = (at.bottom - at.top + 8) + 'px';
    mirror.appendChild(bandEl);
  }

  function syncMetrics() {
    const cs = getComputedStyle(ta);
    MIRROR_METRICS.forEach(p => { mirror.style[p] = cs[p]; });
    const bl = parseFloat(cs.borderLeftWidth) || 0, br = parseFloat(cs.borderRightWidth) || 0;
    const scrollbar = Math.max(0, ta.offsetWidth - ta.clientWidth - bl - br);
    mirror.style.borderRightWidth = (br + scrollbar) + 'px';
  }

  function paint(force) {
    const text = ta.value;
    const focused = document.activeElement === ta;
    const from = focused ? _lineAt(text, ta.selectionStart) : -1;
    const to = focused ? _lineAt(text, ta.selectionEnd) : -1;
    const key = from + ':' + to;
    if (!force && key === rawLines) return;
    rawLines = key;
    // A trailing newline ends in an empty line that a div would not draw;
    // the zero-width space gives it its height, as the textarea does.
    mirror.replaceChildren(..._renderMarkedText(text, from, to), '\u200b');
    mirror.scrollTop = ta.scrollTop;
    placeBand();
  }

  ta.addEventListener('input', () => paint(true));
  ta.addEventListener('scroll', () => { mirror.scrollTop = ta.scrollTop; });
  ta.addEventListener('focus', () => paint(false));
  ta.addEventListener('blur', () => paint(false));
  // The caret moving to another line changes which line is drawn raw.
  // The textarea is rebuilt on every render, so the listener retires
  // itself once its textarea has left the page.
  const onSelection = () => {
    if (!ta.isConnected) { document.removeEventListener('selectionchange', onSelection); return; }
    if (document.activeElement === ta) paint(false);
  };
  document.addEventListener('selectionchange', onSelection);
  if (window.ResizeObserver) new ResizeObserver(() => { syncMetrics(); paint(true); }).observe(ta);

  syncMetrics();
  paint(true);
  const repaint = () => paint(true);
  repaint.band = (k) => {
    if (k === bandVerse) return;
    bandVerse = k;
    placeBand();
  };
  repaint.verses = verses;
  return repaint;
}

/* Marks a section at the caret's line: "[Refren]" on a line of its own,
 * just above the line the caret is on, or on that line when it is empty.
 * A blank line goes before it, unless one is there already, since that is
 * what separates sections; the caret lands on the line after the mark,
 * ready for the section's first line. */
function _withSection(text, caret, label) {
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
  let lineEnd = text.indexOf('\n', caret);
  if (lineEnd < 0) lineEnd = text.length;
  const blank = !text.slice(lineStart, lineEnd).trim();

  let head = text.slice(0, lineStart);
  if (head && !head.endsWith('\n\n')) head += '\n';
  const tail = blank ? text.slice(lineEnd) : '\n' + text.slice(lineStart);
  const mark = '[' + label + ']';
  return {
    text: head + mark + (tail || '\n'),
    caret: head.length + mark.length + 1
  };
}

/* The section name being typed: a "[" opening the caret's line, and
 * whatever follows it up to the caret. Null otherwise — including once the
 * bracket is closed, so a mark typed out in full is left alone. */
function _typedSection(ta) {
  if (ta.selectionStart !== ta.selectionEnd) return null;
  const text = ta.value, caret = ta.selectionStart;
  const start = text.lastIndexOf('\n', caret - 1) + 1;
  const m = /^\[([^\[\]\n]*)$/.exec(text.slice(start, caret));
  return m ? { start, typed: m[1] } : null;
}

/* The sections offered for a line, narrowed to what has been typed after
 * the "[". When the source text is marked, the section it has next —
 * counting the marks above this line — comes first, which keeps the
 * translation's structure in step with the original's. The original
 * itself is in English, so it is offered the English names, and nothing
 * to keep in step with. */
function _sectionChoices(text, lineStart, typed, inOriginal) {
  const above = window.Sections.list(text.slice(0, lineStart));
  const verseNo = above.filter(s => s.kind === 'Strofa').length + 1;
  let suggested = null, choices;
  if (inOriginal) {
    choices = ['Verse ' + verseNo, ...SECTION_CHOICES_EN];
  } else {
    const fromOriginal = isOriginal(_song) ? [] : window.Sections.list(_song.originalText);
    const next = fromOriginal[above.length];
    suggested = next ? window.Sections.romanian(next) : null;
    choices = ['Strofa ' + verseNo, ...SECTION_CHOICES];
  }

  const fold = (x) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const want = fold(typed.trim());
  return [...new Set([suggested, ...choices].filter(Boolean))]
    .filter(l => fold(l).startsWith(want))
    .map(l => ({ label: l, suggested: l === suggested }));
}

/* The verses of a text: runs of non-blank lines, each with where it sits
 * in the text, so an edit to one can be put back in place without
 * touching the blank lines around it. */
function _verses(text) {
  const out = [];
  let pos = 0, cur = null;
  for (const line of String(text || '').split('\n')) {
    const end = pos + line.length;
    if (line.trim()) {
      if (cur) cur.end = end;
      else { cur = { start: pos, end }; out.push(cur); }
    } else {
      cur = null;
    }
    pos = end + 1;
  }
  return out;
}

// The section a verse opens with, by its Romanian name, if it is marked.
function _verseKind(text) {
  const sec = window.Sections.parse(String(text).split('\n')[0]);
  return sec ? sec.kind : null;
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
 * once must not be overtaken by a stale pending save. */
function _editedText({ text, history, canEdit, write, save }) {
  const debouncedSave = debounce(() => save(doc.text), 600);
  const doc = {
    text, history, canEdit,
    onChange: () => {},
    showHistory: () => {},          // the view redraws what undo landed on
    typed(next) {
      if (!history.pending) {
        history.undo.push(history.last);
        history.redo = [];
        history.pending = true;
      }
      doc.text = next;
      write(next);
      debouncedSave();
      doc.onChange();
    },
    replaced(next) {
      if (!history.pending) history.undo.push(doc.text);
      history.redo = [];
      doc.settle(next);
    },
    settle(next) {
      doc.text = next;
      write(next);
      history.last = next;
      history.pending = false;
      save(next);
      doc.onChange();
    },
    // Undo moves from `from` to `to`; redo the other way round.
    step(from, to) {
      if (!from.length) return;
      to.push(doc.text);
      const t = from.pop();
      doc.settle(t);
      doc.showHistory(t);
    }
  };
  return doc;
}

function _renderTextTab(content) {
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
    disabled: !active || !canEdit,
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
    _showingAllVersions() || _showingVerseGrid() ? null : _notesButton(active, false),
    lookupBtn,
    undoBtn,
    redoBtn
  ]);

  /* ---- the texts being edited ----
   * Two of them: the version, which both views edit, and the original,
   * edited in place in the whole view. Each is written onto its record as
   * it changes, not only once a save comes back, so a re-render in
   * between — a switch of view, a trip to Rime — starts from what was
   * typed rather than from the last save.
   *
   * Undo and redo act on whichever was focused last, the version unless
   * the original has been. */
  if (!_originalHistory || _originalHistorySongId !== _song.id) {
    _originalHistory = _newHistory(_song.originalText);
    _originalHistorySongId = _song.id;
  }
  const versionDoc = _versionDoc(active, _versionHistory);
  const originalDoc = _editedText({
    text: _song.originalText || '',
    history: _originalHistory,
    canEdit: _canEditSong(),
    write: (t) => { _song.originalText = t; },
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

  /* ---- the section strip ----
   * Typing "[" at the start of a line offers the section names in place of
   * the row under the text, filtered as more is typed. Nothing for it sits
   * on screen otherwise. Its chips keep focus, like undo/redo, so the
   * keyboard stays up through the pick. `before` is the part of the whole
   * text ahead of the box — none of it but in the verse view — which is
   * what the original's next section is counted against. */
  const strip = el('div', { class: 'section-strip', hidden: true });
  function updateStrip(ta, before, onPick, inOriginal) {
    const t = _typedSection(ta);
    const choices = t
      ? _sectionChoices(before + ta.value, before.length + t.start, t.typed, inOriginal)
      : [];
    strip.hidden = !choices.length;
    switcher.hidden = !!choices.length;
    strip.innerHTML = '';
    choices.forEach(c => strip.appendChild(el('button', {
      class: 'seg' + (c.suggested ? ' seg--active' : ''),
      onmousedown: keepFocus,
      onclick: () => onPick(t, c.label)
    }, [c.label])));
  }
  function hideStrip() { strip.hidden = true; switcher.hidden = false; }
  // The typed "[…" comes out — with a "]" the keyboard may have closed it
  // with — and the caret position it leaves is where the mark goes.
  function withoutTyped(ta, t) {
    const v = ta.value;
    let end = ta.selectionStart;
    if (v[end] === ']') end++;
    return v.slice(0, t.start) + v.slice(end);
  }

  // Writing in a version's column, with every version on screen, makes it
  // the active one.
  const activate = (version, doc) => {
    _makeActive(version);
    currentBtn.textContent = version.title || 'Fără titlu';
    lookupBtn.disabled = !doc.canEdit;
    focusDoc(doc);
  };

  const view = _showingVerses() ? _renderVersesView : _renderWholeView;
  const body = view({
    active, canEdit,
    version: versionDoc, original: originalDoc, focusDoc, activate,
    updateStrip, hideStrip, withoutTyped,
    setShowHistory: (fn) => { versionDoc.showHistory = fn; },
    setLookupTarget: (fn) => { lookupTarget = fn; }
  });

  // Anything the view adds to the row, after the version button.
  (body.tools || []).forEach(t => switcher.insertBefore(t, lookupBtn));
  content.appendChild(el('div', { class: 'text-tab-wrap' }, [body.el, strip, switcher]));
  body.mounted();
}

// Shown in an empty original-text box: how to start a section.
const SECTION_HINT = '\n\nScrie [ la început de rând pentru o secțiune: Strofa, Refren…';

/* The whole text in one box, beside the whole original — or, on a big
 * screen, every version in a box of its own, side by side after it. */
function _renderWholeView(ctx) {
  const { active, canEdit } = ctx;

  // A composition is not a translation of anything, so the box must not
  // ask for one. Everything else the two share, but the words in front of
  // an empty field are the one place the difference is obvious.
  const original = isOriginal(_song);
  const placeholderFor = (version, editable) => {
    if (!version) return original ? 'Creează o versiune ca să începi.'
                                   : 'Creează o versiune pentru a începe traducerea.';
    if (!editable) return 'Doar creatorul sau un admin poate edita această versiune.';
    // The section hint belongs with the original text only: a translation
    // follows the original's sections, so it is just noise there.
    return original ? 'Versurile tale…' + SECTION_HINT : 'Traducerea în română…';
  };

  // Run once the view is on the page, in order: restoring scroll positions
  // and attaching mirrors both need the layout.
  const mounted = [];

  // The box the lookup reads from: whichever was focused last, the
  // original included, and the active version's until one has been.
  let lookupBox = null;

  /* The box for one version's text. `onFocus` runs as it gains focus;
   * `scroll` keeps where it was scrolled to across redraws. */
  function versionBox(version, doc, onFocus, scroll) {
    const translation = el('textarea', {
      class: 'field__input text-tab__translation',
      placeholder: placeholderFor(version, doc.canEdit),
      // Someone else's version is read-only rather than disabled, as the
      // original is: not dimmed, and still focusable, so its verse can be
      // picked out across the columns. Only the empty box of a song with
      // no version yet is disabled.
      readonly: !doc.canEdit,
      disabled: !version,
      oninput: () => { doc.typed(translation.value); strip(); }
    });
    translation.value = doc.text;
    translation.addEventListener('scroll', () => scroll.set(translation.scrollTop));
    // Redraws the formatted section marks; set once the editor is mounted.
    let repaint = () => {};

    const strip = () => doc.canEdit && ctx.updateStrip(translation, '', (t, label) => {
      const r = _withSection(ctx.withoutTyped(translation, t), t.start, label);
      translation.value = r.text;
      doc.replaced(r.text);
      _scrollCaretIntoView(translation, r.caret);
      translation.setSelectionRange(r.caret, r.caret);
      repaint();
      strip();
    });
    // The caret can leave the line without any typing: arrow keys, a tap.
    translation.addEventListener('keyup', strip);
    translation.addEventListener('mouseup', strip);
    translation.addEventListener('blur', ctx.hideStrip);
    translation.addEventListener('focus', onFocus);
    doc.showHistory = (t) => { _applyHistoryText(translation, t); repaint(); };

    const mirror = el('div', { class: 'editor__mirror', 'aria-hidden': 'true' });
    // Restored after mounting rather than left at the browser's default (0)
    // — this runs on every render, including a plain tab-switch-back where
    // nothing about the song actually changed, which is exactly when
    // jumping back to the top would be most jarring. Reading offsetHeight
    // first forces the layout that scrollTop's setter otherwise needs and
    // may not have yet, right after building fresh DOM — without it the
    // assignment can silently no-op.
    mounted.push(() => {
      void translation.offsetHeight;
      translation.scrollTop = scroll.get();
      // Only once mounted: it copies the textarea's computed layout.
      repaint = _attachMirror(translation, mirror);
    });
    return {
      ta: translation,
      editor: el('div', { class: 'editor' }, [mirror, translation]),
      get mirror() { return repaint; }
    };
  }

  // A composition has no source, so it gets one box instead of two. No
  // stylesheet change is needed for that: .text-tab__col is flex:1, so a
  // lone column fills the row at either breakpoint.
  const cols = [];
  // Every box on screen, original first, for _linkColumns.
  const panes = [];
  let originalEl = null, originalMirror = null, repaintOriginal = () => {};
  if (!original) {
    // The original, edited in place — the same editor as the translation,
    // in the reference panel's colours. Read-only rather than disabled for
    // someone who may not change the song: still selectable and copyable,
    // and not dimmed, since it is what everyone translates from.
    const doc = ctx.original;
    originalEl = el('textarea', {
      class: 'field__input text-tab__translation text-tab__source',
      placeholder: doc.canEdit ? 'Textul original…' + SECTION_HINT : '',
      readonly: !doc.canEdit,
      oninput: () => { doc.typed(originalEl.value); originalStrip(); }
    });
    originalEl.value = doc.text;
    originalEl.addEventListener('scroll', () => { _originalScrollTop = originalEl.scrollTop; });
    originalEl.addEventListener('focus', () => { lookupBox = originalEl; ctx.focusDoc(doc); });
    const originalStrip = () => {
      if (!doc.canEdit) return;
      ctx.updateStrip(originalEl, '', (t, label) => {
        const r = _withSection(ctx.withoutTyped(originalEl, t), t.start, label);
        originalEl.value = r.text;
        doc.replaced(r.text);
        _scrollCaretIntoView(originalEl, r.caret);
        originalEl.setSelectionRange(r.caret, r.caret);
        repaintOriginal();
        originalStrip();
      }, true);
    };
    originalEl.addEventListener('keyup', originalStrip);
    originalEl.addEventListener('mouseup', originalStrip);
    originalEl.addEventListener('blur', ctx.hideStrip);
    doc.showHistory = (t) => { _applyHistoryText(originalEl, t); repaintOriginal(); };

    originalMirror = el('div', { class: 'editor__mirror', 'aria-hidden': 'true' });
    cols.push(el('div', { class: 'text-tab__col' }, [
      _showingAllVersions() ? _headRow(el('div', { class: 'text-tab__head' }, ['Original']), null) : null,
      el('div', { class: 'editor editor--source' }, [originalMirror, originalEl])
    ]));
    mounted.push(() => {
      void originalEl.offsetHeight;
      originalEl.scrollTop = _originalScrollTop;
      repaintOriginal = _attachMirror(originalEl, originalMirror);
    });
    panes.push({ ta: originalEl, get mirror() { return repaintOriginal; } });
  }

  if (_showingAllVersions()) {
    // Every version, in the order they were made, named above its box.
    _versions.forEach(v => {
      const doc = v.id === _activeVersionId ? ctx.version : _versionDoc(v, _historyFor(v));
      const head = el('button', {
        class: 'text-tab__head' + (v.id === _activeVersionId ? ' text-tab__head--active' : ''),
        onclick: () => box.ta.focus()
      }, [v.title || 'Fără titlu']);
      const box = versionBox(v, doc, () => {
        lookupBox = box.ta;
        ctx.activate(v, doc);
        document.querySelectorAll('.text-tab__head--active')
          .forEach(h => h.classList.remove('text-tab__head--active'));
        head.classList.add('text-tab__head--active');
      }, {
        get: () => _columnScrollTops.get(v.id) || 0,
        set: (top) => _columnScrollTops.set(v.id, top)
      });
      if (v.id === _activeVersionId && !lookupBox) lookupBox = box.ta;
      panes.push(box);
      cols.push(el('div', { class: 'text-tab__col' }, [_headRow(head, v), box.editor]));
    });
    ctx.setLookupTarget(() => lookupBox);
  } else {
    const box = versionBox(active, ctx.version, () => { lookupBox = box.ta; ctx.focusDoc(ctx.version); }, {
      get: () => _translationScrollTop,
      set: (top) => { _translationScrollTop = top; }
    });
    ctx.setLookupTarget(() => lookupBox || box.ta);
    panes.push(box);
    cols.push(el('div', { class: 'text-tab__col' }, [box.editor]));
  }

  const link = panes.length > 1 ? _linkColumns(panes) : null;
  return {
    el: el('div', { class: 'text-tab' + (_showingAllVersions() ? ' text-tab--all' : '') }, cols),
    tools: link ? [link.button] : [],
    mounted() { mounted.forEach(fn => fn()); if (link) link.start(); }
  };
}

/* The columns of the whole view, kept together.
 *
 * Wherever the caret is, its verse is shaded — in its own box and, in
 * every other, the verse that goes with it. With the columns linked (the
 * chain button, on by default and remembered on this device), the others
 * also scroll: when the caret moves to another verse, to bring theirs
 * level with it, and as one box is scrolled, to keep the same part of the
 * song in view. Scrolling them by the same amount instead would drift
 * apart within a few verses: a verse is rarely as long in two languages,
 * nor wraps alike.
 *
 * Which verse goes with which: by section mark when the caret's verse has
 * one and the other text has it too — the second [Chorus] with the second
 * [Refren], or the last there is when the other side wrote it out fewer
 * times — and otherwise by position, as the verse view pairs them. */
const LINK_KEY = 'talmaci:linkedColumns';
const SIDE_BY_SIDE = window.matchMedia('(min-width: 640px)');
const LINK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>`;

function _columnsLinked() {
  try { return localStorage.getItem(LINK_KEY) !== 'off'; } catch (_) { return true; }
}

// The verse an offset falls in, by its index in _verses, or -1 between verses.
function _verseAt(text, pos) {
  return _verses(text).findIndex(v => pos >= v.start && pos <= v.end);
}

// What a verse's section mark says, the same in either language, or null
// when the verse has none.
function _sectionKey(text, v) {
  const sec = window.Sections.parse(text.slice(v.start, v.end).split('\n')[0]);
  if (!sec) return null;
  return sec.kind ? sec.kind + ' ' + (sec.number || '') : sec.text.toLowerCase();
}

// The verse of `to` that goes with verse k of `from`, or -1.
function _matchVerse(from, k, to) {
  const fv = _verses(from), tv = _verses(to);
  if (k < 0 || k >= fv.length) return -1;
  const key = _sectionKey(from, fv[k]);
  if (key) {
    const nth = fv.slice(0, k).filter(v => _sectionKey(from, v) === key).length;
    const same = tv.map((v, j) => j).filter(j => _sectionKey(to, tv[j]) === key);
    if (same.length) return same[Math.min(nth, same.length - 1)];
  }
  return k < tv.length ? k : -1;
}

function _linkColumns(panes) {
  let linked = _columnsLinked();
  let from = null, verse = -1;    // the box with the caret, and its verse

  const button = el('button', {
    class: 'version-switcher__nav text-tab__link' + (linked ? ' btn--icon-on' : ''),
    'aria-label': 'Coloane legate',
    'aria-pressed': String(linked),
    title: 'Coloane legate: derulează împreună',
    html: LINK_ICON,
    onmousedown: (e) => e.preventDefault(),
    onclick: () => {
      linked = !linked;
      try { localStorage.setItem(LINK_KEY, linked ? 'on' : 'off'); } catch (_) {}
      button.classList.toggle('btn--icon-on', linked);
      button.setAttribute('aria-pressed', String(linked));
      if (linked && from) level(from, verse);
    }
  });

  // A box scrolled from here, rather than by hand, is let be for a moment,
  // so that its own scroll does not go on to move the others back.
  const scrollTo = (p, top) => {
    p.quietUntil = performance.now() + 150;
    p.ta.scrollTop = top;
  };
  const following = () => linked && SIDE_BY_SIDE.matches;

  // Brings verse k of `src` level, on screen, with its verse in every
  // other box.
  function level(src, k) {
    if (!following() || k < 0) return;
    const at = src.mirror.verses()[k];
    if (!at) return;
    const y = src.ta.getBoundingClientRect().top + at.top - src.ta.scrollTop;
    panes.forEach(p => {
      if (p === src) return;
      const there = p.mirror.verses()[_matchVerse(src.ta.value, k, p.ta.value)];
      if (there) scrollTo(p, there.top - (y - p.ta.getBoundingClientRect().top));
    });
  }

  // Shades the caret's verse everywhere, and levels the others with it
  // when the caret has moved to another verse.
  function update(src) {
    const k = _verseAt(src.ta.value, src.ta.selectionStart);
    panes.forEach(p => {
      const j = p === src ? k : _matchVerse(src.ta.value, k, p.ta.value);
      p.mirror.band(j < 0 ? null : j);
    });
    if (src !== from || k !== verse) {
      from = src;
      verse = k;
      level(src, k);
    }
  }

  /* As one box scrolls, each other keeps the same part of the song in
   * view: the point a third of the way down the box is followed through
   * the verses both have, top to top and bottom to bottom, and
   * proportionally through whatever lies between. */
  function follow(src) {
    if (!following()) return;
    const fv = src.mirror.verses();
    const anchor = src.ta.scrollTop + src.ta.clientHeight / 3;
    panes.forEach(p => {
      if (p === src) return;
      const tv = p.mirror.verses();
      const pts = [[0, 0]];
      fv.forEach((a, k) => {
        const b = tv[_matchVerse(src.ta.value, k, p.ta.value)];
        const last = pts[pts.length - 1];
        if (!b || b.top < last[1] || a.top < last[0]) return;
        pts.push([a.top, b.top], [a.bottom, b.bottom]);
      });
      pts.push([Math.max(src.ta.scrollHeight, pts[pts.length - 1][0]),
                Math.max(p.ta.scrollHeight, pts[pts.length - 1][1])]);
      let i = 1;
      while (i < pts.length - 1 && pts[i][0] < anchor) i++;
      const [a0, b0] = pts[i - 1], [a1, b1] = pts[i];
      const t = a1 > a0 ? Math.min(1, Math.max(0, (anchor - a0) / (a1 - a0))) : 0;
      scrollTo(p, b0 + t * (b1 - b0) - p.ta.clientHeight / 3);
    });
  }

  function start() {
    panes.forEach(p => {
      let frame = 0;
      p.ta.addEventListener('scroll', () => {
        if (performance.now() < (p.quietUntil || 0) || frame) return;
        frame = requestAnimationFrame(() => { frame = 0; follow(p); });
      });
      p.ta.addEventListener('focus', () => update(p));
      p.ta.addEventListener('input', () => update(p));
    });
    // The caret moving without typing: arrow keys, a click. The view is
    // rebuilt on every render, so the listener retires itself once its
    // boxes have left the page.
    const onSelection = () => {
      if (!panes[0].ta.isConnected) { document.removeEventListener('selectionchange', onSelection); return; }
      const p = panes.find(x => x.ta === document.activeElement);
      if (p) update(p);
    };
    document.addEventListener('selectionchange', onSelection);
  }

  return { button, start };
}

/* Each verse of the original above its verse of the translation — or, on
 * a big screen with more than one version, beside its verse in every
 * version, one column each (see _showingVerseGrid), so the rows line the
 * same verse up across all of them with nothing to scroll in step.
 *
 * Verses are runs of lines between blank lines, on every side, and are
 * paired by position: the first with the first, and so on. Every verse,
 * on any side, is its own box, but each side stays one string — an edit
 * goes back into it in place, so the blank lines between verses, and the
 * other view, are left exactly as they were.
 *
 * Pairing by position goes wrong from the first verse one side has and the
 * other does not — typically a chorus written out again on one side only.
 * That is shown rather than guessed at: a count of the sides when they
 * differ, and a note on any row whose section marks disagree. */
function _renderVersesView(ctx) {
  // One side of the rows: the original or a version. `spans` are the live
  // positions of its verses in its text, shifted as edits change their
  // lengths; rebuilt only on a full redraw.
  const side = (doc, editable, inOriginal) => ({ doc, editable, inOriginal, spans: [], boxes: [] });
  const orig = side(ctx.original, ctx.original.canEdit, true);
  const grid = _showingVerseGrid();
  const trs = grid
    ? _versions.map(v => {
        const doc = v.id === _activeVersionId ? ctx.version : _versionDoc(v, _historyFor(v));
        return Object.assign(side(doc, _canEditVersion(v), false), { version: v, title: v.title || 'Fără titlu' });
      })
    : [side(ctx.version, !!ctx.active && ctx.canEdit, false)];
  // A version's stand-ins come from the original; the original's from the
  // version being worked on.
  trs.forEach(t => { t.other = orig; });
  orig.other = trs.find(t => !t.version || t.version.id === _activeVersionId) || trs[0];
  let lastBox = null;

  const list = el('div', { class: 'verses' });
  const wrap = el('div', { class: 'verses-wrap' + (grid ? ' verses-wrap--all' : '') }, [list]);
  wrap.addEventListener('scroll', () => { _versesScrollTop = wrap.scrollTop; });
  // Every column as wide as the others, and never narrower than a line of
  // lyrics needs: past what fits, the rows scroll sideways together.
  const columns = `repeat(${1 + trs.length}, minmax(260px, 1fr))`;
  const heads = [];
  if (grid) list.style.minWidth = `${(1 + trs.length) * 260 + 4}px`;

  /* A stand-in for a verse not written yet, so that one typed further down
   * keeps its place: verses are told apart by position, and a verse typed
   * into the third card with nothing above it would otherwise be the
   * first. It is the other side's section mark, named in this side's
   * language, or "[…]" when that verse is not marked — a line of its own,
   * so the verse stays a verse, and plainly something to replace. */
  function stub(s, k) {
    const o = s.other;
    const verse = k < o.spans.length ? o.doc.text.slice(o.spans[k].start, o.spans[k].end) : '';
    const sec = window.Sections.parse(verse.split('\n')[0]);
    const name = !sec ? '…' : s.inOriginal ? window.Sections.english(sec) : window.Sections.romanian(sec);
    return '[' + name + ']';
  }

  // Writes box i of a side back into its text. A box past the last verse
  // starts a new one at the end, after a blank line, with stand-ins for
  // any verses between — shown in their own boxes straight away.
  function write(s, i, value) {
    let text = s.doc.text;
    if (i >= s.spans.length) {
      text = text.replace(/\s+$/, '');
      for (let k = s.spans.length; k <= i; k++) {
        if (text) text += '\n\n';
        const fill = k < i ? stub(s, k) : '';
        s.spans.push({ start: text.length, end: text.length + fill.length });
        text += fill;
        const box = s.boxes[k];
        if (fill && box) { box.value = fill; _fitHeight(box); box.repaint(); }
      }
    }
    const sp = s.spans[i];
    const delta = value.length - (sp.end - sp.start);
    text = text.slice(0, sp.start) + value + text.slice(sp.end);
    sp.end += delta;
    for (let j = i + 1; j < s.spans.length; j++) { s.spans[j].start += delta; s.spans[j].end += delta; }
    return text;
  }

  /* The box for verse i of a side, with everything an editor box has:
   * formatted section marks, the "[" strip, undo through the side's own
   * history. Any box can be written in, even far past the side's last
   * verse — see write. A side that may not be edited is read-only where it
   * has verses, rather than disabled, so it is not dimmed. */
  function verseBox(s, i, value, placeholder, mounted) {
    const ta = el('textarea', {
      class: 'field__input verse__box',
      rows: 1,
      placeholder,
      readonly: !s.editable && i < s.spans.length,
      disabled: !s.editable && i >= s.spans.length
    });
    ta.value = value;
    const mirror = el('div', { class: 'editor__mirror', 'aria-hidden': 'true' });
    let repaint = () => {};
    ta.repaint = () => repaint();

    const strip = () => {
      if (!s.editable) return;
      const before = s.doc.text.slice(0, i < s.spans.length ? s.spans[i].start : undefined);
      ctx.updateStrip(ta, before, (t, label) => {
        // Inside a verse the mark only takes its own line: the blank line
        // that _withSection adds would split the verse in two.
        const v = ctx.withoutTyped(ta, t);
        const rest = v.slice(t.start);
        const mark = '[' + label + ']';
        ta.value = v.slice(0, t.start) + mark + (rest.startsWith('\n') ? rest : '\n' + rest);
        const caret = t.start + mark.length + 1;
        s.doc.replaced(write(s, i, ta.value));
        ta.setSelectionRange(caret, caret);
        _fitHeight(ta);
        repaint();
        strip();
      }, s.inOriginal);
    };
    ta.addEventListener('input', () => {
      s.doc.typed(write(s, i, ta.value));
      _fitHeight(ta);
      strip();
    });
    ta.addEventListener('focus', () => {
      // The lookup reads from any side: the original's words go to the
      // English dictionary, a version's to Rime and Sinonime. Writing in a
      // version's column makes it the active one, as in the whole view.
      lastBox = ta;
      if (s.version) {
        ctx.activate(s.version, s.doc);
        heads.forEach(h => h.classList.toggle('text-tab__head--active', h.side === s));
      } else {
        ctx.focusDoc(s.doc);
      }
    });
    ta.addEventListener('keyup', strip);
    ta.addEventListener('mouseup', strip);
    ta.addEventListener('blur', ctx.hideStrip);

    s.boxes[i] = ta;
    mounted.push(() => { _fitHeight(ta); repaint = _attachMirror(ta, mirror); });
    return el('div', {
      class: 'editor verse__editor' + (s.inOriginal ? ' editor--source verse__editor--source' : '')
    }, [mirror, ta]);
  }

  // In the grid every cell is set in its own column, an empty one too, so
  // a version with no verse in a row leaves a gap rather than letting the
  // next column slide into its place.
  const place = (cell, col) => { if (grid) cell.style.gridColumn = String(col); return cell; };
  const gap = (s, col) => place(el('div', {
    class: 'verse__gap' + (s.inOriginal ? ' verse__gap--source' : '')
  }), col);

  function draw() {
    const ot = orig.doc.text;
    orig.spans = _verses(ot);
    orig.boxes = [];
    trs.forEach(s => { s.spans = _verses(s.doc.text); s.boxes = []; });
    list.innerHTML = '';
    heads.length = 0;
    const mounted = [];
    const on = orig.spans.length;
    // Room for one more verse at the end of whichever side can take it.
    const n = Math.max(on + (orig.editable ? 1 : 0), on,
      ...trs.map(s => s.spans.length + (s.editable ? 1 : 0)));

    const off = trs.filter(s => s.spans.length && s.spans.length !== on);
    const strofe = (k) => `${k} ${k === 1 ? 'strofă' : 'strofe'}`;
    if (off.length) {
      list.appendChild(el('p', { class: 'verses__note' }, [
        `Originalul are ${strofe(on)}, ` +
        (grid ? off.map(s => `${s.title} ${s.spans.length}`).join(', ')
              : `traducerea ${off[0].spans.length}`) +
        '. De la prima diferență, perechile pot fi decalate — ' +
        'verifică rândurile goale dintre strofe.'
      ]));
    }

    // Who is in which column, kept in view while the rows scroll by.
    if (grid) {
      const row = el('div', { class: 'verses__heads' }, [
        place(_headRow(el('div', { class: 'text-tab__head' }, ['Original']), null), 1)
      ]);
      row.style.gridTemplateColumns = columns;
      trs.forEach((s, c) => {
        const h = el('div', {
          class: 'text-tab__head' + (s.version.id === _activeVersionId ? ' text-tab__head--active' : '')
        }, [s.title]);
        h.side = s;
        heads.push(h);
        row.appendChild(place(_headRow(h, s.version), c + 2));
      });
      list.appendChild(row);
    }

    for (let i = 0; i < n; i++) {
      const o = i < on ? ot.slice(orig.spans[i].start, orig.spans[i].end) : null;
      const ts = trs.map(s => i < s.spans.length ? s.doc.text.slice(s.spans[i].start, s.spans[i].end) : null);
      const any = ts.some(t => t != null);
      const pair = el('div', { class: 'verse' + (grid ? ' verse--grid' : '') });
      if (grid) pair.style.gridTemplateColumns = columns;

      // Past the original's last verse, its box says why a version's verse
      // has nothing beside it — or, by the last empty version box, offers
      // room for one more. Neither, and the row has none.
      if (o != null) {
        pair.appendChild(place(verseBox(orig, i, o, '', mounted), 1));
      } else if (any || (orig.editable && i === on)) {
        const ph = any ? 'Fără pereche în original' : 'Strofa următoare din original…';
        pair.appendChild(place(verseBox(orig, i, '', ph, mounted), 1));
      } else if (grid) {
        pair.appendChild(gap(orig, 1));
      }
      // By every original verse, and one more for a verse of its own.
      trs.forEach((s, c) => {
        const t = ts[c];
        if (i <= s.spans.length || o != null) {
          const ph = t != null ? '' : o != null ? 'Traducerea…' : 'Strofa următoare…';
          pair.appendChild(place(verseBox(s, i, t || '', ph, mounted), c + 2));
        } else if (grid) {
          pair.appendChild(gap(s, c + 2));
        }
      });

      const ok = o != null ? _verseKind(o) : null;
      const clash = ok ? trs.map((s, c) => ({ s, k: ts[c] != null ? _verseKind(ts[c]) : null }))
        .filter(x => x.k && x.k !== ok) : [];
      if (clash.length) {
        pair.appendChild(el('p', { class: 'verses__note verses__note--pair' }, [
          grid ? `Aici originalul are ${ok}; ` + clash.map(x => `${x.s.title}: ${x.k}`).join(', ') + '.'
               : `Aici originalul are ${ok}, traducerea ${clash[0].k}.`
        ]));
      }
      list.appendChild(pair);
    }
    return mounted;
  }

  ctx.setLookupTarget(() => lastBox && lastBox.isConnected ? lastBox : null);
  // Undo can change any verse, add one or remove one, so it redraws them
  // all rather than working out which box it touched.
  const redraw = () => {
    const keep = wrap.scrollTop;
    draw().forEach(f => f());
    wrap.scrollTop = keep;
  };
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
    }
  };
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
async function _saveVersionText(versionId, history, text) {
  if (!versionId) return;
  const song = _song;
  try {
    const { queued, sent } = await window.Db.setVersionText(song.id, versionId, text);
    if (queued) _queued(sent, 'Nu am putut salva textul');
    const version = _versions.find(v => v.id === versionId);
    window.Activity.log(song, 'version_text', { versionTitle: version ? version.title : '' }, versionId);
    // The version's text is kept current as it is typed (see the Text
    // tab), so it is not set back here to whatever this save carried.
    history.last = text;
    history.pending = false;
  } catch (err) {
    toast(failText('Nu am putut salva textul', err), { kind: 'error' });
  }
}

// The original text, edited in place on the Text tab. The song list keeps
// its own copy for the snippet under each title, so it is told as well.
async function _saveOriginalText(text) {
  const song = _song;
  try {
    const { queued, sent } = await window.Db.setOriginalText(song.id, text);
    if (queued) _queued(sent, 'Nu am putut salva originalul');
    window.Songs.noteUpdated(song.id, { originalText: text });
    window.Activity.log(song, 'original_text', null, 'original');
    if (_originalHistory && _originalHistorySongId === song.id) {
      _originalHistory.last = text;
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
    return el('div', { class: 'version-row' }, [
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
              text: '',
              createdBy: window.Auth.currentUser().uid
            });
            const now = Date.now();
            // With its creator, as listVersions would bring it: that is
            // who may write in it, and without it the version you just
            // made would be read-only to you until the song is reloaded.
            _versions.push({ id, title, text: '', createdBy: window.Auth.currentUser().uid, createdAt: now, updatedAt: now });
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
      onclick: () => { closeSheet(overlay); _refreshSong(root); }
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
        if (!_song.originalText || !_song.originalText.trim()) {
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
      closeSheet(overlay);
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
            closeSheetThen(overlay, () => { location.hash = '#/'; });
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
      location.hash = '#/';
      return;
    }
    _song = refreshed;
    window.Songs.noteUpdated(_song.id, refreshed);
    _versions = await window.Db.listVersions(_song.id);
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
    const v = await window.Translator.generateMotAMotVersion(_song.id, _song.originalText, _versions, window.Auth.currentUser().uid, window.Auth.isAdmin());
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
  _song = null;
  _versions = [];
  _activeVersionId = null;
  _undoStateVersionId = undefined;
  _versionHistory = _newHistory('');
  _originalHistory = null;
  _originalHistorySongId = null;
  _otherHistories = new Map();
  _originalScrollTop = 0;
  _columnScrollTops = new Map();
  _translationScrollTop = 0;
  _versesScrollTop = 0;
}

window.SongDetail = { render, reset };

})();
