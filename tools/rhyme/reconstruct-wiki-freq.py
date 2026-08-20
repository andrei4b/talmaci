#!/usr/bin/env python3
"""Rebuild ro_wiki_freq.txt from the shipped index.

The written-register frequency list is derived from a full Wikipedia dump,
which is many gigabytes and slow to process. Everything the build actually
takes from it — which words exist, and what order the wikipedia-only ones
rank in — is already recorded in data/rhyme-index.json, so it can be
reconstructed without the dump.

build-index.js ranks in two tiers: words attested in the spoken corpus come
first, ordered by their rate there, and the rest follow ordered by their
Wikipedia rate. The first tier is reproduced exactly by the real subtitle
list. For the second, a count descending in the index's own order restores
the same sequence.

Counts are therefore ordinal, not the real corpus counts. They reproduce the
build; they are not Wikipedia data and should not be read as such.

    python3 reconstruct-wiki-freq.py rhyme-index.json ro_freq.txt > ro_wiki_freq.txt
"""
import sys, json, io


def main(index_path, subs_path):
    ix = json.load(io.open(index_path, encoding='utf-8'))
    words = ix['words'].split('\n')

    # rank is delta-encoded word ids, most frequent first
    order, pos = [], 0
    for d in ix['rank'].split(','):
        pos += int(d)
        order.append(pos)

    subs = set()
    for line in io.open(subs_path, encoding='utf-8'):
        sp = line.find(' ')
        if sp > 0:
            subs.add(line[:sp])

    out = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    count = len(order) + 1
    written = 0
    for wid in order:
        w = words[wid]
        # A word the spoken corpus already carries is ranked from there; it
        # still needs a line so the vocabulary test sees it.
        out.write('%s %d\n' % (w, count))
        count -= 1
        written += 1
    out.flush()
    print('%d words, %d also in the spoken corpus' %
          (written, sum(1 for wid in order if words[wid] in subs)), file=sys.stderr)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('usage: reconstruct-wiki-freq.py <rhyme-index.json> <ro_freq.txt> '
                 '> ro_wiki_freq.txt')
    main(sys.argv[1], sys.argv[2])
