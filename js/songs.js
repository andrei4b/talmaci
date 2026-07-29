/* songs.js — main page: the song list (search, add, navigate to detail). */
(function () {
const { $, el, toast, debounce } = window.Utils;

let _songs = [];
let _query = '';
let _listWrap = null;

async function render(root) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'topbar' }, [
    el('h1', { class: 'topbar__title' }, ['Tălmaci']),
    el('button', { class: 'btn btn--icon', 'aria-label': 'Cont', onclick: () => window.App.openAccountMenu() }, ['⋮'])
  ]));

  _listWrap = el('div', { class: 'song-list-wrap' });
  root.appendChild(el('div', { class: 'search-bar' }, [
    el('input', {
      type: 'search',
      placeholder: 'Caută o melodie…',
      class: 'search-bar__input',
      value: _query,
      oninput: debounce((e) => { _query = e.target.value; _renderList(_listWrap); }, 150)
    })
  ]));
  root.appendChild(_listWrap);

  root.appendChild(el('button', {
    class: 'fab',
    'aria-label': 'Adaugă o melodie',
    onclick: () => _openAddSong()
  }, ['+']));

  await _loadSongs();
}

async function _loadSongs() {
  if (!_listWrap) return;
  _listWrap.innerHTML = '';
  _listWrap.appendChild(el('div', { class: 'loading-state' }, [
    el('div', { class: 'spinner' }),
    'Se încarcă…'
  ]));
  try {
    _songs = await window.Db.listSongs(window.Auth.currentGroupId());
  } catch (err) {
    toast('Nu am putut încărca melodiile: ' + err.message, { kind: 'error' });
    _songs = [];
  }
  _renderList(_listWrap);
}

// Re-fetches from Firestore — there are no live listeners, so this is how
// you pick up a song someone else in the group just added or edited.
async function refresh() {
  await _loadSongs();
  toast('Actualizat.');
}

function _renderList(listWrap) {
  listWrap.innerHTML = '';
  const q = _query.trim().toLowerCase();
  const filtered = q
    ? _songs.filter(s => (s.title || '').toLowerCase().includes(q))
    : _songs;

  if (!filtered.length) {
    listWrap.appendChild(el('div', { class: 'empty-state' }, [
      _songs.length ? 'Nicio melodie găsită.' : 'Nu ai adăugat încă nicio melodie. Apasă „+” pentru a începe.'
    ]));
    return;
  }

  const ul = el('ul', { class: 'song-list' });
  filtered.forEach(song => {
    ul.appendChild(el('li', { class: 'song-list__item' }, [
      el('a', {
        href: `#/song/${song.id}`,
        class: 'song-list__link'
      }, [
        el('span', { class: 'song-list__title' }, [song.title || 'Fără titlu']),
        el('span', { class: 'song-list__snippet' }, [(song.originalText || '').slice(0, 80)])
      ])
    ]));
  });
  listWrap.appendChild(ul);
}

function _openAddSong() {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
  const titleInput = el('input', { class: 'field__input', type: 'text', placeholder: 'Titlul melodiei', autofocus: true });
  const textInput = el('textarea', { class: 'field__input field__input--textarea', placeholder: 'Textul original (engleză)', rows: 6 });

  const sheet = el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Melodie nouă']),
    el('label', { class: 'field' }, [el('span', { class: 'field__label' }, ['Titlu']), titleInput]),
    el('label', { class: 'field' }, [el('span', { class: 'field__label' }, ['Text original']), textInput]),
    el('div', { class: 'sheet__actions' }, [
      el('button', { class: 'btn', onclick: () => overlay.remove() }, ['Anulează']),
      el('button', {
        class: 'btn btn--primary',
        onclick: async () => {
          const title = titleInput.value.trim();
          if (!title) { toast('Introdu un titlu.', { kind: 'error' }); return; }
          try {
            const id = await window.Db.addSong({
              title,
              originalText: textInput.value,
              groupId: window.Auth.currentGroupId(),
              createdBy: window.Auth.currentUser().uid
            });
            overlay.remove();
            location.hash = `#/song/${id}`;
          } catch (err) {
            toast('Nu am putut salva melodia: ' + err.message, { kind: 'error' });
          }
        }
      }, ['Salvează'])
    ])
  ]);
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  titleInput.focus();
}

window.Songs = { render, refresh };

})();
