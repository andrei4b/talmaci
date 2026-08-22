# Synonym index build

Generates `data/synonym-index.json`, the dataset behind the **Sinonime**
tab. Runs on your machine only — nothing here ships to the browser except
the generated JSON.

See `data/SYNONYM-INDEX-LICENSE.md` for sources and attribution.

## Rebuilding

```bash
mkdir -p /tmp/rwn/rowordnet
B=https://raw.githubusercontent.com/dumitrescustefan/RoWordNet/master/rowordnet
for f in __init__.py synset.py rowordnet.py exceptions.py rowordnet.pickle; do
  curl -sL -o /tmp/rwn/rowordnet/$f $B/$f
done
python3 tools/synonyms/build-index.py /tmp/rwn/rowordnet/rowordnet.pickle
```

The four `.py` files come along because the data is a Python pickle of
`rowordnet.*` objects: unpickling needs those classes importable, so the
package has to sit next to the pickle rather than the pickle standing
alone.

The second argument is the dexonline forms dump and defaults to
`data/build-inputs/forms_typed.txt.gz`, which the rhyme build already
commits — see `tools/rhyme/README.md`.

### Why this input is not committed

The rhyme build's inputs are committed because re-deriving them means a
378 MB dexonline archive and a multi-gigabyte Wikipedia dump — slow enough
to stand between an edit and its effect. This one is a single 36 MB file
(11 MB gzipped) at a stable URL under a permissive licence, and fetching it
takes seconds. Committing more than the entire rhyme input set to save that
is not the same trade.

## What the build decides

- **Only synsets with more than one literal.** A synset with a single
  literal names a concept but offers no synonym, and 40,583 of RoWordNet's
  59,348 are like that. Keeping them would triple the index to say nothing.
- **Definitions are kept.** A word here averages 1.92 senses, so it usually
  has more than one group of synonyms, and the definition is the only thing
  that distinguishes them — "dragoste" the feeling from "dragoste" the
  person. Costs roughly 0.6 MB gzipped.
- **Inflected forms are resolved.** RoWordNet is keyed by lemma, so
  "frumoasă" and "mergeau" would find nothing on their own. 173,469 forms
  are mapped back to their lemma through the dexonline dump, which is what
  makes the tab usable while actually writing.
- **Multi-word literals are offered but not indexed.** "trăsătură
  psihologică" is a fine synonym to be shown; nobody searches for one.
- **Clitic brackets are unwrapped.** RoWordNet writes `[se] potrivi` and
  `|se| întinde` to mark the clitic as part of the entry. The brackets are
  noise on screen and the clitic belongs, so they become "se potrivi" and
  "se întinde". A leading hyphen is kept — without it `[-și] aminti` reads
  as "și aminti", and "și" alone is the everyday word for "and".

## Notes

- The index is loaded on demand, the first time somebody searches — never
  at app boot. It is 7.0 MB raw, 1.6 MB gzipped.
- Words with no synonym at all are simply absent. The tab reports that
  honestly rather than inventing something, the same rule the Rime tab
  follows for words with no attested stress.
