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

    python3 extract-forms.py dex-database.sql.gz hyphenations.txt > forms_typed.txt

The optional second argument writes the Lexeme.hyphenations column as
`form<TAB>value`. dexonline records the division for ~20k headwords, and
where it does it is authoritative — see build-index.js. Values may be
partial ("-ti-e"), may list alternatives separated by commas, and mark the
structural variant with a doubled hyphen ("a-e-ro--trans-port"); the plain
single-hyphen form is the phonetic one this project wants.
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


def main(dump, hyph_out=None):
    lex = {}                                     # lexemeId -> "TYPE/NUMBER"
    hyph = []                                    # (form, hyphenation)
    for line in stream(dump):
        if line.startswith('INSERT INTO `Lexeme`'):
            for t in tuples(line):
                if len(t) >= 16:
                    lex[t[0]] = t[14] + '/' + t[15]
                    if hyph_out and t[10] and t[10] != 'NULL':
                        hyph.append((t[1], t[10]))
    print(f"lexemes: {len(lex)}", file=sys.stderr)

    if hyph_out:
        with open(hyph_out, 'w', encoding='utf-8') as fh:
            for form, value in hyph:
                fh.write(f"{form}\t{value}\n")
        print(f"hyphenations: {len(hyph)}", file=sys.stderr)

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
    if len(sys.argv) not in (2, 3):
        sys.exit('usage: extract-forms.py <dex-database.sql.gz> [hyphenations.txt]'
                 '  > forms_typed.txt')
    main(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else None)
