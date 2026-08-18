/* song-detail.js — a single song's page: header + 4 tabs
 * (Text, Rime, Sinonime, Biblie).
 *
 * Only the "Text" tab has real functionality (view original, edit
 * translation) — the other three are placeholders until their behavior is
 * specified. Each tab renderer lives in its own function so new
 * functionality can be dropped in without touching the tab-switching
 * scaffolding.
 *
 * The translation itself supports multiple named versions (so several
 * people can draft in parallel) via the version switcher above the
 * translation box — see db.js's versions subcollection. */
(function () {
const { el, toast, debounce, openSheet, closeSheet, icons } = window.Utils;

const ICONS = {
  text: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6M9 9h1"/></svg>`,
  rime: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>`,
  sinonime: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v14M3 13l4 4 4-4"/><path d="M17 21V7M13 11l4-4 4 4"/></svg>`,
  biblie: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5A2.5 2.5 0 0 1 4.5 2H12v18H4.5A2.5 2.5 0 0 0 2 22z"/><path d="M22 4.5A2.5 2.5 0 0 0 19.5 2H12v18h7.5a2.5 2.5 0 0 1 2.5 2z"/></svg>`
};

const ROW_ICONS = {
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  delete: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`
};

const UNDO_REDO_ICONS = {
  undo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>`,
  redo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>`
};

const TABS = [
  { id: 'text', label: 'Text' },
  { id: 'rime', label: 'Rime' },
  { id: 'sinonime', label: 'Sinonime' },
  { id: 'biblie', label: 'Biblie' }
];

let _activeTab = 'text';
let _song = null;
let _versions = [];       // [{ id, title, text, createdAt, updatedAt }]
let _activeVersionId = null;

// Rime tab state, kept across tab switches so you don't lose a search by
// glancing at the Text tab.
let _rimeQuery = '';
let _rimeSyll = 0;        // 0 = any
let _rimeReading = 0;     // which stress reading of the query word
// How many results are currently rendered. Grows via "arată mai multe" —
// productive endings like -ire match several hundred words, and rendering
// them all at once is a lot of DOM for results you rarely scroll to.
const RIME_PAGE = 120;
// Highest syllable bucket offered; it filters as "this many or more".
const RIME_SYLL_MAX = 5;
let _rimeShown = RIME_PAGE;

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

async function render(root, songId) {
  _activeTab = 'text';
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'topbar' }, [
    el('button', {
      class: 'btn btn--icon',
      'aria-label': 'Înapoi',
      html: icons.back,
      // Real history.back() instead of location.hash = '#/': every song
      // page is reached by navigating from the list, which already pushed
      // a history entry for it — going back to a *new* '#/' entry instead
      // of reusing that one is what let the stack grow unbounded (list,
      // song A, list, song B, list, ...), so the hardware back button from
      // the list kept resurfacing old songs instead of closing the app.
      onclick: () => history.back()
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
      // Real history.back() instead of location.hash = '#/': every song
      // page is reached by navigating from the list, which already pushed
      // a history entry for it — going back to a *new* '#/' entry instead
      // of reusing that one is what let the stack grow unbounded (list,
      // song A, list, song B, list, ...), so the hardware back button from
      // the list kept resurfacing old songs instead of closing the app.
      onclick: () => history.back()
    }),
    el('h1', { class: 'topbar__title' }, [_song.title || 'Fără titlu']),
    el('button', {
      class: 'btn btn--icon',
      'aria-label': 'Meniu melodie',
      html: icons.kebab,
      onclick: () => _openSongMenu(root)
    })
  ]));

  const tabBar = el('div', { class: 'tab-bar', role: 'tablist' });
  const content = el('div', { class: 'tab-content' });

  TABS.forEach(tab => {
    tabBar.appendChild(el('button', {
      class: 'tab-bar__tab' + (tab.id === _activeTab ? ' tab-bar__tab--active' : ''),
      role: 'tab',
      'aria-selected': tab.id === _activeTab ? 'true' : 'false',
      onclick: () => { _activeTab = tab.id; _renderShell(root); }
    }, [
      el('span', { html: ICONS[tab.id], 'aria-hidden': 'true' }),
      tab.label
    ]));
  });

  root.appendChild(tabBar);
  root.appendChild(content);
  _renderTab(content);
  // Replace tab-content's fixed CSS estimate with the tab-bar's real
  // measured height (+ a small breathing gap), instead of a guessed
  // buffer that was bigger than the real bar and wasted space.
  content.style.paddingBottom = (tabBar.offsetHeight + 10) + 'px';
}

function _renderTab(content) {
  content.innerHTML = '';
  if (_activeTab === 'text') return _renderTextTab(content);
  if (_activeTab === 'rime') return _renderRimeTab(content);
  return content.appendChild(_placeholderPanel(_activeTab));
}

/* ---------- Rime tab ---------- */
function _renderRimeTab(content) {
  const wrap = el('div', { class: 'rime' });
  content.appendChild(wrap);

  const input = el('input', {
    class: 'field__input rime__input',
    type: 'text',
    placeholder: 'Scrie un cuvânt…',
    value: _rimeQuery,
    oninput: debounce((e) => {
      _rimeQuery = e.target.value;
      _rimeShown = RIME_PAGE;   // new search starts from the top again
      _rimeReading = 0;         // and from the word's leading reading
      _runRimeSearch(wrap);
    }, 250)
  });
  wrap.appendChild(el('div', { class: 'rime__search' }, [input]));

  // Only perfect rhymes are offered, so there is no mode to choose.
  const sylRow = el('div', { class: 'rime__filters rime__filters--syll' }, [
    el('span', { class: 'rime__filters-label' }, ['Silabe']),
    _segButton('Toate', _rimeSyll === 0, () => { _rimeSyll = 0; _rimeShown = RIME_PAGE; _renderRimeTabKeepFocus(content); })
  ]);
  // The last bucket is open-ended: long rhymes are rare enough that giving
  // 6, 7 and 8 their own buttons would mostly show empty result lists.
  [1, 2, 3, 4, RIME_SYLL_MAX].forEach(n => {
    const label = n === RIME_SYLL_MAX ? n + '+' : String(n);
    sylRow.appendChild(_segButton(label, _rimeSyll === n, () => { _rimeSyll = n; _rimeShown = RIME_PAGE; _renderRimeTabKeepFocus(content); }));
  });
  wrap.appendChild(sylRow);

  // Filled in by the search, once the word is known to have more than one
  // reading. It lives here rather than inside .rime__body so it stays put
  // with the other filters instead of scrolling away with the results.
  wrap.appendChild(el('div', { class: 'rime__readings' }));

  wrap.appendChild(el('div', { class: 'rime__body' }));
  _runRimeSearch(wrap);
  return wrap;
}

function _renderRimeTabKeepFocus(content) {
  content.innerHTML = '';
  _renderRimeTab(content);
}

function _segButton(label, active, onclick) {
  return el('button', {
    class: 'rime__seg' + (active ? ' rime__seg--active' : ''),
    onclick: onclick
  }, [label]);
}

async function _runRimeSearch(wrap) {
  const body = wrap.querySelector('.rime__body');
  if (!body) return;
  const readingsRow = wrap.querySelector('.rime__readings');
  if (readingsRow) readingsRow.innerHTML = '';
  const q = (_rimeQuery || '').trim();

  if (!q) {
    body.innerHTML = '';
    body.appendChild(el('div', { class: 'empty-state' }, [
      el('p', {}, ['Scrie un cuvânt ca să vezi cu ce rimează.'])
    ]));
    return;
  }

  // The index is several megabytes, so it loads on demand the first time
  // you actually search — never at app boot.
  if (window.Rhyme.state() !== 'ready') {
    body.innerHTML = '';
    const pct = el('div', { class: 'empty-state__hint' }, ['0%']);
    body.appendChild(el('div', { class: 'loading-state' }, [
      el('div', { class: 'spinner' }),
      'Se încarcă dicționarul de rime…',
      pct
    ]));
    try {
      await window.Rhyme.load((p) => { pct.textContent = Math.round(p * 100) + '%'; });
    } catch (err) {
      body.innerHTML = '';
      body.appendChild(el('div', { class: 'empty-state' }, [
        'Nu am putut încărca dicționarul: ' + window.Rhyme.errorMessage()
      ]));
      return;
    }
    if ((_rimeQuery || '').trim() !== q) return;   // query changed while loading
  }

  const res = window.Rhyme.lookup(q, {
    syllables: _rimeSyll,
    syllablesOrMore: _rimeSyll === RIME_SYLL_MAX,
    reading: _rimeReading
  });
  body.innerHTML = '';

  if (!res.ok || !res.analysis) {
    body.appendChild(el('div', { class: 'empty-state' }, ['Nu am putut analiza cuvântul.']));
    return;
  }

  const a = res.analysis;
  const total = res.total || 0;

  // Show the actual division with the stressed syllable highlighted
  // ("cru-ce", "mân-tu-i-re") — more legible at a glance than describing it
  // as "2 silabe · accent pe silaba 1".
  const parts = a.syllableParts && a.syllableParts.length ? a.syllableParts : [a.word];
  const line = el('div', { class: 'rime__analysis' });
  parts.forEach((p, i) => {
    if (i) line.appendChild(el('span', { class: 'rime__syl-sep' }, ['-']));
    line.appendChild(el('span', {
      class: 'rime__syl' + (i === a.stressIndex ? ' rime__syl--stressed' : '')
    }, [p]));
  });
  line.appendChild(el('span', { class: 'rime__meta' }, [
    (a.attested ? '' : ' · accent estimat') +
    (total ? ' · ' + total + (total === 1 ? ' rezultat' : ' rezultate') : '')
  ]));
  body.appendChild(line);

  // A spelling can be two words told apart only by stress — "c'asa" the
  // house against "cas'a" the verb — and they rhyme differently. Offer each
  // reading rather than silently picking one.
  const readings = window.Rhyme.readingLabels(q);
  if (readingsRow && readings.length > 1) {
    const row = el('div', { class: 'rime__filters rime__filters--readings' }, [
      el('span', { class: 'rime__filters-label' }, ['Accent'])
    ]);
    readings.forEach((r) => {
      // r.reading is the reading's real index; the picker may have collapsed
      // ones that read the same, so a button's position is not its index.
      const i = r.reading;
      const label = el('span', {});
      r.parts.forEach((p, k) => {
        if (k) label.appendChild(el('span', { class: 'rime__syl-sep' }, ['-']));
        label.appendChild(el('span', {
          class: k === r.stressIndex ? 'rime__syl--stressed' : ''
        }, [p]));
      });
      const btn = el('button', {
        class: 'rime__seg' + (i === _rimeReading ? ' rime__seg--active' : ''),
        onclick: () => {
          _rimeReading = i;
          _rimeShown = RIME_PAGE;
          // Rebuilds the results and this row itself. The search field is
          // a sibling of both, so it keeps its text and its focus.
          _runRimeSearch(wrap);
        }
      }, [label]);
      row.appendChild(btn);
    });
    readingsRow.appendChild(row);
  }

  if (!res.results.length) {
    body.appendChild(el('div', { class: 'empty-state' }, [
      el('p', {}, ['Niciun rezultat.']),
      el('p', { class: 'empty-state__hint' }, [
        _rimeSyll ? 'Încearcă fără filtrul de silabe.' : 'Încearcă alt cuvânt.'
      ])
    ]));
    return;
  }

  const shown = res.results.slice(0, _rimeShown);
  const list = el('div', { class: 'rime__results' });
  shown.forEach(r => {
    list.appendChild(el('button', {
      class: 'rime__word',
      title: r.syllables + ' silabe',
      onclick: async () => {
        const ok = await window.Utils.copyToClipboard(r.word);
        toast(ok ? '„' + r.word + '” copiat.' : 'Nu am putut copia.', ok ? {} : { kind: 'error' });
      }
    }, [r.word]));
  });
  body.appendChild(list);

  const remaining = res.total - shown.length;
  if (remaining > 0) {
    body.appendChild(el('button', {
      class: 'btn btn--wide',
      onclick: () => { _rimeShown += RIME_PAGE; _runRimeSearch(wrap); }
    }, ['Arată mai multe (' + remaining + ')']));
  }
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

  const switcher = el('div', { class: 'version-switcher' }, [
    el('button', {
      class: 'version-switcher__current',
      disabled: !_versions.length,
      onclick: () => _openVersionList(content)
    }, [active ? (active.title || 'Fără titlu') : 'Nicio versiune']),
    undoBtn,
    redoBtn
  ]);

  let placeholder = 'Creează o versiune pentru a începe traducerea.';
  if (active) placeholder = canEdit ? 'Traducerea în română…' : 'Doar creatorul sau un admin poate edita această versiune.';

  const debouncedSave = debounce((text) => _saveVersionText(text), 600);
  const translation = el('textarea', {
    class: 'field__input text-tab__translation',
    placeholder,
    disabled: !active || !canEdit,
    oninput: (e) => {
      // One undo checkpoint per pause in typing (matches the save debounce
      // below), not one per keystroke — otherwise undo would only ever
      // step back a single character at a time.
      if (!_checkpointPending) {
        _undoStack.push(_lastText);
        _redoStack = [];
        _checkpointPending = true;
        undoBtn.disabled = !canEdit || !_undoStack.length;
        redoBtn.disabled = true;
      }
      debouncedSave(e.target.value);
    }
  });
  translation.value = active ? (active.text || '') : '';

  undoBtn.onclick = () => {
    if (!_undoStack.length) return;
    _redoStack.push(translation.value);
    const prev = _undoStack.pop();
    translation.value = prev;
    _lastText = prev;
    _checkpointPending = false;
    _saveVersionText(prev);
    undoBtn.disabled = !_undoStack.length;
    redoBtn.disabled = !_redoStack.length;
  };
  redoBtn.onclick = () => {
    if (!_redoStack.length) return;
    _undoStack.push(translation.value);
    const next = _redoStack.pop();
    translation.value = next;
    _lastText = next;
    _checkpointPending = false;
    _saveVersionText(next);
    undoBtn.disabled = !_undoStack.length;
    redoBtn.disabled = !_redoStack.length;
  };

  const textTab = el('div', { class: 'text-tab' }, [
    el('div', { class: 'text-tab__col' }, [
      el('div', { class: 'text-tab__original' }, [_song.originalText || ''])
    ]),
    el('div', { class: 'text-tab__col' }, [
      translation
    ])
  ]);

  content.appendChild(el('div', { class: 'text-tab-wrap' }, [
    textTab,
    switcher
  ]));
}

function _refreshTextTab(content) {
  // The original text doesn't change when switching versions — carry its
  // scroll position across the rebuild instead of resetting to the top.
  const prevOriginal = content.querySelector('.text-tab__original');
  const originalScrollTop = prevOriginal ? prevOriginal.scrollTop : 0;
  content.innerHTML = '';
  _renderTextTab(content);
  const newOriginal = content.querySelector('.text-tab__original');
  if (newOriginal) {
    // Setting scrollTop right after building fresh DOM can silently no-op
    // if the browser hasn't computed the box's scrollable height yet —
    // reading a layout property first forces that computation to happen
    // before we set it, without waiting an extra frame (which would show
    // a visible flash back to the top first).
    void newOriginal.offsetHeight;
    newOriginal.scrollTop = originalScrollTop;
  }
}

async function _saveVersionText(text) {
  if (!_activeVersionId) return;
  try {
    await window.Db.updateVersion(_song.id, _activeVersionId, { text });
    const v = _activeVersion();
    if (v) v.text = text;
    _lastText = text;
    _checkpointPending = false;
  } catch (err) {
    toast('Nu am putut salva traducerea: ' + err.message, { kind: 'error' });
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
        onclick: () => { closeSheet(overlay); _openRenameVersion(content, v); }
      }),
      el('button', {
        class: 'version-row__icon version-row__icon--danger',
        'aria-label': 'Șterge versiunea',
        disabled: !editable || _versions.length < 2,
        html: ROW_ICONS.delete,
        onclick: () => {
          if (!editable || _versions.length < 2) return;
          closeSheet(overlay);
          _confirmDeleteVersion(content, v);
        }
      })
    ]);
  });

  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Versiuni']),
    el('div', { class: 'version-list' }, rows),
    el('button', {
      class: 'btn btn--wide',
      onclick: () => { closeSheet(overlay); _openAddVersion(content); }
    }, ['+ Adaugă versiune'])
  ]));
  openSheet(overlay);
}

function _confirmDeleteVersion(content, version) {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) { closeSheet(overlay); _openVersionList(content); } } });

  const sheet = el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Ștergi versiunea?']),
    el('p', { class: 'sheet__text' }, [
      `Sigur vrei să ștergi versiunea „${version.title || 'Fără titlu'}”? Traducerea ei se pierde definitiv.`
    ]),
    el('div', { class: 'sheet__actions' }, [
      el('button', { class: 'btn', onclick: () => { closeSheet(overlay); _openVersionList(content); } }, ['Anulează']),
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
            closeSheet(overlay);
            _refreshTextTab(content);
            _openVersionList(content);
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
      el('button', { class: 'btn', onclick: () => { closeSheet(overlay); _openVersionList(content); } }, ['Anulează']),
      el('button', {
        class: 'btn btn--primary',
        onclick: async () => {
          const title = titleInput.value.trim() || version.title;
          try {
            await window.Db.updateVersion(_song.id, version.id, { title });
            version.title = title;
            closeSheet(overlay);
            _refreshTextTab(content);
            _openVersionList(content);
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

  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('button', {
      class: 'btn btn--wide',
      onclick: () => { closeSheet(overlay); _refreshSong(root); }
    }, ['Reîmprospătează']),
    el('button', {
      class: 'btn btn--wide',
      disabled: !canEdit,
      onclick: () => { if (!canEdit) return; closeSheet(overlay); _openRenameSong(root); }
    }, ['Redenumește melodia']),
    el('button', {
      class: 'btn btn--wide',
      disabled: !canEdit,
      onclick: () => { if (!canEdit) return; closeSheet(overlay); _openEditOriginal(root); }
    }, ['Editează textul original']),
    el('button', {
      class: 'btn btn--wide',
      onclick: async () => {
        closeSheet(overlay);
        if (!_song.originalText || !_song.originalText.trim()) {
          toast('Adaugă mai întâi textul original.', { kind: 'error' });
          return;
        }
        toast('Se generează traducerea…');
        await _generateMotAMot(root);
      }
    }, ['Generează traducere Mot-a-mot']),
    el('button', {
      class: 'btn btn--wide btn--danger',
      disabled: !canEdit,
      onclick: () => { if (!canEdit) return; closeSheet(overlay); _confirmDeleteSong(); }
    }, ['Șterge melodia'])
  ]));
  openSheet(overlay);
}

function _openRenameSong(root) {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  const titleInput = el('input', { class: 'field__input', type: 'text', value: _song.title || '' });

  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Redenumește melodia']),
    el('label', { class: 'field' }, [el('span', { class: 'field__label' }, ['Titlu']), titleInput]),
    el('div', { class: 'sheet__actions' }, [
      el('button', { class: 'btn', onclick: () => closeSheet(overlay) }, ['Anulează']),
      el('button', {
        class: 'btn btn--primary',
        onclick: async () => {
          const title = titleInput.value.trim();
          if (!title) { toast('Introdu un titlu.', { kind: 'error' }); return; }
          try {
            await window.Db.updateSong(_song.id, { title });
            _song.title = title;
            closeSheet(overlay);
            _renderShell(root);
          } catch (err) {
            toast('Nu am putut redenumi melodia: ' + err.message, { kind: 'error' });
          }
        }
      }, ['Salvează'])
    ])
  ]));
  openSheet(overlay);
  titleInput.focus();
  titleInput.select();
}

function _confirmDeleteSong() {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Ștergi melodia?']),
    el('p', { class: 'sheet__text' }, [
      `Sigur vrei să ștergi „${_song.title || 'Fără titlu'}”? Textul original și toate versiunile de traducere se pierd definitiv.`
    ]),
    el('div', { class: 'sheet__actions' }, [
      el('button', { class: 'btn', onclick: () => closeSheet(overlay) }, ['Anulează']),
      el('button', {
        class: 'btn btn--danger-solid',
        onclick: async () => {
          try {
            await window.Db.deleteSong(_song.id);
            closeSheet(overlay);
            location.hash = '#/';
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

function _openEditOriginal(root) {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  const textInput = el('textarea', { class: 'field__input field__input--textarea', rows: 10 });
  textInput.value = _song.originalText || '';

  const sheet = el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Editează textul original']),
    el('label', { class: 'field' }, [textInput]),
    el('div', { class: 'sheet__actions' }, [
      el('button', { class: 'btn', onclick: () => closeSheet(overlay) }, ['Anulează']),
      el('button', {
        class: 'btn btn--primary',
        onclick: async () => {
          try {
            await window.Db.updateSong(_song.id, { originalText: textInput.value });
            _song.originalText = textInput.value;
            closeSheet(overlay);
            _renderShell(root);
            if (_song.originalText.trim()) _offerMotAMot(root);
          } catch (err) {
            toast('Nu am putut salva textul original: ' + err.message, { kind: 'error' });
          }
        }
      }, ['Salvează'])
    ])
  ]);
  overlay.appendChild(sheet);
  openSheet(overlay);
  textInput.focus();
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

function _placeholderPanel(tabId) {
  const copy = {
    rime: 'Aici vei putea căuta rime pentru cuvintele din traducere.',
    sinonime: 'Aici vei putea căuta sinonime pentru cuvintele din traducere.',
    biblie: 'Aici vei putea vedea referințe biblice legate de text.'
  }[tabId] || '';
  return el('div', { class: 'empty-state' }, [
    el('p', {}, [copy]),
    el('p', { class: 'empty-state__hint' }, ['În curând.'])
  ]);
}

window.SongDetail = { render };

})();
