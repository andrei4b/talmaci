/* bible-tab.js — the Biblie tab: read the Cornilescu translation chapter by
 * chapter, jump to a book/chapter/verse, or search the whole text.
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
const { el, toast, copyToClipboard } = window.Utils;

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
// Leaving the search screen — a tab switch, or tapping a result to read
// it — rebuilds .bible-search from scratch on return, which would
// otherwise reset scroll to the top every time. Saved on every scroll
// event and restored after each rebuild; a newly confirmed search is the
// one case that should start at the top, so submitting resets it.
let _searchScrollTop = 0;

// Verse selection — a long press starts it, a plain tap on another verse
// extends it. Scoped to the chapter on screen: navigating away implicitly
// clears it, so a stale selection can never point at verses no longer
// showing.
let _selected = new Set();
let _topbarSlot = null;    // the .topbar node in the DOM, swapped in place
let _verseEls = null;      // verse number -> its row, for in-place restyling

// The verse last jumped to — from the verse picker or a search result —
// shown in bold so the spot you asked for is easy to find on the page.
// Scoped to the chapter the same way _selected is: cleared on any
// book/chapter change, since a bolded verse from a chapter you've left
// wouldn't mean anything.
let _targetVerse = null;

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
const COPY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>`;
const SHARE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="2.7"/><circle cx="6" cy="12" r="2.7"/><circle cx="18" cy="19" r="2.7"/><path d="M8.4 10.6l7.2-4.2M8.4 13.4l7.2 4.2"/></svg>`;
const CLOSE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

// Kept so the popstate listener below — which runs outside any render call,
// possibly long after one — has something to re-render into.
let _lastHost = null;

function render(host) {
  _lastHost = host;
  host.innerHTML = '';
  if (_state !== 'ready') {
    host.appendChild(el('div', { class: 'topbar' }, [
      el('h1', { class: 'topbar__title' }, ['Biblie'])
    ]));
    host.appendChild(_loadingOrError(host));
    return;
  }
  if (_view === 'search') _renderSearch(host);
  else _renderReader(host);
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

  _topbarSlot = _selected.size ? _buildSelectionTopbar(host) : _buildReaderTopbar(host);
  host.appendChild(_topbarSlot);

  const body = el('div', { class: 'bible-body' });
  const verses = book.chapters[_chapter - 1];
  _verseEls = new Map();
  verses.forEach((text, i) => {
    if (!text) return;
    const n = i + 1;
    const row = el('div', { class: 'bible-verse'
      + (_selected.has(n) ? ' bible-verse--selected' : '')
      + (_targetVerse === n ? ' bible-verse--target' : '') }, [
      el('span', { class: 'bible-verse__num' }, [String(n)]),
      el('span', { class: 'bible-verse__text' }, [text])
    ]);
    _attachPress(row,
      () => { if (_selected.size) _toggleVerse(host, n); },
      () => { if (!_selected.size) { _selected.add(n); _refreshSelectionUI(host); } else _toggleVerse(host, n); }
    );
    _verseEls.set(n, row);
    body.appendChild(row);
  });
  host.appendChild(body);
}

/* A tap toggles selection once selecting has started; a long press starts
 * it. Built on pointer events rather than a 'contextmenu'/'touchstart'
 * pair so mouse and touch share one path — this runs inside an installed
 * PWA as often as a browser tab, and a right-click context menu on desktop
 * would be the wrong affordance anyway. Movement past a small threshold
 * cancels the long press, so a scroll gesture that starts on a verse
 * doesn't also select it. */
const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE = 10;
function _attachPress(elx, onTap, onLongPress) {
  let timer = null, startX = 0, startY = 0, moved = false, fired = false;
  elx.addEventListener('pointerdown', (e) => {
    moved = false;
    fired = false;
    startX = e.clientX;
    startY = e.clientY;
    timer = setTimeout(() => { fired = true; timer = null; onLongPress(); }, LONG_PRESS_MS);
  });
  elx.addEventListener('pointermove', (e) => {
    if (moved) return;
    if (Math.abs(e.clientX - startX) > MOVE_TOLERANCE || Math.abs(e.clientY - startY) > MOVE_TOLERANCE) {
      moved = true;
      if (timer) { clearTimeout(timer); timer = null; }
    }
  });
  elx.addEventListener('pointerup', () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!moved && !fired) onTap();
  });
  elx.addEventListener('pointercancel', () => { if (timer) clearTimeout(timer); timer = null; });
  elx.addEventListener('contextmenu', (e) => e.preventDefault());
}

function _toggleVerse(host, n) {
  if (_selected.has(n)) _selected.delete(n); else _selected.add(n);
  _refreshSelectionUI(host);
}

// Restyles the already-mounted verses and swaps only the topbar, rather
// than going through render()/host.innerHTML — a full rebuild would reset
// scroll to the top on every single tap while selecting.
function _refreshSelectionUI(host) {
  _verseEls.forEach((rowEl, n) => rowEl.classList.toggle('bible-verse--selected', _selected.has(n)));
  const next = _selected.size ? _buildSelectionTopbar(host) : _buildReaderTopbar(host);
  host.replaceChild(next, _topbarSlot);
  _topbarSlot = next;
}

function _buildReaderTopbar(host) {
  const book = _books[_bookIdx];
  return el('div', { class: 'topbar' }, [
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
      onclick: () => {
        // A pushed entry, not just a state flip — otherwise hardware back
        // has nothing of ours to land on and falls through to whatever
        // was open before the Biblie tab entirely.
        history.pushState({ talmaciBibleSearch: true }, '', location.hash);
        _view = 'search';
        render(host);
      }
    })
  ]);
}

function _buildSelectionTopbar(host) {
  const n = _selected.size;
  return el('div', { class: 'topbar' }, [
    el('div', { class: 'bible-selbar__count' }, [n + (n === 1 ? ' verset selectat' : ' versete selectate')]),
    el('button', {
      class: 'btn btn--icon', 'aria-label': 'Copiază', html: COPY_ICON,
      onclick: async () => {
        const ok = await copyToClipboard(_selectionText());
        toast(ok ? 'Copiat.' : 'Nu am putut copia.', ok ? {} : { kind: 'error' });
      }
    }),
    el('button', {
      class: 'btn btn--icon', 'aria-label': 'Distribuie', html: SHARE_ICON,
      onclick: () => _shareSelection()
    }),
    el('button', {
      class: 'btn btn--icon', 'aria-label': 'Anulează selecția', html: CLOSE_ICON,
      onclick: () => { _selected.clear(); _refreshSelectionUI(host); }
    })
  ]);
}

// Consecutive verse numbers collapse into a range ("8-9") the way a
// reference is normally written; a gap starts a new one ("8-9, 12").
function _rangeLabel(nums) {
  const parts = [];
  let start = nums[0], prev = nums[0];
  for (let i = 1; i <= nums.length; i++) {
    const n = nums[i];
    if (n === prev + 1) { prev = n; continue; }
    parts.push(start === prev ? String(start) : start + '-' + prev);
    if (n !== undefined) start = prev = n;
  }
  return parts.join(', ');
}

function _selectionText() {
  const book = _books[_bookIdx];
  const verses = book.chapters[_chapter - 1];
  const nums = [..._selected].sort((a, b) => a - b);
  const body = nums.map(n => n + ' ' + verses[n - 1]).join('\n');
  const ref = book.name + ' ' + _chapter + ':' + _rangeLabel(nums);
  return body + '\n\n' + ref + ' (Cornilescu)';
}

async function _shareSelection() {
  const text = _selectionText();
  if (navigator.share) {
    try { await navigator.share({ text }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const ok = await copyToClipboard(text);
  toast(ok ? 'Distribuirea nu e disponibilă aici — am copiat textul.' : 'Nu am putut copia.', ok ? {} : { kind: 'error' });
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
  _selected.clear();
  _targetVerse = null;
  render(host);
}

/* ---------- book & chapter pickers ---------- */

function _openBookPicker(host) {
  const { openSheet, closeSheet, closeSheetThen } = window.Utils;
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  const list = el('div', { class: 'book-list' });

  function group(label, from, to) {
    list.appendChild(el('div', { class: 'book-list__group' }, [label]));
    for (let i = from; i < to; i++) {
      list.appendChild(el('button', {
        class: 'book-list__item' + (i === _bookIdx ? ' book-list__item--active' : ''),
        onclick: () => {
          // Waits for the close to actually finish (its own history pop)
          // before pushing the chapter picker's — opening the next sheet
          // immediately would race that pop and leave the history stack
          // one entry short, so hardware back later skips a step.
          closeSheetThen(overlay, () => {
            _bookIdx = i;
            _chapter = 1;
            _selected.clear();
            _targetVerse = null;
            // Renders the reader underneath right away rather than
            // waiting for the chapter (and verse) pickers to finish —
            // backing out of either one without completing it should
            // land on the new book's chapter 1, not a stale screen for
            // whatever book was showing before this picker opened.
            render(host);
            _openChapterPicker(host);
          });
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
  const { openSheet, closeSheet, closeSheetThen } = window.Utils;
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  const book = _books[_bookIdx];
  const grid = el('div', { class: 'chap-grid' });
  for (let c = 1; c <= book.chapters.length; c++) {
    grid.appendChild(el('button', {
      class: 'chap-grid__item' + (c === _chapter ? ' chap-grid__item--active' : ''),
      onclick: () => {
        // Same reasoning as the book picker: wait for the pop before
        // opening the verse picker, or the history stack ends up short.
        closeSheetThen(overlay, () => {
          _chapter = c;
          _selected.clear();
          _targetVerse = null;
          render(host);
          _openVersePicker(host);
        });
      }
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

// The first verse whose row hasn't scrolled above the top of .bible-body —
// "current" in the sense of what you're actually looking at, since a
// scrolling reader has no single active verse the way a paginated one
// would. Marked in the grid the same way the chapter picker marks the
// chapter you're on.
function _currentVerseNumber(host) {
  const bodyEl = host.querySelector('.bible-body');
  if (!bodyEl) return null;
  const rows = [...bodyEl.querySelectorAll('.bible-verse')];
  if (!rows.length) return null;
  // Each row's own negative margin (the selection-highlight trick, see
  // .bible-verse in styles.css) pulls it a few px above where it would
  // otherwise sit, including the very first one at scrollTop 0 — without
  // slack here that row's top comes out just under bodyTop and gets
  // skipped, so re-opening the picker right at the top of a chapter
  // wrongly marks verse 2 as current instead of verse 1.
  const bodyTop = bodyEl.getBoundingClientRect().top - 10;
  const row = rows.find(r => r.getBoundingClientRect().top >= bodyTop) || rows[rows.length - 1];
  return parseInt(row.querySelector('.bible-verse__num').textContent, 10);
}

function _openVersePicker(host) {
  const { openSheet, closeSheet } = window.Utils;
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  const book = _books[_bookIdx];
  const verses = book.chapters[_chapter - 1];
  const current = _currentVerseNumber(host);
  const grid = el('div', { class: 'chap-grid' });
  verses.forEach((text, i) => {
    if (!text) return;
    const n = i + 1;
    grid.appendChild(el('button', {
      class: 'chap-grid__item' + (n === current ? ' chap-grid__item--active' : ''),
      onclick: () => {
        closeSheet(overlay);
        _targetVerse = n;
        render(host);
        const target = host.querySelector('.bible-body');
        const rows = target ? target.querySelectorAll('.bible-verse') : [];
        const row = rows[n - 1];
        if (row) row.scrollIntoView({ block: 'start' });
      }
    }, [String(n)]));
  });
  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('div', { class: 'sheet__title sheet__title--row' }, [
      el('span', {}, ['Alege un verset']),
      el('span', { class: 'sheet__title-accent' }, [book.name + ' ' + _chapter])
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
    enterkeyhint: 'search'
  });
  // A <form> rather than a keydown check: it's what makes a mobile
  // keyboard show a "Search"/"Go" confirmation key at all (enterkeyhint
  // alone is a hint, not a guarantee) and it's the one event that fires
  // for both that key and a hardware Enter. preventDefault stops it from
  // trying to actually navigate; blur is what closes the keyboard — nothing
  // does that on its own once the field has focus.
  const form = el('form', {
    onsubmit: (e) => {
      e.preventDefault();
      _query = input.value;
      _searchScrollTop = 0;
      _runSearch(host, results);
      input.blur();
    }
  }, [input]);

  host.appendChild(el('div', { class: 'topbar' }, [
    el('button', {
      class: 'btn btn--icon', 'aria-label': 'Înapoi la lectură', html: window.Utils.icons.back,
      onclick: () => {
        _view = 'read';
        render(host);
        // Consumes the entry pushed on the way in. _view is already 'read'
        // by the time the resulting popstate arrives, so the listener
        // below sees nothing to do and this doesn't render a second time.
        history.back();
      }
    }),
    el('h1', { class: 'topbar__title' }, ['Caută'])
  ]));
  host.appendChild(el('div', { class: 'search-bar' }, [form]));

  const results = el('div', { class: 'bible-search' });
  results.addEventListener('scroll', () => { _searchScrollTop = results.scrollTop; });
  host.appendChild(results);
  _runSearch(host, results);

  // Only when there's nothing searched yet — returning to a search that
  // already has results shouldn't yank focus (and the keyboard) away from
  // whatever the user is doing, e.g. reading through what's already there.
  if (!_query) input.focus();
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
  matches.forEach(m => {
    list.appendChild(el('button', {
      class: 'bible-search__item',
      onclick: () => {
        _view = 'read';
        _bookIdx = m.bookIdx;
        _chapter = m.chapter;
        _selected.clear();
        _targetVerse = m.verse;
        render(host);
        const target = host.querySelector('.bible-body');
        if (target) {
          const rows = target.querySelectorAll('.bible-verse');
          const row = rows[m.verse - 1];
          if (row) row.scrollIntoView({ block: 'start' });
        }
        // Same reasoning as the back arrow: consumes the pushed entry
        // without a second render, since _view is already 'read'.
        history.back();
      }
    }, [
      el('div', { class: 'bible-search__ref' }, [_books[m.bookIdx].name + ' ' + m.chapter + ':' + m.verse]),
      el('div', { class: 'bible-search__text' }, [_highlight(m.text, m.folded, needle)])
    ]));
  });
  results.appendChild(list);

  // Rebuilding just cleared and repopulated this, which drops scrollTop
  // to 0 — put it back where the last scroll (or a previous rebuild)
  // left it, now that there's actually content to scroll through.
  results.scrollTop = _searchScrollTop;
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

// Hardware back while search is showing: every path that closes search
// from inside the app (the back arrow, tapping a result) already flips
// _view to 'read' before consuming its own pushed entry, so by the time
// their popstate lands here there's nothing left to do — this only fires
// for a back press the app didn't originate itself. The hash check keeps
// it from reacting to an unrelated pop that happens to land elsewhere
// while a stale 'search' _view is sitting around from an earlier visit
// (switching tabs never touches _view, by design — see the file header).
window.addEventListener('popstate', () => {
  if (_view === 'search' && location.hash === '#/biblie') {
    _view = 'read';
    render(_lastHost);
  }
});

window.BibleTab = { render };

})();
