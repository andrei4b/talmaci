/* rime-tab.js — the Rime tab: look a word up and see what rhymes with it.
 *
 * Lived inside song-detail.js while the tabs belonged to a single song.
 * The tabs are now app-level — reachable from the song list without
 * opening anything — and this panel never referenced the song, so it moved
 * out whole.
 *
 * Its state (query, filters, chosen reading, how many results are shown)
 * is module-level on purpose: it survives a trip to the Text tab and back,
 * so glancing at the lyrics does not throw away a search.
 */
(function () {
const { el, toast, debounce } = window.Utils;

let _rimeQuery = '';
let _rimeSyll = 0;        // 0 = any
let _rimeReading = 0;     // which stress reading of the query word
// How many results are currently rendered. Grows via "arată mai multe" —
// productive endings like -ire match several hundred words, and rendering
// them all at once is a lot of DOM for results you rarely scroll to.
const RIME_PAGE = 120;
// Highest syllable bucket offered; it filters as "this many or more".
const RIME_SYLL_MAX = 5;
let _rimeShown = RIME_PAGE;

function _renderRimeTab(host) {
  const wrap = el('div', { class: 'rime' });

  // Deliberately the song list's search field, class for class: the two
  // tabs sit one tap apart, and a field that shifts position or changes
  // shade between them reads as a different control. Sharing the markup
  // means it cannot drift — .search-bar carries the position too, so this
  // sits directly under the topbar exactly as the list's does instead of
  // inside the scrolling panel a few pixels lower.
  const input = el('input', {
    class: 'search-bar__input',
    type: 'search',
    placeholder: 'Scrie un cuvânt…',
    value: _rimeQuery,
    oninput: debounce((e) => {
      _rimeQuery = e.target.value;
      _rimeShown = RIME_PAGE;   // new search starts from the top again
      _rimeReading = 0;         // and from the word's leading reading
      _runRimeSearch(wrap);
    }, 250)
  });
  host.appendChild(el('div', { class: 'search-bar' }, [input]));
  host.appendChild(wrap);
  _renderPanel(wrap);

  // Only on an empty search — this tab is re-rendered fresh every time the
  // Text/Sinonime/Biblie tabs are switched away from and back, and stealing
  // focus (and the keyboard) away from whatever the user already typed
  // would be the wrong kind of eager.
  if (!_rimeQuery) input.focus();

  return wrap;
}

/* Everything below the search field. Rebuilt on its own when a filter
 * changes, which is what lets the field keep its text, its caret and the
 * on-screen keyboard: it is a sibling of this, not a child. */
function _renderPanel(wrap) {
  wrap.innerHTML = '';

  // Only perfect rhymes are offered, so there is no mode to choose.
  const sylRow = el('div', { class: 'rime__filters rime__filters--syll' }, [
    el('span', { class: 'rime__filters-label' }, ['Silabe']),
    _segButton('Toate', _rimeSyll === 0, () => { _rimeSyll = 0; _rimeShown = RIME_PAGE; _renderPanel(wrap); })
  ]);
  // The last bucket is open-ended: long rhymes are rare enough that giving
  // 6, 7 and 8 their own buttons would mostly show empty result lists.
  [1, 2, 3, 4, RIME_SYLL_MAX].forEach(n => {
    const label = n === RIME_SYLL_MAX ? n + '+' : String(n);
    sylRow.appendChild(_segButton(label, _rimeSyll === n, () => { _rimeSyll = n; _rimeShown = RIME_PAGE; _renderPanel(wrap); }));
  });
  wrap.appendChild(sylRow);

  // Filled in by the search, once the word is known to have more than one
  // reading. It lives here rather than inside .rime__body so it stays put
  // with the other filters instead of scrolling away with the results.
  wrap.appendChild(el('div', { class: 'rime__readings' }));

  wrap.appendChild(el('div', { class: 'rime__body' }));
  _runRimeSearch(wrap);
}

function _segButton(label, active, onclick) {
  return el('button', {
    class: 'seg' + (active ? ' seg--active' : ''),
    onclick: onclick
  }, [label]);
}

async function _runRimeSearch(wrap) {
  const body = wrap.querySelector('.rime__body');
  if (!body) return;
  const readingsRow = wrap.querySelector('.rime__readings');
  if (readingsRow) readingsRow.innerHTML = '';
  const q = (_rimeQuery || '').trim();

  if (!q) {
    body.innerHTML = '';
    body.appendChild(el('div', { class: 'empty-state' }, [
      el('p', {}, ['Scrie un cuvânt ca să vezi cu ce rimează.'])
    ]));
    return;
  }

  // The index is several megabytes, so it loads on demand the first time
  // you actually search — never at app boot.
  if (window.Rhyme.state() !== 'ready') {
    body.innerHTML = '';
    const pct = el('div', { class: 'empty-state__hint' }, ['0%']);
    body.appendChild(el('div', { class: 'loading-state' }, [
      el('div', { class: 'spinner' }),
      'Se încarcă dicționarul de rime…',
      pct
    ]));
    try {
      await window.Rhyme.load((p) => { pct.textContent = Math.round(p * 100) + '%'; });
    } catch (err) {
      body.innerHTML = '';
      body.appendChild(el('div', { class: 'empty-state' }, [
        'Nu am putut încărca dicționarul: ' + window.Rhyme.errorMessage()
      ]));
      return;
    }
    if ((_rimeQuery || '').trim() !== q) return;   // query changed while loading
  }

  const res = window.Rhyme.lookup(q, {
    syllables: _rimeSyll,
    syllablesOrMore: _rimeSyll === RIME_SYLL_MAX,
    reading: _rimeReading
  });
  body.innerHTML = '';

  if (!res.ok || !res.analysis) {
    body.appendChild(el('div', { class: 'empty-state' }, ['Nu am putut analiza cuvântul.']));
    return;
  }

  // Not in the dictionary: no attested accent, so no division and no rhymes
  // either. Both would be guesses, and a guess is indistinguishable on
  // screen from the real thing.
  if (res.unknown) {
    body.appendChild(el('div', { class: 'empty-state' }, [
      el('p', {}, ['Cuvântul nu e în dicționar.']),
      el('p', { class: 'empty-state__hint' }, ['Verifică ortografia sau încearcă alt cuvânt.'])
    ]));
    return;
  }

  const a = res.analysis;
  const total = res.total || 0;

  // Show the actual division with the stressed syllable highlighted
  // ("cru-ce", "mân-tu-i-re") — more legible at a glance than describing it
  // as "2 silabe · accent pe silaba 1".
  const parts = a.syllableParts && a.syllableParts.length ? a.syllableParts : [a.word];
  const line = el('div', { class: 'rime__analysis' });
  parts.forEach((p, i) => {
    if (i) line.appendChild(el('span', { class: 'rime__syl-sep' }, ['-']));
    line.appendChild(el('span', {
      class: 'rime__syl' + (i === a.stressIndex ? ' rime__syl--stressed' : '')
    }, [p]));
  });
  line.appendChild(el('span', { class: 'rime__meta' }, [
    (a.attested ? '' : ' · accent estimat') +
    (total ? ' · ' + total + (total === 1 ? ' rezultat' : ' rezultate') : '')
  ]));
  body.appendChild(line);

  // A spelling can be two words told apart only by stress — "c'asa" the
  // house against "cas'a" the verb — and they rhyme differently. Offer each
  // reading rather than silently picking one.
  const readings = window.Rhyme.readingLabels(q);
  if (readingsRow && readings.length > 1) {
    const row = el('div', { class: 'rime__filters rime__filters--readings' }, [
      el('span', { class: 'rime__filters-label' }, ['Accent'])
    ]);
    readings.forEach((r) => {
      // r.reading is the reading's real index; the picker may have collapsed
      // ones that read the same, so a button's position is not its index.
      const i = r.reading;
      const label = el('span', {});
      r.parts.forEach((p, k) => {
        if (k) label.appendChild(el('span', { class: 'rime__syl-sep' }, ['-']));
        label.appendChild(el('span', {
          class: k === r.stressIndex ? 'rime__syl--stressed' : ''
        }, [p]));
      });
      const btn = el('button', {
        class: 'seg' + (i === _rimeReading ? ' seg--active' : ''),
        onclick: () => {
          _rimeReading = i;
          _rimeShown = RIME_PAGE;
          // Rebuilds the results and this row itself. The search field is
          // a sibling of both, so it keeps its text and its focus.
          _runRimeSearch(wrap);
        }
      }, [label]);
      row.appendChild(btn);
    });
    readingsRow.appendChild(row);
  }

  if (!res.results.length) {
    body.appendChild(el('div', { class: 'empty-state' }, [
      el('p', {}, ['Niciun rezultat.']),
      el('p', { class: 'empty-state__hint' }, [
        _rimeSyll ? 'Încearcă fără filtrul de silabe.' : 'Încearcă alt cuvânt.'
      ])
    ]));
    return;
  }

  const shown = res.results.slice(0, _rimeShown);
  const list = el('div', { class: 'rime__results' });
  shown.forEach(r => {
    list.appendChild(el('button', {
      class: 'rime__word',
      title: r.syllables + ' silabe',
      onclick: async () => {
        const ok = await window.Utils.copyToClipboard(r.word);
        toast(ok ? '„' + r.word + '” copiat.' : 'Nu am putut copia.', ok ? {} : { kind: 'error' });
      }
    }, [r.word]));
  });
  body.appendChild(list);

  const remaining = res.total - shown.length;
  if (remaining > 0) {
    body.appendChild(el('button', {
      class: 'btn btn--wide',
      onclick: () => { _rimeShown += RIME_PAGE; _runRimeSearch(wrap); }
    }, ['Arată mai multe (' + remaining + ')']));
  }
}

window.RimeTab = { render: _renderRimeTab };

})();
