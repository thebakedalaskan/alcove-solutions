/*
 * The call, rethought (fourth round). Board and Workspace sit at the top right beside Notes and Chat, and open on your
 * stage just for you. Present, on what you have open (or Share in the dock), brings everyone with you: they follow you,
 * and on a board or in the workspace they can unfollow and work alongside. Only what someone presents gets a tile among
 * the people, and only while they present it. Close is for you; while you present, it asks whether it's for you or for
 * everyone. A screen you share has Stop sharing.
 * Everything a board on this canvas draws comes from here: the people, what's open, every moment a journey shows
 * (STEPS), what each press does (act), and the view the Call board reads (view). Demo people are made up.
 */
(function () {
  var I = window.NCI;
  var NC = window.NC = { I: I };
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  var cx = function () { return Array.prototype.slice.call(arguments).filter(Boolean).join(' '); };

  /* ---------- the people and what's in the call ---------- */
  var P = NC.P = {
    art: { name: 'Art Vandelay', first: 'Art' },
    priya: { name: 'Priya Raman', first: 'Priya' },
    kofi: { name: 'Kofi Asante', first: 'Kofi' },
    aiko: { name: 'Aiko Tanaka', first: 'Aiko' },
    maya: { name: 'Maya Chen', first: 'Maya' }
  };
  var first = NC.first = function (id) { return (P[id] || { first: id }).first; };
  var whose = function (id) { return first(id) + '’s'; };

  /* A board steps through its frames while you present it; the workspace is wherever its presenter goes. */
  var T = NC.T = {
    retro: { kind: 'board', title: 'Launch retro', sort: 'Board', icon: 'presentation', parts: ['Went well', 'Could improve', 'Actions'] },
    ws: { kind: 'ws', title: 'Launch review · 4 Nov', sort: 'Workspace', icon: 'folderOpen', parts: [] },
    screen: { kind: 'screen', title: 'Screen', sort: 'Screen', icon: 'screen', parts: [] }
  };
  NC.BOARD = [
    { title: 'Went well', tone: 'butter', notes: ['Beta sign-ups beat the plan', 'Support ran launch day with no queue', 'Pricing page shipped a week early'] },
    { title: 'Could improve', tone: 'rose', notes: ['Nobody owned the status page', 'Changelog went out after the launch post'] },
    { title: 'Actions', tone: 'sky', notes: ['Kofi owns the status page from now on', 'Changelog goes out before the post'] }
  ];
  /* The call's workspace: this call's own pages (the notes are one of them), then its documents. */
  NC.WS = {
    name: 'Launch review · 4 Nov',
    call: [{ id: 'notes', icon: 'notes', t: 'Notes' }, { id: 'follow', icon: 'todos', t: 'Follow-ups', n: '2' }, { id: 'transcript', icon: 'transcript', t: 'Transcript' }],
    docs: [{ id: 'plan', icon: 'fileText', t: 'Launch plan' }, { id: 'checklist', icon: 'fileText', t: 'Launch checklist' }, { id: 'copy', icon: 'fileText', t: 'Pricing page copy' }, { id: 'walk', icon: 'film', t: 'Onboarding walkthrough' }],
    plan: [
      { h: 'The date', p: 'The launch moves to Wednesday 18 November. Sign-ups are back up since the pricing change, so the date holds.' },
      { h: 'What goes out', li: ['Paying for minutes of notes, with free minutes every month', 'A monthly option on the team plan', 'The new onboarding, as the design review leaves it'] },
      { h: 'Who does what', li: ['Kofi: the status page and the changelog', 'Aiko: the empty states, by Thursday', 'Priya: the pricing page copy'] },
      { h: 'Risks', p: 'Nobody has tried the importer with a large team yet. Maya runs it on Vandelay’s own account on Monday.' }
    ],
    copy: [
      { h: 'Free minutes', p: 'Every account gets free minutes of notes each month. After that, minutes are paid for as you use them.' },
      { h: 'The team plan', p: 'One monthly price for everyone on the team, with notes included. Nobody counts minutes.' }
    ],
    pageName: { notes: 'Notes', follow: 'Follow-ups', transcript: 'Transcript', plan: 'Launch plan', checklist: 'Launch checklist', copy: 'Pricing page copy', walk: 'Onboarding walkthrough' }
  };
  /* Whoever presents a board keeps a few words for each frame, for them alone. */
  NC.MINE = { retro: ['Start with what we’d repeat. Thank support for launch day.', 'Keep this short: no blame, just owners.', 'Every action gets a name before we move on.'] };

  /*
   * What's open for you, or presented to you. `by` is whoever presents it, or null when it's open just for you; `min` says
   * it's a tile rather than on your stage (only ever while someone presents it); `follow` whether you follow the
   * presenter; `page` and `at` where they are; `mine` and `look` where you went on your own.
   */
  var th = function (id, o) { return Object.assign({ id: id, by: null, min: true, follow: true, at: 0, step: false, page: 'notes', mine: null, look: null }, o || {}); };
  var BASE = {
    phone: false, theme: 'dark', me: 'art', org: true,
    title: 'Launch review', clock: '24:18',
    people: ['art', 'priya', 'kofi', 'aiko'], talk: 'priya',
    mic: true, cam: true, hand: false, cc: false, unread: 2,
    shares: [], big: null, focus: false,
    side: null, notesTab: 'notes',
    pop: null, toast: null, hot: null
  };
  var closedFor = function (by) { return { icon: 'x', text: 'Closed for you. While ' + first(by) + ' presents, its tile takes you back.' }; };
  var TOAST = NC.TOAST = {
    screenOn: { icon: 'screen', text: 'Everyone sees your tab.' },
    screenOff: { icon: 'screen', text: 'You stopped sharing.' },
    boardOn: { icon: 'presentation', text: 'Everyone follows you on Launch retro. They can unfollow to add to it.' },
    wsOn: { icon: 'folderOpen', text: 'Everyone follows you in the workspace. They can unfollow to work alongside you.' },
    closedMe: { icon: 'x', text: 'You stopped presenting. The others keep it open, on their own.' },
    closedAll: { icon: 'x', text: 'Closed for everyone.' },
    closedViewer: closedFor('priya'),
    priyaWs: { icon: 'folderOpen', text: 'Priya is presenting the workspace, and you’re following.' },
    priyaBoard: { icon: 'presentation', text: 'Priya is presenting Launch retro, and you’re following.' },
    priyaScreen: { icon: 'screen', text: 'Priya is presenting a window.' },
    priyaStopped: { icon: 'folderOpen', text: 'Priya stopped presenting the workspace.' },
    hand: { icon: 'hand', text: 'Your hand is raised. Everyone can see it.' },
    handDown: { icon: 'hand', text: 'Your hand is lowered.' },
    stopTheirs: { icon: 'screen', text: 'You stopped Priya’s share for everyone. Priya is told it was you.' }
  };
  var WS = function (o) { return th('ws', o); };
  var RETRO = function (o) { return th('retro', o); };
  var STEPS = NC.STEPS = {
    call: {},
    shareMenu: { pop: 'share' },
    shareScreen: { pop: 'shareScreen' },
    shareBoard: { pop: 'shareBoard' },
    screenOn: { shares: [th('screen', { by: 'art', min: false })], toast: TOAST.screenOn },
    screenOff: { toast: TOAST.screenOff },
    wsOpen: { shares: [WS({ min: false })] },
    wsOpenPlan: { shares: [WS({ min: false, page: 'plan' })] },
    wsPresent: { shares: [WS({ min: false, by: 'art', page: 'plan' })], toast: TOAST.wsOn },
    wsPresentQuiet: { shares: [WS({ min: false, by: 'art', page: 'plan' })] },
    wsCloseMenu: { shares: [WS({ min: false, by: 'art', page: 'plan' })], pop: 'close:ws' },
    wsClosedAll: { toast: TOAST.closedAll },
    wsFromNotes: { shares: [WS({ min: false, page: 'notes' })], unread: 0 },
    boardPick: { pop: 'boardPick' },
    boardOpen: { shares: [RETRO({ min: false })] },
    boardOn: { shares: [RETRO({ min: false, by: 'art' })], toast: TOAST.boardOn },
    boardQuiet: { shares: [RETRO({ min: false, by: 'art' })] },
    boardNext: { shares: [RETRO({ min: false, by: 'art', at: 1, step: true })] },
    boardMine: { shares: [RETRO({ min: false, by: 'art', at: 1, step: true })], side: 'mine' },
    boardCloseMenu: { shares: [RETRO({ min: false, by: 'art', at: 1, step: true })], pop: 'close:retro' },
    boardClosedMe: { toast: TOAST.closedMe },
    boardMenu: { shares: [RETRO({ min: false, by: 'art' })], pop: 'frame:retro' },
    boardChat: { shares: [RETRO({ min: false, by: 'art' })], side: 'chat', unread: 0 },
    priyaWs: { org: false, shares: [WS({ min: false, by: 'priya', page: 'plan' })], toast: TOAST.priyaWs },
    unfollowWs: { org: false, shares: [WS({ min: false, by: 'priya', page: 'plan', follow: false, mine: 'copy' })] },
    refollowWs: { org: false, shares: [WS({ min: false, by: 'priya', page: 'plan' })] },
    viewerClosedWs: { org: false, shares: [WS({ by: 'priya', page: 'plan' })], toast: TOAST.closedViewer },
    priyaStopped: { org: false, toast: TOAST.priyaStopped },
    wsFocused: { org: false, shares: [WS({ min: false, by: 'priya', page: 'plan' })], focus: true },
    priyaBoard: { org: false, shares: [RETRO({ min: false, by: 'priya', at: 1, step: true })], toast: TOAST.priyaBoard },
    priyaBoardClosed: { org: false, shares: [RETRO({ by: 'priya', at: 1, step: true })], toast: TOAST.closedViewer },
    priyaScreen: { shares: [th('screen', { by: 'priya', min: false })], toast: TOAST.priyaScreen },
    priyaScreenQuiet: { shares: [th('screen', { by: 'priya', min: false })] },
    priyaScreenMenu: { shares: [th('screen', { by: 'priya', min: false })], pop: 'frame:screen' },
    chatOpen: { side: 'chat', unread: 0 },
    notesOpen: { side: 'notes', notesTab: 'notes', unread: 0 },
    transcriptOpen: { side: 'notes', notesTab: 'transcript', unread: 0 },
    askOpen: { side: 'notes', notesTab: 'ask', unread: 0 },
    notesLight: { side: 'notes', notesTab: 'notes', theme: 'light' },
    peopleOpen: { side: 'people' },
    moreOpen: { pop: 'more' },
    viewOpen: { pop: 'view' },
    pCall: { phone: true },
    pMore: { phone: true, pop: 'more' },
    pWsOpen: { phone: true, shares: [WS({ min: false })] },
    pWsPresent: { phone: true, shares: [WS({ min: false, by: 'art' })], toast: TOAST.wsOn },
    pWsCloseMenu: { phone: true, shares: [WS({ min: false, by: 'art' })], pop: 'close:ws' },
    pShare: { phone: true, pop: 'share' },
    pBoardQuiet: { phone: true, shares: [RETRO({ min: false, by: 'art' })] },
    pNotes: { phone: true, side: 'notes' },
    pPriyaWs: { phone: true, org: false, shares: [WS({ min: false, by: 'priya', page: 'plan' })] }
  };
  NC.step = function (name, hot) {
    var s = Object.assign({}, clone(BASE), clone(STEPS[name] || {}));
    s.hot = hot || null;
    return s;
  };

  /* ---------- what each press does ---------- */
  var find = NC.find = function (s, id) { return s.shares.filter(function (x) { return x.id === id; })[0] || null; };
  var drop = function (s, id) { s.shares = s.shares.filter(function (x) { return x.id !== id; }); };
  /*
   * Your stage holds one thing. Putting something on it puts away what was there: if someone presents that, it waits as a
   * tile with the people; if nobody does, it simply closes.
   */
  var clear = function (s, keep) {
    s.shares = s.shares.filter(function (x) { return x.id === keep || !!x.by; });
    s.shares.forEach(function (x) { if (x.id !== keep) x.min = true; });
  };
  var bring = function (s, x) { clear(s, x.id); x.min = false; s.big = x.id; s.focus = false; };
  var put = function (s, x) {
    clear(s, x.id);
    var had = find(s, x.id);
    if (had) Object.assign(had, x); else s.shares.push(x);
    s.big = x.id; s.focus = false;
  };
  NC.act = function (s0, id) {
    var s = clone(s0), was = s.toast;
    s.hot = null; s.toast = null;
    var bits = String(id).split(':'), a = bits[0], arg = bits[1];
    var it = arg ? find(s, arg) : null;
    var side = function (k) { s.pop = null; s.side = s.side === k ? null : k; if (k === 'chat') s.unread = 0; };
    switch (a) {
      /* Share, in the dock: present your screen, a board or the workspace straight away. */
      case 'dock.share': s.pop = s.pop && /^share/.test(s.pop) ? null : 'share'; break;
      case 'share.screen': if (!s.phone) s.pop = 'shareScreen'; break;
      case 'share.board': s.pop = 'shareBoard'; break;
      case 'share.ws': put(s, th('ws', { min: false, by: s.me })); s.pop = null; s.toast = TOAST.wsOn; break;
      case 'share.back': s.pop = 'share'; break;
      case 'pop.close': s.pop = null; break;
      case 'shareScreen.go': put(s, th('screen', { min: false, by: s.me })); s.pop = null; s.toast = TOAST.screenOn; break;
      case 'shareBoard.go': put(s, th('retro', { min: false, by: s.me })); s.pop = null; s.toast = TOAST.boardOn; break;
      /* Board and Workspace, at the top right: open it on your stage just for you, or put it away again. */
      case 'top.ws': case 'more.ws':
        s.pop = null;
        var w0 = find(s, 'ws');
        if (w0 && !w0.min) return NC.act(s, 'frame.close:ws');
        if (w0) { bring(s, w0); w0.follow = true; w0.mine = null; } else put(s, th('ws', { min: false }));
        break;
      case 'top.board':
        var b0 = find(s, 'retro');
        if (b0 && !b0.min) { s.pop = null; return NC.act(s, 'frame.close:retro'); }
        s.pop = s.pop === 'boardPick' ? null : 'boardPick'; break;
      case 'boardPick.go':
        var b1 = find(s, 'retro');
        s.pop = null;
        if (b1) { bring(s, b1); b1.follow = true; b1.look = null; } else put(s, th('retro', { min: false }));
        break;
      /* A tile is there only while someone presents it, and it takes you back in, following them. */
      case 'tile': if (it) { bring(s, it); it.follow = true; it.mine = null; it.look = null; } break;
      /* Open, at the top of Notes: the workspace, on these notes. */
      case 'notes.open':
        var w1 = find(s, 'ws');
        if (w1 && w1.by && w1.by !== s.me) { bring(s, w1); w1.follow = false; w1.mine = 'notes'; }
        else if (w1) { bring(s, w1); w1.page = 'notes'; }
        else put(s, th('ws', { min: false, page: 'notes' }));
        s.side = null; break;
      case 'frame.present': if (it) { it.by = s.me; it.follow = true; s.toast = it.id === 'retro' ? TOAST.boardOn : TOAST.wsOn; } break;
      /*
       * Close. While you present a board or the workspace, it asks: for you, or for everyone. Someone else's presentation
       * waits as a tile while they present it; what's open just for you simply closes. A screen you share stops.
       */
      case 'frame.close':
        if (!it) break;
        if (it.by === s.me && it.id !== 'screen') { s.pop = s.pop === 'close:' + arg ? null : 'close:' + arg; break; }
        s.pop = null; s.focus = false;
        if (it.by === s.me) { drop(s, arg); s.toast = TOAST.screenOff; }
        else if (it.by) { it.min = true; s.toast = closedFor(it.by); }
        else drop(s, arg);
        break;
      case 'close.me': drop(s, arg); s.pop = null; s.focus = false; s.toast = TOAST.closedMe; if (s.side === 'mine') s.side = null; break;
      case 'close.all': drop(s, arg); s.pop = null; s.focus = false; s.toast = TOAST.closedAll; if (s.side === 'mine') s.side = null; break;
      /* Stop sharing your screen; or, as the organizer, end anyone's from its name menu. */
      case 'frame.stop':
        if (it) { drop(s, arg); s.toast = it.id !== 'screen' ? TOAST.closedAll : it.by === s.me ? TOAST.screenOff : TOAST.stopTheirs; }
        s.pop = null; break;
      case 'frame.focus': s.focus = !s.focus; if (s.focus) { s.side = null; s.big = arg; } s.pop = null; break;
      case 'focus.exit': s.focus = false; break;
      case 'frame.next': if (it) { it.at = Math.min(it.at + 1, T[arg].parts.length - 1); it.step = true; } break;
      case 'frame.prev': if (it) { it.at = Math.max(it.at - 1, 0); it.step = true; } break;
      case 'frame.follow':
        if (it) {
          it.follow = !it.follow;
          if (it.follow) { it.mine = null; it.look = null; } else if (arg === 'ws') { it.mine = it.page === 'copy' ? 'notes' : 'copy'; } else { it.look = 0; }
        }
        break;
      case 'frame.look': if (it && it.by && it.by !== s.me && it.follow) { it.follow = false; if (arg === 'ws') it.mine = it.page === 'copy' ? 'notes' : 'copy'; else it.look = 0; } break;
      case 'ws.page':
        var w = find(s, 'ws');
        if (w) { if (!w.by || w.by === s.me) w.page = arg; else { w.follow = false; w.mine = arg; } }
        break;
      case 'frame.notes': s.pop = null; s.side = s.side === 'mine' ? null : 'mine'; break;
      case 'frame.menu': s.pop = s.pop === 'frame:' + arg ? null : 'frame:' + arg; break;
      case 'top.notes': side('notes'); break;
      case 'top.chat': side('chat'); break;
      case 'top.people': side('people'); break;
      case 'more.side': s.pop = null; s.side = arg; if (arg === 'chat') s.unread = 0; break;
      case 'side.close': s.side = null; break;
      case 'notes.tab': s.notesTab = arg; break;
      case 'dock.more': s.pop = s.pop === 'more' ? null : 'more'; break;
      case 'top.view': s.pop = s.pop === 'view' ? null : 'view'; break;
      case 'dock.mic': s.mic = !s.mic; s.toast = was; break;
      case 'dock.cam': s.cam = !s.cam; s.toast = was; break;
      case 'dock.hand': s.hand = !s.hand; s.toast = s.hand ? TOAST.hand : TOAST.handDown; s.pop = null; break;
      case 'toast.act': if (was && was.actId) return NC.act(s, was.actId); break;
      default: s.toast = was; break;
    }
    return s;
  };

  /* ---------- what's drawn ---------- */
  var NOTES = NC.NOTES = {
    decided: [{ t: 'The launch holds for Wednesday 18 November.', at: '16:04' }],
    follow: [
      { t: 'Own the status page from now on', who: 'kofi', due: 'Friday', at: '16:07' },
      { t: 'Move the empty arch into the kit', who: 'aiko', due: 'Thursday', at: '16:09' }
    ],
    summary: 'The launch holds for 18 November: sign-ups are back up since the pricing change. Nobody owned the status page last time, so Kofi takes it, and the changelog goes out before the post from now on.',
    yours: [{ t: 'Ask Maya how the importer test went', at: '16:10' }]
  };
  var LINES = [
    { at: '16:07', who: 'priya', t: 'Sign-ups are back up since the pricing change.' },
    { at: '16:07', who: 'kofi', t: 'Then the date holds. I can take the status page.' },
    { at: '16:09', who: 'aiko', t: 'I’ll move the empty arch into the kit by Thursday.' },
    { at: '16:10', who: 'art', t: 'Good. And the changelog goes out before the post this time.' },
    { at: '16:11', who: 'priya', t: 'Let me present the workspace so we can go through the plan.' }
  ];
  var CHAT = [
    { who: 'kofi', at: '16:05', t: 'Link to the checklist?' },
    { who: 'priya', at: '16:05', t: 'It’s in the workspace, under Documents.' },
    { who: 'aiko', at: '16:06', t: 'I’ll present the retro board after this.' }
  ];

  /* The layout of the window, and of the stage inside it. */
  function geo(s) {
    var W = s.W || 1440, H = s.H || 900;
    var sideW = s.side ? (W < 1200 ? 340 : 368) : 0;
    var st = s.focus ? { x: 16, y: 16, w: W - 32, h: H - 16 - 92 } : { x: 16, y: 64, w: W - 32 - (sideW ? sideW + 12 : 0), h: H - 64 - 84 };
    return { W: W, H: H, st: st, side: sideW ? { x: W - 16 - sideW, y: 64, w: sideW, h: H - 64 - 84 } : null };
  }
  var px = function (r) { return 'left: ' + Math.round(r.x) + 'px; top: ' + Math.round(r.y) + 'px; width: ' + Math.round(r.w) + 'px; height: ' + Math.round(r.h) + 'px'; };

  /* Something in the call as a tile: its content drawn at 880 by 550 and scaled to fit. */
  var MINI_W = 880, MINI_H = 550;

  NC.view = function (s, on) {
    var hot = function (id) { return s.hot === id ? 'is-hot' : ''; };
    var me = s.me, phone = s.phone;
    var shown = s.shares.filter(function (x) { return !x.min; });
    var bigOne = shown.filter(function (x) { return x.id === s.big; })[0] || shown[shown.length - 1] || null;
    /* Only what someone presents has a tile, and only while it isn't on your stage. */
    var tileShares = s.shares.filter(function (x) { return x !== bigOne && !!x.by; });
    var following = s.people.length - 1;

    /* -- the frame anything open wears: whose it is, then what's yours to press -- */
    var frameOf = function (x, r) {
      var t = T[x.id], mine = x.by === me, theirs = !!x.by && !mine, solo = !x.by, collab = t.kind === 'board' || t.kind === 'ws';
      var name = t.kind === 'screen' ? (mine ? 'Your screen' : whose(x.by) + ' screen') : t.title;
      var where = t.kind === 'ws' ? NC.WS.pageName[x.page] : t.kind === 'board' ? t.parts[x.at] : '';
      var meta = mine ? (t.kind === 'screen' ? 'You’re presenting · a tab with sound' : 'You’re presenting · ' + following + ' following')
        : theirs ? first(x.by) + ' is presenting' : 'Open just for you';
      var bodyW = Math.round(r.w), bodyH = Math.round(r.h - 52);
      var mode = mine ? 'presenter' : theirs ? (x.follow ? 'follow' : 'own') : 'own';
      return {
        key: x.id, style: px(r), cls: cx('nc-frame', 'k-' + t.kind, s.focus && 'is-focus', theirs && collab && x.follow && 'is-following'),
        who: x.by || '', hasWho: !!x.by, icon: I[t.icon], name: name, meta: meta,
        nameCls: cx('nc-fname', hot('frame.menu:' + x.id)), nameClick: on('frame.menu:' + x.id),
        hasFollowing: theirs && collab && x.follow, hasFollowBtn: theirs && collab && !x.follow,
        followName: first(x.by), followWhere: first(x.by) + ' is in ' + (where || 'it'),
        unfollowCls: cx('nc-unf', hot('frame.follow:' + x.id)), followCls: cx('nc-follow', hot('frame.follow:' + x.id)), followClick: on('frame.follow:' + x.id),
        hasPresent: solo && collab, presentCls: cx('nc-present', hot('frame.present:' + x.id)), presentClick: on('frame.present:' + x.id),
        hasClose: !(mine && t.kind === 'screen'), closeAsks: mine, closeCls: cx('nc-close', s.pop === 'close:' + x.id && 'is-on', hot('frame.close:' + x.id)), closeClick: on('frame.close:' + x.id),
        closeTip: mine ? 'Close it for you, or for everyone' : theirs ? 'Close it for you. While ' + first(x.by) + ' presents, its tile takes you back' : 'Close it',
        hasStop: mine && t.kind === 'screen', stopCls: cx('nc-stop', hot('frame.stop:' + x.id)), stopClick: on('frame.stop:' + x.id),
        hasFocus: !phone, focusCls: cx('nc-fib', s.focus && 'is-on', hot('frame.focus:' + x.id)), focusClick: on(s.focus ? 'focus.exit' : 'frame.focus:' + x.id),
        focusIcon: I[s.focus ? 'minimize' : 'maximize'], focusLabel: s.focus ? 'Leave focus' : 'Fill your window with it',
        /* A board you present steps through its frames from its foot. */
        hasStepper: mine && t.kind === 'board', stepTxt: (x.at + 1) + ' of ' + t.parts.length, partName: t.parts[x.at] || '',
        prevClick: on('frame.prev:' + x.id), nextClick: on('frame.next:' + x.id), prevCls: cx('nc-pb', hot('frame.prev:' + x.id)), nextCls: cx('nc-pb', hot('frame.next:' + x.id)),
        prevOff: x.at === 0, nextOff: x.at >= t.parts.length - 1,
        notesCls: cx('nc-fib', s.side === 'mine' && 'is-on', hot('frame.notes:' + x.id)), notesClick: on('frame.notes:' + x.id),
        thing: x.id, mode: mode, sharer: x.by || me,
        at: mode === 'own' && t.kind === 'board' ? (x.look || 0) : x.at, them: x.at, step: x.step && mode !== 'own',
        page: mode === 'own' && t.kind === 'ws' && theirs ? (x.mine || 'notes') : x.page, theirPage: theirs ? x.page : '',
        bw: bodyW, bh: bodyH, narrow: phone,
        canLook: theirs && collab && x.follow, lookCls: cx('nc-look', hot('frame.look:' + x.id)), lookClick: on('frame.look:' + x.id)
      };
    };
    /* What someone presents, while it isn't on your stage: a tile with the people, saying who presents it. */
    var tileOfShare = function (x, r) {
      var t = T[x.id], k = r.w / MINI_W, mine = x.by === me;
      var label = t.kind === 'screen' ? (mine ? 'Your screen' : whose(x.by) + ' screen') : t.title;
      return {
        key: 's-' + x.id, style: px(r), cls: cx('nc-tile is-thing is-live', hot('tile:' + x.id)), click: on('tile:' + x.id),
        isPerson: false, isThing: true, thing: x.id, at: x.at, page: x.page, d: I[t.icon],
        mStyle: 'width: ' + MINI_W + 'px; height: ' + MINI_H + 'px; transform: scale(' + k.toFixed(4) + ')',
        label: label, sub: mine ? 'You’re presenting' : first(x.by) + ' is presenting', inWho: x.by, hasIn: true,
        aria: (mine ? 'Go back to ' : 'Join ') + label, go: mine ? 'Open' : 'Join'
      };
    };
    var tileOfPerson = function (id, r) {
      return {
        key: 'p-' + id, style: px(r), cls: cx('nc-tile', s.talk === id && 'is-speaking', id === me && s.hand && 'is-hand'),
        isPerson: true, isThing: false, who: id, name: id === me ? first(id) + ' (you)' : first(id), talk: s.talk === id,
        hand: id === me && s.hand, click: on('noop'), aria: first(id)
      };
    };

    var v = { phone: phone, wide: !phone, I: I };
    v.rootCls = cx('nc stage', phone ? 'is-phone' : 'is-wide', s.focus && 'is-focus');
    v.rootStyle = phone ? 'width: 390px; height: 844px' : 'width: ' + (s.W || 1440) + 'px; height: ' + (s.H || 900) + 'px';

    /* -- the stage: people, and what's in the call with them -- */
    var frames = [], tiles = [], arches = [];
    var crowd = function () { return tileShares.map(function (x) { return { share: x }; }).concat(s.people.map(function (id) { return { person: id }; })); };
    if (!phone) {
      var g = geo(s), st = g.st;
      if (bigOne && s.focus) {
        frames.push(frameOf(bigOne, st));
        arches = s.people.map(function (id) { return { who: id, cls: cx('nc-arch', s.talk === id && 'is-talk') }; });
      } else if (bigOne && st.w < 760) {
        frames.push(frameOf(bigOne, { x: st.x, y: st.y + 62, w: st.w, h: st.h - 62 }));
        arches = s.people.map(function (id) { return { who: id, cls: cx('nc-arch', s.talk === id && 'is-talk') }; });
        v.archesStyle = 'left: ' + st.x + 'px; top: ' + st.y + 'px';
        v.topArches = true;
      } else if (bigOne) {
        var colW = st.w >= 1500 ? 300 : st.w >= 1300 ? 248 : st.w >= 980 ? 216 : 176;
        var fr = { x: st.x, y: st.y, w: st.w - colW - 12, h: st.h };
        frames.push(frameOf(bigOne, fr));
        var items = crowd(), n = items.length, th0 = Math.min((st.h - 12 * (n - 1)) / n, colW * 0.74);
        items.forEach(function (it, i) {
          var r = { x: fr.x + fr.w + 12, y: st.y + i * (th0 + 12), w: colW, h: th0 };
          tiles.push(it.share ? tileOfShare(it.share, r) : tileOfPerson(it.person, r));
        });
      } else {
        var all = crowd(), m = all.length, cols = m <= 1 ? 1 : m <= 4 ? 2 : m <= 6 ? 3 : 4, rows = Math.ceil(m / cols);
        var cw = (st.w - 12 * (cols - 1)) / cols, ch = (st.h - 12 * (rows - 1)) / rows;
        all.forEach(function (it, i) {
          var row = Math.floor(i / cols), col = i % cols, inRow = row === rows - 1 ? m - row * cols : cols;
          var off = (cols - inRow) * (cw + 12) / 2;
          var r = { x: st.x + off + col * (cw + 12), y: st.y + row * (ch + 12), w: cw, h: ch };
          tiles.push(it.share ? tileOfShare(it.share, r) : tileOfPerson(it.person, r));
        });
      }
      v.sideGeo = g.side;
    } else {
      /* A phone: faces on top, what's open under them, the dock at the foot. */
      if (bigOne) {
        frames.push(frameOf(bigOne, { x: 12, y: 116, w: 366, h: 640 }));
        arches = s.people.map(function (id) { return { who: id, cls: cx('nc-arch', s.talk === id && 'is-talk') }; });
      } else {
        var pItems = crowd(), pw = (366 - 10) / 2, phh = pItems.length > 4 ? 218 : 300;
        pItems.forEach(function (it, i) {
          var r = { x: 12 + (i % 2) * (pw + 10), y: 64 + Math.floor(i / 2) * (phh + 10), w: pw, h: phh };
          tiles.push(it.share ? tileOfShare(it.share, r) : tileOfPerson(it.person, r));
        });
      }
    }
    v.frames = frames; v.tiles = tiles; v.arches = arches; v.hasArches = arches.length > 0;

    /* -- the top bar: the call on the left, yours on the right -- */
    v.showTop = !s.focus;
    v.title = s.title; v.clock = s.clock;
    v.signCls = cx('nc-sign', hot('top.sign'));
    v.viewCls = cx('nc-view', s.pop === 'view' && 'is-on', hot('top.view')); v.viewClick = on('top.view');
    var yb = function (id, icon, label, badge) {
      var open = s.side === id;
      return { id: id, d: I[icon], label: label, cls: cx('nc-yb has-l', open && 'is-on', hot('top.' + id)), click: on('top.' + id), badge: badge || 0, hasBadge: !!badge && !open, tip: label + (open ? '' : ' · only you'), sep: false };
    };
    /* Board and Workspace open on your stage, just for you; Notes and Chat open on your side. */
    var ob = function (id, tid, icon, label, key) {
      var x = find(s, tid), open = (!!x && !x.min) || (id === 'board' && s.pop === 'boardPick');
      return { id: id, d: I[icon], label: label, cls: cx('nc-yb has-l', open && 'is-on', hot('top.' + id)), click: on('top.' + id), badge: 0, hasBadge: false, tip: (id === 'board' ? 'Open a board' : 'Open the workspace') + ', just for you · ' + key, sep: false };
    };
    v.yours = [ob('board', 'retro', 'presentation', 'Board', 'O'), ob('ws', 'ws', 'folderOpen', 'Workspace', 'W'), Object.assign(yb('notes', 'notebook', 'Notes'), { sep: true }), yb('chat', 'chat', 'Chat', s.unread)];
    v.facesCls = cx('nc-yb is-faces', s.side === 'people' && 'is-on', hot('top.people')); v.facesClick = on('top.people');
    v.facesWho = s.people.join(','); v.count = s.people.length;
    v.phoneChat = yb('chat', 'chat', 'Chat', s.unread);

    /* -- the dock: what you do in the call -- */
    var presenting = s.shares.filter(function (x) { return x.by === me; })[0] || null;
    v.dk = {
      mic: { cls: cx('nc-db', !s.mic && 'is-off', hot('dock.mic')), d: I[s.mic ? 'mic' : 'micOff'], click: on('dock.mic'), label: s.mic ? 'Mute' : 'Unmute' },
      cam: { cls: cx('nc-db', !s.cam && 'is-off', hot('dock.cam')), d: I[s.cam ? 'video' : 'videoOff'], click: on('dock.cam'), label: s.cam ? 'Turn camera off' : 'Turn camera on' },
      share: { cls: cx(phone ? 'nc-db' : 'nc-dword', (presenting || (s.pop && /^share/.test(s.pop))) && 'is-on', hot('dock.share')), click: on('dock.share'), label: presenting ? 'Presenting' : 'Share' },
      hand: { cls: cx('nc-db', s.hand && 'is-on', hot('dock.hand')), click: on('dock.hand'), label: s.hand ? 'Lower your hand' : 'Raise your hand' },
      more: { cls: cx('nc-db', s.pop === 'more' && 'is-on', hot('dock.more')), click: on('dock.more') },
      leave: { cls: cx('nc-leave', hot('dock.leave')), click: on('noop') },
      tucked: s.focus, open: !s.focus,
      back: { cls: cx('nc-dwords', hot('focus.exit')), click: on('focus.exit') }
    };

    /* -- toasts -- */
    v.toast = s.toast ? { d: I[s.toast.icon] || I.info, text: s.toast.text, hasAct: !!s.toast.act, act: s.toast.act || '', actCls: cx('nc-tact', hot('toast.act')), click: on('toast.act') } : null;
    v.hasToast = !!s.toast;

    /* -- your side -- */
    v.side = null; v.hasSide = !!s.side;
    if (s.side) {
      var sg = v.sideGeo, light = s.theme === 'light';
      var titles = { notes: 'Notes', chat: 'Chat', people: 'People', mine: 'Your notes' };
      var mineOf = s.shares.filter(function (x) { return x.by === me && T[x.id].kind === 'board'; })[0];
      v.side = {
        cls: cx('nc-side', light ? 'light' : 'dark', 'k-' + s.side, phone && 'is-sheet'), style: phone ? '' : px(sg),
        title: titles[s.side], closeCls: cx('nc-x', hot('side.close')), closeClick: on('side.close'),
        isNotes: s.side === 'notes', isChat: s.side === 'chat', isPeople: s.side === 'people', isMine: s.side === 'mine',
        markCls: cx('nc-ib', hot('notes.mark')),
        shareCls: cx('nc-nshare', hot('notes.open')), shareClick: on('notes.open'), wsName: NC.WS.name
      };
      if (s.side === 'notes') {
        var tab = function (id, label) { return { label: label, pressed: s.notesTab === id ? 'true' : 'false', cls: hot('notes.tab:' + id), click: on('notes.tab:' + id) }; };
        Object.assign(v.side, {
          tabs: [tab('notes', 'Notes'), tab('transcript', 'Transcript'), tab('ask', 'Ask')],
          onNotes: s.notesTab === 'notes', onTranscript: s.notesTab === 'transcript', onAsk: s.notesTab === 'ask',
          decided: NOTES.decided, follow: NOTES.follow.map(function (f) { return Object.assign({}, f, { name: first(f.who) }); }), summary: NOTES.summary, yours: NOTES.yours,
          lines: LINES.map(function (l) { return Object.assign({}, l, { name: l.who === me ? first(l.who) + ' (you)' : first(l.who) }); }),
          chips: ['What did I miss?', 'What’s been decided?', 'Who’s doing what?']
        });
      }
      if (s.side === 'chat') v.side.chat = CHAT.map(function (c) { return Object.assign({}, c, { name: first(c.who) }); });
      if (s.side === 'people') {
        v.side.here = s.people.map(function (id) {
          var d = id === me ? (s.org ? 'Organizer · you' : 'You') : id === s.talk ? 'Invited · talking' : 'Invited';
          return { who: id, name: P[id].name, detail: d, talk: id === s.talk };
        });
        v.side.count = s.people.length;
      }
      if (s.side === 'mine' && mineOf) {
        var tm = T[mineOf.id];
        Object.assign(v.side, {
          mineNow: tm.parts[mineOf.at], mineNext: tm.parts[mineOf.at + 1] || 'That’s the last one', minePos: (mineOf.at + 1) + ' of ' + tm.parts.length,
          mineText: (NC.MINE[mineOf.id] || [])[mineOf.at] || '', mineThing: mineOf.id, mineAt: Math.min(mineOf.at + 1, tm.parts.length - 1)
        });
      }
    }

    /* -- what opens over the call -- */
    v.isShare = s.pop === 'share'; v.isShareScreen = s.pop === 'shareScreen'; v.isShareBoard = s.pop === 'shareBoard';
    v.anyShare = v.isShare || v.isShareScreen || v.isShareBoard;
    v.isMore = s.pop === 'more'; v.isView = s.pop === 'view';
    var frameAt = function (fid) { var f0 = frames.filter(function (f) { return f.key === fid; })[0]; return f0 ? { x: parseInt(/left: (\d+)/.exec(f0.style)[1], 10), y: parseInt(/top: (\d+)/.exec(f0.style)[1], 10), w: parseInt(/width: (\d+)/.exec(f0.style)[1], 10) } : null; };
    v.frameMenu = null;
    if (s.pop && s.pop.indexOf('frame:') === 0) {
      var fid = s.pop.slice(6), fx = find(s, fid), ft = T[fid], fmine = fx && fx.by === me;
      var rows = ft.kind === 'board' ? [['pen', 'Rename'], ['folder', 'Open where it’s saved'], ['people', 'Who can add to it'], ['link', 'Copy link'], ['download', 'Download as an image'], ['moon', 'Night board']]
        : ft.kind === 'ws' ? [['folders', 'Switch workspace'], ['search', 'Find in the workspace'], ['people', 'Who’s in it'], ['link', 'Copy link']]
          : fmine ? [['pointer', 'Others can point at it'], ['x', 'Clear marks'], ['screen', 'Change what you share']]
            : [['pointer', 'Point at it', 'L'], ['pause', 'Freeze the picture', 'F'], ['speakerOff', 'Mute its sound for you'], ['external', 'Open in its own window'], ['presentation', 'Put on the board']];
      var mrows = rows.map(function (r) { return { d: I[r[0]], t: r[1], k: r[2] || '', hasK: !!r[2], cls: 'nc-mi', click: on('pop.close'), sep: false }; });
      /* The organizer can end anyone's presentation from here; on yours, Close or Stop sharing is on the bar. */
      if (fx && fx.by && !fmine && s.org) mrows.push({ d: I.x, t: ft.kind === 'screen' ? 'Stop it for everyone' : 'Close it for everyone', k: '', hasK: false, cls: cx('nc-mi is-stopall', hot('frame.stop:' + fid)), click: on('frame.stop:' + fid), sep: true });
      v.frameMenu = { rows: mrows, head: ft.kind === 'screen' ? (fmine ? 'Your screen' : whose(fx.by) + ' screen') : ft.title };
      var p0 = frameAt(fid);
      v.frameMenuStyle = p0 ? 'left: ' + (p0.x + 10) + 'px; top: ' + (p0.y + 50) + 'px' : 'left: 26px; top: 114px';
    }
    v.hasFrameMenu = !!v.frameMenu;
    /* Close, while you present: for you, or for everyone. */
    v.closeMenu = null;
    if (s.pop && s.pop.indexOf('close:') === 0) {
      var cid = s.pop.slice(6), ct = T[cid];
      v.closeMenu = {
        head: 'Close ' + ct.title,
        rows: [
          { d: I.user, t: 'For you', sub: 'You stop presenting. Everyone else keeps it open, on their own.', cls: cx('nc-cm', hot('close.me:' + cid)), click: on('close.me:' + cid) },
          { d: I.people, t: 'For everyone', sub: 'It closes for everyone in the call.', cls: cx('nc-cm', hot('close.all:' + cid)), click: on('close.all:' + cid) }
        ]
      };
      var p1 = frameAt(cid);
      v.closeMenuStyle = phone ? '' : p1 ? 'left: ' + (p1.x + p1.w - 322) + 'px; top: ' + (p1.y + 50) + 'px' : 'right: 300px; top: 114px';
    }
    v.hasCloseMenu = !!v.closeMenu;
    v.scrim = phone && (!!s.pop || !!s.side);
    v.scrimClick = on(s.side && !s.pop ? 'side.close' : 'pop.close');

    /* Boards to start from, and the team's own: Share › A board presents one; Board, at the top right, opens one for you. */
    var TPL = [
      { t: 'Blank', rects: [{ s: 'left: 42%; top: 30%; width: 16%; height: 40%; background: transparent; box-shadow: inset 0 0 0 1.5px rgb(255 255 255 / .25); border-radius: 50%' }] },
      { t: 'Retro', rects: [{ s: 'left: 8%; top: 18%; width: 25%; height: 64%; background: rgb(255 255 255 / .07)' }, { s: 'left: 37.5%; top: 18%; width: 25%; height: 64%; background: rgb(255 255 255 / .07)' }, { s: 'left: 67%; top: 18%; width: 25%; height: 64%; background: rgb(255 255 255 / .07)' }, { s: 'left: 12%; top: 26%; width: 17%; height: 22%; background: #84591A' }, { s: 'left: 41.5%; top: 26%; width: 17%; height: 22%; background: #6D3349' }, { s: 'left: 71%; top: 26%; width: 17%; height: 22%; background: #384893' }] },
      { t: 'Ideas', rects: [{ s: 'left: 12%; top: 20%; width: 18%; height: 26%; background: #84591A; transform: rotate(-4deg)' }, { s: 'left: 40%; top: 14%; width: 18%; height: 26%; background: #40337A' }, { s: 'left: 68%; top: 24%; width: 18%; height: 26%; background: #6D3349; transform: rotate(3deg)' }, { s: 'left: 24%; top: 56%; width: 18%; height: 26%; background: #384893' }, { s: 'left: 54%; top: 58%; width: 18%; height: 26%; background: #84591A; transform: rotate(-2deg)' }] },
      { t: 'Flow', rects: [{ s: 'left: 8%; top: 36%; width: 20%; height: 28%; background: transparent; box-shadow: inset 0 0 0 1.5px #8EBCEC' }, { s: 'left: 28%; top: 49%; width: 12%; height: 2px; background: #8EBCEC' }, { s: 'left: 40%; top: 36%; width: 20%; height: 28%; background: transparent; box-shadow: inset 0 0 0 1.5px #8EBCEC; border-radius: 50%' }, { s: 'left: 60%; top: 49%; width: 12%; height: 2px; background: #8EBCEC' }, { s: 'left: 72%; top: 36%; width: 20%; height: 28%; background: transparent; box-shadow: inset 0 0 0 1.5px #8EBCEC' }] }
    ];
    var tpls = function (go) { return TPL.map(function (b) { return { t: b.t, rects: b.rects, cls: 'nc-tpl', click: on(go) }; }); };
    var rb = find(s, 'retro');
    var boardsFor = function (go) {
      return [
        { t: 'Launch retro', m: rb && rb.by ? (rb.by === me ? 'You’re presenting it' : first(rb.by) + ' is presenting it') : 'Priya · Product', w: 'Today', cls: cx('nc-rrow', hot(go)), click: on(go) },
        { t: 'Onboarding flow', m: 'Aiko · Design', w: 'Mon', cls: 'nc-rrow', click: on(go) }
      ];
    };
    v.isBoardPick = s.pop === 'boardPick';
    v.pick = { templates: tpls('boardPick.go'), boards: boardsFor('boardPick.go') };

    /* Share: present your screen, a board or the workspace straight away. */
    var srow = function (id, icon, t, d, extra) { return Object.assign({ d: I[icon], t: t, sub: d, cls: cx('nc-srow', hot(id)), click: on(id), chev: true }, extra || {}); };
    v.share = {
      mine: presenting ? { t: presenting.id === 'screen' ? 'your screen' : T[presenting.id].title, cls: cx('nc-stop', hot('frame.close:' + presenting.id)), click: on(presenting.id === 'screen' ? 'frame.stop:screen' : 'frame.close:' + presenting.id) } : null,
      kinds: [
        srow('share.screen', 'screen', 'Your screen', phone ? 'Sharing a screen needs a computer' : 'A tab, a window or your whole screen', { cls: cx('nc-srow', phone && 'is-off', hot('share.screen')), chev: !phone }),
        srow('share.board', 'presentation', 'A board', 'Start one, or open one your team has'),
        srow('share.ws', 'folderOpen', 'The workspace', 'This call’s notes and documents', { chev: false })
      ],
      backCls: cx('nc-back', hot('share.back')), backClick: on('share.back'),
      goScreenCls: cx('nc-press', hot('shareScreen.go')), goScreenClick: on('shareScreen.go'),
      templates: tpls('shareBoard.go'),
      boards: boardsFor('shareBoard.go')
    };
    v.hasMineShare = !!presenting;
    v.more = {
      grid: [['board', 'presentation', 'Board', 'top.board'], ['ws', 'folderOpen', 'Workspace', 'more.ws'], ['notes', 'notebook', 'Notes', 'more.side:notes'], ['chat', 'chat', 'Chat', 'more.side:chat'], ['people', 'people', 'People', 'more.side:people']].map(function (g) {
        return { d: I[g[1]], t: g[2], cls: cx('nc-mg', hot(g[3])), click: on(g[3]), badge: g[0] === 'chat' ? s.unread : 0, hasBadge: g[0] === 'chat' && s.unread > 0 };
      }),
      rows: (phone ? [['hand', 'Raise your hand', '', ''], ['viewAuto', 'Your view', '', '']] : []).concat([
        ['captions', s.cc ? 'Turn off captions' : 'Turn on captions', '', 'C'],
        ['bookmark', 'Mark this moment', 'Only you', 'B'],
        ['history', 'Catch up on what you missed', '', ''],
        ['doorOpen', 'Breakout rooms', '', '']
      ]).map(function (r) { return { d: I[r[0]], t: r[1], scope: r[2], hasScope: !!r[2], k: r[3], hasK: !!r[3] }; }),
      rows2: [['speaker', 'Audio and video settings'], ['sliders', 'Video quality'], ['phone', 'Move to another device'], ['keyboard', 'Keyboard shortcuts']].map(function (r) { return { d: I[r[0]], t: r[1] }; })
    };
    v.shareStyle = phone ? '' : 'left: 50%; margin-left: -236px; bottom: 84px';
    v.moreStyle = phone ? '' : 'left: 50%; margin-left: -96px; bottom: 84px';
    v.viewStyle = 'right: 551px; top: 58px';
    v.pickStyle = phone ? '' : 'right: 124px; top: 58px';
    return v;
  };

  /* ---------- the journeys ---------- */
  NC.JOURNEYS = [
    {
      id: 'ws', n: 1, title: 'Open the workspace, then present it', blurb: 'Workspace, at the top right, opens it just for you. Present brings everyone with you, and Close asks whether it’s for you or for everyone.',
      frames: [
        { step: 'call', hot: 'top.ws', did: 'Click Workspace, at the top right.', see: 'Board and Workspace sit beside Notes and Chat. Until someone presents, only the people are on the stage.' },
        { step: 'wsOpen', hot: 'ws.page:plan', did: 'It opens just for you.', see: 'Nobody else’s screen changes. It opens on this call’s notes, the first of its pages.' },
        { step: 'wsOpenPlan', hot: 'frame.present:ws', did: 'Click Launch plan, and work on your own.', see: 'Present, on its bar, brings everyone here.' },
        { step: 'wsPresent', hot: 'frame.close:ws', did: 'Click Present.', see: 'Everyone follows you, live. Anyone can unfollow to write alongside you.' },
        { step: 'wsCloseMenu', hot: 'close.all:ws', did: 'Click Close.', see: 'While you present, Close asks: just for you, or for everyone.' },
        { step: 'wsClosedAll', hot: null, did: 'Click For everyone.', see: 'It closes for everyone and leaves nothing on the stage. Workspace opens it again.' }
      ]
    },
    {
      id: 'board', n: 2, title: 'Open a board, then present it', blurb: 'Board, at the top right, opens one just for you. Present it, step through its frames, then close it for you while the others keep working.',
      frames: [
        { step: 'call', hot: 'top.board', did: 'Click Board, at the top right.', see: 'It offers a new board, or one your team has.' },
        { step: 'boardPick', hot: 'boardPick.go', did: 'Pick Launch retro.', see: 'The same choices as today’s Board menu. Only you see it until you present it.' },
        { step: 'boardOpen', hot: 'frame.present:retro', did: 'It opens just for you.', see: 'Look around and add to it on your own. Present, on its bar, brings everyone.' },
        { step: 'boardOn', hot: 'frame.next:retro', did: 'Click Present.', see: 'Everyone follows you. The arrows at its foot step through its frames.' },
        { step: 'boardNext', hot: 'frame.close:retro', did: 'Click the arrow for the next frame.', see: 'Everyone following you moves with you.' },
        { step: 'boardCloseMenu', hot: 'close.me:retro', did: 'Click Close.', see: 'For you, or for everyone.' },
        { step: 'boardClosedMe', hot: null, did: 'Click For you.', see: 'You’re back with the people. The others keep it open on their own; nobody presents it, so it has no tile.' }
      ]
    },
    {
      id: 'watch', n: 3, title: 'When someone else presents', blurb: 'You follow whoever presents. Unfollow to work on your own, or close it for you: while they present, its tile takes you back.',
      frames: [
        { step: 'priyaWs', hot: 'frame.follow:ws', did: 'Priya presents the workspace.', see: 'You follow Priya into Launch plan. The blue edge says you’re seeing what Priya sees.' },
        { step: 'unfollowWs', hot: 'frame.follow:ws', did: 'Click Unfollow.', see: 'You’re on your own in the same workspace: open another document and write. A face shows where Priya is.' },
        { step: 'refollowWs', hot: 'frame.close:ws', did: 'Click Follow Priya.', see: 'You’re back where Priya is.' },
        { step: 'viewerClosedWs', hot: 'tile:ws', did: 'Click Close.', see: 'It’s closed for you. While Priya presents it, it has a tile with the people.' },
        { step: 'refollowWs', hot: null, did: 'Click its tile.', see: 'You’re back in, following Priya.' },
        { step: 'priyaStopped', hot: null, did: 'If Priya stops while it’s closed for you.', see: 'Its tile goes too. Workspace, at the top right, still opens it just for you.' }
      ]
    },
    {
      id: 'screen', n: 4, title: 'Share your screen', blurb: 'Share, in the dock, presents your screen, a board or the workspace straight away. Only you can stop your screen.',
      frames: [
        { step: 'call', hot: 'dock.share', did: 'Click Share in the dock.', see: 'It opens a menu above the dock.' },
        { step: 'shareMenu', hot: 'share.screen', did: 'Click Your screen.', see: 'Your screen, a board or the workspace, presented straight away.' },
        { step: 'shareScreen', hot: 'shareScreen.go', did: 'Pick a tab, a window or your screen, then Share.', see: 'The next step opens in the same menu. Then the browser asks which one, as it does today.' },
        { step: 'screenOn', hot: 'frame.stop:screen', did: 'You’re presenting.', see: 'Everyone sees what you see. Stop sharing is on your bar; anyone else can close it for themselves.' },
        { step: 'screenOff', hot: null, did: 'Click Stop sharing.', see: 'It stops for everyone, and the people take the stage back.' }
      ]
    },
    {
      id: 'notes', n: 5, title: 'Notes, the transcript and chat, apart', blurb: 'Chat has a panel to itself. Notes is this call’s pages of the workspace, kept on your side for you.',
      frames: [
        { step: 'call', hot: 'top.chat', did: 'Click Chat, at the top right.', see: 'Chat has a panel of its own, with nothing else in it.' },
        { step: 'chatOpen', hot: 'top.notes', did: 'It’s only messages.', see: 'Encrypted end to end, as before. Notes is the button beside it.' },
        { step: 'notesOpen', hot: 'notes.tab:transcript', did: 'Click Notes.', see: 'This call’s notes, the same pages the workspace keeps: the notes, the transcript and Ask.' },
        { step: 'transcriptOpen', hot: 'notes.tab:ask', did: 'Click Transcript.', see: 'The whole call so far, with who’s talking at the end.' },
        { step: 'askOpen', hot: 'notes.open', did: 'Click Ask.', see: 'Catch up lives here: ask what you missed, or anything about the call.' },
        { step: 'wsFromNotes', hot: null, did: 'Click Open, at the top of Notes.', see: 'The workspace opens on these notes, just for you, as Workspace at the top right would. Present brings everyone.' }
      ]
    },
    {
      id: 'more', n: 6, title: 'Everything else', blurb: 'The dock keeps what others notice. Everything else is in More, View or People.',
      frames: [
        { step: 'call', hot: 'dock.more', did: 'Click More.', see: 'Captions, marking a moment, catching up, breakout rooms and your devices.' },
        { step: 'moreOpen', hot: 'top.view', did: 'Click View, at the top right.', see: 'Your layout, for your screen alone.' },
        { step: 'viewOpen', hot: 'top.people', did: 'Click the faces.', see: 'Auto, Speaker or Grid, how people sit beside what’s open, and where you see yourself.' },
        { step: 'peopleOpen', hot: null, did: 'People opens on your side.', see: 'Who’s here and who’s asking to join. The organizer starts breakout rooms here too.' },
        { step: 'priyaScreenQuiet', hot: 'frame.menu:screen', did: 'As the organizer, click the name of Priya’s share.', see: 'Priya’s bar has Close for you, like anyone’s.' },
        { step: 'priyaScreenMenu', hot: 'frame.stop:screen', did: 'Stop it for everyone is in its menu.', see: 'Only the organizer has it, apart from Close.' }
      ]
    },
    {
      id: 'phone', n: 7, phone: true, title: 'On a phone', blurb: 'Board and Workspace come first in More. The rest works the same way.',
      frames: [
        { step: 'pCall', hot: 'dock.more', did: 'Tap More.', see: 'Chat and the people are at the top; everything else is in More.' },
        { step: 'pMore', hot: 'more.ws', did: 'Board and Workspace come first.', see: 'Then Notes, Chat and People. Tap Workspace.' },
        { step: 'pWsOpen', hot: 'frame.present:ws', did: 'It opens just for you, under the faces.', see: 'Present brings everyone with you.' },
        { step: 'pWsPresent', hot: 'frame.close:ws', did: 'Tap Present.', see: 'Everyone follows you.' },
        { step: 'pWsCloseMenu', hot: null, did: 'Tap Close.', see: 'For you, or for everyone, as a sheet.' },
        { step: 'pPriyaWs', hot: null, did: 'When Priya presents the workspace.', see: 'You follow Priya. Unfollow and Close are on the bar.' }
      ]
    }
  ];
  NC.journey = function (id) { return NC.JOURNEYS.filter(function (j) { return j.id === id; })[0] || NC.JOURNEYS[0]; };
})();
