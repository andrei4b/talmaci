#!/usr/bin/env python3
"""extract-relations.py — pulls synonym relations out of the dexonline dump.

BUILD TIME ONLY. Streams the published dump once and writes one line per
synonym relation:

    meaningId <TAB> words,on,this,side <TAB> words,on,the,other,side

Only structural tables are read: Relation, Meaning, TreeEntry, EntryLexeme,
Lexeme. From Meaning it takes **id and treeId only** — never internalRep,
which is the meaning's text and belongs to the dictionaries dexonline
credits. No definition is extracted, here or anywhere else in this project.

Why this table and not the "Dicționar de sinonime" source: dexonline marks
every source with `canDistribute`, and exactly two of its 113 sources are
set to 1 — DEX '96 and DEX '98. All seven synonym dictionaries, source 6
included, are 0, so their contents cannot be redistributed. The Relation
table is dexonline's own structured synonymy rather than a publisher's
book, the same category as the InflectedForm data the rhyme index uses.

Run:
  python3 tools/synonyms/extract-relations.py dex-database.sql.gz \\
    | gzip -9 > data/build-inputs/synonym-pairs.txt.gz
"""
import collections
import gzip
import sys

WANTED = {'Relation', 'Meaning', 'TreeEntry', 'EntryLexeme', 'Lexeme'}

# type 1 is synonymy; 2 antonymy, 3 diminutive, 4 augmentative.
SYNONYM = '1'


def columns_of(create_sql):
    cols = []
    for line in create_sql.split('\n'):
        line = line.strip()
        if line.startswith('`'):
            cols.append(line.split('`')[1])
    return cols


def split_tuples(body):
    """Yield each (...) tuple of a VALUES list, respecting quotes."""
    buf, depth, in_quote, escaped = '', 0, False, False
    for ch in body:
        if escaped:
            buf += ch
            escaped = False
            continue
        if ch == '\\':
            buf += ch
            escaped = True
            continue
        if ch == "'":
            in_quote = not in_quote
            buf += ch
            continue
        if not in_quote and ch == '(':
            depth += 1
            if depth == 1:
                buf = ''
                continue
        if not in_quote and ch == ')':
            depth -= 1
            if depth == 0:
                yield buf
                continue
        if depth:
            buf += ch


def fields(tup):
    out, cur, in_quote, escaped = [], '', False, False
    for ch in tup:
        if escaped:
            cur += {'n': '\n', 't': '\t', 'r': '\r'}.get(ch, ch)
            escaped = False
            continue
        if ch == '\\':
            escaped = True
            continue
        if ch == "'":
            in_quote = not in_quote
            continue
        if ch == ',' and not in_quote:
            out.append(cur)
            cur = ''
            continue
        cur += ch
    out.append(cur)
    return out


def main():
    if len(sys.argv) < 2:
        sys.exit('usage: extract-relations.py <dex-database.sql.gz>')

    schemas = {}
    relations = []                                  # (meaningId, treeId)
    meaning_tree = {}                               # meaningId -> treeId
    tree_entries = collections.defaultdict(list)
    entry_lexemes = collections.defaultdict(list)
    lexeme_form = {}

    current, buf = None, []
    with gzip.open(sys.argv[1], 'rt', encoding='utf-8', errors='replace') as fh:
        for line in fh:
            if line.startswith('CREATE TABLE `'):
                name = line.split('`')[1]
                current = name if name in WANTED else None
                buf = [line] if current else []
                continue
            if current and not line.startswith('INSERT'):
                buf.append(line)
                if line.startswith(') ENGINE'):
                    schemas[current] = columns_of(''.join(buf))
                    current = None
                continue
            if not line.startswith('INSERT INTO `'):
                continue
            table = line.split('`')[1]
            if table not in WANTED or table not in schemas:
                continue
            cols = schemas[table]
            for tup in split_tuples(line[line.index('VALUES') + 6:]):
                f = fields(tup)
                if len(f) != len(cols):
                    continue
                row = dict(zip(cols, f))
                if table == 'Relation':
                    if row['type'] == SYNONYM:
                        relations.append((row['meaningId'], row['treeId']))
                elif table == 'Meaning':
                    meaning_tree[row['id']] = row['treeId']
                elif table == 'TreeEntry':
                    tree_entries[row['treeId']].append(row['entryId'])
                elif table == 'EntryLexeme':
                    entry_lexemes[row['entryId']].append(row['lexemeId'])
                elif table == 'Lexeme':
                    lexeme_form[row['id']] = row['formNoAccent']

    sys.stderr.write('relations(synonym) %d\nmeanings %d\ntrees %d\nlexemes %d\n' % (
        len(relations), len(meaning_tree), len(tree_entries), len(lexeme_form)))

    def words_of(tree_id):
        seen, out = set(), []
        for entry_id in tree_entries.get(tree_id, ()):
            for lexeme_id in entry_lexemes.get(entry_id, ()):
                w = lexeme_form.get(lexeme_id, '').strip().lower()
                if w and ',' not in w and w not in seen:
                    seen.add(w)
                    out.append(w)
        return out

    written = 0
    for meaning_id, target_tree in relations:
        source_tree = meaning_tree.get(meaning_id)
        if not source_tree:
            continue
        left, right = words_of(source_tree), words_of(target_tree)
        if not left or not right:
            continue
        sys.stdout.write('%s\t%s\t%s\n' % (meaning_id, ','.join(left), ','.join(right)))
        written += 1
    sys.stderr.write('wrote %d relation lines\n' % written)


if __name__ == '__main__':
    main()
