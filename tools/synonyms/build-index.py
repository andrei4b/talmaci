#!/usr/bin/env python3
"""build-index.py — generates data/synonym-index.json for the Sinonime tab.

BUILD TIME ONLY. Reads the synonym relations extract-relations.py pulled out
of the dexonline dump, plus the dexonline forms dump the rhyme build already
commits, and writes a compact index.

Three things happen here, and the tab is unusable without any of them:

**Grouping by sense.** Every relation hangs off one meaning, and flattening
them together is what turns a useful answer into mush: merged across senses,
"iubire" picks up "Sedum" and "trist" picks up "Stachys", because somewhere
a plant shares a sense with them. Grouped, "trist" reads as three clean sets
— abătut/amărât/mâhnit, dureros, deprimant/dezolant.

**Filtering to attested vocabulary.** dexonline records regional and archaic
spellings beside current ones, so a raw sense offers "amoriu", "amur" and
"melanhonic" next to "amor". Every word is checked against the rhyme index's
list, which is already filtered to forms attested in a subtitle or Wikipedia
corpus; that is what removes them, along with the Latin plant taxonomy
("Sedum", "carpaticum") no Romanian corpus contains.

**Resolving inflected forms.** The relations hold dictionary forms, so
"frumoasă" and "mergeau" would find nothing on their own — and an inflected
word is what you actually type mid-line.

Run:
  python3 tools/synonyms/build-index.py \\
    data/build-inputs/synonym-pairs.txt.gz [forms_typed.txt.gz]
"""
import collections
import gzip
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, 'data', 'synonym-index.json')

SENSE_SEP = chr(0x1f)   # between the senses of one word
SYN_SEP = chr(0x1d)     # between the synonyms of one sense


def open_maybe_gz(path):
    if path.endswith('.gz'):
        return gzip.open(path, 'rt', encoding='utf-8')
    return open(path, encoding='utf-8')


def attested_vocabulary():
    """The rhyme index's word list: every form attested in one of the two
    frequency corpora. Reused here so both tabs agree on what counts as a
    word somebody might actually write."""
    path = os.path.join(ROOT, 'data', 'rhyme-index.json')
    with open(path, encoding='utf-8') as fh:
        return set(json.load(fh)['words'].split('\n'))


def is_noise_model(model):
    """Models that mark an entry as not an ordinary Romanian word.

    T and SP are the rhyme build's own noise set (see isNoiseModel there),
    and I/3, I/4, I/6 with them. I/2 is added here and matters a great deal:
    it is the model dexonline gives Latin binomials, and a synonym list is
    where they surface. "iubire" was offering "sedum" and "carpaticum", and
    "lumină" was offering "myosotis" and "saxifraga", because a plant
    genuinely shares a dictionary sense with them. They survive the corpus
    filter because Wikipedia is full of plant names.
    """
    kind, _, number = model.partition('/')
    if kind in ('T', 'SP'):
        return True
    return kind == 'I' and (number in ('3', '4', '6') or number.startswith('2'))


def load_noise_words(forms_path):
    """Words whose every model is noise. A word with even one ordinary
    model is kept: "amor" is I/3 and N/24, and the N/24 is what it is."""
    models = collections.defaultdict(set)
    with gzip.open(forms_path, 'rt', encoding='utf-8') as fh:
        for line in fh:
            cols = line.rstrip('\n').split('\t')
            if len(cols) < 2:
                continue
            models[cols[0].replace("'", '').lower()].add(cols[1])
    return {w for w, ms in models.items() if ms and all(is_noise_model(m) for m in ms)}


def merge_overlapping(sets):
    """Fold together sense groups that share a word.

    A relation names the meaning it hangs off, but only for the word on its
    left; the word on the right is grouped by that same id, which is not an
    id of any sense of its own. So a word reached from several directions
    comes out with its one sense split across several ids — 4.6 groups of
    1.7 words each, where the sense really holds five or six.

    Sharing a word is the evidence that two groups are the same sense. It
    cannot merge genuinely different senses unless they already overlap:
    "trist" keeps abătut/amărât/mâhnit, dureros and deprimant/dezolant
    apart, because no word appears in two of them.
    """
    merged = []
    for s in sets:
        hits = [m for m in merged if m & s]
        if not hits:
            merged.append(set(s))
            continue
        keep = hits[0]
        keep |= s
        for other in hits[1:]:
            keep |= other
            merged.remove(other)
    return merged, len(sets) - len(merged)


def main():
    if len(sys.argv) < 2:
        sys.exit('usage: build-index.py <synonym-pairs.txt.gz> [forms_typed.txt.gz]')
    pairs_path = sys.argv[1]
    forms_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        ROOT, 'data', 'build-inputs', 'forms_typed.txt.gz')

    vocab = attested_vocabulary()
    print('attested vocabulary: %d forms' % len(vocab))
    noise = load_noise_words(forms_path)
    print('words dropped as names/foreign/taxonomy: %d' % len(noise))
    vocab -= noise

    groups = collections.defaultdict(lambda: collections.defaultdict(set))
    lines = 0
    with open_maybe_gz(pairs_path) as fh:
        for line in fh:
            cols = line.rstrip('\n').split('\t')
            if len(cols) != 3:
                continue
            lines += 1
            meaning_id = cols[0]
            left = [w for w in cols[1].split(',') if w in vocab]
            right = [w for w in cols[2].split(',') if w in vocab]
            # Only the left-hand words are keyed by this meaning, because
            # it is a meaning OF THEM. Filing the right-hand words under it
            # too seems fair but shatters them: that id names no sense of
            # theirs, so a word reached from six directions came out with
            # six groups of two instead of one group of seven.
            #
            # Nothing is lost by it. Every tree appears on the left of some
            # relation, so a word gets its own senses from those, and the
            # words sharing its tree are added below as synonyms in their
            # own right.
            for a in left:
                bucket = groups[a][meaning_id]
                bucket.update(b for b in right if b != a)
                bucket.update(o for o in left if o != a)
    print('relation lines read: %d' % lines)

    words, senses_out = [], []
    merged_away = 0
    for word in sorted(groups):
        sets = [s for s in groups[word].values() if s]
        sets, n = merge_overlapping(sets)
        merged_away += n
        if not sets:
            continue
        # Biggest sense first: it is the likeliest reading of the word
        # somebody typing it had in mind.
        sets.sort(key=len, reverse=True)
        words.append(word)
        senses_out.append(SENSE_SEP.join(SYN_SEP.join(sorted(s)) for s in sets))

    index = {w: i for i, w in enumerate(words)}
    total = sum(s.count(SENSE_SEP) + 1 for s in senses_out)
    syns = sum(s.count(SYN_SEP) + s.count(SENSE_SEP) + 1 for s in senses_out)
    print('words with synonyms: %d' % len(words))
    print('senses: %d (%.2f per word), %.1f synonyms per sense'
          % (total, total / len(words), syns / total))
    print('groups folded into another sense: %d' % merged_away)

    forms = {}
    with gzip.open(forms_path, 'rt', encoding='utf-8') as fh:
        for line in fh:
            cols = line.rstrip('\n').split('\t')
            if len(cols) < 3:
                continue
            form = cols[0].replace("'", '').lower()
            head = cols[2].replace("'", '').lower()
            if form == head or head not in index or form in index:
                continue
            forms[form] = head
    form_keys = sorted(forms)
    print('inflected forms resolved: %d' % len(form_keys))

    payload = {
        'version': 2,
        'count': len(words),
        'words': '\n'.join(words),
        'senses': '\n'.join(senses_out),
        'forms': '\n'.join(form_keys),
        'formTo': ','.join(str(index[forms[f]]) for f in form_keys),
    }
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(',', ':'))
    raw = os.path.getsize(OUT)
    with open(OUT, 'rb') as fh:
        gz = len(gzip.compress(fh.read(), 9))
    print('wrote %s (%.1f MB raw, %.1f MB gzipped)' % (OUT, raw / 1048576, gz / 1048576))


if __name__ == '__main__':
    main()
