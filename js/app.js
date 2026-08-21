/* app.js — boot sequence, sign-in/join gating, hash router, account menu. */
(function () {
const { $, el, toast, copyToClipboard, openSheet, closeSheet, icons } = window.Utils;

// ---- Keep sheets clear of the on-screen keyboard AND Chrome's autofill
// accessory bar (the key/card/location icon row) ----
// The visual viewport shrinks (and can shift) when either appears, but
// fixed-position elements stay sized to the full layout viewport by
// default. Mirror the visual viewport into CSS vars so .sheet-overlay/.sheet
// track it instead, keeping their buttons above both.
function syncViewportInsets() {
  const vv = window.visualViewport;
  const root = document.documentElement.style;
  root.setProperty('--vvh', (vv ? vv.height : window.innerHeight) + 'px');
  root.setProperty('--vv-top', (vv ? vv.offsetTop : 0) + 'px');
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', syncViewportInsets);
  window.visualViewport.addEventListener('scroll', syncViewportInsets);
}
syncViewportInsets();

async function boot() {
  _renderBootLoading();
  await window.Auth.ready();
  window.Auth.onChange(_renderCurrentScreen);
  window.addEventListener('hashchange', _renderCurrentScreen);
  _renderCurrentScreen();
}

function _renderBootLoading() {
  const root = $('#app');
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'loading-state' }, [
    el('div', { class: 'spinner' })
  ]));
}

function _renderCurrentScreen() {
  const root = $('#app');
  const user = window.Auth.currentUser();

  if (!user) return _renderSignIn(root);
  if (!user.groupId) return _renderJoinGroup(root);
  return _renderRoute(root);
}

/* ---- the shell ----
 * The four tabs are app-level destinations, not something a song owns, so
 * the bar is drawn under every screen — including the song list, which is
 * itself the Text tab's first screen. That is the whole point: Rime is
 * reachable without opening a song.
 *
 * Text is the only tab with a second level. It remembers where it was, so
 * going Rime -> Text lands back on the song you were reading rather than
 * dumping you at the top of the list. */
const TAB_ICONS = {
  text: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6M9 9h1"/></svg>`,
  rime: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>`,
  sinonime: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v14M3 13l4 4 4-4"/><path d="M17 21V7M13 11l4-4 4 4"/></svg>`,
  biblie: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5A2.5 2.5 0 0 1 4.5 2H12v18H4.5A2.5 2.5 0 0 0 2 22z"/><path d="M22 4.5A2.5 2.5 0 0 0 19.5 2H12v18h7.5a2.5 2.5 0 0 1 2.5 2z"/></svg>`
};

const TABS = [
  { id: 'text', label: 'Text', route: '#/' },
  { id: 'rime', label: 'Rime', route: '#/rime' },
  { id: 'sinonime', label: 'Sinonime', route: '#/sinonime' },
  { id: 'biblie', label: 'Biblie', route: '#/biblie' }
];

// Where the Text tab was last, so its button returns there.
let _textRoute = '#/';
// The route rendered before this one, used only to decide whether a song
// was opened from the list. Captured when a render starts, not when it
// ends — at the end of a render the "previous" route is the one just drawn.
let _prevRoute = null;
let _currentRoute = null;

/* Switching tabs REPLACES the current history entry instead of pushing a
 * new one. Tabs are places, not steps: pushing them made the hardware back
 * button walk back through every tab you had glanced at, so opening a
 * song, looking something up in Rime and returning to Text left back going
 * to Rime rather than up to the song list.
 *
 * With replacement the stack only ever holds real steps — the list, then
 * the song you opened — so back means the same thing whichever tab you
 * happen to be looking at. This is how tab bars behave in native apps.
 *
 * replaceState fires neither hashchange nor popstate, so the render has to
 * be called directly; and the existing state object is carried over,
 * because it records how the entry underneath was reached and replacing
 * the URL does not change that. */
function _switchTab(route) {
  if ((location.hash || '#/') === route) return;
  history.replaceState(history.state, '', route);
  _renderCurrentScreen();
}

/* "Up" from a song is the song list. history.back() is the right way there
 * whenever the song's own history entry was pushed from the list, since it
 * reuses that entry instead of pushing a second '#/' — which is what used
 * to let the stack grow without bound (list, song A, list, song B, ...)
 * until back kept resurfacing old songs.
 *
 * That is nearly always true, tab switches no longer pushing anything, but
 * not on a cold start: open a '#/song/x' link directly and the entry below
 * belongs to whatever site you came from. The flag written in _renderRoute
 * tells the two apart. */
function goUpToList() {
  const st = history.state;
  if (st && st.talmaciFromList) history.back();
  else location.hash = '#/';
}

function _tabForHash(hash) {
  const t = TABS.find(x => x.id !== 'text' && x.route === hash);
  return t ? t.id : 'text';
}

function _renderRoute(root) {
  const hash = location.hash || '#/';
  const tab = _tabForHash(hash);
  if (hash !== _currentRoute) { _prevRoute = _currentRoute; _currentRoute = hash; }
  if (tab === 'text') _textRoute = hash;

  // Record, once per entry, whether this song was opened from the list.
  // The list's links are plain anchors, so the push happens in the browser
  // rather than here and this is the first chance to mark it. A tab switch
  // later replaces the URL but carries the flag along, which is what keeps
  // back working after a detour through Rime.
  if (hash.startsWith('#/song/') && !history.state) {
    history.replaceState({ talmaciFromList: _prevRoute === '#/' }, '');
  }

  root.innerHTML = '';
  const content = el('div', { class: 'shell' });
  root.appendChild(content);

  if (tab === 'text') {
    const songMatch = hash.match(/^#\/song\/(.+)$/);
    if (songMatch) window.SongDetail.render(content, decodeURIComponent(songMatch[1]));
    else window.Songs.render(content);
  } else if (tab === 'rime') {
    _renderSimpleTab(content, 'Rime', (panel) => window.RimeTab.render(panel));
  } else {
    _renderSimpleTab(content, TABS.find(t => t.id === tab).label,
                     (panel) => panel.appendChild(_placeholderPanel(tab)));
  }

  root.appendChild(_renderTabBar(tab));
}

// A tab with nothing above it but its own name. The account menu is
// repeated here so signing out does not mean going back to the list first.
function _renderSimpleTab(content, title, fill) {
  content.appendChild(el('div', { class: 'topbar' }, [
    el('h1', { class: 'topbar__title' }, [title]),
    el('button', {
      class: 'btn btn--icon', 'aria-label': 'Cont',
      html: icons.kebab, onclick: () => openAccountMenu()
    })
  ]));
  const panel = el('div', { class: 'tab-content' });
  content.appendChild(panel);
  fill(panel);
}

function _placeholderPanel(tabId) {
  const copy = {
    sinonime: 'Aici vei putea căuta sinonime pentru cuvintele din traducere.',
    biblie: 'Aici vei putea vedea referințe biblice legate de text.'
  }[tabId] || '';
  return el('div', { class: 'empty-state' }, [
    el('p', {}, [copy]),
    el('p', { class: 'empty-state__hint' }, ['În curând.'])
  ]);
}

function _renderTabBar(activeTab) {
  const bar = el('div', { class: 'tab-bar', role: 'tablist' });
  TABS.forEach(tab => {
    const active = tab.id === activeTab;
    bar.appendChild(el('button', {
      class: 'tab-bar__tab' + (active ? ' tab-bar__tab--active' : ''),
      role: 'tab',
      'aria-selected': active ? 'true' : 'false',
      onclick: () => _switchTab(tab.id === 'text' ? _textRoute : tab.route)
    }, [
      el('span', { html: TAB_ICONS[tab.id], 'aria-hidden': 'true' }),
      tab.label
    ]));
  });
  // Publish the bar's real height so the scrolling panels above it can
  // reserve exactly that much room. Measured rather than guessed: the bar
  // grows by the safe-area inset on notched phones, and the fixed CSS
  // estimate it replaces was wrong on both kinds of device.
  requestAnimationFrame(() => {
    document.documentElement.style.setProperty('--tabbar-h', bar.offsetHeight + 'px');
  });
  return bar;
}

function _renderSignIn(root) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'gate' }, [
    el('div', { class: 'gate__card' }, [
      el('h1', { class: 'gate__title' }, ['Tălmaci']),
      el('p', { class: 'gate__subtitle' }, ['Your Song Translation Toolkit']),
      el('button', {
        class: 'btn btn--primary btn--wide',
        onclick: async (e) => {
          const btn = e.currentTarget;
          if (btn.disabled) return;
          _setButtonLoading(btn, 'primary', 'Continuă cu Google');
          try {
            await window.Auth.signInWithGoogle();
            // On success, Auth.onChange re-renders the whole screen, so
            // this button gets replaced — no need to reset it here.
          } catch (err) {
            toast('Autentificarea a eșuat: ' + err.message, { kind: 'error' });
            _resetButtonLoading(btn, 'Continuă cu Google');
          }
        }
      }, ['Continuă cu Google'])
    ])
  ]));
}

function _setButtonLoading(btn, kind, label) {
  btn.disabled = true;
  btn.innerHTML = '';
  btn.appendChild(el('span', { class: 'btn__spinner-wrap' }, [
    el('span', { class: 'spinner spinner--sm' + (kind === 'primary' ? ' spinner--on-primary' : '') }),
    label
  ]));
}

function _resetButtonLoading(btn, label) {
  btn.disabled = false;
  btn.textContent = label;
}

function _renderJoinGroup(root) {
  root.innerHTML = '';
  const codeInput = el('input', { class: 'field__input', type: 'text', placeholder: 'Cod de invitație', autofocus: true });
  root.appendChild(el('div', { class: 'gate' }, [
    el('div', { class: 'gate__card' }, [
      el('h1', { class: 'gate__title' }, ['Aproape gata']),
      el('p', { class: 'gate__subtitle' }, ['Introdu codul de invitație primit de la echipa ta.']),
      el('label', { class: 'field' }, [codeInput]),
      el('button', {
        class: 'btn btn--primary btn--wide',
        onclick: async (e) => {
          const btn = e.currentTarget;
          if (btn.disabled) return;
          _setButtonLoading(btn, 'primary', 'Alătură-te');
          try {
            await window.Auth.redeemInvite(codeInput.value);
            // Success re-renders via Auth.onChange, replacing this button.
          } catch (err) {
            toast(err.message, { kind: 'error' });
            _resetButtonLoading(btn, 'Alătură-te');
          }
        }
      }, ['Alătură-te']),
      el('button', {
        class: 'btn btn--text',
        onclick: () => window.Auth.signOut()
      }, ['Deconectează-te'])
    ])
  ]));
}

function openAccountMenu() {
  const user = window.Auth.currentUser();
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  const items = [
    el('div', { class: 'sheet__user' }, [user.displayName || user.email]),
    el('button', {
      class: 'btn btn--wide',
      onclick: () => { closeSheet(overlay); window.Songs.refresh(); }
    }, ['Reîmprospătează'])
  ];

  if (window.Auth.isAdmin()) {
    items.push(el('button', {
      class: 'btn btn--wide',
      onclick: async () => {
        try {
          const code = await window.Auth.createInvite();
          closeSheet(overlay);
          _openInviteCode(code);
        } catch (err) {
          toast(err.message, { kind: 'error' });
        }
      }
    }, ['Generează cod de invitație']));

    items.push(el('button', {
      class: 'btn btn--wide',
      onclick: () => { closeSheet(overlay); _openManageMembers(); }
    }, ['Gestionează membrii']));
  }

  items.push(el('button', {
    class: 'btn btn--wide',
    onclick: async () => { await window.Auth.signOut(); closeSheet(overlay); }
  }, ['Deconectează-te']));

  overlay.appendChild(el('div', { class: 'sheet' }, items));
  openSheet(overlay);
}

function _openInviteCode(code) {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  const copyBtn = el('button', { class: 'btn btn--wide' }, ['Copiază codul']);
  copyBtn.addEventListener('click', async () => {
    const ok = await copyToClipboard(code);
    toast(ok ? 'Cod copiat.' : 'Nu am putut copia codul.', ok ? {} : { kind: 'error' });
  });
  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Invită pe cineva']),
    el('p', { class: 'sheet__text' }, ['Trimite-i acest cod ca să se alăture grupului tău:']),
    el('div', { class: 'invite-code' }, [code]),
    copyBtn
  ]));
  openSheet(overlay);
}

async function _openManageMembers() {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  const listEl = el('div', { class: 'member-list' }, [
    el('div', { class: 'loading-state' }, [el('div', { class: 'spinner' })])
  ]);
  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Membri']),
    listEl
  ]));
  openSheet(overlay);

  let members;
  try {
    members = await window.Auth.listGroupMembers();
  } catch (err) {
    listEl.innerHTML = '';
    listEl.appendChild(el('div', { class: 'empty-state' }, ['Nu am putut încărca membrii: ' + err.message]));
    return;
  }

  members.sort((a, b) => (a.displayName || a.email || '').localeCompare(b.displayName || b.email || ''));
  const me = window.Auth.currentUser();

  listEl.innerHTML = '';
  if (!members.length) {
    listEl.appendChild(el('div', { class: 'empty-state' }, ['Niciun membru găsit.']));
  }
  members.forEach(m => {
    const isAdminRole = m.role === 'admin';
    listEl.appendChild(el('div', { class: 'member-row' }, [
      el('div', { class: 'member-row__info' }, [
        el('div', { class: 'member-row__name' }, [m.displayName || m.email || m.uid]),
        el('div', { class: 'member-row__meta' }, [m.email || ''])
      ]),
      el('button', {
        class: 'btn member-row__role-btn' + (isAdminRole ? ' member-row__role-btn--admin' : ''),
        onclick: (e) => _toggleMemberRole(e.currentTarget, m, members, me, overlay)
      }, [isAdminRole ? 'Admin' : 'Membru'])
    ]));
  });
}

async function _toggleMemberRole(btn, member, members, me, overlay) {
  const nextRole = member.role === 'admin' ? 'user' : 'admin';

  if (member.uid === me.uid && nextRole === 'user') {
    const hasOtherAdmin = members.some(x => x.uid !== me.uid && x.role === 'admin');
    if (!hasOtherAdmin) {
      toast('Ești singurul admin — fă pe altcineva admin mai întâi.', { kind: 'error' });
      return;
    }
    closeSheet(overlay);
    _confirmSelfDemote(member);
    return;
  }

  await _setMemberRole(btn, member, nextRole, overlay);
}

function _confirmSelfDemote(member) {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  overlay.appendChild(el('div', { class: 'sheet' }, [
    el('h2', { class: 'sheet__title' }, ['Renunți la rolul de admin?']),
    el('p', { class: 'sheet__text' }, ['Nu vei mai putea genera coduri de invitație sau gestiona membrii, până când altcineva te face din nou admin.']),
    el('div', { class: 'sheet__actions' }, [
      el('button', { class: 'btn', onclick: () => { closeSheet(overlay); _openManageMembers(); } }, ['Anulează']),
      el('button', {
        class: 'btn btn--danger-solid',
        onclick: async () => {
          try {
            await window.Auth.setMemberRole(member.uid, 'user');
            closeSheet(overlay);
            _openManageMembers();
          } catch (err) {
            toast(err.message, { kind: 'error' });
          }
        }
      }, ['Renunță'])
    ])
  ]));
  openSheet(overlay);
}

async function _setMemberRole(btn, member, nextRole, overlay) {
  btn.disabled = true;
  try {
    await window.Auth.setMemberRole(member.uid, nextRole);
    closeSheet(overlay);
    _openManageMembers();
  } catch (err) {
    toast(err.message, { kind: 'error' });
    btn.disabled = false;
  }
}

window.App = { boot, openAccountMenu, goUpToList };
boot();

})();
