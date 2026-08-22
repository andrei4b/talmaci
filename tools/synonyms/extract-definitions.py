#!/usr/bin/env python3
"""extract-definitions.py — pulls one source's entries out of the dexonline dump.

BUILD TIME ONLY. Streams the published dump and writes, for the requested
source, one line per entry:

    headword <TAB> entry text

Default source is 6, "Dicționar de sinonime" (Mircea și Luiza Seche, Litera
Internațional, 2002).

dexonline licenses its definition base under the GNU GPL v2 or later, and
asks two things of anyone who takes definitions from it: pass them on under
the GPL too, and carry the copyright notice from the foot of its pages,
including https://dexonline.ro as a link. Both are honoured — see
data/SYNONYM-INDEX-LICENSE.md, and the notice the Sinonime tab shows.

Only entries with status 0 are kept; anything else is deleted or awaiting
moderation on dexonline's side.

Run:
  python3 tools/synonyms/extract-definitions.py dex-database.sql.gz [sourceId] \\
    | gzip -9 > data/build-inputs/synonym-defs.txt.gz
"""
import gzip
import sys

STATUS_ACTIVE = '0'


def split_tuples(body):
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
            cur += {'n': '\n', 't': '\t', 'r': '\r', '0': ''}.get(ch, ch)
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
        sys.exit('usage: extract-definitions.py <dex-database.sql.gz> [sourceId]')
    want_source = sys.argv[2] if len(sys.argv) > 2 else '6'

    cols = None
    kept = seen = 0
    with gzip.open(sys.argv[1], 'rt', encoding='utf-8', errors='replace') as fh:
        in_create = False
        collected = []
        for line in fh:
            if line.startswith('CREATE TABLE `Definition`'):
                in_create = True
                collected = []
                continue
            if in_create:
                stripped = line.strip()
                if stripped.startswith('`'):
                    collected.append(stripped.split('`')[1])
                if stripped.startswith(') ENGINE'):
                    cols = collected
                    in_create = False
                continue
            if not line.startswith('INSERT INTO `Definition`'):
                continue
            if cols is None:
                continue
            for tup in split_tuples(line[line.index('VALUES') + 6:]):
                f = fields(tup)
                if len(f) != len(cols):
                    continue
                row = dict(zip(cols, f))
                seen += 1
                if row['sourceId'] != want_source or row['status'] != STATUS_ACTIVE:
                    continue
                text = row['internalRep'].replace('\t', ' ').replace('\n', ' ').strip()
                head = row['lexicon'].strip()
                if not head or not text:
                    continue
                kept += 1
                sys.stdout.write('%s\t%s\n' % (head, text))
    sys.stderr.write('definitions scanned %d, kept for source %s: %d\n'
                     % (seen, want_source, kept))


if __name__ == '__main__':
    main()
