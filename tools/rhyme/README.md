# Rhyme index build

Generates `data/rhyme-index.json`, the dataset behind the **Rime** tab.
This runs on your machine only — it is not part of the app and nothing here
ships to the browser except the generated JSON.

See `data/RHYME-INDEX-LICENSE.md` for sources, licensing, and attribution.

## Why an offline build

Romanian rhyme means "identical sounds from the last **stressed** vowel
onward", and Romanian never writes stress. So the index must be built from a
source that records it. dexonline's `InflectedForm` table marks the stressed
vowel with an apostrophe (`veșnic'ie`), which is what makes the whole thing
possible.

Two tables are read: `InflectedForm` for the forms and their stress, and
`Lexeme` for each entry's inflection model. The model is what tells a name
from a word — see "Names" below. Definitions are never parsed.

## Rebuilding

1. Download dexonline's officially published dump and extract **only** the
   structural table (this skips the definitions entirely, and avoids ever
   writing the multi-gigabyte decompressed dump to disk):

   ```bash
   curl -sL -o dex-database.sql.gz \
     https://dexonline.ro/static/download/dex-database.sql.gz
   python3 extract-forms.py dex-database.sql.gz hyphenations.txt \
     > forms_typed.txt
   ```

   `extract-forms.py` reads only `InflectedForm` and `Lexeme`, and writes
   `form<TAB>MODEL` lines. It makes two passes over the archive: a mysqldump
   orders tables alphabetically, so every `InflectedForm` row appears before
   the first `Lexeme` row, and resolving `lexemeId` in one pass yields
   nothing at all.

2. Download the spoken-register frequency list:

   ```bash
   curl -sL -o ro_freq.txt \
     https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/ro/ro_50k.txt
   ```

3. Build the written-register frequency list from the Romanian Wikipedia
   dump (see `wikifreq.py` notes below — this takes a while):

   ```bash
   curl -s https://dumps.wikimedia.org/rowiki/latest/rowiki-latest-pages-articles.xml.bz2 \
     | bzcat | python3 wikifreq.py     # writes ro_wiki_freq.txt
   ```

4. Build:

   ```bash
   node --max-old-space-size=4096 \
     tools/rhyme/build-index.js forms_accented.txt ro_freq.txt ro_wiki_freq.txt
   ```

   The Wikipedia list is optional — omit it and the build still works, just
   with subtitle frequencies only.

Needs Node 18+ and roughly 4 GB of heap; the intermediate maps hold ~1.5M
entries.

## Notes for future edits

- `js/ro-phonetics.js` is shared between this script and the browser. If you
  change how phonemes or syllables are derived, **rebuild the index** — a
  mismatch between build-time and query-time analysis produces lookups that
  silently return nothing.
- Stress is stored as a **character offset**, not a syllable number, and the
  app re-inserts the apostrophe before analyzing. That is deliberate:
  `bucurie` only syllabifies as bu-cu-ri-e once the marker is present, so a
  syllable number computed here would not survive the round trip.
- Posting lists are capped (`MAX_EXACT`, `MAX_ASSON`) by frequency rank. The
  UI never shows more than a screenful, and the uncapped lists for common
  endings ran to hundreds of thousands of entries.
- Forms attested in **neither** frequency corpus are dropped at build time,
  not merely ranked last. dexonline lists every inflected form of every
  headword, archaic and regional included, and those were noise as rhyme
  suggestions.
- The two corpora cover different registers and are blended by taking the
  **max** of their per-million rates, not the average. Averaging would
  penalize a word for being missing from one register, which is the exact
  bias the second corpus exists to correct — words like "preamărit" and
  "nemărginit" never appear in film subtitles.

## Current output

~1.5M word forms, 93.6% with attested stress, ~5.3 MB gzipped over the wire.
Loaded lazily the first time the Rime tab is used, never at app boot.

## Names

dexonline includes proper nouns, so without a filter the index fills up with
`mary`, `harry`, `kelly`, `john` and stray English words like `the` and
`new`. They pass the frequency check easily, because film subtitles are full
of them.

Spelling cannot sort this out. An earlier attempt relied on the lowercase
test in `build-index.js` to do it, but `normalize()` lowercases first, so
the test never saw a capital to reject — and capitalization would have been
the wrong signal anyway: `Dumnezeu` and `Crăciun` are capitalized for the
same reason `Kelly` is, and dropping every capitalized-only form removed
20698 words including those two.

The model type sorts it out properly. Dropped are `T` (*temporar*,
provisional entries — where most of the English given names sit), `SP`
(*substantiv propriu*), `I/3` (*nume propriu*), `I/4` (*cuvânt din altă
limbă*) and `I/6` (*abreviere, simbol, siglă*). A spelling goes only when
**every** lexeme sharing it is one of those, which is what saves `crăciun`
(`N/24` as well as `I/3`) and `cruce` (`F/122` as well as `I/3`), while
`george` (`I/3` alone) goes.

`KEEP_NAMES` in `build-index.js` is the single override. This app translates
worship songs, so biblical names are working vocabulary; without the list
`isus`, `hristos`, `ierusalim` and `betleem` all vanish. Add to it if you
hit a gap.

## Syllable division

Two sources, in this order.

**dexonline's `hyphenations` column** wins wherever it has a whole-word
value — about 5700 of the indexed words. It is a dictionary, and checking
against it found 1485 words wrong out of the 6563 it covers, almost all of
them diphthong against hiatus in both directions: `al-bi-an` and `a-fi-on`
where the patterns ran two vowels together, `a-leu-rit` and `a-mia-ză`
where they split a diphthong that holds. Which way a word goes is lexical,
so no rule recovers it.

Most values are fragments rather than whole words, covering only the part
dexonline thought worth recording, and those are used too. A leading hyphen
anchors the fragment to the end of the word (`-ți-e`), a trailing one to the
start (`a-bi-e-`). A fragment fixes its own span, and the rest of the word is
divided separately, as its own string, with the two concatenated. Merging a
fragment into a full-word pattern division instead lets the two disagree at
the seam: for `biospeologic` the fragment `bi-o-` opens a syllable at
`speologic` while the patterns wanted a break after the `s`, leaving a
vowel-less piece that merged the wrong way and gave `bi-os-pe-o-lo-gic`.
Divided on its own, `speologic` gives `spe-o-lo-gic` and `sp` stays the
onset it is. Values hyphenated at both
ends have nothing to anchor them and are skipped.

Fragments roughly double the reach: 5693 words take a whole-word division,
another 5722 a fragment.

A doubled hyphen marks the structural variant (`a-e-ro--trans-port`) and is
skipped, and alternatives separated by commas are tried in order. dexonline
also disagrees with itself on about a dozen words, recording both `cu-ri-e`
and `cu-rie`; the first is taken.

Even so its divisions are not adopted blind. Where it states a division it is
taken as given: `finishImported` applies only the sung-syllable correction
below and a vowel-less guard, and deliberately does **not** enforce one
nucleus per syllable.

That rule counts vowel letters, so it cannot see a word-internal whispered
`i`. `cinci` and `ori` are single syllables (/t͡ʃint͡ʃʲ/, /orʲ/), which makes
`cinci-spre-ze-ce`, `ori-și-ca-re`, `nici-cum` and `cinci-zeci` correct —
running the rule over them produced `cin-ci-spre-ze-ce` and `o-ri-și-ca-re`,
which are not.

**The rospell patterns**, plus the exception layer in `hyphenate.js`, cover
everything else.

`cutPoints` takes the stressed vowel's offset, because a word-final `i` is
whispered in `b'oli` (the noun, one syllable) but a nucleus in `abol'i` and
`bol'i` (the verbs, `a-bo-li`). Nothing in the spelling distinguishes them —
only dexonline's stress marker does.

### Reaching inflected forms

dexonline records divisions against headwords, while the index is mostly
inflected forms — `albie` has one and `albia`, `albii`, `albiile` do not,
though they share the stem where the interesting decision was made. The
third column of `forms_typed.txt` carries each form's headword, and the
division is propagated across the shared prefix; everything past the point
where the two forms diverge is left to the patterns, since that is the
ending. Coverage goes from 11415 words to 39704.

Tested by taking words that have both a headword division and one of their
own, discarding the latter, and checking whether propagation reproduces it:
96.6%, against 83.5% for the patterns alone.

### Line breaks are not sung syllables

dexonline's column is orthographic — it says where a word may break across
a line. That parts company with syllable counting on the whispered final
`i`: `lu-pi`, `o-chi` and `mul-ți` are legitimate breaks but each is one
sung syllable. `mergeWhisperedFinalI` puts them back together, leaving
`zil-nici` alone because its last piece has a nucleus of its own, and
`co-dri` because an obstruent+liquid cluster keeps the `i` syllabic.

### Choosing among homographs

A spelling turns up on several lexemes and they disagree about the stress,
so candidates are scored rather than taking whichever the dump listed
first. An accented form beats an unaccented one; a real lexeme beats a
provisional one, so the name `lup'i` does not set the stress for the noun
`l'upi`; and stress anywhere else beats stress on a final `i`, so the nouns
`'ochi` and `p'omi` win over the infinitives `och'i` and `pom'i`. A verb
with no competing form, like `abol'i`, keeps its final stress and still
divides `a-bo-li`.

### Auditing the rules

dexonline's divisions double as a test set for the hand-written rules, since
they cover words the patterns must also handle. Each rule was ablated —
neutralised in a copy of this file, with the pattern path rescored against
dexonline over the 6562 words it covers whole. Anything that scores better
switched off is not paying for itself.

    splitMultiNucleusPieces   +157      mergeVowellessPieces   +105
    -iune hiatus               +83      placeGlideBoundaries     +9
    final -ua split             +9      phoneticOnsets           +7
    oa diphthong                +2      nici + vowel             +2
    crăciun stem                 0      whispered final -i        0
    ea diphthong               -26      word-initial eu         -16

The two negatives were acted on. The `eu` rule was mine, asserted rather
than checked: dexonline reads word-initial `eu` as hiatus without exception
— `e-u-ro`, `e-u-ro-pean`, `e-u-fo-ric` — and removing the rule fixed 16
words and broke none.

`ea` was mixed, fixing 64 and breaking 38, so it was refined instead of
dropped. The misses were the Latinate `-eal/-ear/-eat` endings; the breaks
were common words like `dea-su-pra`, `dea-ler` and `gea-lău` that the rule
exists to protect. Matching the endings only at the very end of a word
separates them, and an obstruent+liquid guard keeps `a-crea-lă` and
`ne-grea-lă`. Net +32 with 0 regressions.

Coverage is flat across frequency bands — 5.8% of the top 2000 words carry
a dexonline division, 6.7% of the next band, 5.5% beyond — so the test set
is not skewed toward rare vocabulary.

Rerun the ablation after touching any rule here.

## Words with more than one stress

A spelling can be two different words told apart only by where the stress
falls, and they rhyme differently, because the key runs from the stressed
vowel:

    c'asa   the house      cas'a   the verb, to annul
    cop'ii  children       c'opii  copies
    t'orturi cakes         tort'uri tortures
    auz'i   the infinitive a'uzi   the second person

2.48% of the index — 5222 words — carries more than one reading. The build
keeps them all: each contributes its own key, so `casa` appears both among
the rhymes for `c'asă` and among those for `cas'a`. The scoring described
above now only decides which reading leads.

The extras ride in a sparse `vars` list, `<wordId>~<stressOffset+1>~<cuts>`
in base36, since only a fortieth of the vocabulary needs one. The division
is stored per reading too, because it follows the stress: `a-uzi` against
`a-u-zi`.

The Rime tab shows a picker when a word has several, each labelled with its
own division and stressed syllable.

### Ranking the readings

A word's secondary reading is usually its rarer sense — `perfect'ă` is the
verb *a perfecta*, not the everyday adjective — and letting those sit among
ordinary results reads as noise: searching `mo-bi-LĂ` used to turn up
`perfectă`, which rhymes only under a reading almost nobody means.

So each posting list has two tiers, separated by `|`: words that rhyme under
their usual reading, then words that rhyme only under a secondary one. Both
are ranked by frequency at query time and the second is appended after the
first, so nothing is lost — searching the verb reading of `înapoi` leads with
`trebui`, `trăi` and `construi`, and still reaches `voi` and `noi` further
down.
