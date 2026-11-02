/* 02 Design system / Iconography. */
(function () {
  var AL = window.AL, I = AL.icon, U = AL.ui, esc = AL.esc;

  var GROUPS = [
    ['The room', ['arch', 'lamp', 'door', 'shelf', 'lock', 'unlock', 'key', 'fingerprint', 'shield', 'server']],
    ['Your work', ['page', 'file', 'pdf', 'md', 'txt', 'wave', 'bookmark', 'quote', 'edit', 'trash', 'upload', 'folder', 'folderopen', 'search']],
    ['Asking and meetings', ['ask', 'meeting', 'mic', 'micoff', 'record', 'stop', 'users', 'user', 'calendar', 'clock', 'hourglass']],
    ['Credits', ['credits', 'receipt', 'wallet']],
    ['Feedback', ['check', 'checkcircle', 'info', 'alert', 'help', 'x']],
    ['Interface', ['plus', 'more', 'chevright', 'chevleft', 'chevdown', 'arrowup', 'arrowright', 'menu', 'sliders', 'link', 'copy', 'refresh', 'play', 'pause', 'external', 'globe', 'eye', 'eyeoff', 'sun', 'moon', 'auto']],
    ['This book', ['book', 'image', 'palette', 'type', 'shapes', 'layout', 'motion', 'blocks', 'code', 'screen', 'flow']]];

  AL.page({
    id: 'iconography', group: 'system', order: 3, title: 'Iconography', icon: 'shapes', file: 'iconography',
    keywords: 'icons glyphs symbols stroke grid',
    lede: 'Seventy-odd icons drawn on a 24-unit grid with a 1.7 stroke, round ends and soft corners, to match Alegreya Sans. They borrow their metaphors from the room: an arch for the shelf, a lamp for the lock state.',
    meta: [['shapes', Object.keys(AL.ICONS).length + ' icons']],
    render: function () {
      var build = '<section class="al-sec" id="construction"><div class="al-sec-h"><p class="al-eyebrow">Construction</p><h2>24 grid, 20 live, 1.7 stroke</h2>' +
        '<p>Two units of padding on every side. Round caps and joins, 2-unit corners on rectangles, and fills only for small dots.</p></div><div class="icon-build al-stagger">' +
        ['arch', 'lamp', 'ask', 'bookmark'].map(function (n) {
          return '<figure style="margin:0"><div class="icon-big"><div class="grid24"></div><div class="live"></div>' + I(n) + '</div><figcaption class="al-caption"><b>' + n + '</b><span>24 × 24</span></figcaption></figure>';
        }).join('') + '</div></section>';

      var sets = '<section class="al-sec" id="set"><div class="al-sec-h"><p class="al-eyebrow">The set</p><h2>Every icon, by family</h2><p>Select an icon to copy the line that draws it.</p></div>' +
        GROUPS.map(function (g) {
          return '<h3 class="al-h3" style="margin:26px 0 12px">' + esc(g[0]) + '</h3><div class="icon-grid al-stagger">' + g[1].map(function (n) {
            return '<button type="button" class="icon-cell" data-icon="' + n + '" id="ic-' + n + '">' + I(n) + '<span>' + n + '</span><code>AL.icon(\'' + n + '\')</code></button>';
          }).join('') + '</div>';
        }).join('') + '<p class="al-small" id="ic-status" aria-live="polite" style="margin-top:12px"></p></section>';

      var sizes = '<section class="al-sec" id="sizes"><div class="al-sec-h"><p class="al-eyebrow">Sizes</p><h2>Three sizes cover the app</h2></div><div class="al-panel al-pad"><div class="sizes-row">' +
        [[16, 'Dense rows, chips'], [20, 'Default'], [24, 'Toolbars, empty states'], [32, 'Feature callouts']].map(function (s) {
          return '<figure><span style="display:inline-flex;gap:14px;color:var(--al-ink)">' + ['arch', 'ask', 'record', 'credits'].map(function (n) {
            return '<svg class="al-i" viewBox="0 0 24 24" style="width:' + s[0] + 'px;height:' + s[0] + 'px" aria-hidden="true"><use href="#i-' + n + '"/></svg>';
          }).join('') + '</span><span><b style="color:var(--al-ink)">' + s[0] + ' px</b> · ' + s[1] + '</span></figure>';
        }).join('') + '</div></div></section>';

      var context = '<section class="al-sec" id="in-use"><div class="al-sec-h"><p class="al-eyebrow">In use</p><h2>Icons always travel with words</h2></div><div class="show">' +
        '<div class="show-cell"><h4>Buttons and chips</h4><div class="show-row">' + U.btn('primary', 'Add a file', 'upload') + U.btn('secondary', 'Ask about this', 'ask') + U.btn('gentle', 'Stop and leave', 'stop') + '</div>' +
        '<div class="show-row"><span class="al-source-chip is-on">' + I('pdf') + 'Launch planning</span><span class="al-source-chip">' + I('wave') + 'Board prep call</span></div></div>' +
        '<div class="show-cell"><h4>Navigation</h4><div class="al-panel" style="padding:6px;display:flex;flex-direction:column;gap:2px">' +
        [['arch', 'Home', ''], ['meeting', 'Calls', '3'], ['mic', 'Record', ''], ['credits', 'Credits', '9,209']].map(function (r, k) {
          return '<div class="al-row" style="grid-template-columns:22px 1fr auto;padding:8px 10px;border-radius:10px;' + (k === 0 ? 'background:var(--al-accent-soft)' : '') + '">' + I(r[0]) + '<span class="n">' + r[1] + '</span><span class="d">' + r[2] + '</span></div>';
        }).join('') + '</div></div></div>' +
        '<ul class="spec-list" style="margin-top:18px"><li>An icon never stands alone without a label or a tooltip, except the close and more buttons.</li><li>Icons take the text colour they sit beside, or Ink 3 when they are secondary.</li>' +
        '<li>The lamp icon is for lock state and light only. Don’t use it to mean “idea” or “tip”.</li><li>Product and wallet logos are never redrawn; use the provider’s own mark or plain text.</li></ul></section>';
      return build + sets + sizes + context;
    },
    mount: function (view) {
      var status = view.querySelector('#ic-status');
      view.addEventListener('click', function (e) {
        var b = e.target.closest('.icon-cell');
        if (!b) return;
        var code = "AL.icon('" + b.getAttribute('data-icon') + "')";
        AL.each(view, '.icon-cell.is-copied', function (c) { c.classList.remove('is-copied'); });
        b.classList.add('is-copied');
        var done = function () { status.textContent = 'Copied ' + code; };
        try {
          navigator.clipboard.writeText(code).then(done, function () { status.textContent = 'Couldn’t copy here. The line is ' + code; });
        } catch (err) { status.textContent = 'Couldn’t copy here. The line is ' + code; }
      });
    }
  });
})();
