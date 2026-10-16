/* migrate-verses — turns every song's text, stored as one string, into
 * the list of verses the app reads since release 158 (see js/verses.js):
 *   songs/{id}.originalText            -> originalVerses
 *   songs/{id}/versions/{vid}.text     -> verses
 * and a song that still has only the legacy translatedText, and no
 * versions, gets a "Versiunea 1" made from it.
 *
 * Runs as the project's admin (firebase-admin, Application Default
 * Credentials), so it reaches every song, personal ones too, which no
 * member's browser can. Leaves updatedAt alone, so the song list keeps
 * its order.
 *
 *   gcloud auth application-default login       (once)
 *   node tools/migrate-verses/migrate.js         dry run: report, write nothing
 *   node tools/migrate-verses/migrate.js --copy  back up the old fields, and
 *                                                write the lists beside them
 *   node tools/migrate-verses/migrate.js --sweep backups/<file>.json
 *                                                after the release: convert
 *                                                again what an old app wrote
 *                                                since the copy, then delete
 *                                                the old fields
 *
 * The dry run checks every conversion two ways: no line of the text is
 * lost (only runs of blank lines collapse), and every observation on a
 * verse is found on the same verse in the list as in the text. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));

// The app's own modules, as the browser has them.
global.window = global;
require(path.join(ROOT, 'js', 'sections.js'));
const Verses = require(path.join(ROOT, 'js', 'verses.js'));
// Observations found in the text the old way (threads.js as it was in
// release 157), and in the list the new way.
vm.runInThisContext(execSync('git show f350b2e:js/threads.js', { cwd: ROOT, encoding: 'utf8' }));
const OldThreads = window.Threads;
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', 'threads.js'), 'utf8'));
const NewThreads = window.Threads;

admin.initializeApp({ projectId: 'talmaci' });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const args = process.argv.slice(2);
const mode = args.includes('--copy') ? 'copy' : args.includes('--sweep') ? 'sweep' : 'dry';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The lines that carry something, as compared: a mark's line without the
// space around it, which the list does not keep.
function lines(text) {
  return String(text || '').split('\n').filter(l => l.trim())
    .map(l => window.Sections.isMarker(l) ? l.trim() : l);
}

/* Every song, its versions, and their observations on a verse. */
async function readAll() {
  const songs = [];
  const snap = await db.collection('songs').get();
  for (const doc of snap.docs) {
    const vsnap = await doc.ref.collection('versions').get();
    const versions = [];
    for (const v of vsnap.docs) {
      const nsnap = await v.ref.collection('notes').get();
      versions.push({ ref: v.ref, id: v.id, data: v.data(),
        notes: nsnap.docs.map(n => ({ id: n.id, ...n.data() })).filter(n => n.anchor) });
    }
    songs.push({ ref: doc.ref, id: doc.id, data: doc.data(), versions });
  }
  return songs;
}

/* Writes in batches, as Firestore takes them: at most 500 at a time. */
async function commit(ops) {
  for (let i = 0; i < ops.length; i += 450) {
    const batch = db.batch();
    ops.slice(i, i + 450).forEach(op => op(batch));
    await batch.commit();
  }
}

function report(songs) {
  const out = { songs: songs.length, versions: 0, verses: 0, translatedOnly: [], lost: [], anchors: [],
    midMarks: 0, alreadyLists: 0, notesChecked: 0 };
  const check = (where, text) => {
    const verses = Verses.fromText(text);
    out.verses += verses.length;
    if (!same(lines(text), lines(Verses.toText(verses)))) out.lost.push(where);
    out.midMarks += verses.filter(v => v.lyrics.split('\n').some(l => window.Sections.isMarker(l))).length;
    return verses;
  };
  for (const s of songs) {
    if (s.data.originalVerses) out.alreadyLists++;
    check(`song ${s.id} (${s.data.title}) original`, s.data.originalText);
    if (!s.versions.length && s.data.translatedText) out.translatedOnly.push(`${s.id} (${s.data.title})`);
    for (const v of s.versions) {
      out.versions++;
      if (v.data.verses) out.alreadyLists++;
      const text = v.data.text || '';
      const verses = check(`version ${s.id}/${v.id} (${s.data.title} — ${v.data.title})`, text);
      for (const n of v.notes) {
        out.notesChecked++;
        const was = OldThreads.locate(text, n.anchor), now = NewThreads.locate(verses, n.anchor);
        if (!same(was, now)) out.anchors.push({ where: `${s.id}/${v.id}/${n.id}`, was, now });
      }
    }
  }
  return out;
}

async function copy(songs) {
  const backup = { at: new Date().toISOString(), songs: {} };
  for (const s of songs) {
    backup.songs[s.id] = {
      title: s.data.title,
      originalText: s.data.originalText ?? null,
      translatedText: s.data.translatedText ?? null,
      versions: Object.fromEntries(s.versions.map(v => [v.id, v.data.text ?? null]))
    };
  }
  const dir = path.join(__dirname, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `backup-${backup.at.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));
  console.log('Backup:', path.relative(ROOT, file));

  const ops = [];
  let made = 0;
  for (const s of songs) {
    if (!s.data.originalVerses) {
      const originalVerses = Verses.fromText(s.data.originalText);
      ops.push(b => b.update(s.ref, { originalVerses }));
    }
    for (const v of s.versions) {
      if (v.data.verses) continue;
      const verses = Verses.fromText(v.data.text);
      ops.push(b => b.update(v.ref, { verses }));
    }
    if (!s.versions.length && s.data.translatedText) {
      const now = Date.now();
      const ref = s.ref.collection('versions').doc();
      const doc = { title: 'Versiunea 1', verses: Verses.fromText(s.data.translatedText),
        createdBy: s.data.createdBy, createdAt: now, updatedAt: now };
      ops.push(b => b.set(ref, doc));
      made++;
    }
  }
  await commit(ops);
  console.log(`Written: ${ops.length - made} lists, ${made} versions made from translatedText.`);
}

async function sweep(songs, backupFile) {
  const backup = JSON.parse(fs.readFileSync(path.resolve(backupFile), 'utf8'));
  const ops = [], conflicts = [];
  let redone = 0, dropped = 0;
  // An old field still there: unchanged since the copy, it simply goes;
  // changed by an old app since, the list is made again from it — unless
  // the list has been written in since too, which is left for a person.
  const settle = (ref, where, data, oldKey, newKey, before) => {
    if (data[oldKey] === undefined) return;
    const old = data[oldKey] || '';
    const patch = {};
    if (!data[newKey]) {
      patch[newKey] = Verses.fromText(old);
      redone++;
    } else if (before !== undefined && before !== null && old !== before) {
      if (!same(data[newKey], Verses.fromText(before))) { conflicts.push(where); return; }
      patch[newKey] = Verses.fromText(old);
      redone++;
    }
    patch[oldKey] = FieldValue.delete();
    dropped++;
    ops.push(b => b.update(ref, patch));
  };
  for (const s of songs) {
    const was = backup.songs[s.id] || { versions: {} };
    settle(s.ref, `song ${s.id} (${s.data.title})`, s.data, 'originalText', 'originalVerses', was.originalText);
    if (s.data.translatedText !== undefined) {
      ops.push(b => b.update(s.ref, { translatedText: FieldValue.delete() }));
      dropped++;
    }
    for (const v of s.versions) {
      settle(v.ref, `version ${s.id}/${v.id} (${s.data.title} — ${v.data.title})`, v.data, 'text', 'verses', was.versions[v.id]);
    }
  }
  await commit(ops);
  console.log(`Old fields deleted: ${dropped}. Lists made again from an old app's edit: ${redone}.`);
  if (conflicts.length) console.log('Left as they are, edited in both since the copy:\n  ' + conflicts.join('\n  '));
}

(async () => {
  const songs = await readAll();
  const r = report(songs);
  console.log(`Songs: ${r.songs}, versions: ${r.versions}, verses: ${r.verses}, observations on a verse: ${r.notesChecked}`);
  console.log(`Already lists: ${r.alreadyLists}. Verses with a mark among their lyrics (kept as lyrics): ${r.midMarks}`);
  console.log(`Songs with only translatedText: ${r.translatedOnly.length}` + (r.translatedOnly.length ? '\n  ' + r.translatedOnly.join('\n  ') : ''));
  console.log(`Texts losing a line: ${r.lost.length}` + (r.lost.length ? '\n  ' + r.lost.join('\n  ') : ''));
  console.log(`Observations found elsewhere than before: ${r.anchors.length}`);
  r.anchors.forEach(a => console.log('  ' + a.where, JSON.stringify(a.was), '->', JSON.stringify(a.now)));
  if (mode === 'copy') {
    if (r.lost.length || r.anchors.length) { console.log('Not copying: fix the above first.'); process.exit(1); }
    await copy(songs);
  } else if (mode === 'sweep') {
    const file = args[args.indexOf('--sweep') + 1];
    if (!file) { console.log('--sweep needs the backup file --copy wrote.'); process.exit(1); }
    await sweep(songs, file);
  } else {
    console.log('Dry run: nothing written.');
  }
})().catch(err => { console.error(err); process.exit(1); });
