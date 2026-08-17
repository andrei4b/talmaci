#!/usr/bin/env node
/* build-index.js — turns dexonline's inflected forms + an OpenSubtitles
 * frequency list into the compact rhyme index the app ships.
 *
 * Run:  node tools/rhyme/build-index.js <forms_accented.txt> <ro_freq.txt>
 *
 * Inputs
 *   forms_accented.txt  one dexonline InflectedForm per line, apostrophe
 *                       before the stressed vowel ("anev'oie"). Only word
 *                       forms + stress are read — never definitions.
 *   ro_freq.txt         "word count" per line (hermitdave/FrequencyWords).
 *
 * Output  data/rhyme-index.json
 *   words   newline-joined, ALPHABETICAL. Alphabetical (not frequency)
 *           order matters twice: it lets the app binary-search a typed word
 *           to recover its real dexonline stress instead of guessing, and
 *           shared prefixes compress far better.
 *   stress  stressed-syllable index per word, one char
 *   syll    syllable count per word, one char
 *   rank    delta-encoded word ids ordered most-frequent-first; a word's
 *           position here is its frequency rank. Only corpus-attested words
 *           appear, so the ~1.4M rare forms cost nothing and naturally sort
 *           last.
 *   exact   rhymeKey -> delta-encoded ids (perfect rhyme)
 *   asson   vowelKey -> delta-encoded ids (assonance)
 *
 * Posting lists are truncated to the best MAX_* entries by frequency rank
 * before storage — the UI never shows more than a screenful, and the
 * untruncated lists for common endings ran to hundreds of thousands of
 * entries that were pure payload with no user-visible benefit.
 *
 * Licensing: word forms and stress come from dexonline's officially
 * published database dump, used under the "seturi de date oferite oficial
 * spre utilizare publică" exception in their terms, and redistributed under
 * GPL v2+ (see data/RHYME-INDEX-LICENSE.md). Frequencies are MIT.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const P = require(path.join(__dirname, '..', '..', 'js', 'ro-phonetics.js'));

const MAX_EXACT = 400;   // perfect rhymes kept per key
const MAX_ASSON = 200;   // assonance matches kept per key

const formsPath = process.argv[2];
const freqPath = process.argv[3];
if (!formsPath || !freqPath) {
  console.error('usage: build-index.js <forms_accented.txt> <ro_freq.txt>');
  process.exit(1);
}

/* ---- frequency ---- */
const freq = new Map();
for (const line of fs.readFileSync(freqPath, 'utf8').split('\n')) {
  const sp = line.indexOf(' ');
  if (sp <= 0) continue;
  const w = P.normalize(line.slice(0, sp));
  const n = parseInt(line.slice(sp + 1), 10);
  if (!w || !n) continue;
  freq.set(w, (freq.get(w) || 0) + n);   // merges cedilla/comma spellings
}
console.error(`frequency entries (normalized+merged): ${freq.size}`);

/* ---- analyze every dexonline form ---- */
// Plain Romanian lowercase only: drops proper nouns, abbreviations and
// multi-word expressions, none of which are useful rhyme suggestions.
const OK = /^[a-zăâîșț]+$/;

const rec = new Map();
let scanned = 0, skipped = 0;
for (const lineRaw of fs.readFileSync(formsPath, 'utf8').split('\n')) {
  const line = lineRaw.trim();
  if (!line) continue;
  scanned++;
  const norm = P.normalize(line);
  const clean = norm.replace(/'/g, '');
  if (!OK.test(clean) || clean.length < 2) { skipped++; continue; }
  // ~8% of dexonline forms carry no accent marker, and the same spelling can
  // appear both with and without one. Keeping whichever came first let an
  // unaccented duplicate shadow the accented entry, silently downgrading the
  // word to rule-guessed stress — so only skip when we already have a
  // marked form.
  const existing = rec.get(clean);
  if (existing && existing.spos >= 0) continue;
  if (existing && norm.indexOf("'") < 0) continue;
  let a = null;
  try { a = P.analyze(norm); } catch (e) { /* ignore */ }
  if (!a || !a.exactKey) { skipped++; continue; }

  // Store WHERE the stressed vowel sits as a character offset, not as a
  // nucleus index. The app re-inserts the apostrophe at this offset and
  // runs the identical analyze() path, so query-time and build-time
  // syllabification can never diverge. A nucleus index cannot do that:
  // "bucurie" syllabifies as bu-cu-ri-e only once the marker is present,
  // so an index computed here would point into a different nuclei array
  // than the one the app derives from the bare word.
  const apos = norm.indexOf("'");
  rec.set(clean, { exact: a.exactKey, asson: a.assonanceKey,
                   syll: a.syllables, spos: apos,
                   freq: freq.get(clean) || 0 });
}
console.error(`forms scanned: ${scanned}, usable: ${rec.size}, skipped: ${skipped}`);

/* ---- alphabetical ids ---- */
const words = Array.from(rec.keys()).sort();
const id = new Map();
words.forEach((w, i) => id.set(w, i));

/* ---- frequency ranking ---- */
const attestedWords = words.filter(w => rec.get(w).freq > 0)
                           .sort((a, b) => rec.get(b).freq - rec.get(a).freq);
const rankOf = new Map();
attestedWords.forEach((w, i) => rankOf.set(w, i));
const WORST = Number.MAX_SAFE_INTEGER;
console.error(`attested: ${attestedWords.length}, rare (rank last): ${words.length - attestedWords.length}`);

/* ---- posting lists ---- */
function build(keyName, cap) {
  const map = new Map();
  for (const w of words) {
    const k = rec.get(w)[keyName];
    if (!k) continue;
    let arr = map.get(k);
    if (!arr) { arr = []; map.set(k, arr); }
    arr.push(w);
  }
  const out = {};
  let kept = 0;
  for (const [k, arr] of map) {
    // Keep the most frequent `cap` words, then store them in ascending id
    // order so deltas stay small and positive.
    arr.sort((a, b) => (rankOf.has(a) ? rankOf.get(a) : WORST) -
                       (rankOf.has(b) ? rankOf.get(b) : WORST));
    const top = arr.slice(0, cap).map(w => id.get(w)).sort((x, y) => x - y);
    let prev = 0;
    const deltas = new Array(top.length);
    for (let i = 0; i < top.length; i++) { deltas[i] = top[i] - prev; prev = top[i]; }
    out[k] = deltas.join(',');
    kept += top.length;
  }
  console.error(`  ${keyName}: ${map.size} keys, ${kept} postings kept`);
  return out;
}

const exact = build('exact', MAX_EXACT);
const asson = build('asson', MAX_ASSON);

/* ---- per-word scalars ---- */
const syll = words.map(w => String(Math.min(9, rec.get(w).syll))).join('');
// Base36, offset by one so '0' means "no attested marker, fall back to
// rules". Keeps this to a single character per word.
const spos = words.map(w => {
  const p = rec.get(w).spos;
  return (p < 0 || p > 34) ? '0' : (p + 1).toString(36);
}).join('');

let prev = 0;
const rankDeltas = attestedWords.map(w => { const i = id.get(w); const d = i - prev; prev = i; return d; });

const outDir = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'rhyme-index.json');
fs.writeFileSync(outFile, JSON.stringify({
  version: 3,
  count: words.length,
  words: words.join('\n'),
  syll: syll,
  spos: spos,
  rank: rankDeltas.join(','),
  exact: exact,
  asson: asson
}));
console.error(`wrote ${outFile} (${(fs.statSync(outFile).size / 1048576).toFixed(1)} MB raw)`);
