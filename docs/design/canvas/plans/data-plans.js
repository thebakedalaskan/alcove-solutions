/*
 * Plans and checkout. Everyone starts on Free, with the whole product; Pro and Team change how much you get. You choose
 * how many months and pay once, in USDC, to an address made for that one payment. Nothing renews by itself, so Alcove
 * reminds you before a plan ends. A year or more costs 20% less a month.
 *
 * You are Art Vandelay, on Free, on Wednesday 4 November 2026 at 16:12. Prices are the plans draft's. Every address,
 * hash and reference here is made up.
 */
(function () {
  var AH = window.AH, assign = AH.assign, MK = window.AH_MARKS || {};

  /* Lucide, as the app's Icon uses it: what this design adds to AH.I. */
  var I = assign({}, AH.I, {
    upload: 'M12 3v12M17 8l-5-5-5 5M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4',
    file: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7zM14 2v4a2 2 0 0 0 2 2h4',
    folder: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z',
    clock: 'M12 6v6l4 2M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0',
    alert: 'M21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01',
    minus: 'M5 12h14',
    infinity: 'M6 16c5 0 7-8 12-8a4 4 0 0 1 0 8c-5 0-7-8-12-8a4 4 0 1 0 0 8',
    download: 'M12 15V3M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5',
    ext: 'M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
    mail: 'M22 7l-8.991 5.727a2 2 0 0 1-2.009 0L2 7M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    wallet: 'M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4',
    board: 'M2 3h20M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3M7 21l5-5 5 5',
    screen: 'M9 10l3-3 3 3M12 13V7M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM12 17v4M8 21h8',
    leave: 'M10.1 13.9a14 14 0 0 0 3.732 2.668 1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2 18 18 0 0 1-12.728-5.272M22 2L2 22M4.76 13.582A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 .244.473',
    smile: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
    dots: 'M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M18 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M4 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0',
    chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
    receipt: 'M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1zM16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 17.5v-11',
    invite: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M19 8v6M22 11h-6M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0',
    refresh: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5',
    camera: 'M16 13l5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-8a2 2 0 0 1 2 -2z',
    phone: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 18h.01',
    info: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0M12 16v-4M12 8h.01'
  });

  /* ------------------------------------------------------------------ dates and money */
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var TODAY = new Date(2026, 10, 4);
  /* A month of Pro bought on 10 October ends on Tuesday 10 November: the ending-soon story. */
  var ENDS = new Date(2026, 10, 10);
  function plus(d, months, days) { return new Date(d.getFullYear(), d.getMonth() + (months || 0), d.getDate() + (days || 0)); }
  function short(d) { return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear(); }
  function day(d) { return DAY[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()]; }
  function long(d) { return WEEKDAY[d.getDay()] + ' ' + d.getDate() + ' ' + MONTH[d.getMonth()] + ' ' + d.getFullYear(); }
  function group(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function parts(n) { var c = Math.round(n * 100); return { w: Math.floor(c / 100), c: c % 100 }; }
  /* "$1,152", "$12.50" */
  function usd(n) { var x = parts(n); return '$' + group(x.w) + (x.c ? '.' + (x.c < 10 ? '0' : '') + x.c : ''); }
  /* "1,152.00", what's sent, to the cent */
  function amt(n) { var x = parts(n); return group(x.w) + '.' + (x.c < 10 ? '0' : '') + x.c; }
  function mo(n) { return n === 1 ? '1 month' : n + ' months'; }

  /* ------------------------------------------------------------------ the plans */
  var PLANS = {
    free: { id: 'free', name: 'Free', sub: 'For a few calls a month', month: 0, year: 0,
      facts: [['notes', 'About 5 hours of notes a month', 'Back to 5 hours on the 1st of each period'], ['upload', '10 GB of storage', ''], ['file', 'Files up to 512 MB', '']] },
    pro: { id: 'pro', name: 'Pro', sub: 'For one person', month: 20, year: 16,
      facts: [['notes', 'About 50 hours of notes a month', ''], ['upload', '100 GB of storage', ''], ['file', 'Files up to 512 MB', '']] },
    /* Team is licenses: one person for 30 days each, bought by the team's admin, taken as each person next opens Alcove. */
    team: { id: 'team', name: 'Team', sub: 'For a company', month: 40, year: 40, each: true, licenses: true,
      facts: [['notes', 'About 50 hours of notes each', ''], ['upload', '100 GB each, shared by the team', ''], ['file', 'Files up to 512 MB', ''], ['people', 'Notes and workspaces the team shares', '']] }
  };
  var ORDER = ['free', 'pro', 'team'];
  /* What every plan has: plans only change how much you get, so Free shows the whole product. */
  var EVERY = [
    ['video', 'Calls up to 10 hours, 100 people'],
    ['board', 'A workspace and board per call'],
    ['ask', 'Ask across your notes'],
    ['sealed', 'Confidential compute'],
    ['people', 'Invitees get the notes free']
  ];
  var DURATIONS = [1, 3, 6, 12];
  var TEAM = {
    company: 'Vandelay Industries', people: 'art,priya,kofi,lena,maya,aiko', count: 6, names: 'You, Priya, Kofi, Lena, Maya and Aiko',
    /* Art made it, so Art is its admin: buys its licenses, invites, takes people off. */
    admin: 'Art', price: 40, bought: 8, left: 2, low: 5, auto: false,
    /* Where you're a member rather than its admin, Priya is. */
    memberAdmin: 'Priya',
    /* `lic`: live until a day; waiting (needed one and none was left); ended (until they next open Alcove); none yet. */
    members: [
      { who: 'art', name: 'Art Vandelay', you: true, admin: true, lic: 'live', until: '12 Dec' },
      { who: 'priya', name: 'Priya Raman', lic: 'live', until: '12 Dec' },
      { who: 'kofi', name: 'Kofi Asante', lic: 'live', until: '3 Dec' },
      { who: 'lena', name: 'Lena Fischer', lic: 'live', until: '28 Nov' },
      { who: 'maya', name: 'Maya Chen', lic: 'ended', until: '9 Nov' },
      { who: 'aiko', name: 'Aiko Tanaka', lic: 'waiting', until: '' }
    ],
    /* Notes members made visible to the team. */
    notes: [
      { title: 'Team standup', who: 'priya', by: 'Priya', when: 'Today' },
      { title: 'Pricing sync', who: 'maya', by: 'Maya', when: 'Yesterday' },
      { title: 'Launch planning', who: 'lena', by: 'Lena', when: 'Tue 27 Oct' }
    ],
    invite: 'alcove.solutions/team/join#k3Fq9xZ2mWnT4pLv'
  };

  /* ------------------------------------------------------------------ USDC, and the networks it's sent on */
  var NETS = [
    { id: 'base', name: 'Base', min: 5, addr: '0x5C1e7aB2F3d94c80E61a2B7d0f4E8c9A13b7D9e2' },
    { id: 'sol', name: 'Solana', min: 5, addr: '7Yq3cJfR9mWn2KxT8pLvD4sHbE6aZuQ1oGi5NcVy3Mf8' },
    { id: 'eth', name: 'Ethereum', min: 20, addr: '0x8b4F2e19C7aD03E5f6B1c9a7D2e4F80b3C6a1E5d' },
    { id: 'arb', name: 'Arbitrum', min: 5, addr: '0x2D7a9c4E1b6F83a0C5e2d9B7f4A1c8E6b3D0f9a2' },
    { id: 'pol', name: 'Polygon', min: 5, addr: '0x9E3c6A1f8B2d4E7a0c5F9b3D6e1A8c4F2b7E0d5a' },
    { id: 'near', name: 'NEAR', min: 5, addr: '3f9a1c7e5b2d8046a1e9c3f75b0d2e8a6c4f1b9d7e3a5c0f2b8d6e4a1c9f7b3e' },
    { id: 'op', name: 'Optimism', min: 5, addr: '0x4A8e2C6f1D9b3E7a5c0F8d2B6e4A1c9F7b3D5e0a' },
    { id: 'avax', name: 'Avalanche', min: 5, addr: '0x7F1b5D3e9A2c6E8f0B4d1A7c3E9b5F2d8A6c0E4b' },
    { id: 'bsc', name: 'BNB Chain', min: 5, addr: '0x1C6d8A4f2E9b7D3c5A0e8F6b2D4a9C1e7F3b5D8a' }
  ].map(function (n) {
    var a = n.addr;
    return assign(n, { mark: MK[n.id] || { vb: '0 0 24 24', paths: [] }, head: a.slice(0, 6), mid: a.slice(6, -4), tail: a.slice(-4) });
  });
  var NET = {}; NETS.forEach(function (n) { NET[n.id] = n; });
  var USDC = MK.usdc || { vb: '0 0 24 24', paths: [] };

  /* A made-up QR code for an address: finder squares in three corners, timing lines, and the rest from the address. */
  function qr(seed) {
    var N = 29, h = 2166136261, d = '';
    for (var i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    var rnd = function () { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
    var finder = function (x, y) {
      var spots = [[0, 0], [N - 7, 0], [0, N - 7]];
      for (var k = 0; k < 3; k++) {
        var fx = x - spots[k][0], fy = y - spots[k][1];
        if (fx >= -1 && fx <= 7 && fy >= -1 && fy <= 7) {
          if (fx < 0 || fy < 0 || fx > 6 || fy > 6) return 0;
          if (fx === 0 || fy === 0 || fx === 6 || fy === 6) return 1;
          if (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4) return 1;
          return 0;
        }
      }
      return -1;
    };
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var f = finder(x, y), on;
      if (f >= 0) on = f === 1;
      else if (y === 6) on = x % 2 === 0;
      else if (x === 6) on = y % 2 === 0;
      else on = rnd() < 0.47;
      if (on) d += 'M' + x + ' ' + y + 'h1v1h-1z';
    }
    return { d: d, vb: '0 0 ' + N + ' ' + N };
  }

  /* ------------------------------------------------------------------ what a choice costs */
  function quote(s) {
    if (s.plan === 'hours') {
      var hrs = s.hours || 10, cost = hrs * 1.5;
      return { plan: 'hours', P: { name: 'More notes', month: 0, year: 0 }, hours: hrs, months: 0, people: 1, yearly: false, per: 1.5, list: cost, total: cost, off: 0, from: TODAY, until: null };
    }
    if (s.plan === 'team') {
      var lic = Math.max(1, s.licenses || 6), cost = lic * PLANS.team.month;
      return { plan: 'team', P: PLANS.team, licenses: lic, months: 1, people: lic, yearly: false, per: PLANS.team.month, list: cost, total: cost, off: 0, from: TODAY, until: null };
    }
    var P = PLANS[s.plan] || PLANS.pro, n = Math.max(1, s.months || 1), people = 1;
    var yearly = n >= 12, per = yearly ? P.year : P.month, from = s.kind === 'extend' ? ENDS : TODAY;
    return { plan: P.id, P: P, months: n, people: people, yearly: yearly, per: per, list: P.month * n * people, total: per * n * people, off: (P.month - per) * n * people, from: from, until: plus(from, n) };
  }
  /* What an amount buys by itself, at the price for that much: whole months, then days. 100 USDC of Pro is 6 months and 20 days. */
  function buys(q, paid) {
    var each = q.people || 1, rate = paid >= q.P.year * 12 * each ? q.P.year : q.P.month, month = rate * each;
    var m = Math.floor(paid / month + 1e-9), d = Math.round((paid - m * month) / (month / 30));
    return { months: m, days: d, text: (m ? mo(m) : '') + (m && d ? ' and ' : '') + (d ? d + (d === 1 ? ' day' : ' days') : '') };
  }
  /* Days an extra amount adds at the rate it was priced at. 6 USDC more on a year of Pro is 15 days. */
  function extraDays(q, extra) { return Math.round(extra / (q.per * q.people / 30)); }

  /*
   * Checkout, by moment. `stage`: choose, send (waiting for the payment), short (less arrived), seen (arrived, starting
   * the plan), done, expired. `kind` extend counts from when the plan ends. `got`: what arrived, when it isn't what was asked.
   */
  var CO = {
    coChoose: { plan: 'pro', months: 12, net: null, stage: 'choose' },
    coMonth: { plan: 'pro', months: 1, net: null, stage: 'choose' },
    coNet: { plan: 'pro', months: 12, net: 'base', stage: 'choose', hot: 'go' },
    coMore: { plan: 'pro', months: 12, net: null, stage: 'choose', more: true },
    coOther: { plan: 'pro', months: 18, other: true, net: 'base', stage: 'choose' },
    coEth: { plan: 'pro', months: 1, net: 'eth', stage: 'choose' },
    coSend: { plan: 'pro', months: 12, net: 'base', stage: 'send' },
    coSendSol: { plan: 'pro', months: 12, net: 'sol', stage: 'send' },
    coAsk: { plan: 'pro', months: 12, net: 'base', stage: 'send', ask: true },
    coSeen: { plan: 'pro', months: 12, net: 'base', stage: 'seen' },
    coDone: { plan: 'pro', months: 12, net: 'base', stage: 'done' },
    coShort: { plan: 'pro', months: 12, net: 'base', stage: 'short', got: 100 },
    coOver: { plan: 'pro', months: 12, net: 'base', stage: 'done', got: 150 },
    coExpired: { plan: 'pro', months: 12, net: 'base', stage: 'expired' },
    coTeam: { plan: 'team', kind: 'start', licenses: 6, net: 'base', stage: 'choose', hot: 'go' },
    coTeamNew: { plan: 'team', kind: 'start', licenses: 6, net: null, stage: 'choose' },
    coExtendNew: { plan: 'pro', kind: 'extend', months: 12, net: null, stage: 'choose' },
    coTeamLicenses: { plan: 'team', kind: 'start', licenses: 6, net: null, stage: 'choose', other: true, hot: 'lic-up' },
    coTeamSend: { plan: 'team', kind: 'start', licenses: 6, net: 'base', stage: 'send' },
    coTeamDone: { plan: 'team', kind: 'start', licenses: 6, net: 'base', stage: 'done' },
    coTeamDoneLink: { plan: 'team', kind: 'start', licenses: 6, net: 'base', stage: 'done', link: true },
    coTeamMore: { plan: 'team', kind: 'more', licenses: 5, net: null, stage: 'choose' },
    coTeamMoreBal: { plan: 'team', kind: 'more', licenses: 3, net: null, stage: 'choose', bal: 200, hot: 'go' },
    coTeamMoreDone: { plan: 'team', kind: 'more', licenses: 3, net: null, stage: 'done', bal: 200 },
    coExtend: { plan: 'pro', kind: 'extend', months: 12, net: 'base', stage: 'choose', hot: 'go' },
    coExtendSend: { plan: 'pro', kind: 'extend', months: 12, net: 'base', stage: 'send' },
    coExtendDone: { plan: 'pro', kind: 'extend', months: 12, net: 'base', stage: 'done' },
    coHours: { plan: 'hours', hours: 10, net: 'base', stage: 'choose', hot: 'go' },
    coHoursDone: { plan: 'hours', hours: 10, net: 'base', stage: 'done' },
    coCall: { plan: 'pro', months: 12, net: 'base', stage: 'choose', hot: 'go', from: 'call' },
    coCallSend: { plan: 'pro', months: 12, net: 'base', stage: 'send', from: 'call' },
    coCallDone: { plan: 'pro', months: 12, net: 'base', stage: 'done', from: 'call' }
  };

  /* ------------------------------------------------------------------ the side panel's foot, by plan */
  var FOOT = {
    free: { kind: 'free', left: '1 h 26 min', share: 29, plan: 'Free plan', act: 'See plans' },
    low: { kind: 'free', warm: true, left: '24 min', share: 8, plan: 'Free plan', act: 'Get Pro' },
    out: { kind: 'out', text: 'No notes left until 1 Dec', plan: 'Free plan', act: 'Get Pro' },
    pro: { kind: 'pro', plan: 'Pro', act: 'Until 4 Nov 2027' },
    extended: { kind: 'pro', plan: 'Pro', act: 'Until 10 Nov 2027' },
    team: { kind: 'pro', plan: 'Team', act: 'Vandelay Industries' },
    teamLow: { kind: 'low', plan: 'Team', act: '2 licenses left · Buy' },
    teamWait: { kind: 'wait', text: 'No team license yet', left: '3 h 10 min', share: 63, plan: 'Free plan', act: 'Team' },
    ending: { kind: 'ending', plan: 'Pro', act: 'Ends in 6 days · Extend' },
    ended: { kind: 'free', left: '5 h', share: 100, plan: 'Free plan', act: 'See plans' },
    waiting: { kind: 'waiting', text: 'Waiting for 144 USDC', plan: 'Pro, 12 months', act: 'Open' }
  };
  function foot(kind) {
    var hot = /-hot$/.test(kind || ''), f = FOOT[(kind || '').replace(/-hot$/, '')] || FOOT.free;
    /*
     * A paid plan is a row with its small sun: up while it runs, half set when it's ending. A team's admin is told in warm
     * when its licenses run low. Someone on a team without a license is on their own plan, and told so above it.
     */
    var card = f.kind === 'pro' || f.kind === 'ending' || f.kind === 'low';
    return assign({ hotCls: hot ? ' is-hot' : '', hasArrow: true, goCls: '', isCard: card, isRow: !card, cardCls: f.kind === 'ending' ? ' is-ending' : '', smallCls: f.kind === 'ending' || f.kind === 'low' ? 'is-warm' : '', isFree: f.kind === 'free' || f.kind === 'wait', isWait: f.kind === 'wait', isOut: f.kind === 'out', isPro: f.kind === 'pro', isEnding: f.kind === 'ending', isWaiting: f.kind === 'waiting', warmCls: f.warm ? ' is-warm' : '', meter: 'width: ' + (f.share || 0) + '%', go: null }, f);
  }

  /* ------------------------------------------------------------------ Plans, by moment */
  var STEPS = {
    plans: {},
    plansMonth: { cycle: 'month' },
    plansHotYear: { cycle: 'month', hot: 'cycle-year' },
    plansHotPro: { hot: 'get-pro' },
    plansHotTeam: { hot: 'get-team' },
    plansDown: { scrolled: true },
    plansPro: { mine: 'pro', toast: 'You’re on Pro until 4 Nov 2027.' },
    plansProRest: { mine: 'pro' },
    plansTeamMine: { mine: 'team' },
    plansTeamAdmin: { mine: 'teamAdmin' },
    plansHotTeamStart: { hot: 'get-team' },
    plansEnding: { mine: 'ending' }
  };
  Object.keys(CO).forEach(function (k) { STEPS[k] = { co: k }; });
  STEPS.coTeam = { co: 'coTeam', from: 'plans' };

  /* The call, when this month's notes run out. Art organized it; Maya and Lena were invited. */
  var CALL = {
    callOut: { who: 'art' },
    callHot: { who: 'art', hot: 'get-pro' },
    callGuest: { who: 'maya' },
    callCo: { who: 'art', co: 'coCall' },
    callCoSend: { who: 'art', co: 'coCallSend' },
    callCoDone: { who: 'art', co: 'coCallDone' },
    callBack: { who: 'art', back: true },
    callHours: { who: 'art', co: 'coHours' }
  };

  /* Settings › Plan, by plan. Added to the Settings board's own steps. */
  var SET = {
    plFree: { to: 'plan', plan: 'free' },
    plFreeHot: { to: 'plan', plan: 'free', hot: 'get-pro' },
    plLow: { to: 'plan', plan: 'low' },
    plOut: { to: 'plan', plan: 'out' },
    plWaiting: { to: 'plan', plan: 'waiting' },
    plPro: { to: 'plan', plan: 'pro' },
    plEnding: { to: 'plan', plan: 'ending' },
    plEndingHot: { to: 'plan', plan: 'ending', hot: 'extend' },
    plCoExtend: { to: 'plan', plan: 'ending', co: 'coExtend' },
    plCoExtendSend: { to: 'plan', plan: 'ending', co: 'coExtendSend' },
    plCoExtendDone: { to: 'plan', plan: 'ending', co: 'coExtendDone' },
    plExtended: { to: 'plan', plan: 'extended', toast: 'Pro runs to 10 Nov 2027.' },
    plEnded: { to: 'plan', plan: 'ended' },
    plTeam: { to: 'plan', plan: 'team' },
    plTeamAdmin: { to: 'plan', plan: 'teamAdmin' },
    plTeamLow: { to: 'plan', plan: 'teamLow' },
    plTeamLowHot: { to: 'plan', plan: 'teamLow', hot: 'buy-licenses' },
    plTeamMore: { to: 'plan', plan: 'teamLow', co: 'coTeamMore' },
    plTeamWait: { to: 'plan', plan: 'teamWait' },
    plCoHours: { to: 'plan', plan: 'out', co: 'coHours' }
  };
  if (AH.ST3 && AH.ST3.STEPS) Object.keys(SET).forEach(function (k) { AH.ST3.STEPS[k] = SET[k]; });

  /*
   * Every journey, from what's pressed to what happens. `b`: the board a frame shows (plans, settings, home, call);
   * `plan` sets the side panel's foot on Home.
   */
  var JOURNEYS = [
    { name: 'Choose Pro, from anywhere on Free', frames: [
      { b: 'home', plan: 'free-hot', step: 'home', t: 'On Free, the side panel says how much of this month’s notes is left. Click See plans under it.' },
      { b: 'plans', step: 'plans', t: 'Plans opens: three plans on the water, priced for a year. Pro is the one filled button.' },
      { b: 'plans', step: 'plansHotPro', t: 'Click Get Pro.' },
      { b: 'plans', step: 'coChoose', t: 'Checkout opens over Plans with 12 months chosen. Every length shows its total and what you save.' },
      { b: 'plans', step: 'coNet', t: 'Choose the network you’ll send USDC on. Click Get the address.' }
    ] },
    { name: 'Pay with USDC', frames: [
      { b: 'plans', step: 'coSend', t: 'The exact amount, a QR code and an address made for this one payment. Send from any wallet or exchange.' },
      { b: 'plans', step: 'coSeen', t: 'Alcove sees the payment arrive and starts Pro. There’s nothing to press.' },
      { b: 'plans', step: 'coDone', t: 'You’re on Pro until Thursday 4 November 2027, with a receipt.' },
      { b: 'plans', step: 'plansPro', t: 'Click Done. Pro is marked yours, and the side panel says until when.' },
      { b: 'home', plan: 'pro', step: 'home', t: 'Everywhere else, the side panel shows Pro as a small evening of its own: its sun up, and the date it runs to.' }
    ] },
    { name: 'Notes run out in a call', frames: [
      { b: 'call', step: 'callOut', t: 'At this month’s 5 hours, notes stop and say so. The call carries on. The organizer sees two ways to more.' },
      { b: 'call', step: 'callGuest', t: 'Everyone else sees that notes stopped, and nothing to buy: a call’s notes are on its organizer’s plan.' },
      { b: 'call', step: 'callCo', t: 'Click Get Pro. Checkout opens over the call, so you never leave it.' },
      { b: 'call', step: 'callCoSend', t: 'Send it from your phone while the call goes on.' },
      { b: 'call', step: 'callBack', t: 'The moment it arrives, notes start again, and say where they picked up.' }
    ] },
    { name: 'Start a team', frames: [
      { b: 'plans', step: 'plansHotTeamStart', t: 'On Plans, Team is licenses: $40 for each person, 30 days at a time. Press Start a team.' },
      { b: 'plans', step: 'coTeamNew', t: 'Name it, and choose how many licenses: one for each of you, to start.' },
      { b: 'plans', step: 'coTeamSend', t: 'Pay as for Pro: the exact amount, to an address made for this payment.' },
      { b: 'plans', step: 'coTeamDoneLink', t: 'Vandelay Industries is on Team, with you its admin. Make an invite link for each person.' },
      { b: 'team', step: 'teamAdmin', t: 'Team shows everyone on it under their license, the licenses left, and more invites.' }
    ] },
    { name: 'Joining by an invite', frames: [
      { b: 'join', step: 'joinSignIn', t: 'An invite opens a page of its own. Signed out, it asks you to sign in first.' },
      { b: 'join', step: 'joinHot', t: 'Whose team it is, and what joining gives you. Nothing happens until Join.' },
      { b: 'join', step: 'joinDone', t: 'Joined: one of its licenses is yours now, for 30 days.' },
      { b: 'join', step: 'joinNoLicense', t: 'With none left, you’re on the team on your own plan, and its admin is told.' },
      { b: 'join', step: 'joinUsed', t: 'An invite works once, for a day.' }
    ] },
    { name: 'Licenses running low', frames: [
      { b: 'home', plan: 'teamLow', step: 'home', t: 'Under 5 left, the side panel says so, in warm. The admin alone sees it.' },
      { b: 'team', step: 'teamAdminHot', t: 'Team says who’s waiting. Buy licenses is filled while someone is.' },
      { b: 'team', step: 'teamAdminMore', t: 'Checkout opens on how many, with what’s left in view.' },
      { b: 'settings', step: 'plTeamLowHot', t: 'Settings › Plan has the same, with buying one when it’s needed, and refunds.' },
      { b: 'team', step: 'teamAdminRemove', t: 'Remove asks in place: the license isn’t refunded, and notes they shared stay.' }
    ] },
    { name: 'On a team without a license', frames: [
      { b: 'home', plan: 'teamWait', step: 'home', t: 'None was left when you opened Alcove: the side panel says so, over your own plan.' },
      { b: 'team', step: 'teamWait', t: 'Team says why the team’s notes and workspaces aren’t open, and who has been told.' },
      { b: 'settings', step: 'plTeamWait', t: 'Settings › Plan says it once, over Free. One is yours the next time you open Alcove after more are bought.' },
      { b: 'team', step: 'teamMember', t: 'With a license: the team’s people, and the notes they made visible to it.' }
    ] },
    { name: 'Extend before it ends', frames: [
      { b: 'settings', step: 'plEnding', t: 'A week before, the side panel and Settings say when Pro ends. An email says it too.' },
      { b: 'settings', step: 'plEndingHot', t: 'Extend is the one filled button, because something needs doing. Click it.' },
      { b: 'settings', step: 'plCoExtend', t: 'Checkout counts from 10 November, so the days left aren’t lost.' },
      { b: 'settings', step: 'plCoExtendDone', t: 'Pro runs to Wednesday 10 November 2027.' },
      { b: 'settings', step: 'plExtended', t: 'Back in Settings, with the payment in the list.' }
    ] },
    { name: 'When a payment isn’t right', frames: [
      { b: 'plans', step: 'coShort', t: 'Less arrived than asked. Send the rest to the same address, or keep the time what arrived buys.' },
      { b: 'plans', step: 'coOver', t: 'More arrived than asked. The extra becomes days: 6 USDC more is 15 more days.' },
      { b: 'plans', step: 'coExpired', t: 'Nothing arrived in 24 hours. The address closes and nothing was charged.' },
      { b: 'plans', step: 'coEth', t: 'A network’s minimum is said before you get an address: Ethereum takes at least 20 USDC.' },
      { b: 'plans', step: 'coAsk', t: 'Cancel asks first, and says a payment sent anyway still counts.' }
    ] },
    { name: 'Free and Pro, side by side', frames: [
      { b: 'settings', step: 'plFree', t: 'Free: what’s left of this month’s notes and uploads, and Get Pro.' },
      { b: 'settings', step: 'plLow', t: 'With under an hour left the numbers turn warm. One toast said so, once.' },
      { b: 'settings', step: 'plOut', t: 'Out of notes: calls go on without them until 1 December. Get Pro, or add 10 hours.' },
      { b: 'settings', step: 'plPro', t: 'Pro: unlimited notes, the date it runs to, and every payment.' },
      { b: 'settings', step: 'plTeam', t: 'Team: your license, notes of your own, and the team’s shared storage.' },
      { b: 'settings', step: 'plEnded', t: 'Pro ended: back on Free, and nothing was deleted.' }
    ] },
    { name: 'In the light', frames: [
      { b: 'plans', step: 'plans', mode: 'light', t: 'Plans by day.' },
      { b: 'plans', step: 'coNet', mode: 'light', t: 'Checkout by day: the one filled button is navy.' },
      { b: 'plans', step: 'coSend', mode: 'light', t: 'The address and QR code.' },
      { b: 'settings', step: 'plPro', mode: 'light', t: 'Settings on Pro.' },
      { b: 'call', step: 'callGuest', mode: 'light', t: 'The call stays night; your side takes your theme.' }
    ] },
    { name: 'On a phone', phone: true, frames: [
      { b: 'plans', step: 'plans', t: 'Plans on a phone: the three plans one under another.' },
      { b: 'plans', step: 'coChoose', t: 'Checkout fills the screen. What you’re buying stays at the top.' },
      { b: 'plans', step: 'coSend', t: 'Open in wallet pays from this phone. Copy works for an exchange.' },
      { b: 'plans', step: 'coDone', t: 'Pro is on.' }
    ] }
  ];

  AH.PL = {
    I: I, PLANS: PLANS, ORDER: ORDER, EVERY: EVERY, DURATIONS: DURATIONS, TEAM: TEAM, NETS: NETS, NET: NET, USDC: USDC,
    CO: CO, STEPS: STEPS, CALL: CALL, SET: SET, JOURNEYS: JOURNEYS, TODAY: TODAY, ENDS: ENDS,
    qr: qr, quote: quote, buys: buys, extraDays: extraDays, foot: foot,
    plus: plus, short: short, day: day, long: long, usd: usd, amt: amt, mo: mo, group: group
  };
})();
