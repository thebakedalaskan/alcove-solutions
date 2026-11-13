/*
 * Scheduling a call, fixed: the model every board draws from (AH.SK).
 *
 * Times are minutes from Monday 9 November 2026 at 00:00, so a day is 1440 and a week 10080. Now is Thursday
 * 12 November, 11:10. You are Art Vandelay at Vandelay Industries; everyone here is made up. Your calendar and
 * everyone else's busy time are below; other people's calendars only ever show as busy, never what's in them.
 */
(function () {
  var AH = window.AH;

  /* Lucide, at the app's stroke. */
  Object.assign(AH.I, {
    calls: 'M21 5H3M10 12H3M10 19H3M15 12.003a1 1 0 0 1 1.517-.859l4.997 3.077a1 1 0 0 1 0 1.718l-4.997 3.077a1 1 0 0 1-1.517-.86z',
    drive: 'm6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2',
    doc: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8',
    chev: 'm9 18 6-6-6-6',
    chevL: 'm15 18-6-6 6-6',
    chevDown: 'm6 9 6 6 6-6',
    repeat: 'm17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3',
    clock: 'M12 6v6l4 2M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3.128a4 4 0 0 1 0 7.744M22 21v-2a4 4 0 0 0-3-3.87M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0',
    list: 'M3 12h.01M3 18h.01M3 6h.01M8 12h13M8 18h13M8 6h13',
    undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11',
    alert: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01',
    arrowUp: 'm5 12 7-7 7 7M12 19V5',
    arrowDown: 'M12 5v14M19 12l-7 7-7-7',
    globe: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0M2 12h20M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20',
    agents: 'M12 8V4H8M4 8h16a0 0 0 0 1 0 0v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8zM2 14h2M20 14h2M15 13v2M9 13v2'
  });

  /* ---------------------------------------------------------------- time */
  var DAY = 1440, WEEK = 7 * DAY;
  var NOW = 3 * DAY + 11 * 60 + 10;
  var WORK_FROM = 9 * 60, WORK_TO = 17 * 60;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var WD_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var H = function (h, m) { return h * 60 + (m || 0); };

  function dateOf(d) { return new Date(2026, 10, 9 + d); }
  function dayOf(t) { return Math.floor(t / DAY); }
  function wdOf(d) { return ((d % 7) + 7) % 7; }
  function weekOf(t) { return Math.floor(dayOf(t) / 7); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  /* A minute of the day as a clock says it: 570 is 09:30, and the end of the day is 24:00. */
  function clock(m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function hm(t) { return clock(t - dayOf(t) * DAY); }
  /* An end on the stroke of midnight belongs to the day before it: 24:00. */
  function endHm(t) { return clock(t - dayOf(t - 1) * DAY); }
  function monthDay(d) { var x = dateOf(d); return MONTHS[x.getMonth()] + ' ' + x.getDate(); }
  function dayWord(d) {
    var n = d - dayOf(NOW);
    return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : WD[wdOf(d)] + ', ' + monthDay(d);
  }
  /* "today at 16:00", "Fri, Nov 13 at 10:00": how a toast says when. */
  function atWords(t) { var w = dayWord(dayOf(t)); return (w === 'Today' || w === 'Tomorrow' ? w.toLowerCase() : w) + ' at ' + hm(t); }
  function weekRange(w) { return monthDay(w * 7) + ' – ' + monthDay(w * 7 + 6); }
  function lenLabel(m) { return m < 60 ? m + ' min' : m % 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : (m / 60) + ' h'; }
  /* How long a call starting at t really is: it stops at the end of its day rather than running into the next. */
  function lenAt(t, len) { return Math.min(len, (dayOf(t) + 1) * DAY - t); }
  function names(list) { return list.length <= 1 ? (list[0] || '') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1]; }

  /* ---------------------------------------------------------------- people */
  var PEOPLE = {
    priya: { id: 'priya', name: 'Priya Raman', first: 'Priya', sub: 'Product' },
    kofi: { id: 'kofi', name: 'Kofi Asante', first: 'Kofi', sub: 'Design lead' },
    maya: { id: 'maya', name: 'Maya Chen', first: 'Maya', sub: 'Finance' },
    aiko: { id: 'aiko', name: 'Aiko Tanaka', first: 'Aiko', sub: 'Engineering' },
    ines: { id: 'ines', name: 'Ines Moreau', first: 'Ines', sub: 'Co-founder' },
    jonas: { id: 'jonas', name: 'Jonas Weber', first: 'Jonas', sub: 'jonas@harbourline.co', outside: true, place: 'Berlin', ahead: 60 }
  };
  var GROUPS = {
    leads: { id: 'leads', name: 'Leads', people: ['priya', 'kofi', 'ines'] },
    product: { id: 'product', name: 'Product', people: ['priya', 'kofi', 'aiko', 'maya'] }
  };
  /* Who Who offers before anything's typed: the people and groups you meet most, and the guest you last had. */
  var OFTEN = ['priya', 'kofi', 'maya', 'g:leads', 'g:product', 'jonas', 'aiko', 'ines'];

  /* ---------------------------------------------------------------- your calendar */
  /* k: past (happened), soon (an Alcove call ahead), cal (a meeting on Google Calendar), invite (waiting for your answer). */
  var MINE = [];
  function ev(d, s, e, t, k, who) { MINE.push({ id: 'e' + MINE.length, d: d, s: s, e: e, t: t, k: k, who: who || '' }); }
  for (var d0 = 0; d0 < 5; d0++) ev(d0, H(9, 30), H(9, 45), 'Team standup', d0 < 4 ? 'past' : 'soon', 'priya,kofi,maya');
  ev(0, H(14), H(14, 45), 'Hiring sync', 'past', 'ines');
  ev(1, H(11), H(12), 'Launch planning', 'past', 'priya,ines');
  ev(2, H(15), H(15, 30), 'Pricing sync', 'past', 'maya');
  ev(2, H(16), H(16, 30), 'Harbourline weekly', 'past');
  ev(3, H(10, 30), H(11, 30), 'Design review', 'soon', 'priya,kofi,aiko');
  ev(3, H(13), H(13, 30), 'Pricing review', 'soon', 'maya');
  ev(4, H(14), H(15), 'Design crit', 'invite', 'kofi');
  ev(4, H(16), H(16, 30), 'Harbourline weekly', 'cal');
  for (var w0 = 1; w0 < 9; w0++) {
    var b0 = w0 * 7;
    for (var i0 = 0; i0 < 5; i0++) ev(b0 + i0, H(9, 30), H(9, 45), 'Team standup', 'soon', 'priya,kofi,maya');
    ev(b0, H(14), H(14, 45), 'Hiring sync', 'soon', 'ines');
    ev(b0 + 1, H(11), H(12), 'Launch planning', 'soon', 'priya,ines');
    if (w0 === 1) ev(b0 + 2, H(10), H(11), 'Board prep', 'cal');
    ev(b0 + 3, H(10, 30), H(11, 30), 'Design review', 'soon', 'priya,kofi,aiko');
    ev(b0 + 4, H(16), H(16, 30), 'Harbourline weekly', 'cal');
  }

  /* ---------------------------------------------------------------- everyone else's busy time */
  var BUSY = { priya: [], kofi: [], maya: [], aiko: [], ines: [] };
  function busy(id, d, s, e) { BUSY[id].push({ d: d, s: s, e: e }); }
  MINE.forEach(function (x) { x.who.split(',').forEach(function (id) { if (BUSY[id]) busy(id, x.d, x.s, x.e); }); });
  busy('priya', 3, H(11), H(12, 30)); busy('priya', 3, H(14), H(15)); busy('priya', 4, H(10), H(11, 30)); busy('priya', 4, H(14), H(15));
  busy('kofi', 3, H(15), H(16)); busy('kofi', 4, H(9), H(10)); busy('kofi', 4, H(12), H(13));
  busy('maya', 3, H(12), H(13, 30)); busy('maya', 4, H(10), H(12));
  busy('aiko', 3, H(13, 30), H(15)); busy('aiko', 4, H(15), H(16));
  busy('ines', 3, H(12), H(14)); busy('ines', 4, H(9), H(11));
  var seed = 11;
  var rnd = function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  ['priya', 'kofi', 'maya', 'aiko', 'ines'].forEach(function (id) {
    for (var d = 7; d < 63; d++) {
      if (wdOf(d) > 4) continue;
      var n = 1 + Math.floor(rnd() * 3);
      for (var k = 0; k < n; k++) {
        var s = H(10) + Math.floor(rnd() * 13) * 30, len = 30 * (1 + Math.floor(rnd() * 3));
        busy(id, d, s, Math.min(s + len, H(18)));
      }
    }
  });

  /* ---------------------------------------------------------------- who's free */
  var at = function (x) { return x.d * DAY + x.s; };
  var to = function (x) { return x.d * DAY + x.e; };
  function mineIn(a, b) { return MINE.filter(function (x) { return at(x) < b && to(x) > a; }); }
  function busyIn(ids, a, b) { return ids.filter(function (id) { return (BUSY[id] || []).some(function (x) { return at(x) < b && to(x) > a; }); }); }
  function isFree(t, len, ids) { var e = t + lenAt(t, len); return !mineIn(t, e).length && !busyIn(ids, t, e).length; }
  /* The soonest half hour from `start`, on a weekday within working hours, when you and everyone readable are free. */
  function soonestFrom(start, len, ids) {
    var t = Math.ceil(Math.max(start, NOW + 10) / 30) * 30;
    for (var guard = 0; guard < 4000; guard++, t += 30) {
      var d = dayOf(t), m = t - d * DAY;
      if (wdOf(d) > 4 || m < WORK_FROM || m + len > WORK_TO) continue;
      if (isFree(t, len, ids)) return t;
    }
    return Math.ceil((NOW + 10) / 30) * 30;
  }
  /* Remembered: the week asks the same question on every frame while you point and drag. */
  var memo = {};
  function soonest(len, ids) { var k = 's' + len + '|' + ids.join(','); if (!(k in memo)) memo[k] = soonestFrom(NOW, len, ids); return memo[k]; }
  /*
   * Letting a guest pick: the time you had, then the same time on the next two days you're free then, or the soonest
   * you're free on that day. Never random: each one says why it's there.
   */
  function offerFrom(t, len) {
    var k = 'o' + t + '|' + len;
    if (!(k in memo)) memo[k] = offerAfresh(t, len);
    return memo[k];
  }
  function offerAfresh(t, len) {
    var out = [t], d = dayOf(t), m = t - d * DAY;
    for (var k = 1; out.length < 3 && k < 40; k++) {
      var dd = d + k;
      if (wdOf(dd) > 4) continue;
      var c = dd * DAY + m;
      if (m >= WORK_FROM && m + len <= WORK_TO && isFree(c, len, [])) { out.push(c); continue; }
      var s = soonestFrom(dd * DAY + WORK_FROM, len, []);
      if (dayOf(s) === dd) out.push(s);
    }
    return out;
  }

  /* Everyone a list of picks stands for: groups opened into their people, each once. */
  function expand(picks) {
    var out = [];
    picks.forEach(function (p) {
      var ids = p.indexOf('g:') === 0 ? (GROUPS[p.slice(2)] || { people: [] }).people : [p];
      ids.forEach(function (id) { if (out.indexOf(id) < 0) out.push(id); });
    });
    return out;
  }

  /* ---------------------------------------------------------------- states, each a step a journey can draw */
  /*
   * A step is what the board's state starts as. mode: sched (scheduling) or calls (the Calls page's week).
   * who: picks, t: a time you chose (null: the soonest), len: minutes, pick: letting the guest pick, opts: the times
   * offered, active: the lit one, week: weeks from this one, scroll: the hour at the top of the week, hover: a ghost
   * under the pointer ({ d, m }), hot: a control ringed to show it's the next press.
   */
  var TH = 3, FR = 4;
  var STEPS = {
    open: {},
    calls: { mode: 'calls', hot: 'schedule' },
    openHover: { hover: { d: FR, m: H(10) } },
    openMoved: { t: FR * DAY + H(10), touched: true },
    whoOpen: { menu: 'who', hot: 'p-priya' },
    withPriya: { who: ['priya'], menu: 'who', hot: 'p-kofi' },
    withPriyaKofi: { who: ['priya', 'kofi'] },
    clash: { who: ['priya', 'kofi'], t: TH * DAY + H(14), touched: true, hot: 'next' },
    clashFixed: { who: ['priya', 'kofi'], t: TH * DAY + H(16), touched: true },
    len2h: { t: TH * DAY + H(14), len: 120, touched: true, hover: { d: TH, m: H(15) } },
    len2hMoved: { t: TH * DAY + H(15), len: 120, touched: true, scroll: 14, hover: { d: TH, m: H(23) } },
    len2hLate: { t: TH * DAY + H(23), len: 120, touched: true, scroll: 14 },
    len2hBack: { t: TH * DAY + H(14), len: 120, touched: true, scroll: 10 },
    lenGrip: { t: TH * DAY + H(14), len: 90, touched: true, scroll: 10, hot: 'grip' },
    scrollLate: { scroll: 14, hover: { d: FR, m: H(23, 30) } },
    scrollEarly: { scroll: 0 },
    startOpen: { t: FR * DAY + H(10), touched: true, menu: 'start', hot: 'st-390' },
    typedEarly: { t: FR * DAY + H(6, 30), touched: true, scroll: 5 },
    nextHot: { hot: 'next-week' },
    nextWeek: { week: 1, hot: 'today' },
    nextWeekPressed: { week: 1, t: 11 * DAY + H(14, 30), touched: true, hot: 'date' },
    dayPicker: { week: 1, t: 11 * DAY + H(14, 30), touched: true, menu: 'date', calMonth: 1, hot: 'cal-22' },
    dayPicked: { week: 2, t: 22 * DAY + H(14, 30), touched: true },
    dragFri: { dragT: FR * DAY + H(10, 30) },
    dragEdge: { dragT: 9 * DAY + H(15, 30), edge: 'next' },
    dragNext: { week: 1, dragT: 14 * DAY + H(15, 30) },
    dragDropped: { week: 1, t: 14 * DAY + H(15, 30), touched: true },
    jonas: { who: ['jonas'], hot: 'pick' },
    pickOn: { who: ['jonas'], pick: true, active: 0, hot: 'opt-1' },
    pickSecond: { who: ['jonas'], pick: true, active: 1 },
    pickSecondMoved: { who: ['jonas'], pick: true, active: 1, moved: [null, FR * DAY + H(15), null], hot: 'len' },
    pickLen: { who: ['jonas'], pick: true, active: 1, moved: [null, FR * DAY + H(15), null], menu: 'len', hot: 'lenopt-60' },
    pickUntick: { who: ['jonas'], pick: true, active: 1, moved: [null, FR * DAY + H(15), null], len: 60, off: [false, false, true], hot: 'go' },
    ready: { who: ['priya', 'kofi'], title: 'Onboarding review', titled: true, hot: 'go' },
    done: { mode: 'calls', made: { t: TH * DAY + H(16), len: 45, title: 'Onboarding review' }, toast: 'Scheduled for today at 16:00. Google Calendar invites Priya and Kofi.', undo: true },
    pickDone: { mode: 'calls', held: [TH * DAY + H(11, 30), FR * DAY + H(15)], heldLen: 60, toast: 'Link copied for Jonas. The call waits until Jonas picks a time.' }
  };

  /* ---------------------------------------------------------------- the journeys */
  var JOURNEYS = [
    { name: '1 · It opens ready, on the soonest time you’re free', frames: [
      { step: 'calls', t: 'On Calls, press Schedule a call.' },
      { step: 'open', t: 'The week fills the page with the call’s editor beside it. A time is already picked: the soonest you’re free, today at 11:30. The week starts today, so every day on it is open.' },
      { step: 'openHover', t: 'The week works straight away, with nobody added. Point at a time: the call’s outline follows, at its length.' },
      { step: 'openMoved', t: 'Press. The call moves there and keeps its 45 minutes.' }
    ] },
    { name: '2 · Drag it to any day, or any week', frames: [
      { step: 'dragFri', t: 'Grab the call and drag it to any day. It follows the pointer a quarter hour at a time, and lifts while it moves.' },
      { step: 'dragEdge', t: 'Hold it at the week’s edge…' },
      { step: 'dragNext', t: '…and the next week slides in under it. Keep dragging to Monday.' },
      { step: 'dragDropped', t: 'Let go. It’s there, still 45 minutes. The day button opens a month for anywhere further.' }
    ] },
    { name: '3 · Add people, and the time follows them', frames: [
      { step: 'whoOpen', t: 'Press Add people. The people and groups you meet most open under it.' },
      { step: 'withPriya', t: 'Add Priya. The times Priya is busy are shaded, and the call moves to the soonest you’re both free: 15:00.' },
      { step: 'withPriyaKofi', t: 'Add Kofi. It moves to 16:00, the soonest you’re all free. It only moves while you haven’t picked a time yourself.' },
      { step: 'clash', t: 'Press 14:00, when Priya is busy. It says so, and offers the next time you’re all free.' },
      { step: 'clashFixed', t: 'Press it. The call is at 16:00.' }
    ] },
    { name: '4 · Pressing a time keeps the call’s length', frames: [
      { step: 'len2h', t: 'A 2-hour call, 14:00 to 16:00. Press 15:00.' },
      { step: 'len2hMoved', t: 'It’s 15:00 to 17:00: still 2 hours. Scroll down and press 23:00.' },
      { step: 'len2hLate', t: 'It stops at midnight instead of running into Friday, and says so.' },
      { step: 'len2hBack', t: 'Press 14:00 again: it’s 2 hours again. Moving never changes the length.' },
      { step: 'lenGrip', t: 'Only the lengths, or the grip at the call’s foot, change how long it is.' }
    ] },
    { name: '5 · The day scrolls, and the week never grows', frames: [
      { step: 'open', t: 'The week opens on 08:00 to 18:00.' },
      { step: 'scrollLate', t: 'Scroll down to 23:00, with room to press 23:30.' },
      { step: 'scrollEarly', t: 'Scroll up to midnight.' },
      { step: 'startOpen', t: 'Or press the start time: every quarter hour, in a list. Pick 06:30.' },
      { step: 'typedEarly', t: 'The week scrolls to it. The hours shown never change.' }
    ] },
    { name: '6 · The week says which days it shows', frames: [
      { step: 'nextHot', t: 'The heading names the days, starting today: Nov 12 – Nov 18. Press the next week.' },
      { step: 'nextWeek', t: 'Nov 19 – Nov 25. Today appears beside the arrows, to come back.' },
      { step: 'nextWeekPressed', t: 'Press a time there, and the call moves to it.' },
      { step: 'dayPicker', t: 'Or press the day: a month opens. Go to December and pick the 1st.' },
      { step: 'dayPicked', t: 'The call and the week go there, keeping the time. Across a month, the heading names both: Nov 26 – Dec 2.' }
    ] },
    { name: '7 · Letting Jonas pick a time', frames: [
      { step: 'jonas', t: 'Add Jonas, from outside Vandelay. One time, like anyone else’s call: Let Jonas pick the time is off.' },
      { step: 'pickOn', t: 'Turn it on. Three times to offer: yours, then the same time on the next two days you’re free. The first is lit.' },
      { step: 'pickSecond', t: 'Press the second time. It’s lit, here and on the week. Its tick stays as it was.' },
      { step: 'pickSecondMoved', t: 'Press Fri 15:00 on the week. The second time moves there, and stays second and lit.' },
      { step: 'pickLen', t: 'Press the length and pick 1 h. Every time offered is an hour long.' },
      { step: 'pickUntick', t: 'Untick the third: it’s left out, and dashed on the week. Jonas picks from two.' }
    ] },
    { name: '8 · Schedule', frames: [
      { step: 'ready', t: 'Press Schedule.' },
      { step: 'done', t: 'Back on Calls, the call is on the week, and a toast says who was invited, with Undo.' }
    ] }
  ];

  /* What testers said, and what the design does now. */
  var CHANGES = [
    { said: 'The calendar always says “Today”.', now: 'The week’s heading names its days: Nov 12 – Nov 18. Today only shows once you’ve moved to another week, to come back.', j: '6' },
    { said: 'The calendar is frozen until you add people.', now: 'It works from the moment it opens, with a time already picked. Add people before or after.', j: '1' },
    { said: 'The suggested times are random.', now: 'No suggestions. The time starts as the soonest you’re free, and follows the people you add until you pick one yourself. A clash offers the next time you’re all free.', j: '1 · 3' },
    { said: 'Picking is on by default.', now: 'Let Jonas pick starts off. A guest from outside gets one time, like anyone else, until you turn it on.', j: '7' },
    { said: 'In pick mode you can’t say which time you’re adjusting.', now: 'Each time is a card: press it to light it, here and on the week. Its tick is its own button, to offer it or not.', j: '7' },
    { said: 'Moving a time jumps it to another slot, or resets it.', now: 'Times never re-sort. The lit one stays lit until you press another, and a time you move stays where you put it.', j: '7' },
    { said: 'Small blocks show names and cut off the time.', now: 'The time comes first in every block. A name only shows when there’s room for a whole line, with room left under it.', j: 'Blocks' },
    { said: 'Pressing a new start time changes the length.', now: 'Pressing moves the call and keeps its length. Only the lengths or the grip change it. At the end of the day it stops at midnight.', j: '4' },
    { said: 'The hours stretch when a call is late in the day.', now: 'The day scrolls instead: 08:00 to 18:00 to start, up to midnight, and down to 23:00 with room for 23:30.', j: '5' },
    { said: 'The call is stuck on one day.', now: 'Drag it to any day; hold it at the week’s edge to carry it into the next. The week starts today, so every day on it is open, and the day opens a month for anywhere further.', j: '2' }
  ];

  AH.SK = {
    DAY: DAY, WEEK: WEEK, NOW: NOW, WORK_FROM: WORK_FROM, WORK_TO: WORK_TO, H: H,
    dayOf: dayOf, wdOf: wdOf, weekOf: weekOf, clock: clock, hm: hm, endHm: endHm, monthDay: monthDay, dayWord: dayWord,
    atWords: atWords, weekRange: weekRange, lenLabel: lenLabel, lenAt: lenAt, names: names, WD: WD, WD_LONG: WD_LONG,
    PEOPLE: PEOPLE, GROUPS: GROUPS, OFTEN: OFTEN, MINE: MINE, BUSY: BUSY,
    mineIn: mineIn, busyIn: busyIn, isFree: isFree, soonest: soonest, soonestFrom: soonestFrom, offerFrom: offerFrom, expand: expand,
    STEPS: STEPS, JOURNEYS: JOURNEYS, CHANGES: CHANGES
  };
})();
