/* engleza-tab.js — the English dictionary of the Dicționare tab: a word
 * looked up in Merriam-Webster's Collegiate Dictionary.
 *
 * The Collegiate is their main dictionary, the one on merriam-webster.com:
 * fuller senses than the Learner's it replaced, with where each word comes
 * from and discussions of near-synonyms, which is the finer distinction a
 * translator weighing two Romanian words is after.
 *
 * The lookup goes through the defineEnglish Cloud Function, which holds the
 * API key (see functions/index.js). What comes back is Merriam-Webster's own
 * JSON, laid out here; their documentation of it is at
 * https://dictionaryapi.com/products/json. Only the parts that make sense on
 * a phone are drawn — print-only notes, artwork and the long quotation
 * sections are left out — and every lookup links to the same word on
 * merriam-webster.com, which their terms ask for and which has the rest.
 *
 * Like Rime, the state is module-level, so a trip to the Text tab and back
 * finds the same word and the same scroll position.
 */
(function () {
const { el, toast } = window.Utils;

const WEB_URL = 'https://www.merriam-webster.com/dictionary/';
const AUDIO_URL = 'https://media.merriam-webster.com/audio/prons/en/us/mp3/';

let _query = '';
let _scrollTop = 0;
// Looked-up words for this session, by lowercased query. Each lookup spends
// one of the day's free calls, and going back and forth between a few
// words while translating a line is exactly how this gets used.
const _cache = new Map();

/* Today's lookups against the free tier's daily limit, as the Cloud
 * Function counts them — Merriam-Webster reports none of this itself.
 * Every lookup brings back the new count; opening the tab asks for it on
 * its own, at most once a minute, since the rest of the group spends from
 * the same key. A word from _cache costs nothing and changes nothing. */
let _usage = null;      // { used, limit, at }
let _usageEl = null;    // the line under the search field, while shown
const USAGE_MAX_AGE = 60 * 1000;

function _setUsage(data) {
  if (!data || typeof data.used !== 'number') return;
  _usage = { used: data.used, limit: data.limit || 1000, at: Date.now() };
  _paintUsage();
}

function _paintUsage() {
  if (!_usageEl || !_usage) return;
  const left = Math.max(0, _usage.limit - _usage.used);
  _usageEl.textContent = 'Azi: ' + left + (left === 1 ? ' căutare rămasă' : ' căutări rămase');
  _usageEl.classList.toggle('en__usage--low', left <= _usage.limit / 10);
}

function _refreshUsage() {
  if (_usage && Date.now() - _usage.at < USAGE_MAX_AGE) return;
  firebase.functions().httpsCallable('defineEnglish')({ usage: true })
    .then(res => _setUsage(res.data))
    .catch(() => {});   // only a count; the search itself reports real errors
}

function render(host) {
  const wrap = el('div', { class: 'rime en' });

  // The song list's and Rime's search field, for the same reason Rime gives:
  // a field that moves between tabs reads as a different control.
  const input = el('input', {
    class: 'search-bar__input',
    type: 'search',
    placeholder: 'Un cuvânt în engleză…',
    value: _query,
    enterkeyhint: 'search',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    lang: 'en'
  });
  const form = el('form', {
    onsubmit: (e) => {
      e.preventDefault();
      _query = input.value.trim();
      _scrollTop = 0;
      _run(body);
      input.blur();
    }
  }, [input]);
  host.appendChild(el('div', { class: 'search-bar' }, [form]));
  _usageEl = el('div', { class: 'en__usage' });
  host.appendChild(_usageEl);
  _paintUsage();
  _refreshUsage();

  const body = el('div', { class: 'rime__body en__body', lang: 'en' });
  body.addEventListener('scroll', () => { _scrollTop = body.scrollTop; });
  // Cross-references are drawn as links into the same tab; one handler
  // for all of them rather than one per link.
  body.addEventListener('click', (e) => {
    const a = e.target.closest('[data-word]');
    if (!a) return;
    e.preventDefault();
    _query = a.dataset.word;
    input.value = _query;
    _scrollTop = 0;
    _run(body);
  });
  wrap.appendChild(body);
  host.appendChild(wrap);
  _run(body);

  // As in Rime: only on an empty search, never over a word already there.
  if (!_query) input.focus();
  return wrap;
}

async function _run(body) {
  const q = _query;
  body.innerHTML = '';
  if (!q) {
    body.appendChild(el('div', { class: 'empty-state' }, [
      el('p', {}, ['Scrie un cuvânt sau o expresie în engleză.']),
      el('p', { class: 'empty-state__hint' }, ['Din Merriam-Webster’s Collegiate Dictionary.'])
    ]));
    return;
  }

  const key = q.toLowerCase();
  let entries = _cache.get(key);
  if (!entries) {
    body.appendChild(el('div', { class: 'loading-state' }, [el('div', { class: 'spinner' })]));
    try {
      const fn = firebase.functions().httpsCallable('defineEnglish');
      const res = await fn({ word: q });
      entries = res.data.entries || [];
      _cache.set(key, entries);
      _setUsage(res.data);
    } catch (err) {
      if (_query !== q) return;
      body.innerHTML = '';
      body.appendChild(el('div', { class: 'empty-state' }, [
        el('p', {}, ['Nu am putut căuta cuvântul.']),
        el('p', { class: 'empty-state__hint' }, [err.message || String(err)])
      ]));
      return;
    }
    if (_query !== q) return;   // another word was asked for meanwhile
    body.innerHTML = '';
  }

  const found = entries.filter(e => e && typeof e === 'object' && e.meta);
  if (!found.length) {
    // Not in the dictionary: what comes back instead is a list of near
    // spellings, offered as links.
    const near = entries.filter(e => typeof e === 'string');
    body.appendChild(el('div', { class: 'empty-state' }, [
      el('p', {}, ['„' + q + '” nu e în dicționar.']),
      near.length ? el('p', { class: 'empty-state__hint' }, ['Poate ai vrut:']) : null,
      near.length ? el('div', { class: 'rime__results en__near' },
        near.slice(0, 12).map(w => el('button', { class: 'rime__word', 'data-word': w }, [w]))) : null
    ]));
    return;
  }

  /* Merriam-Webster answers with every entry the word occurs in, idioms
   * filed under other headwords included: "die" brings back "hard" for
   * "die hard" and "habit" for "old habits die hard". An entry is the
   * word's own when its stems — headword, inflections, variants, phrases,
   * every form it should be found by — include what was typed; "died"
   * still finds "die" that way. When a phrase was typed ("die hard"), the
   * entry it belongs to shows that phrase alone, not all of "hard". The
   * idioms left over are offered as phrases to look up. If nothing at all
   * passes, everything is shown, as better than an empty page. */
  const k = _norm(q);
  const own = found.filter(e => (e.meta.stems || []).some(s => _norm(s) === k));
  const shown = own.length ? own : found;
  shown.forEach(e => {
    const phrase = _norm(_hw(e.hwi && e.hwi.hw || e.meta.id.split(':')[0]).replace(/·/g, '')) !== k
      ? (e.dros || []).filter(d => _phraseHas(d.drp, k)) : [];
    body.appendChild(_entry(e, phrase.length ? phrase : null));
  });

  const idioms = [];
  found.filter(e => !shown.includes(e)).forEach(e => (e.dros || []).forEach(d => {
    const p = _plain(d.drp);
    if (_phraseHas(d.drp, k) && !idioms.includes(p)) idioms.push(p);
  }));
  if (idioms.length) {
    body.appendChild(el('div', { class: 'en__idioms' }, [
      el('div', { class: 'bd__label' }, ['Expresii cu „' + q + '”']),
      el('div', { class: 'rime__results' },
        idioms.map(p => el('button', { class: 'rime__word', 'data-word': p }, [p])))
    ]));
  }

  body.appendChild(el('a', {
    class: 'en__source',
    href: WEB_URL + encodeURIComponent(q.toLowerCase()),
    target: '_blank',
    rel: 'noopener'
  }, ['Merriam-Webster ↗']));

  requestAnimationFrame(() => { body.scrollTop = _scrollTop; });
}

// For comparing what was typed with Merriam-Webster's forms: lower case,
// one kind of apostrophe, single spaces.
function _norm(s) {
  return String(s || '').toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
}
// A phrase as plain text, without its {it}-style marks.
function _plain(s) { return String(s || '').replace(/\{[^}]*\}/g, ''); }
// Whether a phrase contains every word typed, in any order: "old
// habits die hard" contains "die"; "act on/upon" contains "act upon".
function _phraseHas(drp, key) {
  const words = new Set(_norm(_plain(drp)).split(/[^a-z']+/).filter(Boolean));
  return key.split(/[^a-z']+/).filter(Boolean).every(w => words.has(w));
}

/* ---- one entry ----
 * `only`, when given, is the entry's phrases to show instead of all of it:
 * the ones a phrase search was for. */

function _entry(e, only) {
  const hwi = e.hwi || {};
  const head = el('div', { class: 'en__head' }, [
    el('span', { class: 'en__hw' }, [_hw(hwi.hw || e.meta.id.split(':')[0])]),
    e.hom ? el('sup', { class: 'en__hom' }, [String(e.hom)]) : null,
    e.fl ? el('span', { class: 'en__fl' }, [e.fl]) : null
  ]);
  const prs = _prons(hwi.prs || (hwi.altprs && [].concat(hwi.altprs.pr || [])));
  if (prs) head.appendChild(prs);

  const out = el('section', { class: 'en__entry' }, [head]);
  if (only) {
    only.forEach(d => out.appendChild(_dro(d)));
    return out;
  }
  const labels = _labels(e);
  if (labels) out.appendChild(el('div', { class: 'en__meta' }, [labels]));
  if (e.ins && e.ins.length) out.appendChild(el('div', { class: 'en__meta' }, [_inflections(e.ins)]));
  // A form that is defined elsewhere: "went" is the past tense of "go",
  // with nothing of its own but the pointer.
  if (e.cxs) out.appendChild(_cognates(e.cxs));

  (e.def || []).forEach(d => out.appendChild(_def(d)));

  // Undefined run-ons: derived words with no definition of their own,
  // sometimes with examples ("wanderer").
  (e.uros || []).forEach(u => {
    const row = el('div', { class: 'en__uro' }, [
      el('b', {}, [_hw(u.ure)]),
      u.fl ? el('span', { class: 'en__fl' }, [' ' + u.fl]) : null,
      u.gram ? el('span', { class: 'en__gram' }, [' [' + u.gram + ']']) : null
    ]);
    (u.utxt || []).forEach(x => _dtItem(row, x));
    out.appendChild(row);
  });

  // Defined run-ons: the idioms and phrasal verbs, each a small entry.
  (e.dros || []).forEach(d => out.appendChild(_dro(d)));

  (e.dxnls || []).forEach(x => out.appendChild(el('div', { class: 'en__note', html: _fmt(x) })));

  // Discussions of near-synonyms ("wonder, marvel, miracle mean …") and of
  // disputed usage, each under its own heading.
  [].concat(e.syns || [], e.usages || []).forEach(s => {
    const block = el('div', { class: 'en__para' }, [
      el('div', { class: 'bd__label', html: _fmt(s.pl) })
    ]);
    (s.pt || []).forEach(x => _dtItem(block, x));
    out.appendChild(block);
  });

  // Where the word comes from, and when it is first found in English.
  if (e.et || e.date) {
    const block = el('div', { class: 'en__para en__origin' }, [el('div', { class: 'bd__label' }, ['Origine'])]);
    (e.et || []).forEach(x => { if (x[0] === 'text') block.appendChild(el('span', { html: _fmt(x[1]) })); });
    if (e.date) block.appendChild(el('div', { class: 'en__meta', html: 'Prima atestare: ' + _fmt(e.date) }));
    out.appendChild(block);
  }

  return out;
}

function _cognates(cxs) {
  const row = el('div', { class: 'en__meta en__cxs' });
  cxs.forEach((c, i) => {
    if (i) row.appendChild(document.createTextNode(', '));
    if (c.cxl) row.appendChild(el('i', {}, [c.cxl + ' ']));
    (c.cxtis || []).forEach((t, j) => {
      if (j) row.appendChild(document.createTextNode(' '));
      if (t.cxl) row.appendChild(el('i', {}, [t.cxl + ' ']));
      if (t.cxt) {
        row.appendChild(el('a', {
          class: 'en__xref', href: '#',
          'data-word': (t.cxr || t.cxt).replace(/:\d+$/, '')
        }, [t.cxt]));
      }
      if (t.cxn) row.appendChild(document.createTextNode(' ' + t.cxn));
    });
  });
  return row;
}

function _dro(d) {
  const block = el('div', { class: 'en__dro' }, [
    el('div', { class: 'en__drp' }, [
      el('b', { html: _fmt(d.drp) }),
      d.gram ? el('span', { class: 'en__gram' }, [' [' + d.gram + ']']) : null,
      d.rsl ? el('i', { class: 'en__lbl' }, [' (' + d.rsl + ')']) : null
    ])
  ]);
  if (d.vrs) block.appendChild(el('div', { class: 'en__meta' }, [_variants(d.vrs)]));
  (d.def || []).forEach(x => block.appendChild(_def(x)));
  return block;
}

// "wan*der" → "wan·der": the asterisks mark the syllable breaks.
function _hw(s) { return String(s || '').replace(/\*/g, '·'); }

function _prons(prs) {
  if (!prs || !prs.length) return null;
  const row = el('span', { class: 'en__prs' });
  prs.forEach((p, i) => {
    // The Collegiate writes pronunciation in Merriam-Webster's own symbols
    // (mw), set between backslashes as in print; IPA, where there is any,
    // between slashes.
    const text = p.mw ? '\\' + p.mw + '\\' : p.ipa ? '/' + p.ipa + '/' : '';
    if (text) row.appendChild(el('span', { class: 'en__ipa' }, [(i ? ', ' : '') + text]));
    const audio = p.sound && p.sound.audio;
    if (audio && !row.querySelector('.en__play')) {
      row.appendChild(el('button', {
        class: 'en__play',
        'aria-label': 'Ascultă pronunția',
        title: 'Ascultă pronunția',
        html: SPEAKER_ICON,
        onclick: () => new Audio(_audioUrl(audio)).play()
          .catch(() => toast('Nu am putut reda pronunția.', { kind: 'error' }))
      }));
    }
  });
  return row;
}

// The subdirectory rule is Merriam-Webster's, from their documentation.
function _audioUrl(name) {
  const dir = name.startsWith('bix') ? 'bix'
    : name.startsWith('gg') ? 'gg'
    : /^[^a-z]/i.test(name) ? 'number'
    : name[0];
  return AUDIO_URL + dir + '/' + name + '.mp3';
}

const SPEAKER_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>`;

function _labels(o) {
  const parts = [];
  if (o.gram) parts.push('[' + o.gram + ']');
  if (o.lbs) parts.push(o.lbs.join(', '));
  if (o.sls) parts.push(o.sls.join(', '));
  if (o.sgram) parts.push('[' + o.sgram + ']');
  if (!parts.length) return null;
  return el('span', { class: 'en__lbl' }, [parts.join(' ')]);
}

function _inflections(ins) {
  const span = el('span', { class: 'en__ins' });
  ins.forEach((x, i) => {
    if (i) span.appendChild(document.createTextNode('; '));
    if (x.il) span.appendChild(el('i', {}, [x.il + ' ']));
    span.appendChild(el('b', {}, [_hw(x.if || x.ifc || '')]));
  });
  return span;
}

function _variants(vrs) {
  const span = el('span', { class: 'en__ins' });
  vrs.forEach((v, i) => {
    if (i) span.appendChild(document.createTextNode(' '));
    if (v.vl) span.appendChild(el('i', {}, [v.vl + ' ']));
    span.appendChild(el('b', {}, [_hw(v.va)]));
  });
  return span;
}

/* ---- senses ----
 * def → one block per verb divider ("transitive verb"); its sseq is a list
 * of numbered sense groups; each group a list of [kind, data] pairs, where
 * kind is a sense, a truncated sense (sen), a binding substitute (bs) or a
 * parenthesized run of senses (pseq). */

function _def(d) {
  const block = el('div', { class: 'en__def' });
  if (d.vd) block.appendChild(el('div', { class: 'en__vd' }, [d.vd]));
  if (d.sls) block.appendChild(el('div', { class: 'en__lbl' }, [d.sls.join(', ')]));
  (d.sseq || []).forEach(group => {
    const g = el('div', { class: 'en__group' });
    _senseItems(g, group);
    block.appendChild(g);
  });
  return block;
}

function _senseItems(host, items) {
  items.forEach(([kind, data]) => {
    if (kind === 'sense' || kind === 'sen') host.appendChild(_sense(data));
    else if (kind === 'bs') host.appendChild(_sense(data.sense));
    else if (kind === 'pseq') _senseItems(host, data);
  });
}

function _sense(s) {
  s = s || {};
  // A top-level number ("1", "2 a") starts a new line in the margin; a
  // letter or "(1)" is a subsense and sits indented under it.
  const sn = s.sn || '';
  const sub = !!sn && !/^\d/.test(sn);
  const row = el('div', { class: 'en__sense' + (sub ? ' en__sense--sub' : '') }, [
    sn ? el('span', { class: 'en__sn' }, [sn]) : null
  ]);
  const body = el('div', { class: 'en__sbody' });
  row.appendChild(body);

  const pv = s.phrasev ? [].concat(s.phrasev.phr || [])
           : s.sphrasev ? [].concat(s.sphrasev.phrs || []) : [];
  pv.forEach(p => body.appendChild(el('div', { class: 'en__pv' }, [
    p.pvl ? el('i', {}, [p.pvl + ' ']) : null,
    el('b', { html: _fmt(p.pva) })
  ])));
  if (s.sphrasev && s.sphrasev.phsls) {
    body.appendChild(el('i', { class: 'en__lbl' }, [s.sphrasev.phsls.join(', ') + ' ']));
  }
  if (s.bnote) body.appendChild(el('b', { class: 'en__bnote' }, [s.bnote + ' ']));
  const labels = _labels(s);
  if (labels) { body.appendChild(labels); body.appendChild(document.createTextNode(' ')); }
  if (s.ins) { body.appendChild(_inflections(s.ins)); body.appendChild(document.createTextNode(' ')); }
  if (s.vrs) { body.appendChild(_variants(s.vrs)); body.appendChild(document.createTextNode(' ')); }

  (s.dt || []).forEach(x => _dtItem(body, x));
  if (s.sdsense) {
    body.appendChild(el('span', {}, ['; ']));
    body.appendChild(el('i', {}, [s.sdsense.sd + ' ']));
    (s.sdsense.dt || []).forEach(x => _dtItem(body, x));
  }
  return row;
}

/* One element of a defining text, or of a note made of the same parts. */
function _dtItem(host, [kind, data]) {
  if (kind === 'text' || kind === 't') {
    const html = _fmt(data, host.childNodes.length === 0 || kind === 'text');
    if (html.trim()) host.appendChild(el('span', { class: 'en__dt', html }));
  } else if (kind === 'vis') {
    host.appendChild(el('ul', { class: 'en__vis' },
      data.map(v => el('li', { html: _fmt(v.t) + _attribution(v.aq) }))));
  } else if (kind === 'wsgram') {
    host.appendChild(el('div', { class: 'en__gram' }, ['[' + data + ']']));
  } else if (kind === 'uns') {
    // Usage notes: "often used before another noun", with examples.
    data.forEach(note => {
      const n = el('div', { class: 'en__note' }, ['— ']);
      note.forEach(x => _dtItem(n, x));
      host.appendChild(n);
    });
  } else if (kind === 'snote') {
    const n = el('div', { class: 'en__note' });
    data.forEach(x => _dtItem(n, x));
    host.appendChild(n);
  } else if (kind === 'ca') {
    host.appendChild(el('div', { class: 'en__note', html:
      _fmt(data.intro || 'called also') + ' ' +
      (data.cats || []).map(c => '<b>' + _esc(c.cat) + '</b>').join(', ') }));
  } else if (kind === 'ri') {
    data.forEach(r => {
      const x = r[0] === 'riw' ? r[1] : null;
      if (x) host.appendChild(el('b', {}, [' ' + _hw(x.rie) + ' ']));
      else if (r[0] === 'text') host.appendChild(el('span', { html: _fmt(r[1]) }));
    });
  }
}

// Who a quoted example is from: "— Mark Twain, Life on the Mississippi".
function _attribution(aq) {
  if (!aq) return '';
  const parts = [aq.auth, aq.source, aq.aqdate].filter(Boolean).map(s => _fmt(s));
  return parts.length ? ' <span class="en__aq">— ' + parts.join(', ') + '</span>' : '';
}

/* ---- running text ----
 * Merriam-Webster marks up its strings with {tokens}; this turns them into
 * HTML. The text is escaped first, and braces and pipes survive escaping,
 * so the tokens can be matched safely afterwards. `lead` drops the bold
 * colon that opens every definition — on paper it follows the sense
 * number, here the number already sets the definition off. */
function _esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function _fmt(s, lead) {
  if (!s) return '';
  let h = _esc(s);
  // Print-only text ("see color picture on page C5"), then any
  // cross-reference group it leaves empty.
  h = h.replace(/\{p_only\}[\s\S]*?\{\/p_only\}/g, '')
       .replace(/\{dx\}\s*\{\/dx\}/g, '');
  if (lead) h = h.replace(/^\s*\{bc\}\s*/, '');
  h = h
    .replace(/\{bc\}/g, '<b>:</b> ')
    .replace(/\{(\/?)(b|it|inf|sup|sc)\}/g, (_, c, t) =>
      '<' + c + ({ b: 'b', it: 'i', inf: 'sub', sup: 'sup', sc: 'span' }[t]) + '>')
    .replace(/\{ldquo\}/g, '“').replace(/\{rdquo\}/g, '”')
    .replace(/\{lsquo\}/g, '‘').replace(/\{rsquo\}/g, '’')
    .replace(/\{(\/?)(wi|qword|parahw)\}/g, (_, c) => '<' + c + 'i>')
    .replace(/\{(\/?)phrase\}/g, (_, c) => '<' + c + 'b>')
    .replace(/\{gloss\}([\s\S]*?)\{\/gloss\}/g, '<span class="en__gloss">[$1]</span>')
    .replace(/\{dx_def\}([\s\S]*?)\{\/dx_def\}/g, '($1)')
    .replace(/\{(dx|dx_ety|ma)\}([\s\S]*?)\{\/\1\}/g, ' <span class="en__dx">— $2</span>')
    // Cross-references: {a_link|text}, {d_link|text|id}, {sx|text|id|sense},
    // {dxt|text|id|sense} and their kin. The link goes to the target id's
    // word, or the text's when there is no id; "absent:1" means homograph 1.
    .replace(/\{(a_link|d_link|i_link|et_link|mat|sx|dxt)\|([^|}]*)(?:\|([^|}]*))?(?:\|([^|}]*))?\}/g,
      (_, t, text, id, sense) => {
        const word = (id || text).replace(/:\d+$/, '');
        const shown = t === 'sx' || t === 'dxt' ? text.replace(/:\d+$/, '') : text;
        return '<a class="en__xref" href="#" data-word="' + word + '">' + shown + '</a>' +
          (sense ? ' <span class="en__xsn">' + sense + '</span>' : '');
      })
    // References listed one after another come with only a space between
    // them ("see also adam's apple crab apple"); on paper the small capitals
    // set them apart, here a comma does.
    .replace(/<\/a>(\s+)(?=<a class="en__xref")/g, '</a>,$1')
    // Anything not handled above is formatting this view can do without.
    .replace(/\{[^}]*\}/g, '');
  return h;
}

/* A word from elsewhere — the editor's lookup. Only the state is set; the
 * tab looks it up when it renders, as Rime does. */
function search(word) {
  _query = word;
  _scrollTop = 0;
}

window.EnglezaTab = { render, search };

})();
