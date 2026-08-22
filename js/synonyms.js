/* synonyms.js — loads and queries data/synonym-index.json for the Sinonime
 * tab. Mirrors rhyme.js: the index is over a megabyte, so it is fetched the
 * first time somebody actually searches and never at app boot.
 *
 * The index holds three parallel things:
 *   words    words that have at least one synonym, sorted, newline-joined
 *   senses   one line per word: its senses, each a group of synonyms
 *   forms    inflected forms, sorted, each resolving to a word id in formTo
 *
 * A sense carries no gloss. The synonyms come from dexonline's own Relation
 * table, and the text that would explain each sense lives in dictionaries
 * dexonline may not redistribute — see data/SYNONYM-INDEX-LICENSE.md. The
 * groups still stand apart, which is the part that matters: "trist" offers
 * abătut/amărât/mâhnit separately from deprimant/dezolant.
 *
 * `forms` is what makes the tab usable while writing. The relations hold
 * dictionary forms, so "frumoasă" and "mergeau" only find anything because
 * the dexonline dump could map them back to "frumos" and "merge".
 */
(function () {

const INDEX_URL = './data/synonym-index.json';

const SENSE_SEP = '';
const SYN_SEP = '';

let _state = 'idle';        // idle | loading | ready | error
let _error = '';
let _loading = null;

let _words = null;          // StringTable of lemmas
let _senses = null;         // array of raw sense lines, parallel to _words
let _forms = null;          // StringTable of inflected forms
let _formTo = null;         // Int32Array, parallel to _forms
let _foldedWords = null;    // lazily built, for diacritic-insensitive lookup
let _foldedForms = null;

function state() { return _state; }
function errorMessage() { return _error; }

/* A newline-joined blob plus the offset of each entry, so 173k inflected
 * forms cost one big string and one Int32Array instead of 173k separate
 * strings — the same reason rhyme.js does it for its word list. */
function StringTable(raw) {
  const offsets = [0];
  for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) === 10) offsets.push(i + 1);
  return {
    length: offsets.length,
    at(i) {
      const start = offsets[i];
      const end = (i + 1 < offsets.length) ? offsets[i + 1] - 1 : raw.length;
      return raw.slice(start, end);
    }
  };
}

function bisect(table, word) {
  let lo = 0, hi = table.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const w = table.at(mid);
    if (w === word) return mid;
    if (w < word) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}

const FOLD = { 'ă': 'a', 'â': 'a', 'î': 'i', 'ș': 's', 'ț': 't' };
function fold(w) {
  let out = '';
  for (const ch of w) out += FOLD[ch] || ch;
  return out;
}

/* Typing without diacritics is normal on a phone keyboard, so "iubire" has
 * to be reachable as "iubire" and "trăiește" as "traieste".
 *
 * Built lazily, and for the inflected forms as well as the lemmas — that
 * second half is the one that matters in practice, since the word you type
 * while writing is usually inflected. "trăiește" is a form of "trăi", so
 * folding only the lemma list would leave "traieste" unfindable, which is
 * exactly the case this exists for.
 *
 * Stored as an Int32Array of ids ordered by folded key, with the folding
 * redone during the search. Keeping the folded strings instead would mean
 * a second copy of all 173k forms in memory for a fallback most searches
 * never reach. */
function buildFoldedOrder(table) {
  const keys = new Array(table.length);
  const order = new Int32Array(table.length);
  for (let i = 0; i < table.length; i++) { keys[i] = fold(table.at(i)); order[i] = i; }
  const plain = Array.from(order);
  plain.sort((a, b) => (keys[a] < keys[b] ? -1 : keys[a] > keys[b] ? 1 : 0));
  return Int32Array.from(plain);
}

function bisectFolded(table, order, query) {
  const q = fold(query);
  let lo = 0, hi = order.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const f = fold(table.at(order[mid]));
    if (f === q) return order[mid];
    if (f < q) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}

function normalize(s) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/* Resolve a typed word to a word id, and say how it got there so the tab
 * can tell the reader it answered about the lemma rather than silently
 * swapping their word for another. */
function resolve(query) {
  const q = normalize(query);
  if (!q) return null;

  let id = bisect(_words, q);
  if (id >= 0) return { id, via: null };

  const f = bisect(_forms, q);
  if (f >= 0) return { id: _formTo[f], via: 'form' };

  if (!_foldedWords) _foldedWords = buildFoldedOrder(_words);
  const fw = bisectFolded(_words, _foldedWords, q);
  if (fw >= 0) return { id: fw, via: 'diacritics' };

  if (!_foldedForms) _foldedForms = buildFoldedOrder(_forms);
  const ff = bisectFolded(_forms, _foldedForms, q);
  if (ff >= 0) return { id: _formTo[ff], via: 'form' };

  return null;
}

function parseSenses(line) {
  if (!line) return [];
  return line.split(SENSE_SEP)
    .map(part => part.split(SYN_SEP).filter(Boolean))
    .filter(group => group.length);
}

/* Look a word up. Always answers; `found` says whether there was anything
 * to say, and an unknown word is reported as unknown rather than guessed
 * at — the same rule the Rime tab follows. */
function lookup(query) {
  if (_state !== 'ready') return { ok: false, found: false, word: normalize(query) };
  const hit = resolve(query);
  if (!hit) return { ok: true, found: false, word: normalize(query) };
  return {
    ok: true,
    found: true,
    word: _words.at(hit.id),
    typed: normalize(query),
    via: hit.via,
    senses: parseSenses(_senses[hit.id])
  };
}

async function load(onProgress) {
  if (_state === 'ready') return true;
  if (_loading) return _loading;

  _state = 'loading';
  _loading = (async () => {
    try {
      const res = await fetch(INDEX_URL);
      if (!res.ok) throw new Error('HTTP ' + res.status);

      // Streamed so the tab can show real progress; several megabytes over
      // a phone connection is long enough that a bare spinner reads as a
      // hang.
      const total = +(res.headers.get('Content-Length') || 0);
      let text;
      if (res.body && total) {
        const reader = res.body.getReader();
        const chunks = [];
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          got += value.length;
          if (onProgress) onProgress(Math.min(1, got / total));
        }
        const merged = new Uint8Array(got);
        let pos = 0;
        for (const c of chunks) { merged.set(c, pos); pos += c.length; }
        text = new TextDecoder('utf-8').decode(merged);
      } else {
        text = await res.text();
        if (onProgress) onProgress(1);
      }

      const data = JSON.parse(text);
      _words = StringTable(data.words);
      _senses = data.senses.split('\n');
      _forms = StringTable(data.forms);
      const to = data.formTo ? data.formTo.split(',') : [];
      _formTo = new Int32Array(to.length);
      for (let i = 0; i < to.length; i++) _formTo[i] = +to[i];

      _state = 'ready';
      return true;
    } catch (err) {
      _state = 'error';
      _error = err.message || String(err);
      throw err;
    } finally {
      _loading = null;
    }
  })();
  return _loading;
}

window.Synonyms = { load, state, errorMessage, lookup };

})();
