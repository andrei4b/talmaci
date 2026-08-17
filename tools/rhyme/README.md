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
possible; word forms and stress are all that is read from it.

## Rebuilding

1. Download dexonline's officially published dump and extract **only** the
   structural table (this skips the definitions entirely, and avoids ever
   writing the multi-gigabyte decompressed dump to disk):

   ```bash
   curl -s https://dexonline.ro/static/download/dex-database.sql.gz \
     | gunzip -c \
     | grep '^INSERT INTO `InflectedForm`' > InflectedForm.sql
   ```

   Then parse out column 2 (the accent-marked form), one per line, into
   `forms_accented.txt`.

2. Download the frequency list:

   ```bash
   curl -sL -o ro_freq.txt \
     https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/ro/ro_50k.txt
   ```

3. Build:

   ```bash
   node --max-old-space-size=4096 tools/rhyme/build-index.js forms_accented.txt ro_freq.txt
   ```

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
- Words absent from the frequency list keep rank "worst", so rare forms stay
  searchable but never outrank ordinary vocabulary.

## Current output

~1.5M word forms, 93.6% with attested stress, ~5.3 MB gzipped over the wire.
Loaded lazily the first time the Rime tab is used, never at app boot.
