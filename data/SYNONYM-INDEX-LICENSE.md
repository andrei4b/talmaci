# Licență și atribuire — `synonym-index.json`

Fișierul `data/synonym-index.json` este generat, nu scris de mână. Vezi
`tools/synonyms/` pentru scripturile care îl produc și pentru instrucțiuni
de regenerare.

## Sursa

Sinonimele provin din **tabela `Relation`** a dumpului de bază de date
publicat oficial de [dexonline](https://dexonline.ro) la
`https://dexonline.ro/static/download/dex-database.sql.gz` — aceeași sursă
folosită de indexul de rime, sub aceleași condiții (vezi
`data/RHYME-INDEX-LICENSE.md`).

`Relation` este structura proprie dexonline: leagă un sens de un grup de
cuvinte sinonime. Nu este textul niciunui dicționar de sinonime.

Din dump s-au citit **numai tabele structurale**:

| tabelă | ce s-a luat |
|--------|-------------|
| `Relation` | perechile sens ↔ grup, doar cele de tip 1 (sinonimie) |
| `Meaning` | **exclusiv** `id` și `treeId` |
| `TreeEntry`, `EntryLexeme` | legăturile dintre grupuri și lexeme |
| `Lexeme` | forma cuvântului și modelul flexionar |

**Nu s-a extras niciun text de definiție.** În particular, din `Meaning` nu
s-a citit `internalRep` — textul sensului, care aparține dicționarelor
creditate de dexonline.

## De ce nu „Dicționarul de sinonime"

Sursa de la `dexonline.ro/source/sinonime` este *Dicționar de sinonime* de
Mircea și Luiza Seche (Editura Litera Internațional, 2002), sursa cu `id =
6` în dump.

Tabela `Source` are coloana **`canDistribute`**, prin care dexonline declară
explicit ce surse are dreptul să redistribuie. Din cele 113 surse din dump,
**doar două** au `canDistribute = 1`: DEX '96 și DEX '98. Toate cele șapte
dicționare de sinonime, inclusiv sursa 6, au `canDistribute = 0`.

Prezența unei surse în dump nu înseamnă deci permisiunea de a o
redistribui — dumpul conține schema și rândurile pentru tot, iar coloana
`canDistribute` este declarația dexonline despre ce se poate mai departe.
Din acest motiv, conținutul acelui dicționar nu este folosit aici.

## Filtrare

Sinonimele sunt păstrate doar dacă apar în lista de cuvinte a indexului de
rime — adică sunt atestate într-unul dintre cele două corpusuri de frecvență
(subtitrări și Wikipedia). Se elimină astfel variantele regionale și arhaice
pe care dexonline le păstrează alături de cele curente.

Se elimină de asemenea cuvintele ale căror modele flexionare sunt toate
„zgomot" (`T`, `SP`, `I/2*`, `I/3`, `I/4`, `I/6`) — în principal denumiri
latinești de plante, care altfel apar ca sinonime pentru că împart un sens
de dicționar cu un cuvânt obișnuit.

## Legătura către dexonline din aplicație

Tabul Sinonime are, sub rezultatele locale, o legătură către pagina
dexonline a cuvântului căutat:

    https://dexonline.ro/definitie-sinonime/<cuvânt>

Acolo se vede *Dicționarul de sinonime* (Seche, 2002) — cel mai bun
dicționar de sinonime al limbii române, dar al cărui text nu se află în
niciunul dintre canalele de distribuție dexonline (vezi mai sus), deci nu
poate fi inclus în index.

Legătura nu preia nimic: pagina este servită de dexonline direct
cititorului, cu propria atribuire și propria finanțare intacte. Se deschide
într-un panou în aplicație, cu un buton care o deschide într-o filă
obișnuită de browser.

## Licența fișierului generat

Fiind derivat din dumpul dexonline, distribuit sub **GNU GPL v2 sau
ulterioară**, indexul se distribuie sub aceeași licență: **GPL v2+**.

## Ce conține fișierul

| câmp | conținut |
|------|----------|
| `words` | cuvintele care au cel puțin un sinonim, ordonate alfabetic |
| `senses` | pentru fiecare cuvânt: sensurile lui, fiecare un grup de sinonime |
| `forms` | forme flexionare, ordonate alfabetic |
| `formTo` | cuvântul de dicționar la care trimite fiecare formă |

Sensurile nu au explicație atașată: textul care ar explica fiecare sens se
află în surse pe care dexonline nu le poate redistribui.
