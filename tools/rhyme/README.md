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
start (`a-bi-e-`). A fragment asserts two things and both are applied: where
its internal boundaries fall, and that there are no others across its span —
so a pattern-derived cut inside it is removed. Values hyphenated at both
ends have nothing to anchor them and are skipped.

Fragments roughly double the reach: 5693 words take a whole-word division,
another 5722 a fragment.

A doubled hyphen marks the structural variant (`a-e-ro--trans-port`) and is
skipped, and alternatives separated by commas are tried in order. dexonline
also disagrees with itself on about a dozen words, recording both `cu-ri-e`
and `cu-rie`; the first is taken.

Even so its divisions are not adopted blind. It splits compounds
structurally without marking them — `nici-cum`, `cinci-zeci`, `ori-și-` —
and loanwords on their source-language morphemes (`after-school`), which
leaves syllables holding two nuclei. `enforceOneNucleus` breaks those up,
giving `ni-ci-cum`, `cin-ci-zeci`, `o-ri-și-ca-re`, `af-ter-school`. That
divergence is the whole of the residual disagreement, and it is deliberate.

**The rospell patterns**, plus the exception layer in `hyphenate.js`, cover
everything else.

`cutPoints` takes the stressed vowel's offset, because a word-final `i` is
whispered in `b'oli` (the noun, one syllable) but a nucleus in `abol'i` and
`bol'i` (the verbs, `a-bo-li`). Nothing in the spelling distinguishes them —
only dexonline's stress marker does.
