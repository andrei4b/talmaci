/* bible-tab.js — the Biblie tab: read the Cornilescu translation chapter by
 * chapter, jump to a book/chapter, or search the whole text.
 *
 * Data is a single JSON file, ~4MB, so — same discipline as the rhyme
 * index — it loads on demand the first time this tab is opened, never at
 * boot, and stays in memory afterwards. See data/BIBLE-LICENSE.md for
 * where the text comes from.
 *
 * State (which book/chapter is open, whether search is showing) is
 * module-level like Rime's, so switching to another tab and back returns
 * to the same page instead of resetting to Geneza 1.
 */
(function () {
const { el, debounce } = window.Utils;

const DATA_URL = './data/bible-cornilescu.json';
// The RCCV export lists books in the standard order; the Old Testament
// (Vechiul Testament) is Geneza..Maleahi, the first 39 — the boundary the
// book picker groups on.
const OT_COUNT = 39;

let _state = 'idle';   // idle | loading | ready | error
let _error = null;
let _promise = null;
let _books = null;     // [{ name, chapters: [ [verse, ...], ... ] }]

let _bookIdx = 0;
let _chapter = 1;
let _view = 'read';    // read | search
let _query = '';
let _searchIndex = null;   // built lazily: [{ bookIdx, chapter, verse, text, folded }]
const SEARCH_PAGE = 80;
let _searchShown = SEARCH_PAGE;

function load() {
  if (_promise) return _promise;
  _state = 'loading';
  _promise = fetch(DATA_URL)
    .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .then(data => { _books = data.books; _state = 'ready'; })
    .catch(err => { _state = 'error'; _error = err.message; throw err; });
  return _promise;
}

const CHEVRON_LEFT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 19l-7-7 7-7"/></svg>`;
const CHEVRON_RIGHT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>`;
const SEARCH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`;

function render(host) {
  host.innerHTML = '';
  if (_state !== 'ready') {
    host.appendChild(el('div', { class: 'topbar' }, [
      el('h1', { class: 'topbar__title' }, ['Biblie']),
      _kebabBtn()
    ]));
    host.appendChild(_loadingOrError(host));
    return;
  }
  if (_view === 'search') _renderSearch(host);
  else _renderReader(host);
}

function _kebabBtn() {
  return el('button', {
    class: 'btn btn--icon', 'aria-label': 'Cont',
    html: window.Utils.icons.kebab, onclick: () => window.App.openAccountMenu()
  });
}

function _loadingOrError(host) {
  if (_state === 'error') {
    return el('div', { class: 'empty-state' }, [
      el('p', {}, ['Nu am putut încărca Biblia: ' + _error]),
      el('button', { class: 'btn', onclick: () => { _promise = null; load().then(() => render(host)); } }, ['Încearcă din nou'])
    ]);
  }
  load().then(() => render(host)).catch(() => render(host));
  return el('div', { class: 'loading-state' }, [
    el('div', { class: 'spinner' }),
    'Se încarcă Biblia…'
  ]);
}

/* ---------- reader ---------- */

function _renderReader(host) {
  const book = _books[_bookIdx];
  if (_chapter > book.chapters.length) _chapter = book.chapters.length;
  if (_chapter < 1) _chapter = 1;

  host.appendChild(el('div', { class: 'topbar' }, [
    el('button', { class: 'bible__book-btn', onclick: () => _openBookPicker(host) }, [book.name]),
    el('div', { class: 'bible__chapnav' }, [
      el('button', {
        class: 'bible__chapnav-btn', 'aria-label': 'Capitolul anterior', html: CHEVRON_LEFT,
        onclick: () => _stepChapter(host, -1)
      }),
      el('button', { class: 'bible__chapnum', onclick: () => _openChapterPicker(host) }, [String(_chapter)]),
      el('button', {
        class: 'bible__chapnav-btn', 'aria-label': 'Capitolul următor', html: CHEVRON_RIGHT,
        onclick: () => _stepChapter(host, 1)
      })
    ]),
    el('button', {
      class: 'btn btn--icon', 'aria-label': 'Caută în Biblie', html: SEARCH_ICON,
      onclick: () => { _view = 'search'; _searchShown = SEARCH_PAGE; render(host); }
    }),
    _kebabBtn()
  ]));

  const body = el('div', { class: 'bible-body' });
  const verses = book.chapters[_chapter - 1];
  verses.forEach((text, i) => {
    if (!text) return;
    body.appendChild(el('div', { class: 'bible-verse' }, [
      el('span', { class: 'bible-verse__num' }, [String(i + 1)]),
      el('span', { class: 'bible-verse__text' }, [text])
    ]));
  });
  host.appendChild(body);
}

function _stepChapter(host, delta) {
  const book = _books[_bookIdx];
  let next = _chapter + delta;
  if (next < 1) {
    if (_bookIdx === 0) return;
    _bookIdx--;
    _chapter = _books[_bookIdx].chapters.length;
  } else if (next > book.chapters.length) {
    if (_bookIdx === _books.length - 1) return;
    _bookIdx++;
    _chapter = 1;
  } else {
    _chapter = next;
  }
  render(host);
}

/* ---------- book & chapter pickers ---------- */

function _openBookPicker(host) {
  const { openSheet, closeSheet } = window.Utils;
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  const list = el('div', { class: 'book-list' });

  function group(label, from, to) {
    list.appendChild(el('div', { class: 'book-list__group' }, [label]));
    for (let i = from; i < to; i++) {
      list.appendChild(el('button', {
        class: 'book-list__item' + (i === _bookIdx ? ' book-list__item--active' : ''),
        onclick: () => {
          closeSheet(overlay);
          _bookIdx = i;
          _chapter = 1;
          _openChapterPicker(host);
        }
      }, [_books[i].name]));
    }
  }
  group('Vechiul Testament', 0, OT_COUNT);
  group('Noul Testament', OT_COUNT, _books.length);

  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Alege o carte']),
    list
  ]));
  openSheet(overlay);
}

function _openChapterPicker(host) {
  const { openSheet, closeSheet } = window.Utils;
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  const book = _books[_bookIdx];
  const grid = el('div', { class: 'chap-grid' });
  for (let c = 1; c <= book.chapters.length; c++) {
    grid.appendChild(el('button', {
      class: 'chap-grid__item' + (c === _chapter ? ' chap-grid__item--active' : ''),
      onclick: () => { closeSheet(overlay); _chapter = c; render(host); }
    }, [String(c)]));
  }
  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('div', { class: 'sheet__title sheet__title--row' }, [
      el('span', {}, ['Alege un capitol']),
      el('span', { class: 'sheet__title-accent' }, [book.name])
    ]),
    grid
  ]));
  openSheet(overlay);
}

/* ---------- search ---------- */

const FOLD = { 'ă': 'a', 'â': 'a', 'î': 'i', 'ș': 's', 'ț': 't' };
function fold(s) {
  let out = '';
  for (const ch of s.toLowerCase()) out += FOLD[ch] || ch;
  return out;
}

function _buildSearchIndex() {
  if (_searchIndex) return _searchIndex;
  _searchIndex = [];
  _books.forEach((book, bookIdx) => {
    book.chapters.forEach((verses, cIdx) => {
      verses.forEach((text, vIdx) => {
        if (!text) return;
        _searchIndex.push({ bookIdx, chapter: cIdx + 1, verse: vIdx + 1, text, folded: fold(text) });
      });
    });
  });
  return _searchIndex;
}

function _renderSearch(host) {
  const input = el('input', {
    class: 'search-bar__input',
    type: 'search',
    placeholder: 'Caută în Biblie…',
    value: _query,
    autofocus: true,
    oninput: debounce((e) => {
      _query = e.target.value;
      _searchShown = SEARCH_PAGE;
      _runSearch(host, results);
    }, 250)
  });

  host.appendChild(el('div', { class: 'topbar' }, [
    el('button', {
      class: 'btn btn--icon', 'aria-label': 'Înapoi la lectură', html: window.Utils.icons.back,
      onclick: () => { _view = 'read'; render(host); }
    }),
    el('h1', { class: 'topbar__title' }, ['Caută'])
  ]));
  host.appendChild(el('div', { class: 'search-bar' }, [input]));

  const results = el('div', { class: 'bible-search' });
  host.appendChild(results);
  _runSearch(host, results);

  // Focus after mount — the attribute alone doesn't reliably focus an
  // element that wasn't in the DOM yet when it was set.
  input.focus();
}

function _runSearch(host, results) {
  results.innerHTML = '';
  const q = (_query || '').trim();
  if (!q) {
    results.appendChild(el('div', { class: 'empty-state' }, [
      el('p', {}, ['Scrie un cuvânt sau o expresie.'])
    ]));
    return;
  }

  const idx = _buildSearchIndex();
  const needle = fold(q);
  const matches = [];
  for (let i = 0; i < idx.length; i++) {
    if (idx[i].folded.indexOf(needle) !== -1) matches.push(idx[i]);
  }

  results.appendChild(el('div', { class: 'bible-search__count' }, [
    matches.length + (matches.length === 1 ? ' rezultat' : ' rezultate')
  ]));

  if (!matches.length) {
    results.appendChild(el('div', { class: 'empty-state' }, ['Niciun rezultat.']));
    return;
  }

  const list = el('div', { class: 'bible-search__list' });
  matches.slice(0, _searchShown).forEach(m => {
    list.appendChild(el('button', {
      class: 'bible-search__item',
      onclick: () => {
        _view = 'read';
        _bookIdx = m.bookIdx;
        _chapter = m.chapter;
        render(host);
        const target = host.querySelector('.bible-body');
        if (target) {
          const rows = target.querySelectorAll('.bible-verse');
          const row = rows[m.verse - 1];
          if (row) row.scrollIntoView({ block: 'center' });
        }
      }
    }, [
      el('div', { class: 'bible-search__ref' }, [_books[m.bookIdx].name + ' ' + m.chapter + ':' + m.verse]),
      el('div', { class: 'bible-search__text' }, [_highlight(m.text, m.folded, needle)])
    ]));
  });
  results.appendChild(list);

  const remaining = matches.length - Math.min(_searchShown, matches.length);
  if (remaining > 0) {
    results.appendChild(el('button', {
      class: 'btn btn--wide',
      onclick: () => { _searchShown += SEARCH_PAGE; _runSearch(host, results); }
    }, ['Arată mai multe (' + remaining + ')']));
  }
}

// fold() maps one character to one character, so an index found in the
// folded string points at the same position in the original — the
// highlight can slice the real (accented) text instead of the search key.
function _highlight(text, folded, needle) {
  const frag = document.createDocumentFragment();
  const at = folded.indexOf(needle);
  if (at === -1) { frag.appendChild(document.createTextNode(text)); return frag; }
  frag.appendChild(document.createTextNode(text.slice(0, at)));
  frag.appendChild(el('mark', { class: 'bible-search__hit' }, [text.slice(at, at + needle.length)]));
  frag.appendChild(document.createTextNode(text.slice(at + needle.length)));
  return frag;
}

window.BibleTab = { render };

})();
