/* 01 Brand / Illustration. */
(function () {
  var AL = window.AL, I = AL.icon, esc = AL.esc;

  var SPOTS = [['shelf', 'An empty shelf', 'No notes yet'], ['meetings', 'A microphone', 'No calls or recordings yet'],
    ['credits', 'Credits', 'No credits yet; a pack to buy'], ['closed', 'The door closed', 'Lock screen, closed state'],
    ['check', 'The server check', 'Verifying the private server'], ['ready', 'Lamp on', 'Unlocked, ready to work'],
    ['unknown', 'Not sure yet', 'An outcome we couldn’t observe'], ['altered', 'A changed file', 'A record that failed its check'],
    ['search', 'Nothing found', 'Search with no results']];

  AL.page({
    id: 'illustration', group: 'brand', order: 4, title: 'Illustration', icon: 'image', file: 'illustration',
    keywords: 'drawing scene spot empty state light lamp art',
    lede: 'Every picture is a room at dusk lit by one lamp. Flat shapes, the dusk palette, and a single warm gradient where the light falls. No people, only the things people work with.',
    render: function () {
      var scene = '<section class="al-sec" id="scene"><div class="al-sec-h"><p class="al-eyebrow">The scene</p><h2>One room, one lamp</h2>' +
        '<p>The cover scene is the source of every other drawing. Watch it draw: the niche appears, the lamp warms, and light pools on the floor.</p></div>' +
        '<div class="cover" style="grid-template-columns:minmax(0,1fr);min-height:0"><div class="cover-art" style="padding:24px 24px 0">' + AL.art.cover() + '</div></div>' +
        '<div class="al-grid al-g4 al-stagger" style="margin-top:16px">' +
        [['arch', 'The niche', 'Always the arch from the mark: a half circle on two straight sides.'], ['lamp', 'One light source', 'Light comes from the lamp, low and to the left, and nowhere else.'],
          ['book', 'Things, not people', 'Books, papers, a desk, a microphone. Never faces or hands.'], ['palette', 'Two families of colour', 'The dusk ramp for the room, lamp amber for light.']].map(function (k) {
          return '<div class="al-panel al-pad">' + I(k[0]) + '<h3 class="al-h3" style="margin-top:10px">' + k[1] + '</h3><p class="al-small" style="color:var(--al-ink-2)">' + k[2] + '</p></div>';
        }).join('') + '</div></section>';

      var spots = '<section class="al-sec" id="spots"><div class="al-sec-h"><p class="al-eyebrow">Spot illustrations</p><h2>Small scenes for empty and status states</h2>' +
        '<p>Each one is the niche with a single object inside. They are drawn with theme tokens, so they follow light and dark like the interface.</p></div>' +
        '<div class="al-grid al-g3 al-stagger">' + SPOTS.map(function (s) {
          return '<figure class="al-panel" style="margin:0;padding:16px 18px"><div style="background:var(--al-bg);border-radius:14px;padding:10px 20px">' + AL.art.spot(s[0]) + '</div>' +
            '<figcaption class="al-caption"><b>' + esc(s[1]) + '</b><span>' + esc(s[2]) + '</span></figcaption></figure>';
        }).join('') + '</div></section>';

      var light = '<section class="al-sec" id="light"><div class="al-sec-h"><p class="al-eyebrow">Light</p><h2>How the lamp lights a room</h2></div>' +
        '<div class="al-grid al-g2"><div class="al-panel al-pad"><div style="height:120px;border-radius:14px;background:radial-gradient(circle at 35% 70%, #FFF1D2 0%, #F6BE6B 35%, #B8742B 75%, #4A3017 100%)"></div>' +
        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px;font-size:13px">' +
        [['#FFF1D2', 'Bulb'], ['#F6BE6B', 'Lit wall'], ['#B8742B', 'Falloff'], ['#4A3017', 'Edge']].map(function (c) {
          return '<div><i style="display:block;height:28px;border-radius:8px;background:' + c[0] + '"></i><b style="display:block;margin-top:6px">' + c[1] + '</b><code>' + c[0] + '</code></div>';
        }).join('') + '</div></div><div class="al-panel al-pad"><ul class="spec-list" style="grid-template-columns:1fr">' +
        '<li>The only gradient in the brand is lamp light: a radial from the bulb, warm to dark, ending in the dusk wall.</li>' +
        '<li>Lit things keep their colour; unlit things lose saturation and brightness rather than turning grey.</li>' +
        '<li>Light pools on the floor as a soft ellipse. It never casts hard shadows.</li>' +
        '<li>When the lamp goes out, everything dims over 600 ms. Nothing disappears.</li>' +
        '<li>In the interface the same idea becomes the lamp dot and its glow; illustrations are for empty, first-run and marketing moments.</li></ul></div></div></section>';
      return scene + spots + light;
    }
  });
})();
