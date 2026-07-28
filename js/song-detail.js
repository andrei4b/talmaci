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
const { el, escapeHtml, toast, debounce } = window.Utils;

const ICONS = {
  text: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6M9 9h1"/></svg>`,
  rime: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>`,
  sinonime: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v14M3 13l4 4 4-4"/><path d="M17 21V7M13 11l4-4 4 4"/></svg>`,
  biblie: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5A2.5 2.5 0 0 1 4.5 2H12v18H4.5A2.5 2.5 0 0 0 2 22z"/><path d="M22 4.5A2.5 2.5 0 0 0 19.5 2H12v18h7.5a2.5 2.5 0 0 1 2.5 2z"/></svg>`
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
    el('h1', { class: 'topbar__title' }, [escapeHtml(_song.title || 'Fără titlu')]),
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
      class: 'version-switcher__nav',
      'aria-label': 'Versiunea anterioară',
      disabled: _versions.length < 2,
      onclick: () => _cycleVersion(content, -1)
    }, ['‹']),
    el('button', {
      class: 'version-switcher__title',
      disabled: !active,
      onclick: () => active && _openVersionMenu(content, active)
    }, [active ? escapeHtml(active.title || 'Fără titlu') : 'Nicio versiune']),
    el('button', {
      class: 'version-switcher__nav',
      'aria-label': 'Versiunea următoare',
      disabled: _versions.length < 2,
      onclick: () => _cycleVersion(content, 1)
    }, ['›']),
    el('button', {
      class: 'version-switcher__add',
      'aria-label': 'Adaugă versiune',
      onclick: () => _openAddVersion(content)
    }, ['+'])
  ]);

  const translation = el('textarea', {
    class: 'field__input text-tab__translation',
    placeholder: active ? 'Traducerea în română…' : 'Creează o versiune pentru a începe traducerea.',
    disabled: !active,
    oninput: debounce((e) => _saveVersionText(e.target.value), 600)
  });
  translation.value = active ? (active.text || '') : '';

  content.appendChild(el('div', { class: 'text-tab' }, [
    el('div', { class: 'text-tab__col' }, [
      el('div', { class: 'text-tab__original' }, [escapeHtml(_song.originalText || '')])
    ]),
    el('div', { class: 'text-tab__col' }, [
      switcher,
      translation
    ])
  ]));
}

function _cycleVersion(content, dir) {
  if (_versions.length < 2) return;
  const idx = _versions.findIndex(v => v.id === _activeVersionId);
  const nextIdx = (idx + dir + _versions.length) % _versions.length;
  _activeVersionId = _versions[nextIdx].id;
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
            content.innerHTML = '';
            _renderTextTab(content);
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

function _openVersionMenu(content, version) {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
  const titleInput = el('input', { class: 'field__input', type: 'text', value: version.title || '' });
  const canDelete = _versions.length > 1;

  const actions = [
    el('button', { class: 'btn', onclick: () => overlay.remove() }, ['Anulează']),
    el('button', {
      class: 'btn btn--primary',
      onclick: async () => {
        const title = titleInput.value.trim() || version.title;
        try {
          await window.Db.updateVersion(_song.id, version.id, { title });
          version.title = title;
          overlay.remove();
          content.innerHTML = '';
          _renderTextTab(content);
        } catch (err) {
          toast('Nu am putut redenumi versiunea: ' + err.message, { kind: 'error' });
        }
      }
    }, ['Salvează'])
  ];

  const sheetChildren = [
    el('h2', { class: 'sheet__title' }, ['Redenumește versiunea']),
    el('label', { class: 'field' }, [el('span', { class: 'field__label' }, ['Titlu']), titleInput]),
    el('div', { class: 'sheet__actions' }, actions)
  ];

  if (canDelete) {
    sheetChildren.push(el('button', {
      class: 'btn btn--text btn--danger btn--wide',
      onclick: async () => {
        try {
          await window.Db.deleteVersion(_song.id, version.id);
          _versions = _versions.filter(v => v.id !== version.id);
          if (_activeVersionId === version.id) {
            _activeVersionId = _versions.length ? _versions[_versions.length - 1].id : null;
          }
          overlay.remove();
          content.innerHTML = '';
          _renderTextTab(content);
        } catch (err) {
          toast('Nu am putut șterge versiunea: ' + err.message, { kind: 'error' });
        }
      }
    }, ['Șterge versiunea']));
  }

  overlay.appendChild(el('div', { class: 'sheet' }, sheetChildren));
  document.body.appendChild(overlay);
  titleInput.focus();
  titleInput.select();
}

function _openSongMenu(root) {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('button', {
      class: 'btn btn--wide',
      onclick: () => { overlay.remove(); _openEditOriginal(root); }
    }, ['Editează textul original'])
  ]));
  document.body.appendChild(overlay);
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
