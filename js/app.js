/* app.js — boot sequence, sign-in/join gating, hash router, account menu. */
(function () {
const { $, el, menuLabel, toast, copyToClipboard, openSheet, closeSheet, closeSheetThen, icons,
        isOffline, failText } = window.Utils;

// ---- Keep sheets clear of the on-screen keyboard AND Chrome's autofill
// accessory bar (the key/card/location icon row) ----
// The visual viewport shrinks (and can shift) when either appears, but
// fixed-position elements stay sized to the full layout viewport by
// default. Mirror the visual viewport into CSS vars so .sheet-overlay/.sheet
// track it instead, keeping their buttons above both.
function syncViewportInsets() {
  const vv = window.visualViewport;
  const root = document.documentElement.style;
  const vvh = vv ? vv.height : window.innerHeight;
  root.setProperty('--vvh', vvh + 'px');
  root.setProperty('--vv-top', (vv ? vv.offsetTop : 0) + 'px');
  // Roughly the keyboard's own height (0 when it's closed). .shell caps
  // itself to --vvh so it stops running behind the keyboard, but anything
  // inside it that pads its bottom edge to clear the fixed tab bar (which
  // is itself now sitting behind the keyboard, not at the bottom of the
  // shrunk visible area) would otherwise leave that same gap of dead space
  // above the keyboard instead of using it. window.innerHeight rather than
  // a vh unit for the "full" side of this subtraction, for the same
  // reliability reason #app itself avoids vh — see its own comment.
  root.setProperty('--keyboard-inset', Math.max(0, window.innerHeight - vvh) + 'px');
  if (vv && vv.offsetTop > 0) requestAnimationFrame(unpanViewport);
}

// Tapping a field low on the screen makes the browser slide the whole page
// up as the keyboard opens, so the caret is not hidden behind it. .shell
// then shrinks to fit above the keyboard anyway, and the slide is left
// over: the topbar pushed off the top and the same height of dead space
// above the keyboard. Undo the slide, and scroll the field's own scroller
// by as much instead, which leaves the caret exactly where it was on
// screen. Not while zoomed in, when panning is the user's own doing.
function unpanViewport() {
  const vv = window.visualViewport;
  const off = vv.offsetTop;
  if (off <= 0 || vv.scale > 1.01) return;
  window.scrollTo(0, 0);
  if (vv.offsetTop === off) return;
  for (let n = document.activeElement; n && n !== document.body; n = n.parentElement) {
    if (n.scrollHeight > n.clientHeight && /auto|scroll/.test(getComputedStyle(n).overflowY)) {
      n.scrollTop += off;
      break;
    }
  }
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', syncViewportInsets);
  window.visualViewport.addEventListener('scroll', syncViewportInsets);
}
syncViewportInsets();

async function boot() {
  _renderBootLoading();
  await window.Auth.ready();
  // Registered before the render listener so a new account's screen is
  // never drawn from the previous account's cached data.
  const firstUser = window.Auth.currentUser();
  let lastUid = firstUser ? firstUser.uid : null;
  window.Auth.onChange((user) => {
    const uid = user ? user.uid : null;
    if (uid === lastUid) return;
    lastUid = uid;
    _resetUserData();
  });
  window.Auth.onChange(_renderCurrentScreen);
  window.addEventListener('hashchange', _renderCurrentScreen);
  window.addEventListener('offline', () => toast('Ai rămas fără internet. Melodiile deschise deja, rimele și Biblia merg în continuare.'));
  window.addEventListener('online', _backOnline);
  _renderCurrentScreen();
  // The Bible (~4 MB) and the rhyme index (~5.7 MB): fetch and parse them
  // while the user is busy elsewhere so opening either tab never waits.
  // Idle-time so it can't delay first paint.
  const warm = () => { window.BibleTab.preload(); window.Rhyme.preload(); };
  if (window.requestIdleCallback) requestIdleCallback(warm, { timeout: 5000 });
  else setTimeout(warm, 2000);
}

/* Each screen that could not load retries on its own (see
 * Utils.offlineNotice); only the sign-in gates are redrawn from here. A
 * member whose profile could not be read at all — offline, on a device
 * that had never stored it — is on the join screen by mistake, and reading
 * it again puts them back in the app. */
function _backOnline() {
  toast('Conexiunea a revenit.');
  const user = window.Auth.currentUser();
  if (user && !user.groupId) window.Auth.refreshProfile();
  else if (!user) _renderCurrentScreen();
}

function _resetUserData() {
  window.Songs.reset();
  window.SongDetail.reset();
  // A song URL belongs to the previous account; don't carry it into the next.
  _textRoute = '#/';
  const h = location.hash || '';
  if (h.startsWith('#/song/') || h === '#/jurnal') history.replaceState(null, '', '#/');
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
  if (!user.groupId) return window.Auth.profileFailed() ? _renderProfileFailed(root) : _renderJoinGroup(root);
  return _renderRoute(root);
}

/* ---- the shell ----
 * The tabs are app-level destinations, not something a song owns, so
 * the bar is drawn under every screen — including the song list, which is
 * itself the Text tab's first screen. That is the whole point: Rime is
 * reachable without opening a song.
 *
 * Text has a second level, and remembers where it was, so going Rime ->
 * Text lands back on the song you were reading rather than dumping you at
 * the top of the list. Dicționare remembers which of its dictionaries
 * was open in the same way. */
const TAB_ICONS = {
  text: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6M9 9h1"/></svg>`,
  rime: icons.rime,
  dictionare: icons.dictionary,
  biblie: icons.bible
};

const TABS = [
  { id: 'text', label: 'Text', route: '#/' },
  { id: 'rime', label: 'Rime', route: '#/rime' },
  { id: 'dictionare', label: 'Dicționare', route: '#/sinonime' },
  { id: 'biblie', label: 'Biblie', route: '#/biblie' }
];

// Where the Text tab was last, so its button returns there.
let _textRoute = '#/';

/* The dictionaries behind the Dicționare tab, each with its own route
 * so the editor's lookup can open either. Romanian synonyms come first:
 * the translation is in Romanian, and that is where most lookups are. */
const DICTIONARIES = [
  { id: 'sinonime', label: 'Sinonime', route: '#/sinonime' },
  { id: 'engleza', label: 'Engleză', route: '#/engleza', module: () => window.EnglezaTab },
  { id: 'biblic', label: 'Biblic', route: '#/biblic', module: () => window.BiblicTab }
];
// Which of them the tab's button returns to.
let _dictRoute = '#/sinonime';

function _tabRoute(tab) {
  return tab.id === 'text' ? _textRoute
    : tab.id === 'dictionare' ? _dictRoute
    : tab.route;
}

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
 * Except when leaving a song. Going from a song to any other tab — by the
 * bar or by looking a word up — is a step away from the song, and back
 * should undo it rather than drop you at the list, so that one pushes an
 * entry that remembers the song. Moving on between the other tabs from
 * there replaces as usual, carrying that memory along, so back from
 * wherever you end up still returns to the song; and returning to the song
 * through the bar's Text tab steps back rather than replacing, which would
 * leave the song in the history twice.
 *
 * replaceState and pushState fire neither hashchange nor popstate, so the
 * render has to be called directly; and the existing state object is
 * carried over, because it records how the entry underneath was reached
 * and replacing the URL does not change that. */
function _switchTab(route) {
  const here = location.hash || '#/';
  if (here === route) return;
  if (history.state && history.state.talmaciFromSong === route) {
    history.back();
    return;
  }
  if (here.startsWith('#/song/')) {
    history.pushState({ talmaciFromSong: here }, '', route);
  } else {
    history.replaceState(history.state, '', route);
  }
  _renderCurrentScreen();
}

/* Another tab, by id, the way its button in the bar would open it — or one
 * of the dictionaries by its own id. Used by the editor's lookup buttons,
 * which hand Rime, Sinonime or the English dictionary a word first. */
function openTab(id) {
  const dict = DICTIONARIES.find(d => d.id === id);
  if (dict) return _switchTab(dict.route);
  const tab = TABS.find(t => t.id === id);
  if (tab) _switchTab(_tabRoute(tab));
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

/* A layer that survives re-rendering, for content that cannot be rebuilt
 * without losing its state.
 *
 * Only the Sinonime frame needs it, and it needs it badly: taking an iframe
 * out of the DOM and putting it back makes the browser reload it, so
 * keeping the same element is not enough — glancing at the Text tab threw
 * away whatever page you had reached inside dexonline. The only way to hold
 * it is never to unmount it, so this lives outside every render and is
 * hidden rather than removed.
 *
 * It sits after .shell visually through CSS order, not DOM order: moving it
 * to its right place would be another unmount, which is the whole problem.
 */
let _persist = null;

function _persistLayer(root) {
  if (!_persist) _persist = el('div', { class: 'persist', hidden: true });
  // The sign-in and join screens clear #app wholesale, which takes the
  // layer with it. Firebase can briefly report a signed-out user when a
  // token refresh fails after idle, so this does happen mid-session — and
  // without re-attaching here, Sinonime stayed an empty page from then on.
  if (_persist.parentNode !== root) root.appendChild(_persist);
  return _persist;
}

function _tabForHash(hash) {
  if (DICTIONARIES.some(d => d.route === hash)) return 'dictionare';
  const t = TABS.find(x => x.id !== 'text' && x.route === hash);
  return t ? t.id : 'text';
}

function _renderRoute(root) {
  const hash = location.hash || '#/';
  const tab = _tabForHash(hash);
  if (hash !== _currentRoute) { _prevRoute = _currentRoute; _currentRoute = hash; }
  if (tab === 'text') _textRoute = hash;
  if (tab === 'dictionare') _dictRoute = hash;

  // Record, once per entry, whether this song was opened from the list.
  // The list's links are plain anchors, so the push happens in the browser
  // rather than here and this is the first chance to mark it. A tab switch
  // later replaces the URL but carries the flag along, which is what keeps
  // back working after a detour through Rime.
  if ((hash.startsWith('#/song/') || hash === '#/jurnal') && !history.state) {
    history.replaceState({ talmaciFromList: _prevRoute === '#/' }, '');
  }

  // Everything except the persistent layer, which must not be unmounted.
  const layer = _persistLayer(root);
  for (const child of [...root.children]) {
    if (child !== layer) child.remove();
  }
  layer.hidden = (hash !== '#/sinonime');

  const content = el('div', { class: 'shell' });
  root.appendChild(content);

  if (tab === 'text') {
    const songMatch = hash.match(/^#\/song\/(.+)$/);
    if (songMatch) window.SongDetail.render(content, decodeURIComponent(songMatch[1]));
    else if (hash === '#/jurnal') window.Activity.render(content);
    else window.Songs.render(content);
  } else if (tab === 'rime') {
    _renderSimpleTab(content, 'Rime', (host) => window.RimeTab.render(host));
  } else if (hash === '#/sinonime') {
    // The topbar is rebuilt as usual; the frame under it is mounted into
    // the persistent layer instead, once, and simply revealed after that.
    content.classList.add('shell--header-only');
    _renderSimpleTab(content, 'Dicționare', (host) => host.appendChild(_dictSwitch(hash)),
      window.SinonimeTab.actions());
    window.SinonimeTab.render(layer);
  } else if (tab === 'dictionare') {
    _renderSimpleTab(content, 'Dicționare', (host) => {
      host.appendChild(_dictSwitch(hash));
      DICTIONARIES.find(d => d.route === hash).module().render(host);
    });
  } else {
    // Builds its own topbar (book/chapter pickers, search) rather than
    // going through _renderSimpleTab, which only knows a static title.
    window.BibleTab.render(content);
  }

  root.appendChild(_renderTabBar(tab));
}

// A tab with nothing above it but its own name. The account menu is
// repeated here so signing out does not mean going back to the list first.
//
// `fill` is handed the shell itself rather than a ready-made .tab-content,
// so a tab can put something directly under the topbar. Rime needs that:
// its search field has to sit exactly where the song list's does, and the
// scrolling panel starts below it.
function _renderSimpleTab(content, title, fill, actions) {
  // A tab may add its own controls; they sit to the left of the account
  // menu, which stays last so its position never moves between tabs.
  content.appendChild(el('div', { class: 'topbar' }, [
    el('h1', { class: 'topbar__title' }, [title]),
    ...(actions || []),
    el('button', {
      class: 'btn btn--icon', 'aria-label': 'Cont',
      html: icons.kebab, onclick: () => openAccountMenu()
    })
  ]));
  fill(content);
}

// Which dictionary, under the topbar of either. Switching is a tab switch
// as far as history goes: a place, not a step.
function _dictSwitch(hash) {
  return el('div', { class: 'dict-switch' }, DICTIONARIES.map(d => el('button', {
    class: 'seg' + (d.route === hash ? ' seg--active' : ''),
    'aria-pressed': d.route === hash ? 'true' : 'false',
    onclick: () => _switchTab(d.route)
  }, [d.label])));
}

function _renderTabBar(activeTab) {
  const bar = el('div', { class: 'tab-bar', role: 'tablist' });
  TABS.forEach(tab => {
    const active = tab.id === activeTab;
    bar.appendChild(el('button', {
      class: 'tab-bar__tab' + (active ? ' tab-bar__tab--active' : ''),
      role: 'tab',
      'aria-selected': active ? 'true' : 'false',
      onclick: () => _switchTab(_tabRoute(tab))
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
      el('p', { class: 'gate__subtitle' }, ['Atelier de versuri']),
      isOffline() ? el('p', { class: 'gate__offline' }, ['Nu ai conexiune la internet. Te poți conecta când revine.']) : null,
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
            toast(failText('Autentificarea a eșuat', err), { kind: 'error' });
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

// The profile could not be read at all — not the same as there being
// none, which is what the join screen is for (see _loadProfile).
function _renderProfileFailed(root) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'gate' }, [
    el('div', { class: 'gate__card' }, [
      el('h1', { class: 'gate__title' }, ['Nu am putut încărca contul']),
      el('p', { class: 'gate__subtitle' }, [isOffline()
        ? 'Nu ai conexiune la internet. Contul se încarcă singur când revine.'
        : 'Verifică conexiunea și încearcă din nou.']),
      // A reload, not just the read again: a read that failed every time
      // in this page tends to keep failing in it, and a fresh start gives
      // Firestore a new connection as well.
      el('button', {
        class: 'btn btn--primary btn--wide',
        onclick: (e) => {
          _setButtonLoading(e.currentTarget, 'primary', 'Încearcă din nou');
          location.reload();
        }
      }, ['Încearcă din nou']),
      el('button', {
        class: 'btn btn--text',
        onclick: () => window.Auth.signOut().catch(err => toast(failText('Nu te-am putut deconecta', err), { kind: 'error' }))
      }, ['Deconectează-te']),
      window.Auth.profileError() ? el('p', { class: 'gate__error' }, [window.Auth.profileError()]) : null
    ])
  ]));
}

function _renderJoinGroup(root) {
  root.innerHTML = '';
  const codeInput = el('input', { class: 'field__input', type: 'text', placeholder: 'Cod de invitație', autofocus: true });
  root.appendChild(el('div', { class: 'gate' }, [
    el('div', { class: 'gate__card' }, [
      el('h1', { class: 'gate__title' }, ['Aproape gata']),
      el('p', { class: 'gate__subtitle' }, ['Introdu codul de invitație primit de la echipa ta.']),
      isOffline() ? el('p', { class: 'gate__offline' }, ['Nu ai conexiune la internet. Dacă ești deja în echipă, aplicația se deschide când revine.']) : null,
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
        onclick: () => window.Auth.signOut().catch(err => toast(failText('Nu te-am putut deconecta', err), { kind: 'error' }))
      }, ['Deconectează-te'])
    ])
  ]));
}

// The release this page is running, read off the ?v= of its own script —
// the number bumped with every deploy (see index.html). Shown in the
// account menu, so a phone still running an older release, which an app
// left open in the background does until it is restarted, can be told.
const RELEASE = (() => {
  const s = document.querySelector('script[src*="js/app.js"]');
  const m = s && s.src.match(/[?&]v=(\d+)/);
  return m ? m[1] : '';
})();

function openAccountMenu() {
  const user = window.Auth.currentUser();
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  const items = [
    el('div', { class: 'sheet__user' }, [user.displayName || user.email]),
    el('button', {
      class: 'btn btn--wide btn--menu',
      onclick: () => { closeSheet(overlay); window.Songs.refresh(); }
    }, menuLabel(icons.refresh, 'Reîmprospătează'))
  ];

  if (window.Auth.isAdmin()) {
    items.push(el('button', {
      class: 'btn btn--wide btn--menu',
      onclick: async () => {
        try {
          const code = await window.Auth.createInvite();
          closeSheet(overlay);
          _openInviteCode(code);
        } catch (err) {
          toast(err.message, { kind: 'error' });
        }
      }
    }, menuLabel(icons.userPlus, 'Generează cod de invitație')));

    items.push(el('button', {
      class: 'btn btn--wide btn--menu',
      onclick: () => { closeSheet(overlay); _openManageMembers(); }
    }, menuLabel(icons.users, 'Gestionează membrii')));
  }

  items.push(el('button', {
    class: 'btn btn--wide btn--menu',
    onclick: () => closeSheetThen(overlay, () => { location.hash = '#/jurnal'; })
  }, menuLabel(icons.history, 'Jurnal de activitate')));

  items.push(el('button', {
    class: 'btn btn--wide btn--menu',
    onclick: async () => {
      try {
        await window.Auth.signOut();
        closeSheet(overlay);
      } catch (err) {
        toast(failText('Nu te-am putut deconecta', err), { kind: 'error' });
      }
    }
  }, menuLabel(icons.logout, 'Deconectează-te')));

  if (RELEASE) items.push(el('div', { class: 'sheet__version' }, ['Versiunea ' + RELEASE]));

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
    listEl.appendChild(el('div', { class: 'empty-state' }, [failText('Nu am putut încărca membrii', err)]));
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

window.App = { boot, openAccountMenu, goUpToList, openTab };
boot();

})();
