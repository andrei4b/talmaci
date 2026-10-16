/* verses.js — a song's text as it is stored: a list of its verses.
 *
 * The original and every version are each a list of { mark, lyrics }:
 * `mark` is the verse's section as written between the brackets ("Verse
 * 2", "Refren", "…" for a stand-in), '' for none; `lyrics` its lines,
 * blank ones and all. A verse ends where its entry does, so a blank line
 * is just a line, wherever it is typed or pasted.
 *
 * Text is still how a verse is quoted (an observation's anchor) and how a
 * song goes to Google Translate: each verse as its mark's line, then its
 * lyrics, and the verses one after another with a blank line between.
 *
 * Also loaded by the migration (tools/migrate-verses), which is how songs
 * stored as one string came to be lists. */
(function (root) {

const Sections = () => root.Sections;

// A verse as read from Firestore, or anywhere else, in its usual shape.
const verse = (v) => ({ mark: String((v && v.mark) || ''), lyrics: String((v && v.lyrics) || '') });

// A stored list, or none.
function read(list) {
  return Array.isArray(list) ? list.map(verse) : [];
}

/* The verses of a text written the old way: runs of lines between blank
 * lines, each opening with its mark's line, if it has one. */
function fromText(text) {
  const runs = [];
  let cur = null;
  for (const line of String(text || '').split('\n')) {
    if (line.trim()) {
      if (cur) cur.push(line);
      else runs.push(cur = [line]);
    } else {
      cur = null;
    }
  }
  return runs.map(lines => Sections().isMarker(lines[0])
    ? { mark: lines[0].trim().slice(1, -1), lyrics: lines.slice(1).join('\n') }
    : { mark: '', lyrics: lines.join('\n') });
}

// One verse as text: its mark's line, then its lyrics.
function text(v) {
  if (!v.mark) return v.lyrics;
  return v.lyrics ? '[' + v.mark + ']\n' + v.lyrics : '[' + v.mark + ']';
}

// The verses as one text, a blank line between each.
function toText(list) {
  return (list || []).map(text).join('\n\n');
}

// A verse's section (see Sections.parse), or null when it has no mark.
function section(v) {
  return v && v.mark ? Sections().parse('[' + v.mark + ']') : null;
}

// Whether there is any lyric in the list at all.
function hasLyrics(list) {
  return (list || []).some(v => v.lyrics.trim());
}

const Verses = { read, fromText, text, toText, section, hasLyrics };
root.Verses = Verses;
if (typeof module !== 'undefined' && module.exports) module.exports = Verses;

})(typeof window !== 'undefined' ? window : globalThis);
