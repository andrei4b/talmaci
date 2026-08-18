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

  // "ea" is a rising diphthong and one syllable in the overwhelming
  // majority of Romanian words — "bea", "ca-fea", "trea-ba", "chea-mă",
  // "mear-gă", "ur-mea-ză" — but the pattern set carries a general "e1a1"
  // rule that splits it everywhere. So drop the e|a cut by default.
  //
  // Genuine "e-a" hiatus does exist, and it is confined to neologisms built
  // on the re-/cre-/ide- stems, where the "e" closes the stem and the "a"
  // opens the next morpheme: "re-al", "re-a-li-zat", "cre-at", "i-de-al".
  // Those are kept by matching the stem at the word's start, which is where
  // that morpheme boundary always sits. A word like "treaba" shares the
  // letters but not the structure, so it correctly keeps its diphthong.
  for (let i = 0; i + 1 < n; i++) {
    if (word[i] !== 'e' || word[i + 1] !== 'a') continue;
    const isStemHiatus =
      (i === 1 && word.startsWith('rea')) ||
      (i === 2 && (word.startsWith('crea') || word.startsWith('idea')));
    if (!isStemHiatus) cuts = cuts.filter(c => c !== i + 1);
  }

  // "nici" + vowel divides ni-cio / ni-ciun, but the patterns either leave
  // it whole or cut after "nici". Move the boundary to where it belongs.
  if (/^nici[ou]/.test(word)) {
    cuts = cuts.filter(c => c !== 4);
    if (cuts.indexOf(2) < 0) cuts = cuts.concat([2]);
    cuts.sort((x, y) => x - y);
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

/* Enforces the one invariant a syllable cannot violate: it must contain a
 * vowel. Liang patterns assume the left/right hyphen minimums are filtering
 * out marginal breaks; dropping those minimums (needed so "veș-ni-ci-e" can
 * end in a one-letter syllable) also lets through spurious cuts that strand
 * bare consonants — "a-bu-n-da", "ab-sen-te-i-st", "a-bl-e-fa-ri-e".
 *
 * A stranded cluster attaches forwards when the next piece begins with a
 * vowel, so it can serve as that syllable's onset ("bl" + "e" -> "ble"), and
 * backwards otherwise, becoming a coda ("bun" + "dă"). Merging the wrong way
 * would invent impossible syllables like "nda". */
function mergeVowellessPieces(word, cuts) {
  // 'y' counts here: it is not native Romanian, but it carries the nucleus
  // in the loanwords the Wikipedia corpus drags in ("byrd", "bypassul"),
  // and without it those get treated as vowel-less and mangled.
  const VOW = 'aăâeiîouy';
  const hasVowel = s => { for (const c of s) if (VOW.indexOf(c) >= 0) return true; return false; };

  for (let guard = 0; guard < 40; guard++) {
    const parts = [];
    let prev = 0;
    for (const c of cuts) { parts.push(word.slice(prev, c)); prev = c; }
    parts.push(word.slice(prev));

    let bad = -1;
    for (let i = 0; i < parts.length; i++) {
      if (!hasVowel(parts[i])) { bad = i; break; }
    }
    if (bad < 0) return cuts;

    // parts[i] starts at cuts[i-1] and ends at cuts[i].
    // A piece at either end has only one direction available: "b-jornson"
    // and "ch-loris" have nothing to their left, and the piece to their
    // right opens with a consonant, so the vowel test below would strand
    // them forever. Force the only possible merge in those positions.
    const mergeForward = (bad === 0)
      ? true
      : (bad < parts.length - 1) && hasVowel(parts[bad + 1][0] || '');
    const dropIdx = mergeForward ? bad : bad - 1;
    if (dropIdx < 0 || dropIdx >= cuts.length) {
      // Nothing left to merge into (single vowel-less token); give up rather
      // than loop.
      return cuts.slice(0, Math.max(0, cuts.length - 1));
    }
    cuts = cuts.slice(0, dropIdx).concat(cuts.slice(dropIdx + 1));
  }
  return cuts;
}

/* The complement of mergeVowellessPieces: no syllable may contain TWO vowel
 * groups separated by consonants.
 *
 * The rospell patterns have coverage gaps for certain consonant sequences —
 * "op-tim" and "sep-tim" divide correctly but "poftim" does not, because
 * "pt" has patterns and "ft" has none; likewise m+n ("domnilor") and several
 * clusters after ă/â ("pământ", "rămâne", "săptămâni"). Where the patterns
 * are silent, fall back to the standard rules.
 *
 * This only ever splits BETWEEN vowel groups, never inside one, so the
 * diphthong-vs-hiatus decisions made by the patterns and the exception layer
 * above are left untouched. */
function splitMultiNucleusPieces(word, cuts) {
  const VOW = 'aăâeiîouy';
  const isV = c => VOW.indexOf(c) >= 0;
  const OBSTR = 'pbtdcgfv';
  const LIQ = 'lr';

  for (let guard = 0; guard < 40; guard++) {
    const bounds = [0].concat(cuts, [word.length]);
    let added = -1;

    for (let b = 0; b + 1 < bounds.length && added < 0; b++) {
      const start = bounds[b], end = bounds[b + 1];
      const piece = word.slice(start, end);

      // Locate vowel groups within the piece.
      const groups = [];
      for (let i = 0; i < piece.length; i++) {
        if (!isV(piece[i])) continue;
        let j = i;
        while (j + 1 < piece.length && isV(piece[j + 1])) j++;
        groups.push([i, j]);
        i = j;
      }

      // A word-final "i" after a consonant is "i șoptit" — palatalization,
      // not a syllable ("lupi", "a-ici"). Counting it as a nucleus made this
      // split "a-ici" into "a-i-ci". It stays syllabic after an
      // obstruent+liquid cluster, which is why "co-dri" keeps two.
      if (end === word.length && groups.length > 1) {
        const lastG = groups[groups.length - 1];
        if (lastG[0] === lastG[1] && piece[lastG[0]] === 'i' &&
            lastG[0] === piece.length - 1 && lastG[0] > 0 && !isV(piece[lastG[0] - 1])) {
          const c1 = piece[lastG[0] - 1];
          const c2 = lastG[0] >= 2 ? piece[lastG[0] - 2] : '';
          const mutaCumLiquida = LIQ.indexOf(c1) >= 0 && OBSTR.indexOf(c2) >= 0;
          if (!mutaCumLiquida) groups.pop();
        }
      }

      if (groups.length < 2) continue;

      // Consonants between the first two groups decide where the cut goes.
      const cStart = groups[0][1] + 1;
      const cEnd = groups[1][0];          // exclusive
      const cons = piece.slice(cStart, cEnd);
      if (!cons.length) continue;         // adjacent groups: a vowel question, leave it

      let rel;
      if (cons.length === 1) {
        rel = cStart;                                   // V-CV  -> ca-să
      } else if (cons.length === 2) {
        // "ch"/"gh" are single sounds and never split.
        if (cons === 'ch' || cons === 'gh') rel = cStart;
        else if (OBSTR.indexOf(cons[0]) >= 0 && LIQ.indexOf(cons[1]) >= 0) rel = cStart;  // co-dri
        else rel = cStart + 1;                          // V-CCV -> car-te
      } else {
        rel = cStart + 1;                               // V-CCCV -> mun-te
      }

      const abs = start + rel;
      if (abs > start && abs < end && cuts.indexOf(abs) < 0) added = abs;
    }

    if (added < 0) return cuts;
    cuts = cuts.concat([added]).sort((x, y) => x - y);
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

  return mergeVowellessPieces(word, splitMultiNucleusPieces(word, applyExceptions(word, cuts)));
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
