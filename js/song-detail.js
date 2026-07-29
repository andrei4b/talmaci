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
const { el, toast, debounce } = window.Utils;

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

async function render(root, songId) {
  _activeTab = 'text';
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'topbar' }, [
    el('a', { href: '#/', class: 'btn btn--icon', 'aria-label': 'Înapoi' }, ['←']),
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

    _activeVersionId = _versions.length ? _versions[_versions.length - 1].id : null;
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
    el('a', { href: '#/', class: 'btn btn--icon', 'aria-label': 'Înapoi' }, ['←']),
    el('h1', { class: 'topbar__title' }, [_song.title || 'Fără titlu']),
    el('button', {
      class: 'btn btn--icon',
      'aria-label': 'Meniu melodie',
      onclick: () => _openSongMenu(root)
    }, ['⋮'])
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
  return content.appendChild(_placeholderPanel(_activeTab));
}

function _activeVersion() {
  return _versions.find(v => v.id === _activeVersionId) || null;
}

function _renderTextTab(content) {
  const active = _activeVersion();

  const switcher = el('div', { class: 'version-switcher' }, [
    el('button', {
      class: 'version-switcher__current',
      disabled: !_versions.length,
      onclick: () => _openVersionList(content)
    }, [active ? (active.title || 'Fără titlu') : 'Nicio versiune']),
  ]);

  const translation = el('textarea', {
    class: 'field__input text-tab__translation',
    placeholder: active ? 'Traducerea în română…' : 'Creează o versiune pentru a începe traducerea.',
    disabled: !active,
    oninput: debounce((e) => _saveVersionText(e.target.value), 600)
  });
  translation.value = active ? (active.text || '') : '';

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
  content.innerHTML = '';
  _renderTextTab(content);
}

async function _saveVersionText(text) {
  if (!_activeVersionId) return;
  try {
    await window.Db.updateVersion(_song.id, _activeVersionId, { text });
    const v = _activeVersion();
    if (v) v.text = text;
  } catch (err) {
    toast('Nu am putut salva traducerea: ' + err.message, { kind: 'error' });
  }
}

function _openVersionList(content) {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });

  const rows = _versions.map(v => el('div', { class: 'version-row' }, [
    el('button', {
      class: 'version-row__title' + (v.id === _activeVersionId ? ' version-row__title--active' : ''),
      onclick: () => { _activeVersionId = v.id; overlay.remove(); _refreshTextTab(content); }
    }, [v.title || 'Fără titlu']),
    el('button', {
      class: 'version-row__icon',
      'aria-label': 'Redenumește versiunea',
      html: ROW_ICONS.edit,
      onclick: () => { overlay.remove(); _openRenameVersion(content, v); }
    }),
    el('button', {
      class: 'version-row__icon version-row__icon--danger',
      'aria-label': 'Șterge versiunea',
      disabled: _versions.length < 2,
      html: ROW_ICONS.delete,
      onclick: () => {
        if (_versions.length < 2) return;
        overlay.remove();
        _confirmDeleteVersion(content, v);
      }
    })
  ]));

  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Versiuni']),
    el('div', { class: 'version-list' }, rows),
    el('button', {
      class: 'btn btn--wide',
      onclick: () => { overlay.remove(); _openAddVersion(content); }
    }, ['+ Adaugă versiune'])
  ]));
  document.body.appendChild(overlay);
}

function _confirmDeleteVersion(content, version) {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) { overlay.remove(); _openVersionList(content); } } });

  const sheet = el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Ștergi versiunea?']),
    el('p', { class: 'sheet__text' }, [
      `Sigur vrei să ștergi versiunea „${version.title || 'Fără titlu'}”? Traducerea ei se pierde definitiv.`
    ]),
    el('div', { class: 'sheet__actions' }, [
      el('button', { class: 'btn', onclick: () => { overlay.remove(); _openVersionList(content); } }, ['Anulează']),
      el('button', {
        class: 'btn btn--danger-solid',
        onclick: async () => {
          try {
            await window.Db.deleteVersion(_song.id, version.id);
            _versions = _versions.filter(v => v.id !== version.id);
            if (_activeVersionId === version.id) {
              _activeVersionId = _versions.length ? _versions[_versions.length - 1].id : null;
            }
            overlay.remove();
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
  document.body.appendChild(overlay);
}

function _openAddVersion(content) {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
  const defaultTitle = `Versiunea ${_versions.length + 1}`;
  const titleInput = el('input', { class: 'field__input', type: 'text', value: defaultTitle });

  const sheet = el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Versiune nouă']),
    el('label', { class: 'field' }, [el('span', { class: 'field__label' }, ['Titlu']), titleInput]),
    el('div', { class: 'sheet__actions' }, [
      el('button', { class: 'btn', onclick: () => overlay.remove() }, ['Anulează']),
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
            overlay.remove();
            _refreshTextTab(content);
          } catch (err) {
            toast('Nu am putut crea versiunea: ' + err.message, { kind: 'error' });
          }
        }
      }, ['Creează'])
    ])
  ]);
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  titleInput.focus();
  titleInput.select();
}

function _openRenameVersion(content, version) {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
  const titleInput = el('input', { class: 'field__input', type: 'text', value: version.title || '' });

  const sheet = el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Redenumește versiunea']),
    el('label', { class: 'field' }, [el('span', { class: 'field__label' }, ['Titlu']), titleInput]),
    el('div', { class: 'sheet__actions' }, [
      el('button', { class: 'btn', onclick: () => { overlay.remove(); _openVersionList(content); } }, ['Anulează']),
      el('button', {
        class: 'btn btn--primary',
        onclick: async () => {
          const title = titleInput.value.trim() || version.title;
          try {
            await window.Db.updateVersion(_song.id, version.id, { title });
            version.title = title;
            overlay.remove();
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
  document.body.appendChild(overlay);
  titleInput.focus();
  titleInput.select();
}

function _openSongMenu(root) {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('button', {
      class: 'btn btn--wide',
      onclick: () => { overlay.remove(); _refreshSong(root); }
    }, ['Reîmprospătează']),
    el('button', {
      class: 'btn btn--wide',
      onclick: () => { overlay.remove(); _openEditOriginal(root); }
    }, ['Editează textul original'])
  ]));
  document.body.appendChild(overlay);
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
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
  const textInput = el('textarea', { class: 'field__input field__input--textarea', rows: 10 });
  textInput.value = _song.originalText || '';

  const sheet = el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Editează textul original']),
    el('label', { class: 'field' }, [textInput]),
    el('div', { class: 'sheet__actions' }, [
      el('button', { class: 'btn', onclick: () => overlay.remove() }, ['Anulează']),
      el('button', {
        class: 'btn btn--primary',
        onclick: async () => {
          try {
            await window.Db.updateSong(_song.id, { originalText: textInput.value });
            _song.originalText = textInput.value;
            overlay.remove();
            _renderShell(root);
          } catch (err) {
            toast('Nu am putut salva textul original: ' + err.message, { kind: 'error' });
          }
        }
      }, ['Salvează'])
    ])
  ]);
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  textInput.focus();
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
