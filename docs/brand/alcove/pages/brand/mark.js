/* 01 Brand / Mark and logo. */
(function () {
  var AL = window.AL, I = AL.icon, M = AL.marks, esc = AL.esc;

  function sec(id, eyebrow, title, sub, body) {
    return '<section class="al-sec" id="' + id + '"><div class="al-sec-h"><p class="al-eyebrow">' + eyebrow + '</p><h2>' + title + '</h2>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>' + body + '</section>';
  }
  function tile(inner, caption, sub, style) {
    return '<figure style="margin:0"><div class="al-specimen" style="' + (style || '') + '">' + inner + '</div><figcaption class="al-caption"><b>' + caption + '</b><span>' + (sub || '') + '</span></figcaption></figure>';
  }

  AL.page({
    id: 'mark', group: 'brand', order: 2, title: 'Mark and logo', nav: 'Mark and logo', icon: 'arch', file: 'mark',
    keywords: 'logo wordmark lockup app icon menu bar favicon clear space',
    lede: 'An arch with a lamp inside. The arch is the room; the lamp says whether it is open. Because the lamp is also the lock state, the mark has to tell the truth.',
    render: function () {
      var hero = '<div class="al-grid al-g2">' +
        tile(M.mark(170, { label: 'Alcove mark, lamp on' }), 'Lamp on', 'The everyday mark', 'min-height:300px') +
        tile(M.mark(170, { fg: '#A9C4EC', label: 'Alcove mark on dusk' }), 'On dusk', 'Covers, splash, marketing', 'min-height:300px;background:var(--al-dusk);border-color:transparent') + '</div>';

      var construct = '<div class="al-grid al-g2"><div class="al-panel al-pad" style="display:flex;align-items:center;justify-content:center"><div style="width:min(420px,100%)">' + M.construction() + '</div></div>' +
        '<div class="al-panel al-pad"><h3 class="al-h3">On a 100-unit grid</h3><ul class="spec-list" style="grid-template-columns:1fr;margin-top:12px">' +
        '<li>The arch is 56 wide and 72 tall, with a 28-unit radius: a half circle on two straight sides.</li>' +
        '<li>The lamp sits at 50, 64, a little below centre, so light falls toward the floor of the room.</li>' +
        '<li>The lamp is 7.5 units; its glow is a 15-unit circle at 28% opacity.</li>' +
        '<li>At 24 px and below the glow drops and the lamp grows to 9.5 units so it stays visible.</li>' +
        '<li>The arch is one solid shape. Never outline it except in the browser tab, where it must read at 16 px.</li></ul></div></div>';

      var lockups = '<div class="al-grid al-g3">' +
        tile(M.lockup(64), 'Horizontal', 'Default lockup') +
        tile(M.stacked(84), 'Stacked', 'Square spaces') +
        tile('<span class="al-wm" style="font-size:72px">alcove</span>', 'Wordmark', 'When the mark is nearby') +
        tile(M.lockup(52, { fg: '#A9C4EC' }), 'On dusk', 'Twilight arch, warm lamp', 'background:var(--al-dusk);border-color:transparent;color:#F7F3EA') +
        tile(M.lockup(52, { fg: '#3A2600', lamp: '#FFF6DF' }), 'On lamp', 'Single colour', 'background:var(--al-lamp);border-color:transparent;color:#3A2600') +
        tile(M.lockup(52, { fg: 'currentColor', lamp: 'currentColor', glow: false }), 'One colour', 'Print, embossing, stamps') + '</div>';

      var clear = '<div class="al-grid al-g2"><div class="al-specimen" style="min-height:260px"><div style="position:relative;padding:28px;border:1.5px dashed var(--al-info);border-radius:8px">' +
        '<span style="position:absolute;left:4px;top:4px;font-size:12px;color:var(--al-info);font-weight:600">r</span>' + M.lockup(72) + '</div></div>' +
        '<div class="al-panel al-pad"><h3 class="al-h3">Clear space and size</h3><ul class="spec-list" style="grid-template-columns:1fr;margin-top:12px">' +
        '<li>Keep clear space equal to the arch’s radius on every side: 28% of the mark’s height.</li>' +
        '<li>The mark works from 16 px. The horizontal lockup needs at least 72 px of width.</li>' +
        '<li>The wordmark is always lowercase Alegreya Sans 800 at −3.5% tracking. Don’t retype it in another face.</li>' +
        '<li>On photos, put the lockup on a dusk panel rather than straight on the image.</li></ul></div></div>';

      var icons = '<div class="al-panel al-pad" style="display:flex;align-items:flex-end;gap:28px;flex-wrap:wrap">' +
        [160, 96, 64, 40, 24, 16].map(function (s) { return '<figure style="margin:0;display:flex;flex-direction:column;align-items:center;gap:10px">' +
          '<span style="filter:drop-shadow(0 12px 18px rgba(10,16,30,.25))">' + M.appIcon(s) + '</span><figcaption class="al-small">' + s + ' px</figcaption></figure>'; }).join('') +
        '<p class="al-small" style="flex:1 1 220px">The app icon is fixed artwork: a lit arch on a dusk squircle, the same in light and dark. It is the only place the lamp is drawn as a warm gradient.</p></div>';

      var states = [['closed', 'Closed', 'Vault locked; the key is sealed on this device'], ['on', 'Lamp on', 'Unlocked, with the time left before it closes'],
        ['rec', 'Recording', 'A meeting is being captured, even if the app is closed'], ['needs', 'Needs you', 'A purchase to sign, or notes waiting for unlock']];
      var bar = function (mode) {
        return '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px">' + states.map(function (s) {
          return '<div style="display:flex;flex-direction:column;gap:6px"><div style="--mb-bg:' + (mode === 'dark' ? '#2B2B2E' : '#E8E8EA') + ';height:34px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:' +
            (mode === 'dark' ? '#2B2B2E;color:#F5F5F7' : '#E8E8EA;color:#1D1D1F') + '">' + M.glyph(s[0], 19) + '</div><span class="al-small"><b style="color:var(--al-ink)">' + s[1] + '</b><br>' + s[2] + '</span></div>';
        }).join('') + '</div>';
      };
      var menubar = '<div class="al-grid al-g2"><div class="al-panel al-pad"><p class="al-small" style="margin-bottom:12px">Light tab bar</p>' + bar('light') + '</div>' +
        '<div class="al-panel al-pad"><p class="al-small" style="margin-bottom:12px">Dark tab bar</p>' + bar('dark') + '</div></div>' +
        '<div class="al-panel al-pad" style="margin-top:16px;display:flex;align-items:center;gap:22px;flex-wrap:wrap"><div id="mb-live" style="--mb-bg:#E8E8EA;width:120px;height:40px;border-radius:9px;background:#E8E8EA;color:#1D1D1F;display:flex;align-items:center;justify-content:center">' +
        M.glyph('closed', 22) + '</div><div><b id="mb-live-t">Closed</b><p class="al-small" id="mb-live-d" style="margin:2px 0 0">Watch the glyph move through a working day.</p></div></div>';

      var call = '<div class="al-grid al-g2"><div style="border-radius:16px;background:#1E2024;padding:12px;display:grid;grid-template-columns:1fr 1fr;gap:10px;aspect-ratio:16/10">' +
        [['Maya Chen', '#7A6BB0'], ['Dan Ortiz', '#3F7D66'], ['You', '#5C6675'], ['Priya (guest)', '#B06A3C']].map(function (p, k) {
          return '<div style="position:relative;border-radius:10px;background:#2B2E33;display:flex;align-items:center;justify-content:center;' + (k === 3 ? 'box-shadow:inset 0 0 0 2px rgba(244,180,90,.8)' : '') + '">' +
            '<span style="width:52px;height:52px;border-radius:50%;background:' + p[1] + ';display:flex;align-items:center;justify-content:center;color:#fff;font:500 22px var(--al-font-ui)">' + p[0].charAt(0) +
            '</span><span style="position:absolute;left:10px;bottom:8px;color:#fff;font-size:12.5px">' + esc(p[0]) + '</span></div>';
        }).join('') + '</div><div class="al-panel al-pad"><h3 class="al-h3">The name does the work</h3>' +
        '<p class="al-p">In an Alcove call there is no bot tile. The brand shows up as the lamp: a Notes on chip that everyone sees before joining and during the call, and a lamp ring around whoever is speaking.</p>' +
        '<p class="al-p" style="margin:0">Guests meet the brand first in the lobby: their own preview, and three lines that say what the room is.</p></div></div>';

      var dont = [
        ['<span style="display:inline-block;transform:scaleX(1.55)">' + M.mark(96) + '</span>', 'Don’t stretch or squash it.'],
        [M.mark(96, { lamp: '#3B82F6' }), 'Don’t change the lamp’s colour. It is always lamp amber.'],
        ['<span style="filter:drop-shadow(5px 7px 0 #E8A33C) drop-shadow(0 0 10px #2D5F9A) saturate(1.8)">' + M.mark(96) + '</span>', 'Don’t add shadows, outlines or effects.'],
        ['<div style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:14px 18px;border-radius:14px;background:var(--al-dusk);color:#F1F4F8">' + M.mark(56, { fg: '#A9C4EC' }) + '<b style="font-size:14px">Alcove is closed</b></div>', 'Never show the lamp lit while the vault is closed.'],
        ['<span style="display:inline-flex;align-items:center;gap:12px">' + M.mark(56) + '<span style="font:italic 700 46px Georgia,serif">Alcove</span></span>', 'Don’t set the wordmark in another face or in title case.'],
        ['<span style="display:inline-flex;align-items:center;gap:2px">' + M.mark(56) + '<span class="al-wm" style="font-size:52px">alcove</span></span>', 'Don’t crowd the mark against the wordmark.']];
      var donts = '<div class="al-grid al-g3">' + dont.map(function (d) {
        return '<figure style="margin:0"><div class="al-specimen" style="min-height:170px;position:relative">' + d[0] + '</div><p class="al-verdict dont">' + I('x') + 'Don’t</p><p class="al-small" style="color:var(--al-ink-2)">' + d[1] + '</p></figure>';
      }).join('') + '</div>';

      return sec('the-mark', 'The mark', 'An arch with a lamp inside', 'The arch is the room your work lives in. The lamp is your session: lit while Alcove is unlocked, out when the door closes.', hero) +
        sec('construction', 'Construction', 'Drawn on a simple grid', null, construct) +
        sec('lockups', 'Lockups', 'Mark, wordmark and the space between', 'The gap between mark and wordmark is the arch’s radius. Use the horizontal lockup unless the space is square.', lockups) +
        sec('clear-space', 'Clear space', 'Room to breathe', null, clear) +
        sec('app-icon', 'App icon', 'A lit window at dusk', null, icons) +
        sec('menu-bar', 'Browser tab', 'The lock state, all day', 'The tab’s icon is how people know, at a glance, whether their room is open. Each state has its own shape, so it reads without colour.', menubar) +
        sec('in-a-call', 'In a meeting', 'How strangers meet the brand', null, call) +
        sec('misuse', 'Misuse', 'Six ways to break it', null, donts);
    },
    mount: function (view) {
      var box = view.querySelector('#mb-live');
      if (!box) return;
      var seq = [['closed', 'Closed', 'Morning: the vault is locked and the key is sealed on this device.'], ['on', 'Lamp on', 'Unlocked with your passkey. The lamp stays on while you work.'],
        ['rec', 'Recording', 'A call or a room recording is running, even in another tab.'], ['needs', 'Needs you', 'The meeting notes are ready. Unlock to put them on your shelf.'],
        ['closed', 'Closed', 'Fifteen idle minutes later, the door closes on its own.']];
      var k = 0;
      function step() {
        var s = seq[k % seq.length];
        box.innerHTML = M.glyph(s[0], 22);
        box.firstChild.style.animation = 'al-pop 320ms var(--al-ease-out) both';
        view.querySelector('#mb-live-t').textContent = s[1];
        view.querySelector('#mb-live-d').textContent = s[2];
        k += 1;
      }
      step();
      if (!AL.reduce) {
        var t = setInterval(step, 2400);
        AL.onLeave(function () { clearInterval(t); });
      }
    }
  });
})();
