#!/usr/bin/env python3
"""build-index.py — generates data/synonym-index.json for the Sinonime tab.

BUILD TIME ONLY. Reads RoWordNet's pickle and the dexonline forms dump the
rhyme build already ships, and writes a compact index; neither input is ever
downloaded by the browser.

Two decisions are worth knowing about.

Only synsets with more than one literal are kept. A synset with a single
literal names a concept but offers no synonym, and two thirds of them are
like that — keeping them would triple the index to say nothing.

Definitions are kept. A word averages 1.68 senses here, so it usually has
more than one group of synonyms, and the definition is the only thing that
says which group is which. It costs roughly 0.6 MB gzipped; without it the
tab shows unlabelled piles of words.

Inflected forms are resolved through the dexonline dump. RoWordNet is keyed
by lemma, so without that step, typing "frumoasă" or "mergeau" — which is
what writing lyrics actually looks like — would find nothing.

Run:  python3 tools/synonyms/build-index.py <rowordnet.pickle> [forms_typed.txt.gz]
"""
import collections
import gzip
import json
import os
import re
import pickle
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, 'data', 'synonym-index.json')

# Separators taken from the C0 control block, so they can never turn up
# inside a word or a definition and nothing needs escaping.
SENSE_SEP = chr(0x1f)   # between the senses of one word
FIELD_SEP = chr(0x1e)   # between pos / definition / synonyms of one sense
SYN_SEP = chr(0x1d)     # between synonyms

# RoWordNet brackets a verb's clitic — "|se| întinde", "[se] potrivi",
# "[-și] aminti", "[o] duce" — to mark it as part of the entry rather than
# a separate word. On screen the brackets are noise, while the clitic
# itself belongs: "se potrivi" and "o duce" are how you would write them.
#
# A leading hyphen is kept. Without it "[-și] aminti" reads as "și aminti",
# and "și" on its own is the everyday word for "and" — the hyphen is what
# marks it as a clitic instead. 699 of the 770 markers are plain "se", so
# this only affects the handful spelled with one.
CLITIC = re.compile(r'[\|\[]\s*(-?[^\|\]]*?)\s*[\|\]]')


def clean_literal(text):
    return re.sub(r'\s+', ' ', CLITIC.sub(r'\1', text)).strip()


def load_wordnet(path):
    # The pickle holds rowordnet.* objects, so its package has to be
    # importable for pickle to resolve them.
    pkg_parent = os.path.dirname(os.path.dirname(os.path.abspath(path)))
    sys.path.insert(0, pkg_parent)
    with open(path, 'rb') as fh:
        return pickle.load(fh)


def main():
    if len(sys.argv) < 2:
        sys.exit('usage: build-index.py <rowordnet.pickle> [forms_typed.txt.gz]')
    wn = load_wordnet(sys.argv[1])
    forms_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        ROOT, 'data', 'build-inputs', 'forms_typed.txt.gz')

    by_word = collections.defaultdict(list)
    kept = skipped = 0
    for sid in wn.synsets():
        syn = wn.synset(sid)
        literals = [clean_literal(l.replace('_', ' ')) for l in syn.literals]
        if len(literals) < 2:
            skipped += 1
            continue
        kept += 1
        definition = (syn.definition or '').strip().replace('\n', ' ')
        for lit in literals:
            # Multi-word literals stay available as synonyms — "trăsătură
            # psihologică" is a fine thing to be offered — but get no entry
            # of their own, since nobody searches for one.
            if ' ' in lit:
                continue
            others = [x for x in literals if x != lit]
            by_word[lit.lower()].append((str(syn.pos), definition, others))
    print('synsets: %d with synonyms, %d single-literal (skipped)' % (kept, skipped))
    print('words with at least one synonym: %d' % len(by_word))

    words = sorted(by_word)
    index = {w: i for i, w in enumerate(words)}

    senses_out = []
    for w in words:
        parts = []
        for pos, definition, others in by_word[w]:
            parts.append(FIELD_SEP.join([pos, definition, SYN_SEP.join(others)]))
        senses_out.append(SENSE_SEP.join(parts))
    total = sum(len(by_word[w]) for w in words)
    print('senses: %d (%.2f per word)' % (total, total / len(words)))

    # form -> lemma, for every inflected form that lands on a word we hold.
    forms = {}
    with gzip.open(forms_path, 'rt', encoding='utf-8') as fh:
        for line in fh:
            cols = line.rstrip('\n').split('\t')
            if len(cols) < 3:
                continue
            form = cols[0].replace("'", '').lower()
            head = cols[2].replace("'", '').lower()
            if form == head or head not in index:
                continue
            # A form that is itself a word we hold is left alone: looking it
            # up directly is right, and redirecting it would hide its own
            # senses behind another word's.
            if form in index:
                continue
            forms[form] = head
    form_keys = sorted(forms)
    print('inflected forms resolved: %d' % len(form_keys))

    payload = {
        'version': 1,
        'count': len(words),
        'words': '\n'.join(words),
        'senses': '\n'.join(senses_out),
        'forms': '\n'.join(form_keys),
        # Parallel to `forms`: the id of the lemma each one resolves to.
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
