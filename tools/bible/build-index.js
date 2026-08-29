#!/usr/bin/env node
/* build-index.js — builds data/bible-cornilescu.json from the USFX export
 * of the Romanian Corrected Cornilescu Version (RCCV), published by
 * eBible.org. See data/BIBLE-LICENSE.md for where the input came from and
 * why it is used.
 *
 * The USFX markup actually present in this file is small — book, id, ide,
 * h, p, c, v, wj — so this reads it as a flat token stream rather than
 * pulling in an XML parser: chapter/verse markers are self-closing and
 * text just runs between them.
 *
 *   node tools/bible/build-index.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const INPUT = path.join(__dirname, '../../data/build-inputs/ron-rccv.usfx.xml.gz');
const OUTPUT = path.join(__dirname, '../../data/bible-cornilescu.json');

function readText(p) {
  const buf = fs.readFileSync(p);
  return (p.endsWith('.gz') ? zlib.gunzipSync(buf) : buf).toString('utf8');
}

const xml = readText(INPUT);

// The source spells ș/ț with the legacy Turkish cedilla (ş/ţ, U+015F/U+0163)
// throughout rather than the correct comma-below forms — the same mismatch
// js/ro-phonetics.js already normalizes for rhyme lookups. Case-preserving,
// since this runs on verse text rather than lowercased search keys.
const DIACRITIC_FIX = { 'ş': 'ș', 'Ş': 'Ș', 'ţ': 'ț', 'Ţ': 'Ț' };
function fixDiacritics(s) {
  return s.replace(/[şŞţŢ]/g, ch => DIACRITIC_FIX[ch]);
}

const bookRe = /<book id="([A-Z0-9]+)">([\s\S]*?)<\/book>/g;
const books = [];
let bm;
while ((bm = bookRe.exec(xml))) {
  const body = bm[2];
  const hMatch = body.match(/<h>([^<]*)<\/h>/);
  const name = fixDiacritics((hMatch ? hMatch[1] : bm[1]).trim());

  // Everything after the title: drop the repeated book-title paragraph,
  // the words-of-Jesus markup (kept as plain text — no red-letter styling
  // here) and every <p>, whose only job is a paragraph break the reader
  // doesn't need once text is split into one string per verse.
  let rest = body.slice(hMatch ? hMatch.index + hMatch[0].length : 0);
  rest = rest
    .replace(/<p sfm="mt"[^>]*>[^<]*<\/p>/, '')
    .replace(/<\/?wj>/g, '')
    .replace(/<\/?p[^>]*>/g, ' ');

  const chapters = [];
  let curVerses = null;
  let curNum = 0;
  let curText = [];

  // Some translations omit a traditional verse number outright (disputed
  // manuscript verses), which would misalign a plain push. Indexing by the
  // verse's own id sidesteps that — a missing number just leaves a hole,
  // rather than shifting every verse after it.
  function flush() {
    if (curVerses && curNum > 0) {
      const text = fixDiacritics(curText.join('').replace(/\s+/g, ' ').trim());
      if (text) curVerses[curNum - 1] = text;
    }
    curText = [];
  }

  const tokenRe = /<c id="(\d+)"\s*\/>|<v id="(\d+)"\s*\/>/g;
  let last = 0, tm, sawMarker = false;
  while ((tm = tokenRe.exec(rest))) {
    if (sawMarker) curText.push(rest.slice(last, tm.index));
    last = tokenRe.lastIndex;
    if (tm[1] !== undefined) {
      flush();
      curVerses = [];
      curNum = 0;
      chapters.push(curVerses);
    } else {
      flush();
      curNum = parseInt(tm[2], 10);
    }
    sawMarker = true;
  }
  if (sawMarker) curText.push(rest.slice(last));
  flush();

  books.push({ name, chapters });
}

const totalChapters = books.reduce((n, b) => n + b.chapters.length, 0);
const totalVerses = books.reduce((n, b) => n + b.chapters.reduce((m, c) => m + c.filter(Boolean).length, 0), 0);
if (books.length !== 66) throw new Error('expected 66 books, got ' + books.length);

fs.writeFileSync(OUTPUT, JSON.stringify({ books }));
console.log(books.length + ' books, ' + totalChapters + ' chapters, ' + totalVerses + ' verses -> ' +
  path.relative(process.cwd(), OUTPUT) + ' (' + (fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(2) + ' MB)');
