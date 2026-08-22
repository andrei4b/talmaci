# Synonym index build

Generates `data/synonym-index.json`, the dataset behind the **Sinonime**
tab. Runs on your machine only — nothing here ships to the browser except
the generated JSON.

See `data/SYNONYM-INDEX-LICENSE.md` for sources, licensing, and why the
synonym *dictionaries* in dexonline are not used.

## Rebuilding

The extracted relations are committed, so the usual rebuild needs no
download:

```bash
python3 tools/synonyms/build-index.py data/build-inputs/synonym-pairs.txt.gz
```

That reads `data/build-inputs/forms_typed.txt.gz` and
`data/rhyme-index.json` as well, both already in the repo.

### Re-extracting from the dump

Only needed to pick up a newer dexonline dump.

```bash
curl -sL -o dex-database.sql.gz \
  https://dexonline.ro/static/download/dex-database.sql.gz
python3 tools/synonyms/extract-relations.py dex-database.sql.gz \
  | gzip -9 > data/build-inputs/synonym-pairs.txt.gz
```

The extract is 1.7 MB gzipped against the dump's 378 MB, which is why it is
committed and the dump is not.

## Where the synonyms come from

dexonline's **`Relation`** table — its own structured synonymy, 152,215
synonym relations, the same category of data as the `InflectedForm` table
the rhyme index uses. Not the text of any synonym dictionary: every one of
those is marked `canDistribute = 0` in the dump, and only 2 of dexonline's
113 sources are marked otherwise. `data/SYNONYM-INDEX-LICENSE.md` has the
detail.

Only structural columns are read. From `Meaning` the extractor takes `id`
and `treeId` and nothing else — never `internalRep`, which is the meaning's
text.

## What the build decides

- **Senses stay apart.** Flattening every relation for a word together is
  what makes the results useless: merged, "iubire" is offered next to
  "sedum" and "trist" next to "stachys", because a plant genuinely shares a
  dictionary sense with them. Kept apart, "trist" reads as
  abătut/amărât/mâhnit, then dureros, then deprimant/dezolant.

- **Only the left-hand side of a relation is keyed by its meaning.** A
  relation names the meaning it hangs off, and that meaning belongs to the
  words on one side only. Filing the other side under the same id looks
  even-handed and shatters them — it produced 4.6 groups of 1.7 words each
  where the sense really held five. Nothing is lost: every group appears on
  the left of some relation.

- **Overlapping groups are folded together.** Sharing a word is the
  evidence that two groups are one sense. It cannot merge distinct senses
  unless they already overlap, which is why "trist" keeps its three.

- **Words are filtered to attested vocabulary.** Everything is checked
  against the rhyme index's word list, which is already limited to forms
  attested in a subtitle or Wikipedia corpus. That removes the regional and
  archaic spellings dexonline keeps beside current ones — "amoriu", "amur",
  "melanhonic".

- **Noise models are dropped.** A word whose every inflection model is
  `T`, `SP`, `I/2*`, `I/3`, `I/4` or `I/6` is discarded. `I/2*` matters
  most: it is what dexonline gives Latin binomials, and they survive the
  corpus filter because Wikipedia is full of plant names.

- **Inflected forms resolve to their dictionary form.** 271,970 of them,
  through the dexonline forms dump. The relations hold dictionary forms, so
  "frumoasă" and "mergeau" would otherwise find nothing — and an inflected
  word is what you actually type mid-line.

## Notes

- The index is 6.7 MB raw, 1.3 MB gzipped, loaded on demand the first time
  somebody searches — never at app boot.
- 30,928 words, 1.52 senses each, 3.1 synonyms per sense.
- Senses carry no gloss, because the text that would explain them lives in
  the non-distributable sources. The tab numbers them instead.
- A word with no synonym is simply absent, and the tab says so rather than
  inventing something — the same rule the Rime tab follows for a word with
  no attested stress.
