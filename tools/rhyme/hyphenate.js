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

/* Returns cut offsets into `word`: a new syllable starts at each offset. */
function cutPoints(word, table) {
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

  // The pattern set carries a general "e1a1" rule, which is right for
  // hiatus ("re-al", "a-le-a") but wrong for the rising diphthong "ea".
  // Word-finally, "ea" is reliably a diphthong and one syllable — "bea",
  // "vrea", "ca-fea", "per-dea" — so drop a cut that would strand that
  // final "a". Restricted to word-final position on purpose: interior "ea"
  // can go either way, and blanket-joining it would wreck "re-al".
  const last = word.length - 1;
  if (last >= 1 && word[last] === 'a' && word[last - 1] === 'e') {
    return cuts.filter(c => c !== last);
  }
  return cuts;
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
