/* threads.js — observations on one verse of a version, and the replies to
 * an observation (see db.js for how they are stored).
 *
 * A verse has no id of its own: it is a run of lines between blank lines,
 * and the text it lives in is edited freely afterwards. So an observation
 * on a verse does not point at a place in the text. It remembers what it
 * was left on — the verse's section mark, which of the verses with that
 * mark it was, its position, and the verse itself as it read then — and
 * the verse is looked for again every time the text is shown:
 *
 *   1. the same words, wherever they are now;
 *   2. the same section mark, the same one of them — "the second Refren";
 *   3. words close enough to the old ones;
 *   4. for a verse that had no mark, whatever unmarked verse is in its
 *      place now.
 *
 * Found by anything but the first, the verse has changed since, and the
 * observation says so and keeps the old text to compare. Not found at all,
 * it is still listed with the version's own, under the old text.
 *
 * A section sung more than once — a chorus — is one section: its
 * observations show on every verse with its mark, and on every verse with
 * exactly its words when it has none. */
(function () {

/* Each verse of a text: { start, end } offsets of its lines, without the
 * blank lines around it. */
function verses(text) {
  const out = [];
  let pos = 0, cur = null;
  for (const line of String(text || '').split('\n')) {
    const end = pos + line.length;
    if (line.trim()) {
      if (cur) cur.end = end;
      else { cur = { start: pos, end }; out.push(cur); }
    } else {
      cur = null;
    }
    pos = end + 1;
  }
  return out;
}

// A verse's section mark, as a key the same in either spelling of it, and
// its name to show; or null when its first line is not a mark.
function _mark(verse) {
  const sec = window.Sections.parse(String(verse).split('\n')[0]);
  if (!sec) return null;
  return {
    key: sec.kind ? (sec.kind + ' ' + (sec.number || '')).trim() : sec.text.toLowerCase(),
    name: window.Sections.romanian(sec)
  };
}

// The words of a verse without its mark, as they are compared.
function _body(verse) {
  const lines = String(verse).split('\n');
  if (window.Sections.isMarker(lines[0])) lines.shift();
  return lines.join(' ').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// How alike two verses' words are, from 0 to 1 (Dice, over words).
function _likeness(a, b) {
  const wa = a.split(' ').filter(Boolean), wb = b.split(' ').filter(Boolean);
  if (!wa.length || !wb.length) return 0;
  const count = new Map();
  wa.forEach(w => count.set(w, (count.get(w) || 0) + 1));
  let common = 0;
  wb.forEach(w => { const n = count.get(w); if (n) { common++; count.set(w, n - 1); } });
  return 2 * common / (wa.length + wb.length);
}
const LIKE_ENOUGH = 0.5;

/* What an observation on verse `index` of `text` remembers of it. */
function anchorFor(text, index) {
  const vs = verses(text).map(v => text.slice(v.start, v.end));
  const quote = vs[index] || '';
  const mark = _mark(quote);
  return {
    key: mark ? mark.key : null,
    name: mark ? mark.name : null,
    nth: mark ? vs.slice(0, index).filter(v => { const m = _mark(v); return m && m.key === mark.key; }).length : 0,
    pos: index,
    quote
  };
}

/* Where an anchored observation is in `text` now:
 *   { at: [verse indices it shows on], home: the verse it was left on or
 *     -1, changed: whether that verse reads differently now }
 * `at` is empty when the verse is not found. */
function locate(text, anchor) {
  const vs = verses(text).map(v => text.slice(v.start, v.end));
  const info = vs.map(v => ({ mark: _mark(v), body: _body(v) }));
  const quoteBody = _body(anchor.quote || '');
  const sameMark = (key) => key ? info.map((x, i) => i).filter(i => info[i].mark && info[i].mark.key === key) : [];
  // Every verse of the home verse's section, or with its very words.
  const result = (home, changed) => {
    const at = new Set([home]);
    const key = info[home].mark && info[home].mark.key;
    sameMark(key).forEach(i => at.add(i));
    if (!key && info[home].body) info.forEach((x, i) => { if (!x.mark && x.body === info[home].body) at.add(i); });
    return { at: [...at].sort((a, b) => a - b), home, changed };
  };

  if (quoteBody) {
    const same = info.map((x, i) => i).filter(i => info[i].body === quoteBody);
    if (same.length) {
      const marked = anchor.key ? same.filter(i => info[i].mark && info[i].mark.key === anchor.key) : [];
      const pick = marked.length ? marked[Math.min(anchor.nth || 0, marked.length - 1)]
        : same.reduce((a, b) => Math.abs(b - anchor.pos) < Math.abs(a - anchor.pos) ? b : a);
      return result(pick, false);
    }
  }
  const marked = sameMark(anchor.key);
  if (marked.length) {
    const home = marked[Math.min(anchor.nth || 0, marked.length - 1)];
    return result(home, info[home].body !== quoteBody);
  }
  if (quoteBody) {
    let best = -1, bestLike = LIKE_ENOUGH;
    info.forEach((x, i) => {
      const like = _likeness(quoteBody, x.body);
      if (like >= bestLike) { best = i; bestLike = like; }
    });
    if (best >= 0) return result(best, true);
  }
  if (!anchor.key && anchor.pos < info.length && !info[anchor.pos].mark) {
    return result(anchor.pos, info[anchor.pos].body !== quoteBody);
  }
  return { at: [], home: -1, changed: true };
}

/* A version's observations, flat and in the order they were left, as
 * threads: [{ id, root, replies, anchor, at, last }], by when each last
 * had something added. `root` is null when the first observation of a
 * thread was deleted after it had replies; the replies stay, and carry
 * the anchor for that reason. */
function group(notes) {
  const byId = new Map();
  const threads = [];
  (notes || []).filter(n => !n.parentId).forEach(n => {
    const t = { id: n.id, root: n, replies: [], anchor: n.anchor || null };
    byId.set(n.id, t);
    threads.push(t);
  });
  (notes || []).filter(n => n.parentId).forEach(n => {
    let t = byId.get(n.parentId);
    if (!t) {
      t = { id: n.parentId, root: null, replies: [], anchor: n.anchor || null };
      byId.set(n.parentId, t);
      threads.push(t);
    }
    t.replies.push(n);
  });
  threads.forEach(t => {
    t.replies.sort((a, b) => a.at - b.at);
    const all = (t.root ? [t.root] : []).concat(t.replies);
    t.at = all[0].at;
    t.last = all[all.length - 1].at;
    t.notes = all;
    t.resolved = !!(t.root && t.root.resolved);
  });
  return threads.sort((a, b) => a.last - b.last);
}

/* What to call the verse an anchor is on: its section's name, or for a
 * verse with no mark, its first line. */
function label(anchor) {
  if (!anchor) return '';
  if (anchor.name) return anchor.name;
  const first = String(anchor.quote || '').split('\n').find(l => l.trim()) || '';
  const t = first.trim();
  return '„' + (t.length > 32 ? t.slice(0, 31).trimEnd() + '…' : t) + '”';
}

window.Threads = { verses, anchorFor, locate, group, label };
})();
