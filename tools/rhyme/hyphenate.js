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

// "ravioli" is ra-vi-o-li: the "io" is hiatus, as the patterns already read
// it. dexonline's hyphenation column records "ra-vio-li" for this one word,
// and an entry here overrides that.
WORD_EXCEPTIONS['ravioli'] = 'ra-vi-o-li';

// "ceair" needs no entry any more — splitStressedFinalI divides it.

// "vreo" is one syllable, its "eo" a rising diphthong. By hand because the
// ending gives nothing away: "video" ends the same and is vi-de-o.
WORD_EXCEPTIONS['vreo'] = 'vreo';

// e.g. WORD_EXCEPTIONS['cuvant'] = 'cu-vant';

// Prefixes ending in "o" that keep their hiatus before a vowel-initial stem.
// Full strings, not just the final "o": matching only the last two letters
// would misread "bas-to-a-ne" and "a-na-lo-a-ga" as prefixed.
const O_PREFIXES = ['co', 'auto', 'arheo', 'neo', 'proto', 'termo', 'electro',
  'hidro', 'macro', 'micro', 'foto', 'radio', 'video', 'bio', 'geo', 'paleo',
  'socio', 'psiho'];

// Consonants after which an "i" has no softening role, so the "i" of the
// "-iune" suffix has to be carrying its own nucleus. "c", "g" and "h" are
// deliberately absent — see the suffix rule below.
const IUNE_CONSONANTS = 'țstzxnlvpbdmrfș';

const VOWEL_LETTERS = 'aăâeiîou';
function isVowelCh(c) { return VOWEL_LETTERS.indexOf(c) >= 0; }

/* A stressed final "i" after a vowel carries its own nucleus, so it is a
 * syllable of its own: "tră-i", "ar-cu-i", "chib-zu-i", "con-stru-i",
 * "bi-ne-vo-i", and "î-na-po-i" for the verb "a înapoi".
 *
 * Letter-based grouping cannot see this — it reads "ăi", "ui" and "oi" as
 * one vowel group and leaves the word whole — and the whispered-i rules only
 * ever look at an UNSTRESSED final "i". Nothing can be built around a
 * stressed vowel except a syllable.
 *
 * Applied to imported divisions too, not just pattern-derived ones.
 * dexonline records one division per headword, against its usual reading,
 * so the adverb "înap'oi" gets "î-na-poi" — but the verb "înapo'i" shares
 * that spelling and needs "î-na-po-i". Without this the two readings of a
 * word could differ in stress yet come out looking identical. */
function splitStressedFinalI(word, cuts, stressOffset) {
  const n = word.length;
  if (stressOffset < 1 || stressOffset >= n) return cuts;
  if (!isVowelCh(word[stressOffset])) return cuts;

  // The "u" of "qu" spells no vowel of its own — "te-qui-la", "quick" — so
  // it cannot be the louder neighbour, nor can the run start at it.
  const realVowel = (k) => isVowelCh(word[k]) && !(word[k] === 'u' && word[k - 1] === 'q');
  if (!realVowel(stressOffset) || !realVowel(stressOffset - 1)) return cuts;

  // Within a run of vowels the most sonorous is the nucleus and the rest
  // are glides. A marker on a LESS sonorous one says the run holds two
  // nuclei, so a syllable starts there: "tră-i", "î-na-po-i", "cea-ir",
  // "na-iv", "dru-id", "co-ca-i-nă", where the louder vowel comes first.
  const SONORITY = { 'a': 5, 'e': 4, 'o': 4, 'ă': 3, 'â': 3, 'î': 3, 'u': 2, 'i': 1 };
  const here = SONORITY[word[stressOffset]] || 0;
  let from = stressOffset;
  while (from > 0 && realVowel(from - 1)) from--;
  let louder = false;
  for (let k = from; k < stressOffset; k++) {
    if ((SONORITY[word[k]] || 0) > here) louder = true;
  }
  if (!louder) return cuts;

  // Where a glide sits between the louder vowel and the stressed one, the
  // syllable opens ON the glide, it being that syllable's onset: "haios" is
  // "ha-ios" and "maior" "ma-ior", not "ha-i-os" and "ma-i-or". Putting the
  // cut in the right place to begin with is what lets this run on imported
  // divisions, where there is no later pass to tidy a stranded glide — and
  // where such a pass would wrongly close up "pi-u-it" and "ți-u-i-toa-re".
  let at = stressOffset;
  const prev = word[stressOffset - 1];
  if ((prev === 'i' || prev === 'u') && stressOffset >= 2 &&
      realVowel(stressOffset - 2)) {
    at = stressOffset - 1;
  }

  if (at < 1 || cuts.indexOf(at) >= 0) return cuts;
  return cuts.concat([at]).sort((x, y) => x - y);
}


/* A word ending in "uu" ends in two syllables: "con-ti-nu-u",
 * "am-bi-gu-u", "per-pe-tu-u", "a-si-du-u", "re-zi-du-u".
 *
 * Romanian has no word-final /uw/, so the pair is always hiatus — unlike
 * "ii", whose second half is whispered and closes up ("fa-mi-lii",
 * "co-pii"). Nothing else catches it: the letters are adjacent, so every
 * rule that counts vowel groups reads them as one, and the patterns leave
 * them alone.
 *
 * Applied on both finishing paths, since the division may come from the
 * patterns or from dexonline. */
function splitFinalUU(word, cuts) {
  const n = word.length;
  if (n < 3 || word[n - 1] !== 'u' || word[n - 2] !== 'u') return cuts;
  if (isVowelCh(word[n - 3])) return cuts;      // a longer vowel run, leave it
  if (cuts.indexOf(n - 1) >= 0) return cuts;
  return cuts.concat([n - 1]).sort((x, y) => x - y);
}

function phoneticOnsets(word, cuts) {
  const isV = c => VOWEL_LETTERS.indexOf(c) >= 0;

  return cuts.map(c => {
    if (c < 2 || c >= word.length) return c;
    if (!isV(word[c])) return c;                  // next syllable must open on a vowel
    if (isV(word[c - 1])) return c;               // nothing to move
    if (c >= 3 && word[c - 1] === 'h' &&
        (word[c - 2] === 'c' || word[c - 2] === 'g') && isV(word[c - 3])) {
      return c - 2;                               // the digraph moves whole
    }
    if (isV(word[c - 2])) return c - 1;           // a lone consonant moves over

    // Two consonants between vowels divide BETWEEN them, "cas-tel" and
    // "as-pect". A cut sitting past both of them puts the pair in the coda,
    // which is the structural division: "alt-un-de-va" for "al-tun-de-va".
    // Move it back onto the boundary the cluster actually has. A third
    // consonant means a different rule and is left alone, which is what
    // keeps "trans-mi-te" whole.
    if (c >= 3 && isV(word[c - 3])) {
      const pair = word.slice(c - 2, c);
      const OBSTR = 'pbtdcgfv', LIQ = 'lr';
      if (pair === 'ch' || pair === 'gh' ||
          (OBSTR.indexOf(pair[0]) >= 0 && LIQ.indexOf(pair[1]) >= 0)) {
        return c - 2;                             // muta cum liquida: both onset
      }
      return c - 1;
    }
    return c;
  }).sort((x, y) => x - y);
}

function placeGlideBoundaries(word, cuts) {
  const isV = c => VOWEL_LETTERS.indexOf(c) >= 0;

  const build = cs => {
    const parts = [];
    let prev = 0;
    for (const c of cs) { parts.push(word.slice(prev, c)); prev = c; }
    parts.push(word.slice(prev));
    return parts;
  };

  // Pull a trailing glide forward: "mai|or" -> "ma|ior".
  for (let guard = 0; guard < 40; guard++) {
    const parts = build(cuts);
    let moved = false;
    let at = 0;
    for (let i = 0; i + 1 < parts.length; i++) {
      at += parts[i].length;
      const p = parts[i];
      if (p.length < 2) continue;
      const last = p[p.length - 1];
      if (last !== 'i' && last !== 'u') continue;
      if (!isV(p[p.length - 2])) continue;          // nucleus, not a glide
      const nxt = parts[i + 1];
      if (!isV(nxt[0])) continue;                   // no vowel to be onset of
      // If the next piece already opens with its own glide+vowel pair, it
      // has an onset and this letter belongs where it is: "bi-ciu|ia" must
      // not become "bi-ci|uia".
      if (nxt.length >= 2 && (nxt[0] === 'i' || nxt[0] === 'u') && isV(nxt[1])) continue;
      const k = cuts.indexOf(at);
      if (k < 0 || cuts.indexOf(at - 1) >= 0) continue;
      cuts = cuts.slice(0, k).concat([at - 1], cuts.slice(k + 1));
      moved = true;
      break;
    }
    if (!moved) break;
  }

  // Absorb a glide left stranded as its own piece.
  for (let guard = 0; guard < 40; guard++) {
    const parts = build(cuts);
    let at = 0;
    let drop = -1;
    for (let i = 0; i < parts.length && drop < 0; i++) {
      const p = parts[i];
      if (i > 0 && i + 1 < parts.length && p.length === 1 &&
          (p === 'i' || p === 'u') &&
          isV(parts[i - 1][parts[i - 1].length - 1]) && isV(parts[i + 1][0])) {
        const nxt = parts[i + 1];
        const nextOpensWithGlide =
          nxt.length >= 2 && (nxt[0] === 'i' || nxt[0] === 'u') && isV(nxt[1]);
        // forward -> drop the cut after the glide; backward -> the one before
        drop = nextOpensWithGlide ? at : at + 1;
      }
      at += p.length;
    }
    if (drop < 0) break;
    const k = cuts.indexOf(drop);
    if (k < 0) break;
    cuts = cuts.slice(0, k).concat(cuts.slice(k + 1));
  }

  return cuts;
}

/* A word-final "ii" that follows a VOWEL starts its own syllable: "ca-ii",
 * "pu-ii", "co-pi-ii". The vowel before it cannot be sharing a syllable
 * with two more.
 *
 * After a consonant the pair closes up instead, the second half being
 * whispered: "fa-mi-lii", "co-pii", "u-nii", "o-chii", "bă-ie-ții". Which
 * is why this looks at what precedes rather than at the "ii" alone. */
function splitFinalIIAfterVowel(word, cuts) {
  const n = word.length;
  if (n < 4 || word[n - 1] !== 'i' || word[n - 2] !== 'i') return cuts;
  if (!isVowelCh(word[n - 3])) return cuts;
  if (cuts.indexOf(n - 2) >= 0) return cuts;
  return cuts.concat([n - 2]).sort((x, y) => x - y);
}

/* Applies the exception layer to pattern-derived cuts. */
function applyExceptions(word, cuts, stressOffset, head) {
  const n = word.length;

  // "ea" is a rising diphthong and one syllable in the overwhelming
  // majority of Romanian words — "bea", "ca-fea", "trea-ba", "chea-mă",
  // "mear-gă", "ur-mea-ză" — but the pattern set carries a general "e1a1"
  // rule that splits it everywhere. So drop the e|a cut by default.
  //
  // Genuine "e-a" hiatus does exist. Some of it is the re-/cre-/ide- stems,
  // where the "e" closes the stem and the "a" opens the next morpheme:
  // "re-al", "re-a-li-zat", "cre-at", "i-de-al". Those are matched at the
  // word's start, which is where that boundary always sits. A word like
  // "treaba" shares the letters but not the structure, so it correctly
  // keeps its diphthong.
  //
  // The rest is the Latinate "-eal/-ear/-eat" endings, added after checking
  // this rule against dexonline's own divisions: "a-re-al", "bo-re-al",
  // "mu-ze-al", "bal-ne-ar", "ce-re-a-lă" were all being run together.
  // Matching only at the very end of the word is what keeps "dea-su-pra",
  // "dea-ler", "beat-nic" and "gea-lău" out of it.
  //
  // An obstruent+liquid cluster before the vowels blocks it: "a-crea-lă"
  // and "ne-grea-lă" end the same way as "ce-re-a-lă" but keep the
  // diphthong, "cr" and "gr" being onsets in a way that plain "r" is not.
  const OBSTR = 'pbtdcgfv', LIQ = 'lr';
  for (let i = 0; i + 1 < n; i++) {
    if (word[i] !== 'e' || word[i + 1] !== 'a') continue;
    const mutaCumLiquida = i >= 2 &&
      OBSTR.indexOf(word[i - 2]) >= 0 && LIQ.indexOf(word[i - 1]) >= 0;

    // "ch" and "gh" spell a single /k/ and /g/ with a mute h, so what
    // follows them is the diphthong itself: "ve-gheat", "su-pra-ve-gheat".
    // The obstruent+liquid test above does not catch this, "h" being
    // neither.
    const mutedH = i >= 2 && word[i - 1] === 'h' &&
      (word[i - 2] === 'c' || word[i - 2] === 'g');
    // The stems only mean hiatus when something follows them: "re-a-li-zat"
    // and "re-a-bi-li-ta" are the prefix, but "rea" on its own is the
    // feminine of "rău" and a plain diphthong.
    const reStem = i === 1 && word.startsWith('rea') && word.length > 3;

    // "crea" is not enough either. Forms of "a crea" take the hiatus —
    // "cre-a-re", "cre-at", "cre-a-sem" — while "creadă" belongs to "a
    // crede", "crească" to "a crește", and "creangă" and "creanță" are
    // nouns; all four keep the diphthong. Spelling cannot separate them
    // ("cre-ase" against "creas-că"), so the headword decides: the "a crea"
    // family heads are "crea" itself and its "crea" + r/t/ț derivatives
    // ("creat", "creație", "creator"), which is what leaves "creangă" and
    // "creanță" out. "s" is deliberately not among them — "crease" and
    // "creasem" head on "crea" exactly and need no help, while the noun
    // "creastă" heads on itself and was being pulled in, giving
    // "cre-as-tă" for "creas-tă".
    // The same stem survives a prefix: "re-cre-at", "re-cre-a-re",
    // "pro-cre-at". Those have to be named, because the obstruent+liquid
    // guard above would otherwise block them on the "cr" — the very guard
    // that keeps "a-crea-lă" and "ne-grea-lă" whole, which are built on
    // "a acri" and "a negri" rather than on "a crea".
    const creaAt = word.indexOf('crea');
    const prefixedCrea = /^(re|pro|co)crea/.test(word) && i === creaAt + 2;

    const creaStem = prefixedCrea ||
      (i === 2 && word.startsWith('crea') &&
       (!head || head === 'crea' ||
        (head.startsWith('crea') && 'rtț'.indexOf(head.charAt(4)) >= 0)));

    // The Latinate "-eal/-ear/-eat" adjectives take the hiatus: "a-re-al",
    // "bal-ne-ar", "bo-re-al", "li-ce-al", "nu-cle-ar", "e-le-at".
    //
    // The native "-eală" does NOT. It builds nouns off verbs — "a greși" ->
    // "gre-șea-lă", "a obosi" -> "o-bo-sea-lă", "a opri" -> "o-prea-lă" —
    // and dexonline is consistent about it. Checked against its divisions:
    // of the words ending this way that it records, the 36 hiatus ones are
    // Latinate and only "cereală" ends in "-eală", while all 15 diphthongs
    // are deverbal. So the final "ă" is excluded, and "cereală" comes from
    // dexonline directly anyway.
    //
    // A vowel has to appear earlier in the word as well, which is what
    // keeps the monosyllable "beat" whole; "creat" is excluded here too and
    // handled by creaStem above.
    const tail = word.slice(i);
    const latinateHiatus =
      !mutaCumLiquida && !mutedH &&
      /^ea[lrt](e|i|ul|ului|ele|elor)?$/.test(tail) &&
      /[aăâeiîou]/.test(word.slice(0, i));

    const isStemHiatus =
      reStem ||
      creaStem ||
      (i === 2 && word.startsWith('idea')) ||
      latinateHiatus;
    // Decide, rather than defer. This used only to drop a cut the patterns
    // had already placed, which left the outcome to whether rospell happened
    // to emit one: "gre-șe-a-lă" got a cut and "o-bo-sea-lă" did not, from
    // the same suffix. Where the hiatus is established the boundary is now
    // put in, so "re-cre-at" and "li-ce-al" no longer depend on the pattern
    // set having an opinion.
    if (isStemHiatus) {
      if (cuts.indexOf(i + 1) < 0) cuts = cuts.concat([i + 1]).sort((x, y) => x - y);
    } else {
      cuts = cuts.filter(c => c !== i + 1);
    }
  }

  // "oa" behaves exactly like "ea": a rising diphthong in the overwhelming
  // majority of words — "zboa-ră", "bom-boa-ne", "roa-gă", "pis-toa-le",
  // "boa-be", "răz-boa-ie" — while the patterns split it everywhere.
  //
  // The genuine "o-a" hiatus is compounding: a prefix ending in "o" meeting
  // a vowel-initial stem, as in "co-a-gu-la", "an-ti-co-a-gu-lant",
  // "au-to-a-gre-si-u-ne", "ar-he-o-as-tro-no-mi-a". Matching the prefix
  // where the "o" actually sits (not just at the word's start) is what lets
  // "anticoagulant" keep its hiatus while "coboară" loses its false one —
  // "cobo" does not end in the "co" prefix, it ends in "bo".
  // Verified against the indexed vocabulary: 363 words take the diphthong,
  // 30 the hiatus.
  for (let i = 0; i + 1 < n; i++) {
    if (word[i] !== 'o' || word[i + 1] !== 'a') continue;
    const stem = word.slice(0, i + 1);
    const isPrefixHiatus = O_PREFIXES.some(px => stem.endsWith(px));
    if (!isPrefixHiatus) cuts = cuts.filter(c => c !== i + 1);
  }

  // The learned suffix "-iune" is hiatus: "ac-ți-u-ne", "mi-si-u-ne",
  // "vi-zi-u-ne", "u-ni-u-ne", "ches-ti-u-ne". The patterns run the two
  // vowels together instead ("ac-țiu-ne"), losing a syllable.
  //
  // Restricted to consonants where "i" cannot be doing anything else. After
  // "c" and "g" an "i" may be a softener spelling /t͡ʃ/ and /d͡ʒ/, and whether
  // it also carries a nucleus is lexical, not orthographic: "ru-gă-ciu-ne",
  // "slă-bi-ciu-ne" and "cră-ciun" have a pure softener, while "so-ci-al",
  // "spe-ci-a-le", "e-ner-gi-e" and "ser-vi-ci-ul" have a syllabic "i" in
  // the very same environment. The patterns already carry that knowledge,
  // so the whole c/g/ch family is left to them — which is also what keeps
  // "ni-ciun" and "ran-chiu-ne" intact.
  if (/(iune|iuni|iunea|iunii|iunile|iunilor)$/.test(word)) {
    const i = word.lastIndexOf('iun');
    if (i > 0 && IUNE_CONSONANTS.indexOf(word[i - 1]) >= 0 &&
        cuts.indexOf(i + 1) < 0) {
      cuts = cuts.concat([i + 1]).sort((x, y) => x - y);
    }
  }

  cuts = splitStressedFinalI(word, cuts, stressOffset);

  // The "crăciun" stem keeps its softener: "cră-ciun", and so "cră-ciu-nul",
  // "cră-ciu-nu-lui". The base form and most derivatives are already right
  // ("cră-ciu-na", "cră-ciu-nean", "cră-ciu-ni-ța"), but the forms built on
  // the plain stem plus an ending lost it and came out "cră-ci-u-nul" —
  // the same "ciu" the patterns handle correctly in "ni-ciu-nul". Only the
  // cut between the softener and its vowel needs removing.
  if (word.startsWith('crăciun')) {
    cuts = cuts.filter(c => c !== 5);
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
function splitMultiNucleusPieces(word, cuts, stressOffset, head) {
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
      //
      // A stressed final "i" is always a nucleus, whatever precedes it: no
      // syllable can be built around a palatalization. Spelling alone cannot
      // tell these apart — "b'oli" (the noun, boa-lă's plural) is one
      // syllable while "bol'i" and "abol'i" (the verbs) end on a stressed
      // vowel, so "aboli" is a-bo-li. dexonline's marker is what separates
      // them, so consult it before treating the letter as whispered.
      // Same question as mergeWhisperedFinalI: only a whispered "i" may be
      // discounted. In "spaghetti" it is part of the stem, so "ghetti" holds
      // two nuclei and divides "ghet-ti".
      if (end === word.length && groups.length > 1 &&
          finalIIsWhispered(word, head, stressOffset)) {
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
function cutPoints(word, table, stressOffset, head) {
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

/* Places the syllable boundary around a glide.
 *
 * A vowel-flanked "i"/"u" spells a consonantal glide (/j/, /w/) and can
 * never be a syllable on its own, but the patterns strand it ("bă-i-at",
 * "răz-bo-i-ul") or attach it backwards ("mai-or", "pui-ul", "hai-os").
 *
 * Runs last, on piece boundaries rather than on letters. An earlier attempt
 * worked letter by letter and broke on runs of three or more vowels: in
 * "biciuia" both the "u" and the "i" look vowel-flanked, so the second pass
 * put back the cut the first had removed and left "bi-ci-u-ia". Working on
 * boundaries also means this only ever shifts a cut inside a vowel run, so
 * it cannot strand a consonant or create a second nucleus, and the two
 * invariant passes above stay satisfied.
 *
 * Direction is decided by what the following piece opens with. If its first
 * vowel is its own nucleus ("ul", "at", "or"), the glide is that syllable's
 * onset and moves forward: "răz-bo-iul", "bă-iat", "ma-ior". If it instead
 * opens with its own glide+vowel pair ("ia", "ie", "iat"), the stranded
 * letter closes the syllable before it: "bi-ciu-ia", "chiu-ie",
 * "în-greu-iat", "chi-și-nău-ian".
 *
 * A letter after a consonant is a nucleus, not a glide, so "lu-a", "fi-ul",
 * "scri-i-tor" and "su-pe-ri-or" are left alone. */

/* Gives a single intervocalic consonant to the syllable that follows it.
 *
 * Romanian permits two ways of dividing a word: the phonetic one, and a
 * structural one that respects morpheme boundaries and keeps a prefix-final
 * consonant on the left ("dez-as-tru", "in-e-vi-ta-bil", "con-ex"). The
 * rospell patterns mix the two. This project wants the phonetic division
 * everywhere, because syllables here are sung, not parsed: "de-zas-tru",
 * "i-ne-vi-ta-bil", "co-nex".
 *
 * Applying it uniformly also removes the need to guess which leading
 * letters are a real prefix — a guess that was wrong as often as right,
 * since "canada", "tutun", "rotund" and "grenadă" were being divided
 * "can-a-da", "tut-un", "rot-und" and "gren-a-dă" purely because their
 * opening letters resembled one.
 *
 * Only a lone consonant moves. A cluster keeps its own division
 * ("cas-tel", "mem-bri"), and an intervocalic "ch"/"gh" is a single sound
 * spelled with two letters — no cut in the vocabulary currently falls
 * inside one, and the guard below keeps it that way. */

  return placeGlideBoundaries(word, phoneticOnsets(word,
    mergeVowellessPieces(word,
      splitMultiNucleusPieces(word, applyExceptions(word, cuts, stressOffset, head),
        stressOffset, head))));
}

function syllables(word, table, stressOffset, head) {
  const cuts = cutPoints(word, table, stressOffset, head);
  const out = [];
  let prev = 0;
  for (const c of cuts) { out.push(word.slice(prev, c)); prev = c; }
  out.push(word.slice(prev));
  return out.filter(s => s.length);
}

/* Applies only the structural invariant, for divisions that came from
 * somewhere other than the patterns. dexonline's hyphenation column is
 * authoritative on diphthong against hiatus, so its choices are left alone —
 * but it divides compounds structurally ("nici-cum", "cinci-zeci") and
 * loanwords on their source-language morphemes ("after-school"), leaving
 * syllables with two nuclei. This project wants the phonetic division
 * throughout, so those get broken up: "ni-ci-cum", "cin-ci-zeci". */
/* Borrowings whose final "-i" is part of the stem rather than the Romanian
 * ending, and which nothing in their spelling gives away. "jacuzzi",
 * "confetti" and "spaghetti" are caught by the doubling below and need no
 * entry. Keep this short: the test it stands in for was twice written as a
 * rule and twice wrong, because Romanian has far more words ending in a
 * whispered "-i" than the dictionary has Italian nouns. */
const BORROWED_FINAL_I = new Set([
  'ravioli', 'broccoli', 'zombi', 'safari', 'salami', 'tsunami', 'origami'
]);

/* Is a word-final "i" the whispered Romanian ending, or part of the stem?
 *
 * Whispered, and so no syllable of its own: "lu-pi", "to-tuși", "mâini",
 * "vi-neri", "ac-cepți", "ieri", "sco-ți". This is the ordinary case by a
 * wide margin — plurals, second persons, adverbs, and the invariables.
 *
 * Part of the stem, and so a full vowel: "ja-cuz-zi", "con-fet-ti",
 * "spa-ghet-ti", "ra-vio-li". A consonant doubled immediately before the
 * "i" marks the first three; the rest are listed above, there being no
 * spelling rule that finds them without sweeping up Romanian words too.
 *
 * A stressed final "i" is never whispered — nothing can be built around a
 * stressed vowel except a syllable — which is what keeps the infinitive
 * "dorm'i" as "dor-mi" while the second person "d'ormi" is one syllable. */
function finalIIsWhispered(word, head, stressOffset) {
  const n = word.length;
  if (n < 2 || word[n - 1] !== 'i') return false;
  if (stressOffset === n - 1) return false;
  if (BORROWED_FINAL_I.has(word)) return false;
  if (n >= 3 && word[n - 2] === word[n - 3] &&
      'bcdfglmnprstz'.indexOf(word[n - 2]) >= 0) return false;
  return true;
}

/* Re-attaches a final "i șoptit" that an imported division split off.
 *
 * dexonline's hyphenation column is for breaking lines, not for counting
 * syllables you sing, and the two part company on the whispered final "i":
 * "lu-pi", "o-chi" and "mul-ți" are legitimate places to break a word, but
 * each is a single sung syllable (/lupʲ/, /okʲ/, /multsʲ/). Left alone, they
 * inflate both the division shown in the Rime tab and the syllable count its
 * filter runs on.
 *
 * Only a last piece whose sole vowel IS that final "i" merges back, so
 * "zil-nici" keeps its two syllables — its last piece has a nucleus of its
 * own. A stressed final "i" is a nucleus and stays ("a-bo-li"), and so does
 * one after an obstruent+liquid cluster ("co-dri", "mem-bri"). */
function mergeWhisperedFinalI(word, cuts, stressOffset, head) {
  if (!cuts.length) return cuts;

  // A word-final "y" after a vowel spells the same glide as "i" and belongs
  // to the syllable before it: "gay", "boy", "spray", "cow-boy". It is not
  // in VOWEL_LETTERS, so the patterns can cut in front of it and nothing
  // else puts it back.
  const lastPiece = word.slice(cuts[cuts.length - 1]);
  if (lastPiece === 'y' && isVowelCh(word[word.length - 2])) {
    return cuts.slice(0, -1);
  }

  if (!finalIIsWhispered(word, head, stressOffset)) return cuts;

  // "y" counts as a vowel here, as it does everywhere else in this file: it
  // carries the nucleus in the loanwords the Wikipedia corpus drags in, so
  // "dandyi" and "pennyi" are not a consonant cluster plus a whispered "i".
  const last = word.slice(cuts[cuts.length - 1]);
  if (!/^[^aăâeiîouy]+i$/.test(last)) return cuts;

  const OBSTR = 'pbtdcgfv', LIQ = 'lr';
  if (last.length >= 3 &&
      OBSTR.indexOf(last[last.length - 3]) >= 0 &&
      LIQ.indexOf(last[last.length - 2]) >= 0) return cuts;

  return cuts.slice(0, -1);
}

function enforceOneNucleus(word, cuts, stressOffset, head) {
  return splitFinalIIAfterVowel(word, splitFinalUU(word, mergeWhisperedFinalI(word,
    mergeVowellessPieces(word,
      splitMultiNucleusPieces(word, cuts.slice(), stressOffset, head)),
    stressOffset, head)));
}

/* Finishes a division that came from dexonline rather than the patterns.
 *
 * Deliberately does NOT enforce one nucleus per syllable. That rule counts
 * vowel letters, which is blind to a word-internal whispered "i": "cinci"
 * and "ori" are single syllables (/t͡ʃint͡ʃʲ/, /orʲ/), so dexonline's
 * "cinci-spre-ze-ce", "ori-și-ca-re", "nici-cum" and "cinci-zeci" are
 * right, and running the rule over them produced "cin-ci-spre-ze-ce" and
 * "o-ri-și-ca-re", which are not.
 *
 * dexonline is a dictionary; where it states a division it is taken as
 * given. Only the orthographic-versus-sung corrections are applied, plus
 * the vowel-less guard as a safety net.
 *
 * phoneticOnsets deliberately does NOT run here. It was tried, to pull the
 * odd structural division like "ort-o-gra-fi-e-re" into line, and it
 * reached much further than that: "ke-ny-an" became "ke-nyan" because "y"
 * is not in its vowel set, and the English compounds "hold-up", "hand-out"
 * and "back-up" lost the boundary that is the whole point of them. Where
 * dexonline has looked at a word, its placement stands. */
function finishImported(word, cuts, stressOffset, head) {
  return splitFinalIIAfterVowel(word, splitFinalUU(word,
    mergeWhisperedFinalI(word,
      mergeVowellessPieces(word,
        splitStressedFinalI(word, cuts.slice(), stressOffset)),
      stressOffset, head)));
}

/* The division set by hand for a word, or null. Exported so the build can
 * consult it BEFORE dexonline: an entry here is a considered decision about
 * one word and should outrank everything, including the dictionary. */
function manualCuts(word) {
  const manual = WORD_EXCEPTIONS[word];
  return manual ? cutsFromSplit(manual) : null;
}

module.exports = { loadPatterns, cutPoints, syllables, enforceOneNucleus,
                   finishImported, manualCuts };

// CLI: node hyphenate.js <hyph_ro_RO.dic> word [word...]
if (require.main === module) {
  const dic = process.argv[2];
  const table = loadPatterns(dic);
  console.error(`patterns: ${table.pats.size}, exceptions: ${table.exceptions.size}`);
  for (const w of process.argv.slice(3)) {
    console.log(`  ${w.padEnd(14)} -> ${syllables(w, table).join('-')}`);
  }
}
