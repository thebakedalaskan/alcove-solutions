/* 02 Design system / Typography. */
(function () {
  var AL = window.AL, I = AL.icon, esc = AL.esc;

  var SCALE = [
    ['Display XL', 'Sans 800 · 66/1.0 · −2.8%', 'Lamp on. Door closed.', 'font:800 66px/1 var(--al-font-ui);letter-spacing:-.028em'],
    ['Display', 'Sans 800 · 52/1.0 · −2.5%', 'A quiet room for your work', 'font:800 52px/1 var(--al-font-ui);letter-spacing:-.025em'],
    ['Title 1', 'Sans 800 · 34/1.08 · −1.8%', 'Launch planning', 'font:800 34px/1.08 var(--al-font-ui);letter-spacing:-.018em'],
    ['Title 2', 'Sans 700 · 26/1.15 · −1.5%', 'Investor call', 'font:700 26px/1.15 var(--al-font-ui);letter-spacing:-.015em'],
    ['Title 3', 'Sans 700 · 20/1.2 · −1%', 'Every quote matches your files', 'font:700 20px/1.2 var(--al-font-ui);letter-spacing:-.01em'],
    ['Body large', 'Sans 400 · 19/1.5', 'Your work is readable on your device and in verified private servers, and nowhere else.', 'font:400 19px/1.5 var(--al-font-ui)'],
    ['Body', 'Sans 400 · 16.5/1.55', 'This page changed after you opened it. We kept your edits as a draft, so nothing is lost.', 'font:400 16.5px/1.55 var(--al-font-ui)'],
    ['Body small', 'Sans 400 · 14.5/1.45', 'Answers use only these sources. A question holds up to 132 credits.', 'font:400 14.5px/1.45 var(--al-font-ui)'],
    ['Label', 'Sans 600 · 14.5/1.2', 'Add a file', 'font:600 14.5px/1.2 var(--al-font-ui)'],
    ['Caption', 'Sans 500 · 13/1.4', 'PDF · page 4 of 14 · added 2 Nov', 'font:500 13px/1.4 var(--al-font-ui);color:var(--al-ink-3)'],
    ['Reading', 'Serif 400 · 18/1.65', 'Priya: launch on the 18th, import comes in the next release, so design gets two more weeks for onboarding.', 'font:400 18px/1.65 var(--al-font-read);font-variant-numeric:oldstyle-nums'],
    ['Quote', 'Serif italic 400 · 22/1.35', '“the exit window opens next March”', 'font:italic 400 22px/1.35 var(--al-font-read)'],
    ['Figure', 'Sans 800 · 52/1 · tabular', '9,209', 'font:800 52px/1 var(--al-font-ui);letter-spacing:-.03em;font-variant-numeric:tabular-nums lining-nums'],
    ['Mono', 'System mono · 13/1.5', 'RECORD_INTEGRITY · 9cQ2mF0aV7xLr3TzP1wKbg', 'font:400 13px/1.5 var(--al-font-mono);color:var(--al-ink-2)']];

  AL.page({
    id: 'typography', group: 'system', order: 2, title: 'Typography', icon: 'type', file: 'typography',
    keywords: 'fonts type scale alegreya sans serif figures tester',
    lede: 'One family with two voices. Alegreya Sans for the room you work in; Alegreya, its serif sibling, for the words you write and read. Both were drawn for long literary reading, so the whole app feels unhurried.',
    meta: [['type', 'Alegreya Sans and Alegreya, SIL Open Font License']],
    render: function () {
      var faces = '<section class="al-sec" id="typefaces"><div class="al-sec-h"><p class="al-eyebrow">Typefaces</p><h2>Sans for the room, serif for your writing</h2></div><div class="typeface al-stagger">' +
        '<div class="al-panel tf"><span class="al-small">Interface and display</span><span class="aa" style="font-family:var(--al-font-ui);font-weight:800">Aa</span><h3 class="al-h3" style="font-size:26px">Alegreya Sans</h3>' +
        '<div class="glyphs" style="font-family:var(--al-font-ui)">ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 · ’ “ ” — … ⌘</div>' +
        '<div class="weights" style="font-family:var(--al-font-ui)"><span style="font-weight:300">Light</span><span style="font-weight:400">Regular</span><span style="font-weight:500">Medium</span><span style="font-weight:700">Bold</span><span style="font-weight:800">ExtraBold</span><span style="font-weight:900">Black</span></div>' +
        '<p class="al-small">Humanist and warm, with a calligraphic rhythm. Runs small, so the base size is 16.5 px.</p></div>' +
        '<div class="al-panel tf"><span class="al-small">Your pages, files and notes</span><span class="aa" style="font-family:var(--al-font-read)">Aa</span><h3 class="al-h3" style="font-size:26px;font-family:var(--al-font-read);font-weight:700">Alegreya</h3>' +
        '<div class="glyphs" style="font-family:var(--al-font-read)">ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz <span style="font-variant-numeric:oldstyle-nums">0123456789</span></div>' +
        '<div class="weights" style="font-family:var(--al-font-read)"><span>Regular</span><span style="font-style:italic">Italic</span><span style="font-weight:700">Bold</span><span style="font-weight:700;font-style:italic">Bold italic</span></div>' +
        '<p class="al-small">Drawn for literature. Every document, transcript and quote is set in it, so your words never look like the interface.</p></div></div></section>';

      var pairing = '<section class="al-sec" id="pairing"><div class="al-sec-h"><p class="al-eyebrow">Pairing</p><h2>How the two meet in the app</h2></div>' +
        '<div class="al-panel" style="padding:0;overflow:hidden"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">' +
        '<div style="padding:26px;background:var(--al-sunken);display:flex;flex-direction:column;gap:12px"><span class="al-state al-state--lit">Lamp on</span><b style="font-size:22px">Launch planning</b>' +
        '<span class="al-small">PDF · page 4 of 14</span><span class="al-btn al-btn--primary al-btn--sm" style="align-self:flex-start">' + I('ask') + 'Ask about this</span></div>' +
        '<div style="padding:30px 34px" class="al-read"><b style="font-family:var(--al-font-ui);font-size:17px">12. Early termination</b><p style="margin:8px 0 0">12.1 The Tenant may <mark class="al-hl">terminate this Lease by giving the Landlord not less than ninety (90) days’ written notice</mark><span class="al-mark">S1</span>, provided the notice expires no earlier than the last day of the twenty-fourth (24th) month of the Term.</p></div></div></div></section>';

      var scale = '<section class="al-sec" id="scale"><div class="al-sec-h"><p class="al-eyebrow">Scale</p><h2>Fourteen steps, used everywhere</h2>' +
        '<p>Headings get negative tracking that tightens as they grow. Body text is never tracked. Nothing is set in capitals.</p></div><div class="al-panel" style="padding:4px 26px">' +
        SCALE.map(function (s) {
          return '<div class="scale-row"><div class="spec"><b>' + esc(s[0]) + '</b>' + esc(s[1]) + '</div><div class="smp" style="' + s[3] + '">' + esc(s[2]) + '</div></div>';
        }).join('') + '</div></section>';

      var figures = '<section class="al-sec" id="figures"><div class="al-sec-h"><p class="al-eyebrow">Figures</p><h2>Lining in the interface, old-style in your writing</h2></div><div class="figures al-stagger">' +
        '<div class="al-panel"><span class="al-small">Interface · lining and tabular</span><div class="num" style="font-variant-numeric:lining-nums tabular-nums">9,209 · 750 · 41</div>' +
        '<div class="num" style="font-variant-numeric:lining-nums tabular-nums">10:44 · 18:42</div><p class="al-small">Credits, times and anything in a column line up.</p></div>' +
        '<div class="al-panel"><span class="al-small">Reading · old-style</span><div class="num" style="font-family:var(--al-font-read);font-weight:400;font-variant-numeric:oldstyle-nums">ninety (90) days</div>' +
        '<div class="num" style="font-family:var(--al-font-read);font-weight:400;font-variant-numeric:oldstyle-nums">clause 12.1, 2024</div><p class="al-small">Numbers sit inside the sentence instead of shouting out of it.</p></div></div></section>';

      var tester = '<section class="al-sec" id="tester"><div class="al-sec-h"><p class="al-eyebrow">Try it</p><h2>Type tester</h2><p>Edit the sentence and change the settings.</p></div>' +
        '<div class="tester"><div class="tester-ctl"><span class="al-seg" role="group" aria-label="Typeface"><button type="button" id="tt-sans" aria-pressed="true">Alegreya Sans</button><button type="button" id="tt-serif" aria-pressed="false">Alegreya</button></span>' +
        '<label for="tt-size">Size <input id="tt-size" type="range" min="14" max="96" value="44"><span id="tt-size-v">44 px</span></label>' +
        '<label for="tt-weight">Weight <input id="tt-weight" type="range" min="300" max="900" step="100" value="800"><span id="tt-weight-v">800</span></label>' +
        '<label class="al-check" for="tt-italic" style="cursor:pointer"><input id="tt-italic" type="checkbox" class="al-vh"><i>' + I('check') + '</i>Italic</label></div>' +
        '<div class="tester-out" id="tt-out" contenteditable="true" spellcheck="false" style="font:800 44px/1.15 var(--al-font-ui);letter-spacing:-.02em">Lamp on. Door closed.</div></div></section>';

      var rules = '<section class="al-sec" id="rules"><div class="al-sec-h"><p class="al-eyebrow">Rules</p><h2>Setting type the Alcove way</h2></div><ul class="spec-list">' +
        '<li>Keep running text between 60 and 70 characters wide.</li><li>Sentence case everywhere, including buttons and headings.</li><li>Never set text in all capitals or letter-spaced.</li>' +
        '<li>Italic belongs to Alegreya: quotes, the tagline, a transcript’s gaps.</li><li>Nothing smaller than 13 px, and captions use Ink 3, never lighter.</li><li>The wordmark is the only lowercase heading.</li>' +
        '<li>Bundle both families with the app: the desktop app ships local assets only.</li><li>Headings wrap with balanced lines; long titles never ellipsise inside a page.</li></ul></section>';
      return faces + pairing + scale + figures + tester + rules;
    },
    mount: function (view) {
      var out = view.querySelector('#tt-out'), size = view.querySelector('#tt-size'), weight = view.querySelector('#tt-weight'), ital = view.querySelector('#tt-italic');
      var sans = view.querySelector('#tt-sans'), serif = view.querySelector('#tt-serif'), face = 'ui';
      function apply() {
        out.style.fontFamily = face === 'ui' ? 'var(--al-font-ui)' : 'var(--al-font-read)';
        out.style.fontSize = size.value + 'px';
        out.style.fontWeight = weight.value;
        out.style.fontStyle = ital.checked ? 'italic' : 'normal';
        out.style.letterSpacing = face === 'ui' && size.value > 30 ? '-.02em' : '0';
        view.querySelector('#tt-size-v').textContent = size.value + ' px';
        view.querySelector('#tt-weight-v').textContent = weight.value;
        ital.parentNode.classList.toggle('is-on', ital.checked);
      }
      [size, weight, ital].forEach(function (c) { c.addEventListener('input', apply); c.addEventListener('change', apply); });
      sans.addEventListener('click', function () { face = 'ui'; sans.setAttribute('aria-pressed', 'true'); serif.setAttribute('aria-pressed', 'false'); apply(); });
      serif.addEventListener('click', function () { face = 'read'; serif.setAttribute('aria-pressed', 'true'); sans.setAttribute('aria-pressed', 'false'); if (+weight.value > 700) weight.value = 400; apply(); });
    }
  });
})();
