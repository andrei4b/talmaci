/* app.js — boot sequence, sign-in/join gating, hash router, account menu. */
(function () {
const { $, el, toast } = window.Utils;

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
  await window.Auth.ready();
  window.Auth.onChange(_renderCurrentScreen);
  window.addEventListener('hashchange', _renderCurrentScreen);
  _renderCurrentScreen();
}

function _renderCurrentScreen() {
  const root = $('#app');
  const user = window.Auth.currentUser();

  if (!user) return _renderSignIn(root);
  if (!user.groupId) return _renderJoinGroup(root);
  return _renderRoute(root);
}

function _renderRoute(root) {
  const hash = location.hash || '#/';
  const songMatch = hash.match(/^#\/song\/(.+)$/);
  if (songMatch) {
    window.SongDetail.render(root, decodeURIComponent(songMatch[1]));
  } else {
    window.Songs.render(root);
  }
}

function _renderSignIn(root) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'gate' }, [
    el('div', { class: 'gate__card' }, [
      el('h1', { class: 'gate__title' }, ['Tălmaci']),
      el('p', { class: 'gate__subtitle' }, ['Your Song Translation Toolkit']),
      el('button', {
        class: 'btn btn--primary btn--wide',
        onclick: async () => {
          try {
            await window.Auth.signInWithGoogle();
          } catch (err) {
            toast('Autentificarea a eșuat: ' + err.message, { kind: 'error' });
          }
        }
      }, ['Continuă cu Google'])
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
      el('label', { class: 'field' }, [codeInput]),
      el('button', {
        class: 'btn btn--primary btn--wide',
        onclick: async () => {
          try {
            await window.Auth.redeemInvite(codeInput.value);
          } catch (err) {
            toast(err.message, { kind: 'error' });
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
  const overlay = el('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
  const items = [
    el('div', { class: 'sheet__user' }, [user.displayName || user.email])
  ];

  if (window.Auth.isAdmin()) {
    items.push(el('button', {
      class: 'btn btn--wide',
      onclick: async () => {
        try {
          const code = await window.Auth.createInvite();
          overlay.remove();
          toast('Cod de invitație: ' + code);
        } catch (err) {
          toast(err.message, { kind: 'error' });
        }
      }
    }, ['Generează cod de invitație']));
  }

  items.push(el('button', {
    class: 'btn btn--wide',
    onclick: async () => { await window.Auth.signOut(); overlay.remove(); }
  }, ['Deconectează-te']));

  overlay.appendChild(el('div', { class: 'sheet' }, items));
  document.body.appendChild(overlay);
}

window.App = { boot, openAccountMenu };
boot();

})();
