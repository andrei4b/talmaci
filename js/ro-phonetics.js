/* ro-phonetics.js — Romanian grapheme-to-phoneme, syllable nuclei, and
 * rhyme-key computation. Shared by the browser app AND the offline build
 * script (tools/rhyme/build-index.js), because a word you type has to be
 * analyzed exactly the same way as the indexed words — any divergence
 * between the two silently produces lookups that never match.
 *
 * Romanian rhyme = identical sounds from the last STRESSED vowel onward.
 * Romanian spelling is nearly phonemic, so pronunciation follows from it
 * reliably; stress is the hard part, since it is never written.
 *
 * Stress can arrive three ways, in priority order:
 *   1. An apostrophe before the stressed vowel ("anev'oie"), which is the
 *      format dexonline's InflectedForm table uses. Authoritative.
 *   2. opts.stressIndex, when the caller already knows it (e.g. the user
 *      picked a syllable in the UI).
 *   3. predictStress(), a rule fallback for words absent from the index.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RoPhonetics = api;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* ---------- normalization ----------
 * Romanian has two Unicode spellings of ș/ț: correct comma-below
 * (U+0219/U+021B) and legacy Turkish cedilla (U+015F/U+0163). Real corpora
 * mix them freely, and some are further mangled to ã/þ by a Latin-1 round
 * trip. Left alone, one word indexes under two spellings and splits its own
 * rhyme group, and text typed on a modern keyboard never matches text
 * stored in the legacy form. */
const NORM_MAP = {
  'ş': 'ș', 'Ş': 'ș', 'ţ': 'ț', 'Ţ': 'ț',
  'ã': 'ă', 'Ã': 'ă', 'þ': 'ț', 'Þ': 'ț', 'ª': 'ș', 'º': 'ș',
  'ǎ': 'ă', 'Ǎ': 'ă'
};

function normalize(word) {
  let out = '';
  const s = String(word == null ? '' : word).toLowerCase();
  for (const ch of s) out += NORM_MAP[ch] || ch;
  return out;
}

/* ---------- phoneme inventory ----------
 * Single-char tokens keep emitted rhyme keys small, which matters because
 * the index ships to a phone.
 *   @ = ə (ă)    y = ɨ (â/î)   C = t͡ʃ (ce/ci)   G = d͡ʒ (ge/gi)
 *   S = ʃ (ș)    J = ʒ (j)     Z = t͡s (ț)
 *   j = glide i  w = glide u   ' = palatalization ("i șoptit") */
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', '@', 'y']);

// i ranks below u so both "iu" (iubire) and "ui" (lui) resolve their
// nucleus to u, which is correct in each case.
const SONORITY = { 'a': 5, 'e': 4, 'o': 4, '@': 3, 'y': 3, 'u': 2, 'i': 1 };

const SIMPLE = {
  'a': 'a', 'ă': '@', 'â': 'y', 'î': 'y', 'e': 'e', 'i': 'i', 'o': 'o', 'u': 'u',
  'b': 'b', 'd': 'd', 'f': 'f', 'h': 'h', 'j': 'J', 'k': 'k', 'l': 'l', 'm': 'm',
  'n': 'n', 'p': 'p', 'q': 'k', 'r': 'r', 's': 's', 'ș': 'S', 't': 't', 'ț': 'Z',
  'v': 'v', 'w': 'v', 'y': 'i', 'z': 'z'
};

const OBSTRUENTS = new Set(['p', 'b', 't', 'd', 'k', 'g', 'f', 'v']);
const LIQUIDS = new Set(['l', 'r']);

// After c/g, a following e/i is a silent softener only when one of these
// open vowels comes next. Before "e" it stays syllabic (see toPhonemes).
const SOFTENER_FOLLOWERS = new Set(['a', 'ă', 'â', 'o', 'u']);

// Vowel-letter groups that stay inside ONE syllable. Anything not listed
// here is hiatus and splits ("aer" -> a-er, "poet" -> po-et), which is what
// keeps syllable counts honest.
const TRIPHTHONGS = new Set(['eai','eau','iai','iau','iei','ieu','ioa','iou','oai','eoa','uai','uau']);
const DIPHTHONGS = new Set([
  'ai','au','ăi','ău','âi','âu','ei','eu','ii','oi','ou','ui','iu',
  'ea','eo','ia','ie','io','oa','ua','uă','ue','îi','îu'
]);

function isVowelLetter(ch) { return 'aăâeiîou'.indexOf(ch) >= 0; }

/* Spelling -> phonemes. Returns tokens plus, when the input carried an
 * apostrophe stress marker, the token index of the stressed vowel. */
function toPhonemes(wordNorm) {
  const out = [];
  let stressTokenIdx = -1;
  let pendingStress = false;
  let i = 0;

  while (i < wordNorm.length) {
    const ch = wordNorm[i];

    if (ch === "'") { pendingStress = true; i += 1; continue; }

    // Look ahead PAST any stress marker: dexonline writes the apostrophe
    // before the stressed vowel, which lands inside digraphs like the "ci"
    // of "veșnic'ie". Naive lookahead would miss the digraph entirely.
    let n1 = i + 1;
    while (wordNorm[n1] === "'") n1++;
    let n2 = n1 + 1;
    while (wordNorm[n2] === "'") n2++;
    const next = wordNorm[n1] || '';
    const after = wordNorm[n2] || '';
    const before = out.length;

    // ch/gh before e/i spell hard /k/ and /g/; the h is mute.
    if (ch === 'c' && next === 'h' && (after === 'e' || after === 'i')) {
      out.push('k'); i = n1 + 1;
    } else if (ch === 'g' && next === 'h' && (after === 'e' || after === 'i')) {
      out.push('g'); i = n1 + 1;
    } else if ((ch === 'c' || ch === 'g') && (next === 'e' || next === 'i')) {
      // c/g soften before e/i. That e/i is a silent graphical softener only
      // when an OPEN vowel follows ("ciocan" /Cokan/, "ceas" /Cas/ — which
      // is why "ceas" still rhymes with "pas", both nucleus /a/).
      // Before "e" it stays a full vowel: "veșnicie" is veș-ni-ci-e, not
      // veș-ni-ce, and dropping it collapsed the entire -cie/-gie rhyme
      // class onto a bare /e/.
      out.push(ch === 'c' ? 'C' : 'G');
      // Advance to just past the softener when it's silent, otherwise only
      // past the c/g so the vowel (and any stress marker before it) is
      // still read on the next pass.
      i = SOFTENER_FOLLOWERS.has(after) ? n1 + 1 : i + 1;
    } else if (ch === 'c') { out.push('k'); i += 1; }
    else if (ch === 'g') { out.push('g'); i += 1; }
    else if (ch === 'x') { out.push('k'); out.push('s'); i += 1; }
    else {
      const m = SIMPLE[ch];
      if (m) out.push(m);
      i += 1;
    }

    // Attach a pending stress marker to the first vowel token emitted.
    if (pendingStress && out.length > before) {
      for (let k = before; k < out.length; k++) {
        if (VOWELS.has(out[k])) { stressTokenIdx = k; pendingStress = false; break; }
      }
    }
  }

  return { tokens: out, stressTokenIdx: stressTokenIdx };
}

/* Decides which phonemes are syllable nuclei.
 *
 * Two Romanian-specific rules carry most of the weight:
 *  - Vowel runs are segmented greedily against the diphthong/triphthong
 *    tables above; each segment is one syllable, and within it the most
 *    sonorous vowel is the nucleus while the rest become glides. Segments
 *    that match nothing split, which is how hiatus is handled.
 *  - Word-final "i șoptit": an unstressed final i after a consonant is not
 *    a syllable, just palatalization ("lupi" = 1 syllable, /lup'/). The
 *    exception is after obstruent+liquid, where it stays syllabic
 *    ("codri", "membri" = 2). Getting this wrong would misclassify a huge
 *    share of plurals and 2nd-person verb forms. */
function markNuclei(tokens, wordLettersNorm, stressTokenIdx) {
  if (typeof stressTokenIdx !== 'number') stressTokenIdx = -1;
  const t = tokens.slice();
  const isNucleus = new Array(t.length).fill(false);

  const last = t.length - 1;
  if (last >= 1 && t[last] === 'i') {
    const prev = t[last - 1];
    const prev2 = last >= 2 ? t[last - 2] : null;
    if (VOWELS.has(prev)) {
      t[last] = 'j';                                   // "noi" -> /noj/
    } else if (prev2 && OBSTRUENTS.has(prev2) && LIQUIDS.has(prev)) {
      /* syllabic: "codri" */
    } else {
      t[last] = "'";                                   // "lupi" -> /lup'/
    }
  }

  // Letter-level vowel runs drive the diphthong segmentation, so walk the
  // normalized letters in parallel with the token array.
  const letters = wordLettersNorm.replace(/'/g, '');
  let li = 0;
  let k = 0;
  while (k < t.length) {
    if (!VOWELS.has(t[k])) { k++; continue; }

    let end = k;
    while (end + 1 < t.length && VOWELS.has(t[end + 1])) end++;

    // Collect the corresponding vowel letters for this token run.
    const runLen = end - k + 1;
    let vletters = '';
    let scanned = 0;
    for (let x = li; x < letters.length && scanned < runLen; x++) {
      if (isVowelLetter(letters[x])) { vletters += letters[x]; scanned++; }
    }
    li += vletters.length;

    // Greedy longest match: triphthong, then diphthong, then single vowel.
    let pos = 0, tokPos = k;
    while (pos < runLen) {
      let take = 1;
      const three = vletters.substr(pos, 3);
      const two = vletters.substr(pos, 2);
      if (three.length === 3 && TRIPHTHONGS.has(three)) take = 3;
      else if (two.length === 2 && DIPHTHONGS.has(two)) take = 2;

      function nucleusOf(from, len) {
        let b = from, bs = SONORITY[t[from]] || 0;
        for (let x = from + 1; x < from + len && x < t.length; x++) {
          const s = SONORITY[t[x]] || 0;
          if (s > bs) { b = x; bs = s; }
        }
        return b;
      }

      // An attested stress mark outranks the sonority heuristic. If the
      // marked vowel would otherwise be demoted to a glide, the group is
      // really hiatus, so cut the segment short and let the marked vowel
      // stand as its own syllable. This is exactly what separates
      // "bucur'ie" (bu-cu-ri-e) from "p'iele" (pie-le) — same letters,
      // different syllable counts, told apart only by where the stress sits.
      if (stressTokenIdx >= tokPos && stressTokenIdx < tokPos + take &&
          nucleusOf(tokPos, take) !== stressTokenIdx) {
        take = stressTokenIdx - tokPos + 1;
      }

      let best = nucleusOf(tokPos, take);
      if (stressTokenIdx >= tokPos && stressTokenIdx < tokPos + take) best = stressTokenIdx;
      isNucleus[best] = true;
      for (let x = tokPos; x < tokPos + take && x < t.length; x++) {
        if (x === best) continue;
        t[x] = (t[x] === 'u' || t[x] === 'o') ? 'w' : 'j';
      }
      pos += take; tokPos += take;
    }
    k = end + 1;
  }

  return { tokens: t, isNucleus: isNucleus };
}

function nucleusIndices(isNucleus) {
  const out = [];
  for (let i = 0; i < isNucleus.length; i++) if (isNucleus[i]) out.push(i);
  return out;
}

/* Rule fallback, used only for words missing from the index. Broad
 * defaults: vowel-final -> penultimate, consonant-final -> final. The
 * suffix table overrides those, since derivational suffixes carry stress
 * far more reliably than a word's last letter does. */
const SUFFIX_RULES = [
  ['ică', 3], ['ice', 3], ['icul', 3], ['isem', 3],
  ['țiune', 2], ['siune', 2], ['ziune', 2],
  ['itate', 2], ['ătate', 2], ['tate', 2],
  ['eală', 2], ['ință', 2], ['ime', 2],
  ['toare', 2], ['oare', 2], ['ească', 2], ['ești', 2],
  ['ător', 1], ['tor', 1], ['esc', 1], ['ism', 1], ['ist', 1],
  ['tic', 2], ['nic', 2], ['ic', 2]
];

function predictStress(wordNorm, nucleiCount, tokens) {
  if (nucleiCount <= 1) return 0;
  for (let r = 0; r < SUFFIX_RULES.length; r++) {
    const suf = SUFFIX_RULES[r][0], fromEnd = SUFFIX_RULES[r][1];
    if (wordNorm.length > suf.length && wordNorm.endsWith(suf)) {
      const idx = nucleiCount - fromEnd;
      if (idx >= 0) return idx;
    }
  }
  const lastTok = tokens[tokens.length - 1];
  const consonantFinal = !VOWELS.has(lastTok) && lastTok !== 'j' && lastTok !== 'w';
  if (consonantFinal) return nucleiCount - 1;
  return Math.max(0, nucleiCount - 2);
}

/* ---------- public ---------- */
function analyze(word, opts) {
  const raw = normalize(word);              // may still contain ' marker
  const clean = raw.replace(/'/g, '');
  const g2p = toPhonemes(raw);
  if (!g2p.tokens.length) return null;

  const marked = markNuclei(g2p.tokens, raw, g2p.stressTokenIdx);
  const nuclei = nucleusIndices(marked.isNucleus);
  if (!nuclei.length) return null;

  let stressIdx;
  if (opts && typeof opts.stressIndex === 'number') {
    stressIdx = Math.max(0, Math.min(nuclei.length - 1, opts.stressIndex));
  } else if (g2p.stressTokenIdx >= 0) {
    // Map the marked token to its nucleus. If the marked vowel became a
    // glide (it sat inside a diphthong), fall back to that segment's actual
    // nucleus — the nearest one at or after the marker.
    let idx = nuclei.indexOf(g2p.stressTokenIdx);
    if (idx < 0) {
      idx = 0;
      for (let n = 0; n < nuclei.length; n++) {
        if (nuclei[n] >= g2p.stressTokenIdx) { idx = n; break; }
        idx = n;
      }
    }
    stressIdx = idx;
  } else {
    stressIdx = predictStress(clean, nuclei.length, marked.tokens);
  }

  const start = nuclei[stressIdx];
  const vowelsOnly = [];
  for (let i = start; i < marked.tokens.length; i++) {
    if (marked.isNucleus[i]) vowelsOnly.push(marked.tokens[i]);
  }

  return {
    word: clean,
    phonemes: marked.tokens,
    syllables: nuclei.length,
    stressIndex: stressIdx,
    // Exact rhyme: every phoneme from the stressed nucleus onward.
    exactKey: marked.tokens.slice(start).join(''),
    // Assonance: only the nuclei, so consonants may differ but the vowel
    // music still lines up.
    assonanceKey: vowelsOnly.join('')
  };
}

return {
  normalize: normalize,
  toPhonemes: toPhonemes,
  markNuclei: markNuclei,
  nucleusIndices: nucleusIndices,
  predictStress: predictStress,
  analyze: analyze,
  VOWELS: VOWELS
};

});
