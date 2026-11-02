/* 02 Design system / Motion. */
(function () {
  var AL = window.AL, I = AL.icon, U = AL.ui, M = AL.marks, esc = AL.esc;

  function archProgress(p, w) {
    var len = 228;
    return '<svg class="al-arch-progress" viewBox="0 0 120 120" width="' + (w || 120) + '" height="' + (w || 120) + '" aria-hidden="true">' +
      '<path class="track" d="M22 112V58a38 38 0 0 1 76 0v54"/><path class="fill js-arch" d="M22 112V58a38 38 0 0 1 76 0v54" style="stroke-dasharray:' + len + ';stroke-dashoffset:' + (len * (1 - p)) + '"/>' +
      '<circle cx="60" cy="74" r="8" style="fill:var(--al-lamp)"/></svg>';
  }
  AL.archProgress = archProgress;

  var DEMOS = [
    ['rise', 'Arrive once', 'rise · 320 ms · ease-out', 'Rows rise 10 px into place, 40 ms apart, once, as a list first draws.',
      function () { return '<div class="al-stagger" style="width:78%;display:flex;flex-direction:column;gap:7px">' + ['Launch planning', 'Lunch with Sam', 'Design review', 'Board prep'].map(function (t) { return '<div class="al-card" style="padding:8px 12px;font-size:14px;font-weight:600">' + t + '</div>'; }).join('') + '</div>'; }],
    ['warm', 'The lamp warms', 'warm · 600 ms · ease-warm', 'Unlocking fades the lamp up from dark amber while its glow spreads. Nothing flashes.',
      function () { return '<div style="display:flex;flex-direction:column;align-items:center;gap:14px"><span style="width:64px">' + M.mark(64, { cls: 'demo-warm' }) + '</span><span class="al-state al-state--lit" data-beat style="--b:1.2">Lamp on</span></div>'; }],
    ['frost', 'Glass clears', 'warm · 600 ms', 'When the door opens, the page comes into focus from frosted glass, the way a room appears as a lamp warms.',
      function () { return '<p class="al-read" data-beat-frost style="--b:.3;width:80%;margin:0;font-size:16px">Priya: launch on the 18th, import comes in the next release, so design gets two more weeks for onboarding.</p>'; }],
    ['arch', 'Progress follows the arch', 'fill · 900 ms · ease-in-out', 'First-run progress fills along the arch, toward the lamp.',
      function () { return archProgress(0); }],
    ['sheet', 'An arch sheet opens', 'sheet · 280 ms · ease-out', 'Dialogs rise 22 px over a scrim that fades in 240 ms. Closing reverses, a little quicker.',
      function () { return '<div style="position:absolute;inset:0;background:var(--al-scrim);animation:al-fade 240ms ease-out both"></div><div style="position:relative;transform:scale(.62);animation:al-sheet 280ms var(--al-ease-out) 80ms both">' + U.sheet({ title: 'Stop and leave the call?', text: 'Recording ends now. The notes finish on the private server.', actions: '<span class="al-btn al-btn--gentle">Stop and leave</span>' }) + '</div>'; }],
    ['toast', 'A toast rises', 'rise · 320 ms', 'Confirmations rise from the corner on dusk and leave on their own after six seconds.',
      function () { return '<div style="position:absolute;right:14px;bottom:14px;width:300px;animation:al-toast 320ms var(--al-ease-out) both">' + U.toast('lamp', 'Saved just now', 'Hiring plan, revision 14', 'Undo') + '</div>'; }],
    ['stream', 'An answer streams', 'words · 55 ms each', 'Words arrive as the private model writes them; bookmarks drop in once quotes are checked.',
      function () { return '<div style="width:86%;font-size:15px;line-height:1.5"><p class="js-s" style="margin:0 0 8px"></p><div class="js-b" style="display:none;gap:6px"><span class="al-mark">S1</span><span class="al-mark">S2</span><span class="al-mark">S3</span></div></div>'; }],
    ['count', 'A figure settles', 'count · 900 ms · ease-out', 'Balances count to their new value once the charge settles, then stop. Nothing overshoots.',
      function () { return '<div style="text-align:center"><div style="font:800 48px/1 var(--al-font-ui);letter-spacing:-.03em;font-variant-numeric:tabular-nums" class="js-c">9,118</div><span class="al-small">credits available · 91 released</span></div>'; }],
    ['live', 'Recording breathes', 'breathe · 1.8 s loop', 'Live things breathe: a ring eases out from the red dot, and the wave moves while audio arrives.',
      function () { return '<div style="width:84%;display:flex;flex-direction:column;gap:12px;align-items:flex-start">' + U.state('rec', 'Recording') + U.wave({ n: 40, live: true }) + '</div>'; }]];

  AL.page({
    id: 'motion', group: 'system', order: 5, title: 'Motion', icon: 'motion', file: 'motion',
    keywords: 'animation easing duration transitions reduced motion',
    lede: 'Light changes; things don’t jump. Alcove moves like a room at dusk: what arrives rises a little and settles, the lamp warms, glass clears, and progress fills along the arch. Nothing bounces, and nothing waits on motion.',
    render: function () {
      var principles = '<section class="al-sec" id="principles"><div class="al-sec-h"><p class="al-eyebrow">Principles</p><h2>Four rules for movement</h2></div><div class="al-grid al-g4 al-stagger">' +
        [['Arrive once', 'Things rise into place the first time they draw. Lists that refresh stay still.'], ['Light, not objects', 'State changes are changes of light: warmth, focus and glow, not sliding panels.'],
          ['Never in the way', 'Every frame at rest is the finished state. Nothing is clickable only after an animation.'], ['Reduced means still', 'With reduced motion every transition is a cut, and loops stop.']].map(function (p) {
          return '<div class="al-panel al-pad"><h3 class="al-h3">' + p[0] + '</h3><p class="al-small" style="color:var(--al-ink-2)">' + p[1] + '</p></div>';
        }).join('') + '</div></section>';

      var demos = '<section class="al-sec" id="demos"><div class="al-sec-h"><p class="al-eyebrow">Live</p><h2>Nine moments, replayable</h2><p>Each card plays when the page draws. Replay it to see it again.</p></div><div class="mdemo">' +
        DEMOS.map(function (d) {
          return '<div class="mcard" data-demo="' + d[0] + '"><div class="mstage">' + d[4]() + '</div><div class="mbody"><div class="top"><b>' + esc(d[1]) + '</b><button class="al-btn al-btn--quiet al-btn--sm" type="button" id="replay-' + d[0] + '">' +
            I('refresh') + 'Replay</button></div><code>' + esc(d[2]) + '</code><p>' + esc(d[3]) + '</p></div></div>';
        }).join('') + '</div></section>';

      var tok = [['fast', '140 ms', 'Hover, press, colour'], ['soft', '200 ms', 'Switches, tabs, selection'], ['fade', '240 ms', 'Scrims, captions'], ['sheet', '280 ms', 'Sheets and dialogs'],
        ['rise', '320 ms', 'Arrivals, toasts'], ['warm', '600 ms', 'The lamp, frost clearing'], ['stagger', '40 ms', 'Between rows, up to 12'], ['beat', '320 ms', 'Between parts of a scripted picture']];
      function curve(path, label, code) {
        return '<div class="al-panel al-pad"><svg class="curve" viewBox="0 0 200 120" aria-hidden="true"><path d="M10 110H190M10 110V10" style="stroke:var(--al-line);fill:none"/><path class="c" d="' + path + '"/>' +
          (AL.reduce ? '<circle class="ball" r="5" cx="190" cy="10"/></svg>' : '<circle class="ball" r="5" cx="0" cy="0"><animateMotion dur="1.6s" repeatCount="indefinite" path="' + path + '" keyPoints="0;1;1" keyTimes="0;.7;1" calcMode="linear"/></circle></svg>') +
          '<b>' + label + '</b><p class="al-small"><code>' + code + '</code></p></div>';
      }
      var tokens = '<section class="al-sec" id="tokens"><div class="al-sec-h"><p class="al-eyebrow">Tokens</p><h2>Durations and curves</h2></div>' +
        '<div class="al-table-wrap"><table class="al-table"><thead><tr><th>Token</th><th>Value</th><th>Used for</th></tr></thead><tbody>' +
        tok.map(function (t) { return '<tr><td><code>--al-t-' + t[0] + '</code></td><td>' + t[1] + '</td><td>' + t[2] + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        '<div class="al-grid al-g3" style="margin-top:16px">' + curve('M10 110C46 26 46 10 190 10', 'Ease out', 'cubic-bezier(.2, .7, .2, 1)') +
        curve('M10 110C46 42 46 10 190 10', 'Ease warm', 'cubic-bezier(.2, .6, .2, 1)') + curve('M10 110C91 110 55 10 190 10', 'Ease in-out', 'cubic-bezier(.45, 0, .25, 1)') + '</div></section>';

      var reduced = '<section class="al-sec" id="reduced"><div class="al-sec-h"><p class="al-eyebrow">Reduced motion</p><h2>When someone asks for stillness</h2></div><ul class="spec-list">' +
        '<li>Arrivals, sheets and toasts appear at once.</li><li>The lamp switches on without warming; its glow is still drawn.</li><li>Answers appear whole instead of word by word.</li>' +
        '<li>Waves and breathing rings stop; the red recording dot stays.</li><li>Flows in this book start paused and cut between steps.</li><li>Progress still fills, because it carries meaning, but without easing.</li></ul></section>';
      return principles + demos + tokens + reduced;
    },
    mount: function (view) {
      function run(card) {
        var key = card.getAttribute('data-demo');
        var d = DEMOS.filter(function (x) { return x[0] === key; })[0];
        var stage = card.querySelector('.mstage');
        stage.innerHTML = d[4]();
        var s = AL.seq(stage);
        if (key === 'warm') { var mk = stage.querySelector('.al-mk-lamp'), gl = stage.querySelector('.al-mk-glow'); [mk, gl].forEach(function (e) { if (e) { e.style.transformBox = 'fill-box'; e.style.transformOrigin = 'center'; e.style.animation = 'al-warm 600ms var(--al-ease-warm) 300ms both'; } }); }
        if (key === 'arch') s.at(250, function () { var p = stage.querySelector('.js-arch'); if (p) p.style.strokeDashoffset = 228 * (1 - 0.66); });
        if (key === 'stream') s.type('.js-s', 'Launch moves to the 18th, and you’re telling the board on Thursday.', { delay: 200, done: function () { var b = stage.querySelector('.js-b'); b.style.display = 'flex'; b.className = 'js-b al-stagger'; } });
        if (key === 'count') s.at(300, function () { s.count('.js-c', 9118, 9209, 900); });
        card._stop = s.stop;
      }
      AL.each(view, '.mcard', function (card) {
        run(card);
        card.querySelector('button').addEventListener('click', function () { if (card._stop) card._stop(); run(card); });
      });
      AL.onLeave(function () { AL.each(view, '.mcard', function (c) { if (c._stop) c._stop(); }); });
    }
  });
})();
