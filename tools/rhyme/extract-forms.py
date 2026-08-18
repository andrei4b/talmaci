#!/usr/bin/env python3
"""Extract inflected forms + their model type from the dexonline dump.

Reads ONLY the InflectedForm and Lexeme tables. Definitions are never parsed
or written — some of the dictionaries aggregated by dexonline are privately
funded and cannot be relicensed, so nothing definitional leaves this script.

Emits one line per distinct accented form:

    cuv'ant<TAB>M/24

The model type is what lets the build tell a name from a word. dexonline
classifies every lexeme, and "T" (temporar), "SP" (substantiv propriu),
"I/3" (nume propriu), "I/4" (cuvant din alta limba) and "I/6" (abreviere)
are the buckets the rhyme index has no use for.

Two passes are required. A mysqldump writes tables alphabetically, so every
InflectedForm row appears before the first Lexeme row; resolving lexemeId in
one pass silently yields nothing.

    python3 extract-forms.py dex-database.sql.gz > forms_typed.txt
"""
import sys, gzip, io


def tuples(line):
    """Yield each VALUES tuple of a mysqldump extended INSERT as a field list."""
    i = line.index('VALUES') + 6
    n = len(line)
    while i < n:
        while i < n and line[i] != '(':
            i += 1
        if i >= n:
            return
        i += 1
        fields, cur, instr, esc = [], [], False, False
        while i < n:
            c = line[i]
            if instr:
                if esc:
                    cur.append(c); esc = False
                elif c == '\\':
                    esc = True
                elif c == "'":
                    instr = False
                else:
                    cur.append(c)
            else:
                if c == "'":
                    instr = True
                elif c == ',':
                    fields.append(''.join(cur)); cur = []
                elif c == ')':
                    fields.append(''.join(cur)); i += 1; break
                elif c not in ' \t':
                    cur.append(c)
            i += 1
        yield fields


def stream(path):
    with gzip.open(path, 'rb') as fh:
        yield from io.TextIOWrapper(fh, encoding='utf-8', errors='replace')


NOISE_TYPES = ('T', 'SP')
NOISE_I = ('3', '4', '6')


def is_noise(model):
    type_, _, num = model.partition('/')
    return type_ in NOISE_TYPES or (type_ == 'I' and num in NOISE_I)


def main(dump):
    lex = {}                                     # lexemeId -> "TYPE/NUMBER"
    for line in stream(dump):
        if line.startswith('INSERT INTO `Lexeme`'):
            for t in tuples(line):
                if len(t) >= 16:
                    lex[t[0]] = t[14] + '/' + t[15]
    print(f"lexemes: {len(lex)}", file=sys.stderr)

    # A spelling can belong to several lexemes. Keep a real part of speech
    # over a provisional one, so "cruce" (F/122 and I/3) is not mistaken for
    # a name on the strength of its I/3 entry alone.
    seen = {}
    for line in stream(dump):
        if line.startswith('INSERT INTO `InflectedForm`'):
            for t in tuples(line):
                if len(t) < 5:
                    continue
                form, model = t[1], lex.get(t[4], '')
                prev = seen.get(form)
                if prev is None or (is_noise(prev) and not is_noise(model)):
                    seen[form] = model

    out = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    for form, model in seen.items():
        out.write(f"{form}\t{model}\n")
    out.flush()
    print(f"forms: {len(seen)}", file=sys.stderr)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: extract-forms.py <dex-database.sql.gz>  > forms_typed.txt')
    main(sys.argv[1])
