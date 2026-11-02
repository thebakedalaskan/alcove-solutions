/* 02 Design system / Tokens. Values are read from tokens.css at runtime, then offered as CSS and JSON. */
(function () {
  var AL = window.AL, I = AL.icon, esc = AL.esc;

  var TOKENS = [
    ['Colour', [['--al-bg', 'Ground of pages and windows'], ['--al-surface', 'Cards, the open page, sheets'], ['--al-sunken', 'Sidebars, wells, title bars'], ['--al-raised', 'Inputs, menus, popovers'],
      ['--al-ink', 'Primary text'], ['--al-ink-2', 'Secondary text'], ['--al-ink-3', 'Captions, icons at rest'], ['--al-line', 'Borders'], ['--al-line-strong', 'Input borders, emphasis'],
      ['--al-accent', 'Primary actions, the arch'], ['--al-accent-ink', 'Text on accent'], ['--al-accent-text', 'Accent used as text'], ['--al-accent-soft', 'Selection, your messages'],
      ['--al-lamp', 'Lit and live things'], ['--al-lamp-ink', 'Text on lamp'], ['--al-lamp-text', 'Waiting text'], ['--al-lamp-soft', 'Waiting backgrounds'],
      ['--al-positive', 'Done'], ['--al-positive-soft', 'Done backgrounds'], ['--al-unknown', 'Not sure yet'], ['--al-unknown-soft', 'Not sure backgrounds'],
      ['--al-negative', 'Problems'], ['--al-negative-soft', 'Problem backgrounds'], ['--al-info', 'Information, links'], ['--al-focus', 'Focus ring'],
      ['--al-dusk', 'Brand ground (both themes)'], ['--al-dusk-ink', 'Text on dusk'], ['--al-dusk-ink-2', 'Secondary text on dusk']]],
    ['Type', [['--al-font-ui', 'Interface and display'], ['--al-font-read', 'Pages, files, transcripts, quotes'], ['--al-font-mono', 'IDs and codes']]],
    ['Space', [['--al-space-1', '4'], ['--al-space-2', '8'], ['--al-space-3', '12'], ['--al-space-4', '16'], ['--al-space-5', '20'], ['--al-space-6', '24'], ['--al-space-8', '32'], ['--al-space-10', '40'], ['--al-space-12', '48'], ['--al-space-16', '64']]],
    ['Shape', [['--al-r-xs', 'Tags'], ['--al-r-sm', 'Small controls'], ['--al-r-md', 'Banners'], ['--al-r-lg', 'Cards'], ['--al-r-xl', 'Covers'], ['--al-r-pill', 'Buttons, chips'], ['--al-arch', 'The arch'], ['--al-stroke', 'Icon stroke']]],
    ['Elevation', [['--al-shadow-1', 'Resting'], ['--al-shadow-2', 'Lifted'], ['--al-shadow-3', 'Over'], ['--al-glow', 'The lamp’s glow'], ['--al-scrim', 'Behind sheets']]],
    ['Motion', [['--al-t-fast', 'Hover, press'], ['--al-t-soft', 'Switches, tabs'], ['--al-t-fade', 'Scrims'], ['--al-t-rise', 'Arrivals'], ['--al-t-warm', 'The lamp, frost'], ['--al-t-sheet', 'Sheets'],
      ['--al-t-stagger', 'Between rows'], ['--al-rise', 'Rise distance'], ['--al-ease-out', 'Arrivals'], ['--al-ease-warm', 'Light'], ['--al-ease-in-out', 'Progress']]]];

  function read(el, name) { return getComputedStyle(el).getPropertyValue(name).trim(); }

  AL.page({
    id: 'tokens', group: 'system', order: 7, title: 'Tokens', icon: 'code', file: 'tokens',
    keywords: 'css variables json export design tokens',
    lede: 'Every decision in this book as a named value. Components read only these names, so the app, the site and this book stay in step. Values below come straight from tokens.css.',
    meta: [['code', 'assets/css/tokens.css']],
    render: function () {
      var tables = TOKENS.map(function (g) {
        return '<h3 class="al-h3" style="margin:30px 0 12px">' + g[0] + '</h3><div class="al-table-wrap"><table class="al-table"><thead><tr><th>Token</th><th>Mist</th><th>After hours</th><th>Used for</th></tr></thead><tbody>' +
          g[1].map(function (t) {
            var sw = g[0] === 'Colour';
            return '<tr data-tok="' + t[0] + '"><td><code>' + t[0] + '</code></td><td class="t-light" style="background:transparent">' + (sw ? '<span style="display:inline-block;width:14px;height:14px;border-radius:4px;vertical-align:-2px;margin-right:8px;box-shadow:inset 0 0 0 1px rgba(127,127,127,.3);background:var(' + t[0] + ')"></span>' : '') +
              '<code class="v">…</code></td><td class="t-dark" style="background:transparent;color:inherit">' + (sw ? '<span style="display:inline-block;width:14px;height:14px;border-radius:4px;vertical-align:-2px;margin-right:8px;box-shadow:inset 0 0 0 1px rgba(127,127,127,.3);background:var(' + t[0] + ')"></span>' : '') +
              '<code class="v" style="color:var(--al-ink-2)">…</code></td><td>' + esc(t[1]) + '</td></tr>';
          }).join('') + '</tbody></table></div>';
      }).join('');
      return '<section class="al-sec" id="naming"><div class="al-sec-h"><p class="al-eyebrow">Naming</p><h2>One prefix, one meaning each</h2>' +
        '<p>Tokens are named for what they do, not what they look like: <code>--al-lamp</code>, never <code>--al-amber</code>. A component that needs a colour without a role here needs a new role, not a hex.</p></div></section>' +
        '<section class="al-sec" id="all"><div class="al-sec-h"><p class="al-eyebrow">Reference</p><h2>Every token</h2></div>' + tables + '</section>' +
        '<section class="al-sec" id="export"><div class="al-sec-h"><p class="al-eyebrow">Export</p><h2>Take them with you</h2><p>CSS for the app and site, JSON for design tools. Both are generated from the live values on this page.</p></div>' +
        '<div class="al-grid al-g2"><div class="al-panel al-pad"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><b>tokens.css</b><button class="al-btn al-btn--secondary al-btn--sm" type="button" id="copy-css">' + I('copy') + 'Copy CSS</button></div>' +
        '<pre id="out-css" style="margin:0;max-height:360px;overflow:auto;padding:14px;border-radius:12px;background:var(--al-bg);font:12px/1.55 var(--al-font-mono);color:var(--al-ink-2)"></pre></div>' +
        '<div class="al-panel al-pad"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><b>tokens.json</b><button class="al-btn al-btn--secondary al-btn--sm" type="button" id="copy-json">' + I('copy') + 'Copy JSON</button></div>' +
        '<pre id="out-json" style="margin:0;max-height:360px;overflow:auto;padding:14px;border-radius:12px;background:var(--al-bg);font:12px/1.55 var(--al-font-mono);color:var(--al-ink-2)"></pre></div></div>' +
        '<p class="al-small" id="copy-status" aria-live="polite" style="margin-top:10px"></p></section>';
    },
    mount: function (view) {
      var light = document.createElement('div'), dark = document.createElement('div');
      light.className = 't-light'; dark.className = 't-dark';
      light.hidden = dark.hidden = true;
      view.appendChild(light); view.appendChild(dark);
      var css = ':root {\n', cssDark = '\n.t-dark {\n', json = {};
      TOKENS.forEach(function (g) {
        json[g[0].toLowerCase()] = {};
        g[1].forEach(function (t) {
          var lv = read(light, t[0]), dv = read(dark, t[0]);
          var tr = view.querySelector('tr[data-tok="' + t[0] + '"]');
          if (tr) { var v = tr.querySelectorAll('.v'); v[0].textContent = lv; v[1].textContent = dv === lv ? 'same' : dv; }
          css += '  ' + t[0] + ': ' + lv + ';\n';
          if (dv !== lv) cssDark += '  ' + t[0] + ': ' + dv + ';\n';
          json[g[0].toLowerCase()][t[0].replace('--al-', '')] = dv === lv ? { value: lv } : { light: lv, dark: dv };
        });
      });
      light.remove(); dark.remove();
      var cssText = css + '}\n' + cssDark + '}\n', jsonText = JSON.stringify(json, null, 2);
      view.querySelector('#out-css').textContent = cssText;
      view.querySelector('#out-json').textContent = jsonText;
      var status = view.querySelector('#copy-status');
      function copy(text, what) {
        try { navigator.clipboard.writeText(text).then(function () { status.textContent = what + ' copied.'; }, function () { status.textContent = 'Couldn’t copy here. Select the text above instead.'; }); }
        catch (e) { status.textContent = 'Couldn’t copy here. Select the text above instead.'; }
      }
      view.querySelector('#copy-css').addEventListener('click', function () { copy(cssText, 'CSS'); });
      view.querySelector('#copy-json').addEventListener('click', function () { copy(jsonText, 'JSON'); });
    }
  });
})();
