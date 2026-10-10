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
const { el, toast, debounce, openSheet, closeSheet, closeSheetThen, icons, menuLabel, normalizeUrl, isOriginal } = window.Utils;

const ROW_ICONS = {
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  delete: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`
};

// Two stacked pairs of lines — the original over its translation.
const VERSES_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="7" rx="1.5"/><rect x="3" y="14" width="18" height="7" rx="1.5"/><path d="M7 6.5h10M7 17.5h7"/></svg>`;

// A magnifier — looks the word at the caret up in Rime or Sinonime.
const LOOKUP_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>`;

// The sections offered when marking one, in the order a song usually runs.
// Strofa is left out: it is offered numbered, as the next one due.
const SECTION_CHOICES = ['Pre-refren', 'Refren', 'Bridge', 'Intro', 'Interludiu', 'Final'];

const UNDO_REDO_ICONS = {
  undo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>`,
  redo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>`
};

let _song = null;
let _versions = [];       // [{ id, title, text, createdAt, updatedAt }]
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
let _undoStateVersionId;
let _undoStack = [];
let _redoStack = [];
let _lastText = '';
let _checkpointPending = false;

// Scroll position of the original-text panel and the translation box.
// _translationScrollTop resets inside _syncUndoState, right alongside the
// undo history, since both are scoped to "which version" the same way;
// _originalScrollTop is scoped to the song instead (the original doesn't
// change between versions of the same song) and is reset below, only when
// render() is actually loading a different song.
let _originalScrollTop = 0;
let _translationScrollTop = 0;
let _versesScrollTop = 0;

// Which view the Text tab shows a translation in: 'whole' — the original
// beside the translation, each in one piece — or 'verses', each verse of
// the original above its verse of the translation. A way of working, not
// a property of the song, so it is remembered per device for every song.
const VIEW_KEY = 'talmaci:textView';
let _view = (() => { try { return localStorage.getItem(VIEW_KEY) || 'whole'; } catch (_) { return 'whole'; } })();

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
      _versions = [{ id, title: 'Versiunea 1', text: _song.translatedText, createdAt: now, updatedAt: now }];
    }

    const remembered = _recallVersion(songId);
    const rememberedStillExists = remembered && _versions.some(v => v.id === remembered);
    _activeVersionId = rememberedStillExists ? remembered
      : (_versions.length ? _versions[_versions.length - 1].id : null);
  } catch (err) {
    toast('Nu am putut încărca melodia: ' + err.message, { kind: 'error' });
    _song = null;
  }

  if (!_song) {
    root.appendChild(el('div', { class: 'empty-state' }, ['Melodia nu a fost găsită.']));
    return;
  }

  _renderShell(root);
}

function _renderShell(root) {
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
      class: 'btn btn--icon' + (_view === 'verses' ? ' btn--icon-on' : ''),
      'aria-label': 'Pe strofe',
      'aria-pressed': _view === 'verses' ? 'true' : 'false',
      title: _view === 'verses' ? 'Textul întreg' : 'Pe strofe',
      html: VERSES_ICON,
      onclick: () => {
        _view = _view === 'verses' ? 'whole' : 'verses';
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
  _undoStack = [];
  _redoStack = [];
  _lastText = active ? (active.text || '') : '';
  _checkpointPending = false;
  _translationScrollTop = 0;
  _versesScrollTop = 0;
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

/* Rime or Sinonime for the word at the caret, without retyping it. One
 * button for both keeps the row under the text short; the sheet it opens
 * names the word, so a caret a letter off shows before the trip, not
 * after. The other tab keeps the word and Text keeps its place, so the
 * tab bar is the way back. */
function _openLookup(ta) {
  const word = _wordAtCaret(ta);
  if (!word) {
    toast('Pune cursorul pe un cuvânt.');
    return;
  }
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  const go = (tab) => closeSheetThen(overlay, () => {
    if (tab === 'rime') window.RimeTab.search(word);
    else window.SinonimeTab.show(word);
    window.App.openTab(tab);
  });
  overlay.appendChild(el('div', { class: 'sheet' }, [
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
 * sit in text drawn the way the textarea itself lays it out. */
function _renderMarkedText(text, rawFrom, rawTo) {
  const nodes = [];
  String(text || '').split('\n').forEach((line, i) => {
    if (i) nodes.push('\n');
    const sec = (i >= rawFrom && i <= rawTo) ? null : window.Sections.parse(line);
    nodes.push(sec ? el('span', { class: 'section-label' }, [sec.text]) : line);
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
 * undo, redo, a picked section. */
function _attachMirror(ta, mirror) {
  let rawLines = '';

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
  return () => paint(true);
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
 * translation's structure in step with the original's. */
function _sectionChoices(text, lineStart, typed) {
  const above = window.Sections.list(text.slice(0, lineStart));
  const strofa = 'Strofa ' + (above.filter(s => s.kind === 'Strofa').length + 1);
  const fromOriginal = isOriginal(_song) ? [] : window.Sections.list(_song.originalText);
  const next = fromOriginal[above.length];
  const suggested = next ? window.Sections.romanian(next) : null;

  const fold = (x) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const want = fold(typed.trim());
  return [...new Set([suggested, strofa, ...SECTION_CHOICES].filter(Boolean))]
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
    disabled: !canEdit || !_undoStack.length,
    onmousedown: keepFocus
  });
  const redoBtn = el('button', {
    class: 'version-switcher__nav',
    'aria-label': 'Refă',
    html: UNDO_REDO_ICONS.redo,
    disabled: !canEdit || !_redoStack.length,
    onmousedown: keepFocus
  });

  // Same focus handling as undo/redo, and for a second reason too: the
  // selection has to still be in the textarea when the click reads it.
  const lookupBtn = el('button', {
    class: 'version-switcher__nav',
    'aria-label': 'Rime sau sinonime pentru cuvânt',
    title: 'Rime sau sinonime pentru cuvânt',
    html: LOOKUP_ICON,
    disabled: !active || !canEdit,
    onmousedown: keepFocus
  });

  const switcher = el('div', { class: 'version-switcher' }, [
    // Enabled even with nothing to switch between. New songs are created
    // with a version, but a song from before that is not, and this button
    // is the only door to "Adaugă versiune" — disabling it was what sealed
    // those songs off with no way to start writing in them.
    el('button', {
      class: 'version-switcher__current',
      onclick: () => _openVersionList(content)
    }, [active ? (active.title || 'Fără titlu') : 'Adaugă o versiune']),
    lookupBtn,
    undoBtn,
    redoBtn
  ]);

  /* ---- the text, whichever view is editing it ----
   * Both views edit this one string. It is written onto the version as it
   * changes, not only once a save comes back, so a re-render in between —
   * a switch of view, a trip to Rime — starts from what was typed rather
   * than from the last save. */
  let text = active ? (active.text || '') : '';
  // Saves whatever the text is when the pause ends, not what it was at the
  // keystroke that scheduled it: an edit committed at once (a picked
  // section, an undo) must not be overtaken by a stale pending save.
  const debouncedSave = debounce(() => _saveVersionText(text), 600);
  const syncButtons = () => {
    undoBtn.disabled = !canEdit || !_undoStack.length;
    redoBtn.disabled = !canEdit || !_redoStack.length;
  };
  // A typed edit: one undo checkpoint per pause in typing (matching the
  // save debounce), not one per keystroke — otherwise undo would only
  // ever step back a single character at a time.
  function typed(next) {
    if (!_checkpointPending) {
      _undoStack.push(_lastText);
      _redoStack = [];
      _checkpointPending = true;
    }
    text = next;
    if (active) active.text = next;
    debouncedSave();
    syncButtons();
  }
  // An edit made in one go — a picked section — saved at once as a single
  // undo step. A checkpoint still pending from typing its "[" already
  // holds the text from before it, so that one is kept.
  function replaced(next) {
    if (!_checkpointPending) _undoStack.push(text);
    _redoStack = [];
    settle(next);
  }
  function settle(next) {
    text = next;
    if (active) active.text = next;
    _lastText = next;
    _checkpointPending = false;
    _saveVersionText(next);
    syncButtons();
  }

  // Whichever view is showing fills these in.
  let showHistory = () => {};       // undo/redo landed on another text
  let lookupTarget = () => null;    // the box the lookup reads its word from

  undoBtn.onclick = () => {
    if (!_undoStack.length) return;
    _redoStack.push(text);
    const prev = _undoStack.pop();
    settle(prev);
    showHistory(prev);
  };
  redoBtn.onclick = () => {
    if (!_redoStack.length) return;
    _undoStack.push(text);
    const next = _redoStack.pop();
    settle(next);
    showHistory(next);
  };
  lookupBtn.onclick = () => {
    const ta = lookupTarget();
    if (ta) _openLookup(ta);
    else toast('Pune cursorul pe un cuvânt.');
  };

  /* ---- the section strip ----
   * Typing "[" at the start of a line offers the section names in place of
   * the row under the text, filtered as more is typed. Nothing for it sits
   * on screen otherwise. Its chips keep focus, like undo/redo, so the
   * keyboard stays up through the pick. `before` is how much of the whole
   * text comes ahead of the box — all of it but the box in the verse view —
   * which is what the original's next section is counted against. */
  const strip = el('div', { class: 'section-strip', hidden: true });
  function updateStrip(ta, before, onPick) {
    const t = _typedSection(ta);
    const choices = t
      ? _sectionChoices(text.slice(0, before) + ta.value, before + t.start, t.typed)
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

  const view = (_view === 'verses' && !isOriginal(_song)) ? _renderVersesView : _renderWholeView;
  const body = view({
    active, canEdit,
    getText: () => text, typed, replaced,
    updateStrip, hideStrip, withoutTyped,
    setShowHistory: (fn) => { showHistory = fn; },
    setLookupTarget: (fn) => { lookupTarget = fn; }
  });

  content.appendChild(el('div', { class: 'text-tab-wrap' }, [body.el, strip, switcher]));
  body.mounted();
}

/* The whole text in one box, beside the whole original. */
function _renderWholeView(ctx) {
  const { active, canEdit } = ctx;

  // A composition is not a translation of anything, so the box must not
  // ask for one. Everything else the two share, but the words in front of
  // an empty field are the one place the difference is obvious.
  const original = isOriginal(_song);
  let placeholder = original ? 'Creează o versiune ca să începi.'
                             : 'Creează o versiune pentru a începe traducerea.';
  if (active) {
    placeholder = !canEdit ? 'Doar creatorul sau un admin poate edita această versiune.'
                : (original ? 'Versurile tale…' : 'Traducerea în română…') +
                  '\n\nScrie [ la început de rând pentru o secțiune: Strofa, Refren…';
  }

  const translation = el('textarea', {
    class: 'field__input text-tab__translation',
    placeholder,
    disabled: !active || !canEdit,
    oninput: () => { ctx.typed(translation.value); strip(); }
  });
  translation.value = ctx.getText();
  translation.addEventListener('scroll', () => { _translationScrollTop = translation.scrollTop; });
  // Redraws the formatted section marks; set once the editor is mounted.
  let repaint = () => {};

  const strip = () => ctx.updateStrip(translation, 0, (t, label) => {
    const r = _withSection(ctx.withoutTyped(translation, t), t.start, label);
    translation.value = r.text;
    ctx.replaced(r.text);
    _scrollCaretIntoView(translation, r.caret);
    translation.setSelectionRange(r.caret, r.caret);
    repaint();
    strip();
  });
  // The caret can leave the line without any typing: arrow keys, a tap.
  translation.addEventListener('keyup', strip);
  translation.addEventListener('mouseup', strip);
  translation.addEventListener('blur', ctx.hideStrip);

  ctx.setLookupTarget(() => translation);
  ctx.setShowHistory((t) => { _applyHistoryText(translation, t); repaint(); });

  // A composition has no source, so it gets one box instead of two. No
  // stylesheet change is needed for that: .text-tab__col is flex:1, so a
  // lone column fills the row at either breakpoint.
  const cols = [];
  let originalEl = null;
  if (!original) {
    originalEl = el('div', { class: 'text-tab__original' }, _renderMarkedText(_song.originalText, -1, -1));
    originalEl.addEventListener('scroll', () => { _originalScrollTop = originalEl.scrollTop; });
    cols.push(el('div', { class: 'text-tab__col' }, [originalEl]));
  }
  const mirror = el('div', { class: 'editor__mirror', 'aria-hidden': 'true' });
  cols.push(el('div', { class: 'text-tab__col' }, [
    el('div', { class: 'editor' }, [mirror, translation])
  ]));

  return {
    el: el('div', { class: 'text-tab' }, cols),
    // Restored after mounting rather than left at the browser's default (0)
    // — this runs on every render, including a plain tab-switch-back where
    // nothing about the song actually changed, which is exactly when
    // jumping back to the top would be most jarring. Reading offsetHeight
    // first forces the layout that scrollTop's setter otherwise needs and
    // may not have yet, right after building fresh DOM — without it the
    // assignment can silently no-op.
    mounted() {
      void translation.offsetHeight;
      translation.scrollTop = _translationScrollTop;
      // Only once mounted: it copies the textarea's computed layout.
      repaint = _attachMirror(translation, mirror);
      if (originalEl) {
        void originalEl.offsetHeight;
        originalEl.scrollTop = _originalScrollTop;
      }
    }
  };
}

/* Each verse of the original above its verse of the translation.
 *
 * Verses are runs of lines between blank lines, on both sides, and are
 * paired by position: the first with the first, and so on. Each verse of
 * the translation is its own box, but the text stays one string — an edit
 * goes back into it in place, so the blank lines between verses, and the
 * other view, are left exactly as they were.
 *
 * Pairing by position goes wrong from the first verse one side has and the
 * other does not — typically a chorus written out again on one side only.
 * That is shown rather than guessed at: a count of both sides when they
 * differ, and a note on any pair whose section marks disagree. */
function _renderVersesView(ctx) {
  const { canEdit } = ctx;
  const editable = !!ctx.active && canEdit;
  const originals = _verses(_song.originalText).map(v => _song.originalText.slice(v.start, v.end));
  // Live positions of the translation's verses in the text, shifted as
  // edits change their lengths. Rebuilt only on a full redraw.
  let spans = _verses(ctx.getText());
  let lastBox = null;
  const boxes = [];

  const list = el('div', { class: 'verses' });
  const wrap = el('div', { class: 'verses-wrap' }, [list]);
  wrap.addEventListener('scroll', () => { _versesScrollTop = wrap.scrollTop; });

  // Writes box i back into the text. A box past the last verse starts a
  // new one at the end, after a blank line.
  function write(i, value) {
    let text = ctx.getText();
    if (i >= spans.length) {
      text = text.replace(/\s+$/, '');
      if (text) text += '\n\n';
      spans.push({ start: text.length, end: text.length });
      // The next empty box can be written in now that this one exists.
      if (boxes[i + 1]) boxes[i + 1].disabled = !editable;
    }
    const s = spans[i];
    const delta = value.length - (s.end - s.start);
    text = text.slice(0, s.start) + value + text.slice(s.end);
    s.end += delta;
    for (let j = i + 1; j < spans.length; j++) { spans[j].start += delta; spans[j].end += delta; }
    return text;
  }

  function draw() {
    const text = ctx.getText();
    spans = _verses(text);
    boxes.length = 0;
    list.innerHTML = '';
    const mounted = [];
    const n = Math.max(originals.length, spans.length + (editable ? 1 : 0));

    if (spans.length && originals.length !== spans.length) {
      list.appendChild(el('p', { class: 'verses__note' }, [
        `Originalul are ${originals.length} ${originals.length === 1 ? 'strofă' : 'strofe'}, ` +
        `traducerea ${spans.length}. De la prima diferență, perechile pot fi decalate — ` +
        'verifică rândurile goale dintre strofe.'
      ]));
    }

    for (let i = 0; i < n; i++) {
      const orig = originals[i];
      const own = i < spans.length ? text.slice(spans[i].start, spans[i].end) : '';
      const pair = el('div', { class: 'verse' });

      // The empty box after the last verse needs no note when the original
      // has run out too: it is simply room for one more.
      if (orig != null) {
        pair.appendChild(el('div', { class: 'verse__original' }, _renderMarkedText(orig, -1, -1)));
      } else if (i < spans.length) {
        pair.appendChild(el('div', { class: 'verse__original verse__original--none' }, ['Fără pereche în original']));
      }

      const ok = orig != null && i < spans.length ? _verseKind(orig) : null;
      const tk = i < spans.length ? _verseKind(own) : null;

      // Only the first box past the end can be written in: a verse typed
      // further down would land as the next verse anyway.
      const ta = el('textarea', {
        class: 'field__input verse__box',
        rows: 1,
        placeholder: i === spans.length ? 'Strofa următoare…' : '',
        disabled: !editable || i > spans.length
      });
      ta.value = own;
      const mirror = el('div', { class: 'editor__mirror', 'aria-hidden': 'true' });
      pair.appendChild(el('div', { class: 'editor verse__editor' }, [mirror, ta]));
      if (ok && tk && ok !== tk) {
        pair.appendChild(el('p', { class: 'verses__note verses__note--pair' }, [
          `Aici originalul are ${ok}, traducerea ${tk}.`
        ]));
      }

      const strip = () => ctx.updateStrip(ta, i < spans.length ? spans[i].start : ctx.getText().length, (t, label) => {
        // Inside a verse the mark only takes its own line: the blank line
        // that _withSection adds would split the verse in two.
        const v = ctx.withoutTyped(ta, t);
        const rest = v.slice(t.start);
        const mark = '[' + label + ']';
        ta.value = v.slice(0, t.start) + mark + (rest.startsWith('\n') ? rest : '\n' + rest);
        const caret = t.start + mark.length + 1;
        ctx.replaced(write(i, ta.value));
        ta.setSelectionRange(caret, caret);
        _fitHeight(ta);
        repaint();
        strip();
      });
      let repaint = () => {};
      ta.addEventListener('input', () => {
        ctx.typed(write(i, ta.value));
        _fitHeight(ta);
        strip();
      });
      ta.addEventListener('focus', () => { lastBox = ta; });
      ta.addEventListener('keyup', strip);
      ta.addEventListener('mouseup', strip);
      ta.addEventListener('blur', ctx.hideStrip);

      boxes.push(ta);
      list.appendChild(pair);
      mounted.push(() => { _fitHeight(ta); repaint = _attachMirror(ta, mirror); });
    }
    return mounted;
  }

  ctx.setLookupTarget(() => lastBox && lastBox.isConnected ? lastBox : null);
  // Undo can change any verse, add one or remove one, so it redraws them
  // all rather than working out which box it touched.
  ctx.setShowHistory(() => {
    const keep = wrap.scrollTop;
    draw().forEach(f => f());
    wrap.scrollTop = keep;
  });

  let pending = draw();
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

async function _saveVersionText(text) {
  if (!_activeVersionId) return;
  try {
    await window.Db.updateVersion(_song.id, _activeVersionId, { text });
    // The version's text is kept current as it is typed (see the Text
    // tab), so it is not set back here to whatever this save carried.
    _lastText = text;
    _checkpointPending = false;
  } catch (err) {
    toast('Nu am putut salva textul: ' + err.message, { kind: 'error' });
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
            toast('Nu am putut șterge versiunea: ' + err.message, { kind: 'error' });
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
            _versions.push({ id, title, text: '', createdAt: now, updatedAt: now });
            _activeVersionId = id;
            _rememberVersion(_song.id, id);
            closeSheet(overlay);
            _refreshTextTab(content);
          } catch (err) {
            toast('Nu am putut crea versiunea: ' + err.message, { kind: 'error' });
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
            version.title = title;
            closeSheetThen(overlay, () => {
              _refreshTextTab(content);
              _openVersionList(content);
            });
          } catch (err) {
            toast('Nu am putut redenumi versiunea: ' + err.message, { kind: 'error' });
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
            window.Songs.noteDeleted(_song.id);
            closeSheetThen(overlay, () => { location.hash = '#/'; });
          } catch (err) {
            toast('Nu am putut șterge melodia: ' + err.message, { kind: 'error' });
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
    toast('Actualizat.');
  } catch (err) {
    toast('Nu am putut actualiza: ' + err.message, { kind: 'error' });
  }
}

function _openEditSong(root) {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  const original = isOriginal(_song);
  const titleInput = el('input', { class: 'field__input', type: 'text', value: _song.title || '' });
  const demoInput = el('input', { class: 'field__input', type: 'url', placeholder: 'https://…', autocapitalize: 'off', autocomplete: 'off', value: _song.demoUrl || '' });
  const textInput = el('textarea', { class: 'field__input field__input--textarea', rows: 8 });
  textInput.value = _song.originalText || '';

  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Editează melodia']),
    el('label', { class: 'field' }, [el('span', { class: 'field__label' }, ['Titlu']), titleInput]),
    el('label', { class: 'field' }, [el('span', { class: 'field__label' }, ['Link demo']), demoInput]),
    original ? null : el('label', { class: 'field' }, [el('span', { class: 'field__label' }, ['Text original']), textInput]),
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
          const textChanged = !original && textInput.value !== (_song.originalText || '');
          if (textChanged) patch.originalText = textInput.value;
          if (!Object.keys(patch).length) { closeSheet(overlay); return; }

          try {
            await window.Db.updateSong(_song.id, patch);
            Object.assign(_song, patch);
            window.Songs.noteUpdated(_song.id, patch);
            closeSheetThen(overlay, () => {
              _renderShell(root);
              // Only a changed source text is worth re-offering a
              // translation for; a new title or link isn't.
              if (textChanged && _song.originalText.trim()) _offerMotAMot(root);
            });
          } catch (err) {
            toast('Nu am putut salva melodia: ' + err.message, { kind: 'error' });
          }
        }
      }, ['Salvează'])
    ])
  ].filter(Boolean)));
  openSheet(overlay);
}

function _offerMotAMot(root) {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  const generateBtn = el('button', { class: 'btn btn--primary' }, ['Da, generează']);
  generateBtn.addEventListener('click', async () => {
    generateBtn.disabled = true;
    generateBtn.textContent = 'Se generează…';
    await _generateMotAMot(root);
    closeSheet(overlay);
  });

  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Traducere Mot-a-mot?']),
    el('p', { class: 'sheet__text' }, ['Textul original s-a schimbat. Vrei să (re)generezi versiunea „Mot-a-mot” cu Google Translate?']),
    el('div', { class: 'sheet__actions' }, [
      el('button', { class: 'btn', onclick: () => closeSheet(overlay) }, ['Nu, mulțumesc']),
      generateBtn
    ])
  ]));
  openSheet(overlay);
}

// Calls Google Translate and creates/updates the "Mot-a-mot" version, from
// the offer sheets above and from the kebab menu's manual button.
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
    toast('Nu am putut genera traducerea: ' + err.message, { kind: 'error' });
  }
}

// Drops the open song so the next account never sees it (see Songs.reset).
function reset() {
  _song = null;
  _versions = [];
  _activeVersionId = null;
  _undoStateVersionId = undefined;
  _undoStack = [];
  _redoStack = [];
  _lastText = '';
  _checkpointPending = false;
  _originalScrollTop = 0;
  _translationScrollTop = 0;
  _versesScrollTop = 0;
}

window.SongDetail = { render, reset };

})();
