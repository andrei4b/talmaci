/* sections.js — song sections (verse, chorus, bridge…) marked in the text.
 *
 * A section is marked by a line of its own holding its name in square
 * brackets: "[Refren]", "[Strofa 2]". Plain text rather than a field of
 * its own, on purpose: lyrics pasted from the web already arrive marked
 * this way ("[Verse 1]", "[Chorus]"), the marks travel with the text into
 * every version and every copy, and nothing in the stored data changes.
 *
 * Only in brackets, in the source text as much as in our own: a line that
 * says "Refren" or "Chorus:" may just as well be a lyric, and the brackets
 * are what says it is a mark. Pasted lyrics marked without them need the
 * brackets added once, by hand. */
(function () {

// English and Romanian spellings of each kind, and the Romanian name it is
// shown and inserted under. Order matters: pre-/post-chorus before chorus.
const KINDS = [
  { ro: 'Pre-refren',  re: /^(pre[- ]?chorus|pre[- ]?refren)$/ },
  { ro: 'Post-refren', re: /^(post[- ]?chorus|post[- ]?refren)$/ },
  { ro: 'Refren',      re: /^(chorus|refrain|refren)$/ },
  { ro: 'Strofa',      re: /^(verse|stanza|strof[aă])$/ },
  { ro: 'Bridge',      re: /^(bridge|pod|punte)$/ },
  { ro: 'Intro',       re: /^(intro)$/ },
  { ro: 'Interludiu',  re: /^(interlude|instrumental|interludiu)$/ },
  { ro: 'Final',       re: /^(outro|ending|end|coda|final)$/ },
  { ro: 'Tag',         re: /^(tag)$/ }
];

/* The section a line marks, or null when it is an ordinary line.
 * { text: the name as written, kind: Romanian name or null, number } */
function parse(line) {
  const t = String(line || '').trim();
  if (!t || t.length > 40) return null;
  const bracketed = /^\[(.+)\]$/.exec(t);
  if (!bracketed) return null;
  // "[Verse 2:]", "[(Chorus)]", "[Refren x2]" — the name, an optional
  // number, and the decorations pasted lyrics tend to add around it.
  const body = bracketed[1].trim()
    .replace(/^\((.*)\)$/, '$1').replace(/:$/, '').trim();
  const m = /^(.*?)(?:\s*(\d+))?(?:\s*[x×]\s*\d+)?$/i.exec(body);
  const name = m[1].trim().toLowerCase();
  const kind = KINDS.find(k => k.re.test(name));
  return { text: body, kind: kind ? kind.ro : null, number: m[2] ? +m[2] : null };
}

function isMarker(line) { return !!parse(line); }

/* How a section is named in a Romanian text: "Refren", "Strofa 2". A name
 * not in the list is kept as it was written. */
function romanian(sec) {
  if (!sec.kind) return sec.text;
  return sec.number ? sec.kind + ' ' + sec.number : sec.kind;
}

/* Every section mark in a text, in order, with the line it is on. */
function list(text) {
  const out = [];
  String(text || '').split('\n').forEach((line, i) => {
    const sec = parse(line);
    if (sec) out.push({ ...sec, line: i });
  });
  return out;
}

/* The text without its section marks, for places that show a few words of
 * a song (the song list), where "[Verse 1]" would be all you read. */
function strip(text) {
  return String(text || '').split('\n').filter(l => !isMarker(l)).join('\n').trim();
}

window.Sections = { parse, isMarker, romanian, list, strip };

})();
