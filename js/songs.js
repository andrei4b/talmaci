/* songs.js — main page: the song list (search, add, navigate to detail). */
(function () {
const { $, el, toast, debounce, openSheet, closeSheet, closeSheetThen, icons, normalizeUrl, isShared,
        songStatus, statusLabel, songWorkers, isOffline, isNetworkError, failText, offlineNotice } = window.Utils;

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
// Loaded once, with the list's first load, so it first draws with names.
let _memberNames = null;
// Bumped by reset(). A fetch that was already in flight for the previous
// account must not write its result into the next account's list.
let _gen = 0;
// Whether the list is unloaded because the last attempt found no connection.
let _offline = false;
// Whether the list showing came from the device's copy, offline. It is
// read again from the server as soon as the connection is back.
let _fromDevice = false;
window.addEventListener('online', () => {
  if (!_loaded || !_fromDevice) return;
  if (_listWrap && _listWrap.isConnected) _loadSongs(true);
  else _loaded = false;   // the next visit to the list reads it
});

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

  if (_loaded) {
    // Not got on the first load (offline): asked again, painted on arrival.
    if (!_groupName) _loadGroupName().then(_repaintScopeButton);
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
  // Before the first load is in, the group's name is not known: the button
  // keeps its place but shows nothing, rather than "Grup" turning into the
  // name a second later.
  const pending = !_loaded && !_offline && _scope === 'group' && !_groupName;
  _scopeBtnEl = el('button', { class: 'scope-btn' + (pending ? ' scope-btn--pending' : ''), onclick: _openScopeSheet }, [
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
}

function _repaintScopeButton() {
  if (_scopeBtnEl && _scopeBtnEl.isConnected) _scopeBtnEl.replaceWith(_renderScopeButton());
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

// `quiet` keeps the list on screen while it is read again, rather than a
// spinner in its place — for an update nobody asked for.
async function _loadSongs(quiet) {
  if (!_listWrap) return false;
  if (!quiet) {
    _listWrap.innerHTML = '';
    _listWrap.appendChild(el('div', { class: 'loading-state' }, [
      el('div', { class: 'spinner' }),
      'Se încarcă…'
    ]));
  }
  const gen = _gen;
  const offline = isOffline();
  // The group's name and the members' names are read alongside the songs
  // and the list is drawn once all are in, so nothing on it changes after.
  const extras = Promise.all([
    _groupName ? null : _loadGroupName(),
    _loadMemberNames()
  ]);
  try {
    const songs = await window.Db.listSongs(window.Auth.currentGroupId(), window.Auth.currentUser().uid);
    await extras;
    if (gen !== _gen) return false;
    _songs = songs;
    _loaded = true;
    _offline = false;
    _fromDevice = offline;
    if (!offline) _keepAllOnDevice(songs, gen);
  } catch (err) {
    await extras;
    if (gen !== _gen) return false;
    if (_loaded) {
      // A refresh that failed: the list already there stays.
      if (!quiet) toast(failText('Nu am putut reîmprospăta', err), { kind: 'error' });
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
  const top = _listScrollTop;
  _repaintScopeButton();
  _renderList(_listWrap);
  if (quiet) _listWrap.scrollTop = top;
  return _loaded;
}

/* Every song's versions, read once per session in the background so that
 * all of them, not only those opened, are in the device's copy and open
 * offline (see auth.js). One read per version, a few at a time, once the
 * app has settled; a refresh reads only songs not read yet. Notes are left
 * to be read when a song is opened. */
let _kept = new Set();   // song ids whose versions this session has read
async function _keepAllOnDevice(songs, gen) {
  if (!(await window.Auth.persistence())) return;
  const queue = songs.filter(s => !_kept.has(s.id));
  queue.forEach(s => _kept.add(s.id));
  if (!queue.length) return;
  await new Promise(r => window.requestIdleCallback ? requestIdleCallback(r, { timeout: 5000 }) : setTimeout(r, 2000));
  const next = async () => {
    while (queue.length && gen === _gen) {
      const song = queue.shift();
      if (isOffline()) { _kept.delete(song.id); continue; }
      try { await window.Db.listVersions(song.id); } catch (_) { _kept.delete(song.id); }
    }
  };
  await Promise.all([next(), next(), next()]);
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
      text: 'Lista de melodii nu a fost încărcată încă pe acest dispozitiv.',
      hint: 'Se încarcă o dată cu internet; după aceea se deschide și fără. Rimele și Biblia merg oricând.',
      retry: () => _loadSongs()
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
  // Not got with the first load (offline): asked again, redrawn on arrival.
  if (_scope !== 'personal' && !_memberNames) {
    _loadMemberNames().then(() => {
      if (_memberNames && _listWrap && _listWrap.isConnected) _renderList(_listWrap);
    });
  }
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
    // A count only when the members could not be read (offline).
    const names = _memberNames
      ? workers.map(uid => _memberNames.get(uid) || 'Cineva').join(', ')
      : workers.length + (workers.length === 1 ? ' persoană' : ' persoane');
    meta.appendChild(el('span', { class: 'song-list__workers' }, ['Lucrează: ' + names]));
  }
  return meta;
}

// Never throws; on a failed read the names stay unknown, to be asked again.
async function _loadMemberNames() {
  if (_memberNames) return;
  const gen = _gen;
  const members = await window.Auth.groupMembers();
  if (gen !== _gen || _memberNames || !members.length) return;
  _memberNames = new Map(members.map(m => [m.uid, window.Auth.shortName(m)]));
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
  _fromDevice = false;
  _kept = new Set();
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
