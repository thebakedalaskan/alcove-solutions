/* 02 Design system / Space and shape. */
(function () {
  var AL = window.AL, I = AL.icon, U = AL.ui, M = AL.marks;

  AL.page({
    id: 'layout', group: 'system', order: 4, title: 'Space and shape', nav: 'Space and shape', icon: 'layout', file: 'layout',
    keywords: 'spacing radius arch elevation shadow grid frame layout',
    lede: 'Generous space, soft corners and one signature shape: the arch. Pages, dialogs and thumbnails open at the top like the niche in the mark, so every surface feels like part of the same room.',
    render: function () {
      var sp = [[1, 4, 'Icon to label in chips'], [2, 8, 'Between related controls'], [3, 12, 'Inside rows and small cards'], [4, 16, 'Card padding, grid gaps'],
        [5, 20, 'Panels'], [6, 24, 'Section padding inside panels'], [8, 32, 'Between groups'], [10, 40, 'Page gutters'], [12, 48, 'Between blocks'], [16, 64, 'Between sections']];
      var space = '<section class="al-sec" id="space"><div class="al-sec-h"><p class="al-eyebrow">Space</p><h2>A four-point scale</h2><p>Everything sits on multiples of 4. Use the larger steps freely; calm needs room.</p></div>' +
        '<div class="al-panel al-pad">' + sp.map(function (s, k) {
          return '<div class="space-row"><code>space-' + s[0] + '</code><b>' + s[1] + ' px</b><div style="display:flex;align-items:center;gap:14px"><i style="width:' + (s[1] * 4) + 'px;animation-delay:' + (k * 50) + 'ms"></i><span class="al-small">' + s[2] + '</span></div></div>';
        }).join('') + '</div></section>';

      var r = [['xs', 6, 'Tags, small marks'], ['sm', 10, 'Inputs in rows, menu items'], ['md', 14, 'Banners, nested cards'], ['lg', 18, 'Cards and panels'], ['xl', 26, 'Covers and stages'], ['pill', 999, 'Buttons, chips, the composer']];
      var radii = '<section class="al-sec" id="radius"><div class="al-sec-h"><p class="al-eyebrow">Corners</p><h2>Soft, never sharp</h2></div><div class="radius-grid al-stagger">' +
        r.map(function (x) { return '<div><i style="border-radius:' + Math.min(x[1], 48) + 'px"></i><b>' + x[0] + ' · ' + (x[1] === 999 ? 'full' : x[1] + ' px') + '</b><span class="al-small">' + x[2] + '</span></div>'; }).join('') +
        '<div><i style="border-radius:var(--al-arch)"></i><b>arch</b><span class="al-small">Pages, dialogs, thumbnails</span></div></div></section>';

      var arch = '<section class="al-sec" id="arch"><div class="al-sec-h"><p class="al-eyebrow">The arch</p><h2>The signature shape</h2>' +
        '<p>The arch radius is an ellipse: full width, 86 px tall at the top, 16 px at the bottom. It appears where something opens: the page you read, a dialog that asks, a file on the shelf.</p></div>' +
        '<div class="al-grid al-g3 al-stagger"><figure style="margin:0"><div class="al-specimen" style="min-height:240px;align-items:flex-end;padding-bottom:0"><div style="width:80%;height:200px;background:var(--al-surface);border:1px solid var(--al-line);border-bottom:0;border-radius:999px 999px 0 0 / 86px 86px 0 0;padding:46px 26px 0">' +
        '<b style="display:block;text-align:center">Launch planning</b><div style="display:flex;flex-direction:column;gap:8px;margin-top:16px"><i class="al-skel" style="animation:none"></i><i class="al-skel" style="animation:none;width:80%"></i><i class="al-skel" style="animation:none;width:90%"></i></div></div></div>' +
        '<figcaption class="al-caption"><b>The page</b><span>Documents and notes</span></figcaption></figure>' +
        '<figure style="margin:0"><div class="al-specimen" style="min-height:240px">' + U.sheet({ width: 250, title: 'Unlock Alcove?', text: 'Use your passkey.', mark: M.mark(30), actions: '<span class="al-btn al-btn--lamp al-btn--sm">Unlock</span>' }) + '</div>' +
        '<figcaption class="al-caption"><b>The arch sheet</b><span>Moments that ask</span></figcaption></figure>' +
        '<figure style="margin:0"><div class="al-specimen" style="min-height:240px"><div style="width:180px">' + U.filecard(U.item('lease')) + '</div></div>' +
        '<figcaption class="al-caption"><b>The thumbnail</b><span>Calls in Notes</span></figcaption></figure></div>' +
        '<ul class="spec-list" style="margin-top:18px"><li>Use the arch once per view, on the thing that opens.</li><li>Never arch buttons, inputs or chips; they stay pill-shaped.</li><li>Text inside an arch starts below the curve: 44 to 56 px of top padding.</li></ul></section>';

      var elev = '<section class="al-sec" id="elevation"><div class="al-sec-h"><p class="al-eyebrow">Elevation</p><h2>Four levels, set by role</h2></div><div class="elev al-stagger">' +
        '<div style="border:1px solid var(--al-line)"><b>Flat</b><span class="al-small">A line only. Rows, tables.</span></div>' +
        '<div style="box-shadow:var(--al-shadow-1);border:1px solid var(--al-line)"><b>Resting</b><span class="al-small">shadow-1 · cards, panels</span></div>' +
        '<div style="box-shadow:var(--al-shadow-2)"><b>Lifted</b><span class="al-small">shadow-2 · hover, menus</span></div>' +
        '<div style="box-shadow:var(--al-shadow-3)"><b>Over</b><span class="al-small">shadow-3 · sheets, toasts</span></div></div></section>';

      var frame = '<section class="al-sec" id="frame"><div class="al-sec-h"><p class="al-eyebrow">The app frame</p><h2>Sidebar, the room, and notes beside it</h2>' +
        '<p>The app is designed for browser windows from 960 by 600 up. The sidebar is 236 px; the Ask panel docks at 372 px on the right when it is open, and the page in the middle keeps its text to 62 characters.</p></div>' +
        '<div class="frame-map al-stagger"><div style="background:var(--al-sunken)"><b>Sidebar · 236</b><span class="al-small">Brand and lamp, New call and Record, search, Home, Calls, Record, Notes, Ask, Credits</span></div>' +
        '<div style="background:var(--al-bg)"><b>Content · flexible</b><span class="al-small">Home, a call, a recording, notes or credits. 22 by 28 px padding.</span></div>' +
        '<div style="background:var(--al-surface);border-left:1px solid var(--al-line)"><b>Notes · 372</b><span class="al-small">Live notes and the transcript beside a call, or Ask beside a notes page.</span></div></div></section>';
      return space + radii + arch + elev + frame;
    }
  });
})();
