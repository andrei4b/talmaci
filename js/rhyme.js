/* rhyme.js — loads the rhyme index and answers rhyme queries.
 *
 * The index is ~5MB gzipped, so it is fetched lazily the first time the
 * Rime tab is opened, never at app boot, and kept in memory afterwards.
 *
 * Memory note: the index holds ~1.5M words. Splitting that into a JS array
 * of 1.5M strings costs well over 100MB once per-string overhead is counted,
 * which is a real risk on a phone. Instead the words stay as ONE newline-
 * joined string plus an Int32Array of offsets (~6MB), and individual words
 * are sliced out on demand. */
(function () {
'use strict';

const INDEX_URL = './data/rhyme-index.json';

let _state = 'idle';        // idle | loading | ready | error
let _error = null;
let _promise = null;

let _raw = null;            // newline-joined words
let _offsets = null;        // Int32Array, start index of each word
let _count = 0;
let _syll = '';
let _spos = '';             // base36 stressed-vowel offset, +1 ('0' = none)
let _exact = null;
let _asson = null;
let _rank = null;           // Map wordId -> frequency rank (attested only)

function state() { return _state; }
function errorMessage() { return _error; }

function wordAt(i) {
  if (i < 0 || i >= _count) return '';
  const start = _offsets[i];
  const end = (i + 1 < _count) ? _offsets[i + 1] - 1 : _raw.length;
  return _raw.slice(start, end);
}

// Words are stored alphabetically precisely so this binary search works —
// it is how a typed word recovers dexonline's real stress instead of
// falling back to a guess.
function findId(word) {
  let lo = 0, hi = _count - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const w = wordAt(mid);
    if (w === word) return mid;
    if (w < word) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}

function decodeDeltas(s) {
  if (!s) return [];
  const parts = s.split(',');
  const out = new Array(parts.length);
  let prev = 0;
  for (let i = 0; i < parts.length; i++) { prev += +parts[i]; out[i] = prev; }
  return out;
}

async function load(onProgress) {
  if (_state === 'ready') return true;
  if (_promise) return _promise;

  _state = 'loading';
  _promise = (async function () {
    try {
      const res = await fetch(INDEX_URL);
      if (!res.ok) throw new Error('HTTP ' + res.status);

      // Stream so the UI can show real progress on a slow connection —
      // a silent multi-megabyte wait reads as a frozen tab.
      const total = +(res.headers.get('Content-Length') || 0);
      let text;
      if (res.body && res.body.getReader && onProgress) {
        const reader = res.body.getReader();
        const chunks = [];
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          onProgress(total ? received / total : 0);
        }
        let merged = new Uint8Array(received), pos = 0;
        for (const c of chunks) { merged.set(c, pos); pos += c.length; }
        text = new TextDecoder('utf-8').decode(merged);
      } else {
        text = await res.text();
      }

      const data = JSON.parse(text);
      _raw = data.words;
      _syll = data.syll;
      _spos = data.spos;
      _exact = data.exact;
      _asson = data.asson;

      // Offsets for slice-on-demand word access.
      _count = data.count;
      _offsets = new Int32Array(_count);
      let idx = 0, at = 0;
      _offsets[idx++] = 0;
      while (idx < _count) {
        at = _raw.indexOf('\n', at);
        if (at < 0) break;
        at += 1;
        _offsets[idx++] = at;
      }

      _rank = new Map();
      let p = 0, r = 0;
      for (const d of data.rank.split(',')) { p += +d; _rank.set(p, r++); }

      _state = 'ready';
      return true;
    } catch (err) {
      _state = 'error';
      _error = err.message || String(err);
      _promise = null;
      throw err;
    }
  })();

  return _promise;
}

/* Analyzes a query word, preferring the index's attested dexonline stress
 * over the rule-based guess. This distinction matters: "inimă" is stressed
 * Í-ni-mă, but the rules would guess i-NI-mă and return a completely wrong
 * rhyme set. */
function analyzeWord(word) {
  const P = window.RoPhonetics;
  const norm = P.normalize(word).replace(/[^a-zăâîșț]/g, '');
  if (!norm) return null;

  if (_state === 'ready') {
    const id = findId(norm);
    if (id >= 0) {
      // Re-insert the apostrophe at the attested offset and analyze THAT,
      // so this follows byte-for-byte the same path the build script used.
      // Passing a bare word plus a nucleus index would silently disagree:
      // "bucurie" only splits as bu-cu-ri-e once the marker is present.
      const off = parseInt(_spos[id], 36);
      const marked = off > 0
        ? norm.slice(0, off - 1) + "'" + norm.slice(off - 1)
        : norm;
      const a = P.analyze(marked);
      if (a) { a.attested = off > 0; a.id = id; }
      return a;
    }
  }
  const a = P.analyze(norm);
  if (a) { a.attested = false; a.id = -1; }
  return a;
}

function rankOf(id) {
  return _rank.has(id) ? _rank.get(id) : Number.MAX_SAFE_INTEGER;
}

/* mode: 'exact' | 'asson'; syllables: 0 = any */
function lookup(word, opts) {
  if (_state !== 'ready') return { ok: false, reason: 'not-loaded' };
  const o = opts || {};
  const a = analyzeWord(word);
  if (!a) return { ok: false, reason: 'unparsable' };

  const mode = o.mode === 'asson' ? 'asson' : 'exact';
  const key = mode === 'asson' ? a.assonanceKey : a.exactKey;

  // A one-vowel assonance key matches essentially every word with that
  // vowel, which is noise rather than a suggestion.
  if (mode === 'asson' && key.length < 2) {
    return { ok: true, analysis: a, results: [], tooBroad: true };
  }

  const table = mode === 'asson' ? _asson : _exact;
  const ids = decodeDeltas(table[key]);

  const wantSyll = o.syllables | 0;
  const out = [];
  for (const idv of ids) {
    if (idv === a.id) continue;
    if (wantSyll && (+_syll[idv]) !== wantSyll) continue;
    out.push(idv);
  }
  out.sort((x, y) => rankOf(x) - rankOf(y));

  // Return everything that matched. The caller decides how much to render;
  // capping here silently hid ~36% of the stored postings, so a word like
  // "nemulțumire" (rank 120 for /ire/) could not be found at all unless a
  // syllable filter happened to promote it into view.
  const limit = o.limit || out.length;
  return {
    ok: true,
    analysis: a,
    tooBroad: false,
    total: out.length,
    results: out.slice(0, limit).map(i => ({
      word: wordAt(i),
      syllables: +_syll[i],
      common: _rank.has(i)
    }))
  };
}

window.Rhyme = {
  load: load,
  state: state,
  errorMessage: errorMessage,
  analyzeWord: analyzeWord,
  lookup: lookup
};

})();
