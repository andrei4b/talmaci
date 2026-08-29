/* songs.js — main page: the song list (search, add, navigate to detail). */
(function () {
const { $, el, toast, debounce, openSheet, closeSheet, closeSheetThen, icons, isOriginal, isShared } = window.Utils;

const CHEVRON_DOWN_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;

let _songs = [];
let _query = '';
// '' = everything, otherwise 'translation' or 'original'. Module state like
// _query, deliberately not localStorage: a filter that quietly persists
// across sessions is a good way to wonder where half your songs went.
let _kindFilter = '';
// Which list is showing: the group's shared songs, or this user's own
// personal ones. Same module-state reasoning as _kindFilter above.
let _scope = 'group';
// Fetched once per session and cached — every visit after the first shows
// the real name immediately instead of a placeholder.
let _groupName = '';
let _scopeBtnEl = null;
let _listWrap = null;

async function render(root) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'topbar' }, [
    el('h1', { class: 'topbar__title' }, ['Tălmaci']),
    _renderScopeButton(),
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

  // Fire-and-forget: doesn't hold up the tab's first paint the way
  // awaiting it here would, and it only ever needs to run once.
  if (!_groupName) _loadGroupName();
  await _loadSongs();
}

function _renderScopeButton() {
  _scopeBtnEl = el('button', { class: 'scope-btn', onclick: _openScopeSheet }, [
    el('span', { class: 'scope-btn__label' }, [_scope === 'personal' ? 'Personal' : (_groupName || 'Grup')]),
    el('span', { html: CHEVRON_DOWN_ICON, 'aria-hidden': 'true' })
  ]);
  return _scopeBtnEl;
}

async function _loadGroupName() {
  try {
    const group = await window.Db.getGroup(window.Auth.currentGroupId());
    _groupName = (group && group.name) || 'Grup';
  } catch (_) {
    _groupName = 'Grup';
  }
  // Only worth repainting if the button is still showing the group option
  // (and still mounted at all — a tab switch in the meantime leaves
  // _scopeBtnEl pointing at a detached node, and replaceWith on that is
  // harmless but pointless).
  if (_scope === 'group' && _scopeBtnEl) _scopeBtnEl.replaceWith(_renderScopeButton());
}

function _openScopeSheet() {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  const pick = (value) => {
    closeSheet(overlay);
    if (_scope === value) return;
    _scope = value;
    _scopeBtnEl.replaceWith(_renderScopeButton());
    _renderList(_listWrap);
  };
  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Alege lista']),
    el('button', { class: 'btn btn--wide' + (_scope === 'group' ? ' btn--primary' : ''), onclick: () => pick('group') }, [_groupName || 'Grup']),
    el('button', { class: 'btn btn--wide' + (_scope === 'personal' ? ' btn--primary' : ''), onclick: () => pick('personal') }, ['Personal'])
  ]));
  openSheet(overlay);
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
    _songs = await window.Db.listSongs(window.Auth.currentGroupId(), window.Auth.currentUser().uid);
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
  const myUid = window.Auth.currentUser().uid;
  // Firestore's own rules already keep another member's personal songs out
  // of what _loadSongs fetches at all — the createdBy check here is just
  // this list being explicit about what "personal" means, not a second
  // enforcement layer.
  const scoped = _songs.filter(s => _scope === 'personal'
    ? (!isShared(s) && s.createdBy === myUid)
    : isShared(s));

  const q = _query.trim().toLowerCase();
  const filtered = scoped.filter(s => {
    if (q && !(s.title || '').toLowerCase().includes(q)) return false;
    if (_kindFilter === 'original') return isOriginal(s);
    if (_kindFilter === 'translation') return !isOriginal(s);
    return true;
  });

  if (!filtered.length) {
    let msg;
    if (!scoped.length) {
      msg = _scope === 'personal'
        ? 'Nu ai nicio melodie personală. Apasă „+” pentru a începe.'
        : 'Nu a fost adăugată încă nicio melodie în grup. Apasă „+” pentru a începe.';
    } else {
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

  // Defaults to whichever list is currently open — most of the time,
  // adding a song while looking at Personal means you want another
  // personal one — but it's a real choice, not inferred silently: it's
  // shown and can be flipped right here either way.
  let visibility = _scope === 'personal' ? 'personal' : 'group';
  const visRow = el('div', { class: 'kind-filter' });
  const paintVis = () => {
    visRow.innerHTML = '';
    [['group', _groupName || 'Grup'], ['personal', 'Personal']].forEach(([value, label]) => {
      visRow.appendChild(el('button', {
        class: 'seg' + (visibility === value ? ' seg--active' : ''),
        onclick: () => { visibility = value; paintVis(); }
      }, [label]));
    });
  };
  paintVis();

  const sheet = el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Melodie nouă']),
    el('div', { class: 'field' }, [el('span', { class: 'field__label' }, ['Tip']), kindRow]),
    el('div', { class: 'field' }, [el('span', { class: 'field__label' }, ['Vizibilitate']), visRow]),
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
              shared: visibility !== 'personal',
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
