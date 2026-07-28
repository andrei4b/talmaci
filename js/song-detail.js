/* song-detail.js — a single song's page: header + 4 tabs
 * (Text, Rime, Sinonime, Biblie).
 *
 * Only the "Text" tab has real functionality (view original, edit
 * translation) — the other three are placeholders until their behavior is
 * specified. Each tab renderer lives in its own function so new
 * functionality can be dropped in without touching the tab-switching
 * scaffolding. */
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

async function render(root, songId) {
  _activeTab = 'text';
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'topbar' }, [
    el('a', { href: '#/', class: 'btn btn--icon', 'aria-label': 'Înapoi' }, ['←']),
    el('h1', { class: 'topbar__title' }, ['Se încarcă…'])
  ]));

  try {
    _song = await window.Db.getSong(songId);
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

function _renderTextTab(content) {
  const translation = el('textarea', {
    class: 'field__input text-tab__translation',
    placeholder: 'Traducerea în română…',
    oninput: debounce(_saveTranslation, 600)
  });
  translation.value = _song.translatedText || '';

  content.appendChild(el('div', { class: 'text-tab' }, [
    el('div', { class: 'text-tab__col' }, [
      el('div', { class: 'text-tab__original' }, [escapeHtml(_song.originalText || '')])
    ]),
    el('div', { class: 'text-tab__col' }, [
      translation
    ])
  ]));
}

async function _saveTranslation(e) {
  try {
    await window.Db.updateSong(_song.id, { translatedText: e.target.value });
    _song.translatedText = e.target.value;
  } catch (err) {
    toast('Nu am putut salva traducerea: ' + err.message, { kind: 'error' });
  }
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
