/* activity.js — the group's activity log: who changed what, and when.
 *
 * Every change to a shared song is written here as one entry, from the
 * places in the UI that make it. Any member reads the whole list on the
 * "Jurnal de activitate" screen (#/jurnal, reached from the account menu),
 * or one song's entries from that song's menu (openForSong).
 *
 * Entries live under the group, groups/{groupId}/activity/{entryId}:
 *   {
 *     action: string,       // one of the keys of DESCRIBE below
 *     by: uid,
 *     byName: string,       // the author's name when it was written, for
 *                           // a member who has since left the group
 *     songId: string,
 *     songTitle: string,    // the title at the time, so an entry for a
 *                           // since-deleted or renamed song still reads
 *     versionTitle?: string,
 *     versionId?: string,   // for 'note_added', with noteId: which
 *     noteId?: string,      // observation, so its notification can carry
 *                           // the text (see functions/index.js); absent
 *                           // on entries before release 128
 *     section?: string,     // for 'note_added' on a verse: its name
 *     reply?: boolean,      // for 'note_added' answering another, with
 *     threadId?: string,    // the thread's first observation (release 133)
 *     status?: string,      // for 'status'
 *     working?: boolean,    // for 'working'
 *     fields?: string[],    // for 'song_edited': which details changed
 *     fileName?: string,    // for 'score_added'/'score_deleted': the
 *                           // sheet music file's name
 *     at: number (ms)
 *   }
 * A subcollection of the group rather than a top-level collection so the
 * newest-first query needs only the single-field index Firestore builds by
 * itself, not a composite one to be created by hand.
 *
 * A personal song is never logged: it is not the group's, and not even an
 * admin may see it (see firestore.rules).
 *
 * Writing the log is fire-and-forget. A change that saved but failed to be
 * logged is still saved, and the person making it is not told — the log is
 * for looking back, not something their work should wait on.
 *
 * Text is saved as it is typed, every few seconds, so one sitting of
 * editing would otherwise be dozens of entries. A text edit to the same
 * thing by the same person within COALESCE_MS of their last one moves that
 * entry's time forward instead of adding another. Kept in memory only, so
 * a reload starts a new entry, which is fine. */
(function () {
const { el, toast, icons, isShared, statusLabel, openSheet, closeSheet, isNetworkError, failText, offlineNotice } = window.Utils;

const COALESCE_MS = 15 * 60 * 1000;
// How often a coalesced entry's time is moved forward at most — saves come
// every few seconds, and each bump is a write.
const BUMP_MS = 60 * 1000;
const PAGE_SIZE = 50;

function _ref(groupId) {
  return firebase.firestore().collection('groups').doc(groupId).collection('activity');
}

// key -> { id, at, bumpedAt } for text edits that may be coalesced.
const _recent = new Map();

/* Record a change to `song`. `extra` carries the action's own fields
 * (versionTitle, status, ...). `coalesceKey`, given only for text edits,
 * names what was edited so repeated saves fold into one entry. */
function log(song, action, extra, coalesceKey) {
  if (!song || !isShared(song)) return;
  const user = window.Auth.currentUser();
  const groupId = window.Auth.currentGroupId();
  if (!user || !groupId) return;
  const now = Date.now();

  if (coalesceKey) {
    const key = [user.uid, song.id, action, coalesceKey].join('|');
    const prev = _recent.get(key);
    if (prev && now - prev.at < COALESCE_MS) {
      prev.at = now;
      if (prev.id && now - prev.bumpedAt >= BUMP_MS) {
        prev.bumpedAt = now;
        _ref(groupId).doc(prev.id).update({ at: now }).catch(() => {});
      }
      return;
    }
    const entry = { id: null, at: now, bumpedAt: now };
    _recent.set(key, entry);
    _write(groupId, user, song, action, extra, now).then(id => { entry.id = id; });
    return;
  }
  _write(groupId, user, song, action, extra, now);
}

function _write(groupId, user, song, action, extra, at) {
  return _ref(groupId).add({
    action,
    by: user.uid,
    byName: user.displayName || (user.email || '').split('@')[0] || '',
    songId: song.id,
    songTitle: song.title || '',
    ...(extra || {}),
    at
  }).then(ref => ref.id).catch(() => null);
}

async function _list(groupId, after) {
  window.Utils.requireOnline();
  let q = _ref(groupId).orderBy('at', 'desc');
  if (after) q = q.startAfter(after);
  const snap = await q.limit(PAGE_SIZE).get();
  return {
    entries: snap.docs.map(d => ({ id: d.id, ...d.data() })),
    last: snap.docs.length === PAGE_SIZE ? snap.docs[snap.docs.length - 1] : null
  };
}

// One song's entries, newest first. Filtered on songId alone and sorted
// here: adding orderBy('at') to it would need a composite index created by
// hand, and a song's own log stays small enough to fetch whole.
async function _listForSong(groupId, songId) {
  window.Utils.requireOnline();
  const snap = await _ref(groupId).where('songId', '==', songId).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((x, y) => y.at - x.at);
}

// ---- the screen ----

const FIELD_LABELS = { title: 'titlul', demoUrl: 'linkul demo' };

/* What an entry says. `before`/`after` go around the song's title, for
 * the group's log; `own` is the same sentence without it, for the log of
 * one song, where naming the song every line would only be noise. `a` is
 * the auxiliary, conjugated for who did it — "Ana a creat" but "Tu ai
 * creat" — and `you` picks the second person for the one verb not built
 * on it. */
const DESCRIBE = {
  song_created: (e, a) => ({ before: `${a} creat melodia`, own: `${a} creat melodia` }),
  song_deleted: (e, a) => ({ before: `${a} șters melodia`, own: `${a} șters melodia` }),
  song_edited: (e, a) => {
    const what = (e.fields || []).map(f => FIELD_LABELS[f] || f).join(' și ') || 'detaliile';
    return { before: `${a} modificat ${what} la`, own: `${a} modificat ${what}` };
  },
  original_text: (e, a) => ({ before: `${a} editat originalul din`, own: `${a} editat originalul` }),
  version_text: (e, a) => {
    const v = `„${e.versionTitle || 'o versiune'}”`;
    return { before: `${a} editat ${v} din`, own: `${a} editat ${v}` };
  },
  version_added: (e, a) => {
    const v = `„${e.versionTitle || 'o versiune'}”`;
    return { before: `${a} adăugat ${v} la`, own: `${a} adăugat ${v}` };
  },
  version_renamed: (e, a) => {
    const v = `în „${e.versionTitle || ''}”`;
    return { before: `${a} redenumit o versiune din`, after: v, own: `${a} redenumit o versiune ${v}` };
  },
  version_deleted: (e, a) => {
    const v = `„${e.versionTitle || 'o versiune'}”`;
    return { before: `${a} șters ${v} din`, own: `${a} șters ${v}` };
  },
  note_added: (e, a) => {
    const v = `„${e.versionTitle || 'o versiune'}”` + (e.section ? ` (${e.section})` : '');
    const what = e.reply ? `${a} răspuns la o observație la ${v}` : `${a} lăsat o observație la ${v}`;
    return { before: `${what} din`, own: what };
  },
  score_added: (e, a) => {
    const f = `partitura „${e.fileName || ''}”`;
    return { before: `${a} adăugat ${f} la`, own: `${a} adăugat ${f}` };
  },
  score_deleted: (e, a) => {
    const f = `partitura „${e.fileName || ''}”`;
    return { before: `${a} șters ${f} din`, own: `${a} șters ${f}` };
  },
  status: (e, a) => {
    const v = `ca „${statusLabel(e.status)}”`;
    return { before: `${a} marcat`, after: v, own: `${a} marcat melodia ${v}` };
  },
  working: (e, a, you) => {
    const verb = e.working
      ? (you ? 'lucrezi acum la' : 'lucrează acum la')
      : (you ? 'nu mai lucrezi la' : 'nu mai lucrează la');
    return { before: verb, own: verb + ' ea' };
  }
};

const MONTHS = ['ian.', 'feb.', 'mar.', 'apr.', 'mai', 'iun.', 'iul.', 'aug.', 'sept.', 'oct.', 'nov.', 'dec.'];

/* Minutes or hours ago while that is still the easier thing to read, the
 * day and hour after that. */
function formatWhen(at, now) {
  const diff = Math.max(0, now - at);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'chiar acum';
  if (min < 60) return `acum ${min} min`;
  const d = new Date(at);
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  if (diff < 6 * 3600000) return `acum ${Math.floor(min / 60)} h`;
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const dayStart = new Date(at); dayStart.setHours(0, 0, 0, 0);
  const days = Math.round((today - dayStart) / 86400000);
  if (days === 0) return `azi, ${hm}`;
  if (days === 1) return `ieri, ${hm}`;
  const year = d.getFullYear() !== today.getFullYear() ? ' ' + d.getFullYear() : '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year}, ${hm}`;
}

let _gen = 0;

async function render(root) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'topbar' }, [
    el('button', { class: 'btn btn--icon', 'aria-label': 'Înapoi', html: icons.back, onclick: () => window.App.goUpToList() }),
    el('h1', { class: 'topbar__title' }, ['Jurnal de activitate'])
  ]));
  const wrap = el('div', { class: 'song-list-wrap' });
  root.appendChild(wrap);

  wrap.appendChild(el('div', { class: 'loading-state' }, [el('div', { class: 'spinner' }), 'Se încarcă…']));
  const gen = ++_gen;
  const groupId = window.Auth.currentGroupId();
  let page, members;
  try {
    [page, members] = await Promise.all([_list(groupId, null), window.Auth.groupMembers()]);
  } catch (err) {
    if (gen !== _gen) return;
    wrap.innerHTML = '';
    wrap.appendChild(isNetworkError(err)
      ? offlineNotice({ text: 'Jurnalul nu se poate încărca fără internet.', retry: () => render(root) })
      : el('div', { class: 'empty-state' }, ['Nu am putut încărca jurnalul: ' + err.message]));
    return;
  }
  if (gen !== _gen) return;

  const names = new Map(members.map(m => [m.uid, window.Auth.shortName(m)]));
  const me = window.Auth.currentUser().uid;
  wrap.innerHTML = '';
  if (!page.entries.length) {
    wrap.appendChild(el('div', { class: 'empty-state' }, ['Nicio modificare înregistrată încă.']));
    return;
  }
  const ul = el('ul', { class: 'activity-list' });
  wrap.appendChild(ul);
  const addEntries = (entries) => {
    const now = Date.now();
    entries.forEach(e => ul.appendChild(_renderEntry(e, names, me, now)));
  };
  addEntries(page.entries);

  let last = page.last;
  if (last) {
    const more = el('button', { class: 'btn btn--wide activity-more' }, ['Mai vechi']);
    more.addEventListener('click', async () => {
      more.disabled = true;
      try {
        const next = await _list(groupId, last);
        addEntries(next.entries);
        last = next.last;
        if (!last) more.remove();
      } catch (err) {
        toast(failText('Nu am putut încărca', err), { kind: 'error' });
      }
      more.disabled = false;
    });
    wrap.appendChild(more);
  }
}

/* One song's log, in a sheet over the song. */
async function openForSong(song) {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (ev) => { if (ev.target === overlay) closeSheet(overlay); } });
  const body = el('div', {}, [el('div', { class: 'loading-state' }, [el('div', { class: 'spinner' })])]);
  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Jurnal']),
    body
  ]));
  openSheet(overlay);

  let entries, members;
  try {
    [entries, members] = await Promise.all([
      _listForSong(window.Auth.currentGroupId(), song.id),
      window.Auth.groupMembers()
    ]);
  } catch (err) {
    body.innerHTML = '';
    body.appendChild(isNetworkError(err)
      ? offlineNotice({ text: 'Jurnalul nu se poate încărca fără internet.' })
      : el('div', { class: 'empty-state' }, ['Nu am putut încărca jurnalul: ' + err.message]));
    return;
  }
  body.innerHTML = '';
  if (!entries.length) {
    body.appendChild(el('div', { class: 'empty-state' }, ['Nicio modificare înregistrată încă.']));
    return;
  }
  const names = new Map(members.map(m => [m.uid, window.Auth.shortName(m)]));
  const me = window.Auth.currentUser().uid;
  const now = Date.now();
  body.appendChild(el('ul', { class: 'activity-list' },
    entries.map(e => _renderEntry(e, names, me, now, true))));
}

function _renderEntry(e, names, me, now, inSong) {
  const you = e.by === me;
  const who = you ? 'Tu' : (names.get(e.by) || e.byName || 'Cineva');
  const a = you ? 'ai' : 'a';
  const describe = DESCRIBE[e.action] || (() => ({ before: `${a} modificat`, own: `${a} modificat` }));
  const { before, after, own } = describe(e, a, you);
  const when = el('time', { class: 'activity__when', datetime: new Date(e.at).toISOString(), title: new Date(e.at).toLocaleString('ro-RO') }, [formatWhen(e.at, now)]);
  if (inSong) {
    return el('li', { class: 'activity' }, [
      el('div', { class: 'activity__text' }, [el('strong', {}, [who]), ' ' + own]),
      when
    ]);
  }
  const title = e.songTitle || 'Fără titlu';
  // A deleted song has nowhere to go; everything else opens it.
  const songEl = e.action === 'song_deleted'
    ? el('span', { class: 'activity__song' }, [title])
    : el('a', { class: 'activity__song', href: `#/song/${encodeURIComponent(e.songId)}` }, [title]);
  return el('li', { class: 'activity' }, [
    el('div', { class: 'activity__text' }, [
      el('strong', {}, [who]), ' ' + before + ' ', songEl, after ? ' ' + after : null
    ]),
    when
  ]);
}

window.Activity = { log, render, openForSong, formatWhen };

})();
