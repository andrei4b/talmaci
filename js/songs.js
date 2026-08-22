/* songs.js — main page: the song list (search, add, navigate to detail). */
(function () {
const { $, el, toast, debounce, openSheet, closeSheet, closeSheetThen, icons, isOriginal } = window.Utils;

let _songs = [];
let _query = '';
// '' = everything, otherwise 'translation' or 'original'. Module state like
// _query, deliberately not localStorage: a filter that quietly persists
// across sessions is a good way to wonder where half your songs went.
let _kindFilter = '';
let _listWrap = null;

async function render(root) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'topbar' }, [
    el('h1', { class: 'topbar__title' }, ['Tălmaci']),
    el('button', { class: 'btn btn--icon', 'aria-label': 'Cont', html: icons.kebab, onclick: () => window.App.openAccountMenu() })
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
  root.appendChild(_renderKindFilter());
  root.appendChild(_listWrap);

  root.appendChild(el('button', {
    class: 'fab',
    'aria-label': 'Adaugă o melodie',
    onclick: () => _openAddSong()
  }, ['+']));

  await _loadSongs();
}

function _renderKindFilter() {
  const row = el('div', { class: 'kind-filter' });
  [['', 'Toate'], ['translation', 'Traduceri'], ['original', 'Compoziții']].forEach(([value, label]) => {
    row.appendChild(el('button', {
      class: 'seg' + (_kindFilter === value ? ' seg--active' : ''),
      onclick: () => {
        _kindFilter = value;
        // Redraw the row in place so the pills update, then the list.
        const fresh = _renderKindFilter();
        row.replaceWith(fresh);
        _renderList(_listWrap);
      }
    }, [label]));
  });
  return row;
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
  const filtered = _songs.filter(s => {
    if (q && !(s.title || '').toLowerCase().includes(q)) return false;
    if (_kindFilter === 'original') return isOriginal(s);
    if (_kindFilter === 'translation') return !isOriginal(s);
    return true;
  });

  if (!filtered.length) {
    let msg = 'Nu ai adăugat încă nicio melodie. Apasă „+” pentru a începe.';
    if (_songs.length) {
      msg = _kindFilter === 'original' ? 'Nicio compoziție.'
          : _kindFilter === 'translation' ? 'Nicio traducere.'
          : 'Nicio melodie găsită.';
    }
    listWrap.appendChild(el('div', { class: 'empty-state' }, [msg]));
    return;
  }

  const ul = el('ul', { class: 'song-list' });
  filtered.forEach(song => {
    ul.appendChild(el('li', { class: 'song-list__item' }, [
      el('a', {
        href: `#/song/${song.id}`,
        class: 'song-list__link'
      }, [
        el('span', { class: 'song-list__head' }, [
          el('span', { class: 'song-list__title' }, [song.title || 'Fără titlu']),
          isOriginal(song)
            ? el('span', { class: 'song-list__kind' }, ['Compoziție'])
            : null
        ].filter(Boolean)),
        el('span', { class: 'song-list__snippet' }, [(song.originalText || '').slice(0, 80)])
      ])
    ]));
  });
  listWrap.appendChild(ul);
}

function _openAddSong() {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  // Not autofocused. The first thing to decide here is the type, and
  // focusing the title raises the keyboard over the choice on a phone.
  const titleInput = el('input', { class: 'field__input', type: 'text', placeholder: 'Titlul melodiei' });
  const textInput = el('textarea', { class: 'field__input field__input--textarea', placeholder: 'Textul original (engleză)', rows: 6 });

  // A composition has no source to translate from, so the field for it is
  // hidden rather than left blank — an empty box labelled "Text original"
  // invites people to paste their own lyrics into the wrong side.
  let kind = 'translation';
  const originalField = el('label', { class: 'field' }, [
    el('span', { class: 'field__label' }, ['Text original']), textInput
  ]);
  const kindRow = el('div', { class: 'kind-filter' });
  const paintKind = () => {
    kindRow.innerHTML = '';
    [['translation', 'Traducere'], ['original', 'Compoziție']].forEach(([value, label]) => {
      kindRow.appendChild(el('button', {
        class: 'seg' + (kind === value ? ' seg--active' : ''),
        onclick: () => {
          kind = value;
          paintKind();
          originalField.hidden = (kind === 'original');
        }
      }, [label]));
    });
  };
  paintKind();

  const sheet = el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Melodie nouă']),
    el('div', { class: 'field' }, [el('span', { class: 'field__label' }, ['Tip']), kindRow]),
    el('label', { class: 'field' }, [el('span', { class: 'field__label' }, ['Titlu']), titleInput]),
    originalField,
    el('div', { class: 'sheet__actions' }, [
      el('button', { class: 'btn', onclick: () => closeSheet(overlay) }, ['Anulează']),
      el('button', {
        class: 'btn btn--primary',
        onclick: async () => {
          const title = titleInput.value.trim();
          if (!title) { toast('Introdu un titlu.', { kind: 'error' }); return; }
          const originalText = kind === 'original' ? '' : textInput.value;
          try {
            const id = await window.Db.addSong({
              title,
              kind,
              originalText,
              groupId: window.Auth.currentGroupId(),
              createdBy: window.Auth.currentUser().uid
            });
            // Nothing to translate from in a composition, so it goes
            // straight to the editor instead of being asked about Mot-a-mot.
            if (kind !== 'original' && originalText.trim()) {
              closeSheet(overlay);
              _offerMotAMot(id, originalText);
            } else {
              closeSheetThen(overlay, () => { location.hash = `#/song/${id}`; });
            }
          } catch (err) {
            toast('Nu am putut salva melodia: ' + err.message, { kind: 'error' });
          }
        }
      }, ['Salvează'])
    ])
  ]);
  overlay.appendChild(sheet);
  openSheet(overlay);
}

function _offerMotAMot(songId, originalText) {
  // Same ordering rule as above: the hash has to be set after the sheet's
  // history entry has finished unwinding, not before.
  const closeAndGo = () => closeSheetThen(overlay, () => { location.hash = `#/song/${songId}`; });
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeAndGo(); } });
  const generateBtn = el('button', { class: 'btn btn--primary' }, ['Da, generează']);
  generateBtn.addEventListener('click', async () => {
    generateBtn.disabled = true;
    generateBtn.textContent = 'Se generează…';
    try {
      await window.Translator.generateMotAMotVersion(songId, originalText, [], window.Auth.currentUser().uid, window.Auth.isAdmin());
    } catch (err) {
      toast('Nu am putut genera traducerea: ' + err.message, { kind: 'error' });
    }
    closeAndGo();
  });

  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Traducere Mot-a-mot?']),
    el('p', { class: 'sheet__text' }, ['Vrei o traducere generată automat cu Google Translate, ca punct de plecare?']),
    el('div', { class: 'sheet__actions' }, [
      el('button', { class: 'btn', onclick: closeAndGo }, ['Nu, mulțumesc']),
      generateBtn
    ])
  ]));
  openSheet(overlay);
}

window.Songs = { render, refresh };

})();
