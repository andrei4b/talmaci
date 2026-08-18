/* hyphenate.js — Liang pattern hyphenation for Romanian. BUILD TIME ONLY.
 *
 * Romanian syllable division cannot be derived from spelling by rule: the
 * same letters divide differently depending on the word ("pie-le" but
 * "su-pe-ri-or"; "cre-ion" but "scri-i-tor"). That knowledge is lexical,
 * and the rospell hyphenation patterns encode it, so we use them instead of
 * guessing phonologically.
 *
 * The patterns are applied here, at build time, and only the resulting cut
 * positions are stored in the index — the browser never downloads them.
 *
 * Patterns: hyph_ro_RO.dic from the LibreOffice `ro` dictionary,
 * GPL 2+ / LGPL 2.1+ / MPL 1.1 tri-licensed (Rospell Team).
 */
'use strict';
const fs = require('fs');

function loadPatterns(dicPath) {
  const pats = new Map();
  const exceptions = new Map();
  const lines = fs.readFileSync(dicPath, 'utf8').split('\n');

  for (let i = 1; i < lines.length; i++) {      // line 0 is the charset
    const ln = lines[i].trim();
    if (!ln || ln.startsWith('%') || ln.startsWith('#')) continue;

    // Explicit exceptions are spelled with '=' and carry no digits.
    if (ln.indexOf('=') >= 0 && !/\d/.test(ln)) {
      exceptions.set(ln.replace(/=/g, ''), ln.split('='));
      continue;
    }

    let letters = '';
    const vals = [];
    let cur = 0;
    for (const c of ln) {
      if (c >= '0' && c <= '9') { cur = +c; }
      else { vals.push(cur); cur = 0; letters += c; }
    }
    vals.push(cur);
    if (letters) pats.set(letters, vals);
  }
  return { pats, exceptions };
}

/* ---- exceptions ----
 * Gaps in the rospell pattern set. Keep these few and justified: the
 * patterns are right far more often than any rule written here, so anything
 * added should be verified against real vocabulary first, not assumed.
 *
 * WORD_EXCEPTIONS is for genuine one-offs, keyed by the whole word with the
 * intended division as the value. Prefer a class rule below when the same
 * gap affects a whole family of words — it is the difference between
 * fixing "lua" and fixing the 48 words that share its shape. */
// Object.create(null), not {}: a plain object inherits Object.prototype, so
// looking up an ordinary Romanian word that happens to share a name with a
// built-in ("constructor" is a word here) would return that function instead
// of undefined and crash the lookup.
const WORD_EXCEPTIONS = Object.create(null);
// e.g. WORD_EXCEPTIONS['cuvant'] = 'cu-vant';

const VOWEL_LETTERS = 'aăâeiîou';
function isVowelCh(c) { return VOWEL_LETTERS.indexOf(c) >= 0; }

/* Applies the exception layer to pattern-derived cuts. */
function applyExceptions(word, cuts) {
  const n = word.length;

  // Word-final "ea" is a rising diphthong and one syllable ("bea", "vrea",
  // "ca-fea", "per-dea"), but the pattern set carries a general "e1a1" rule
  // that would strand the final "a". Only word-final: interior "ea" varies,
  // and joining it everywhere would wreck "re-al".
  if (n >= 2 && word[n - 1] === 'a' && word[n - 2] === 'e') {
    cuts = cuts.filter(c => c !== n - 1);
  }

  // The pattern set has "u1o" but no "u1a", so word-final "u"+"a" hiatus is
  // never split: "lua", "e-va-lua", "po-lua". A blanket u-a rule is wrong
  // though — it would split the definite-article forms ("bas-ma-ua",
  // "an-drea-ua") where "ua" really is one syllable. What separates them is
  // what precedes: a consonant means the u is its own nucleus (lu-a), a
  // vowel means "ua" is the article and stays whole (ma-ua). Verified
  // against the indexed vocabulary: 48 words take the split, 143 keep it.
  if (n >= 3 && word[n - 1] === 'a' && word[n - 2] === 'u' &&
      !isVowelCh(word[n - 3]) && cuts.indexOf(n - 1) < 0) {
    cuts = cuts.concat([n - 1]).sort((x, y) => x - y);
  }

  return cuts;
}

function cutsFromSplit(split) {
  const parts = split.split('-');
  const cuts = [];
  let at = 0;
  for (let i = 0; i < parts.length - 1; i++) { at += parts[i].length; cuts.push(at); }
  return cuts;
}

/* Returns cut offsets into `word`: a new syllable starts at each offset. */
function cutPoints(word, table) {
  const manual = WORD_EXCEPTIONS[word];
  if (manual) return cutsFromSplit(manual);

  const exc = table.exceptions.get(word);
  if (exc) {
    const cuts = [];
    let at = 0;
    for (let i = 0; i < exc.length - 1; i++) { at += exc[i].length; cuts.push(at); }
    return cuts;
  }

  const w = '.' + word + '.';
  const points = new Array(w.length + 1).fill(0);

  for (let i = 0; i < w.length; i++) {
    for (let len = 1; len <= 12 && i + len <= w.length; len++) {
      const seg = w.substr(i, len);
      const vals = table.pats.get(seg);
      if (!vals) continue;
      for (let k = 0; k < vals.length; k++) {
        const p = i + k;
        if (p < points.length && vals[k] > points[p]) points[p] = vals[k];
      }
    }
  }

  // A break before word[c] lives at points[c+1] in the dotted string. Unlike
  // typesetting, single-letter syllables are legitimate here, so no
  // left/right minimum is applied — "veș-ni-ci-e" really does end in a
  // one-letter syllable.
  const cuts = [];
  for (let c = 1; c < word.length; c++) {
    if (points[c + 1] % 2 === 1) cuts.push(c);
  }

  return applyExceptions(word, cuts);
}

function syllables(word, table) {
  const cuts = cutPoints(word, table);
  const out = [];
  let prev = 0;
  for (const c of cuts) { out.push(word.slice(prev, c)); prev = c; }
  out.push(word.slice(prev));
  return out.filter(s => s.length);
}

module.exports = { loadPatterns, cutPoints, syllables };

// CLI: node hyphenate.js <hyph_ro_RO.dic> word [word...]
if (require.main === module) {
  const dic = process.argv[2];
  const table = loadPatterns(dic);
  console.error(`patterns: ${table.pats.size}, exceptions: ${table.exceptions.size}`);
  for (const w of process.argv.slice(3)) {
    console.log(`  ${w.padEnd(14)} -> ${syllables(w, table).join('-')}`);
  }
}
