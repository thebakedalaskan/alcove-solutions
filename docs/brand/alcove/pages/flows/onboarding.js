/* 04 Flows / First run: arriving, making a key, checking the server, the lamp coming on, first things and a tour. */
(function () {
  var AL = window.AL, I = AL.icon, U = AL.ui, M = AL.marks, esc = AL.esc;

  function welcome(extra) {
    var body = '<div class="ap-lock t-dark" style="display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);align-items:center;text-align:left;padding:0 0 0 64px;gap:0;height:100%">' +
      '<div style="display:flex;flex-direction:column;gap:16px;align-items:flex-start;position:relative;z-index:1"><span class="al-wm" style="font-size:86px;color:#F7F3EA;--b:.5" data-beat>alcove</span>' +
      '<p class="cover-tag" style="margin:0;animation:none">Lamp on. Door closed.</p><p style="margin:0">Private calls with notes that write themselves.</p>' +
      '<span class="al-btn al-btn--lamp al-btn--lg">' + I('key') + 'Make your key</span><span class="al-small">Your key is made on this device and never leaves it.</span></div>' +
      '<div style="align-self:end">' + AL.art.cover() + '</div></div>';
    return U.win({ raw: body, side: false, title: 'Welcome to Alcove', barRight: '', overlay: extra, label: 'Welcome' });
  }
  function spotAt(r, c) {
    return '<div class="ap-spot" style="left:' + r[0] + 'px;top:' + r[1] + 'px;width:' + r[2] + 'px;height:' + r[3] + 'px"></div>' +
      '<div class="ap-callout" style="left:' + c[0] + 'px;top:' + c[1] + 'px"><b>' + esc(c[2]) + '</b><p>' + esc(c[3]) + '</p><div class="row"><span>' + esc(c[4]) + '</span><span class="al-btn">' + esc(c[5] || 'Next') + '</span></div></div>';
  }
  function firstThings(p) {
    var steps = '<ul class="al-steps"><li class="is-done"><span class="dot">' + I('check') + '</span><span class="lbl">Make your key<small>Wrapped by your passkey</small></span></li>' +
      '<li class="is-done"><span class="dot">' + I('check') + '</span><span class="lbl">10,000 free credits<small>Added. No wallet needed yet</small></span></li>' +
      '<li class="is-now"><span class="dot"></span><span class="lbl">Start a private call<small>Encrypted, with notes built in</small></span></li>' +
      '<li><span class="dot"></span><span class="lbl">Record in the room<small>Private notes from a conversation around you</small></span></li></ul>';
    return U.sheet({ width: 440, mark: AL.archProgress(p, 92), title: 'Three first things', text: 'Your room is ready. These get it working; skip any of them.', body: steps,
      actions: '<span class="al-btn al-btn--primary al-btn--block">' + I('meeting') + 'Start a private call</span><span class="al-btn al-btn--quiet al-btn--block">Later</span>' });
  }
  var shelfWin = function (extra) { return U.win({ main: U.home(), path: 'home', title: 'Home', sideOpts: { active: 'home', credits: '10,000' }, extra: extra || '' }); };

  AL.flowPage({
    id: 'flow-onboarding', order: 1, title: 'First run', file: 'onboarding', icon: 'lamp', kicker: 'First run', time: 'About 50 seconds',
    keywords: 'onboarding welcome first run key touch id tour setup',
    lede: 'From a dark room to a lit one. A new owner makes a key with a passkey, watches Alcove check the private server, sees the lamp come on with 10,000 free credits, and is shown the two ways in: a private call, or notes in the room.',
    headline: 'The lamp comes on for the first time',
    summary: 'Nine steps, from the welcome scene to a tour of the room.',
    steps: [
      { title: 'Arrive', line: 'A room at dusk', dur: 6200, truth: ['One owner per vault', 'No account or password'],
        body: 'The welcome is the brand’s own scene: the niche draws itself, the lamp warms and light pools on the floor. One button, one promise underneath it.',
        screen: function () { return welcome(); } },
      { title: 'Make your key', line: 'A passkey, once', dur: 5200, truth: ['ownerAuthSeed and Kowner made on this device', 'Passkey with user presence'],
        body: 'The key is made in this browser and wrapped by a passkey. The browser asks for Touch ID, Face ID or a security key, and names Alcove as the site asking.',
        screen: function () { return welcome(U.touchId('make your key')); } },
      { title: 'Check the private server', line: 'Before anything is shared', dur: 5600, truth: ['Runtime evidence and fresh nonce', 'Key released only after every check'],
        body: 'Before the key goes anywhere, Alcove checks the server’s software, its key and the freshness of the proof. Each check ticks as it passes.',
        screen: function () { return U.win({ raw: U.lock({ state: 'checking' }), lamp: 'off', title: 'Alcove' }); },
        enter: function (el) {
          var s = AL.seq(el);
          s.at(1700, function () {
            var li = el.querySelector('.al-steps li.is-now');
            if (!li) return;
            li.classList.remove('is-now'); li.classList.add('is-done');
            li.querySelector('.dot').innerHTML = AL.icon('check');
          });
          return s.stop;
        } },
      { title: 'Lamp on', line: 'The room opens', dur: 4600, truth: ['session/open', 'Closes after 15 idle minutes or 60 in total'],
        body: 'The lamp warms over 600 ms, the title bar says how long it will stay on, and the door is open. This is the only moment the brand gets theatrical.',
        screen: function () { return U.win({ raw: U.lock({ state: 'open' }), lamp: 'warming', title: 'Alcove' }); } },
      { title: 'Three first things', line: 'Progress along the arch', dur: 6200, truth: ['10,000 free credits added once', 'Every step can be skipped'],
        body: 'A short checklist in an arch sheet. The key is made and 10,000 free credits are there, so the first real step is a private call. Progress fills along the arch toward the lamp.',
        screen: function () { return U.win({ main: U.home(), path: 'home', title: 'Home', sideOpts: { active: 'home', credits: '10,000' }, overlay: firstThings(0) }); },
        enter: function (el) { var s = AL.seq(el); s.at(500, function () { var p = el.querySelector('.js-arch'); if (p) p.style.strokeDashoffset = 228 * 0.5; }); return s.stop; } },
      { title: 'Start a call', line: 'Tour, one of three', dur: 5400, truth: ['Encrypted in every browser'],
        body: 'The tour lights one real place at a time. First: New call starts an encrypted video call with notes built in.',
        screen: function () { return shelfWin(spotAt([10, 82, 110, 34], [250, 70, 'Start a private call', 'Video and audio are encrypted in each browser. Notes write themselves beside the call.', '1 of 3'])); } },
      { title: 'Notes in the room', line: 'Tour, two of three', dur: 5400, truth: ['Only you can read them'],
        body: 'Record is for conversations that aren’t calls: a lunch, a workshop, a room. Notes appear in the background, for you only.',
        screen: function () { return shelfWin(spotAt([118, 82, 112, 34], [250, 120, 'Record in the room', 'Press record and Alcove takes private notes from your microphone while people talk.', '2 of 3'])); } },
      { title: 'Ask about a call', line: 'Tour, three of three', dur: 5400, truth: ['Quotes the exact moment'],
        body: 'Ask is a private chat over your calls and recordings. Every answer quotes who said it, and when.',
        screen: function () { return shelfWin(spotAt([10, 288, 216, 30], [250, 270, 'Ask about a call', 'Answers quote the exact moment, and only you can read the chat.', '3 of 3', 'Done'])); } },
      { title: 'Ready', line: 'Home, lit', dur: 5000, truth: ['10,000 free credits'],
        body: 'The tour ends at home. A toast confirms the free credits and says when the lamp will go out.',
        screen: function () { return U.win({ main: U.home(), path: 'home', title: 'Home', sideOpts: { active: 'home', credits: '10,000' }, toasts: U.toast('lamp', 'Your room is ready', '10,000 free credits · lamp closes after 15 quiet minutes', 'Got it', 1) }); } }
    ],
    notes: [['Your key', ['Made in your browser and wrapped by a passkey, which is needed to use it.', 'Never synced or exported, and shared only while unlocked, with a server that passed its check.', 'There is no password to reset and no account to recover.']],
      ['The server check', ['Alcove checks the software, the server’s key and the freshness of the proof before releasing your key.', 'If any check fails, nothing is sent and the screen says so.', 'The check runs again every time you unlock.']],
      ['Getting started', ['Every first step can be skipped; progress comes from what you have actually done.', 'Calls are free; notes and questions use credits, and the first 10,000 are free.', 'The tour points at real places and never invents data.']]]
  });
})();
