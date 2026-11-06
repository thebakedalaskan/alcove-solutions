/*
 * One entry per moment of the product. `view` is what fills the stage; `b` is the board (paper.js).
 * Cursors are [who, x, y, 'talk' | 'type'] in board coordinates.
 */
window.AS = (function () {
  var P = window.WB.PEOPLE, R = window.WB.ROOMS, IC = window.IC;
  var ALL = ['art', 'priya', 'theo', 'kofi', 'maya', 'lena', 'sam'];
  var IDS = ['dockBoard', 'dockRooms', 'dockHand', 'leave', 'tplBlank', 'tplRetro', 'tplIdeas', 'tplFlow', 'rec0', 'letIn', 'notThem', 'btile', 'goTo', 'followIt', 'segEach', 'segShared', 'openRooms', 'bringBack', 'presNext', 'presStop', 'noteBoard', 'phAdd', 'phPut', 'divider', 'shareTile', 'shareMore', 'shareBig', 'shareShot', 'btile2'];
  var ME = { art: 'You', priya: 'You' };
  function ground(id) {
    var bg = P[id].bg, n = parseInt(bg.slice(1), 16);
    return 'radial-gradient(70% 55% at 22% 0%, rgba(255,226,196,.16), transparent 70%), radial-gradient(90% 75% at 50% 32%, rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',.32), transparent 72%), linear-gradient(180deg, #24204A, #16132F)';
  }
  function X(a, b) { return Object.assign({}, a, b); }

  /* The retro, as it fills up */
  var notes1 = ['w1'], notes2 = ['w1', 'w2', 'w3', 'f1', 'f3', 'a1'];
  var CUR = [['priya', 575, 214, 'talk'], ['theo', 118, 332], ['kofi', 590, 416], ['maya', 950, 90], ['lena', 300, 470]];
  var FULL = { board: 'retro', links: [], cursors: CUR };
  var LINKED = { board: 'retro', links: [{ id: 'l1', a: 'f1', b: 'a1' }], cursors: CUR };
  var DONE = { board: 'retro', cursors: CUR };

  /* Something's on the stage for everyone: the call with the board open */
  function call(b, o) { return X({ view: 'board', b: b, dockBoard: true }, o || {}); }
  function room(k, b, o) {
    var r = R[k];
    return X({ view: 'board', b: X({ board: r.id, title: r.name + ' board', seal: 'Sealed to this room', acts: true, pill: { icon: 'door', b: r.name, t: '9:12' } }, b || {}), ppl: r.who.slice(), room: r.name, as: r.who[0], count: r.who.length, dockBoard: true, noHost: true }, o || {});
  }
  var TIMER = { x: 836, y: 60, hd: 'Timer', sub: 'Everyone sees it count down. It chimes softly at the end.', opts: ['3 min', '5 min', '10 min'], on: 1, go: 'Start' };
  var VOTE = { x: 836, y: 60, hd: 'Vote on Could improve', sub: 'Everyone gets 3 votes. Nobody sees the count until you end it.', opts: ['3 votes', '5 votes', '10 votes'], on: 0, go: 'Start the vote' };
  var SEAL = { x: 12, y: 62, hd: 'Sealed to this room', rows: [['lock', 'Only the people in Comms can see this board.'], ['door', 'When rooms close it comes back to the main room, and everyone in the call sees it.'], ['sealed', 'Alcove can’t read it, then or later.']] };
  var SEAL_MAIN = { x: 12, y: 62, hd: 'Sealed', rows: [['lock', 'Everyone in this call can add to it. Saved in Product.'], ['notes', 'The notes read it in confidential compute.'], ['sealed', 'Alcove can’t read it.']] };
  var TITLE = { x: 12, y: 62, items: [['pen', 'Rename'], ['folderOpen', 'Saved in Product'], ['people', 'Who can add to it'], ['x', 'Close for everyone']] };
  var MORE = { x: 836, y: 60, items: [['link', 'Copy link'], ['download', 'Download as an image'], ['fileText', 'Download as a PDF'], ['sun', 'Night board']] };
  var HEARD = [
    ['priya', 'The changelog should go out before the post, not after.', 'Priya, 2 min ago'],
    ['kofi', 'Let’s check staging the day before every launch.', 'Kofi, 1 min ago'],
    ['maya', 'Someone has to own the status page on the day.', 'Maya, just now']
  ];
  var H_ADDED = [
    { id: 'h1', k: 'note', c: 'rose', t: 'Changelog goes out before the post', by: 'priya', x: 420, y: 360, w: 150, h: 150, f: 'fix' },
    { id: 'h2', k: 'note', c: 'sky', t: 'Check staging the day before', by: 'kofi', x: 990, y: 190, w: 150, h: 150, f: 'act' },
    { id: 'h3', k: 'note', c: 'sky', t: 'Name a status page owner', by: 'maya', x: 990, y: 360, w: 150, h: 150, f: 'act' }
  ];

  var PH = { board: 'wall', focus: 'wroom3', chrome: false, page: true, hide: ['wroom3next1'], cursors: [['lena', 856, 318]], pill: { icon: 'door', b: 'Support', t: '6:40' } };
  var POP = { TIMER: TIMER, VOTE: VOTE, SEAL_MAIN: SEAL_MAIN, TITLE: TITLE, MORE: MORE };
  /* A shared screen beside the board */
  var SC_NOTES = ['w1', 'w2', 'f3', 'f1', 'a1'];
  var SHOT = { id: 'shot1', k: 'shot', f: 'fix', t: 'Priya’s screen, 10:42', x: 420, y: 190, w: 320, h: 228 };
  var SC = { board: 'retro', show: SC_NOTES, links: [], focus: ['fix', 'act'], cursors: [['kofi', 560, 110, 'type'], ['maya', 950, 110]] };
  var SC2 = X(SC, { add: [SHOT], cursors: [['kofi', 660, 330, 'talk'], ['maya', 950, 110]] });
  var N = {
    /* The stage before anything */
    stage: { view: 'grid', speak: 'priya' },
    open: { view: 'grid', speak: 'priya', launcher: true },
    /* Open a board */
    b0: call({ board: 'retro', show: [], isNew: true, spot: { on: 'well', label: 'Double-click in Went well' }, cursors: [] }, { toast: ['presentation', 'Everyone here can add to this board.'] }),
    b1: call({ board: 'retro', show: ['w1'], edit: 'w1', typed: { w1: 'Beta sign-ups beat the plan' }, sel: ['w1'], ctx: false, handles: false, pop_: ['w1'], cursors: [['priya', 520, 140], ['theo', 150, 300]] }),
    b2: call({ board: 'retro', show: notes2, links: [], pop_: ['w2', 'w3', 'f1', 'f3', 'a1'], stagger: true, cursors: [['priya', 610, 214, 'type'], ['theo', 118, 332, 'type'], ['maya', 950, 90], ['kofi', 590, 416]] }),
    /* Working together */
    full: call(FULL, { speak: 'priya' }),
    fullHot: call(X(FULL, { spot: { on: 'f1', label: 'Priya’s sticky' } }), { speak: 'priya' }),
    sel: call(X(FULL, { sel: ['f1'], spot: { on: 'f1', dot: true, label: 'Drag from this dot' } }), { speak: 'priya' }),
    draft: call(X(FULL, { sel: ['f1'], ctx: false, draft: { from: 'f1', to: [812, 112] }, spot: { on: 'a1', label: 'Drop it here' } }), { speak: 'priya' }),
    linked: call(LINKED, { speak: 'priya' }),
    tile: call(LINKED, { speak: 'priya', tileMenu: 'priya' }),
    follow: call(X(LINKED, { focus: 'fix', clear: true, follow: 'priya', cursors: [['priya', 640, 332, 'talk']], pill: { icon: 'eye', b: 'Following Priya', act: 'Stop' }, acts: false }), { speak: 'priya' }),
    free: call(X(DONE, { glide: true }), { speak: 'kofi', toast: ['eye', 'Back to your own view.'] }),
    /* The call helps */
    heard0: call(X(DONE, { heard: 3, cursors: CUR.slice(1) }), { speak: 'maya' }),
    heard1: call(X(DONE, { tray: HEARD, cursors: CUR.slice(1) }), { speak: 'maya' }),
    heard2: call(X(DONE, { add: H_ADDED, pop_: ['h1', 'h2', 'h3'], stagger: true, cursors: CUR.slice(1), hide: ['w5'] }), { speak: 'maya', toast: ['waveform', 'Added 3 stickies from the call.', 'Undo'] }),
    ideas0: call({ board: 'ideas', sel: ['i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7', 'i8', 'i9'], handles: false, cursors: [] }, { speak: 'theo' }),
    ideas1: call({ board: 'ideas', sorted: true, glide: true, cursors: [] }, { speak: 'theo', toast: ['group', 'Sorted into 3 themes.', 'Undo'] }),
    /* Timer and votes */
    timer0: call(X(DONE, { pop: TIMER }), { speak: 'priya' }),
    timer1: call(X(DONE, { pill: { icon: 'timer', t: '4:59', text: 'Add your stickies', act: 'Stop' } }), { speak: 'priya' }),
    vote0: call(X(DONE, { pop: VOTE, focus: 'fix', clear: true }), { speak: 'kofi' }),
    vote1: call(X(DONE, { focus: 'fix', clear: true, pill: { icon: 'vote', b: 'Voting', text: '2 of 3 votes left', act: 'End the vote' }, dots: { f1: 1 }, spot: { on: 'f2', label: 'Vote for this' }, cursors: [['kofi', 660, 430]] }), { speak: 'kofi' }),
    vote2: call(X(DONE, { focus: 'fix', clear: true, pill: { icon: 'vote', b: 'Results', text: '7 people voted', act: 'Done' }, votes: { f1: 6, f2: 5, f3: 2, f5: 4, f4: 1 }, top: ['f1', 'f2', 'f5'], muted: ['f3', 'f4'], cursors: [] }), { speak: 'art' }),
    /* Presenting */
    pres1: { view: 'present', b: { board: 'retro', only: 'well', chrome: false, cursors: [] }, pres: { pos: '1 of 3', note: 'Start with what we’d repeat. Thank Maya’s team for launch day.' }, next: 'fix', dockBoard: true, speak: 'art' },
    pres2: { view: 'present', b: { board: 'retro', only: 'fix', chrome: false, cursors: [] }, pres: { pos: '2 of 3', note: 'Ask Priya to take the changelog point.' }, next: 'act', dockBoard: true, speak: 'art' },
    aud1: call({ board: 'retro', only: 'well', chrome: false, clear: true, cursors: [['art', 180, 96]], pill: { icon: 'play', b: 'Art is presenting', act: 'Look around' } }, { as: 'priya', speak: 'art' }),
    aud2: call(X(DONE, { cursors: [['art', 180, 96, 'talk'], ['theo', 118, 332]], pill: { icon: 'play', b: 'Art is presenting', act: 'Back to Art' } }), { as: 'priya', speak: 'art' }),
    /* Someone else starts it */
    pstage: { view: 'grid', as: 'priya', speak: 'art', noHost: true },
    pboard: call({ board: 'retro', show: [], isNew: true, cursors: [['art', 180, 150, 'talk']] }, { as: 'priya', speak: 'art', noHost: true, toast: ['presentation', 'Art opened Launch retro. Everyone here can add to it.'] }),
    pfull: call(X(DONE, { cursors: CUR.slice(1).concat([['art', 180, 150, 'talk']]) }), { as: 'priya', speak: 'art', noHost: true }),
    ptile: { view: 'grid', as: 'priya', speak: 'art', noHost: true, boardTile: true, mini: X(DONE, { cursors: [] }) },
    /* With a shared screen */
    sc0: { view: 'shared', speak: 'priya', share: true },
    sc1: { view: 'shared', speak: 'priya', share: true, launcher: true },
    sc2: call(X(SC, { show: [], isNew: true, cursors: [], spot: { on: 'fix', label: 'Double-click to add a sticky' } }), { share: true, speak: 'priya', toast: ['presentation', 'Everyone here can add to this board. Priya is still sharing.'] }),
    sc3: call(SC, { share: true, speak: 'priya' }),
    sc4: call(SC, { share: true, colW: 540, speak: 'priya' }),
    sc5: call(SC, { share: true, colW: 540, speak: 'priya', shareMenu: true }),
    sc6: call(X(SC2, { pop_: ['shot1'] }), { share: true, colW: 540, speak: 'kofi', toast: ['image', 'A picture of Priya’s screen is on the board. Priya can see that.'] }),
    sc7: { view: 'shared', share: true, boardCol: true, colW: 380, speak: 'priya', mini: X(SC2, { cursors: [], focus: undefined }) },
    sc8: call(SC2, { share: true, speak: 'kofi' }),
    /* An existing board */
    open2: { view: 'grid', speak: 'priya', launcher: true },
    access: { view: 'grid', speak: 'priya', launcher: true, askAccess: true },
    flow1: call({ board: 'flow', isNew: true, cursors: [['theo', 300, 60], ['aiko', 620, 280]] }, { toast: ['lock', 'Theo and Sam can open this board until the call ends.'], speak: 'art' }),
    flowNo: { view: 'noaccess', as: 'theo', speak: 'art', noHost: true, dockBoard: true },
    /* Closing it, and after the call */
    tmenu: call(X(DONE, { pop: TITLE }), { speak: 'art' }),
    closed: { view: 'grid', speak: 'art', toast: ['presentation', 'Launch retro is closed. It’s saved in Product.'] },
    note1: { s: 'note', note: { main: true, sum: 'The launch went well, and comms and staging need owners. Three follow-ups came off the board.' }, mini: X(DONE, { cursors: [], extra: '' }) },
    page1: { s: 'page', b: X(DONE, { page: true, cursors: [['priya', 575, 214], ['kofi', 980, 430]], acts: false }) },
    /* Breakout rooms: setting them up */
    rs0: call(DONE, { panel: 'setup', setup: 'none', speak: 'art', rooms: true }),
    rs1: call(DONE, { panel: 'setup', setup: 'each', speak: 'art', rooms: true }),
    rs2: call(DONE, { panel: 'setup', setup: 'shared', speak: 'art', rooms: true }),
    rl0: { view: 'rooms', panel: 'live', rooms: true, toast: ['door', '3 rooms are open. Each one has a board.'], speak: 'priya' },
    rl1: X(room(0, { board: 'room1', cursors: [['priya', 60, 92, 'talk'], ['theo', 480, 250]] }), { as: 'art', ppl: ['art', 'priya', 'theo'], panel: 'live', joined: 0, rooms: true, noHost: false, count: 3, toast: null }),
    rl2: { view: 'rooms', panel: 'live', rooms: true, speak: 'kofi' },
    /* In a room */
    ri0: call(X(DONE, { cursors: [] }), { as: 'priya', speak: 'art', noHost: true, toast: ['door', 'Art opened rooms. You’re going to Comms.'] }),
    ri1: room(0, { show: [], isNew: true, cursors: [['theo', 300, 180]] }),
    ri2: room(0, { show: [], cursors: [['theo', 300, 180]], pop: SEAL }),
    ri3: room(0, { show: ['room1what0', 'room1what1', 'room1why0'], cursors: [['theo', 300, 180, 'type']], pop_: ['room1why0'] }, { toast: ['send', 'Art, to every room: Two minutes left'], speak: 'theo' }),
    ri4: room(0, { cursors: [['theo', 480, 250]], pill: { icon: 'door', b: 'Comms', t: '1:00', soon: true, text: 'This board comes back with you' } }, { speak: 'priya' }),
    ri5: room(0, { cursors: [['theo', 480, 250], ['art', 250, 80, 'talk']] }, { ppl: ['priya', 'theo', 'art'], count: 3, speak: 'art', toast: ['door', 'Art joined this room.'] }),
    /* In a room with no board */
    rn0: { view: 'grid', ppl: ['kofi', 'maya'], as: 'kofi', speak: 'maya', room: 'Staging', count: 2, noHost: true, roomPill: true },
    rn1: { view: 'grid', ppl: ['kofi', 'maya'], as: 'kofi', speak: 'maya', room: 'Staging', count: 2, noHost: true, launcher: true, inRoom: true },
    rn2: room(1, { board: 'blank', isNew: true, title: 'Staging board', cursors: [['maya', 420, 200]] }, { as: 'kofi' }),
    ri6: room(0, { show: ['room1what0', 'room1what1', 'room1why0'], focus: ['room1what', 'room1why', 'room1next'], cursors: [['theo', 300, 90]] }, { share: true, sharer: 'theo', speak: 'theo' }),
    /* Rooms close */
    rc0: room(0, { cursors: [['theo', 480, 250]], pill: { icon: 'door', b: 'Comms', t: '0:10', soon: true, text: 'Rooms close in 10 seconds' } }, { speak: 'priya' }),
    rc1: call({ board: 'wall', land: ['wroom1', 'wroom2', 'wroom3'], cursors: [], title: 'Launch retro' }, { toast: ['door', 'Everyone’s back. 3 boards came with you.'], speak: 'art' }),
    rc1b: call({ board: 'wall', cursors: [['priya', 180, 90], ['kofi', 560, 200], ['lena', 980, 330]] }, { speak: 'art' }),
    rc2: { view: 'present', b: { board: 'wall', only: 'wroom1', chrome: false, cursors: [] }, pres: { pos: '1 of 3', note: 'Priya and Theo report back.' }, next: 'wroom2', nextBoard: 'wall', dockBoard: true, speak: 'priya' },
    /* One board for everyone */
    sh0: call({ board: 'wall', hide: ['wroom1next0', 'wroom1next1', 'wroom1why1', 'wroom2next0', 'wroom2next1', 'wroom2why1', 'wroom3next0', 'wroom3next1', 'wroom3why1', 'wroom3why0'], cursors: [['priya', 100, 260, 'type'], ['theo', 270, 300], ['kofi', 500, 280], ['maya', 680, 150, 'type'], ['lena', 900, 90], ['sam', 1080, 300]], pill: { icon: 'door', b: '3 rooms on this board', t: '9:12' } }, { speak: 'art', rooms: true, ppl: ['art'], count: 7, shared: true }),
    sh1: call({ board: 'wall', focus: 'wroom1', clear: true, hide: ['wroom1next0', 'wroom1next1', 'wroom1why1'], cursors: [['theo', 270, 300, 'type']], pill: { icon: 'door', b: 'Comms', text: 'Everyone can see this board', t: '9:12' } }, { as: 'priya', ppl: ['priya', 'theo'], count: 2, room: 'Comms', noHost: true, speak: 'theo' }),
    sh2: call({ board: 'wall', cursors: [['priya', 180, 90], ['kofi', 560, 200], ['lena', 980, 330]], glide: true }, { toast: ['door', 'Everyone’s back. The board stays as it is.'], speak: 'art' }),
    /* Afterwards */
    note2: { s: 'note', note: { rooms: true, sum: 'Each room took one problem from the retro and came back with next steps. Every room’s notes and board are below.' } },
    page2: { s: 'page', b: { board: 'room1', page: true, title: 'Comms board', cursors: [], acts: false } },
    /* Phone */
    ph0: { s: 'phone', b: PH },
    ph1: { s: 'phone', b: PH, sheet: true },
    ph2: { s: 'phone', b: X(PH, { hide: [], pop_: ['wroom3next1'] }) },
    /* States */
    shareIn: call(X(DONE, { focus: ['fix', 'act'], cursors: [] }), { share: true, speak: 'priya', toast: ['screen', 'Priya started sharing. It’s beside the board.'] }),
    notesOpen: call(DONE, { panel: 'notes', speak: 'priya' }),
    capt: call(DONE, { speak: 'priya', caption: true }),
    reconnect: call(X(DONE, { seal: 'Reconnecting', sealIcon: 'wifiOff', pill: { icon: 'wifiOff', b: 'Reconnecting', text: 'Keep going. Your changes are safe here.' }, cursors: [] }), { speak: 'priya' }),
    failed: call(X(DONE, { seal: 'Not saved', sealIcon: 'cloudOff', pill: { icon: 'cloudOff', b: 'Couldn’t save', text: 'Your last 3 changes are only here.', act: 'Try again' }, cursors: [] }), { speak: 'priya' }),
    viewonly: call(X(DONE, { rail: false, seal: 'View only', sealIcon: 'eye', cursors: CUR }), { as: 'sam', speak: 'priya', noHost: true }),
    blank: call({ board: 'blank', cursors: [] }, { speak: 'art' }),
    anat: call(X(DONE, { sel: ['f2'], heard: 3, pill: { icon: 'timer', t: '4:12', text: 'Add your stickies', act: 'Stop' }, cursors: [['priya', 430, 470, 'talk'], ['theo', 118, 332], ['maya', 950, 90, 'type']] }), { speak: 'priya' }),
    sandbox: call({ board: 'retro' }, { speak: 'priya' })
  };

  function vals(self) {
    var p = self.props, hot = p.hot || '', phone = p.phone === true || p.phone === 'true', dark = p.dark === true || p.dark === 'true', live = p.live === true || p.live === 'true';
    var n = N[p.node] || N.stage;
    var fire = function (id) { return function (e) { if (e && e.preventDefault) e.preventDefault(); if (p.onGo) p.onGo(id); }; };
    var h = {}, c = {};
    IDS.forEach(function (id) { h[id] = hot === id ? 'is-hot' : ''; c[id] = fire(id); });
    var as = n.as || 'art';
    var state = self.state || {};
    var speak = live ? (state.speak || 'priya') : n.speak;
    var ppl = (n.ppl || ALL).slice();
    if (ppl.indexOf(as) > 0) { ppl.splice(ppl.indexOf(as), 1); ppl.unshift(as); }
    var tiles = ppl.map(function (id) {
      var talk = speak === id, me = id === as;
      return { id: id, name: me ? 'You' : P[id].name, ground: ground(id), talk: talk, cls: talk ? 'is-speaking' : '', hot: hot === 'tile:' + id ? 'is-hot' : '', go: live ? function () { if (id !== as) self.setState({ tm: state.tm === id ? '' : id }); } : fire('tile:' + id) };
    });
    var panel = n.panel || '';
    var isBoard = n.view === 'board', isPresent = n.view === 'present', noAcc = n.view === 'noaccess';
    var isShared = n.view === 'shared';
    var shareOn = live ? !!p.share : !!n.share;
    var hasCol = shareOn;
    var colW = (live && state.colW) || n.colW || (isShared && !n.boardCol ? 423 : 420);
    var strip = (isBoard || isPresent || n.view === 'noaccess') && !n.noStrip && !hasCol;
    var chromeOn = isBoard && !(n.b && n.b.chrome === false) && !(n.b && n.b.rail === false);
    var pw = 1280 - 24 - (strip ? 142 : 0) - (panel ? 382 : 0) - (hasCol ? colW + 20 : 0) - (chromeOn ? 62 : 0), ph = 800 - 52 - 74;
    var boxW = 1256 - colW - 20;
    if (n.caption) ph -= 94;
    if (isPresent) { pw = 1280 - 24 - 142 - 258; ph = 674 - 54; }
    if (phone) { pw = 374; ph = 844 - 50 - 72 - 74; }
    if (n.s === 'page') { pw = 1280; ph = 800; }
    var paper = X(n.b || {}, dark ? { theme: 'dark' } : {});
    if (n.s === 'phone') paper = X(paper, { chrome: false });
    if (live) paper = X(paper, { liveBoard: true });
    var toast = n.toast ? { d: IC[n.toast[0]], t: n.toast[1], act: n.toast[2] || '', hasAct: !!n.toast[2] } : null;
    var pres = n.pres || { pos: '', note: '' };
    var nextBoard = n.nextBoard || 'retro';
    var setup = { none: n.setup === 'none' ? 'true' : 'false', each: n.setup === 'each' ? 'true' : 'false', shared: n.setup === 'shared' ? 'true' : 'false', isEach: n.setup === 'each', isShared: n.setup === 'shared' };
    var setupRooms = R.map(function (r) { return { name: r.name, n: r.who.length, people: r.who.map(function (w) { return { id: w, name: P[w].name }; }) }; });
    var liveRooms = R.map(function (r, k) {
      var here = n.joined === k;
      return { name: r.name, cls: here ? 'is-here' : '', label: here ? 'Back to main room' : 'Join room', btn: 'is-secondary', hot: hot === 'join:' + k ? 'is-hot' : hot === 'back:' + k ? 'is-hot' : '', go: fire(here ? 'back:' + k : 'join:' + k), line: here ? 'You’re here, so you can see it' : 'On the board now. Join to see it.', who: r.who.join(','), names: r.who.map(function (w) { return P[w].name; }).join(', ') };
    });
    var roomsView = R.map(function (r) {
      return { name: r.name, left: '9:12', n: r.who.length, board: 'On their board. Join to see it.', tiles: r.who.map(function (w) { var talk = speak === w; return { id: w, name: P[w].name, ground: ground(w), talk: talk, cls: talk ? 'is-speaking' : '' }; }) };
    });
    var noteRooms = R.map(function (r, k) {
      return { name: r.name, line: r.rows[2][0] + '. ' + r.who.map(function (w) { return P[w].name; }).join(', ') + ' were here.', mini: { board: r.id, chrome: false, mini: true, cursors: [] }, hot: hot === 'nroom:' + k ? 'is-hot' : '', go: fire('nroom:' + k) };
    });
    var menuFor = live ? state.tm : n.tileMenu;
    var tmIdx = ppl.indexOf(menuFor);
    if (live) {
      c.shareMore = function () { self.setState({ sm: !state.sm }); };
      c.shareShot = function () { self.setState({ sm: false, shot: 's' + Date.now() }); };
      c.shareBig = function () { self.setState({ sm: false }); };
      c.goTo = function () { self.setState({ tm: '', jump: state.tm + ':' + Date.now() }); };
      c.followIt = function () { self.setState({ tm: '', follow: state.tm }); };
    }
    return {
      theme: dark ? 'dark' : 'light', frCls: phone || n.s === 'phone' ? 'is-phone' : '', csCls: (isBoard || isPresent || noAcc ? 'on-board ' : '') + (n.caption ? 'has-cap' : ''),
      isCall: !n.s || n.s === 'call', isNote: n.s === 'note', isPage: n.s === 'page', isPhone: n.s === 'phone',
      title: 'Launch retro', clock: n.clock || '31:12', count: n.count || ppl.length, facesWho: ppl.slice(0, 5).join(','),
      room: n.room || '', hasRoom: !!n.room,
      isGrid: n.view === 'grid', isBoard: isBoard, isRooms: n.view === 'rooms', isPresent: isPresent, isNoAccess: n.view === 'noaccess',
      gridCls: n.boardTile ? 'with-board' : 'n' + ppl.length, boardTile: !!n.boardTile, tileScale: 0.566, miniModel: X(n.mini || {}, { mini: true, chrome: false }),
      tiles: tiles, showStrip: strip,
      sharer: n.sharer || 'priya', sharerName: P[n.sharer || 'priya'].name, isShared: isShared, hasCol: hasCol, colShare: shareOn && !isShared, colBoard: !!n.boardCol, colCols: ppl.length <= 3 ? 2 : colW >= 500 ? 4 : isShared && !n.boardCol ? 2 : 3,
      boxCls: hasCol ? 'is-sized' : '', boxStyle: hasCol ? 'width: ' + boxW + 'px' : '',
      scr: isShared ? { w: boxW, h: Math.round(boxW * 10 / 16), k: Math.round(boxW / 640 * 1000) / 1000 } : { w: colW, h: Math.round(colW * 10 / 16), k: Math.round(colW / 640 * 1000) / 1000 },
      colBH: Math.round(colW * 674 / 1114), colBK: Math.round(colW / 1114 * 1000) / 1000,
      showShareMenu: live ? !!state.sm : !!n.shareMenu, smX: 1268 - colW - 180 + colW - 40, smY: 112,
      hasCaption: !!n.caption, isNotes: panel === 'notes',
      divDown: live ? function (e) { self._dv = { x: e.clientX, w: colW, k: e.currentTarget.getBoundingClientRect().width / 24 || 1 }; e.currentTarget.setPointerCapture(e.pointerId); } : undefined,
      divMove: live ? function (e) { var d = self._dv; if (d) self.setState({ colW: Math.max(300, Math.min(760, d.w - (e.clientX - d.x) / d.k)) }); } : undefined,
      divUp: live ? function () { self._dv = null; } : undefined,
      liveShot: state.shot || '',
      paper: paper, pw: pw, ph: ph, hot: hot, go: p.onGo, live: live, liveFollow: state.follow || '', liveJump: state.jump || '', onLive: live ? function (s) { self.setState(s); } : undefined,
      pres: pres, presNext: { board: nextBoard, only: n.next, chrome: false, cursors: [], mini: true },
      rooms: roomsView, setup: setup, setupRooms: setupRooms, isSetup: panel === 'setup', isLive: panel === 'live', liveLeft: '9:12', liveRooms: liveRooms,
      boardOn: n.dockBoard ? 'is-on' : '', handOn: n.hand ? 'is-on' : '', roomsOn: n.rooms ? 'is-on' : '', hostDock: !n.noHost,
      showLauncher: !!n.launcher, launchX: -284, hasRecents: !n.askAccess && !n.inRoom, askAccess: !!n.askAccess,
      launchNote: n.inRoom ? 'Only this room sees it' : 'Opens for everyone here', launchFoot: n.inRoom ? 'Comes back with you when rooms close. Alcove can’t read it.' : 'Sealed. Alcove can’t read boards.',
      showTileMenu: !!menuFor, tmTop: 58 + tmIdx * 98, tmName: menuFor ? P[menuFor].name : '',
      toast: toast || { d: '', t: '', act: '', hasAct: false }, hasToast: !!toast,
      fxRise: p.fx === 'rise', fxMove: p.fx === 'move',
      note: n.note || { main: false, rooms: false, sum: '' }, noteRooms: noteRooms,
      phoneTiles: tiles.slice(0, 4), showPhoneAdd: !n.sheet, phoneSheet: !!n.sheet,
      h: h, c: c
    };
  }
  return { N: N, vals: vals, POP: POP };
})();
