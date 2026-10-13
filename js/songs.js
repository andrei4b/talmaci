/* songs.js — main page: the song list (search, add, navigate to detail). */
(function () {
const { $, el, toast, debounce, openSheet, closeSheet, closeSheetThen, icons, normalizeUrl, isShared,
        songStatus, statusLabel, songWorkers, isNetworkError, failText, offlineNotice } = window.Utils;

const CHEVRON_DOWN_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;
// A drawn plus rather than the "+" character — text glyphs sit off-center
// in a circular button depending on the font's own metrics (see icons in
// utils.js for the same reasoning); an SVG centers exactly regardless.
const PLUS_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;

let _songs = [];
// Fetched once and kept — a tab switch or a "back" from a song re-renders
// this list without hitting Firestore again, matching how Rime/Biblie
// already only load their own data once. Mutations the user makes
// elsewhere (song-detail.js) update _songs directly through noteCreated/
// noteUpdated/noteDeleted below, rather than this ever needing to refetch
// to stay correct.
let _loaded = false;
let _listScrollTop = 0;
let _query = '';
// Which list is showing: the group's shared songs, or this user's own
// personal ones. Module state like _query, deliberately not localStorage: a
// choice that quietly persists across sessions is a good way to wonder
// where half your songs went.
let _scope = 'group';
// Fetched once per session and cached — every visit after the first shows
// the real name immediately instead of a placeholder.
let _groupName = '';
let _scopeBtnEl = null;
let _listWrap = null;
// uid -> short name of everyone in the group, for who is working on what.
// Loaded once, after the list first draws; the list redraws when it lands.
let _memberNames = null;
// Bumped by reset(). A fetch that was already in flight for the previous
// account must not write its result into the next account's list.
let _gen = 0;
// Whether the list is unloaded because the last attempt found no connection.
let _offline = false;

async function render(root) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'topbar' }, [
    el('h1', { class: 'topbar__title' }, ['Tălmaci']),
    _renderScopeButton(),
    el('button', { class: 'btn btn--icon', 'aria-label': 'Cont', html: icons.kebab, onclick: () => window.App.openAccountMenu() })
  ]));

  _listWrap = el('div', { class: 'song-list-wrap' });
  _listWrap.addEventListener('scroll', () => { _listScrollTop = _listWrap.scrollTop; });
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
    html: PLUS_ICON,
    onclick: () => _openAddSong()
  }));

  // Fire-and-forget: doesn't hold up the tab's first paint the way
  // awaiting it here would, and it only ever needs to run once.
  if (!_groupName) _loadGroupName();

  if (_loaded) {
    // A tab switch or a "back" from a song, not a first visit — redraw
    // from the cache instead of hitting Firestore again, and land back
    // where the list was scrolled to instead of resetting to the top.
    _renderList(_listWrap);
    _listWrap.scrollTop = _listScrollTop;
  } else {
    await _loadSongs();
  }
}

function _renderScopeButton() {
  _scopeBtnEl = el('button', { class: 'scope-btn', onclick: _openScopeSheet }, [
    el('span', { class: 'scope-btn__label' }, [_scope === 'personal' ? 'Personal' : (_groupName || 'Grup')]),
    el('span', { html: CHEVRON_DOWN_ICON, 'aria-hidden': 'true' })
  ]);
  return _scopeBtnEl;
}

async function _loadGroupName() {
  const gen = _gen;
  let name;
  try {
    const group = await window.Db.getGroup(window.Auth.currentGroupId());
    name = (group && group.name) || 'Grup';
  } catch (_) {
    // Not kept: offline, the next visit to the list asks again.
    return;
  }
  if (gen !== _gen) return;
  _groupName = name;
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

async function _loadSongs() {
  if (!_listWrap) return false;
  _listWrap.innerHTML = '';
  _listWrap.appendChild(el('div', { class: 'loading-state' }, [
    el('div', { class: 'spinner' }),
    'Se încarcă…'
  ]));
  const gen = _gen;
  try {
    const songs = await window.Db.listSongs(window.Auth.currentGroupId(), window.Auth.currentUser().uid);
    if (gen !== _gen) return false;
    _songs = songs;
    _loaded = true;
    _offline = false;
  } catch (err) {
    if (gen !== _gen) return false;
    if (_loaded) {
      // A refresh that failed: the list already there stays.
      toast(failText('Nu am putut reîmprospăta', err), { kind: 'error' });
      _renderList(_listWrap);
      return false;
    }
    // Left unloaded — a later tab switch retries the fetch instead of
    // settling permanently on an empty list until someone thinks to use
    // "Reîmprospătează".
    _songs = [];
    _offline = isNetworkError(err);
    if (!_offline) toast('Nu am putut încărca melodiile: ' + err.message, { kind: 'error' });
  }
  _renderList(_listWrap);
  return _loaded;
}

// Re-fetches from Firestore — there are no live listeners for another
// group member's changes, so this (and the account menu's
// "Reîmprospătează") is the only way to pick those up now that a plain
// tab switch no longer does.
async function refresh() {
  if (await _loadSongs()) toast('Actualizat.');
}

function _renderList(listWrap) {
  listWrap.innerHTML = '';
  // Not loaded for want of a connection: that is the answer for either
  // list and any search, not "no songs".
  if (!_loaded && _offline) {
    listWrap.appendChild(offlineNotice({
      text: 'Melodiile nu se pot încărca fără internet.',
      retry: () => { _loadSongs(); if (!_groupName) _loadGroupName(); }
    }));
    return;
  }
  const myUid = window.Auth.currentUser().uid;
  // Firestore's own rules already keep another member's personal songs out
  // of what _loadSongs fetches at all — the createdBy check here is just
  // this list being explicit about what "personal" means, not a second
  // enforcement layer.
  const scoped = _songs.filter(s => _scope === 'personal'
    ? (!isShared(s) && s.createdBy === myUid)
    : isShared(s));

  const q = _query.trim().toLowerCase();
  const filtered = scoped.filter(s => !q || (s.title || '').toLowerCase().includes(q));

  if (!filtered.length) {
    let msg;
    if (!scoped.length) {
      msg = _scope === 'personal'
        ? 'Nu ai nicio melodie personală. Apasă „+” pentru a începe.'
        : 'Nu a fost adăugată încă nicio melodie în grup. Apasă „+” pentru a începe.';
    } else {
      msg = 'Nicio melodie găsită.';
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
        el('span', { class: 'song-list__title' }, [song.title || 'Fără titlu']),
        el('span', { class: 'song-list__snippet' }, [window.Sections.strip(song.originalText).slice(0, 80)]),
        _renderSongMeta(song)
      ])
    ]));
  });
  listWrap.appendChild(ul);
  if (_scope !== 'personal') _loadMemberNames();
}

/* Under a song: where it stands and who is on it. A draft says nothing —
 * it is where every song starts, and a list full of "Ciornă" would bury
 * the two that mean something. Nothing at all when neither applies.
 * Not who on a personal song: that can only be you. */
function _renderSongMeta(song) {
  const status = songStatus(song);
  const workers = _scope === 'personal' ? [] : songWorkers(song);
  if (status === 'draft' && !workers.length) return null;
  const meta = el('span', { class: 'song-list__meta' });
  if (status !== 'draft') {
    meta.appendChild(el('span', { class: 'status-chip status-chip--' + status }, [statusLabel(status)]));
  }
  if (workers.length) {
    // Names arrive once the members are loaded; until then, a count.
    const names = _memberNames
      ? workers.map(uid => _memberNames.get(uid) || 'Cineva').join(', ')
      : workers.length + (workers.length === 1 ? ' persoană' : ' persoane');
    meta.appendChild(el('span', { class: 'song-list__workers' }, ['Lucrează: ' + names]));
  }
  return meta;
}

async function _loadMemberNames() {
  if (_memberNames) return;
  const gen = _gen;
  const members = await window.Auth.groupMembers();
  if (gen !== _gen || _memberNames) return;
  _memberNames = new Map(members.map(m => [m.uid, window.Auth.shortName(m)]));
  if (_listWrap && _listWrap.isConnected) _renderList(_listWrap);
}

// Called from song-detail.js after it changes a song directly, so the
// cached list here stays correct without needing a refetch — the whole
// point of caching is that "back to the list" no longer hits Firestore,
// so it has to learn about edits some other way.
function noteUpdated(songId, patch) {
  const song = _songs.find(s => s.id === songId);
  if (song) Object.assign(song, patch);
}

function noteDeleted(songId) {
  _songs = _songs.filter(s => s.id !== songId);
}

function _openAddSong() {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  // Not autofocused. The first thing to decide here is the type, and
  // focusing the title raises the keyboard over the choice on a phone.
  // No field for the original text: a translation's source is written in
  // its own panel on the Text tab, where the song opens straight after.
  const titleInput = el('input', { class: 'field__input', type: 'text', placeholder: 'Titlul melodiei' });
  const demoInput = el('input', { class: 'field__input', type: 'url', placeholder: 'https://…', autocapitalize: 'off', autocomplete: 'off' });

  let kind = 'translation';
  const kindRow = el('div', { class: 'pill-row' });
  const paintKind = () => {
    kindRow.innerHTML = '';
    [['translation', 'Traducere'], ['original', 'Compoziție']].forEach(([value, label]) => {
      kindRow.appendChild(el('button', {
        class: 'seg' + (kind === value ? ' seg--active' : ''),
        onclick: () => { kind = value; paintKind(); }
      }, [label]));
    });
  };
  paintKind();

  // Defaults to whichever list is currently open — most of the time,
  // adding a song while looking at Personal means you want another
  // personal one — but it's a real choice, not inferred silently: it's
  // shown and can be flipped right here either way.
  let visibility = _scope === 'personal' ? 'personal' : 'group';
  const visRow = el('div', { class: 'pill-row' });
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

  // Whether you are working on it — who adds a song is usually who starts
  // it, so yes unless said otherwise. The same list the song's Stare sheet
  // keeps, so it shows under the title from the start.
  let working = true;
  const workRow = el('div', { class: 'pill-row' });
  const paintWork = () => {
    workRow.innerHTML = '';
    [[true, 'Da'], [false, 'Nu']].forEach(([value, label]) => {
      workRow.appendChild(el('button', {
        class: 'seg' + (working === value ? ' seg--active' : ''),
        onclick: () => { working = value; paintWork(); }
      }, [label]));
    });
  };
  paintWork();

  const sheet = el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Melodie nouă']),
    el('div', { class: 'field' }, [el('span', { class: 'field__label' }, ['Tip']), kindRow]),
    el('div', { class: 'field' }, [el('span', { class: 'field__label' }, ['Vizibilitate']), visRow]),
    el('div', { class: 'field' }, [el('span', { class: 'field__label' }, ['Lucrezi la ea?']), workRow]),
    el('label', { class: 'field' }, [el('span', { class: 'field__label' }, ['Titlu']), titleInput]),
    el('label', { class: 'field' }, [el('span', { class: 'field__label' }, ['Link demo (opțional)']), demoInput]),
    el('div', { class: 'sheet__actions' }, [
      el('button', { class: 'btn', onclick: () => closeSheet(overlay) }, ['Anulează']),
      el('button', {
        class: 'btn btn--primary',
        onclick: async () => {
          const title = titleInput.value.trim();
          if (!title) { toast('Introdu un titlu.', { kind: 'error' }); return; }
          const demoUrl = normalizeUrl(demoInput.value);
          if (demoUrl === null) { toast('Linkul demo nu este valid.', { kind: 'error' }); return; }
          const originalText = '';
          try {
            const now = Date.now();
            const shared = visibility !== 'personal';
            const groupId = window.Auth.currentGroupId();
            const createdBy = window.Auth.currentUser().uid;
            const workers = working ? [createdBy] : [];
            const id = await window.Db.addSong({ title, kind, originalText, shared, demoUrl, workers, groupId, createdBy });
            // The cache won't otherwise learn about this until a manual
            // refresh — there's no fetch to pick it up on the way back
            // from the song this opens next.
            _songs.push({ id, title, kind, originalText, shared, demoUrl, workers, groupId, createdBy, createdAt: now, updatedAt: now });
            window.Activity.log({ id, title, shared }, 'song_created');
            closeSheetThen(overlay, () => { location.hash = `#/song/${id}`; });
          } catch (err) {
            toast(failText('Nu am putut salva melodia', err), { kind: 'error' });
          }
        }
      }, ['Salvează'])
    ])
  ]);
  overlay.appendChild(sheet);
  openSheet(overlay);
}

// Everything above is per-account, and the page is no longer reloaded
// between accounts, so signing in as someone else has to start from nothing
// instead of inheriting the previous account's list, scope and group name.
function reset() {
  _gen++;
  _songs = [];
  _loaded = false;
  _offline = false;
  _listScrollTop = 0;
  _query = '';
  _scope = 'group';
  _groupName = '';
  _scopeBtnEl = null;
  _listWrap = null;
  _memberNames = null;
}

window.Songs = { render, refresh, noteUpdated, noteDeleted, reset };

})();
