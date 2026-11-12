/*
 * Notes in the call, rethought. What Notes, at the top right, opens on your side:
 * - its head: Notes, one pill for its state (Live, Paused, Off, Asked, Unavailable) that opens what's captured, Open and ×;
 * - four tabs: Notes, Transcript, Ask and Yours;
 * - the notes as they're written, coloured by kind as the note is afterwards: a short summary, Decided (rose diamonds),
 *   Follow-ups (horizon boxes anyone can tick) and what the call suggests (dashed, with Add and ×);
 * - a line at its foot, Note to self, with the bookmark beside it, on every tab but Ask, where it asks instead.
 * A bar under the tabs says what capture means only when it isn't simply live, with the one thing to do about it.
 * Everything the Notes, Card and Call boards draw for the notes comes from here: the notes, every moment a journey shows
 * (added to NC.STEPS), what each press does (NC.act) and the journeys. Demo people are made up.
 */
(function () {
  var NC = window.NC, I = NC.I, P = NC.P, first = NC.first;
  var cx = function () { return Array.prototype.slice.call(arguments).filter(Boolean).join(' '); };
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  var andList = function (ids) {
    var n = ids.map(first);
    return n.length < 2 ? (n[0] || '') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
  };

  /* ---------- what was said, and what the notes made of it ---------- */
  var LINES = [
    { id: 'l1', at: '16:03', who: 'priya', t: 'Sign-ups are back up since the pricing change, so I’d keep the 18th.' },
    { id: 'l1b', at: '16:04', who: 'art', t: 'Agreed. The launch holds for Wednesday the 18th.' },
    { id: 'l2', at: '16:07', who: 'kofi', t: 'Then I’ll take the status page, and keep it from now on.' },
    { id: 'l3', at: '16:09', who: 'aiko', t: 'I’ll move the empty arch into the kit by Thursday.' },
    { id: 'l4', at: '16:10', who: 'art', t: 'Good. And the changelog goes out before the post this time.' },
    { id: 'l5', at: '16:11', who: 'priya', t: 'Has anyone run the importer with a big team yet?' },
    { id: 'l6', at: '16:11', who: 'kofi', t: 'Not yet. Maya could try it on our own account on Monday.' },
    { id: 'l7', at: '16:12', who: 'priya', t: 'I’ll get the pricing page copy to legal as well.' }
  ];
  var LINE = {};
  LINES.forEach(function (l) { LINE[l.id] = l; });

  var N = NC.NN = {
    summary: 'Sign-ups are back up since the pricing change, so the launch holds for Wednesday 18 November. Kofi takes the status page from now on, and the changelog goes out before the launch post. Aiko moves the empty arch into the kit by Thursday, and Maya tries the importer on Vandelay’s own account on Monday.',
    decided: [
      { id: 'd1', t: 'The launch holds for Wednesday 18 November.', line: 'l1b' },
      { id: 'd2', t: 'The changelog goes out before the launch post from now on.', line: 'l4' }
    ],
    items: {
      a: { t: 'Own the status page from now on', who: 'kofi', due: 'Fri', line: 'l2' },
      b: { t: 'Move the empty arch into the kit', who: 'aiko', due: 'Thu', line: 'l3' },
      c: { t: 'Run the importer on Vandelay’s own account', who: 'maya', due: 'Mon', line: 'l6' },
      d: { t: 'Send the pricing page copy to legal', who: 'priya', due: '', line: 'l7' }
    },
    mine: {
      y1: { kind: 'note', t: 'Ask Maya how the importer test went', at: '16:10' },
      y2: { kind: 'note', t: 'Check the importer numbers with Maya before Monday', at: '16:13' }
    },
    draft: 'Check the importer numbers with Maya before Monday',
    chips: ['Catch me up', 'What did I miss?', 'Who’s doing what?'],
    answer: {
      range: 'The whole call, as of 16:12',
      points: [
        { mk: 'dia', t: 'The launch holds for 18 November.', line: 'l1b' },
        { mk: 'ck', t: 'Kofi owns the status page, by Friday.', line: 'l2' },
        { mk: 'ck', t: 'Aiko moves the empty arch into the kit by Thursday.', line: 'l3' },
        { mk: 'sug', t: 'Suggested: Maya runs the importer on Monday.', line: 'l6' }
      ]
    },
    invited: ['art', 'priya', 'kofi', 'aiko', 'maya']
  };

  /* The notes' own state, inside a moment. */
  var NN = { fol: ['a', 'b'], sug: ['c', 'd'], gone: [], ticked: [], allSug: false, marks: [], mine: ['y1'], draft: '', ask: null, q: '', kept: false, more: false, seek: null, adding: false };
  var nn = function (s) { return Object.assign({}, NN, s.nn || {}); };
  /* What's captured: on, paused, off or unavailable, whether notes were ever on, and who has asked. */
  var capOf = function (s) {
    return {
      cap: s.cap || 'on', ever: s.ever !== false, listen: !!s.listen, asks: s.asks || [], asked: s.asked || null, stale: !!s.stale,
      guest: !!s.guest, org: s.org !== false, host: s.org === false ? (s.host || 'priya') : s.me, at: s.capAt || '16:12', since: s.since || '16:02'
    };
  };
  NC.capOf = capOf;

  /* ---------- the moments a journey shows ---------- */
  var T = NC.NN_TOAST = {
    marked: { icon: 'bookmark', text: 'Bookmarked in Yours. Only you see it.', act: 'Open', actId: 'nn.tab:yours' },
    markedNow: { icon: 'bookmark', text: 'Marked this moment in Yours.', act: 'Open', actId: 'nn.tab:yours' },
    kept: { icon: 'lock', text: 'Kept in Yours. Only you see it.', act: 'Open', actId: 'nn.tab:yours' },
    keptAnswer: { icon: 'bookmark', text: 'Kept in Yours, with the times it came from.', act: 'Open', actId: 'nn.tab:yours' },
    added: { icon: 'listChecks', text: 'Added to the follow-ups, for everyone.', act: 'Undo', actId: 'nn.undo' },
    gone: { icon: 'x', text: 'Dismissed. It stays in the note’s suggestions.', act: 'Undo', actId: 'nn.undo' },
    paused: { icon: 'pause', text: 'Notes are paused. Everyone here can see that.' },
    resumed: { icon: 'play', text: 'Notes are on again. Everyone here can see that.' },
    off: { icon: 'notes', text: 'Notes are off. What was written is kept.' },
    on: { icon: 'notes', text: 'Notes are on. Everyone here can see that.' },
    asked: { icon: 'hand', text: 'You asked Priya for notes. Everyone here can see that.' },
    priyaOn: { icon: 'notes', text: 'Priya turned notes on. Everyone here can see that.' },
    notNow: { icon: 'check', text: 'Kofi was told not now.' }
  };
  Object.assign(NC.STEPS, {
    nOn: { side: 'notes', unread: 0 },
    nIdea: { side: 'notes', unread: 0, stale: true, nn: { fol: [], sug: ['a', 'b', 'c'] } },
    nListen: { side: 'notes', unread: 0, listen: true },
    nSeek: { side: 'notes', notesTab: 'transcript', unread: 0, nn: { seek: 'l1b' } },
    nLineMarked: { side: 'notes', notesTab: 'transcript', unread: 0, nn: { seek: 'l1b', marks: ['l2'] }, toast: T.marked },
    nYours: { side: 'notes', notesTab: 'yours', unread: 0, nn: { marks: ['l2'] } },
    nSugAdded: { side: 'notes', unread: 0, nn: { fol: ['a', 'b', 'c'], sug: ['d'] }, toast: T.added },
    nTicked: { side: 'notes', unread: 0, nn: { fol: ['a', 'b', 'c'], sug: ['d'], ticked: ['a'] } },
    nAdding: { side: 'notes', unread: 0, nn: { fol: ['a', 'b', 'c'], sug: ['d'], ticked: ['a'], adding: true } },
    nTyping: { side: 'notes', unread: 0, nn: { draft: 'Check the importer numbers with Maya before Monday' } },
    nKept: { side: 'notes', unread: 0, nn: { mine: ['y1', 'y2'] }, toast: T.kept },
    nMarkedNow: { side: 'notes', unread: 0, nn: { mine: ['y1', 'y2'], marks: ['l7'] }, toast: T.markedNow },
    nYoursAll: { side: 'notes', notesTab: 'yours', unread: 0, nn: { mine: ['y1', 'y2'], marks: ['l7'] } },
    nYoursEmpty: { side: 'notes', notesTab: 'yours', unread: 0, nn: { mine: [] } },
    nAsk: { side: 'notes', notesTab: 'ask', unread: 0 },
    nAskAnswer: { side: 'notes', notesTab: 'ask', unread: 0, nn: { ask: 'answer', q: 'Catch me up' } },
    nAskKept: { side: 'notes', notesTab: 'ask', unread: 0, nn: { ask: 'answer', q: 'Catch me up', kept: true }, toast: T.keptAnswer },
    nCard: { side: 'notes', unread: 0, pop: 'card:pill' },
    nCardOther: { side: 'notes', unread: 0, org: false, pop: 'card:pill' },
    nPaused: { side: 'notes', unread: 0, cap: 'paused', toast: T.paused },
    nPausedQuiet: { side: 'notes', unread: 0, cap: 'paused' },
    nPausedOther: { side: 'notes', unread: 0, cap: 'paused', org: false },
    nPausedCard: { side: 'notes', unread: 0, cap: 'paused', pop: 'card:pill' },
    nResumed: { side: 'notes', unread: 0, toast: T.resumed },
    nOffOrg: { side: 'notes', unread: 0, cap: 'off', ever: false },
    nOffKept: { side: 'notes', unread: 0, cap: 'off' },
    nOffOther: { side: 'notes', unread: 0, org: false, cap: 'off', ever: false },
    nAsked: { side: 'notes', unread: 0, org: false, cap: 'off', ever: false, asked: 'asking', toast: T.asked },
    nRequested: { side: 'notes', unread: 0, cap: 'off', ever: false, asks: ['kofi', 'aiko'] },
    nRequestedCard: { side: 'notes', unread: 0, cap: 'off', ever: false, asks: ['kofi', 'aiko'], pop: 'card:pill' },
    nPriyaAsked: { side: 'notes', unread: 0, me: 'priya', cap: 'off', ever: false, asks: ['art'], people: ['priya', 'art', 'kofi', 'aiko'] },
    nOnFromAsk: { side: 'notes', unread: 0, org: false, listen: true, toast: T.priyaOn },
    nListenOrg: { side: 'notes', unread: 0, listen: true, toast: T.on },
    nUnavailable: { side: 'notes', unread: 0, org: false, cap: 'unavailable' },
    nStale: { side: 'notes', unread: 0, stale: true },
    nGuest: { side: 'notes', unread: 0, org: false, guest: true, nn: { mine: [] } },
    nLight: { side: 'notes', unread: 0, theme: 'light' },
    nSign: { pop: 'card:sign' },
    nSignOther: { pop: 'card:sign', org: false },
    pNotesN: { phone: true, side: 'notes', unread: 0 },
    pTranscript: { phone: true, side: 'notes', notesTab: 'transcript', unread: 0 },
    pCardN: { phone: true, side: 'notes', unread: 0, pop: 'card:pill' }
  });

  /* ---------- what each press does ---------- */
  var act0 = NC.act;
  var pull = function (list, id) { return list.filter(function (x) { return x !== id; }); };
  NC.act = function (s0, id) {
    var str = String(id), k = str.indexOf(':'), a = k < 0 ? str : str.slice(0, k), arg = k < 0 ? '' : str.slice(k + 1);
    var mine = a.indexOf('nn.') === 0 || a.indexOf('card.') === 0 || a === 'top.sign';
    if (!mine) {
      var r = act0(s0, id);
      /* Notes, from More or the top right, always opens on what you last looked at, with nothing open over it. */
      if (r.side !== 'notes' && r.pop && r.pop.indexOf('card:pill') === 0) r.pop = null;
      return r;
    }
    var s = clone(s0), was = s.toast;
    s.hot = null; s.toast = null;
    var n = s.nn = nn(s);
    var c = capOf(s);
    var lastUndo = s.undo || null;
    s.undo = null;
    switch (a) {
      case 'top.sign': s.pop = s.pop === 'card:sign' ? null : 'card:sign'; break;
      case 'nn.pill': s.pop = s.pop === 'card:pill' ? null : 'card:pill'; break;
      case 'nn.close': s.pop = null; s.side = null; break;
      case 'nn.open': s.pop = null; return act0(s, 'notes.open');
      case 'nn.tab': s.notesTab = arg; s.pop = null; if (arg !== 'transcript') n.seek = null; break;
      case 'nn.seek': s.notesTab = 'transcript'; n.seek = arg; break;
      case 'nn.more': n.more = !n.more; break;
      case 'nn.allSug': n.allSug = !n.allSug; break;
      case 'nn.mark':
        if (n.marks.indexOf(arg) >= 0) { n.marks = pull(n.marks, arg); s.toast = { icon: 'bookmark', text: 'Bookmark taken out of Yours.' }; }
        else { n.marks = n.marks.concat([arg]); s.toast = T.marked; }
        break;
      case 'nn.markNow': if (n.marks.indexOf('l7') < 0) n.marks = n.marks.concat(['l7']); s.toast = T.markedNow; break;
      case 'nn.focus': if (!n.draft) n.draft = N.draft; break;
      case 'nn.type': n.draft = decodeURIComponent(arg); s.toast = was; break;
      case 'nn.send':
        if (!n.draft) break;
        if (n.draft === N.draft) n.mine = n.mine.concat(['y2']);
        else { N.mine['t' + n.mine.length] = { kind: 'note', t: n.draft, at: '16:13' }; n.mine = n.mine.concat(['t' + n.mine.length]); }
        n.draft = ''; s.toast = T.kept; break;
      case 'nn.tick': n.ticked = n.ticked.indexOf(arg) >= 0 ? pull(n.ticked, arg) : n.ticked.concat([arg]); break;
      case 'nn.sugAdd': s.undo = { kind: 'add', id: arg }; n.sug = pull(n.sug, arg); n.fol = n.fol.concat([arg]); s.toast = T.added; break;
      case 'nn.sugNo': s.undo = { kind: 'no', id: arg }; n.sug = pull(n.sug, arg); n.gone = n.gone.concat([arg]); s.toast = T.gone; break;
      case 'nn.undo':
        if (lastUndo && lastUndo.kind === 'add') { n.fol = pull(n.fol, lastUndo.id); n.sug = [lastUndo.id].concat(n.sug); }
        if (lastUndo && lastUndo.kind === 'no') { n.gone = pull(n.gone, lastUndo.id); n.sug = [lastUndo.id].concat(n.sug); }
        break;
      case 'nn.add': n.adding = !n.adding; break;
      case 'nn.addDone': n.adding = false; break;
      case 'nn.chip': n.ask = 'answer'; n.q = N.chips[+arg] || N.chips[0]; n.kept = false; break;
      case 'nn.askSend': n.ask = 'answer'; n.q = n.draft || N.chips[0]; n.draft = ''; n.kept = false; break;
      case 'nn.askNew': n.ask = null; n.q = ''; n.kept = false; break;
      case 'nn.keep': n.kept = true; s.toast = T.keptAnswer; break;
      /* The organizer's controls, and anyone else's ask. */
      case 'card.pause': s.cap = 'paused'; s.pop = null; s.toast = T.paused; break;
      case 'card.resume': s.cap = 'on'; s.pop = null; s.toast = T.resumed; break;
      case 'card.off': s.cap = 'off'; s.ever = true; s.pop = null; s.toast = T.off; break;
      case 'card.on':
        if (!c.ever) s.listen = true;
        s.cap = 'on'; s.ever = true; s.asks = []; s.pop = null; s.toast = T.on; break;
      case 'card.ask': s.asked = 'asking'; s.pop = null; s.toast = { icon: 'hand', text: 'You asked ' + first(c.host) + ' for notes. Everyone here can see that.' }; break;
      case 'card.takeBack': s.asked = null; s.toast = { icon: 'hand', text: 'Your ask is taken back.' }; break;
      case 'card.notNow': s.asks = pull(c.asks, arg); s.toast = { icon: 'check', text: first(arg) + ' was told not now.' }; break;
      case 'card.notNowAll': s.asks = []; s.toast = { icon: 'check', text: andList(c.asks) + ' were told not now.' }; break;
      default: s.toast = was; break;
    }
    return s;
  };

  /* ---------- the top bar's sign: the same for everyone ---------- */
  NC.signView = function (s, on) {
    var c = capOf(s), hot = function (id) { return s.hot === id ? 'is-hot' : ''; };
    var asked = c.cap === 'off' && c.asks.length > 0;
    var k = c.cap === 'on' ? { cls: '', label: 'Notes on', dot: true }
      : c.cap === 'paused' ? { cls: 'is-paused', label: 'Notes paused', icon: 'pause' }
        : c.cap === 'unavailable' ? { cls: 'is-caution', label: 'Notes unavailable', icon: 'alert' }
          : asked ? { cls: 'is-ask', label: 'Notes requested', dot: true }
            : { cls: 'is-off', label: 'Notes off', icon: 'notes' };
    return {
      cls: cx('nc-sign', k.cls, s.pop === 'card:sign' && 'is-open', hot('top.sign')), label: k.label, dot: !!k.dot, hasIcon: !!k.icon, d: I[k.icon] || '',
      click: on('top.sign')
    };
  };

  /* ---------- what's captured: the card the pill and the sign open ---------- */
  NC.cardView = function (s, on) {
    var c = capOf(s), hot = function (id) { return s.hot === id ? 'is-hot' : ''; };
    var host = first(c.host), asked = c.cap === 'off' && c.asks.length > 0;
    var k = c.cap === 'on' ? { cls: '', label: 'Notes on', when: 'Since ' + c.since, dot: true }
      : c.cap === 'paused' ? { cls: 'is-paused', label: 'Notes paused', when: (c.org ? 'By you' : 'By ' + host) + ' at ' + c.at, icon: 'pause' }
        : c.cap === 'unavailable' ? { cls: 'is-caution', label: 'Notes unavailable', when: 'Since ' + c.at, icon: 'alert' }
          : c.org && asked ? { cls: 'is-ask', label: 'Notes requested', when: '', dot: true }
            : { cls: 'is-off', label: 'Notes off', when: c.ever ? 'Since ' + c.at : '', icon: 'notes' };
    var said = c.cap === 'on' ? 'What everyone says, you included, is recorded and transcribed, and the notes are written as people talk.' + (c.org ? '' : ' Only ' + host + ' can pause or turn them off.')
      : c.cap === 'paused' ? 'Nothing is recorded, transcribed or sent to the AI until ' + (c.org ? 'you resume.' : host + ' resumes.')
        : c.cap === 'unavailable' ? (c.org ? 'Your browser can’t listen right now, so nothing is captured until it can.' : host + '’s browser can’t listen right now, so nothing is captured until it can.')
          : c.org ? (c.ever ? 'Nothing new is recorded. What was written before is kept.' : 'Nothing from this call is recorded or written down.')
            : 'Nothing is recorded. Only ' + host + ' can turn notes on, and you can ask them to.';
    var btn = function (id, label, kind, icon) { return { label: label, cls: cx('nn-btn is-sm', 'is-' + kind, hot(id)), click: on(id), hasD: !!icon, d: I[icon] || '' }; };
    var acts = [];
    if (c.org) {
      if (c.cap === 'on') acts = [btn('card.pause', 'Pause notes', 'line', 'pause'), btn('card.off', 'Turn off', 'quiet')];
      else if (c.cap === 'paused') acts = [btn('card.resume', 'Resume notes', 'press', 'play'), btn('card.off', 'Turn off', 'quiet')];
      else if (c.cap === 'off' && asked) acts = [btn('card.on', 'Turn on notes', 'press'), btn('card.notNowAll', 'Not now', 'quiet')];
      else if (c.cap === 'off') acts = [btn('card.on', 'Turn on notes', 'press')];
    } else if (c.cap === 'off' || c.cap === 'paused') {
      acts = c.asked === 'asking' ? [btn('card.takeBack', 'Take back your ask', 'quiet')] : [btn('card.ask', c.cap === 'paused' ? 'Ask to resume' : 'Ask for notes', 'press', 'hand')];
    }
    var facts = [
      { d: I.sealed, t: 'Written in confidential compute. Alcove can’t read them.', hasFaces: false, faces: '', hasPick: false, pick: '' },
      { d: I.people, t: c.org ? 'They go to you and everyone invited.' : 'They go to everyone invited, you included.', hasFaces: true, faces: N.invited.join(','), hasPick: false, pick: '' }
    ];
    if (c.org) facts.push({ d: I.sparkles, t: 'Written by', hasFaces: false, faces: '', hasPick: true, pick: 'Alcove’s default model' });
    return {
      cls: cx('nk', s.pop === 'card:sign' && 'is-sign'), signCls: cx('nk-sign', k.cls), label: k.label, when: k.when, hasWhen: !!k.when, dot: !!k.dot, hasIcon: !!k.icon, d: I[k.icon] || '',
      said: said,
      hasAsks: c.org && asked, asks: c.asks.join(','), askText: andList(c.asks) + ' asked for notes.',
      hasAsked: !c.org && c.asked === 'asking', askedText: 'You asked ' + host + '.',
      acts: acts, hasActs: acts.length > 0, facts: facts,
      hasOpen: s.pop === 'card:sign' && s.side !== 'notes', openCls: cx('nk-open', hot('top.notes')), openClick: on('top.notes')
    };
  };
  /* Where the card opens: under the pill on your side, or under the sign at the top left. A phone has it as a sheet. */
  NC.cardPlace = function (s, v) {
    if (!s.pop || s.pop.indexOf('card:') !== 0) return { has: false, style: '', theme: '' };
    if (s.phone) return { has: true, style: '', theme: s.pop === 'card:pill' ? (s.theme === 'light' ? 'light' : 'dark') : 'dark' };
    if (s.pop === 'card:pill' && v.sideGeo) return { has: true, style: 'left: ' + (v.sideGeo.x + 14) + 'px; top: ' + (v.sideGeo.y + 50) + 'px', theme: s.theme === 'light' ? 'light' : 'dark' };
    return { has: true, style: 'left: 196px; top: 54px', theme: 'dark' };
  };

  /* ---------- the panel ---------- */
  NC.notesView = function (s, on) {
    var c = capOf(s), n = nn(s), hot = function (id) { return s.hot === id ? 'is-hot' : ''; };
    var host = first(c.host), tab = s.notesTab || 'notes';
    if (c.guest && tab === 'yours') tab = 'notes';
    var asked = c.cap === 'off' && c.asks.length > 0;
    var empty = c.cap === 'off' && !c.ever;
    var v = { I: I, phone: !!s.phone };

    /* The pill: the state in a word, and what's captured under it. */
    var pk = c.cap === 'on' ? { cls: '', label: 'Live', dot: true }
      : c.cap === 'paused' ? { cls: 'is-paused', label: 'Paused', icon: 'pause' }
        : c.cap === 'unavailable' ? { cls: 'is-caution', label: 'Unavailable', icon: 'alert' }
          : c.org && asked ? { cls: 'is-ask', label: c.asks.length + ' asked', dot: true }
            : { cls: 'is-off', label: 'Off', ring: true };
    v.pill = {
      cls: cx('nn-pill', pk.cls, s.pop === 'card:pill' && 'is-open', hot('nn.pill')), label: pk.label, dot: !!pk.dot, ring: !!pk.ring, hasIcon: !!pk.icon, d: I[pk.icon] || '',
      click: on('nn.pill'), aria: 'Notes ' + pk.label.toLowerCase() + '. What’s captured', expanded: s.pop === 'card:pill' ? 'true' : 'false'
    };
    v.openCls = cx('nn-ib', hot('nn.open')); v.openClick = on('nn.open');
    v.closeCls = cx('nn-ib', hot('nn.close')); v.closeClick = on('nn.close');

    var tabs = [['notes', 'Notes'], ['transcript', 'Transcript'], ['ask', 'Ask']].concat(c.guest ? [] : [['yours', 'Yours']]);
    v.tabs = tabs.map(function (t) { return { label: t[1], sel: tab === t[0] ? 'true' : 'false', cls: cx('nn-tab', hot('nn.tab:' + t[0])), click: on('nn.tab:' + t[0]) }; });
    v.isNotes = tab === 'notes'; v.isTranscript = tab === 'transcript'; v.isAsk = tab === 'ask'; v.isYours = tab === 'yours';

    var btn = function (id, label, kind, icon) { return { label: label, cls: cx('nn-btn is-sm', 'is-' + kind, hot(id)), click: on(id), hasD: !!icon, d: I[icon] || '' }; };
    /* The bar: what capture means right now, and the one thing to do about it. Only on Notes and Transcript, and only when it isn't simply live. */
    var bar = null;
    if (!empty && !c.listen) {
      if (c.cap === 'paused') bar = { cls: '', icon: 'pause', text: c.org ? 'Paused at ' + c.at + '. Nothing new is written until you resume.' : host + ' paused notes at ' + c.at + '. Nothing new is written until they resume.', btns: c.org ? [btn('card.resume', 'Resume', 'press', 'play')] : c.asked === 'asking' ? [] : [btn('card.ask', 'Ask to resume', 'line')] };
      else if (c.cap === 'off' && c.org && asked) bar = { cls: 'is-ask', faces: c.asks.join(','), text: andList(c.asks) + ' asked for notes.', btns: [btn('card.notNowAll', 'Not now', 'quiet'), btn('card.on', 'Turn on', 'press')] };
      else if (c.cap === 'off') bar = { cls: '', icon: 'notes', text: c.org ? 'Off since ' + c.at + '. What was written is kept.' : host + ' turned notes off at ' + c.at + '. What was written is kept.', btns: c.org ? [btn('card.on', 'Turn on', 'press')] : c.asked === 'asking' ? [] : [btn('card.ask', 'Ask for notes', 'line')] };
      else if (c.cap === 'unavailable') bar = { cls: 'is-caution', icon: 'alert', text: (c.org ? 'Your browser' : host + '’s browser') + ' can’t listen right now, so nothing new is captured. Notes pick up as soon as it can.', btns: [] };
    }
    v.hasBar = !!bar && (v.isNotes || v.isTranscript);
    bar = bar || { cls: '', icon: '', text: '', btns: [] };
    v.bar = { cls: cx('nn-bar', bar.cls), hasIcon: !!bar.icon, d: I[bar.icon] || '', hasFaces: !!bar.faces, faces: bar.faces || '', text: bar.text, btns: bar.btns, hasBtns: bar.btns.length > 0 };

    /* Empty: notes were never on, or they've only just started. */
    var e = null;
    if (empty) {
      if (c.org && asked) e = { icon: 'hand', title: andList(c.asks) + ' asked for notes', text: 'Nothing from this call is written down yet. Notes start from the moment you turn them on.', faces: c.asks.join(','), btns: [btn('card.notNowAll', 'Not now', 'quiet'), btn('card.on', 'Turn on notes', 'press')] };
      else if (c.org) e = { icon: 'notes', title: 'Notes are off', text: 'Nothing from this call is written down. Notes start from the moment you turn them on.', btns: [btn('card.on', 'Turn on notes', 'press')] };
      else if (c.asked === 'asking') e = { icon: 'hand', title: 'You asked ' + host + ' for notes', text: host + ' sees your ask, and so does everyone here. You’ll hear when they answer.', btns: [btn('card.takeBack', 'Take back your ask', 'quiet')] };
      else e = { icon: 'notes', title: 'Notes are off', text: 'Only ' + host + ' can turn them on. You can ask them to.', btns: [btn('card.ask', 'Ask for notes', 'press', 'hand')] };
    } else if (c.listen) {
      e = { icon: 'waveform', title: 'Listening', text: 'Decisions, follow-ups and a summary come in here as people talk, a minute or so behind.', btns: [], listening: true };
    }
    v.isEmpty = !!e && (v.isNotes || v.isTranscript || v.isAsk);
    e = e || { icon: '', title: '', text: '', btns: [] };
    if (v.isTranscript && empty) e = { icon: 'transcript', title: 'Nothing is transcribed', text: 'The transcript starts when notes are on.', btns: [] };
    if (v.isTranscript && c.listen) e = { icon: 'transcript', title: 'Nothing said yet', text: 'What’s said comes in here a few seconds later.', btns: [] };
    if (v.isAsk && (empty || c.listen)) e = { icon: 'sparkles', title: empty ? 'Ask works once notes are on' : 'Nothing to ask about yet', text: empty ? 'It answers from what’s been said, and nothing is said into the notes while they’re off.' : 'Ask about the call once something has been said.', btns: [] };
    v.empty = { d: I[e.icon] || '', title: e.title, text: e.text, btns: e.btns, hasBtns: e.btns.length > 0, hasFaces: !!e.faces, hasArch: !e.faces, faces: e.faces || '', listening: !!e.listening, cls: cx('nn-empty', e.listening && 'is-listening') };
    v.showNotes = v.isNotes && !v.isEmpty; v.showLines = v.isTranscript && !v.isEmpty; v.showAsk = v.isAsk && !v.isEmpty;

    /* The notes. */
    var seek = function (line) { return { at: LINE[line].at, cls: cx('nn-t', hot('nn.seek:' + line)), click: on('nn.seek:' + line) }; };
    v.guestLine = c.guest;
    v.sumCls = cx('nn-sum', n.more && 'is-open');
    v.summary = N.summary; v.moreLabel = n.more ? 'Show less' : 'Show all'; v.moreCls = cx('nn-more', hot('nn.more')); v.moreClick = on('nn.more');
    v.fresh = c.stale ? { cls: 'nn-fresh is-stale', text: 'Not updated since 16:12', writing: false, stale: true, tip: 'Alcove tries again on its own' }
      : c.cap === 'on' ? { cls: 'nn-fresh', text: 'Writing', writing: true, stale: false, tip: 'Written as people talk' }
        : { cls: 'nn-fresh', text: 'As of ' + c.at, writing: false, stale: false, tip: '' };
    v.decided = N.decided.map(function (d) { var t = seek(d.line); return { t: d.t, at: t.at, tCls: t.cls, seek: t.click }; });
    v.decCount = String(N.decided.length);
    var item = function (id) { return N.items[id]; };
    v.follow = n.fol.map(function (id) {
      var f = item(id), done = n.ticked.indexOf(id) >= 0, t = seek(f.line);
      return {
        t: f.t, who: f.who, name: first(f.who), due: f.due, hasDue: !!f.due, at: t.at, tCls: t.cls, seek: t.click,
        cls: cx('nn-row is-fol', done && 'is-done', s.undo && s.undo.id === id && s.undo.kind === 'add' && 'is-new'),
        ckCls: cx('nn-ck', done && 'is-done', c.guest && 'is-locked', hot('nn.tick:' + id)), tick: c.guest ? on('noop') : on('nn.tick:' + id),
        pressed: done ? 'true' : 'false', ckLabel: (done ? 'Not done: ' : 'Done: ') + f.t
      };
    });
    v.hasFollow = v.follow.length > 0; v.folCount = String(v.follow.length);
    var shown = n.allSug ? n.sug : n.sug.slice(0, 2);
    v.sug = shown.map(function (id) {
      var f = item(id), t = seek(f.line);
      return {
        t: f.t, who: f.who, name: first(f.who), due: f.due, hasDue: !!f.due, at: t.at, tCls: t.cls, seek: t.click,
        addCls: cx('nn-btn is-xs is-line', hot('nn.sugAdd:' + id)), add: on('nn.sugAdd:' + id),
        noCls: cx('nn-ib is-sm', hot('nn.sugNo:' + id)), no: on('nn.sugNo:' + id), noLabel: 'Dismiss: ' + f.t
      };
    });
    v.hasSug = n.sug.length > 0 && !c.guest; v.sugCount = String(n.sug.length);
    v.hasSugMore = n.sug.length > 2; v.sugMore = n.allSug ? 'Show fewer' : (n.sug.length - 2) + ' more suggested';
    v.sugMoreCls = cx('nn-more', hot('nn.allSug')); v.sugMoreClick = on('nn.allSug');
    v.noFollow = !v.hasFollow && !v.hasSug;
    v.canAdd = !c.guest; v.addCls = cx('nn-ib is-sm', n.adding && 'is-on', hot('nn.add')); v.addClick = on('nn.add');
    v.adding = n.adding && !c.guest;
    v.addDoneCls = cx('nn-btn is-xs is-line', hot('nn.addDone')); v.addDone = on('nn.addDone'); v.addCancel = on('nn.add');

    /* The transcript, from the top: each line a moment after it's said. A time pressed elsewhere lights its line. */
    v.lines = LINES.map(function (l, i) {
      var marked = n.marks.indexOf(l.id) >= 0, prev = LINES[i - 1];
      return {
        at: l.at, name: l.who === s.me ? first(l.who) + ' (you)' : first(l.who), t: l.t, head: !prev || prev.who !== l.who,
        cls: cx('nn-line', n.seek === l.id && 'is-lit', marked && 'is-marked'),
        markCls: cx('nn-bm', marked && 'is-on', hot('nn.mark:' + l.id)), mark: c.guest ? on('noop') : on('nn.mark:' + l.id), canMark: !c.guest,
        pressed: marked ? 'true' : 'false', markLabel: marked ? 'Take the bookmark out of Yours' : 'Bookmark this line in Yours, only you'
      };
    });
    v.talking = first('aiko') + ' is talking';
    v.liveTalk = c.cap === 'on';

    /* Ask. */
    v.askEmpty = !n.ask;
    v.chips = N.chips.map(function (t, i) { return { t: t, cls: cx('nn-chip', hot('nn.chip:' + i)), click: on('nn.chip:' + i) }; });
    v.hasAnswer = n.ask === 'answer';
    v.q = n.q || N.chips[0];
    v.range = N.answer.range;
    v.points = N.answer.points.map(function (p) { var t = seek(p.line); return { mkCls: 'nn-mk-' + p.mk, t: p.t, at: t.at, tCls: t.cls, seek: t.click }; });
    v.keepCls = cx('nn-btn is-xs', n.kept ? 'is-done' : 'is-line', hot('nn.keep')); v.keep = n.kept ? on('noop') : on('nn.keep');
    v.keepLabel = n.kept ? 'Kept in Yours' : 'Keep in Yours'; v.keepD = I[n.kept ? 'check' : 'bookmark'];
    v.askAgainCls = cx('nn-btn is-xs is-quiet', hot('nn.askNew')); v.askAgain = on('nn.askNew');

    /* Yours: what you wrote, marked and kept, in the order it happened. */
    var ys = [];
    n.mine.forEach(function (id) { var y = N.mine[id]; if (y) ys.push({ k: y.at, d: I.pen, mkCls: 'nn-ymk', t: y.t, hasSub: false, sub: '', at: y.at }); });
    n.marks.forEach(function (id) { var l = LINE[id]; ys.push({ k: l.at, d: I.bookmark, mkCls: 'nn-ymk is-mark', t: '“' + l.t + '”', hasSub: true, sub: first(l.who), at: l.at }); });
    if (n.kept) ys.push({ k: '16:12', d: I.sparkles, mkCls: 'nn-ymk is-ans', t: n.q || 'Catch me up', hasSub: true, sub: 'An answer from Ask, with 4 moments', at: '16:12' });
    ys.sort(function (x, y) { return x.k < y.k ? -1 : x.k > y.k ? 1 : 0; });
    v.yours = ys.map(function (y) { return Object.assign({}, y, { tCls: 'nn-t is-flat' }); });
    v.yoursEmpty = ys.length === 0;

    /* The foot: Note to self and the bookmark, or on Ask, asking. Nothing for someone with only the link. */
    var asking = v.isAsk;
    /* Your own notes go with the call's, so they start when notes do; Ask needs something said. */
    v.hasFoot = !empty && (!c.guest || asking);
    if (asking && c.listen) v.hasFoot = false;
    v.footAsk = asking;
    v.footLead = I[asking ? 'sparkles' : 'pen'];
    v.footPlaceholder = asking ? 'Ask about this call' : 'Note to self';
    v.footValue = asking ? '' : n.draft;
    v.footHasText = !asking && !!n.draft;
    v.footShowLock = !v.footHasText;
    v.footFieldCls = cx('nn-field', v.footHasText && 'has-text', hot('nn.focus'));
    v.sendCls = cx('nn-send', v.footHasText && 'is-ready', hot(asking ? 'nn.askSend' : 'nn.send')); v.sendClick = on(asking ? 'nn.askSend' : 'nn.send');
    v.hasMark = !asking && !c.guest && !empty;
    v.markCls = cx('nn-mark', hot('nn.markNow')); v.markClick = on('nn.markNow');
    v.focusClick = on('nn.focus');
    v.hasScope = asking;
    return v;
  };

  /* ---------- the journeys ---------- */
  NC.JOURNEYS = [
    {
      id: 'look', n: 1, title: 'Look at the notes', blurb: 'Notes, at the top right, opens the call’s notes on your side: a short summary, then what’s decided and the follow-ups, in the colours the note uses afterwards. Every time opens the transcript there.',
      frames: [
        { step: 'call', hot: 'top.notes', did: 'Click Notes, at the top right.', see: 'It opens on your side. Nobody else’s screen changes.' },
        { step: 'nOn', hot: 'nn.seek:l1b', did: 'The notes, as they’re written.', see: 'Live, beside Notes, says they’re being taken. A short summary first, then Decided and Follow-ups.' },
        { step: 'nSeek', hot: 'nn.mark:l2', did: 'Click 16:04, beside a decision.', see: 'The transcript opens at that moment, its line lit.' },
        { step: 'nLineMarked', hot: 'toast.act', did: 'Point at a line and press its bookmark.', see: 'It’s kept in Yours, for you alone. The toast has Open.' },
        { step: 'nYours', hot: null, did: 'Click Open.', see: 'Yours: what you wrote, marked and kept. Only you see it.' }
      ]
    },
    {
      id: 'follow', n: 2, title: 'Follow-ups the call suggests', blurb: 'What the call suggests waits under the follow-ups as dashed rows, with who and when. Add puts it on everyone’s checklist; × dismisses it. No count to open, no filter on an empty list.',
      frames: [
        { step: 'nOn', hot: 'nn.sugAdd:c', did: 'Something to do is said in the call.', see: 'It waits under the list, dashed, with who and when, until someone adds it.' },
        { step: 'nSugAdded', hot: 'nn.tick:a', did: 'Click Add.', see: 'It’s on the checklist for everyone. The toast can undo it.' },
        { step: 'nTicked', hot: 'nn.add', did: 'Tick one when it’s done.', see: 'Done for everyone here, and in the notes at the end.' },
        { step: 'nAdding', hot: null, did: 'Click + to add one of your own.', see: 'One line, then who and when, in place.' }
      ]
    },
    {
      id: 'own', n: 3, title: 'Write something for yourself', blurb: 'Note to self sits at the foot of every tab, with the bookmark beside it. What goes in is kept under Yours, and only you see it.',
      frames: [
        { step: 'nOn', hot: 'nn.focus', did: 'Click Note to self, at the foot.', see: 'It’s on every tab but Ask. A lock says only you see it.' },
        { step: 'nTyping', hot: 'nn.send', did: 'Type, then press Enter.', see: 'Nothing goes into the call or onto anyone’s screen.' },
        { step: 'nKept', hot: 'nn.markNow', did: 'It’s kept in Yours.', see: 'The toast says where, with Open.' },
        { step: 'nMarkedNow', hot: 'nn.tab:yours', did: 'Press the bookmark, or B, when something matters.', see: 'The moment is marked with what was just said.' },
        { step: 'nYoursAll', hot: null, did: 'Click Yours.', see: 'Your note and the moment, in the order they happened.' }
      ]
    },
    {
      id: 'ask', n: 4, title: 'Catch up with Ask', blurb: 'Ask answers from what’s been said, each point with the time it was said. Only you see it, and Keep in Yours keeps an answer.',
      frames: [
        { step: 'nOn', hot: 'nn.tab:ask', did: 'Click Ask.', see: 'Its line at the foot asks instead of keeping a note.' },
        { step: 'nAsk', hot: 'nn.chip:0', did: 'Ask, or pick a question.', see: 'The whole call is read unless you choose a stretch of it.' },
        { step: 'nAskAnswer', hot: 'nn.keep', did: 'Click Catch me up.', see: 'What’s decided, who’s doing what and what’s suggested, each with its time.' },
        { step: 'nAskKept', hot: null, did: 'Click Keep in Yours.', see: 'Kept with your own notes, its times with it.' }
      ]
    },
    {
      id: 'pause', n: 5, title: 'Pause and resume, as the organizer', blurb: 'The pill beside Notes says the state in a word and opens what’s captured, with your Pause and Turn off. While paused, one line says so, with Resume.',
      frames: [
        { step: 'nOn', hot: 'nn.pill', did: 'You’re the organizer. Click Live.', see: 'The same card opens from the sign at the top left.' },
        { step: 'nCard', hot: 'card.pause', did: 'What’s captured opens under it.', see: 'One sentence, your Pause and Turn off, then how the notes are written and who gets them.' },
        { step: 'nPaused', hot: 'card.resume', did: 'Click Pause notes.', see: 'Everyone’s sign says paused. The notes so far stay, under one line with Resume.' },
        { step: 'nResumed', hot: null, did: 'Click Resume.', see: 'Live again, for everyone, and they’re told.' }
      ]
    },
    {
      id: 'off', n: 6, title: 'When notes are off', blurb: 'In someone else’s call, Notes says notes are off and who can turn them on, with Ask for notes. The organizer sees the ask in rose and turns notes on, or says not now.',
      frames: [
        { step: 'nOffOther', hot: 'card.ask', did: 'Priya’s call has notes off. Click Notes.', see: 'Only Priya can turn them on. Ask for notes is the one button.' },
        { step: 'nAsked', hot: null, did: 'Click Ask for notes.', see: 'Everyone sees you asked. You can take it back.' },
        { step: 'nPriyaAsked', hot: 'card.on', did: 'On Priya’s screen.', see: 'Her pill says 1 asked, in rose, and Notes has Not now and Turn on notes.' },
        { step: 'nOnFromAsk', hot: null, did: 'Priya turns notes on.', see: 'You’re told, and the notes start listening.' }
      ]
    },
    {
      id: 'phone', n: 7, phone: true, title: 'On a phone', blurb: 'Notes is in More. It comes up as a sheet, with the same pill, tabs and Note to self.',
      frames: [
        { step: 'pCall', hot: 'dock.more', did: 'Tap More.', see: 'Chat and the people stay at the top.' },
        { step: 'pMore', hot: 'more.side:notes', did: 'Tap Notes.', see: '' },
        { step: 'pNotesN', hot: 'nn.pill', did: 'The notes, as a sheet.', see: 'The same pill and tabs.' },
        { step: 'pCardN', hot: null, did: 'Tap Live.', see: 'What’s captured is a sheet too.' }
      ]
    }
  ];
  NC.journey = function (id) { return NC.JOURNEYS.filter(function (j) { return j.id === id; })[0] || NC.JOURNEYS[0]; };

  /* ---------- every state, for the States board ---------- */
  NC.NN_STATES = [
    { step: 'nOn', title: 'Live', sub: 'The notes as they’re written. The usual state.' },
    { step: 'nListen', title: 'The first minute', sub: 'Notes are on; nothing has been said yet.' },
    { step: 'nPausedQuiet', title: 'Paused, as the organizer', sub: 'One line says so, with Resume.' },
    { step: 'nPausedOther', title: 'Paused, by Priya', sub: 'Anyone else can ask to resume.' },
    { step: 'nOffOrg', title: 'Off, as the organizer', sub: 'Turn on notes is the one button.' },
    { step: 'nOffOther', title: 'Off, in someone else’s call', sub: 'Ask for notes is the one button.' },
    { step: 'nRequested', title: 'Asked for', sub: 'Rose means a decision waiting on you.' },
    { step: 'nUnavailable', title: 'Can’t capture', sub: 'Priya’s browser can’t listen. A problem, in caution.' },
    { step: 'nStale', title: 'A hiccup', sub: 'It fixes itself, so it’s only the summary’s time, in caution.' },
    { step: 'nGuest', title: 'A guest with the link', sub: 'Notes from while they were here; no Yours.' },
    { step: 'nTranscriptN', title: 'Transcript', sub: 'Bookmark a line, only you.' },
    { step: 'nAskAnswer', title: 'Ask', sub: 'Answers with their times. Keep in Yours.' },
    { step: 'nYoursAll', title: 'Yours', sub: 'Only you see it.' },
    { step: 'nYoursEmpty', title: 'Yours, empty', sub: 'Says what can go in.' },
    { step: 'nLight', title: 'In the light theme', sub: 'Your side takes your theme.' }
  ];
  NC.STEPS.nTranscriptN = { side: 'notes', notesTab: 'transcript', unread: 0, nn: { marks: ['l2'] } };
})();
