/* scores.js — what a song has besides its text, in one sheet from its
 * menu (Audio și partituri): the link to a recording of it, and its sheet
 * music.
 *
 * The link is the song's demoUrl, set here by whoever may edit the song.
 *
 * The sheet music is images or PDFs attached to it. Any member who can see
 * the song adds them;
 * whoever added one, whoever created the song, or an admin deletes it —
 * enforced for real in firestore.rules and storage.rules, this only shows
 * the delete button to match. A file opens in a new tab, in the browser's
 * own viewer, which pages and zooms a score better than anything here
 * could. Where they are kept: see Db.addScore. */
(function () {
const { el, toast, icons, openSheet, closeSheet, closeSheetThen, failText, normalizeUrl } = window.Utils;

function _size(bytes) {
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
}

function _canDelete(song, score) {
  const me = window.Auth.currentUser().uid;
  return score.by === me || song.createdBy === me || window.Auth.isAdmin();
}

// Uploads in progress, by song, so the sheet opened again mid-upload still
// shows it and does not start a second one alongside.
const _uploading = new Map();

/* `canEdit`: whether this member may change the song itself (see
 * song-detail.js), which the link is part of. */
function open(song, canEdit) {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  const editLink = () => closeSheetThen(overlay, () => _openEditLink(song, canEdit));
  let host = '';
  try { host = song.demoUrl ? new URL(song.demoUrl).hostname.replace(/^www\./, '') : ''; } catch (_) { /* shown without */ }
  const linkRow = song.demoUrl
    ? el('div', { class: 'version-row' }, [
        el('a', { class: 'version-row__title score-row', href: song.demoUrl, target: '_blank', rel: 'noopener' }, [
          el('span', { class: 'score-row__name' }, ['Ascultă melodia']),
          el('span', { class: 'score-row__meta' }, [host])
        ]),
        el('button', {
          class: 'version-row__icon',
          'aria-label': 'Schimbă linkul',
          disabled: !canEdit,
          html: icons.edit,
          onclick: editLink
        })
      ])
    : canEdit
      ? el('button', { class: 'btn btn--wide', onclick: editLink }, ['+ Adaugă link către înregistrare'])
      : el('p', { class: 'sheet__text' }, ['Niciun link către o înregistrare.']);
  const list = el('div', { class: 'version-list' }, [el('p', { class: 'sheet__text' }, ['Se încarcă…'])]);
  const input = el('input', { type: 'file', accept: 'image/*,application/pdf', multiple: 'multiple', hidden: 'hidden' });
  const addBtn = el('button', { class: 'btn btn--wide', onclick: () => input.click() });
  let scores = null;

  function paintAdd() {
    const busy = _uploading.get(song.id);
    addBtn.disabled = !!busy;
    addBtn.textContent = busy ? busy.label : '+ Adaugă partitură';
  }

  function paint() {
    list.innerHTML = '';
    if (!scores.length) {
      list.appendChild(el('p', { class: 'sheet__text' }, ['Nicio partitură deocamdată.']));
      return;
    }
    scores.forEach(score => {
      const kind = score.type === 'application/pdf' ? 'PDF' : 'Imagine';
      const when = window.Activity.formatWhen(score.at, Date.now());
      list.appendChild(el('div', { class: 'version-row' }, [
        // A plain link, so the tab opens from the tap itself.
        el('a', { class: 'version-row__title score-row', href: score.url, target: '_blank', rel: 'noopener' }, [
          el('span', { class: 'score-row__name' }, [score.name]),
          el('span', { class: 'score-row__meta' }, [`${kind} · ${_size(score.size)} · ${score.byName || 'Cineva'}, ${when}`])
        ]),
        // Disabled rather than hidden, as in the version sheet.
        el('button', {
          class: 'version-row__icon version-row__icon--danger',
          'aria-label': 'Șterge partitura',
          disabled: !_canDelete(song, score),
          html: icons.trash,
          onclick: () => closeSheetThen(overlay, () => _confirmDelete(song, score, canEdit))
        })
      ]));
    });
  }

  async function upload(files) {
    const max = window.Db.SCORE_MAX_BYTES;
    const refused = files.find(f => !window.Db.scoreType(f));
    if (refused) { toast(`„${refused.name}” nu e o imagine sau un PDF.`, { kind: 'error' }); return; }
    const big = files.find(f => f.size > max);
    if (big) { toast(`„${big.name}” are peste ${max / 1024 / 1024} MB.`, { kind: 'error' }); return; }

    const user = window.Auth.currentUser();
    const who = { by: user.uid, byName: user.displayName || (user.email || '').split('@')[0] || '' };
    const busy = { label: '' };
    _uploading.set(song.id, busy);
    let added = 0;
    try {
      for (const [i, file] of files.entries()) {
        const step = files.length > 1 ? ` ${i + 1} din ${files.length}` : '';
        const progress = (fraction) => {
          busy.label = `Se încarcă${step}… ${Math.round(fraction * 100)}%`;
          if (overlay.isConnected) paintAdd();
        };
        progress(0);
        const score = await window.Db.addScore(song.id, file, who, progress);
        added++;
        window.Activity.log(song, 'score_added', { fileName: score.name });
        if (scores) { scores.push(score); if (overlay.isConnected) paint(); }
      }
      // Said only when there is no list in front of you to show it.
      if (!overlay.isConnected) toast(added > 1 ? 'Partiturile au fost adăugate.' : 'Partitura a fost adăugată.');
    } catch (err) {
      toast(failText('Nu am putut adăuga partitura', err), { kind: 'error' });
    } finally {
      _uploading.delete(song.id);
      if (overlay.isConnected) paintAdd();
    }
  }

  input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    if (files.length) upload(files);
  });

  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Audio și partituri']),
    el('span', { class: 'field__label' }, ['Înregistrare']),
    linkRow,
    el('span', { class: 'field__label score-heading' }, ['Partituri']),
    list,
    el('p', { class: 'sheet__text score-hint' }, ['Imagini sau PDF, de până la 20 MB fiecare.']),
    addBtn,
    input
  ]));
  paintAdd();
  openSheet(overlay);

  window.Db.listScores(song.id).then(found => {
    scores = found;
    if (overlay.isConnected) paint();
  }).catch(err => {
    list.innerHTML = '';
    list.appendChild(el('p', { class: 'sheet__text' }, [failText('Nu am putut încărca partiturile', err)]));
  });
}

// The link to a recording, as the song's own detail: saved, logged and
// told to the song list like an edit from Editează melodia was. Emptied,
// it is taken off.
function _openEditLink(song, canEdit) {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheetThen(overlay, () => open(song, canEdit)); } });
  const input = el('input', { class: 'field__input', type: 'url', placeholder: 'https://…', autocapitalize: 'off', autocomplete: 'off', value: song.demoUrl || '' });
  const back = () => closeSheetThen(overlay, () => open(song, canEdit));
  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Link către înregistrare']),
    el('label', { class: 'field' }, [el('span', { class: 'field__label' }, ['Link demo']), input]),
    el('div', { class: 'sheet__actions' }, [
      el('button', { class: 'btn', onclick: back }, ['Anulează']),
      el('button', {
        class: 'btn btn--primary',
        onclick: async () => {
          const demoUrl = normalizeUrl(input.value);
          if (demoUrl === null) { toast('Linkul demo nu este valid.', { kind: 'error' }); return; }
          if (demoUrl === (song.demoUrl || '')) { back(); return; }
          try {
            await window.Db.updateSong(song.id, { demoUrl });
            song.demoUrl = demoUrl;
            window.Activity.log(song, 'song_edited', { fields: ['demoUrl'] });
            window.Songs.noteUpdated(song.id, { demoUrl });
            back();
          } catch (err) {
            toast(failText('Nu am putut salva linkul', err), { kind: 'error' });
          }
        }
      }, ['Salvează'])
    ])
  ]));
  openSheet(overlay);
  input.focus();
}

function _confirmDelete(song, score, canEdit) {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Ștergi partitura?']),
    el('p', { class: 'sheet__text' }, [`Sigur vrei să ștergi „${score.name}”? Fișierul se pierde definitiv.`]),
    el('div', { class: 'sheet__actions' }, [
      el('button', { class: 'btn', onclick: () => closeSheetThen(overlay, () => open(song, canEdit)) }, ['Anulează']),
      el('button', {
        class: 'btn btn--danger-solid',
        onclick: async () => {
          try {
            await window.Db.deleteScore(song.id, score);
            window.Activity.log(song, 'score_deleted', { fileName: score.name });
            closeSheetThen(overlay, () => open(song, canEdit));
          } catch (err) {
            toast(failText('Nu am putut șterge partitura', err), { kind: 'error' });
          }
        }
      }, ['Șterge'])
    ])
  ]));
  openSheet(overlay);
}

window.Scores = { open };

})();
