/* sinonime-tab.js — the Sinonime tab: look a word up and see its synonyms,
 * grouped by sense.
 *
 * Built to match the Rime tab down to the markup, since the two sit one tap
 * apart and do the same shape of thing: the song list's search field at the
 * top, a scrolling panel of results under it, and a word copied to the
 * clipboard when you tap it.
 *
 * Grouped by sense rather than flattened into one list, which is the whole
 * difference between a useful answer and a pile. Flattened, "iubire" comes
 * out alongside a plant that shares one of its dictionary senses; grouped,
 * "trist" reads as abătut/amărât/mâhnit, then dureros, then
 * deprimant/dezolant.
 *
 * The groups carry no gloss — dexonline's synonym relations are usable but
 * the dictionary text that would explain each sense is not. So they are
 * numbered, which is enough to show that they are separate readings and
 * not one list broken up at random.
 *
 * Under the local results sits a link into dexonline's own page for the
 * word. Its "Dicționar de sinonime" (Seche, 2002) is the best synonym
 * dictionary there is for Romanian and the one worth reading, but its text
 * is in neither of dexonline's distributable channels — see
 * data/SYNONYM-INDEX-LICENSE.md — so it cannot be shipped in the index.
 * Linking costs nothing and takes nothing: the page is served by dexonline
 * to the reader, with its own attribution and its own funding intact.
 *
 * It opens in a panel inside the app rather than throwing you out to a
 * browser, since the point is to glance at a word mid-line and come back.
 *
 * State is module-level, like the Rime tab's, so a lookup survives a trip
 * to the Text tab and back.
 */
(function () {
const { el, toast, debounce } = window.Utils;

let _query = '';

const DEX_WORD_URL = 'https://dexonline.ro/definitie-sinonime/';

/* Swap the panel for dexonline's page on this word, with a way back and a
 * way out to a real browser tab. Nothing is read from the frame — it is
 * their page, shown as their page. */
function _openDexonline(panel, word) {
  const url = DEX_WORD_URL + encodeURIComponent(word);
  panel.innerHTML = '';
  panel.appendChild(el('div', { class: 'syn__dexbar' }, [
    el('button', {
      class: 'btn btn--text',
      onclick: () => _run(panel)
    }, ['← Înapoi']),
    el('a', {
      class: 'btn btn--text',
      href: url,
      target: '_blank',
      rel: 'noopener noreferrer'
    }, ['Deschide în browser ↗'])
  ]));
  panel.appendChild(el('iframe', {
    class: 'syn__dexframe',
    src: url,
    title: 'dexonline — ' + word,
    loading: 'lazy',
    referrerpolicy: 'no-referrer-when-downgrade'
  }));
}

// The link itself, shown under whatever the local index had to say.
function _dexLink(panel, word) {
  return el('div', { class: 'syn__dexlink' }, [
    el('button', {
      class: 'btn btn--wide',
      onclick: () => _openDexonline(panel, word)
    }, ['Vezi „' + word + '” în Dicționarul de sinonime (dexonline)'])
  ]);
}

function render(host) {
  const panel = el('div', { class: 'syn' });

  const input = el('input', {
    class: 'search-bar__input',
    type: 'search',
    placeholder: 'Scrie un cuvânt…',
    value: _query,
    oninput: debounce((e) => {
      _query = e.target.value;
      _run(panel);
    }, 250)
  });
  host.appendChild(el('div', { class: 'search-bar' }, [input]));
  host.appendChild(panel);
  _run(panel);
  return panel;
}

async function _run(panel) {
  const q = (_query || '').trim();

  if (!q) {
    panel.innerHTML = '';
    panel.appendChild(el('div', { class: 'empty-state' }, [
      el('p', {}, ['Scrie un cuvânt ca să-i vezi sinonimele.'])
    ]));
    return;
  }

  // Several megabytes, so it loads the first time somebody actually
  // searches — never at app boot.
  if (window.Synonyms.state() !== 'ready') {
    panel.innerHTML = '';
    const pct = el('div', { class: 'empty-state__hint' }, ['0%']);
    panel.appendChild(el('div', { class: 'loading-state' }, [
      el('div', { class: 'spinner' }),
      'Se încarcă dicționarul de sinonime…',
      pct
    ]));
    try {
      await window.Synonyms.load((p) => { pct.textContent = Math.round(p * 100) + '%'; });
    } catch (err) {
      panel.innerHTML = '';
      panel.appendChild(el('div', { class: 'empty-state' }, [
        'Nu am putut încărca dicționarul: ' + window.Synonyms.errorMessage()
      ]));
      return;
    }
    if ((_query || '').trim() !== q) return;   // typed on while it loaded
  }

  const res = window.Synonyms.lookup(q);
  panel.innerHTML = '';

  if (!res.found) {
    panel.appendChild(el('div', { class: 'empty-state' }, [
      el('p', {}, ['Niciun sinonim pentru acest cuvânt aici.']),
      el('p', { class: 'empty-state__hint' }, [
        'Verifică ortografia — sau caută-l în dicționarul de sinonime.'
      ])
    ]));
    panel.appendChild(_dexLink(panel, q));
    return;
  }

  // Say so when the answer is about a different word than the one typed —
  // the lemma behind an inflected form, or the spelling with its diacritics
  // — rather than swapping it silently.
  if (res.via && res.word !== res.typed) {
    panel.appendChild(el('div', { class: 'syn__resolved' }, [
      'Rezultate pentru ', el('strong', {}, [res.word])
    ]));
  }

  const many = res.senses.length > 1;
  res.senses.forEach((sense, i) => {
    // Numbered only when there is more than one: a lone "Sensul 1" is a
    // label with nothing to distinguish it from.
    const head = many
      ? el('div', { class: 'syn__sense-head' }, [
          el('span', { class: 'syn__sense-no' }, ['Sensul ' + (i + 1)])
        ])
      : null;

    const words = el('div', { class: 'syn__words' });
    sense.forEach(w => {
      words.appendChild(el('button', {
        class: 'syn__word',
        onclick: async () => {
          const ok = await window.Utils.copyToClipboard(w);
          toast(ok ? '„' + w + '” copiat.' : 'Nu am putut copia.', ok ? {} : { kind: 'error' });
        }
      }, [w]));
    });

    panel.appendChild(el('div', { class: 'syn__sense' }, [head, words].filter(Boolean)));
  });

  panel.appendChild(_dexLink(panel, res.word));
}

window.SinonimeTab = { render };

})();
