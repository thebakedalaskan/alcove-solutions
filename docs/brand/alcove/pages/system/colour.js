/* 02 Design system / Colour. Role swatches read their values from tokens.css at runtime, so this page never drifts. */
(function () {
  var AL = window.AL, I = AL.icon, U = AL.ui, esc = AL.esc;

  var RAMPS = {
    Dusk: ['#F1F7FF', '#E2EAF6', '#CAD5E5', '#ADBCD1', '#8DA0BA', '#6E85A4', '#516A8E', '#345178', '#213B5F', '#112744', '#05162E'],
    Lamp: ['#FFF4D6', '#FFE6B0', '#FFCF85', '#EFAC4B', '#CF9032', '#AD7724', '#8C5E15', '#6D4707', '#523300', '#392000', '#241100'],
    Mist: ['#F3F7FD', '#E5EAF1', '#CFD4DE', '#B4BBC7', '#969FAE', '#7A8495', '#5E697D', '#475060', '#343B48', '#212731', '#12161E'],
    Sage: ['#EAFCF2', '#DAF0E4', '#C1DCCD', '#A2C4B2', '#7FAA94', '#5D9077', '#3C775B', '#2B5B45', '#1C4332', '#0E2D1F', '#041B11'],
    Brick: ['#FFEDE8', '#FFDDD7', '#FEC4BC', '#EEA59B', '#DB8278', '#C75F55', '#B13A32', '#8A2822', '#691A16', '#4A0C09', '#300302'],
    Heather: ['#F6F5FF', '#E8E7FA', '#D3D1EB', '#B8B6D8', '#9C99C3', '#817CAF', '#67609A', '#4E477D', '#39335F', '#262043', '#15112B']
  };
  var BASE = { Dusk: 7, Lamp: 3, Mist: 6, Sage: 6, Brick: 6, Heather: 6 };
  var STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
  var ROLES = [['--al-bg', 'Ground'], ['--al-surface', 'Surface'], ['--al-sunken', 'Sunken'], ['--al-raised', 'Raised'], ['--al-ink', 'Ink'], ['--al-ink-2', 'Ink 2'],
    ['--al-ink-3', 'Ink 3'], ['--al-line', 'Line'], ['--al-accent', 'Accent'], ['--al-accent-soft', 'Accent soft'], ['--al-lamp', 'Lamp'], ['--al-lamp-text', 'Lamp text'],
    ['--al-positive', 'Positive'], ['--al-unknown', 'Unknown'], ['--al-negative', 'Negative'], ['--al-info', 'Info']];
  var PAIRS = [['--al-ink', '--al-bg', 'Body text'], ['--al-ink-2', '--al-bg', 'Secondary text'], ['--al-ink-3', '--al-surface', 'Captions'],
    ['--al-accent-ink', '--al-accent', 'Primary button'], ['--al-lamp-ink', '--al-lamp', 'Lamp button'], ['--al-lamp-text', '--al-lamp-soft', 'Waiting chip'],
    ['--al-unknown', '--al-unknown-soft', 'Not sure chip'], ['--al-negative', '--al-negative-soft', 'Problem chip'], ['--al-positive', '--al-positive-soft', 'Done chip']];

  function lum(hex) {
    var c = hex.replace('#', ''), v = [0, 2, 4].map(function (k) { var x = parseInt(c.substr(k, 2), 16) / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function toHex(rgb) {
    var m = rgb.match(/\d+(\.\d+)?/g);
    if (!m) return '#000000';
    return '#' + m.slice(0, 3).map(function (x) { return ('0' + Math.round(+x).toString(16)).slice(-2); }).join('').toUpperCase();
  }
  function readVar(el, name) {
    var probe = document.createElement('i');
    probe.style.color = 'var(' + name + ')';
    el.appendChild(probe);
    var v = toHex(getComputedStyle(probe).color);
    probe.remove();
    return v;
  }

  AL.page({
    id: 'colour', group: 'system', order: 1, title: 'Colour', icon: 'palette', file: 'colour',
    keywords: 'color palette tokens ramps contrast dark light dusk mist lamp',
    lede: 'Dusk and mist make the room; lamp amber is the light. The palette is quiet on purpose, so that the lamp, which means something is lit or live, always stands out.',
    meta: [['sun', 'Light theme: Mist'], ['moon', 'Dark theme: After hours']],
    render: function () {
      var core = [['Dusk', '#223047', '#F1F4F8', 'The brand ground. Covers, the lock screen, toasts and stages.'],
        ['Mist', '#EDF1F5', '#1C2533', 'The light ground of the app. Cool, quiet, never cream.'],
        ['Evening', '#1C2533', '#EDF1F5', 'Ink. Text and the arch in the light theme.'],
        ['Twilight', '#9DBBE6', '#121A26', 'Actions in the dark theme and the arch on dusk.'],
        ['Lamp', '#E8A33C', '#3A2600', 'What is lit or live. Used sparingly, never as decoration.'],
        ['Paper', '#FAFBFD', '#1C2533', 'Surfaces: the open page, cards and sheets.']];
      var coreHtml = '<section class="al-sec" id="core"><div class="al-sec-h"><p class="al-eyebrow">Core colours</p><h2>Six colours carry the brand</h2></div><div class="sw-grid al-stagger">' +
        core.map(function (c) {
          return '<div class="sw"><div class="sw-chip" style="background:' + c[1] + ';color:' + c[2] + '">' + c[0] + '</div><div class="sw-body"><b>' + c[0] + '</b><code>' + c[1] + '</code><span>' + esc(c[3]) + '</span></div></div>';
        }).join('') + '</div></section>';

      function themebox(cls, name, sub) {
        return '<div class="themebox ' + cls + '" data-roles><h4>' + name + '<span>' + sub + '</span></h4><div class="rolelist">' + ROLES.map(function (r) {
          return '<div class="role"><i style="background:var(' + r[0] + ')"></i><b>' + r[1] + '</b><code data-var="' + r[0] + '">' + r[0] + '</code></div>';
        }).join('') + '</div></div>';
      }
      var roles = '<section class="al-sec" id="roles"><div class="al-sec-h"><p class="al-eyebrow">Roles</p><h2>The same names in both themes</h2>' +
        '<p>Components only ever use role tokens. Each value below is read live from tokens.css, so this page always matches the code.</p></div><div class="split">' +
        themebox('t-light', 'Mist', 'Light theme') + themebox('t-dark', 'After hours', 'Dark theme') + '</div></section>';

      var ramps = '<section class="al-sec" id="ramps"><div class="al-sec-h"><p class="al-eyebrow">Ramps</p><h2>Six ramps, 50 to 950</h2>' +
        '<p>Built in OKLab so each step is an even visual distance. The outlined chip is the base the role tokens are drawn from.</p></div><div class="ramp-wrap al-panel al-pad"><div>' +
        '<div class="ramp-head"><span></span>' + STEPS.map(function (s) { return '<span>' + s + '</span>'; }).join('') + '</div>' +
        Object.keys(RAMPS).map(function (k) {
          return '<div class="ramp al-stagger"><b>' + k + '</b>' + RAMPS[k].map(function (h, j) {
            var ink = lum(h) > 0.32 ? '#1C2533' : '#F1F4F8';
            return '<i class="' + (j === BASE[k] ? 'base' : '') + '" style="background:' + h + ';color:' + ink + '">' + STEPS[j] + '<span style="opacity:.75">' + h.slice(1) + '</span></i>';
          }).join('') + '</div>';
        }).join('') + '</div></div></section>';

      var st = [['closed', 'Closed', 'Locked, at rest, nothing happening'], ['lit', 'Lamp on', 'Unlocked, live, lit'], ['working', 'Working on it', 'Something is running'],
        ['waiting', 'On its way', 'Waiting on someone or something'], ['unknown', 'Not sure yet', 'An outcome we couldn’t observe'],
        ['problem', 'Couldn’t open', 'Something went wrong, with a way forward'], ['done', 'Saved', 'Finished and confirmed'], ['rec', 'Recording', 'Capturing audio now']];
      function stateBox(cls, name) {
        return '<div class="themebox ' + cls + '"><h4>' + name + '</h4><div style="display:flex;flex-direction:column;gap:10px">' + st.map(function (s) {
          return '<div style="display:grid;grid-template-columns:150px 1fr;gap:12px;align-items:center">' + U.state(s[0], s[1]) + '<span class="al-small" style="color:var(--al-ink-2)">' + s[2] + '</span></div>';
        }).join('') + '</div></div>';
      }
      var states = '<section class="al-sec" id="states"><div class="al-sec-h"><p class="al-eyebrow">States</p><h2>Meaning has its own colours</h2>' +
        '<p>State colours are separate from the accent. Each state also has its own dot shape, so it reads without colour.</p></div><div class="split">' +
        stateBox('t-light', 'Mist') + stateBox('t-dark', 'After hours') + '</div></section>';

      var contrast = '<section class="al-sec" id="contrast"><div class="al-sec-h"><p class="al-eyebrow">Contrast</p><h2>Measured, not guessed</h2>' +
        '<p>Each pair is measured from the live tokens when this page draws. Body text needs 4.5:1; every pair here clears it.</p></div><div class="split">' +
        ['t-light', 't-dark'].map(function (cls) {
          return '<div class="themebox ' + cls + '" data-pairs><h4>' + (cls === 't-light' ? 'Mist' : 'After hours') + '</h4><div class="pairs">' + PAIRS.map(function (p) {
            return '<div class="pair" data-fg="' + p[0] + '" data-bg="' + p[1] + '" style="background:var(' + p[1] + ');color:var(' + p[0] + ')"><span class="big">Aa 9,209</span>' +
              '<span style="font-size:14px;font-weight:600">' + p[2] + '</span><span class="meta"><span class="r">…</span><span class="badge-aa">AA</span></span></div>';
          }).join('') + '</div></div>';
        }).join('') + '</div></section>';

      var usage = '<section class="al-sec" id="usage"><div class="al-sec-h"><p class="al-eyebrow">Proportion</p><h2>Mostly mist, some dusk, a little lamp</h2></div>' +
        '<div class="ratio"><div style="background:var(--al-bg);color:var(--al-ink)">60 · Mist and paper</div><div style="background:var(--al-dusk);color:var(--al-dusk-ink)">30 · Dusk and ink</div>' +
        '<div style="background:var(--al-lamp);color:var(--al-lamp-ink)">10 · Lamp</div></div>' +
        '<div class="al-dodont" style="margin-top:18px"><div class="al-panel al-pad"><p class="al-verdict do">' + I('check') + 'Do</p><p class="al-p">Use lamp amber for the one thing that is lit or live: the lamp dot, a recording, a bookmark, the unlock button, the progress of the first run.</p>' +
        '<div class="show-row">' + U.state('lit', 'Lamp on') + '<span class="al-mark">S1</span><span class="al-btn al-btn--lamp al-btn--sm">' + I('fingerprint') + 'Unlock</span></div></div>' +
        '<div class="al-panel al-pad"><p class="al-verdict dont">' + I('x') + 'Don’t</p><p class="al-p">Don’t use lamp amber for headings, borders, illustrations of decoration, or more than one call to action on a screen. If everything glows, nothing is lit.</p>' +
        '<div class="show-row"><span style="color:var(--al-lamp-text);font-weight:800;font-size:20px">A lamp heading</span><span class="al-btn al-btn--lamp al-btn--sm">Save</span><span class="al-btn al-btn--lamp al-btn--sm">Share</span></div></div></div></section>';
      return coreHtml + roles + ramps + states + contrast + usage;
    },
    mount: function (view) {
      AL.each(view, '[data-roles]', function (box) {
        AL.each(box, 'code[data-var]', function (c) { c.textContent = readVar(box, c.getAttribute('data-var')); c.title = c.getAttribute('data-var'); });
      });
      AL.each(view, '.pair', function (p) {
        var fg = readVar(p, p.getAttribute('data-fg')), bg = readVar(p, p.getAttribute('data-bg')), r = ratio(fg, bg);
        p.querySelector('.r').textContent = r.toFixed(1) + ':1 · ' + fg + ' on ' + bg;
        p.querySelector('.badge-aa').textContent = r >= 7 ? 'AAA' : (r >= 4.5 ? 'AA' : 'Large only');
      });
    }
  });
})();
