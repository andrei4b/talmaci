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

### Frecvențe — OpenSubtitles

Ordinea rezultatelor (cele mai frecvente cuvinte primele) folosește lista de
frecvențe [hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords)
(`content/2018/ro/ro_50k.txt`), derivată din OpenSubtitles.

Licență: **MIT**.

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
