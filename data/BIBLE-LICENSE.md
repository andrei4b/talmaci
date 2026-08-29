# Licență și atribuire — `bible-cornilescu.json`

Fișierul `data/bible-cornilescu.json` este generat, nu scris de mână. Vezi
`tools/bible/build-index.js` pentru scriptul care îl produce.

## Sursă

Textul este traducerea lui Dumitru Cornilescu (1921/1924), în varianta
**Romanian Corrected Cornilescu Version (RCCV)**, publicată de
[eBible.org](https://ebible.org) — un site dedicat exclusiv distribuirii de
texte biblice pentru care are dreptul confirmat de a le publica liber —
sub formă de export USFX, datat 2013-09-09. Proiectul
[seven1m/open-bibles](https://github.com/seven1m/open-bibles), care
adună traduceri biblice de domeniu public sau licențiate liber, o
listează explicit ca **domeniu public**.

Fișierul original folosit (`ron-rccv.usfx.xml`, arhivat cu gzip în
`data/build-inputs/ron-rccv.usfx.xml.gz`) a fost verificat verset cu verset
față de exemple concrete cerute de utilizator și se potrivește exact.

## O precizare necesară

Traducerile Cornilescu circulă în mai multe variante cu statut diferit:
edițiile curente, întreținute de British and Foreign Bible Society (BFBS)
împreună cu Societatea Biblică Interconfesională din România (SBIR), sunt
explicit protejate prin drepturi de autor (©BFBS/SBIR 2016, cu o ediție
"definitivă" aniversară în 2024) — acestea **nu** sunt sursa folosită aici.

RCCV de la eBible.org este un text separat, marcat domeniu public de sursa
care îl distribuie; numele "Corrected" e o coincidență terminologică cu
proiectul de corectură al BFBS/SBIR, nu o relație de proveniență cunoscută.
Dacă apare vreodată un motiv să credem contrariul, `tools/bible/README.md`
(dacă se adaugă) sau acest fișier vor fi actualizate, iar indexul poate fi
regenerat dintr-o altă sursă — de exemplu ediția mai veche (ortografie
pre-1993), distribuită de The Unbound Bible, marcată de asemenea domeniu
public, păstrată separat de acest depozit.

## Ce s-a modificat față de sursă

- Diacriticele ş/ţ (formă turcească, cu sedilă) au fost normalizate la
  forma română corectă ș/ț (virgulă dedesubt) — aceeași normalizare pe
  care `js/ro-phonetics.js` o aplică deja pentru căutarea de rime.
- Marcajul `<wj>` (cuvintele lui Isus) a fost eliminat, păstrând doar
  textul — nu există momentan o evidențiere separată pentru el în aplicație.
- Structura (carte → capitol → verset) a fost aplatizată dintr-un flux XML
  într-un tablou JSON compact, fără alte modificări de conținut.

Numărul de versete (31.102) și de capitole (1.189) rezultate corespund
exact cu numărul cunoscut pentru canonul protestant complet — o verificare
că nimic nu a fost pierdut sau dublat la conversie.
