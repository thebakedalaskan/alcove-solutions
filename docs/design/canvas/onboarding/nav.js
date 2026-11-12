/*
 * The side panel, rethought: today's panel and three ways to calm it, as one model every board shares (AH.NV).
 *
 *   today  the panel as the app draws it now
 *   a      Just tidy: the same order, less in it
 *   b      Two groups: your work at the top, Team and Agents at the foot (the one this canvas recommends)
 *   c      A rail: icons with their names under them, pinned notes as arches
 *
 * The day is the demo world's: Wednesday 4 November, you are Art Vandelay at Vandelay Industries. Everyone is made up.
 */
(function () {
  var AH = window.AH, assign = AH.assign;

  /* Lucide, as the app draws them (1.8 stroke). */
  var I = {
    home: 'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    calls: 'M21 5H3M10 12H3M10 19H3M15 12.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997a1 1 0 0 1-1.517-.86z',
    folderOpen: 'M0 0m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2',
    recordDot: 'M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0',
    people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3.128a4 4 0 0 1 0 7.744M22 21v-2a4 4 0 0 0-3-3.87M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0',
    agent: 'M12 8V4H8M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-8a2 2 0 0 1 2 -2zM2 14h2M20 14h2M15 13v2M9 13v2',
    pin: 'M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z',
    hash: 'M4 9L20 9M4 15L20 15M10 3L8 21M16 3L14 21',
    panel: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2zM9 3v18',
    sealed: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1zM0 0m9 12 2 2 4-4',
    video: 'M0 0m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-8a2 2 0 0 1 2 -2z',
    plus: 'M5 12h14M12 5v14',
    x: 'M18 6 6 18M0 0m6 6 12 12',
    search: 'M0 0m21 21-4.34-4.34M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0',
    wifiOff: 'M12 20h.01M8.5 16.429a5 5 0 0 1 7 0M5 12.859a10 10 0 0 1 5.17-2.69M19 12.859a10 10 0 0 0-2.007-1.523M2 8.82a15 15 0 0 1 4.177-2.643M22 8.82a15 15 0 0 0-11.288-3.764M0 0m2 2 20 20',
    check: 'M20 6 9 17l-5-5',
    minus: 'M5 12h14',
    right: 'M5 12h14M0 0m12 5 7 7-7 7'
  };

  /* What you've pinned, in the order you pinned it. `c` is the cover's sunset (a, b or the plain one). */
  var PINS = [
    { id: 'p1', t: 'Design review', c: 'a' },
    { id: 'p2', t: 'Site visit, Harbourline', c: 'b' }
  ];
  var MORE_PINS = [
    { id: 'p3', t: 'Weekly product sync', c: '' },
    { id: 'p4', t: 'Interview: Jonas Weber', c: 'b' },
    { id: 'p5', t: 'Harbourline proposal', c: 'a' },
    { id: 'p6', t: '1:1 with Maya', c: '' },
    { id: 'p7', t: 'Warehouse move, kickoff', c: 'b' },
    { id: 'p8', t: 'Board prep for the fourth quarter, with the whole leadership group', c: 'a' }
  ];
  /* The note pinned in the journey, from Pin a note. */
  var ADDED = { id: 'p9', t: 'Supplier call: Ostrava', c: 'b' };
  var GROUPS = [{ t: 'Leads', n: '3' }, { t: 'Product', n: '4' }];

  /* Pin a note: what's pinned first, then recent notes (the app's window, unchanged). */
  var RECENT = [
    { id: 'p9', t: 'Supplier call: Ostrava', m: 'Yesterday · 38 min', c: 'b' },
    { id: 'r2', t: 'Interview: Jonas Weber', m: 'Mon · 52 min', c: '', room: true },
    { id: 'r3', t: 'Pricing with Ines', m: 'Mon · 24 min', c: 'a' },
    { id: 'r4', t: 'Weekly product sync', m: 'Fri 31 Oct · 41 min', c: '' }
  ];

  /*
   * Every state the panel can be in, by name. Boards reach them through `ns`, and journeys walk them.
   *   soon     '' | '10' | '4' | 'now': a call with someone else on it, 10 or 4 minutes away, or going on
   *   homeLine Home's own line is offering that call, so the panel's row steps aside (one Join at a time)
   */
  var STEPS = {
    rest: {},
    first: { first: true },
    soon10: { soon: '10' },
    soon4: { soon: '4' },
    soonHome: { soon: '4', homeLine: true },
    going: { soon: 'now' },
    lots: { lots: true },
    alone: { alone: true },
    offline: { offline: true },
    low: { low: true },
    waiting: { waiting: 2 },
    pinHot: { pinHot: true },
    pinOpen: { pinHot: true, pinOpen: true },
    pinAdded: { pinOpen: true, added: true },
    pinned: { added: true, fresh: true },
    tip: { tip: 'p1' },
    tipNow: { soon: '10', tip: 'now' },
    tipSeal: { tip: 'seal' },
    tipLeft: { tip: 'left' }
  };

  var VARIANTS = {
    today: { name: 'Today', line: 'As the app draws it now.' },
    a: { name: 'A · Just tidy', line: 'The same order, with less in it.' },
    b: { name: 'B · Two groups', line: 'Your work at the top; Team and Agents at the foot.' },
    c: { name: 'C · A rail', line: 'Icons with their names under them; the page gets the room.' }
  };

  function noop() {}

  /*
   * The panel's view, for the Panel part.
   *   o.v      which panel: today, a, b or c
   *   o.st     its state (a step from STEPS, merged with anything live)
   *   o.home   Home's count: what's waiting on you
   *   o.on     the place you're on (home by default)
   *   o.do     what presses do: go(label), start(), join(), pin(), hide(), toast(msg)
   */
  function panel(o) {
    var v = o.v || 'b', st = o.st || {}, d = assign({ go: noop, start: noop, join: noop, pin: noop, hide: noop, open: noop }, o.do || {});
    var first = !!st.first, today = v === 'today', rail = v === 'c';
    var home = first ? 0 : (o.home === undefined ? 8 : o.home);
    var on = o.on || 'home';

    /* A count says something is waiting on you. Today the panel also counts every note and everyone on Team. */
    var all = [
      { id: 'home', label: 'Home', icon: I.home, n: home, news: true },
      { id: 'calls', label: 'Calls', icon: I.calls, n: 0, news: false },
      { id: 'drive', label: 'Drive', icon: I.folderOpen, n: first ? 0 : 1, news: true },
      { id: 'record', label: 'Record', icon: I.recordDot, n: st.waiting || 0, news: true },
      { id: 'team', label: 'Team', icon: I.people, n: first ? 1 : 6, news: false, team: true },
      { id: 'agents', label: 'Agents', icon: I.agent, n: first ? 0 : 2, news: false }
    ].filter(function (x) { return !(x.team && st.alone); });

    var row = function (x) {
      var shown = x.n > 0 && (today ? x.id !== 'agents' : x.news);
      return {
        id: x.id, label: x.label, icon: x.icon, count: shown ? String(x.n) : '', hasCount: shown,
        cls: x.id === on ? ' is-on' : '', current: x.id === on ? 'page' : 'false',
        go: function () { d.go(x.label); }
      };
    };
    var lowIds = v === 'b' ? { team: 1, agents: 1 } : {};
    var top = all.filter(function (x) { return !lowIds[x.id]; }).map(row);
    var low = all.filter(function (x) { return lowIds[x.id]; }).map(row);

    /* Pinned: nothing until you pin something (today it explains itself instead). */
    var pins = first ? [] : PINS.concat(st.lots ? MORE_PINS : []).concat(st.added ? [ADDED] : []);
    var pinRows = pins.map(function (p) {
      return {
        id: p.id, t: p.t, cover: 'nv-arch' + (p.c ? ' is-' + p.c : ''), cls: (st.fresh && p.id === ADDED.id ? ' is-new' : '') + (st.tip === p.id ? ' is-tip' : ''),
        go: function () { d.open(p.t); }
      };
    });

    /*
     * The call that's about to start. Today: the next call all day, as a card. In A, B and C: only from 10 minutes before a
     * call with someone else on it until it ends, as one row; offline there's nothing to join, and on Home it steps aside
     * while Home's own line offers the call.
     */
    var soon = st.soon || '';
    var showNow = !today && !!soon && !st.offline && !st.homeLine;
    var now = {
      title: 'Design sync', faces: 'priya,kofi', cover: 'nv-arch is-now',
      when: soon === 'now' ? 'Happening now' : 'Starts in ' + soon + ' min',
      short: soon === 'now' ? 'Now' : soon + ' min',
      tip: soon === 'now' ? 'Join Design sync, happening now' : 'Join Design sync, starts in ' + soon + ' min',
      cls: (soon === 'now' ? ' is-going' : '') + (st.tip === 'now' ? ' is-tip' : ''),
      join: function () { d.join(); }
    };

    var minutes = st.low ? '48 min' : first ? '6 h 40 min' : '6 h 26 min';
    var share = st.low ? 0.08 : first ? 1 : 0.64;
    /* The rail's ring: a circle of radius 9 is 56.55 around. */
    var ring = (Math.max(0.02, share) * 56.55).toFixed(2) + ' 56.55';

    var style = AH.rootStyle('blue-hour', 'dark', 16.2) + '; --frame: ' + AH.ok(AH.PALS['blue-hour'].dark.well);
    return {
      v: v, I: I, full: !rail, rail: rail, today: today, style: style,
      kindCls: 'nv nv-' + v + (st.lots ? ' is-lots' : '') + (st.offline ? ' is-offline' : ''),
      start: d.start, hide: d.hide, logo: function () { d.go('Home'); },
      offline: !!st.offline,
      top: top, low: low, hasLow: low.length > 0,
      upCard: today && !first, card: { title: 'Design sync', when: '17:30 · in 1 h 18 min', faces: 'priya,kofi' },
      hasPins: pinRows.length > 0, pins: pinRows, pinAdd: d.pin,
      pinHeadCls: 'nv-sec-h' + (today ? ' is-always' : '') + (st.pinHot ? ' is-hot' : ''),
      pinHint: today && first,
      hasGroups: today && !first, groups: GROUPS,
      hasNow: showNow, now: now,
      minutes: minutes, lowNotes: !!st.low, minCls: 'nv-min' + (st.low ? ' is-low' : ''),
      meter: 'width: ' + Math.round(share * 100) + '%',
      ring: ring, ringCls: 'nv-r-ring' + (st.low ? ' is-low' : '') + (st.tip === 'left' ? ' is-tip' : ''),
      sealCls: 'nv-r-ic' + (st.tip === 'seal' ? ' is-tip' : ''),
      leftTip: minutes + ' of notes left'
    };
  }

  /* Pin a note, the window the panel's pin opens (the app's, unchanged). */
  function pinWindow(st, d) {
    var pinned = PINS.map(function (p) { return { t: p.t, m: p.id === 'p1' ? 'Thu 29 Oct · 47 min' : 'Tue 27 Oct · 1 h 4 min', cover: 'nv-arch' + (p.c ? ' is-' + p.c : ''), on: true, label: 'Unpin', go: noop, cls: ' is-on' }; });
    var recent = RECENT.map(function (r, i) {
      var on = r.id === ADDED.id && !!st.added;
      return {
        t: r.t, m: r.m, cover: 'nv-arch' + (r.c ? ' is-' + r.c : ''), on: on, label: on ? 'Unpin' : 'Pin',
        cls: (on ? ' is-on' : '') + (i === 0 && !on ? ' is-lit' : ''),
        go: r.id === ADDED.id ? d.add : noop
      };
    });
    return { pinned: pinned, recent: recent, done: d.done };
  }

  /* Where the canvas's own journey frames start a Home in the lobby, for a call joined from the panel. */
  Object.assign(AH.STEPS, {
    nvLobby: { page: 'lobby', lobbyTitle: 'Design sync', lobbySub: 'Priya and Kofi are here.' }
  });

  /*
   * B's journeys, each from what's pressed to what happens. `home` is Home's own step, `ns` the panel's.
   */
  var JOURNEYS = [
    { name: 'A call is about to start', frames: [
      { home: 'today', ns: 'rest', t: '16:12. Nothing near: the panel is only places. Today’s calls are on Home, under Upcoming.' },
      { home: 'today', ns: 'soon10', t: '17:20. Ten minutes before Design sync, it comes in at the foot, with Join. On every page.' },
      { home: 'soon', ns: 'soonHome', t: '17:26. On Home, Home’s own line takes the call, so the panel’s row steps aside: one Join at a time.' },
      { home: 'nvLobby', ns: 'soonHome', t: 'Click Join. The join screen, the only place a camera shows.' }
    ] },
    { name: 'Pin a note', frames: [
      { home: 'today', ns: 'pinHot', t: 'Point at Pinned. Its pin shows at the end of the heading, as it does for anything that can be added to.' },
      { home: 'today', ns: 'pinOpen', t: 'Click it. Pin a note opens, as it does now: what’s pinned first, then recent notes.' },
      { home: 'today', ns: 'pinAdded', t: 'Click Supplier call. It’s pinned at once, and Done closes the window.' },
      { home: 'today', ns: 'pinned', t: 'It’s the last row under Pinned. Nothing was pinned before? Pinned shows now, for the first time.' }
    ] },
    { name: 'Something waits on you', frames: [
      { home: 'today', ns: 'rest', t: 'A count means something is waiting: answers on Home, tags you haven’t seen in the Drive.' },
      { home: 'today', ns: 'waiting', t: 'Two recordings haven’t uploaded yet, so Record says 2 until they have.' },
      { home: 'today', ns: 'low', t: 'Notes running low: the minutes at the foot turn to caution, and lead to your plan.' }
    ] }
  ];

  /* The panel's states, as the States board lays them out. */
  var STATES = [
    { ns: 'rest', t: 'At rest', s: 'Places, what you pinned, Team and Agents, and the check.' },
    { ns: 'first', t: 'The first day', s: 'Nothing pinned yet, so there’s no Pinned at all.' },
    { ns: 'soon10', t: 'A call in 10 minutes', s: 'It comes in at the foot, with Join, on every page.' },
    { ns: 'going', t: 'A call going on', s: 'Until it ends, so you can get back in.' },
    { ns: 'lots', t: 'A lot pinned', s: 'Pinned scrolls between the places and the foot. Long names end in …' },
    { ns: 'alone', t: 'On your own', s: 'No Team. Agents stays at the foot.' },
    { ns: 'offline', t: 'Offline', s: 'The notice at the top. Nothing to join, so no call at the foot.' },
    { ns: 'low', t: 'Notes running low', s: 'The minutes turn to caution.' }
  ];
  var STATES_C = [
    { ns: 'rest', t: 'At rest', s: 'Six places, then what you pinned, as arches.' },
    { ns: 'tip', t: 'Point at an arch', s: 'Its name shows beside it.' },
    { ns: 'tipNow', t: 'A call in 10 minutes', s: 'Its arch, with the minutes under it. Press to join.' },
    { ns: 'tipLeft', t: 'Notes left', s: 'A ring, with the minutes beside it when you point.' }
  ];

  AH.NV = { I: I, STEPS: STEPS, VARIANTS: VARIANTS, JOURNEYS: JOURNEYS, STATES: STATES, STATES_C: STATES_C, panel: panel, pinWindow: pinWindow };
})();
