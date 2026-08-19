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

// Vowels that can act as a glide BEFORE the nucleus (rising diphthongs
// like ea/oa/ia/ua). After the nucleus only i/u qualify — see markNuclei.
const GLIDE_ONSETS = new Set(['i', 'u', 'o', 'e']);

function isVowelLetter(ch) { return 'aăâeiîou'.indexOf(ch) >= 0; }

/* Spelling -> phonemes. Returns tokens plus, when the input carried an
 * apostrophe stress marker, the token index of the stressed vowel. */
function toPhonemes(wordNorm) {
  const out = [];
  // Letter offset (into the word WITHOUT stress markers) that each token
  // came from, so syllable boundaries found in phoneme space can be mapped
  // back onto the spelling for display — "cru-ce", not "kru-Ce".
  const src = [];
  let stressTokenIdx = -1;
  let pendingStress = false;
  let i = 0;
  let cleanPos = 0;

  while (i < wordNorm.length) {
    const ch = wordNorm[i];

    if (ch === "'") { pendingStress = true; i += 1; continue; }

    const startClean = cleanPos;
    const startRaw = i;

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

    // Every token emitted this pass starts at the same spelling position.
    for (let k = before; k < out.length; k++) src[k] = startClean;
    // Advance by the letters actually consumed, ignoring stress markers.
    let consumed = 0;
    for (let r = startRaw; r < i; r++) if (wordNorm[r] !== "'") consumed++;
    cleanPos = startClean + consumed;

    // Attach a pending stress marker to the first vowel token emitted.
    if (pendingStress && out.length > before) {
      for (let k = before; k < out.length; k++) {
        if (VOWELS.has(out[k])) { stressTokenIdx = k; pendingStress = false; break; }
      }
    }
  }

  return { tokens: out, stressTokenIdx: stressTokenIdx, src: src };
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

  // A stressed final i is a real syllable, never a glide or a whisper:
  // "su'i" is su-i, not /suj/. Without this guard the rule below would
  // demote it before segmentation ever sees the stress mark.
  const last = t.length - 1;
  if (last >= 1 && t[last] === 'i' && last !== stressTokenIdx) {
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

  // Segment each vowel run around its nucleus. Glide eligibility is
  // DIRECTIONAL, which is the part a symmetric diphthong table cannot
  // express and what made "mântu'ire" come out as 3 syllables:
  //
  //   before the nucleus  glide only if strictly less sonorous, so "plo'aie"
  //                       gives o<a -> glide (ploa-ie) while "mântu'ire"
  //                       gives u=i -> no glide, i.e. hiatus (mân-tu-i-re)
  //   after the nucleus   glide only for i/u, the true semivowels, so
  //                       "v'iu" -> /viw/ but "bucur'ie" keeps e syllabic
  //                       (bu-cu-ri-e) and "d'ouă" keeps ă syllabic (do-uă)
  //
  // An attested stress mark simply picks the nucleus; everything else falls
  // out of the two rules above.
  function glideFor(v) { return (v === 'u' || v === 'o') ? 'w' : 'j'; }

  function segment(from, to, stressIdx) {
    if (from > to) return;

    let nuc;
    if (stressIdx >= from && stressIdx <= to) {
      nuc = stressIdx;
    } else {
      nuc = from;
      let bs = SONORITY[t[from]] || 0;
      for (let x = from + 1; x <= to; x++) {
        const s = SONORITY[t[x]] || 0;
        if (s > bs) { nuc = x; bs = s; }
      }
    }
    isNucleus[nuc] = true;
    const nucSon = SONORITY[t[nuc]] || 0;

    let L = nuc - 1;
    while (L >= from && GLIDE_ONSETS.has(t[L]) && (SONORITY[t[L]] || 0) < nucSon) {
      t[L] = glideFor(t[L]); L--;
    }
    if (L >= from) segment(from, L, -1);

    let R = nuc + 1;
    while (R <= to && (t[R] === 'i' || t[R] === 'u')) {
      t[R] = glideFor(t[R]); R++;
    }
    if (R <= to) segment(R, to, -1);
  }

  let k = 0;
  while (k < t.length) {
    if (!VOWELS.has(t[k])) { k++; continue; }
    let end = k;
    while (end + 1 < t.length && VOWELS.has(t[end + 1])) end++;
    segment(k, end, stressTokenIdx);
    k = end + 1;
  }

  return { tokens: t, isNucleus: isNucleus };
}

/* Splits the spelling into syllables, given the phoneme analysis.
 *
 * Boundary placement follows the standard Romanian rules, deciding by what
 * sits between two nuclei:
 *   V-V     hiatus, split between them          a-er
 *   V-CV    consonant joins the next syllable   ca-să
 *   V-CCV   split between the consonants        car-te
 *           EXCEPT obstruent+liquid, which is indivisible ("muta cum
 *           liquida") and moves as a unit       co-dri, a-flu
 *   V-CCCV  first consonant closes the syllable  mun-te
 * Glides stay with the nucleus they belong to, and a trailing palatalized
 * i ("lupi") is not a syllable at all, so it rides along with the last one.
 *
 * Returns spelling fragments, e.g. ['cru','ce'] — not phonemes. */
function syllabify(cleanWord, tokens, isNucleus, src) {
  const nuclei = [];
  for (let i = 0; i < tokens.length; i++) if (isNucleus[i]) nuclei.push(i);
  if (nuclei.length <= 1) return [cleanWord];

  const cuts = [];   // letter offsets where a new syllable starts
  for (let n = 0; n + 1 < nuclei.length; n++) {
    const a = nuclei[n], b = nuclei[n + 1];

    // Consonants strictly between the two nuclei; glides belong to their
    // own nucleus and never take part in the division.
    const cons = [];
    for (let x = a + 1; x < b; x++) {
      const t = tokens[x];
      if (t === 'j' || t === 'w' || t === "'") continue;
      cons.push(x);
    }

    let cutToken;
    if (cons.length === 0) {
      // Nothing but glides (or nothing at all) between the two nuclei. A
      // glide sitting directly before the next nucleus is that syllable's
      // onset, not the previous syllable's coda — "două" divides do-uă,
      // not dou-ă.
      let g = b;
      while (g - 1 > a && (tokens[g - 1] === 'j' || tokens[g - 1] === 'w')) g--;
      cutToken = g;
    } else if (cons.length === 1) {
      cutToken = cons[0];                 // V-CV
    } else if (cons.length === 2) {
      const c1 = tokens[cons[0]], c2 = tokens[cons[1]];
      cutToken = (OBSTRUENTS.has(c1) && LIQUIDS.has(c2)) ? cons[0] : cons[1];
    } else {
      cutToken = cons[1];                 // three or more: first one closes
    }

    const at = src[cutToken];
    if (typeof at === 'number' && at > 0 && at < cleanWord.length) cuts.push(at);
  }

  const parts = [];
  let prev = 0;
  for (const c of cuts) {
    if (c > prev) { parts.push(cleanWord.slice(prev, c)); prev = c; }
  }
  parts.push(cleanWord.slice(prev));
  return parts.filter(p => p.length);
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

  // A marker on a word-final "-i" after a consonant used to be discarded
  // here, on the grounds that dexonline writes one even where the i is not
  // the nucleus: "lup'i" is /lupʲ/ and "codr'i" is CO-dri.
  //
  // Both of those come from lexemes the index no longer admits — "lup'i" is
  // the name Lupi against the noun "l'upi", "codr'i" likewise against
  // "c'odri" — and where a spelling really does have two readings, the
  // build already prefers the one NOT stressed on a final i, so "d'ormi"
  // leads and "dorm'i" trails it. What the discard actually reached was the
  // "-i" conjugation, whose stress genuinely is final: "adăpost'i",
  // "cit'i", "iub'i", "găs'i". It cost 624 words their rhyme, keying
  // "adăposti" as /ost'/ rather than /i/, so that it matched only words
  // ending in "-osti" instead of every word ending in a stressed "i".
  //
  // The marker is taken at face value. The hyphenator already does the
  // same, which is why "ci-ti" and "a-bo-li" were divided correctly while
  // their rhymes were not.
  const stressTok = g2p.stressTokenIdx;

  const marked = markNuclei(g2p.tokens, raw, stressTok);
  const nuclei = nucleusIndices(marked.isNucleus);
  if (!nuclei.length) return null;

  let stressIdx;
  if (opts && typeof opts.stressIndex === 'number') {
    stressIdx = Math.max(0, Math.min(nuclei.length - 1, opts.stressIndex));
  } else if (stressTok >= 0) {
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

  const parts = syllabify(clean, marked.tokens, marked.isNucleus, g2p.src);

  return {
    word: clean,
    phonemes: marked.tokens,
    syllables: nuclei.length,
    // Spelling split into syllables, for display ("cru", "ce"). Falls back
    // to the whole word if the division and the nucleus count disagree.
    syllableParts: (parts.length === nuclei.length) ? parts : [clean],
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
