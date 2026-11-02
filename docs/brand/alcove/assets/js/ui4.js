/* Version 3: private calls with built-in notes, notes in the room, and notes from shared screens. */
(function () {
  var AL = window.AL, U = AL.ui, I = AL.icon, M = AL.marks, esc = AL.esc;

  U.PEOPLE = [['Maya Chen', 'MC', '#5B4F9A', '#7A6BB0'], ['Dan Ortiz', 'DO', '#2F6B57', '#3F7D66'], ['Priya Nair', 'PN', '#8A4B2A', '#B06A3C'], ['You', 'BK', '#2D4A72', '#4C6A94']];

  // ---------- sidebar ----------
  U.NOTES = [['n1', 'Launch planning', 'Today · 32 min'], ['n2', 'Design review', 'Yesterday · 45 min'], ['n3', 'Lunch with Sam', 'Room · 18 min'], ['n4', 'Board prep', '31 Oct · 28 min']];
  U.side = function (o) {
    o = o || {};
    var active = o.active || 'home', lamp = o.lamp || 'on';
    var nav = [['home', 'arch', 'Home', ''], ['calls', 'meeting', 'Calls', o.live ? 'live' : ''], ['record', 'mic', 'Record', o.rec ? 'rec' : ''], ['notes', 'page', 'Notes', '24'], ['chat', 'ask', 'Ask', ''], ['credits', 'credits', 'Credits', o.credits || '9,209']];
    var n = nav.map(function (r) {
      var ct = r[3] === 'live' ? '<span class="ct rec">Live</span>' : r[3] === 'rec' ? '<span class="ct rec">Rec</span>' : (r[3] ? '<span class="ct">' + esc(r[3]) + '</span>' : '');
      return '<div class="' + (r[0] === active ? 'is-on' : '') + '">' + I(r[1]) + esc(r[2]) + ct + '</div>';
    }).join('');
    var notes = U.NOTES.map(function (x) { return '<div class="' + (x[0] === o.open ? 'is-on' : '') + '">' + I(x[2].indexOf('Room') === 0 ? 'mic' : 'wave') + '<span>' + esc(x[1]) + '</span></div>'; }).join('');
    var lampEl = lamp === 'off' ? '<span class="al-lamp"></span>' : (lamp === 'rec' ? '<span class="al-lamp is-rec"></span>' : '<span class="al-lamp is-on"></span>');
    return '<div class="ap-side"><div class="ap-brand">' + M.mark(20, { lit: lamp !== 'off', glow: false }) + '<span class="al-wm">alcove</span>' + lampEl + '</div>' +
      '<div class="ap-sidebtns"><span class="al-btn al-btn--primary al-btn--sm">' + I('meeting') + 'New call</span><span class="al-btn al-btn--secondary al-btn--sm">' + I('mic') + 'Record</span></div>' +
      '<div class="ap-search">' + I('search') + 'Search notes<span class="al-kbd">⌘K</span></div>' +
      '<div class="ap-nav">' + n + '</div><div class="ap-group">Recent notes</div><div class="ap-recent">' + notes + '</div>' +
      '<div class="ap-side-foot"><span>Calls are end-to-end encrypted</span><div style="display:flex;align-items:center;gap:8px;color:var(--al-ink-2);font-size:13.5px">' + I('sliders') + 'Preferences</div></div></div>';
  };

  // ---------- call pieces ----------
  U.e2ee = function () { return '<span class="ap-e2ee">' + I('lock') + 'End-to-end encrypted</span>'; };
  U.notesChip = function (st) {
    if (st === 'off') return '<span class="ap-noteschip is-off">' + I('page') + 'Notes off</span>';
    if (st === 'paused') return '<span class="ap-noteschip is-paused">' + I('pause') + 'Notes paused</span>';
    return '<span class="ap-noteschip"><span class="al-lamp is-rec"></span>Notes on</span>';
  };
  U.tile = function (p, o) {
    o = o || {};
    return '<div class="ap-tile ' + (o.speaking ? 'is-speaking ' : '') + (o.cls || '') + '" style="--t1:' + p[2] + ';--t2:' + p[3] + '">' +
      (o.camOff ? '<span class="av">' + p[1] + '</span>' : '<span class="ap-cam"><i></i></span>') +
      '<span class="nm">' + (o.muted ? I('micoff') : '') + esc(p[0]) + (o.guest ? ' <small>guest</small>' : '') + '</span>' + (o.speaking ? '<span class="sp-bars"><i></i><i></i><i></i></span>' : '') + '</div>';
  };
  U.controls = function (o) {
    o = o || {};
    function b(icon, label, cls) { return '<span class="ap-cbtn ' + (cls || '') + '">' + I(icon) + '<small>' + label + '</small></span>'; }
    return '<div class="ap-controls">' + b(o.muted ? 'micoff' : 'mic', o.muted ? 'Unmute' : 'Mute', o.muted ? 'is-off' : '') + b('meeting', 'Camera') + b('screen', o.sharing ? 'Stop sharing' : 'Share', o.sharing ? 'is-on' : '') +
      b('page', o.notes === 'off' ? 'Notes off' : 'Notes', o.notes === 'off' ? '' : 'is-lamp') + b('users', 'People') + b('more', 'More') +
      '<span class="ap-leave">' + I('x') + 'Leave</span></div>';
  };
  U.LIVE = [['Maya Chen', '12:04', 'If we move launch to the 18th, design has two more weeks for onboarding.'],
    ['Dan Ortiz', '12:21', 'Engineering can hit the 18th if we cut the import feature from the first release.'],
    ['Priya Nair', '12:40', 'Then let’s decide: launch on the 18th, import comes in the next release.'],
    ['You', '12:58', 'Agreed. I’ll tell the board on Thursday.']];
  U.liveNotes = function (o) {
    o = o || {};
    var lines = U.LIVE.slice(0, o.lines || 4).map(function (l, k) {
      return '<div class="ap-tline" data-beat style="--b:' + (k * 0.6) + '"><b>' + esc(l[0]) + '<small>' + l[1] + '</small></b><span>' + esc(l[2]) + '</span></div>';
    }).join('');
    var tabs = '<div class="al-tabs" style="padding:0 16px"><span class="' + (o.tab === 'transcript' ? '' : 'is-on') + '">Notes</span><span class="' + (o.tab === 'transcript' ? 'is-on' : '') + '">Transcript</span><span>Chat</span></div>';
    var body = o.tab === 'transcript' ? '<div class="ap-tlines">' + lines + '</div>' :
      '<div class="ap-livenotes"><p class="ap-ln-h">Decisions</p><div class="nb-todo is-done" data-beat style="--b:.5"><span class="cb">' + I('check') + '</span><span>Launch moves to the 18th</span></div>' +
      '<div class="nb-todo is-done" data-beat style="--b:1"><span class="cb">' + I('check') + '</span><span>Import ships in the next release</span></div>' +
      '<p class="ap-ln-h">Action items</p><div class="nb-todo" data-beat style="--b:1.5"><span class="cb"></span><span>You: tell the board on Thursday</span></div>' +
      '<div class="nb-todo" data-beat style="--b:2"><span class="cb"></span><span>Maya: onboarding designs by the 8th</span></div>' +
      (o.slides ? '<p class="ap-ln-h">From the shared screen</p><div class="ap-slide" data-beat style="--b:2.5"><span class="ap-slthumb"><i></i><i></i><i></i></span><span><b>Launch timeline</b><small>Slide at 14:02 · 3 dates read</small></span></div>' : '') +
      '<p class="ap-ln-h">Now</p><p class="ap-ln-now js-now" data-beat style="--b:2.5">Priya is summarising the plan…</p></div>';
    return '<div class="ap-aside-h">' + I('page') + '<b>Live notes</b><span class="sp"></span>' + U.notesChip(o.notes) + '</div>' + tabs + body +
      '<div class="ap-livefoot">' + I('shield') + 'Written inside a verified private server. Only people in this call get them.</div>';
  };
  U.call = function (o) {
    o = o || {};
    var top = '<div class="ap-calltop"><b>' + esc(o.title || 'Launch planning') + '</b>' + U.e2ee() + U.notesChip(o.notes) + '<span class="sp"></span><span class="ap-ctime js-time">' + (o.time || '14:21') + '</span></div>';
    var grid;
    if (o.sharing) {
      grid = '<div class="ap-share"><div class="ap-sharestage"><div class="ap-slidebig"><small>Shared by Maya Chen</small><b>Launch timeline</b><div class="tl"><i style="--w:30%"></i><i style="--w:55%"></i><i style="--w:80%"></i></div>' +
        '<ul><li>Beta closes 4 Nov</li><li>Onboarding final 8 Nov</li><li>Public launch 18 Nov</li></ul>' + (o.reading ? '<span class="ap-readbox"></span>' : '') + '</div></div>' +
        '<div class="ap-strip">' + U.PEOPLE.map(function (p, k) { return U.tile(p, { camOff: k === 2, speaking: k === 0, cls: 'is-small' }); }).join('') + '</div></div>';
    } else {
      var ppl = (o.people || U.PEOPLE).map(function (p, k) { return U.tile(p, { speaking: k === (o.speaker == null ? 0 : o.speaker), camOff: k === 2, muted: k === 1, guest: o.guest && k === 2 }); }).join('');
      grid = '<div class="ap-grid4' + (o.joined ? ' al-stagger' : '') + '">' + ppl + '</div>';
    }
    return '<div class="ap-callroom">' + top + grid + U.controls({ sharing: o.sharing, notes: o.notes }) + '</div>';
  };
  U.callWin = function (o) {
    o = o || {};
    return U.win({ main: U.call(o), aside: o.panel === false ? null : U.liveNotes({ notes: o.notes, slides: o.sharing || o.slides, tab: o.tab, lines: o.lines }), path: 'call/launch-planning', title: 'Launch planning',
      lamp: 'rec', barRight: '<span class="al-lampline"><span class="al-lamp is-rec"></span>In a call · ' + (o.notes === 'off' ? 'notes off' : 'notes on') + '</span>', sideOpts: { active: 'calls', live: true }, overlay: o.overlay, toasts: o.toasts, extra: o.extra, cls: 'ap--dark' });
  };

  // ---------- lobby ----------
  U.lobby = function (o) {
    o = o || {};
    var guest = !!o.guest;
    return '<div class="ap-lobby"><div class="ap-preview">' + U.tile(guest ? ['Priya Nair', 'PN', '#8A4B2A', '#B06A3C'] : U.PEOPLE[3], {}) +
      '<div class="ap-devices"><span>' + I('mic') + 'MacBook microphone</span><span>' + I('meeting') + 'FaceTime camera</span></div></div>' +
      '<div class="ap-join"><span class="al-eyebrow">' + (guest ? 'Invited by Ben' : 'Ready to join') + '</span><h3>Launch planning</h3><p>' + (guest ? 'You’re joining as a guest. No account needed.' : 'Three people are already here.') + '</p>' +
      (guest ? '<div class="al-field"><label>Your name</label><div class="al-input is-focus" style="display:flex;align-items:center"><span class="js-name">Priya Nair</span></div></div>' : '') +
      '<div class="ap-terms">' + '<div>' + I('lock') + '<span><b>End-to-end encrypted.</b> The key is in your link and never reaches our servers.</span></div>' +
      '<div>' + I('page') + '<span><b>Notes are on.</b> A private notes service, checked before it gets the key, transcribes this call for the people in it.</span></div>' +
      '<div>' + I('eyeoff') + '<span><b>Nobody else.</b> Not us, not the relay, not a cloud provider.</span></div></div>' +
      '<span class="al-btn al-btn--primary al-btn--lg al-btn--block">' + (guest ? 'Join as a guest' : 'Join now') + '</span>' +
      (guest ? '<span class="al-small" style="text-align:center">By joining you agree to notes being taken. Leave at any time.</span>' : '') + '</div></div>';
  };
  U.inviteSheet = function () {
    return U.sheet({ width: 460, mark: M.mark(46), title: 'Invite people', text: 'Anyone with this link can join. The part after # is the call’s key: it stays in browsers and never reaches our servers.',
      body: '<div class="ap-link"><span>alcove/c/launch-planning<b>#k=Qm2xV9a…</b></span><span class="al-btn al-btn--secondary al-btn--sm">' + I('copy') + 'Copy</span></div>' +
        '<dl class="al-dl" style="margin-top:12px"><dt>Notes</dt><dd>On, for everyone in the call</dd><dt>Guests</dt><dd>No account needed</dd><dt>Link expires</dt><dd>When the call ends</dd></dl>',
      actions: '<span class="al-btn al-btn--primary al-btn--block">' + I('meeting') + 'Start the call</span>' });
  };

  // ---------- solo recording ----------
  U.solo = function (o) {
    o = o || {};
    var st = o.state || 'recording';
    var lines = [['0:12', 'Okay, so the plan for the offsite is two days in Lisbon.'], ['0:31', 'Budget is twelve thousand, flights included.'], ['0:58', 'Sam will check dates with the venue by Friday.'], ['1:24', 'We should keep the second afternoon free.']];
    var big = st === 'idle' ? '<span class="ap-recbtn">' + I('mic') + '</span>' : '<span class="ap-recbtn is-rec"><i></i></span>';
    var label = { idle: 'Record what’s said in the room', recording: 'Recording in the room', paused: 'Paused', processing: 'Writing it up' }[st];
    var tl = st === 'idle' ? '<div class="al-empty" style="padding:10px"><p>Your notes appear here as people talk. Only you can read them.</p></div>' :
      '<div class="ap-tlines">' + lines.slice(0, o.lines || 4).map(function (l, k) { return '<div class="ap-tline" data-beat style="--b:' + (k * 0.6) + '"><b>' + l[0] + '</b><span>' + esc(l[1]) + '</span></div>'; }).join('') + '</div>';
    return '<div class="ap-solo"><div class="ap-solol"><span class="al-eyebrow">' + (st === 'idle' ? 'Only you' : 'Only you · this device') + '</span><h3>' + esc(o.title || 'Offsite planning') + '</h3>' + big +
      '<div class="ap-soloTime"><span class="js-time">' + (st === 'idle' ? '0:00' : (o.time || '1:31')) + '</span><small>' + label + '</small></div>' +
      (st === 'idle' ? '' : U.wave({ n: 46, live: st === 'recording', quiet: st === 'paused' })) +
      '<div class="ap-solob">' + (st === 'idle' ? '<span class="al-btn al-btn--primary al-btn--lg">' + I('record') + 'Start recording</span>' :
        (st === 'processing' ? '<span class="al-state al-state--working">Writing your notes</span>' : '<span class="al-btn al-btn--secondary">' + I(st === 'paused' ? 'play' : 'pause') + (st === 'paused' ? 'Resume' : 'Pause') + '</span><span class="al-btn al-btn--gentle">' + I('stop') + 'Stop</span>')) + '</div>' +
      '<p class="al-small">' + I('lock') + ' Audio is encrypted on this device in 5-second pieces and transcribed in a verified private server.</p></div>' +
      '<div class="ap-solor"><div class="ap-aside-h">' + I('page') + '<b>Live transcript</b></div>' + tl + '</div></div>';
  };

  // ---------- notes page ----------
  U.notesPage = function (o) {
    o = o || {};
    var tl = U.LIVE.map(function (l) { return '<div class="ap-tline"><b>' + esc(l[0]) + '<small>' + l[1] + '</small></b><span>' + (o.hl && l[1] === '12:40' ? '<mark class="al-hl is-glow">' + esc(l[2]) + '</mark><span class="al-mark">S1</span>' : esc(l[2])) + '</span></div>'; }).join('');
    return '<div class="ap-notion"><div class="ap-ntop">' + I('page') + '<span>Notes</span>' + I('chevright') + '<b>Launch planning</b>' + U.state('done', 'Notes ready', 'al-state--sm') +
      '<span class="sp"></span><span class="ap-priv">' + I('lock') + 'Only the 4 people in the call</span>' + U.btn('quiet', 'Ask about it', 'ask', 'al-btn--sm') + '</div>' +
      '<div class="ap-ncover"></div><div class="ap-npage"><div class="ap-nicon">' + I('wave') + '</div><h1 class="ap-ntitle">Launch planning</h1>' +
      '<div class="ap-nprops"><span>' + I('calendar') + 'Today, 14:00 · 32 min</span><span>' + I('users') + 'Maya, Dan, Priya, you</span><span>' + I('screen') + '1 shared screen</span></div>' +
      '<div class="ap-nbody"><div class="nb nb-callout">' + I('lamp') + '<span>Launch moves to 18 November. Import ships in the next release so design has two more weeks for onboarding.</span></div>' +
      '<div class="nb nb-h">Action items</div><div class="nb nb-todo"><span class="cb"></span><span>You: tell the board on Thursday</span></div><div class="nb nb-todo"><span class="cb"></span><span>Maya: onboarding designs by 8 Nov</span></div>' +
      '<div class="nb nb-h">From the shared screen</div><div class="nb ap-slide"><span class="ap-slthumb"><i></i><i></i><i></i></span><span><b>Launch timeline</b><small>14:02 · Beta closes 4 Nov, onboarding final 8 Nov, launch 18 Nov</small></span></div>' +
      '<div class="nb nb-h">Transcript</div><div class="ap-tlines">' + tl + '</div></div></div></div>';
  };

  // ---------- ask about a call ----------
  U.CALL_Q = 'What did we decide about the launch date, and who’s telling the board?';
  U.CALL_A_HTML = '<p>Launch moves to 18 November <span class="al-mark">S1</span>, because cutting import from the first release gives design two more weeks <span class="al-mark">S2</span>.</p><p>You said you’d tell the board on Thursday <span class="al-mark">S3</span>.</p>';
  U.CALL_A_TEXT = 'Launch moves to 18 November, because cutting import from the first release gives design two more weeks. You said you’d tell the board on Thursday.';
  U.callCites = function () {
    return '<div class="al-stagger" style="display:flex;flex-direction:column;gap:7px;margin-top:4px">' +
      '<div class="al-cite"><span class="al-mark">S1</span><b>Launch planning <span>· 12:40 · Priya</span></b><q>launch on the 18th, import comes in the next release</q></div>' +
      '<div class="al-cite"><span class="al-mark">S2</span><b>Launch planning <span>· 12:04 · Maya</span></b><q>design has two more weeks for onboarding</q></div>' +
      '<div class="al-cite"><span class="al-mark">S3</span><b>Launch planning <span>· 12:58 · You</span></b><q>I’ll tell the board on Thursday</q></div></div>';
  };
  U.askCall = function (o) {
    o = o || {};
    var st = o.stage || 'answer';
    var av = '<span class="al-reply-av">' + M.mark(16, { fg: '#A9C4EC', glow: false }) + '</span>';
    var head = '<div class="ap-chathead"><b>' + (st === 'empty' ? 'Ask about your calls' : 'Launch date decision') + '</b>' + U.state('lit', 'Private', 'al-state--sm') + '<span class="sp"></span>' +
      '<span class="al-source-chip is-on">' + I('wave') + 'Launch planning</span></div>';
    var t;
    if (st === 'empty') {
      t = '<div class="ap-hello">' + M.mark(56) + '<h3>What do you want to remember?</h3><p>Ask about any call or recording. Answers quote the exact moment, and only you can read this chat.</p>' +
        '<div class="ap-suggest">' + [['wave', 'What did we decide today?'], ['check', 'List my action items this week'], ['users', 'What did Maya say about onboarding?'], ['screen', 'What was on the timeline slide?']].map(function (s, k) {
          return '<span data-beat style="--b:' + (1 + k * 0.3) + '">' + I(s[0]) + esc(s[1]) + '</span>'; }).join('') + '</div></div>';
    } else {
      t = '<div class="al-bubble" data-beat style="--b:0">' + esc(U.CALL_Q) + '</div>';
      if (st === 'thinking') t += '<div class="al-reply" data-beat style="--b:1">' + av + '<div class="al-reply-body"><span class="al-thinking"><i></i><i></i><i></i><span class="js-think">Reading the call privately…</span></span></div></div>';
      else t += '<div class="al-reply" data-beat style="--b:1">' + av + '<div class="al-reply-body"><div class="js-answer">' + (o.typing ? '' : U.CALL_A_HTML) + '</div>' +
        '<div class="' + (o.typing ? 'js-after' : '') + '" style="' + (o.typing ? 'display:none' : '') + '">' + U.callCites() +
        '<div class="al-reply-foot"><span class="ok">' + I('shield') + 'Answered privately</span><span>Every quote matches the transcript</span><span>36 credits</span></div></div></div></div>';
    }
    return head + U.privacyBar() + '<div class="ap-thread ap-chatthread">' + t + '</div>' + U.chatComposer({ draft: o.draft });
  };

  U.QUESTION = U.CALL_Q; U.ANSWER_HTML = U.CALL_A_HTML; U.ANSWER_TEXT = U.CALL_A_TEXT; U.cites = U.callCites;
  U.ITEMS.forEach(function (it) {
    var m = { lease: ['wave', 'Launch planning', 'Call · 32 min'], notes: ['mic', 'Offsite planning', 'Room · 18 min'], investor: ['record', 'Design review', 'Call · live'],
      memo: ['wave', 'Board prep', 'Call · 28 min'], board: ['wave', 'Customer call', 'Call · 41 min'], terms: ['mic', 'Lunch with Sam', 'Room · 22 min'] }[it.id];
    if (m) { it.icon = m[0]; it.title = m[1]; it.meta = m[2]; }
  });

  // ---------- home ----------
  U.home = function () {
    function card(icon, t, d, cls) { return '<div class="ap-hcard ' + (cls || '') + '">' + '<span class="ic">' + I(icon) + '</span><b>' + t + '</b><span>' + d + '</span></div>'; }
    var rows = [['wave', 'Launch planning', 'Today · 32 min · 4 people', U.state('done', 'Notes ready', 'al-state--sm')], ['mic', 'Lunch with Sam', 'In the room · 18 min', U.state('done', 'Notes ready', 'al-state--sm')],
      ['wave', 'Design review', 'Yesterday · 45 min · 3 people', U.state('done', 'Notes ready', 'al-state--sm')], ['wave', 'Customer call, Northwind', 'Tomorrow 10:00', '<span class="al-tag">Upcoming</span>']];
    return '<div class="ap-head"><h2>Good afternoon</h2><span class="sp"></span>' + U.e2ee() + '</div>' +
      '<div class="ap-hcards al-stagger">' + card('meeting', 'New private call', 'Encrypted video with notes built in', 'is-pri') + card('mic', 'Record in the room', 'Notes from a conversation around you') + card('ask', 'Ask about a call', 'Answers that quote the exact moment') + '</div>' +
      '<div class="ap-group" style="padding:0">Calls and recordings</div><div class="ap-list al-stagger">' + rows.map(function (r) {
        return '<div class="al-row">' + I(r[0]) + '<span class="n">' + esc(r[1]) + '<small>' + esc(r[2]) + '</small></span>' + r[3] + I('chevright') + '</div>'; }).join('') + '</div>';
  };

  // ---------- preferences ----------
  U.prefs = function () {
    function row(icon, t, d, right) { return '<div class="al-row" style="grid-template-columns:22px minmax(0,1fr) auto">' + I(icon) + '<span class="n">' + esc(t) + '<small>' + esc(d) + '</small></span>' + right + '</div>'; }
    return '<div class="ap-head"><h2>Preferences</h2></div><div class="al-stagger" style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
      '<div class="al-card" style="padding:6px"><div class="ap-group" style="padding:10px 12px 4px">Calls</div>' +
      row('page', 'Notes in my calls', 'On by default; everyone sees it before joining', '<span class="al-switch is-on"><i></i></span>') +
      row('screen', 'Notes from shared screens', 'Read slides and text when someone shares', '<span class="al-switch is-on"><i></i></span>') +
      row('users', 'Who gets the notes', 'Everyone in the call', '<span class="al-tag">Everyone</span>') + '</div>' +
      '<div class="al-card" style="padding:6px"><div class="ap-group" style="padding:10px 12px 4px">Privacy</div>' +
      row('shield', 'Notes service', 'Approved build, key bound, checked 10:02', U.state('done', 'Verified', 'al-state--sm')) +
      row('lock', 'Close when the tab closes', 'Always on', '<span class="al-switch is-on"><i></i></span>') + '</div>' +
      '<div class="al-card" style="padding:6px"><div class="ap-group" style="padding:10px 12px 4px">Devices</div>' +
      row('mic', 'Microphone', 'MacBook microphone', '<span class="al-tag">Change</span>') + row('meeting', 'Camera', 'FaceTime camera', '<span class="al-tag">Change</span>') + '</div>' +
      '<div class="al-card" style="padding:6px"><div class="ap-group" style="padding:10px 12px 4px">Appearance</div>' +
      row('auto', 'Theme', 'Follows your system', '<span class="al-seg"><span class="is-on">Auto</span><span>Light</span><span>Dark</span></span>') + '</div></div>';
  };
})();
