/* biblic-tab.js — the third dictionary of the Dicționare tab: Easton's Bible
 * Dictionary (1897), with the International Standard Bible Encyclopedia
 * (1915) a tap further for the same word.
 *
 * Easton's first because it is short — a few lines on who, where and what,
 * which is usually all a line of lyrics needs. ISBE goes into the Hebrew or
 * Greek behind a word and how its sense moved, which is what to read when
 * choosing between two Romanian words; it is long, and on hand rather than
 * in the way. Both are public domain; see data/BIBLIC-LICENSE.md.
 *
 * The data is built by tools/biblic/build-index.js: for each dictionary an
 * index of headwords and the entries in chunks, loaded the first time an
 * entry in one is opened. The service worker keeps what has been opened,
 * so a word looked up once is there offline.
 *
 * Verse references open the verse in the Biblie tab. They are written in
 * English (Matt. 21:9) and point at the KJV's numbering, which Cornilescu
 * follows nearly everywhere.
 */
(function () {
const { el } = window.Utils;

const BASE = './data/biblic/';
const BOOKS = ['Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth', '1Sam', '2Sam',
  '1Kgs', '2Kgs', '1Chr', '2Chr', 'Ezra', 'Neh', 'Esth', 'Job', 'Ps', 'Prov', 'Eccl', 'Song',
  'Isa', 'Jer', 'Lam', 'Ezek', 'Dan', 'Hos', 'Joel', 'Amos', 'Obad', 'Jonah', 'Mic', 'Nah',
  'Hab', 'Zeph', 'Hag', 'Zech', 'Mal', 'Matt', 'Mark', 'Luke', 'John', 'Acts', 'Rom', '1Cor',
  '2Cor', 'Gal', 'Eph', 'Phil', 'Col', '1Thess', '2Thess', '1Tim', '2Tim', 'Titus', 'Phlm',
  'Heb', 'Jas', '1Pet', '2Pet', '1John', '2John', '3John', 'Jude', 'Rev'];

let _query = '';
let _showIsbe = false;   // ISBE's article opened under Easton's
let _scrollTop = 0;

/* ---- the data ---- */

const _dicts = {
  easton: { name: 'easton', index: null, keys: null, chunks: new Map() },
  isbe: { name: 'isbe', index: null, keys: null, chunks: new Map() }
};
let _indexPromise = null;

function _loadIndexes() {
  if (!_indexPromise) {
    _indexPromise = Promise.all(Object.values(_dicts).map(d =>
      fetch(BASE + d.name + '/index.json')
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(ix => {
          d.index = ix;
          d.keys = new Map();
          ix.titles.forEach((t, i) => { if (!d.keys.has(t.toUpperCase())) d.keys.set(t.toUpperCase(), i); });
        })
    )).catch(err => { _indexPromise = null; throw err; });
  }
  return _indexPromise;
}

// An entry's HTML, by its position in the index.
async function _entry(d, i) {
  const starts = d.index.chunks;
  let c = starts.length - 1;
  while (starts[c] > i) c--;
  if (!d.chunks.has(c)) {
    d.chunks.set(c, fetch(BASE + d.name + '/' + c + '.json')
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .catch(err => { d.chunks.delete(c); throw err; }));
  }
  return (await d.chunks.get(c))[i - starts[c]];
}

/* ---- the view ---- */

function render(host) {
  const wrap = el('div', { class: 'rime en' });
  const input = el('input', {
    class: 'search-bar__input',
    type: 'search',
    placeholder: 'Un nume sau un cuvânt, în engleză…',
    value: _query,
    enterkeyhint: 'search',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    lang: 'en'
  });
  const go = (word) => {
    _query = word.trim();
    _showIsbe = false;
    _scrollTop = 0;
    input.value = _query;
    _run(body);
  };
  host.appendChild(el('div', { class: 'search-bar' }, [el('form', {
    onsubmit: (e) => { e.preventDefault(); go(input.value); input.blur(); }
  }, [input])]));

  const body = el('div', { class: 'rime__body en__body bd', lang: 'en' });
  body.addEventListener('scroll', () => { _scrollTop = body.scrollTop; });
  body.addEventListener('click', (e) => {
    const a = e.target.closest('[data-k],[data-v],[data-word]');
    if (!a) return;
    e.preventDefault();
    if (a.dataset.v) _openVerse(a.dataset.v);
    else go(a.dataset.k || a.dataset.word);
  });
  wrap.appendChild(body);
  host.appendChild(wrap);
  _run(body);

  if (!_query) input.focus();
  return wrap;
}

async function _run(body) {
  const q = _query;
  body.innerHTML = '';
  if (!q) {
    body.appendChild(el('div', { class: 'empty-state' }, [
      el('p', {}, ['Caută un nume, un loc sau un cuvânt din Biblie, în engleză.']),
      el('p', { class: 'empty-state__hint' }, ['Easton’s Bible Dictionary, cu ISBE pentru mai mult.'])
    ]));
    return;
  }

  body.appendChild(el('div', { class: 'loading-state' }, [el('div', { class: 'spinner' })]));
  const E = _dicts.easton, I = _dicts.isbe;
  let easton = null, isbe = null;
  try {
    await _loadIndexes();
    const key = q.toUpperCase();
    const ei = E.keys.get(key), ii = I.keys.get(key);
    [easton, isbe] = await Promise.all([
      ei != null ? _entry(E, ei).then(html => ({ title: E.index.titles[ei], html })) : null,
      // ISBE's article is fetched with Easton's only when it is the one to
      // show; otherwise just whether there is one matters, until asked for.
      ii != null && (ei == null || _showIsbe) ? _entry(I, ii).then(html => ({ title: I.index.titles[ii], html }))
        : ii != null ? { title: I.index.titles[ii] } : null
    ]);
  } catch (err) {
    if (_query !== q) return;
    body.innerHTML = '';
    body.appendChild(el('div', { class: 'empty-state' }, [
      el('p', {}, ['Nu am putut încărca dicționarul.']),
      el('p', { class: 'empty-state__hint' }, [err.message || String(err)])
    ]));
    return;
  }
  if (_query !== q) return;
  body.innerHTML = '';

  if (!easton && !isbe) {
    body.appendChild(_notFound(q));
    return;
  }

  const article = el('article', { class: 'en__entry' }, [
    el('div', { class: 'en__head' }, [el('span', { class: 'en__hw' }, [easton ? easton.title : _titleCase(isbe.title)])])
  ]);
  if (easton) {
    article.appendChild(el('div', { class: 'bd__text', html: easton.html }));
    article.appendChild(el('div', { class: 'en__source' }, ['Easton’s Bible Dictionary, 1897']));
  }
  if (isbe && easton && !_showIsbe) {
    article.appendChild(el('button', {
      class: 'btn btn--wide bd__more',
      onclick: () => { _showIsbe = true; _run(body); }
    }, ['Mai mult (ISBE)']));
  }
  if (isbe && isbe.html) {
    article.appendChild(el('div', { class: 'bd__isbe' }, [
      easton ? el('div', { class: 'bd__label' }, ['International Standard Bible Encyclopedia']) : null,
      el('div', { class: 'bd__text', html: isbe.html }),
      el('div', { class: 'en__source' }, ['International Standard Bible Encyclopedia, 1915'])
    ]));
  }
  body.appendChild(article);
  requestAnimationFrame(() => { body.scrollTop = _scrollTop; });
}

// Headwords that begin with, then contain, what was typed — from both.
function _notFound(q) {
  const key = q.toUpperCase();
  const seen = new Set(), starts = [], contains = [];
  for (const d of [_dicts.easton, _dicts.isbe]) {
    for (const t of d.index.titles) {
      const u = t.toUpperCase();
      if (seen.has(u)) continue;
      if (u.startsWith(key)) { starts.push(t); seen.add(u); }
      else if (u.includes(key)) { contains.push(t); seen.add(u); }
    }
  }
  const near = starts.concat(contains).slice(0, 30);
  return el('div', { class: 'empty-state' }, [
    el('p', {}, ['„' + q + '” nu e în dicționar.']),
    near.length ? el('p', { class: 'empty-state__hint' }, ['Poate ai vrut:']) : null,
    near.length ? el('div', { class: 'rime__results en__near' },
      near.map(w => el('button', { class: 'rime__word', 'data-word': w }, [_titleCase(w)]))) : null
  ]);
}

// ISBE's headwords are all capitals; shown as a title, they read better not.
function _titleCase(s) {
  return s === s.toUpperCase()
    ? s.toLowerCase().replace(/(^|[\s(-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
    : s;
}

/* "Matt.21.9" or "Exod.24.9-Exod.24.11", in the Biblie tab. A reference to
 * a whole chapter has no verse, and opens at its top. */
function _openVerse(ref) {
  const [book, chapter, verse] = ref.split('-')[0].split('.');
  const b = BOOKS.indexOf(book);
  if (b < 0) return;
  window.BibleTab.show(b, Number(chapter) || 1, Number(verse) || null);
  window.App.openTab('biblie');
}

/* A word from elsewhere — the editor's lookup. As in the other tabs, only
 * the state is set; the tab looks it up when it renders. */
function search(word) {
  _query = word;
  _showIsbe = false;
  _scrollTop = 0;
}

window.BiblicTab = { render, search };

})();
