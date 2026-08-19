#!/usr/bin/env node
/* verify-index.js — checks data/rhyme-index.json against invariants.
 *
 * Run after every build. Nothing here needs the source corpora, so it is
 * cheap enough to run on any checkout:
 *
 *     node tools/rhyme/verify-index.js [hyphenations.txt]
 *
 * Pass dexonline's hyphenations export as an optional argument to also
 * report agreement with it.
 *
 * Exits non-zero if any hard invariant fails.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const P = require(path.join(__dirname, '..', '..', 'js', 'ro-phonetics.js'));

const indexPath = path.join(__dirname, '..', '..', 'data', 'rhyme-index.json');
const hyphPath = process.argv[2];

const ix = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
const words = ix.words.split('\n');
const cuts = ix.cuts.split('\n');
const syll = ix.syll;
const spos = ix.spos;

const VOWEL_LETTERS = 'aăâeiîou';
const ANY_VOWEL = 'aăâeiîouy';
// Spelling -> the phoneme ro-phonetics emits for it, for the key check.
const VOWEL_PHONEME = { a: 'a', e: 'e', i: 'i', o: 'o', u: 'u',
                        'ă': '@', 'â': 'y', 'î': 'y' };

function partsOf(i) {
  const w = words[i];
  const cs = [];
  for (const ch of cuts[i]) cs.push(parseInt(ch, 36));
  cs.sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const c of cs) {
    if (c > prev && c < w.length) { out.push(w.slice(prev, c)); prev = c; }
  }
  out.push(w.slice(prev));
  return out;
}

const fail = {};
const sample = {};
const warned = {};
const warnSample = {};
function warn(name, word, detail) {
  warned[name] = (warned[name] || 0) + 1;
  if (!warnSample[name]) warnSample[name] = [];
  if (warnSample[name].length < 8) warnSample[name].push(word + (detail ? '  ' + detail : ''));
}
function flag(name, word, detail) {
  fail[name] = (fail[name] || 0) + 1;
  if (!sample[name]) sample[name] = [];
  if (sample[name].length < 6) sample[name].push(word + (detail ? '  ' + detail : ''));
}

/* Every phoneme key must begin at the vowel the stress marker points to.
 *
 * This is the check that would have caught "adăposti" keying on /ost'/
 * while its stress sat on the final "i": the division was right, so no
 * structural invariant noticed, and only the rhymes were wrong.
 *
 * A marker inside a vowel run is allowed to key on any vowel of that run,
 * because a marked letter that turns out to be a glide falls back to its
 * segment's real nucleus — "î-na-poi" may legitimately key on either the
 * "o" or the "i" of "poi". */
function keyStartsAtStress(i) {
  const off = parseInt(spos[i], 36) - 1;
  if (off < 0) return true;                     // no attested marker
  const w = words[i];
  if (off >= w.length) return false;

  let lo = off, hi = off;
  while (lo > 0 && VOWEL_LETTERS.indexOf(w[lo - 1]) >= 0) lo--;
  while (hi + 1 < w.length && VOWEL_LETTERS.indexOf(w[hi + 1]) >= 0) hi++;

  const allowed = new Set();
  for (let k = lo; k <= hi; k++) {
    const ph = VOWEL_PHONEME[w[k]];
    if (ph) allowed.add(ph);
  }
  if (!allowed.size) return true;

  const marked = w.slice(0, off) + "'" + w.slice(off);
  let a = null;
  try { a = P.analyze(marked); } catch (e) { return true; }
  if (!a || !a.exactKey) return true;
  return allowed.has(a.exactKey[0]);
}

for (let i = 0; i < words.length; i++) {
  const w = words[i];
  const ps = partsOf(i);

  if (ps.join('') !== w) flag('pieces do not reconstruct the word', w, ps.join('-'));
  if ((+syll[i]) !== Math.min(ps.length, 9)) {
    flag('syllable count disagrees with the cuts', w, syll[i] + ' vs ' + ps.length);
  }
  for (const p of ps) {
    if (![...p].some(c => ANY_VOWEL.indexOf(c) >= 0)) {
      flag('syllable without a vowel', w, ps.join('-'));
    }
  }
  // Reported, not fatal. A syllable holding two vowel groups is almost
  // always wrong — "fami-li-e" for "fa-mi-li-e" went unseen for want of
  // this check — but a whispered "i" can legitimately leave one, as in the
  // compound "cinci-spre-ze-ce", so it is a list to read rather than a
  // failure to stop on.
  for (const p of ps) {
    let groups = 0;
    for (let k = 0; k < p.length; k++) {
      if (ANY_VOWEL.indexOf(p[k]) < 0) continue;
      let j = k;
      while (j + 1 < p.length && ANY_VOWEL.indexOf(p[j + 1]) >= 0) j++;
      groups++; k = j;
    }
    if (groups > 1 && !(p.length > 1 && p[p.length - 1] === 'i' &&
                        ANY_VOWEL.indexOf(p[p.length - 2]) < 0)) {
      warn('syllable with two vowel groups', w, ps.join('-'));
    }
  }

  if (!keyStartsAtStress(i)) {
    const off = parseInt(spos[i], 36) - 1;
    const a = P.analyze(w.slice(0, off) + "'" + w.slice(off));
    flag('rhyme key does not start at the stressed vowel', w,
         'stress on "' + w[off] + '" but key is /' + (a && a.exactKey) + '/');
  }
}

/* Secondary stress readings */
let varN = 0;
if (ix.vars) {
  for (const entry of ix.vars.split(';')) {
    if (!entry) continue;
    varN++;
    const bits = entry.split('~');
    const wid = parseInt(bits[0], 36);
    const w = words[wid];
    if (!w) { flag('secondary reading points at no word', entry); continue; }
    const off = parseInt(bits[1], 36);
    if (!(off > 0 && off <= w.length)) {
      flag('secondary reading has an impossible stress offset', w, entry);
      continue;
    }
    const cs = [];
    for (const ch of bits[2] || '') cs.push(parseInt(ch, 36));
    cs.sort((a, b) => a - b);
    const out = [];
    let prev = 0;
    for (const c of cs) { if (c > prev && c < w.length) { out.push(w.slice(prev, c)); prev = c; } }
    out.push(w.slice(prev));
    if (out.join('') !== w) flag('secondary reading cuts do not reconstruct the word', w, entry);
  }
}

console.log(`index version ${ix.version}, ${words.length} words, ` +
            `${varN} secondary readings`);
for (const n of Object.keys(warned)) {
  console.log(`  warn  ${n}: ${warned[n]}`);
  for (const s of warnSample[n]) console.log(`          ${s}`);
}
const names = Object.keys(fail);
if (!names.length) {
  console.log('all invariants hold');
} else {
  for (const n of names) {
    console.log(`  FAIL  ${n}: ${fail[n]}`);
    for (const s of sample[n]) console.log(`          ${s}`);
  }
}

/* Optional: agreement with dexonline's own divisions. Reported, never fatal
 * — the two differ on purpose where dexonline divides a compound
 * structurally ("cinci-spre-ze-ce") or breaks a line on a whispered "-i". */
if (hyphPath && fs.existsSync(hyphPath)) {
  const id = new Map();
  words.forEach((w, i) => id.set(w, i));
  let cmp = 0, agree = 0;
  for (const line of fs.readFileSync(hyphPath, 'utf8').split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const form = P.normalize(line.slice(0, tab)).replace(/'/g, '');
    if (!id.has(form)) continue;
    const alts = line.slice(tab + 1).split(',')
      .map(x => P.normalize(x.trim()).replace(/'/g, ''))
      .filter(v => v && v.indexOf('--') < 0 && !v.startsWith('-') &&
                   !v.endsWith('-') && v.replace(/-/g, '') === form);
    if (!alts.length) continue;
    cmp++;
    if (alts.includes(partsOf(id.get(form)).join('-'))) agree++;
  }
  if (cmp) {
    console.log(`dexonline agreement: ${agree}/${cmp} ` +
                `(${(100 * agree / cmp).toFixed(1)}%)`);
  }
}

process.exit(names.length ? 1 : 0);
