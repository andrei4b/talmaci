/* app.js — boot sequence, sign-in/join gating, hash router, account menu. */
(function () {
const { $, el, menuLabel, toast, copyWithToast, openSheet, closeSheet, closeSheetThen, icons,
        isOffline, failText } = window.Utils;

// ---- Keep sheets clear of the on-screen keyboard AND Chrome's autofill
// accessory bar (the key/card/location icon row) ----
// The visual viewport shrinks (and can shift) when either appears, but
// fixed-position elements stay sized to the full layout viewport by
// default. Mirror the visual viewport into CSS vars so .sheet-overlay/.sheet
// track it instead, keeping their buttons above both.
// The page's height with the keyboard closed, at the current width (a turn
// of the phone starts it over).
let _fullHeight = 0, _fullHeightWidth = 0;

function syncViewportInsets() {
  const vv = window.visualViewport;
  const root = document.documentElement.style;
  const vvh = vv ? vv.height : window.innerHeight;
  root.setProperty('--vvh', vvh + 'px');
  root.setProperty('--vv-top', (vv ? vv.offsetTop : 0) + 'px');
  if (window.innerWidth !== _fullHeightWidth) { _fullHeightWidth = window.innerWidth; _fullHeight = 0; }
  _fullHeight = Math.max(_fullHeight, window.innerHeight);
  // The keyboard's height (0 when it's closed). Measured against the
  // tallest the page has been rather than window.innerHeight: on Android
  // the page shrinks along with the keyboard (interactive-widget in
  // index.html), where elsewhere only the visual viewport does. Less than
  // a keyboard is the browser's own toolbar coming and going, not one.
  // Anything that pads its bottom edge to clear the fixed tab bar — hidden
  // or behind the keyboard by then — subtracts this, rather than leaving
  // that same gap of dead space above the keyboard.
  const kb = _fullHeight - vvh;
  root.setProperty('--keyboard-inset', (kb > 120 ? kb : 0) + 'px');
  document.documentElement.classList.toggle('keyboard-open', kb > 120);
  // How much of the layout viewport the keyboard covers: what something
  // fixed to its bottom has to rise by to stay in sight. 0 where the page
  // shrinks with the keyboard.
  root.setProperty('--keyboard-cover', Math.max(0, window.innerHeight - vvh) + 'px');
  if (vv && vv.offsetTop > 0) requestAnimationFrame(unpanViewport);
}

// Tapping a field low on the screen makes the browser slide the whole page
// up as the keyboard opens, so the caret is not hidden behind it. .shell
// then shrinks to fit above the keyboard anyway, and the slide is left
// over: the topbar pushed off the top and the same height of dead space
// above the keyboard. Undo the slide, and scroll the field's own scroller
// by as much instead, which leaves the caret exactly where it was on
// screen. Not while zoomed in, when panning is the user's own doing.
// The slide is the visual viewport's, inside a layout viewport that never
// scrolled (#app is fixed), so window.scrollTo alone often moves nothing —
// as when tapping from one field to another with the keyboard already up.
// scrollIntoView does move the visual viewport, so line #app's top back
// up with it.
function unpanViewport() {
  const vv = window.visualViewport;
  const off = vv.offsetTop;
  if (off <= 0 || vv.scale > 1.01) return;
  window.scrollTo(0, 0);
  if (vv.offsetTop > 0) {
    document.getElementById('app').scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
  }
  const moved = off - vv.offsetTop;
  if (moved <= 0) return;
  for (let n = document.activeElement; n && n !== document.body; n = n.parentElement) {
    if (n.scrollHeight > n.clientHeight && /auto|scroll/.test(getComputedStyle(n).overflowY)) {
      n.scrollTop += moved;
      break;
    }
  }
}
/* The field being typed in, in a sheet, kept in sight above the sheet's
 * buttons. The browser scrolls a tapped field into view, but it doesn't
 * know the buttons (stuck to the sheet's bottom) are covering it, and it
 * does so before the keyboard is up: then the sheet shrinks to fit above
 * the keyboard, and the field is left under the buttons or below them.
 * So once the sheet has its size, scroll it — the sheet alone, not the
 * page — until the field is clear of them. A field too tall for the room
 * shows its top. */
function keepFieldInSheet() {
  const field = document.activeElement;
  const sheet = field && field.closest && field.closest('.sheet');
  if (!sheet || !field.matches('input, textarea')) return;
  const box = sheet.getBoundingClientRect();
  const actions = sheet.querySelector('.sheet__actions');
  const top = box.top + 12;
  const bottom = (actions ? actions.getBoundingClientRect().top : box.bottom) - 12;
  const r = field.getBoundingClientRect();
  if (r.top < top) sheet.scrollTop -= top - r.top;
  else if (r.bottom > bottom) sheet.scrollTop += Math.min(r.bottom - bottom, r.top - top);
}
document.addEventListener('focusin', () => requestAnimationFrame(keepFieldInSheet));

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    syncViewportInsets();
    requestAnimationFrame(keepFieldInSheet);
  });
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
    // Signing in happens after a load, not before it: notifications this
    // member had on here before signing out come back now (see push.js).
    if (uid) window.Push.refresh();
  });
  window.Auth.onChange(_renderCurrentScreen);
  _anchorOnText();
  window.addEventListener('hashchange', _renderCurrentScreen);
  window.addEventListener('offline', () => toast('Ai rămas fără internet. Melodiile deschise deja, rimele și Biblia merg în continuare.'));
  window.addEventListener('online', _backOnline);
  _renderCurrentScreen();
  // The Bible (~4 MB) and the rhyme index (~5.7 MB): fetch and parse them
  // while the user is busy elsewhere so opening either tab never waits.
  // Idle-time so it can't delay first paint.
  const warm = () => { window.BibleTab.preload(); window.Rhyme.preload(); window.Push.refresh(); };
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
 * button walk back through every tab you had glanced at.
 *
 * Except when leaving Text. Text is the first tab, the one the app opens
 * on, so going from it to any other tab — by the bar or by looking a word
 * up — pushes an entry that remembers where in Text you were: the list, a
 * song, the journal. Moving on between the other tabs from there replaces
 * as usual, carrying that memory along, so back from any of them returns
 * to Text, to the very place you left; and returning to Text through the
 * bar steps back rather than replacing, which would leave it in the
 * history twice. A cold start on another tab gets the same entry under it
 * (see _anchorOnText).
 *
 * A tab's own inner page — the Bible search — is a step of its own, so
 * back closes it first. Leaving the tab from there drops it: its entry is
 * popped before the switch, or back from the next tab would land on it.
 *
 * replaceState and pushState fire neither hashchange nor popstate, so the
 * render has to be called directly; and the existing state object is
 * carried over, because it records how the entry underneath was reached
 * and replacing the URL does not change that. */
let _leavingInnerPage = false;

function _switchTab(route) {
  const here = location.hash || '#/';
  if (here === route) return;
  const st = history.state;
  if (st && st.talmaciBibleSearch) {
    _leavingInnerPage = true;
    window.addEventListener('popstate', () => { _leavingInnerPage = false; _switchTab(route); }, { once: true });
    history.back();
    return;
  }
  if (st && st.talmaciFromText === route) {
    history.back();
    return;
  }
  if (_tabForHash(here) === 'text') {
    history.pushState({ talmaciFromText: here }, '', route);
  } else {
    history.replaceState(st, '', route);
  }
  _renderCurrentScreen();
}

// Whether the pop under way is _switchTab dropping an inner page, which
// that page must not answer by redrawing itself.
function isLeavingInnerPage() { return _leavingInnerPage; }

/* Opened straight onto another tab — a link, or a reload there — the
 * entry below is not Text but whatever came before the app, so back would
 * leave it. Put Text under it, the way the bar would have got there. */
function _anchorOnText() {
  const here = location.hash || '#/';
  if (_tabForHash(here) === 'text' || (history.state && history.state.talmaciFromText)) return;
  history.replaceState(null, '', '#/');
  history.pushState({ talmaciFromText: '#/' }, '', here);
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
 * tells the two apart.
 *
 * `gone`: the song was just deleted, or found to be no longer there. Then
 * its entry must not stay in the history at all. Assigning the hash would
 * push the list on top of it, and back from the list would later land on
 * a song that cannot be read, which Firestore refuses as a missing
 * permission rather than reporting it missing (see firestore.rules: the
 * read rule looks at the document's own fields, and there are none). So
 * the song's entry is replaced by the list instead. Going back from the
 * list's own entry leaves the song's as a forward step, which a phone has
 * no gesture for and the next song opened overwrites. */
function goUpToList(gone) {
  const st = history.state;
  if (st && st.talmaciFromList) history.back();
  else if (gone) location.replace('#/');
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
  // A song with one version's observations to open — where a tapped
  // notification leads (see service-worker.js). Only on the way in: the
  // address becomes the song's own, so back, a reload or a tab switch
  // return to the song without opening them again.
  let openNotesFor = null;
  const notes = (location.hash || '').match(/^#\/song\/([^/]+)\/notes\/([^/]*)$/);
  if (notes) {
    history.replaceState(history.state, '', '#/song/' + notes[1]);
    openNotesFor = decodeURIComponent(notes[2]);
  }
  const hash = location.hash || '#/';
  const tab = _tabForHash(hash);
  // Arriving at a song, as opposed to coming back to it: from the list,
  // the journal or another song, or from a tapped notification. Back from
  // another tab is not, and finds the song as it was left.
  const entered = hash !== _currentRoute &&
    (!!openNotesFor || !_currentRoute || _tabForHash(_currentRoute) === 'text');
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
    if (songMatch) window.SongDetail.render(content, decodeURIComponent(songMatch[1]), openNotesFor, entered);
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

  if (window.Auth.isSuperAdmin()) {
    items.push(el('button', {
      class: 'btn btn--wide btn--menu',
      onclick: async () => {
        try {
          const code = await window.Auth.createInvite();
          closeSheetThen(overlay, () => _openInviteCode(code));
        } catch (err) {
          toast(err.message, { kind: 'error' });
        }
      }
    }, menuLabel(icons.userPlus, 'Generează cod de invitație')));

    items.push(el('button', {
      class: 'btn btn--wide btn--menu',
      onclick: () => closeSheetThen(overlay, _openManageMembers)
    }, menuLabel(icons.users, 'Gestionează membrii')));
  }

  items.push(el('button', {
    class: 'btn btn--wide btn--menu',
    onclick: () => closeSheetThen(overlay, () => { location.hash = '#/jurnal'; })
  }, menuLabel(icons.history, 'Jurnal de activitate')));

  const push = _pushItem(overlay);
  if (push) items.push(push);

  items.push(el('button', {
    class: 'btn btn--wide btn--menu',
    // The sheet is closed first, and signing out waits until it has: closing
    // steps history back, and a history step taken while the reload that
    // ends signing out is under way cancels that reload — which left the
    // page as it was, signed out underneath.
    onclick: () => closeSheetThen(overlay, async () => {
      if (!isOffline()) await window.Push.forget();
      window.Auth.signOut().catch(err => toast(failText('Nu te-am putut deconecta', err), { kind: 'error' }));
    })
  }, menuLabel(icons.logout, 'Deconectează-te')));

  if (window.Update.release) items.push(_versionLine(overlay));

  overlay.appendChild(el('div', { class: 'sheet' }, items));
  openSheet(overlay);
}

/* The release this page is running, and beside it a check for a newer
 * one (see update.js): once found, a button that moves to it. */
function _versionLine(overlay) {
  const Update = window.Update;
  const status = el('span', {});
  const updateBtn = (r) => el('button', {
    class: 'sheet__version-btn',
    onclick: () => closeSheetThen(overlay, Update.apply)
  }, ['Actualizează la versiunea ' + r]);
  const show = (node) => { status.replaceChildren(node); };
  const checkBtn = el('button', {
    class: 'sheet__version-btn',
    onclick: async () => {
      show('Se caută…');
      try {
        const r = await Update.check(() => show('Se descarcă versiunea nouă…'));
        show(r ? updateBtn(r) : 'Ești la zi');
      } catch (_) {
        show(isOffline() ? 'Fără internet' : 'Nu am putut verifica');
      }
    }
  }, ['Caută actualizări']);
  show(Update.newer() ? updateBtn(Update.newer()) : checkBtn);
  return el('div', { class: 'sheet__version' }, ['Versiunea ' + Update.release + ' · ', status]);
}

/* Notifications on this device about the songs you are working on — see
 * push.js. Left out where the app is not set up for them,
 * or this browser can never have them; on an iPhone in a Safari tab, it
 * says how to get them instead. */
function _pushItem(overlay) {
  const Push = window.Push;
  if (!Push.configured()) return null;
  if (!Push.supported()) {
    if (!Push.needsInstall()) return null;
    return el('button', {
      class: 'btn btn--wide btn--menu',
      onclick: () => toast('Pe iPhone, notificările merg doar din aplicația adăugată pe ecranul principal: Partajează → Adaugă pe ecranul principal.')
    }, menuLabel(icons.bellOff, 'Notificări oprite'));
  }
  const on = Push.isOn();
  return el('button', {
    class: 'btn btn--wide btn--menu',
    onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        if (on) {
          await Push.disable();
          toast('Notificările sunt oprite pe acest dispozitiv.');
        } else {
          await Push.enable();
          toast('Vei primi notificări despre melodiile la care lucrezi.');
        }
        closeSheet(overlay);
      } catch (err) {
        btn.disabled = false;
        toast(failText(on ? 'Nu am putut opri notificările' : 'Nu am putut porni notificările', err), { kind: 'error' });
      }
    }
  }, menuLabel(on ? icons.bell : icons.bellOff, on ? 'Notificări pornite' : 'Notificări oprite'));
}

function _openInviteCode(code) {
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(overlay); } });
  const copyBtn = el('button', { class: 'btn btn--wide' }, ['Copiază codul']);
  copyBtn.addEventListener('click', () => copyWithToast(code, 'Cod copiat.'));
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
    // The super-admin's own row: their powers come from their account, not
    // this role, so there is nothing to flip.
    const roleBtn = m.uid === me.uid
      ? el('span', { class: 'btn member-row__role-btn member-row__role-btn--admin member-row__role-btn--fixed' }, ['Super-admin'])
      : el('button', {
          class: 'btn member-row__role-btn' + (isAdminRole ? ' member-row__role-btn--admin' : ''),
          onclick: (e) => _setMemberRole(e.currentTarget, m, isAdminRole ? 'user' : 'admin', overlay)
        }, [isAdminRole ? 'Admin' : 'Membru']);
    listEl.appendChild(el('div', { class: 'member-row' }, [
      el('div', { class: 'member-row__info' }, [
        el('div', { class: 'member-row__name' }, [m.displayName || m.email || m.uid]),
        el('div', { class: 'member-row__meta' }, [m.email || ''])
      ]),
      roleBtn
    ]));
  });
}

async function _setMemberRole(btn, member, nextRole, overlay) {
  btn.disabled = true;
  try {
    await window.Auth.setMemberRole(member.uid, nextRole);
    closeSheetThen(overlay, _openManageMembers);
  } catch (err) {
    toast(err.message, { kind: 'error' });
    btn.disabled = false;
  }
}

window.App = { boot, openAccountMenu, goUpToList, openTab, isLeavingInnerPage };
boot();

})();
