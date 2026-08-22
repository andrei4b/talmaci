# Licență și atribuire — `synonym-index.json`

Fișierul `data/synonym-index.json` este generat, nu scris de mână. Vezi
`tools/synonyms/build-index.py` pentru scriptul care îl produce și
`tools/synonyms/README.md` pentru instrucțiuni de regenerare.

## Surse

### RoWordNet — sinonime și definiții

Sinonimele și definițiile provin din
[RoWordNet](https://github.com/dumitrescustefan/RoWordNet), rețeaua
semantică a limbii române, distribuită sub licența **MIT**
(Copyright © 2020 Ștefan Daniel Dumitrescu).

Datele lingvistice din spatele acestei biblioteci au fost create în cadrul
Academiei Române (RACAI). Autorii cer citarea:

> Dan Tufiș, Verginica Barbu Mititelu, *The Lexical Ontology for Romanian*,
> în Nuria Gala, Reinhard Rapp, Nuria Bel-Enguix (ed.), *Language
> Production, Cognition, and the Lexicon*, seria Text, Speech and Language
> Technology, vol. 48, Springer, 2014, p. 491–504.

Iar pentru API-ul din care s-au extras datele:

> S. D. Dumitrescu, A. M. Avram, L. Morogan, S. Toma, *RoWordNet – A Python
> API for the Romanian WordNet*, 2018 10th International Conference on
> Electronics, Computers and Artificial Intelligence (ECAI).

Din RoWordNet s-au folosit doar:

- literalii fiecărui synset (adică grupurile de sinonime);
- definiția fiecărui synset;
- clasa morfologică (substantiv, verb, adjectiv, adverb).

S-au păstrat **numai** synset-urile cu cel puțin doi literali — restul nu
oferă niciun sinonim.

### dexonline — forme flexionare

Legătura dintre o formă flexionară („frumoasă", „mergeau") și cuvântul-titlu
sub care RoWordNet o cunoaște („frumos", „merge") vine din același dump
oficial dexonline folosit de indexul de rime — vezi
`data/RHYME-INDEX-LICENSE.md` pentru detalii despre sursă, licență (**GPL
v2+**) și despre faptul că **nu s-au folosit definiții** din dexonline.

Din acel dump s-au folosit aici doar perechile *formă → cuvânt-titlu*.

## Licența fișierului generat

Indexul combină date sub MIT (RoWordNet) cu date sub GPL v2+ (formele
flexionare dexonline). Fiind o operă derivată din ambele, se distribuie sub
condiția mai restrictivă: **GPL v2 sau ulterioară**.

## Ce conține fișierul

| câmp | conținut |
|------|----------|
| `words` | cuvintele care au cel puțin un sinonim, ordonate alfabetic |
| `senses` | pentru fiecare cuvânt: sensurile lui, fiecare cu clasa morfologică, definiția și sinonimele |
| `forms` | forme flexionare, ordonate alfabetic |
| `formTo` | cuvântul-titlu la care trimite fiecare formă |
