/*
 * The shared world behind every option: the data (a day on Home, a full day, a first day),
 * the sky, and one state model. Each layout is only markup over this, so all three do the same things.
 */
(function () {
  var PALS = window.ALCOVE_PALS;

  /* Lucide, as the app's Icon uses it. */
  var I = {
    plus: 'M5 12h14M12 5v14',
    video: 'M16 13l5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-8a2 2 0 0 1 2 -2z',
    search: 'M21 21l-4.34-4.34M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0',
    cal: 'M8 2v3M16 2v3M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2zM3 9h18',
    check: 'M20 6 9 17l-5-5',
    x: 'M18 6 6 18M6 6l12 12',
    right: 'M5 12h14M12 5l7 7-7 7',
    left: 'M12 19l-7-7 7-7M19 12H5',
    link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
    lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-7a2 2 0 0 1 2 -2zM7 11V7a5 5 0 0 1 10 0v4',
    sealed: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1zM9 12l2 2 4-4',
    mic: 'M12 19v3M19 10v2a7 7 0 0 1-14 0v-2M12 2h0a3 3 0 0 1 3 3v7a3 3 0 0 1 -3 3h0a3 3 0 0 1 -3 -3v-7a3 3 0 0 1 3 -3z',
    people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3.128a4 4 0 0 1 0 7.744M22 21v-2a4 4 0 0 0-3-3.87M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0',
    notes: 'M2 6h4M2 10h4M2 14h4M2 18h4M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-16a2 2 0 0 1 2 -2zM9.5 8h5M9.5 12H16M9.5 16H14',
    recordDot: 'M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0',
    home: 'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    down: 'M6 9l6 6 6-6',
    ask: 'M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01',
    copy: 'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2zM4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2',
    share: 'M12 2v13M16 6l-4-4-4 4M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8',
    decide: 'M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76ZM16 9l-5.5 5.5L8 12',
    own: 'M16 11l2 2 4-4M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0',
    wave: 'M2 13a2 2 0 0 0 2-2V7a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0V4a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0v-4a2 2 0 0 1 2-2',
    todo: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0M16 9l-5.5 5.5L8 12'
  };

  /* ------------------------------------------------------------------ colour */
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function r3(n) { return Math.round(n * 1000) / 1000; }
  function ok(t, a) { return 'oklch(' + r3(t[0]) + ' ' + r3(t[1]) + ' ' + r3(t[2]) + (a === undefined ? '' : ' / ' + a) + ')'; }
  function grad(stops, dir) { return 'linear-gradient(' + dir + ' in oklch, ' + stops.map(function (s) { return ok(s) + ' ' + s[3] + '%'; }).join(', ') + ')'; }

  /* The sky keeps the palette's colours all day. Mornings lean pink, evenings burn down to embers. */
  function skyStops(m, mode, hour) {
    var eve = clamp((hour - 17) / 4, 0, 1), morn = clamp((11 - hour) / 4, 0, 1), n = m.sky.length;
    return m.sky.map(function (s, i) {
      var w = i / (n - 1), L = s[0], C = s[1], H = s[2];
      if (mode === 'dark') { L -= eve * (0.03 + 0.36 * w * w); C *= 1 - 0.2 * eve; } else { L -= eve * (0.015 + 0.07 * w); }
      if (w > 0.5) { H = (H - 18 * morn + 360) % 360; C *= 1 - 0.1 * morn; }
      return [L, C, H, s[3]];
    });
  }

  function skyLow(id, hour, land, tall) {
    var m = PALS[id].dark;
    return 'linear-gradient(to bottom in oklch, ' + skyStops(m, 'dark', hour).map(function (s) {
      return ok(s) + ' calc(100% - ' + Math.round(land + (100 - s[3]) / 100 * tall) + 'px)';
    }).join(', ') + ')';
  }

  var MAP = { ground: 'ground', surface: 'surface', raised: 'raised', well: 'well', line: 'line', 'line-strong': 'lineStrong', ink: 'ink', 'ink-2': 'ink2', 'ink-3': 'ink3', press: 'press', 'on-press': 'onPress', now: 'now', notes: 'notes', focus: 'focus', caution: 'caution', 'caution-soft': 'cautionSoft', rec: 'rec', 'rec-soft': 'recSoft' };
  function rootStyle(id, mode, hour) {
    var m = PALS[id][mode];
    var out = Object.keys(MAP).filter(function (k) { return m[MAP[k]]; }).map(function (k) { return '--' + k + ': ' + ok(m[MAP[k]]); });
    var eve = clamp((hour - 17) / 4, 0, 1);
    out.push('--sky: ' + grad(skyStops(m, mode, hour), 'to bottom'));
    out.push('--page: ' + (m.page ? grad(m.page, '158deg') : ok(m.ground)));
    out.push('--land: ' + (m.glass ? 'transparent' : ok(m.ground)));
    out.push('--panel: ' + (m.glass ? ok(m.surface, 0.62) : ok(m.surface)));
    out.push('--blur: ' + (m.glass ? 'blur(26px) saturate(1.3)' : 'none'));
    out.push('--sun-core: ' + ok(m.sun[0]));
    out.push('--sun-edge: ' + ok(m.sun[1]));
    out.push('--sun-glow: ' + ok(m.sun[2]));
    out.push('--sun-dim: ' + (1 - 0.55 * eve));
    return out.join('; ');
  }

  /* ------------------------------------------------------------------ the three moments */
  var FROM = 8, TO = 19;
  function tp(h) { return clamp((h - FROM) / (TO - FROM), 0, 1); }

  var ITEMS_TODAY = [
    { id: 'd1', at: '06:12', kind: 'decide', label: 'Confirm a decision', text: 'Orders placed before the move ship from the old warehouse.', from: 'Art’s call', note: 'n1', yes: 'Confirm', no: 'It wasn’t decided', yesDone: 'Confirmed', noDone: 'Not a decision' },
    { id: 'a1', at: '04:10', kind: 'own', label: 'Is this yours?', text: 'Book the movers for the 14th', from: 'Art’s call', note: 'n1', yes: 'Take it on', no: 'Not mine', yesDone: 'Yours, due Friday', noDone: 'Not yours', due: 'Friday' },
    { id: 'a2', at: '09:32', kind: 'own', label: 'Is this yours?', text: 'Update the delivery times on the order page', from: 'Art’s call', note: 'n1', yes: 'Take it on', no: 'Not mine', yesDone: 'Yours, no date yet', noDone: 'Not yours' }
  ];
  var NOTE_N1 = {
    id: 'n1', hour: 11.97, title: 'Art’s call', when: 'Today, 14 min', at: 'Today at 11:58, 14 min', faces: 'ines', with: 'You and Ines', tag: '1 to confirm', who: 'Only you',
    excerpt: 'Art walks Ines through moving the warehouse to the new site, from booking the movers to which suppliers come too.',
    summary: 'Art walks Ines through moving the warehouse to the new site, from booking the movers to which suppliers come too. They agree that orders placed before the move ship from the old warehouse, and that the order page shows the new delivery times once the date is set.',
    chapters: [{ at: '00:00', t: 'The plan' }, { at: '04:10', t: 'Movers and dates' }, { at: '09:32', t: 'The order page' }]
  };

  var SCENES = {
    today: {
      id: 'today', date: 'Wednesday 4 November', clock: '16:12', hour: 16.2, chrome: true,
      calls: [{ id: 'c1', from: 11.97, to: 12.2, time: '11:58', title: 'Art’s call', sub: 'Notes ready', state: 'past', note: 'n1' }],
      ahead: { id: 'e1', short: 'Tomorrow 18:15', title: 'Focus time' },
      items: ITEMS_TODAY, mine: [], notes: [NOTE_N1],
      coming: [
        { id: 'e1', day: 'Tomorrow', time: '18:15', end: '22:15', title: 'Focus time', sub: 'Just you, on Google Calendar', calendar: true, when: 'Thu 5 Nov, 18:15 – 22:15', who: 'Just you' },
        { id: 'e2', day: 'Friday', time: '10:00', end: '10:30', title: 'Product sync', sub: 'You and Ines', calendar: true, when: 'Fri 6 Nov, 10:00 – 10:30', who: 'You and Ines', faces: 'ines' },
        { id: 'e3', day: 'Monday', time: '18:15', end: '22:15', title: 'Focus time', sub: 'Just you, on Google Calendar', calendar: true, when: 'Mon 9 Nov, 18:15 – 22:15', who: 'Just you' }
      ],
      moreLabel: '9 more in the next 7 days', week: [1, 2, 3, 0, 1, 4, 2], nextWhen: 'Tomorrow, 18:15', pinned: [], groups: []
    },
    soon: {
      id: 'soon', date: 'Wednesday 4 November', clock: '10:26', hour: 10.43,
      calls: [
        { id: 'c0', from: 9, to: 9.33, time: '09:00', title: 'Team standup', sub: 'Notes ready', state: 'past', note: 'n2' },
        { id: 'c1', from: 10.5, to: 11.25, time: '10:30', title: 'Design review', sub: 'In 4 minutes', state: 'next', card: 'k1' },
        { id: 'c2', from: 11.5, to: 12, time: '11:30', title: 'Pricing follow-up', sub: 'Maya, Lena', state: 'later', card: 'k2' },
        { id: 'c3', from: 14, to: 14.5, time: '14:00', title: 'Intro with Harbourline', sub: 'Jamie, Diego', state: 'later', card: 'k3' },
        { id: 'c4', from: 16.5, to: 17, time: '16:30', title: '1:1 with Priya', sub: 'Every Wednesday', state: 'later', card: 'k4' }
      ],
      ahead: { id: 'k5', short: 'Tomorrow 09:00', title: 'Team standup' },
      items: [
        { id: 'd1', at: '03:15', kind: 'decide', label: 'Confirm a decision', text: 'The new onboarding ships behind a flag on 12 November.', from: 'Team standup', note: 'n2', yes: 'Confirm', no: 'It wasn’t decided', yesDone: 'Confirmed', noDone: 'Not a decision' },
        { id: 'a1', at: '12:48', kind: 'own', label: 'Is this yours?', text: 'Send Kofi the pricing draft before Friday', from: 'Pricing sync', note: 'n3', yes: 'Take it on', no: 'Not mine', yesDone: 'Yours, due Friday', noDone: 'Not yours', due: 'Friday' }
      ],
      mine: [
        { id: 'y1', text: 'Review the launch checklist', from: 'Team standup', due: 'Today', soon: true },
        { id: 'y2', text: 'Write up the Harbourline proposal', from: 'Harbourline prep', due: 'Friday' }
      ],
      notes: [
        { id: 'n2', hour: 9, title: 'Team standup', when: 'Today, 20 min', at: 'Today at 09:00, 20 min', faces: 'priya,kofi,maya', with: 'You, Priya, Kofi and Maya', tag: '1 to confirm', excerpt: 'Onboarding is ready to go out behind a flag. Kofi flags that the launch checklist still has two open items.', summary: 'Onboarding is ready to go out behind a flag. Kofi flags that the launch checklist still has two open items, and the team agrees to look at them before the design review.', chapters: [{ at: '00:00', t: 'Onboarding' }, { at: '08:40', t: 'Launch checklist' }] },
        { id: 'n3', hour: 15, short: 'Tue', title: 'Pricing sync', when: 'Yesterday, 32 min', at: 'Yesterday at 15:00, 32 min', faces: 'maya,lena', with: 'You, Maya and Lena', tag: '1 follow-up', excerpt: 'Maya compares seat pricing with usage pricing. Everyone leans towards minutes of notes as the thing people pay for.', summary: 'Maya compares seat pricing with usage pricing. Everyone leans towards minutes of notes as the thing people pay for, with a free tier for calls without notes.', chapters: [{ at: '00:00', t: 'Seats or usage' }, { at: '17:05', t: 'Free tier' }] },
        { id: 'n4', hour: 11, short: 'Mon', title: 'Harbourline prep', when: 'Monday, 18 min', at: 'Monday at 11:00, 18 min', faces: 'jamie', with: 'You and Jamie', tag: 'Shared with you', excerpt: 'Jamie lays out what Diego cares about before the intro: where the notes are written, and who can read them.', summary: 'Jamie lays out what Diego cares about before the intro: where the notes are written, and who can read them. They agree to lead with confidential compute.', chapters: [{ at: '00:00', t: 'What Diego cares about' }] }
      ],
      coming: [
        { id: 'k1', day: 'Today', time: '10:30', end: '11:15', title: 'Design review', sub: 'Priya, Kofi, Aiko', faces: 'priya,kofi,aiko', alcove: true, when: 'Today, 10:30 – 11:15', who: 'Priya, Kofi and Aiko', notesOn: true },
        { id: 'k2', day: 'Today', time: '11:30', end: '12:00', title: 'Pricing follow-up', sub: 'Maya, Lena', faces: 'maya,lena', alcove: true, when: 'Today, 11:30 – 12:00', who: 'Maya and Lena', notesOn: true },
        { id: 'k3', day: 'Today', time: '14:00', end: '14:30', title: 'Intro with Harbourline', sub: 'Jamie, Diego', faces: 'jamie,diego', alcove: true, when: 'Today, 14:00 – 14:30', who: 'Jamie and Diego', notesOn: true },
        { id: 'k4', day: 'Today', time: '16:30', end: '17:00', title: '1:1 with Priya', sub: 'Every Wednesday', faces: 'priya', alcove: true, when: 'Today, 16:30 – 17:00', who: 'Priya', notesOn: true }
      ],
      moreLabel: '14 more in the next 7 days', week: [5, 3, 4, 0, 0, 4, 3], nextWhen: 'In 4 minutes, at 10:30',
      pinned: [{ id: 'n3', t: 'Pricing sync' }, { id: 'n4', t: 'Harbourline prep' }],
      groups: [{ t: 'Product', n: 6 }, { t: 'Design', n: 4 }]
    },
    first: {
      id: 'first', date: 'Wednesday 4 November', clock: '16:12', hour: 16.2, first: true,
      calls: [], ahead: null, items: [], mine: [], notes: [], coming: [], week: [0, 0, 0, 0, 0, 0, 0], pinned: [], groups: [],
      starts: [
        { id: 's1', t: 'Read an example note', sub: 'See what Alcove writes after a call.', icon: 'notes' },
        { id: 's2', t: 'Connect your calendar', sub: 'Your meetings line up here, and you can move them to Alcove.', icon: 'cal' },
        { id: 's3', t: 'Invite your team', sub: 'Everyone you invite gets the notes from your calls.', icon: 'people' }
      ]
    }
  };

  /*
   * Home: somewhere to start a call, then what's yours. People join from their calendar, so nothing here
   * promotes the next event, and a calendar block with nobody else on it (the "Block sleep" problem) never shows.
   */
  var HOME = {
    today: assign({}, SCENES.today, {
      ahead: null, items: [ITEMS_TODAY[0], ITEMS_TODAY[2]],
      mine: [
        { id: 'y1', text: 'Book the movers for the 14th', from: 'Art’s call', note: 'n1', at: '04:10', due: 'Friday' },
        { id: 'y2', text: 'List which suppliers move with us', from: 'Art’s call', note: 'n1', at: '04:52', due: 'Monday' }
      ],
      coming: SCENES.today.coming.filter(function (c) { return c.faces; }), moreLabel: '', week: [1, 0, 1, 0, 0, 0, 0],
      people: [{ id: 'ines', name: 'Ines' }]
    }),
    soon: assign({}, SCENES.soon, {
      mine: [
        { id: 'y1', text: 'Review the launch checklist', from: 'Team standup', note: 'n2', at: '08:40', due: 'Today', soon: true },
        { id: 'y2', text: 'Write up the Harbourline proposal', from: 'Harbourline prep', note: 'n4', at: '05:20', due: 'Friday' }
      ],
      imminent: { id: 'k1', title: 'Design review', when: 'In 4 minutes', faces: 'priya,kofi,aiko' },
      people: [{ id: 'priya', name: 'Priya Raman' }, { id: 'kofi', name: 'Kofi Asante' }, { id: 'aiko', name: 'Aiko Tanaka' }, { id: 'maya', name: 'Maya Chen' }]
    }),
    first: assign({}, SCENES.first, { people: [] })
  };

  /* ------------------------------------------------------------------ steps: where each journey frame starts */
  var ALL_DONE = { d1: 'yes', a1: 'yes', a2: 'no' };
  var STEPS = {
    home: {},
    hotStart: { hot: 'start' },
    choose: { modal: 'choose', hot: 'later' },
    who: { modal: 'who', guests: ['ines'], hot: 'next' },
    when: { modal: 'when', guests: ['ines'], slot: 't17', hot: 'next' },
    details: { modal: 'details', guests: ['ines'], slot: 't17', hot: 'schedule' },
    scheduled: { scheduled: true, toast: 'Scheduled. Google Calendar invites Ines.', stay: true },
    hotConfirm: { hot: 'yes-d1' },
    confirmed: { done: { d1: 'yes' }, hot: 'yes-a1' },
    answered: { done: { d1: 'yes', a1: 'yes' }, hot: 'no-a2' },
    clear: { done: ALL_DONE, settled: true },
    hotAsk: { hot: 'ask' },
    ask: { ask: 'open', hot: 'q0' },
    answer: { ask: 'answer', q: 'What did we decide this week?', hot: 'source' },
    hotNote: { hot: 'note' },
    note: { page: 'note', noteId: 'n1' },
    notes: { page: 'notes' },
    hotCard: { hot: 'ahead' },
    card: { card: 'e1', hot: 'move' },
    moved: { card: 'e1', moved: { e1: true }, toast: 'Moved to Alcove. Google tells everyone on it.', stay: true },
    hotJoin: { hot: 'primary' },
    lobby: { page: 'lobby' },
    hotGo: { hot: 'go' },
    hotLater: { hot: 'later2' },
    hotRing: { hot: 'ring' },
    ringing: { page: 'lobby', lobbyTitle: 'Call with Ines', lobbySub: 'Ines gets a ring as you join.' },
    homeConfirmed: { done: { d1: 'yes' }, hot: 'yes-a2' },
    homeAnswered: { done: { d1: 'yes', a2: 'yes' } },
    homeClear: { done: { d1: 'yes', a2: 'yes' }, settled: true },
    hotTick: { hot: 'tick-y1' },
    ticked: { ticks: { y1: true } },
    homeCard: { card: 'e2', hot: 'move' },
    homeMoved: { card: 'e2', moved: { e2: true }, toast: 'Moved to Alcove. Google tells everyone on it.', stay: true }
  };

  var WORDS = ['Nothing', 'One thing', 'Two things', 'Three things', 'Four things'];
  var SLOTS = [
    { day: 'Today', slots: [{ id: 't17', t: '17:00', label: 'Today, 17:00 – 17:30', hour: 17 }] },
    { day: 'Tomorrow', slots: [{ id: 'm10', t: '10:00', label: 'Tomorrow, 10:00 – 10:30' }, { id: 'm14', t: '14:30', label: 'Tomorrow, 14:30 – 15:00' }] },
    { day: 'Friday', slots: [{ id: 'f09', t: '09:30', label: 'Friday, 09:30 – 10:00' }, { id: 'f15', t: '15:00', label: 'Friday, 15:00 – 15:30' }] }
  ];
  var QUESTIONS = ['What did we decide this week?', 'Catch me up on Art’s call', 'Draft this week’s update'];
  var ANSWERS = {
    'What did we decide this week?': { p: 'One decision so far: orders placed before the move ship from the old warehouse, so customers don’t wait twice. It’s waiting for you to confirm.', src: 'Art’s call', at: '06:12' },
    'Catch me up on Art’s call': { p: 'You walked Ines through moving the warehouse. You agreed orders placed before the move ship from the old warehouse, and the order page gets the new delivery times once the date is set. Two follow-ups might be yours: booking the movers and the order page.', src: 'Art’s call', at: '00:00' },
    'Draft this week’s update': { p: 'This week we planned the warehouse move with Ines: the movers, the suppliers who come with us, and the order page. Next: book the movers and update the delivery times.', src: 'Art’s call', at: '04:10' }
  };

  function hashParams() {
    var out = {}, h = (typeof location !== 'undefined' && location.hash || '').replace(/^#/, '');
    h.split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) out[p[0]] = decodeURIComponent(p[1] || ''); });
    return out;
  }
  function assign() { return Object.assign.apply(Object, [{}].concat([].slice.call(arguments))); }

  /* ------------------------------------------------------------------ the model every layout renders */
  function vm(c, layout, defaults) {
    var p = c.props || {}, hs = hashParams();
    var palId = hs.pal || p.pal || defaults.pal, mode = hs.mode || p.mode || defaults.mode;
    if (!PALS[palId]) palId = defaults.pal;
    var sceneId = hs.scene || p.scene || 'today', table = layout === 'home' ? HOME : SCENES, S = table[sceneId] || table.today;
    var stepId = hs.step || p.step || 'home';
    var st = assign({ done: {}, ticks: {}, guests: [], moved: {} }, STEPS[stepId] || {}, c.state || {});
    var hour = Number(hs.hour || p.hour) || S.hour;
    var set = function (patch) { c.setState(patch); };
    var hot = function (k) { return st.hot === k ? ' is-hot' : ''; };
    var toast = function (msg, undo) {
      clearTimeout(c.__toast);
      c.setState({ toast: msg, undo: undo || null, hot: '' });
      c.__toast = setTimeout(function () { c.setState({ toast: '', undo: null }); }, 3600);
    };

    /* What's waiting, and what you've answered. Answers stay in place until you leave, so nothing jumps. */
    var openCount = 0;
    var rows = [];
    S.items.forEach(function (it) {
      var ans = st.done[it.id];
      if (!ans) openCount++;
      if (ans && st.settled) return;
      rows.push(assign({}, it, {
        open: !ans, answered: !!ans, isYes: ans === 'yes', doneText: ans === 'yes' ? it.yesDone : it.noDone, icon: it.kind === 'decide' ? I.decide : I.own, tag: it.kind === 'decide' ? 'Decision' : 'Follow-up',
        cls: (ans ? ' is-answered' : '') + (it.kind === 'decide' ? ' is-decide' : ' is-own'),
        hotYes: hot('yes-' + it.id), hotNo: hot('no-' + it.id),
        goYes: function () { var d = assign({}, st.done); d[it.id] = 'yes'; set({ done: d, hot: '' }); },
        goNo: function () { var d = assign({}, st.done); d[it.id] = 'no'; set({ done: d, hot: '' }); },
        undo: function () { var d = assign({}, st.done); delete d[it.id]; set({ done: d }); },
        goNote: function () { set({ page: 'note', noteId: it.note, hot: '' }); }
      }));
    });
    var taken = S.items.filter(function (it) { return st.settled && st.done[it.id] === 'yes' && it.kind === 'own'; })
      .map(function (it) { return { id: it.id, text: it.text, from: it.from, note: it.note, at: it.at, due: it.due || '' }; });
    var mine = S.mine.concat(taken).map(function (m) {
      var on = !!st.ticks[m.id];
      return assign({}, m, {
        on: on, cls: on ? ' is-ticked' : '', dueCls: m.soon ? ' is-soon' : '', hotTick: hot('tick-' + m.id),
        goNote: function () { if (m.note) set({ page: 'note', noteId: m.note, hot: '' }); },
        tick: function () { var t = assign({}, st.ticks); t[m.id] = !on; set({ ticks: t }); }
      });
    });

    /* The day: what's on the horizon, and what's coming. */
    var slot = null;
    SLOTS.forEach(function (d) { d.slots.forEach(function (s) { if (s.id === (st.slot || 't17')) slot = s; }); });
    var newCall = st.scheduled ? { id: 'new', from: 17, to: 17.5, time: '17:00', title: 'Call with Ines', sub: 'In 48 minutes', state: 'next', card: 'new', fresh: true } : null;
    var calls = S.calls.concat(newCall ? [newCall] : []);
    var byId = function (id) {
      if (id === 'new') return { id: 'new', title: 'Call with Ines', when: 'Today, 17:00 – 17:30', who: 'Ines', alcove: true, notesOn: true, faces: 'ines' };
      return S.coming.filter(function (x) { return x.id === id; })[0] || null;
    };
    var segs = calls.map(function (x, i) {
      var nextX = calls[i + 1] ? tp(calls[i + 1].from) : 1;
      var room = Math.max(0.09, nextX - tp(x.from));
      return assign({}, x, {
        x: tp(x.from), w: Math.max(0.012, tp(x.to) - tp(x.from)), room: Math.round(room * 1000) / 10 + '%',
        cls: 'is-' + x.state + (x.fresh ? ' is-fresh' : ''), hotCls: x.note ? hot('note') : '',
        go: function () { if (x.note) set({ page: 'note', noteId: x.note, hot: '' }); else set({ card: x.card, hot: '' }); }
      });
    });
    var comingList = (newCall ? [{ id: 'new', day: 'Today', time: '17:00', end: '17:30', title: 'Call with Ines', sub: 'Ines', faces: 'ines', alcove: true, fresh: true }] : []).concat(S.coming);
    var coming = comingList.map(function (x, i) {
      var first = i === 0 || comingList[i - 1].day !== x.day;
      return assign({}, x, {
        first: first, dayLabel: x.day, hasFaces: !!x.faces, cls: (x.fresh ? ' is-fresh' : ''), hotCls: i === 0 ? hot('ahead') : '',
        canMove: !!x.calendar && !st.moved[x.id],
        go: function () { set({ card: x.id, hot: '' }); },
        move: function () { var mv = assign({}, st.moved); mv[x.id] = true; set({ moved: mv }); toast('Moved to Alcove. Google tells everyone on it.'); }
      });
    });

    /* The sentence at the top of the page. */
    var h1, lede = '', primary, secondary;
    var openStart = function () { set({ modal: 'choose', guests: [], slot: 't17', fromCard: false, hot: '' }); };
    var startBtn = { label: 'Start a call', icon: I.plus, key: 'N', go: openStart };
    var record = { label: 'Record in the room', go: function () { toast('Record opens here. It isn’t part of this canvas.'); } };
    if (S.first) {
      h1 = 'Start a call, and Alcove writes the notes.';
      lede = 'Share the link with anyone. Everyone you invite gets the notes, written in confidential compute.';
      primary = startBtn; secondary = record;
    } else if (S.id === 'soon') {
      h1 = 'Design review starts in 4 minutes.';
      lede = 'With Priya, Kofi and Aiko. Notes are on, and everyone invited gets them.';
      primary = { label: 'Join', icon: I.video, key: 'J', go: function () { set({ page: 'lobby', hot: '' }); } };
      secondary = { label: 'Start a different call', go: openStart };
    } else {
      var until = st.scheduled ? 'Nothing else until 17:00.' : 'Nothing else until tomorrow.';
      h1 = openCount ? WORDS[openCount] + ' from this morning. ' + until : (st.scheduled ? 'You’re clear until 17:00.' : 'You’re clear until tomorrow.');
      primary = startBtn; secondary = record;
    }

    /* Notes. */
    var notes = S.notes.map(function (n, i) {
      var waiting = S.items.filter(function (it) { return it.note === n.id && !st.done[it.id]; }).length;
      var tag = n.tag;
      if (n.id === 'n1') tag = S.items.filter(function (it) { return it.kind === 'decide' && !st.done[it.id]; }).length ? '1 to confirm' : (waiting ? waiting + ' to answer' : 'All answered');
      return assign({}, n, {
        tag: tag, waiting: waiting, hasWaiting: waiting > 0, hasFaces: !!n.faces, lead: i === 0, hotCls: i === 0 ? hot('note') : '',
        go: function () { set({ page: 'note', noteId: n.id, hot: '' }); }
      });
    });
    var goAll = function () { set({ page: 'notes', hot: '' }); };

    var NAV = ['Home', 'Notes', 'Record', 'Team'];
    var page = st.page || 'home';
    var nav = NAV.map(function (label) {
      var on = (label === 'Home' && page === 'home') || (label === 'Notes' && (page === 'notes' || page === 'note'));
      return {
        label: label, icon: { Home: I.home, Notes: I.notes, Record: I.recordDot, Team: I.people }[label], cls: on ? ' is-on' : '', current: on ? 'page' : 'false',
        go: function () {
          if (label === 'Home') set({ page: 'home', card: '', ask: '' });
          else if (label === 'Notes') goAll();
          else toast(label + ' opens here. It isn’t part of this canvas.');
        }
      };
    });
    /* The phone's tab bar: the same places and Settings, with Record standing up out of it. */
    var tabs = nav.map(function (n) { return n.label === 'Record' ? assign({}, n, { cls: n.cls + ' is-rec' }) : n; }).concat([{ label: 'Settings', icon: 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0', cls: '', current: 'false', go: function () { toast('Settings opens here.'); } }]);

    /* Overlays. */
    var noteId = st.noteId || (S.notes[0] && S.notes[0].id) || 'n1';
    var noteObj = notes.filter(function (n) { return n.id === noteId; })[0] || (S.first ? assign({}, NOTE_N1, { title: 'An example note', hasFaces: true }) : null);
    var card = st.card ? byId(st.card) : null;
    var moved = !!(card && st.moved[card.id]);
    var modal = st.modal || '';
    var picked = st.guests || [];
    var hasInes = picked.indexOf('ines') >= 0;
    var ov = {
      I: I,
      mChoose: modal === 'choose', mSteps: modal === 'who' || modal === 'when' || modal === 'details', mWho: modal === 'who', mWhen: modal === 'when', mDetails: modal === 'details',
      anyModal: !!modal,
      stepA: modal === 'who' ? 'is-on' : 'is-done', stepB: modal === 'when' ? 'is-on' : modal === 'who' ? '' : 'is-done', stepC: modal === 'details' ? 'is-on' : '',
      hotNow: hot('now'), hotLater: hot('later'), hotNext: hot('next'), hotSchedule: hot('schedule'),
      closeModal: function () { set({ modal: '', hot: '' }); },
      goNow: function () { set({ modal: '', page: 'lobby', lobbyTitle: 'Art’s call', hot: '' }); },
      goLater: function () { set({ modal: 'who', hot: '' }); },
      backChoose: function () { set(st.fromCard ? { modal: '', fromCard: false } : { modal: 'choose' }); },
      goWho: function () { set({ modal: 'who' }); },
      goWhen: function () { set({ modal: 'when', hot: '' }); },
      goDetails: function () { set({ modal: 'details', hot: '' }); },
      schedule: function () {
        set({ modal: '', scheduled: true, hot: '' });
        toast('Scheduled. Google Calendar invites Ines.');
      },
      hasInes: hasInes, noGuests: !hasInes,
      toggleInes: function () { set({ guests: hasInes ? [] : ['ines'] }); },
      nextDisabled: !hasInes,
      slotDays: SLOTS.map(function (d) {
        return { day: d.day, slots: d.slots.map(function (s) { return { t: s.t, cls: s.id === (st.slot || 't17') ? ' is-on' : '', on: s.id === (st.slot || 't17') ? 'true' : 'false', go: function () { set({ slot: s.id }); } }; }) };
      }),
      slotLabel: slot ? slot.label : '',
      notesOn: st.notesOff ? false : true, notesLabel: st.notesOff ? 'Notes off' : 'Notes on', notesSub: st.notesOff ? 'Nothing is recorded' : 'Everyone invited gets them',
      toggleNotes: function () { set({ notesOff: !st.notesOff }); },

      askOpen: !!st.ask, askIdle: st.ask === 'open', askDone: st.ask === 'answer',
      q: st.q || '',
      typed: function (e) { set({ q: e.target.value }); },
      askKey: function (e) { if (e.key === 'Enter') set({ ask: 'answer', q: (e.target.value && ANSWERS[e.target.value]) ? e.target.value : QUESTIONS[0], hot: '' }); },
      closeAsk: function () { set({ ask: '', q: '', hot: '' }); },
      questions: QUESTIONS.map(function (q, i) { return { q: q, hotCls: hot('q' + i), go: function () { set({ ask: 'answer', q: q, hot: '' }); } }; }),
      answer: ANSWERS[st.q] || ANSWERS[QUESTIONS[0]],
      hotSource: hot('source'),
      openSource: function () { set({ ask: '', page: 'note', noteId: 'n1', hot: '' }); },

      cardOpen: !!card, card: card || {}, cardMoved: moved, cardCalendar: !!(card && card.calendar && !moved), cardAlcove: !!(card && (card.alcove || moved)), cardFaces: !!(card && card.faces),
      hotMove: hot('move'),
      closeCard: function () { set({ card: '', hot: '' }); },
      moveCard: function () { var mv = assign({}, st.moved); mv[st.card] = true; set({ moved: mv, hot: '' }); toast('Moved to Alcove. Google tells everyone on it.'); },
      joinCard: function () { set({ card: '', page: 'lobby', lobbyTitle: card ? card.title : '', hot: '' }); },
      copied: function () { toast('Link copied.'); },
      calendarLink: function () { toast('Opens in Google Calendar, in a new tab.'); },

      pageNote: page === 'note' && !!noteObj && layout !== 'desk', pageNotes: page === 'notes' && layout !== 'desk', pageLobby: page === 'lobby',
      note: noteObj || {}, noteRows: rows.filter(function (r) { return r.note === noteId; }), hasNoteRows: rows.filter(function (r) { return r.note === noteId; }).length > 0,
      backHome: function () { set({ page: 'home', hot: '' }); },
      notes: notes, hasNotes: notes.length > 0,
      lobbyTitle: st.lobbyTitle || (S.id === 'soon' ? 'Design review' : 'Art’s call'),
      lobbySub: st.lobbySub || (S.id === 'soon' ? 'Priya and Kofi are here. Aiko is on the way.' : 'Nobody else is here yet. Share the link to bring them in.'),
      lobbyFaces: S.id === 'soon' ? 'priya,kofi' : '', lobbyHasFaces: S.id === 'soon',
      lobbyNotes: 'Notes are on. Everyone invited gets them.',

      toast: st.toast || '', hasToast: !!st.toast
    };

    /* The sidebar is on the dark sky in both themes. */
    var PLX = window.AH && window.AH.PL;
    var footKind = hs.plan || p.plan || st.plan || 'free';
    var side = {
      foot: PLX ? assign(PLX.foot(footKind), { go: function () { if (typeof p.go === 'function') p.go('plans'); else toast('Plans opens.'); } }) : null,
      I: I, style: rootStyle(palId, 'dark', hour),
      startCls: S.id === 'soon' ? 'b-tint' : 'b-press', hotStart: st.hot === 'start' ? ' is-hot' : '', start: openStart,
      nav: nav.map(function (n) { return assign({}, n, { count: n.label === 'Home' ? openCount : 0, hasCount: n.label === 'Home' && openCount > 0 }); }),
      pinned: (S.pinned || []).map(function (x) { return assign({}, x, { go: function () { set({ page: 'note', noteId: x.id, hot: '' }); } }); }), hasPinned: (S.pinned || []).length > 0,
      groups: (S.groups || []).map(function (g) { return assign({}, g, { go: function () { toast('Team opens here. It isn’t part of this canvas.'); } }); }), hasGroups: (S.groups || []).length > 0
    };

    /* The next call, wherever a layout shows it. */
    var nextRow = comingList[0] || null;
    var nxMoved = !!(nextRow && st.moved[nextRow.id]);
    var nx = nextRow ? {
      when: nextRow.fresh ? 'Today, 17:00' : S.nextWhen, title: nextRow.title, sub: nextRow.fresh ? 'With Ines. Notes are on.' : (S.id === 'soon' ? 'With Priya, Kofi and Aiko. Notes are on.' : (nxMoved ? 'Just you. Notes are on.' : nextRow.sub)),
      faces: nextRow.faces || '', hasFaces: !!nextRow.faces,
      alcove: !!(nextRow.alcove || nxMoved), calendar: !!(nextRow.calendar && !nxMoved), soon: S.id === 'soon',
      joinCls: S.id === 'soon' ? 'b-press' : 'b-line',
      go: function () { set({ card: nextRow.id, hot: '' }); },
      join: function () { set({ page: 'lobby', lobbyTitle: nextRow.title, hot: '' }); },
      copy: function () { toast('Link copied.'); },
      move: function () { var mv = assign({}, st.moved); mv[nextRow.id] = true; set({ moved: mv, hot: '' }); toast('Moved to Alcove. Google tells everyone on it.'); },
      openCal: function () { toast('Opens in Google Calendar, in a new tab.'); }
    } : { when: 'Your next call', title: 'Nothing scheduled yet', sub: 'Calls you schedule and meetings from your calendar show here.', faces: '', hasFaces: false, alcove: false, calendar: false, connect: true, joinCls: 'b-line' };
    nx.connectCal = function () { toast('Connect your calendar opens here. It isn’t part of this canvas.'); };

    /* Today, with now in it, then the days ahead. */
    var dayRow = function (x) { return assign({ isRow: true, isNow: false }, x); };
    var agenda = [];
    if (!S.first) {
      var todayRows = S.calls.filter(function (x) { return x.state === 'past'; }).map(function (x) {
        return dayRow({ time: x.time, title: x.title, sub: x.sub, go: function () { set({ page: 'note', noteId: x.note, hot: '' }); }, hasFaces: false, cls: ' is-past', hotCls: '' });
      });
      todayRows.push({ isNow: true, isRow: false, clock: S.clock });
      coming.filter(function (c) { return c.day === 'Today'; }).forEach(function (c) { todayRows.push(dayRow(c)); });
      agenda.push({ label: 'Today', rows: todayRows });
      var byDay = {};
      coming.filter(function (c) { return c.day !== 'Today'; }).forEach(function (c) {
        if (!byDay[c.day]) { byDay[c.day] = { label: c.day, rows: [] }; agenda.push(byDay[c.day]); }
        byDay[c.day].rows.push(dayRow(c));
      });
    }
    var DAYS = [['W', 4, 'Today'], ['T', 5, 'Tomorrow'], ['F', 6, 'Friday'], ['S', 7, 'Saturday'], ['S', 8, 'Sunday'], ['M', 9, 'Monday'], ['T', 10, 'Tuesday']];
    var week = DAYS.map(function (x, i) {
      var n = (S.week || [])[i] || 0, on = st.day === x[2];
      return {
        d: x[0], n: x[1], name: x[2], cls: (i === 0 ? ' is-today' : '') + (on ? ' is-on' : ''), on: on ? 'true' : 'false', count: n,
        label: x[2] + ', ' + n + (n === 1 ? ' call' : ' calls'), dots: [0, 1, 2].slice(0, Math.min(n, 3)).map(function (k) { return { k: k }; }),
        go: function () { set({ day: on ? '' : x[2] }); }
      };
    });
    var shown = st.day ? agenda.filter(function (g) { return g.label === st.day; }) : agenda;

    return {
      side: side, nx: nx, agenda: shown, hasAgenda: shown.length > 0, noAgendaText: st.day ? 'Nothing on ' + st.day + '.' : 'Your calls line up here.', week: week,
      shellStyle: rootStyle(palId, mode, hour) + '; --frame: ' + ok(PALS[palId].dark.well) + '; --sky-low: ' + skyLow(palId, hour, 104, 620),
      I: I, layout: layout, pal: palId, mode: mode, rootStyle: rootStyle(palId, mode, hour), glass: PALS[palId][mode].glass ? 'true' : 'false',
      S: S, first: !!S.first, date: S.date, clock: hour === S.hour ? S.clock : (function () { var h = Math.floor(hour), m = Math.round((hour - h) * 60); return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m; })(), h1: h1, lede: lede, hasLede: !!lede, primary: primary, secondary: secondary,
      hotPrimary: st.hot === 'primary' || st.hot === 'start' ? ' is-hot' : '', hotAsk: hot('ask'), hotAhead: hot('ahead'),
      openAsk: function () { set({ ask: 'open', hot: '' }); },
      rows: rows, hasRows: rows.length > 0, openCount: openCount || '', clear: rows.length === 0 && !S.first,
      mine: mine, hasMine: mine.length > 0, mineLeft: mine.filter(function (m) { return !m.on; }).length,
      forCount: openCount + mine.filter(function (m) { return !m.on; }).length,
      segs: segs, sunX: tp(hour), aheadRow: S.ahead ? { short: S.ahead.short, title: S.ahead.title, go: function () { set({ card: S.ahead.id, hot: '' }); } } : null, hasAhead: !!S.ahead && !st.scheduled,
      emptyDay: S.first, coming: coming, hasComing: coming.length > 0, more: S.moreLabel || '', hasMore: !!S.moreLabel,
      goMore: function () { toast('Your next 7 days open in the calendar view.'); },
      notes: notes, hasNotes: notes.length > 0, goAll: goAll,
      starts: (S.starts || []).map(function (s) {
        return assign({}, s, { path: I[s.icon], go: function () { if (s.id === 's1') set({ page: 'note', noteId: 'n1' }); else toast(s.t + ' opens here. It isn’t part of this canvas.'); } });
      }),
      nav: tabs, page: page, ov: ov, st: st, set: set, toast: toast, hot: hot, byId: byId, goToNote: function (id) { set({ noteId: id, page: 'note', hot: '' }); }
    };
  }

  window.AH = { hash: hashParams, skyLow: skyLow, I: I, PALS: PALS, ORDER: window.ALCOVE_PAL_ORDER, ok: ok, grad: grad, skyStops: skyStops, rootStyle: rootStyle, SCENES: SCENES, STEPS: STEPS, vm: vm, tp: tp, assign: assign };
})();

/* The journeys drawn on each option's page, step by step. `desk` replaces a caption where that layout differs. */
window.AH.JOURNEYS = [
  { name: 'Start or schedule a call', frames: [
    { step: 'hotStart', t: 'Click Start a call, or press N.' },
    { step: 'choose', t: 'A modal asks one thing: now, or later?' },
    { step: 'who', t: 'Schedule for later. Same modal: who’s it with?' },
    { step: 'when', t: 'When? Only times you’re free.' },
    { step: 'details', t: 'Check the details, then Schedule.' },
    { step: 'scheduled', t: 'Back on Home. The call is on your day.' }
  ] },
  { name: 'Clear what’s waiting', frames: [
    { step: 'hotConfirm', t: 'Answer on the row. No page to open.' },
    { step: 'confirmed', t: 'The row says what you did, with Undo. Nothing jumps.' },
    { step: 'answered', t: 'Take it on, or Not mine.', panels: 'Take it on, or the ✕ for Not mine.' },
    { step: 'clear', t: 'Back on Home later: it says you’re clear.' }
  ] },
  { name: 'Join the next call', frames: [
    { scene: 'soon', step: 'hotJoin', t: 'Before a call, Home leads with it. Click Join, or press J.' },
    { scene: 'soon', step: 'lobby', t: 'The join screen, the only place a camera shows.' }
  ] },
  { name: 'Move a calendar meeting to Alcove', frames: [
    { step: 'hotCard', t: 'Click a meeting.' },
    { step: 'card', t: 'Its call card opens over Home.', desk: 'It opens beside the list.' },
    { step: 'moved', t: 'Use Alcove instead. Google tells everyone on it.' }
  ] },
  { name: 'Ask your notes', frames: [
    { step: 'hotAsk', t: 'Click Search or ask, or press ⌘K.' },
    { step: 'ask', t: 'Pick a question, or type your own.' },
    { step: 'answer', t: 'The answer cites the moment it came from.' },
    { step: 'note', t: 'The citation opens the note.', desk: 'The citation opens the note beside the list.' }
  ] },
  { name: 'Your first day', frames: [
    { scene: 'first', step: 'home', t: 'Before any notes: one job, start a call.' }
  ] }
];

/* Colour maths for the boards, so every number printed is worked out from the tokens themselves. */
(function () {
  var lin = function (c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  var gam = function (c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; };
  function toRgb(t) {
    var L = t[0], a = t[1] * Math.cos(t[2] * Math.PI / 180), b = t[1] * Math.sin(t[2] * Math.PI / 180);
    var l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3), m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3), s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(gam);
  }
  function fromHex(h) {
    var rgb = [1, 3, 5].map(function (i) { return lin(parseInt(h.slice(i, i + 2), 16) / 255); });
    var l = Math.cbrt(0.4122214708 * rgb[0] + 0.5363325363 * rgb[1] + 0.0514459929 * rgb[2]), m = Math.cbrt(0.2119034982 * rgb[0] + 0.6806995451 * rgb[1] + 0.1073969566 * rgb[2]), s = Math.cbrt(0.0883024619 * rgb[0] + 0.2817188376 * rgb[1] + 0.6299787005 * rgb[2]);
    var L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return [L, Math.hypot(A, B), (Math.atan2(B, A) * 180 / Math.PI + 360) % 360];
  }
  function hex(t) { return '#' + toRgb(t).map(function (c) { return Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0'); }).join('').toUpperCase(); }
  function lum(t) { var c = toRgb(t).map(function (x) { return lin(Math.min(1, Math.max(0, x))); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function gap(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
  Object.assign(window.AH, { hex: hex, contrast: contrast, fromHex: fromHex, gap: gap });
})();

/*
 * Ways of drawing the sunset. Everything comes from the palette's own sky, so each palette and mode gets its own.
 * `art` draws inside a card or a bar; `pageArt` draws the whole page, pinned to a horizon the stylesheet sets.
 */
(function () {
  var AH = window.AH, ok = AH.ok, PALS = AH.PALS;
  function mix(a, b, t) {
    var d = ((b[2] - a[2] + 540) % 360) - 180;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (a[2] + d * t + 360) % 360];
  }
  function rampOf(m) {
    var s = m.sky;
    return function (t) {
      var p = t * 100;
      for (var i = 1; i < s.length; i++) if (p <= s[i][3]) return mix(s[i - 1], s[i], (p - s[i - 1][3]) / (s[i][3] - s[i - 1][3]));
      return s[s.length - 1].slice(0, 3);
    };
  }
  function seeded(n) { return function () { n = (n * 16807) % 2147483647; return (n - 1) / 2147483646; }; }
  /* A ridge: a few long waves and a little roughness, closed along the bottom. */
  function ridge(base, amp, seed, rough, x0, x1, bottom, n) {
    var r = seeded(seed), a = r() * 6, b = r() * 6, c = r() * 6, pts = [];
    for (var i = 0; i <= n; i++) {
      var x = x0 + (x1 - x0) * i / n, y = base + amp * (Math.sin(x / 190 + a) * 0.62 + Math.sin(x / 83 + b) * 0.28 + Math.sin(x / 37 + c) * 0.1 * rough);
      pts.push((i ? 'L' : 'M') + x.toFixed(0) + ' ' + y.toFixed(1));
    }
    return pts.join('') + 'L' + x1 + ' ' + bottom + 'L' + x0 + ' ' + bottom + 'Z';
  }
  /* The sun's glitter on the water, the chop on the rest of the sea, and a few thin clouds. */
  function water(dark, R, m, o) {
    var r = seeded(7), gl = [], chop = [], clouds = [];
    for (var y = o.hz + 7; y < o.hz + o.span; y += 8) {
      var d = (y - o.hz) / o.span, spread = o.s0 + d * o.s1, n = 1 + Math.round(r() * 2);
      for (var i = 0; i < n; i++) {
        var w = (8 + r() * 30) * (0.7 + d) * o.k, off = (r() - 0.5) * 2 * spread;
        gl.push({ x: (o.cx + off - w / 2).toFixed(1), y: y, w: w.toFixed(1), c: ok(dark ? mix([0.84, 0.09, 72], [0.58, 0.09, 355], d) : mix([0.86, 0.1, 66], [0.76, 0.09, 10], d)), o: (0.86 - d * 0.6).toFixed(2) });
      }
    }
    for (var yy = o.hz + 11; yy < o.hz + (o.chopSpan || o.span); yy += 13) for (var k = 0; k < o.chops; k++) {
      var cw = 20 + r() * 70, cx = o.x0 + r() * (o.x1 - o.x0);
      if (Math.abs(cx - o.cx) < o.s0 + 90 || (o.calm && o.calm(cx, yy))) continue;
      chop.push({ x: cx.toFixed(1), y: yy, w: cw.toFixed(1), o: (0.05 + r() * 0.09).toFixed(2) });
    }
    o.clouds.forEach(function (c) { clouds.push({ x: (o.cx + c[0]).toFixed(1), y: o.hz + c[1], w: c[2], o: c[3] }); });
    return { glints: gl, chop: chop, clouds: clouds, cloudC: ok(dark ? R(0.5) : [0.86, 0.04, 330]), chopC: ok(dark ? m.ink2 : R(0)) };
  }
  function sunOf(dark) { return { sun: ok(dark ? [0.86, 0.085, 74] : [0.92, 0.1, 78]), glow: ok(dark ? [0.66, 0.12, 22] : [0.93, 0.08, 45], 0.55), rim: ok(dark ? [0.8, 0.1, 50] : [0.9, 0.09, 60]) }; }
  function layersOf(m, dark) {
    return dark
      ? [[[0.5, 0.075, 350], [0.62, 0.085, 18]], [[0.4, 0.07, 322], [0.5, 0.08, 348]], [[0.325, 0.066, 288], [0.4, 0.068, 318]], [[0.27, 0.056, 262], m.surface.slice(0, 3)]]
      : [[[0.87, 0.05, 30], [0.92, 0.05, 55]], [[0.8, 0.06, 350], [0.87, 0.05, 25]], [[0.72, 0.065, 305], [0.8, 0.06, 345]], [[0.64, 0.07, 265], [0.72, 0.065, 300]]];
  }
  function ringsOf(dark) {
    return dark ? [[0.86, 0.085, 80], [0.76, 0.095, 52], [0.64, 0.095, 20], [0.52, 0.085, 350], [0.42, 0.072, 318], [0.335, 0.064, 284]]
      : [[0.95, 0.09, 85], [0.93, 0.08, 62], [0.92, 0.06, 30], [0.915, 0.05, 5], [0.92, 0.04, 330], [0.93, 0.03, 285]];
  }
  function art(kind, pal, mode, shape) {
    var m = PALS[pal][mode], dark = mode === 'dark', R = rampOf(m), bar = shape === 'bar';
    var out = { isSea: kind === 'sea', isRidges: kind === 'ridges', isRings: kind === 'rings', vb: bar ? '0 150 1000 96' : '0 0 1000 340', par: bar ? 'xMaxYMid slice' : 'xMaxYMax slice' };
    if (kind === 'sea') {
      Object.assign(out, sunOf(dark), water(dark, R, m, {
        cx: 760, hz: 208, span: 132, s0: 10, s1: 66, k: 1, x0: 0, x1: 1000, chops: 7, clouds: [[-186, -58, 300, 0.5], [-136, -32, 220, 0.4], [-210, -18, 340, 0.35]],
        calm: function (x, y) { return x < 350 && y > 262; }
      }));
      out.hz = 208; out.sunX = 760; out.rimX = 460;
      out.sky = [{ o: '0', c: ok(dark ? m.surface : R(0)) }, { o: '.6', c: ok(R(dark ? 0.42 : 0.5)) }, { o: '1', c: ok(R(dark ? 0.66 : 0.78)) }];
      out.water = [{ o: '0', c: ok(dark ? mix(m.surface, R(0.55), 0.3) : R(0.46)) }, { o: '1', c: ok(dark ? m.well : R(0.12)) }];
    }
    if (kind === 'ridges') {
      var layers = layersOf(m, dark), shapes = [[222, 22, 11, 1], [252, 22, 29, 1], [284, 18, 47, 0.8], [316, 11, 71, 0.6]];
      out.sky = [{ o: '0', c: ok(dark ? m.surface : R(0)) }, { o: '.42', c: ok(R(0.5)) }, { o: '.62', c: ok(R(0.82)) }, { o: '.72', c: ok(R(0.96)) }];
      out.sun = ok(dark ? [0.88, 0.085, 78] : [0.95, 0.09, 85]); out.glow = ok(dark ? [0.8, 0.11, 58] : [0.95, 0.08, 80], 0.42);
      out.ridges = shapes.map(function (q, i) { return { d: ridge(q[0], q[1], q[2], q[3], 0, 1000, 340, 100), top: ok(layers[i][0]), base: ok(layers[i][1]), id: 'rg' + i, ref: 'url(#rg' + i + ')' }; });
    }
    if (kind === 'rings') {
      var sizes = bar ? [26, 46, 70, 96, 126, 158] : [50, 86, 126, 170, 218, 270];
      out.rings = ringsOf(dark).map(function (c, i) { return { r: sizes[i], c: ok(c), i: i }; }).reverse();
      out.cx = bar ? 800 : 806; out.cy = bar ? 272 : 348;
    }
    return out;
  }
  function pageArt(kind, pal, mode) {
    var m = PALS[pal][mode], dark = mode === 'dark', R = rampOf(m), top = dark ? m.ground : R(0), out = { isSea: kind === 'sea', isRidges: kind === 'ridges', isRings: kind === 'rings' };
    function grad(stops) { return 'linear-gradient(to bottom in oklch, ' + stops.map(function (x) { return ok(x[0]) + ' ' + x[1] + '%'; }).join(', ') + ')'; }
    Object.assign(out, sunOf(dark));
    out.ground = ok(dark ? m.ground : R(0.12));
    if (kind === 'sea') {
      out.skyCss = grad([[top, 0], [R(dark ? 0.4 : 0.46), 58], [R(dark ? 0.66 : 0.78), 100]]);
      out.waterCss = grad([[dark ? mix(m.surface, R(0.55), 0.3) : R(0.46), 0], [dark ? m.ground : R(0.16), 46], [dark ? m.well : R(0.1), 100]]);
      Object.assign(out, water(dark, R, m, { cx: 0, hz: 0, span: 190, chopSpan: 66, s0: 16, s1: 70, k: 1.4, x0: -1700, x1: 1700, chops: 26, clouds: [[-430, -92, 460, 0.5], [40, -60, 340, 0.4], [-300, -34, 520, 0.35]] }));
    }
    if (kind === 'ridges') {
      var layers = layersOf(m, dark);
      out.skyCss = grad([[top, 0], [R(0.46), 55], [R(0.72), 88], [R(0.84), 100]]);
      out.waterCss = out.ground;
      out.sunY = -8;
      out.ridges = [[12, 30, 11, 1], [52, 30, 29, 1], [98, 24, 47, 0.8], [150, 16, 71, 0.6]].map(function (q, i) {
        return { d: ridge(q[0], q[1], q[2], q[3], -2400, 2400, 1800, 240), top: ok(layers[i][0]), base: ok(i === 3 ? (dark ? m.ground : R(0.12)) : layers[i][1]), id: 'pr' + i, ref: 'url(#pr' + i + ')', y1: q[0] - q[1], y2: q[0] + 64 };
      });
    }
    if (kind === 'rings') {
      out.skyCss = ok(top); out.waterCss = out.ground;
      var sizes = [58, 92, 130, 174, 224, 280];
      out.rings = ringsOf(dark).map(function (c, i) { return { r: sizes[i], c: ok(c), i: i }; }).reverse();
    }
    return out;
  }
  Object.assign(AH, { art: art, pageArt: pageArt });
})();

/* The journeys on Home, step by step. */
window.AH.JOURNEYS_HOME = [
  { name: 'Start a call now', frames: [
    { step: 'hotGo', t: 'Click Start now. Nothing in between.' },
    { step: 'lobby', t: 'The join screen. Copy the link, or go straight in.' }
  ] },
  { name: 'Schedule a call', frames: [
    { step: 'hotLater', t: 'Click Schedule. No chooser in between.' },
    { step: 'who', t: 'Who’s it with?' },
    { step: 'when', t: 'When? Only times you’re free.' },
    { step: 'details', t: 'Check the details, then Schedule.' },
    { step: 'scheduled', t: 'Back on Home, and it’s in This week.', page: 'Back on Home. It’s on your calendar, which is where you’ll join it.' }
  ] },
  { name: 'Ring someone', frames: [
    { step: 'hotRing', t: 'Click someone you talk to.' },
    { step: 'ringing', t: 'The join screen, and they get a ring as you join.' }
  ] },
  { name: 'A call is about to start', frames: [
    { scene: 'soon', step: 'hotJoin', t: 'Only in the last few minutes, a slim line offers Join.' },
    { scene: 'soon', step: 'lobby', t: 'The join screen, the only place a camera shows.' }
  ] },
  { name: 'Move a meeting to Alcove', only: ['card', 'bar'], frames: [
    { step: 'hotCard', t: 'Click a meeting in This week.' },
    { step: 'homeCard', t: 'Its call card opens over Home.' },
    { step: 'homeMoved', t: 'Use Alcove instead. Google tells everyone on it.' }
  ] },
  { name: 'Clear what’s waiting', frames: [
    { step: 'hotConfirm', t: 'Answer on the tile. No page to open.' },
    { step: 'homeConfirmed', t: 'It says what you did, with Undo. Nothing jumps.' },
    { step: 'homeAnswered', t: 'Take it on, or the ✕ for Not mine.' },
    { step: 'homeClear', t: 'Next time you’re here, what you took on is on your list.' }
  ] },
  { name: 'Tick off a follow-up', frames: [
    { step: 'hotTick', t: 'Tick the box.' },
    { step: 'ticked', t: 'It crosses out where it is, until you leave Home.' }
  ] },
  { name: 'Ask your notes', frames: [
    { step: 'hotAsk', t: 'Click Search or ask, or press ⌘K.' },
    { step: 'ask', t: 'Pick a question, or type your own.' },
    { step: 'answer', t: 'The answer cites the moment it came from.' },
    { step: 'note', t: 'The citation opens the note.' }
  ] },
  { name: 'Your first day', frames: [
    { scene: 'first', step: 'home', t: 'Before any notes: start a call, or get set up.' }
  ] }
];
