# Licență și atribuire — `rhyme-index.json`

Fișierul `data/rhyme-index.json` este generat, nu scris de mână. Vezi
`tools/rhyme/build-index.js` pentru scriptul care îl produce și
`tools/rhyme/README.md` pentru instrucțiuni de regenerare.

## Surse

### dexonline — forme flexionare și accent

Formele de cuvinte și poziția accentului provin din dumpul de bază de date
publicat oficial de [dexonline](https://dexonline.ro) la
`https://dexonline.ro/static/download/dex-database.sql.gz`.

Termenii dexonline interzic extragerea automată de date **cu excepția
seturilor de date oferite oficial spre utilizare publică** — dumpul folosit
aici este exact un astfel de set, publicat de ei la o adresă statică de
descărcare.

Din acest dump s-a folosit **numai tabela `InflectedForm`**, adică:

- forma flexionară a cuvântului;
- poziția silabei accentuate (marcată cu apostrof, ex. `veșnic'ie`).

**Nu s-au folosit definiții.** Acest lucru este intenționat: unele dicționare
din dexonline provin din fonduri private, iar dexonline declară explicit că
nu are dreptul să redistribuie definițiile acelora. Indexul de rime nu
conține și nu derivă din niciun text de definiție.

Baza de date dexonline este distribuită sub **GNU GPL v2 sau ulterioară**.
Prin urmare, `rhyme-index.json`, fiind derivat din ea, este distribuit sub
aceeași licență: **GPL v2+**.

### Frecvențe — două corpusuri

Ordinea rezultatelor (cele mai frecvente cuvinte primele) și filtrarea
cuvintelor neatestate folosesc două surse, pentru că niciuna singură nu
acoperă registrul necesar:

1. **OpenSubtitles**, prin
   [hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords)
   (`content/2018/ro/ro_50k.txt`) — limba vorbită.
   Licență: **MIT**.

2. **Wikipedia în română**, frecvențe calculate local din dumpul oficial
   `rowiki-latest-pages-articles.xml.bz2` — limba scrisă/literară.
   Text sub **CC BY-SA 3.0/4.0**; a se atribui Wikipedia.

Motivul pentru a doua sursă: cuvinte perfect obișnuite în scris, dar care
nu apar în dialogul din filme (de exemplu „preamărit", „nemărginit"), erau
clasate ultimele sau eliminate, deși sunt exact genul de cuvinte utile
într-un text de cântec.

Frecvențele sunt normalizate la apariții-pe-milion înainte de combinare,
fiindcă cele două corpusuri diferă mult ca mărime. Se ia **maximul** celor
două rate („frecvent în cel puțin un registru"), nu media, care ar
penaliza tocmai cuvintele absente dintr-un registru.

## Ce conține fișierul

Doar date factuale despre limbă:

| câmp | conținut |
|------|----------|
| `words` | formele de cuvinte, ordonate alfabetic |
| `spos`  | poziția vocalei accentuate în cuvânt |
| `syll`  | numărul de silabe |
| `rank`  | ordinea după frecvența de utilizare |
| `exact` | grupuri de rime perfecte |
| `asson` | grupuri de asonanțe |

## Dacă dexonline cere retragerea

Datele sunt folosite cu bună-credință, pe baza excepției din termenii lor
pentru seturile de date oferite oficial. Dacă dexonline consideră totuși că
această utilizare nu este acceptabilă, indexul poate fi regenerat fără
datele lor — `js/ro-phonetics.js` conține deja un predictor de accent bazat
pe reguli (`predictStress`), folosit ca rezervă pentru cuvintele care nu
apar în index.
