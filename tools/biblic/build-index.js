#!/usr/bin/env node
/* build-index.js — builds data/biblic/{easton,isbe}/ from the CrossWire SWORD
 * modules of Easton's Bible Dictionary (1897) and the International Standard
 * Bible Encyclopedia (1915). Both are public domain; see
 * data/BIBLIC-LICENSE.md.
 *
 * The modules use SWORD's zLD format: an index of keys (.idx → .dat) and
 * the entries themselves in zlib-compressed blocks (.zdx → .zdt). The
 * entries are TEI, of which only a handful of elements occur — p, hi,
 * foreign, lb, ref, title — so they are rewritten as the small HTML the
 * app draws, with a regex pass rather than an XML parser.
 *
 * ISBE is 27 MB of text, so neither dictionary ships as one file. Each is
 * an index of its headwords plus the entries cut into chunks of about
 * CHUNK_BYTES, in alphabetical order; the app loads a chunk the first time
 * an entry in it is opened.
 *
 *   node tools/biblic/build-index.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const INPUTS = path.join(__dirname, '../../data/build-inputs');
const OUTPUT = path.join(__dirname, '../../data/biblic');
const CHUNK_BYTES = 200 * 1024;

/* ---- reading a zLD module ---- */

function readModule(dir, name) {
  const file = (ext) => fs.readFileSync(path.join(INPUTS, dir, name + ext));
  const idx = file('.idx'), dat = file('.dat'), zdx = file('.zdx'), zdt = file('.zdt');
  const blocks = new Map();
  function block(n) {
    if (!blocks.has(n)) {
      const off = zdx.readUInt32LE(n * 8), size = zdx.readUInt32LE(n * 8 + 4);
      const raw = zlib.inflateSync(zdt.subarray(off, off + size));
      const count = raw.readUInt32LE(0);
      const items = [];
      for (let i = 0; i < count; i++) items.push([raw.readUInt32LE(4 + 8 * i), raw.readUInt32LE(8 + 8 * i)]);
      blocks.set(n, { raw, items });
    }
    return blocks.get(n);
  }
  const entries = [];
  for (let i = 0; i < idx.length / 8; i++) {
    const off = idx.readUInt32LE(i * 8), size = idx.readUInt32LE(i * 8 + 4);
    const rec = dat.subarray(off, off + size);
    const nl = rec.indexOf(0x0a);
    const key = rec.subarray(0, nl).toString('utf8').replace(/\r$/, '');
    const b = block(rec.readUInt32LE(nl + 1));
    const [eo, es] = b.items[rec.readUInt32LE(nl + 5)];
    const text = b.raw.subarray(eo, eo + es).toString('utf8').replace(/\0+$/, '');
    entries.push({ key, text });
  }
  return entries;
}

/* ---- Easton's verse references ----
 * In this module a reference written without its book — "Rev. 1:8, 11",
 * "Ex. 4:14, 27-30" — was tagged as Genesis, chapter 1, about 800 times
 * over. The text shown is right, so the reference is rebuilt from it and
 * from the one before: after a comma a bare number is a verse in the same
 * chapter; after a semicolon it is a chapter; "21:6" is chapter and verse.
 * Only references tagged Genesis that follow one in another book are
 * touched — ISBE has no such fault, and a bare "9" that is not tagged
 * Genesis is already right. */
function fixEastonRefs(text) {
  let ctx = null;
  return text.replace(/(.?.?)<ref osisRef="Bible:([^"]+)">([^<]*)<\/ref>/g, (all, before, ref, shown) => {
    let fixed = ref;
    const [book, chapter] = ref.split('-')[0].split('.');
    if (!/[A-Za-z]/.test(shown) && ctx && book === 'Gen' && ctx.book !== 'Gen') {
      const t = shown.replace(/\s+/g, '');
      const range = (c, vs) => {
        const [a, b] = vs.split('-');
        return ctx.book + '.' + c + '.' + a + (b ? '-' + ctx.book + '.' + c + '.' + b : '');
      };
      if (t.includes(':')) {
        const [c, vs] = t.split(':');
        fixed = range(c, vs);
      } else if (before.includes(',')) {
        fixed = range(ctx.chapter, t);
      } else {
        const [a, b] = t.split('-');
        fixed = ctx.book + '.' + a + (b ? '-' + ctx.book + '.' + b : '');
      }
    }
    const [b2, c2] = fixed.split('-')[0].split('.');
    ctx = { book: b2, chapter: c2 };
    return before + '<ref osisRef="Bible:' + fixed + '">' + shown + '</ref>';
  });
}

/* ---- TEI → the app's HTML ----
 * Verse references become <a data-v="Matt.21.9">, references to another
 * entry <a data-k="ALTAR">; the app turns both into links. Anything not
 * listed is dropped, tags only, keeping its text. */
function toHtml(text) {
  return text
    .replace(/<entryFree[^>]*>|<\/entryFree>/g, '')
    .replace(/<title>[\s\S]*?<\/title>/g, '')
    .replace(/<ref osisRef="Bible:([^"]+)">/g, '<a data-v="$1">')
    .replace(/<ref target="[^":]+:([^"]+)">/g, (_, k) => '<a data-k="' + k.toUpperCase() + '">')
    .replace(/<\/ref>/g, '</a>')
    .replace(/<hi rend="bold">([\s\S]*?)<\/hi>/g, '<b>$1</b>')
    .replace(/<hi rend="underline">([\s\S]*?)<\/hi>/g, '<b>$1</b>')
    .replace(/<(?:hi|foreign) rend="italic">([\s\S]*?)<\/(?:hi|foreign)>/g, '<i>$1</i>')
    .replace(/<lb\s*\/>/g, '<br>')
    .replace(/<(?!\/?(?:p|a|b|i|br)\b)[^>]*>/g, '')
    .replace(/<p>\s*<\/p>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Easton's own title is in proper case ("Aaron"), ISBE has only its key.
function titleOf(entry) {
  const m = entry.text.match(/<title>([^<]*)<\/title>/);
  return m ? m[1].trim() : entry.key;
}

function build(name, dir, fix) {
  const entries = readModule(dir, name).map(e => ({
    key: e.key.toUpperCase(),
    title: titleOf(e),
    html: toHtml(fix ? fix(e.text) : e.text)
  })).filter(e => e.html);

  const outDir = path.join(OUTPUT, name);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // Chunks are consecutive runs of entries; `chunks` holds the index of the
  // first entry in each, which is all the app needs to find one.
  const chunks = [];
  let cur = [], bytes = 0;
  const flush = () => {
    if (!cur.length) return;
    fs.writeFileSync(path.join(outDir, chunks.length - 1 + '.json'), JSON.stringify(cur));
    cur = []; bytes = 0;
  };
  entries.forEach((e, i) => {
    if (!cur.length) chunks.push(i);
    cur.push(e.html);
    bytes += Buffer.byteLength(e.html);
    if (bytes >= CHUNK_BYTES) flush();
  });
  flush();

  const index = { titles: entries.map(e => e.title), chunks };
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index));
  const total = entries.reduce((n, e) => n + Buffer.byteLength(e.html), 0);
  console.log(name + ': ' + entries.length + ' entries, ' + chunks.length + ' chunks, ' +
    (total / 1048576).toFixed(1) + ' MB');
}

build('easton', 'sword-easton', fixEastonRefs);
build('isbe', 'sword-isbe', null);
