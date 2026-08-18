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

// One more than the round number actually wanted on screen. A key's posting
// list includes the query word itself (every word rhymes with itself), and
// the app filters it out at lookup time, so storing 401 is what yields 400
// usable suggestions rather than 399.
const MAX_EXACT = 401;   // perfect rhymes kept per key -> 400 shown
const MAX_ASSON = 201;   // assonance matches kept per key -> 200 shown

const H = require(path.join(__dirname, 'hyphenate.js'));

const formsPath = process.argv[2];
const freqPath = process.argv[3];
const wikiFreqPath = process.argv[4];   // optional second corpus
const hyphPath = process.argv[5];       // optional hyph_ro_RO.dic
const dexHyphPath = process.argv[6];    // optional hyphenations.txt
if (!formsPath || !freqPath) {
  console.error('usage: build-index.js <forms_typed.txt> <ro_freq.txt> [ro_wiki_freq.txt] [hyph_ro_RO.dic] [hyphenations.txt]');
  process.exit(1);
}

// Syllable division is looked up from hyphenation patterns rather than
// derived phonologically: "pie-le" vs "su-pe-ri-or" and "cre-ion" vs
// "scri-i-tor" divide differently despite identical letter sequences, which
// no spelling rule can predict. Applied here so the patterns never ship.
let hyphTable = null;
if (hyphPath && fs.existsSync(hyphPath)) {
  hyphTable = H.loadPatterns(hyphPath);
  console.error(`hyphenation patterns: ${hyphTable.pats.size}`);
} else {
  console.error('hyphenation patterns: (not provided — falling back to nucleus counts)');
}

/* ---- frequency ----
 * Two corpora with very different registers. Subtitles capture everyday
 * spoken Romanian; Wikipedia captures written/literary Romanian. Neither
 * alone is adequate here: perfectly ordinary words like "preamărit" or
 * "nemărginit" simply never occur in film dialogue, and were being ranked
 * dead last purely for that.
 *
 * The two corpora are used for DIFFERENT jobs rather than merged into one
 * score:
 *
 *   inclusion — a word is kept if it appears in EITHER corpus, which is
 *               what rescues "preamărit" and "nemărginit";
 *   ranking   — subtitle frequency orders the results, and words found only
 *               in Wikipedia are tiered after all subtitle-attested ones.
 *
 * Ranking deliberately ignores the Wikipedia counts because they are
 * contaminated by markup that survives naive stripping: "categorie" scores
 * 2.25M there (inflated by [[Categorie:...]] links) against 103k for "fie",
 * and tokens like quot/gt/ref/style/align rank in the millions. Blending
 * those rates pushed encyclopedic vocabulary (demografie, etnografie,
 * arheologie) above ordinary words in the results. Subtitle counts have no
 * such contamination, and spoken register is the better match for lyrics
 * anyway. */
function loadFreq(pathname, label) {
  const m = new Map();
  let total = 0;
  if (!pathname || !fs.existsSync(pathname)) {
    console.error(`  ${label}: (not provided)`);
    return { map: m, total: 0 };
  }
  for (const line of fs.readFileSync(pathname, 'utf8').split('\n')) {
    const sp = line.indexOf(' ');
    if (sp <= 0) continue;
    const w = P.normalize(line.slice(0, sp));
    const n = parseInt(line.slice(sp + 1), 10);
    if (!w || !n) continue;
    m.set(w, (m.get(w) || 0) + n);       // merges cedilla/comma spellings
    total += n;
  }
  console.error(`  ${label}: ${m.size} types, ${total} tokens`);
  return { map: m, total: total };
}

console.error('frequency corpora:');
const subs = loadFreq(freqPath, 'subtitles');
const wiki = loadFreq(wikiFreqPath, 'wikipedia');

const PM = 1000000;
function rateOf(src, w) {
  if (!src.total) return 0;
  const n = src.map.get(w);
  return n ? (n / src.total) * PM : 0;
}
// Vocabulary = union of both corpora; ranking is decided later, per tier.
const vocab = new Set();
for (const w of subs.map.keys()) vocab.add(w);
for (const w of wiki.map.keys()) vocab.add(w);
console.error(`  combined vocabulary: ${vocab.size} words`);

/* ---- analyze every dexonline form ---- */
// Plain Romanian letters only: drops abbreviations with periods, hyphenated
// compounds and multi-word expressions.
//
// This deliberately does NOT try to screen out proper nouns. It used to be
// described as doing so, but it never could: P.normalize() lowercases before
// this runs, so "Kelly" arrives as "kelly" and the pattern sees nothing to
// object to. Names are excluded by their dexonline model type instead, below.
const OK = /^[a-zăâîșț]+$/;

// dexonline classifies every lexeme, and the classification separates names
// from words far better than spelling can. Dropped:
//   T   "temporar"           provisional entries — where John, Kelly, Ray,
//                            Londra and the stray English words sit
//   SP  "substantiv propriu" proper nouns proper
//   I/3 "nume propriu"       invariable proper nouns (George, Paris)
//   I/4 "cuvânt din altă limbă"  unnaturalized foreign words (the, and, new)
//   I/6 "abreviere, simbol, siglă"
//
// A spelling is dropped only when EVERY lexeme sharing it is one of these.
// That distinction is the whole point: "crăciun" is N/24 as well as I/3, and
// "cruce" is F/122 as well as I/3, so both survive on the strength of their
// common-noun entry, while "george" has only I/3 and goes. Capitalization
// could not make that call — "Dumnezeu" and "Crăciun" are capitalized for
// the same reason "Kelly" is.
// The one place this project overrides dexonline's classification. The app
// translates worship songs, so biblical names are working vocabulary, not
// noise — but dexonline files them as proper nouns (I/3, SP) exactly like
// "george", and it is right to. Verified against the dump: without this
// list, "isus", "hristos", "ierusalim" and "betleem" all disappear, while
// "duh", "rai", "iad" and "golgota" survive only by the accident of also
// carrying a common-noun lexeme.
//
// Only forms dexonline actually holds are listed; "isuse" and "hristoase"
// are absent from the dump, so there is nothing to keep for them.
const KEEP_NAMES = new Set([
  'isus', 'iisus', 'hristos', 'cristos', 'mesia', 'emanuel',
  'ierusalim', 'betleem', 'galileea', 'sion', 'ghetsimani', 'sinai',
  'egipt', 'israel', 'avraam', 'moise', 'ilie', 'iehova', 'savaot'
]);

function isNameOnly(models) {
  return models.every(m => {
    const slash = m.indexOf('/');
    const type = slash < 0 ? m : m.slice(0, slash);
    const num = slash < 0 ? '' : m.slice(slash + 1);
    return type === 'T' || type === 'SP' ||
           (type === 'I' && (num === '3' || num === '4' || num === '6'));
  });
}

const rec = new Map();
let scanned = 0, skipped = 0;
// Pass 1: collect every model type each spelling is attested with, so the
// name test below can ask about the spelling as a whole rather than one row.
const modelsFor = Object.create(null);   // "constructor" is a Romanian word
for (const lineRaw of fs.readFileSync(formsPath, 'utf8').split('\n')) {
  const line = lineRaw.trim();
  if (!line) continue;
  const tab = line.lastIndexOf('\t');
  if (tab < 0) continue;
  const clean = P.normalize(line.slice(0, tab)).replace(/'/g, '');
  (modelsFor[clean] || (modelsFor[clean] = [])).push(line.slice(tab + 1));
}

let namesDropped = 0;
for (const lineRaw of fs.readFileSync(formsPath, 'utf8').split('\n')) {
  const lineFull = lineRaw.trim();
  if (!lineFull) continue;
  const tab = lineFull.lastIndexOf('\t');
  if (tab < 0) continue;
  const line = lineFull.slice(0, tab);
  scanned++;
  const norm = P.normalize(line);
  const clean = norm.replace(/'/g, '');
  if (!OK.test(clean) || clean.length < 2) { skipped++; continue; }

  const models = modelsFor[clean];
  if (models && isNameOnly(models) && !KEEP_NAMES.has(clean)) { skipped++; namesDropped++; continue; }

  // Forms attested in NEITHER corpus are dropped outright. dexonline lists
  // every inflected form of every headword, including archaic and regional
  // ones, and surfacing those as rhyme suggestions was mostly noise. Tested
  // before analyze() since it rejects the large majority of rows.
  if (!vocab.has(clean)) { skipped++; continue; }
  const subRate = rateOf(subs, clean);
  const wikiRate = rateOf(wiki, clean);

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
                   subRate: subRate, wikiRate: wikiRate });
}
console.error(`forms scanned: ${scanned}, usable: ${rec.size}, skipped: ${skipped}`);
console.error(`  of which names/foreign/abbrev dropped: ${namesDropped}`);

/* ---- alphabetical ids ---- */
const words = Array.from(rec.keys()).sort();
const id = new Map();
words.forEach((w, i) => id.set(w, i));

/* ---- frequency ranking ----
 * Two tiers: words attested in the (clean) subtitle corpus come first,
 * ordered by spoken frequency; Wikipedia-only words follow, ordered by
 * their Wikipedia rate. Tiering rather than blending keeps Wikipedia's
 * markup contamination out of the ordering while still letting it decide
 * membership. Everything here is attested somewhere, so there is no
 * "unknown, ranked last" bucket — those forms were dropped above. */
const rankedWords = words.slice().sort((a, b) => {
  const ra = rec.get(a), rb = rec.get(b);
  const ta = ra.subRate > 0 ? 0 : 1;
  const tb = rb.subRate > 0 ? 0 : 1;
  if (ta !== tb) return ta - tb;
  return ta === 0 ? rb.subRate - ra.subRate : rb.wikiRate - ra.wikiRate;
});
const inSubs = words.filter(w => rec.get(w).subRate > 0).length;
console.error(`  spoken-attested: ${inSubs}, wikipedia-only: ${words.length - inSubs}`);
const rankOf = new Map();
rankedWords.forEach((w, i) => rankOf.set(w, i));
console.error(`ranked vocabulary: ${rankedWords.length}`);

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
    arr.sort((a, b) => rankOf.get(a) - rankOf.get(b));
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

/* ---- dexonline's own syllable divisions ----
 * The patterns derive a division; dexonline records one. Where it does, it
 * wins — it is a dictionary, and checking our output against it found 1485
 * words we split wrongly out of 6563 it covers.
 *
 * Almost all of those are diphthong against hiatus, in both directions:
 * "al-bi-an" and "a-fi-on" where we ran the vowels together, "a-leu-rit"
 * and "a-mia-ză" where we split a diphthong that holds. Which way a given
 * word goes is lexical, so no rule recovers it — only the dictionary does.
 *
 * Values need filtering. Many are fragments covering just the interesting
 * part ("-ți-e", "a-bi-e-"), several list alternatives separated by commas,
 * and a doubled hyphen marks the structural variant ("a-e-ro--trans-port")
 * that this project explicitly does not want. Only whole-word, single-
 * hyphen values that reconstruct the word exactly are taken. */
function loadDexHyphenations(pathname) {
  const map = Object.create(null);     // "constructor" is a Romanian word
  if (!pathname || !fs.existsSync(pathname)) {
    console.error('dexonline hyphenations: (not provided)');
    return map;
  }
  let kept = 0;
  for (const line of fs.readFileSync(pathname, 'utf8').split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const form = P.normalize(line.slice(0, tab)).replace(/'/g, '');
    for (const raw of line.slice(tab + 1).split(',')) {
      const v = P.normalize(raw.trim()).replace(/'/g, '');
      if (!v || v.indexOf('--') >= 0) continue;          // structural variant
      if (v.startsWith('-') || v.endsWith('-')) continue; // partial fragment
      if (v.replace(/-/g, '') !== form) continue;         // must reconstruct
      const cuts = [];
      let at = 0;
      for (const piece of v.split('-').slice(0, -1)) { at += piece.length; cuts.push(at); }
      if (!(form in map)) { map[form] = cuts; kept++; }
      break;
    }
  }
  console.error(`dexonline hyphenations: ${kept} usable whole-word divisions`);
  return map;
}
const dexHyph = loadDexHyphenations(dexHyphPath);

/* ---- per-word scalars ---- */
// Cut offsets per word, base36, one word per line. Syllable counts are
// taken from these rather than from nucleus detection, because the
// phonological pass mis-analyses hiatus in words like "superior" and
// "scriitor" — it turns the i into a glide and undercounts.
let dexUsed = 0;
const cutsPerWord = words.map(w => {
  if (!hyphTable) return '';
  // Pass the stressed vowel's offset: it is the only thing that separates a
  // whispered final "i" from a stressed one, so "b'oli" stays one syllable
  // while "abol'i" divides a-bo-li.
  const fromDex = dexHyph[w];
  const rc = rec.get(w);
  const stress = rc && rc.spos >= 0 ? rc.spos : -1;
  if (fromDex) {
    dexUsed++;
    const fixed = H.enforceOneNucleus(w, fromDex, stress);
    return fixed.filter(c => c > 0 && c < 36).map(c => c.toString(36)).join('');
  }
  const cs = H.cutPoints(w, hyphTable, stress);
  return cs.filter(c => c > 0 && c < 36).map(c => c.toString(36)).join('');
});
const cuts = cutsPerWord.join('\n');
console.error(`  divisions taken from dexonline: ${dexUsed} of ${words.length}`);

const syll = words.map((w, i) => {
  const n = hyphTable ? cutsPerWord[i].length + 1 : rec.get(w).syll;
  return String(Math.min(9, n));
}).join('');
// Base36, offset by one so '0' means "no attested marker, fall back to
// rules". Keeps this to a single character per word.
const spos = words.map(w => {
  const p = rec.get(w).spos;
  return (p < 0 || p > 34) ? '0' : (p + 1).toString(36);
}).join('');

let prev = 0;
const rankDeltas = rankedWords.map(w => { const i = id.get(w); const d = i - prev; prev = i; return d; });

const outDir = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'rhyme-index.json');
fs.writeFileSync(outFile, JSON.stringify({
  version: 4,
  count: words.length,
  words: words.join('\n'),
  syll: syll,
  cuts: cuts,
  spos: spos,
  rank: rankDeltas.join(','),
  exact: exact,
  asson: asson
}));
console.error(`wrote ${outFile} (${(fs.statSync(outFile).size / 1048576).toFixed(1)} MB raw)`);
