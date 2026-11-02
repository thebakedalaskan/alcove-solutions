/* App building blocks, part two: meetings, transcript, credits, lock screen, preferences, dialogs, browser and call. */
(function () {
  var AL = window.AL, U = AL.ui, I = AL.icon, M = AL.marks, esc = AL.esc;

  U.wave = function (o) {
    o = o || {};
    var n = o.n || 64, s = '', seed = 7;
    for (var i = 0; i < n; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      var h = 22 + Math.round(Math.abs(Math.sin(i * 0.31) * Math.cos(i * 0.13)) * 60 + (seed / 233280) * 18);
      if (o.gap && i >= o.gap[0] && i < o.gap[1]) s += '<i class="is-gap"></i>';
      else if (o.quiet && i > n - 14) s += '<i style="--h:6%;--k:' + i + '"></i>';
      else s += '<i style="--h:' + h + '%;--k:' + i + '"></i>';
    }
    if (o.live) s += '<i class="is-head"></i>';
    return '<div class="al-wave ' + (o.live ? 'is-live' : '') + '" aria-hidden="true">' + s + '</div>';
  };

  U.meetings = function (o) {
    o = o || {};
    var live = o.live || 'recording';
    var head = '<div class="ap-head"><h2>Meetings</h2><span class="sp"></span>' + U.btn('primary', 'Record a meeting', 'record', 'al-btn--sm') + '</div>';
    var card = '';
    if (live !== 'none') {
      var chip = { denied: U.state('unknown', 'Not let in'), joining: U.state('working', 'Joining the call'), waiting: U.state('waiting', 'Waiting for the host'), recording: U.state('rec', 'Recording'),
        quiet: U.state('waiting', 'We haven’t heard anyone yet'), processing: U.state('working', 'Writing it down'), ready: U.state('done', 'Notes ready') }[live];
      var time = { denied: '02:00', joining: '00:00', waiting: '01:12', recording: '18:42', quiet: '00:41', processing: '28:04', ready: '28:04' }[live];
      var limit = live === 'denied' ? 'waited, then left' : live === 'waiting' ? 'of 2:00 to be let in' : (live === 'processing' || live === 'ready' ? 'recorded' : 'of 30:00');
      var wave = live === 'denied' ? '<p class="al-small" style="margin:14px 0;color:var(--al-ink-2)">The host didn’t let Alcove in within 2 minutes, so it left the call. Nothing was recorded, and the 750 credits set aside are back.</p>' : live === 'waiting' || live === 'joining' ? '<div class="al-progress is-run" style="margin:18px 0"><i></i></div>' :
        U.wave({ live: live === 'recording' || live === 'quiet', gap: live === 'recording' || live === 'ready' || live === 'processing' ? [40, 43] : null, quiet: live === 'quiet' });
      var actions = live === 'denied' ? U.btn('secondary', 'Try again', 'refresh', 'al-btn--sm') : live === 'ready' ? U.btn('primary', 'Open the notes', 'wave', 'al-btn--sm') + U.btn('secondary', 'Ask about it', 'ask', 'al-btn--sm') :
        (live === 'processing' ? '<span class="al-small">You can close Alcove. The notes finish on the private server.</span>' : U.btn('gentle', 'Stop and leave', 'stop', 'al-btn--sm'));
      card = '<div class="ap-live" data-beat style="--b:0"><div>' + chip + '<h3>Investor call</h3><div class="al-small">Guest link · everyone sees “Alcove — recording”</div>' +
        '<div style="margin:16px 0 6px" class="time"><span class="js-time">' + time + '</span><small>' + esc(limit) + '</small></div>' + wave +
        '<div style="display:flex;gap:8px;align-items:center;margin-top:10px">' + actions + '</div></div>' +
        '<dl class="al-dl"><dt>Visible as</dt><dd>Alcove — recording</dd><dt>Limit</dt><dd>30 minutes</dd><dt>Credits</dt><dd>Up to 750 set aside</dd>' +
        '<dt>Audio</dt><dd>' + (live === 'recording' || live === 'processing' || live === 'ready' ? '4 seconds missing' : (live === 'quiet' ? 'Nothing heard yet' : 'Not started')) + '</dd>' +
        '<dt>Camera, mic</dt><dd>Off</dd></dl></div>';
    }
    var rows = [['wave', 'Board prep call', '31 Oct · 28 min', U.state('done', 'Notes ready', 'al-state--sm')],
      ['wave', 'Weekly sync', '28 Oct · 22 min', U.state('done', 'Notes ready', 'al-state--sm')],
      ['wave', 'Candidate interview', '24 Oct · 41 min', U.state('waiting', 'Partial · 3 gaps', 'al-state--sm')]];
    var list = '<div class="ap-list al-stagger">' + rows.map(function (r) {
      return '<div class="al-row">' + I(r[0]) + '<span class="n">' + esc(r[1]) + '<small>' + esc(r[2]) + '</small></span>' + r[3] + I('chevright') + '</div>';
    }).join('') + '</div>';
    if (o.empty) {
      return head + '<div class="al-card" style="flex:1;display:flex;align-items:center;justify-content:center"><div class="al-empty"><div style="width:190px">' +
        AL.art.spot('meetings') + '</div><h4>No meetings yet</h4><p>Paste a meeting link and Alcove joins as a visible guest, records, and writes private notes you can ask about.</p>' +
        U.btn('primary', 'Record a meeting', 'record') + '</div></div>';
    }
    return head + card + '<div class="ap-group" style="padding:0">Earlier</div>' + list;
  };

  U.transcript = function (o) {
    o = o || {};
    var lines = [['14:28', 'We should decide on the office before the board meets, not after.'],
      ['14:32', 'If we sign the new place for March, the exit window opens next March, so we pay two months’ rent to leave.'],
      ['14:51', 'That’s fine if the round closes. Can we get the lease summary into the memo?'],
      ['15:06', '(4 seconds missing)'],
      ['15:10', 'Let’s keep the hiring plan as it is and revisit after the round.']];
    var body = lines.map(function (l, i) {
      var gap = l[1].charAt(0) === '(';
      var text = esc(l[1]);
      if (o.hl && i === 1) text = text.replace('the exit window opens next March', '<mark class="al-hl is-glow">the exit window opens next March</mark><span class="al-mark">S2</span>');
      return '<p style="display:grid;grid-template-columns:52px 1fr;gap:12px"><span style="font:600 13px var(--al-font-ui);color:var(--al-ink-3);padding-top:3px">' + l[0] +
        '</span><span style="' + (gap ? 'color:var(--al-lamp-text);font-style:italic' : '') + '">' + text + '</span></p>';
    }).join('');
    return '<div class="ap-doc"><div class="ap-doc-bar">' + I('meeting') + '<span>Meetings</span>' + I('chevright') + '<b style="color:var(--al-ink)">' + esc(o.title || 'Board prep call') + '</b>' +
      U.state('done', 'Notes ready', 'al-state--sm') + '<span class="sp"></span>' + U.btn('quiet', 'Ask about this', 'ask', 'al-btn--sm') + U.btn('quiet', 'Edit text', 'edit', 'al-btn--sm') + '</div>' +
      '<div class="ap-page"><div class="ttl"><h3>' + esc(o.title || 'Board prep call') + '</h3><p>Notes · 31 Oct · 28 minutes · one 4-second gap</p></div><div class="ap-text">' + body + '</div></div></div>';
  };

  U.credits = function (o) {
    o = o || {};
    var st = o.state || 'normal';
    var bal = { normal: '9,209', empty: '0', pending: '0', added: '10,000', failed: '0' }[st];
    var meter = st === 'normal' ? '<div class="al-meter"><i class="avail" style="width:92%"></i><i class="held" style="width:7.5%"></i><i class="used" style="width:.5%"></i></div>' +
      '<div class="al-legend"><span><i style="background:var(--al-accent)"></i>Available 9,209</span><span><i style="background:var(--al-lamp)"></i>Set aside 750</span><span><i style="background:var(--al-ink-3)"></i>Used 41</span><span><i style="background:var(--al-sunken);box-shadow:inset 0 0 0 1px var(--al-line)"></i>On its way 0</span></div>' :
      '<div class="al-meter"><i class="avail" style="width:' + (st === 'added' ? '100' : '0') + '%"></i></div>';
    var banner = '';
    if (st === 'pending') banner = '<div class="al-banner al-banner--waiting" data-beat style="--b:1">' + I('hourglass') + '<div><b>Your payment is on its way.</b>Credits arrive once it settles, usually within a minute. You won’t be charged twice if you close Alcove.</div>' + U.state('waiting', 'On its way', 'al-state--sm') + '</div>';
    if (st === 'failed') banner = '<div class="al-banner al-banner--problem" data-beat style="--b:1">' + I('alert') + '<div><b>The payment didn’t go through, so nothing was added.</b>Any amount sent comes back to your wallet. You can try again.</div>' + U.btn('secondary', 'Try again', 'refresh', 'al-btn--sm') + '</div>';
    if (st === 'added') banner = '<div class="al-banner al-banner--done" data-beat style="--b:1">' + I('checkcircle') + '<div><b>10,000 credits added.</b>Your receipt is saved privately in the ledger below.</div>' + U.btn('secondary', 'View receipt', 'receipt', 'al-btn--sm') + '</div>';
    var rows = st === 'normal' ? [['10:44', 'Answer · leaving the lease early', '−41', U.state('done', 'Paid', 'al-state--sm')],
      ['10:24', 'Investor call', '750 set aside', U.state('rec', 'Recording', 'al-state--sm')],
      ['09:58', 'Credit pack · 10.00 USDC', '+10,000', U.state('done', 'Added', 'al-state--sm')]] :
      (st === 'added' ? [['10:02', 'Credit pack · 10.00 USDC', '+10,000', U.state('done', 'Added', 'al-state--sm')]] :
        (st === 'pending' ? [['10:01', 'Credit pack · 10.00 USDC', '+10,000', U.state('waiting', 'On its way', 'al-state--sm')]] :
          (st === 'failed' ? [['10:01', 'Credit pack · 10.00 USDC', 'Nothing added', U.state('problem', 'Didn’t go through', 'al-state--sm')]] : [])));
    var ledger = rows.length ? '<table class="ap-ledger"><tbody class="al-stagger">' + rows.map(function (r) {
      return '<tr><td class="t">' + r[0] + '</td><td>' + esc(r[1]) + '</td><td class="a">' + esc(r[2]) + '</td><td class="s">' + r[3] + '</td></tr>';
    }).join('') + '</tbody></table>' : '<div class="al-empty" style="padding:8px"><div style="width:150px">' + AL.art.spot('credits') + '</div><p>No credits yet. A pack covers at least 75 questions or 13 half-hour meetings, usually more.</p></div>';
    return '<div class="ap-head"><h2>Credits</h2><span class="sp"></span>' + U.btn('primary', 'Buy credits', 'plus', 'al-btn--sm') + '</div>' + banner +
      '<div class="ap-balance"><div class="al-card" style="padding:20px;display:flex;flex-direction:column;gap:14px"><span class="al-small">Credits left</span><div class="big"><span class="js-bal">' + bal + '</span><small>credits</small></div>' + meter +
      '<p class="al-small">Credits pay for answers and meeting notes. They aren’t money and can’t be sent anywhere.</p></div>' +
      '<div class="ap-pack"><span>Credit pack</span><b>10,000 credits</b><span>for 10.00 USDC, paid privately from your wallet</span>' +
      '<span class="al-btn al-btn--lamp al-btn--sm" style="align-self:flex-start;margin-top:auto">' + I('wallet') + 'Buy this pack</span></div></div>' +
      '<div class="al-card" style="padding:10px 16px"><div class="ap-group" style="padding:6px 0">Ledger</div>' + ledger + '</div>';
  };

  U.lock = function (o) {
    o = o || {};
    var st = o.state || 'closed';
    var art = '<div style="width:230px" data-beat-fade>' + AL.art.spot(st === 'open' ? 'ready' : (st === 'checking' ? 'check' : 'closed')) + '</div>';
    var title = { closed: 'Alcove is closed', checking: 'Checking the private server', open: 'Lamp on', failed: 'We couldn’t verify the private server' }[st];
    var text = { closed: 'Unlock with your passkey to pick up where you left off. Your key never leaves this device.',
      checking: 'Before your key goes anywhere, Alcove checks that the server is the one we trust.',
      open: 'Welcome back. Everything is where you left it.',
      failed: 'So nothing was sent. Your files are untouched. Try again in a moment.' }[st];
    var action = st === 'closed' ? '<span class="al-btn al-btn--lamp al-btn--lg" data-beat style="--b:2">' + I('fingerprint') + 'Unlock with your passkey</span>' :
      (st === 'checking' ? '<div style="width:260px;--b:2" data-beat><div class="al-progress is-run is-lamp"><i></i></div></div>' :
        (st === 'failed' ? '<span class="al-btn al-btn--secondary" data-beat style="--b:2">' + I('refresh') + 'Try again</span>' : ''));
    var checks = st === 'checking' ? '<ul class="al-steps" style="width:340px;text-align:left;--b:3" data-beat>' +
      '<li class="is-done"><span class="dot">' + I('check') + '</span><span class="lbl">The server’s software is the approved build</span></li>' +
      '<li class="is-done"><span class="dot">' + I('check') + '</span><span class="lbl">Its key belongs to that build</span></li>' +
      '<li class="is-now"><span class="dot"></span><span class="lbl">The proof is fresh</span></li></ul>' : '';
    return '<div class="ap-lock t-dark" style="height:100%">' + art + '<h2 data-beat style="--b:1">' + esc(title) + '</h2><p data-beat style="--b:1">' + esc(text) + '</p>' + action + checks +
      '<span class="al-small" style="position:absolute;bottom:18px">Your key is wrapped by your passkey and never sent unlocked.</span></div>';
  };

  U.prefs = function () {
    function row(icon, t, d, right) {
      return '<div class="al-row" style="grid-template-columns:22px minmax(0,1fr) auto">' + I(icon) + '<span class="n">' + esc(t) + '<small>' + esc(d) + '</small></span>' + right + '</div>';
    }
    return '<div class="ap-head"><h2>Preferences</h2></div><div class="al-stagger" style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
      '<div class="al-card" style="padding:6px"><div class="ap-group" style="padding:10px 12px 4px">The lamp</div>' +
      row('clock', 'Closes on its own', 'After 15 idle minutes, or 60 minutes in total', '<span class="al-tag">Fixed</span>') +
      row('lock', 'Close when the tab closes', 'Always on, so a closed tab is never open', '<span class="al-switch is-on"><i></i></span>') +
      row('fingerprint', 'Unlock with', 'Your passkey: your passkey, Face ID, Windows Hello or a security key', '<span class="al-tag">Passkey</span>') + '</div>' +
      '<div class="al-card" style="padding:6px"><div class="ap-group" style="padding:10px 12px 4px">Private server</div>' +
      row('shield', 'Verified', 'Approved build, key bound, checked 10:02', U.state('done', 'Verified', 'al-state--sm')) +
      row('server', 'Where your files are read', 'This device and verified private servers only', '<span class="al-tag">Details</span>') + '</div>' +
      '<div class="al-card" style="padding:6px"><div class="ap-group" style="padding:10px 12px 4px">Meetings</div>' +
      row('user', 'Name in the call', 'Alcove — recording', '<span class="al-tag">Fixed</span>') +
      row('clock', 'Longest recording', '30 minutes, then it leaves', '<span class="al-tag">Fixed</span>') + '</div>' +
      '<div class="al-card" style="padding:6px"><div class="ap-group" style="padding:10px 12px 4px">Storage and appearance</div>' +
      '<div style="padding:8px 12px 12px;display:flex;flex-direction:column;gap:8px"><div class="al-progress" style="--p:21%"><i></i></div><span class="al-small">212 MB of 1 GiB · 37 of 500 items</span></div>' +
      row('auto', 'Appearance', 'Follows your system', '<span class="al-seg"><span class="is-on">Auto</span><span>Light</span><span>Dark</span></span>') + '</div></div>';
  };

  U.sheet = function (o) {
    return '<div class="al-sheet" style="' + (o.width ? 'width:' + o.width + 'px' : '') + '"><div class="al-sheet-mark">' + (o.mark || M.mark(46)) + '</div><h4>' + esc(o.title) + '</h4>' +
      (o.text ? '<p>' + esc(o.text) + '</p>' : '') + '<div class="al-sheet-body">' + (o.body || '') + '</div><div class="al-sheet-actions">' + (o.actions || '') + '</div></div>';
  };
  U.touchId = function (reason) {
    return '<div class="ap-sys"><div class="fp">' + I('fingerprint') + '</div><b>Alcove wants to ' + esc(reason || 'unlock your vault') + '.</b><p>Use your passkey to continue.</p>' +
      '<div class="btns"><span>Cancel</span><span>Use password…</span></div></div>';
  };
  U.toast = function (icon, title, text, action, beat) {
    return '<div class="al-toast" style="--b:' + (beat || 0) + '"><span class="al-lamp is-on" style="' + (icon === 'lamp' ? '' : 'display:none') + '"></span>' +
      (icon !== 'lamp' ? I(icon) : '') + '<div><b>' + esc(title) + '</b><span>' + esc(text) + '</span></div>' + (action ? '<span class="al-btn">' + esc(action) + '</span>' : '<span></span>') + '</div>';
  };
  U.spot = function (x, y, w, h, title, text, step) {
    return '<div class="ap-spot" style="left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px"></div>' +
      '<div class="ap-callout" style="left:' + Math.min(780, x + w + 18) + 'px;top:' + Math.max(56, y) + 'px"><b>' + esc(title) + '</b><p>' + esc(text) + '</p>' +
      '<div class="row"><span>' + esc(step) + '</span><span class="al-btn">Next</span></div></div>';
  };

  U.browser = function (o) {
    return '<div class="ap ap--browser" role="img" aria-label="' + esc(o.label || 'Browser window') + '"><div class="ap-bar"><span class="ap-lights"><i></i><i></i><i></i></span>' +
      '<span class="ap-url">' + I('lock') + esc(o.url) + '</span><span style="width:60px"></span></div><div style="position:relative;overflow:hidden">' + o.body + (o.extra || '') + '</div></div>';
  };
  U.signPage = function (o) {
    o = o || {};
    return '<div style="height:100%;display:flex;align-items:center;justify-content:center;background:var(--al-bg)">' +
      U.sheet({ width: 470, title: 'Buy 10,000 credits', text: 'Check the exact terms, then sign in your wallet. Signing doesn’t give Alcove any spending power.',
        body: '<dl class="al-dl"><dt>You pay</dt><dd>10.00 USDC</dd><dt>Route fee</dt><dd>0.02 USDC</dd><dt>You get</dt><dd>10,000 credits</dd><dt>Paid to</dt><dd>Alcove, privately</dd>' +
          '<dt>If it fails</dt><dd>Refunded to your wallet</dd><dt>Quote expires</dt><dd><span class="js-exp">' + esc(o.exp || '4:12') + '</span></dd></dl>',
        actions: o.signed ? '<span class="al-btn al-btn--primary al-btn--block">' + I('check') + 'Signed. You can close this page.</span>' :
          '<span class="al-btn al-btn--primary al-btn--block">' + I('wallet') + 'Sign in your wallet</span><span class="al-small">Opened by Alcove for this purchase only. It closes when you’re done.</span>' }) + '</div>';
  };
  U.walletPopup = function () {
    return '<div class="ap-wallet"><div class="ap-wallet-h">' + I('wallet') + 'Wallet · sign message</div><div class="ap-wallet-b">' +
      '<span class="al-small">Requested by Alcove</span><pre>{"signer":"you.near","standard":"nep413",\n "intent":"transfer 10.00 USDC",\n "to":"alcove · private route",\n "deadline":"10:05:41"}</pre>' +
      '<span class="al-small">This signs one purchase. It does not grant ongoing access.</span>' +
      '<div style="display:flex;gap:8px"><span class="al-btn al-btn--secondary al-btn--sm" style="flex:1">Cancel</span><span class="al-btn al-btn--primary al-btn--sm" style="flex:1">Sign</span></div></div></div>';
  };

  U.call = function (o) {
    o = o || {};
    var tiles = [['Maya Chen', '#7A6BB0'], ['Dan Ortiz', '#3F7D66'], ['You', '#5C6675']];
    var t = tiles.map(function (p) {
      return '<div class="tile"><div class="av" style="background:' + p[1] + '">' + p[0].charAt(0) + '</div><span class="nm">' + esc(p[0]) + '</span></div>';
    }).join('');
    if (o.joined) t += '<div class="tile is-new"><div class="av" style="background:#4C5A73">A</div><span class="nm">Alcove — recording</span></div>';
    else t += '<div class="tile" style="background:#24272B"></div>';
    var ask = o.asking ? '<div class="ap-wallet" style="top:auto;bottom:16px;right:16px;width:330px"><div class="ap-wallet-h">' + I('users') + 'Someone wants to join</div>' +
      '<div class="ap-wallet-b"><b style="font-size:15px">Alcove — recording</b><span class="al-small">Joining as a guest. Camera and microphone are off.</span>' +
      '<div style="display:flex;gap:8px"><span class="al-btn al-btn--secondary al-btn--sm" style="flex:1">Deny</span><span class="al-btn al-btn--primary al-btn--sm" style="flex:1">Admit</span></div></div></div>' : '';
    return '<div class="ap" style="background:#1E2024;border-color:#2B2E33" role="img" aria-label="The host’s view of the video call"><div class="ap-bar" style="background:#17191C;border-color:#2B2E33">' +
      '<span class="ap-lights"><i></i><i></i><i></i></span><span class="ap-title" style="color:#C9CDD3">Video call · the host’s view</span><span style="width:60px"></span></div>' +
      '<div style="position:relative;min-height:0"><div class="ap-call">' + t + '</div>' + ask + '</div></div>';
  };
})();
