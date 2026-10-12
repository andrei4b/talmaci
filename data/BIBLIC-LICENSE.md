# Licență și atribuire — `data/biblic/`

Fișierele din `data/biblic/` sunt generate, nu scrise de mână, de
`tools/biblic/build-index.js`.

## Surse

Ambele dicționare vin din modulele publicate de
[CrossWire Bible Society](https://www.crosswire.org/sword/) (proiectul SWORD),
păstrate neschimbate în `data/build-inputs/sword-easton/` și
`data/build-inputs/sword-isbe/`, împreună cu fișierele lor `.conf`. Ambele
module sunt marcate `DistributionLicense=Public Domain`.

- **Easton’s Bible Dictionary** — M. G. Easton, *Illustrated Bible
  Dictionary*, ediția a treia, Thomas Nelson, 1897. Text preluat de CrossWire
  de la CCEL. Ilustrațiile ediției tipărite nu sunt incluse.
- **International Standard Bible Encyclopedia** — James Orr (ed.), 1915.

## Ce s-a modificat față de sursă

- Marcajul TEI a fost transformat în HTML simplu (paragrafe, aldine,
  cursive, legături).
- În Easton, aproximativ 800 de trimiteri biblice scrise fără numele cărții
  („Apoc. 1:8, 11”) erau marcate greșit drept Geneza 1 în modul. Textul
  afișat era corect, așa că trimiterile au fost refăcute din el; vezi
  `fixEastonRefs` în scriptul de generare.
- Textul în sine nu a fost modificat.
