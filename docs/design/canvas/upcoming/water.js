/*
 * Home, under the horizon. The sky is the app's, unchanged. The water holds widgets, the way the big apps build a home:
 * For you (tabs for what's to answer and your follow-ups, like Asana's and Notion's My tasks), Upcoming (a calendar widget
 * with date blocks, like Notion's Upcoming events; unconnected, it is the Connect button), and Recent notes (a row of
 * cards with covers, like Notion's Recently visited and Miro's board thumbnails). On the first day each widget shows its
 * own empty state. Everything here is made up: you are Art Vandelay at Vandelay Industries, on Wednesday 4 November.
 */
(function () {
  var AH = window.AH, I = AH.I, assign = AH.assign;

  /* Lucide, as the app's Icon draws it, for what the kit's set doesn't have. */
  Object.assign(I, {
    diamond: 'M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41L13.7 2.71a2.41 2.41 0 0 0-3.41 0z',
    box: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
    clock: 'M12 6v6l4 2M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0',
    send: 'M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11zM21.854 2.147l-10.94 10.939',
    userPlus: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M19 8v6M22 11h-6M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0',
    alert: 'M21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01',
    retry: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5',
    folder: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
    pin: 'M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z',
    hash: 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18',
    panel: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 3v18',
    external: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
    chev: 'M6 9l6 6 6-6',
    more: 'M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M18 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M4 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0',
    inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
    bell: 'M10.268 21a2 2 0 0 0 3.464 0M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326',
    flag: 'M4 22V15M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z',
    gear: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0'
  });

  /* ------------------------------------------------------------------ the world */
  var EMAIL = 'art@vandelay.industries';

  /* To answer, newest call first. */
  var ASKS = [
    { id: 'd1', kind: 'decide', text: 'Orders before the move ship from the old warehouse.', faces: 'maya', from: 'Art’s call' },
    { id: 'a2', kind: 'own', text: 'Update the delivery times on the order page', faces: 'maya', from: 'Art’s call', due: 'Mon' },
    { id: 'd2', kind: 'decide', text: 'Onboarding ships behind a flag on 12 November.', faces: 'priya,kofi,maya', from: 'Team standup' },
    { id: 'a3', kind: 'own', text: 'Send Kofi the pricing draft', faces: 'maya,lena', from: 'Pricing sync', due: 'Fri' },
    { id: 's1', kind: 'shared', text: 'Aiko shared the notes from Board prep', faces: 'aiko', from: 'Board prep' }
  ];
  var MORE_ASKS = [
    { id: 'd5', kind: 'decide', text: 'Jonas goes through to the final round.', faces: '', room: true, from: 'Interview: Jonas Weber' },
    { id: 'a5', kind: 'own', text: 'Ask Jonas for two references', faces: '', room: true, from: 'Interview: Jonas Weber' },
    { id: 'd7', kind: 'decide', text: 'The launch moves to the 18th.', faces: 'priya,aiko', from: 'Launch planning' }
  ];
  /* Your follow-ups, soonest first, with the call each came from. */
  var TODOS = [
    { id: 'y4', text: 'Send Jonas the take-home task', from: 'Interview: Jonas Weber', due: 'Yesterday', late: true },
    { id: 'y1', text: 'Review the launch checklist', from: 'Team standup', due: 'Today', today: true },
    { id: 'y2', text: 'Book the movers for the 14th', from: 'Art’s call', due: 'Fri' },
    { id: 'y3', text: 'List which suppliers move with us', from: 'Art’s call', due: 'Mon' }
  ];
  var MORE_TODOS = [
    { id: 'y5', text: 'Share the pricing page with Lena', from: 'Pricing sync', due: 'Tue' },
    { id: 'y6', text: 'Draft the Harbourline proposal', from: 'Site visit, Harbourline', due: 'Next week' },
    { id: 'y7', text: 'Ask Aiko about the export bug', from: 'Design review', due: '' }
  ];

  /* Upcoming, by day: every Alcove call, and meetings on your calendar with someone else on them. */
  var DAYS = [
    { id: 'wed', word: 'Today', num: '4', today: true },
    { id: 'thu', word: 'Thu', num: '5' },
    { id: 'fri', word: 'Fri', num: '6' },
    { id: 'sat', word: 'Sat', num: '7' },
    { id: 'sun', word: 'Sun', num: '8' },
    { id: 'mon', word: 'Mon', num: '9' },
    { id: 'tue', word: 'Tue', num: '10' },
    { id: 'tbd', word: 'Soon', num: '' }
  ];
  var DAY_ORDER = DAYS.map(function (d) { return d.id; });
  /*
   * Events with only you on them: on your calendar, with nobody else invited. They aren't calls, so Upcoming doesn't list
   * them, but it says how many there are, and shows them, quieter, when you ask. `SOLO` sits beside a week of meetings;
   * `SOLO_WEEK` is a week with nothing but them.
   */
  var SOLO = [
    { id: 's1', day: 'wed', time: '19:00', title: 'Gym' },
    { id: 's2', day: 'thu', time: '08:30', title: 'Write the Q4 plan' },
    { id: 's3', day: 'thu', time: '12:30', title: 'Lunch' },
    { id: 's4', day: 'fri', time: '16:30', title: 'Dentist' },
    { id: 's5', day: 'sat', time: '10:00', title: 'Farmers market' },
    { id: 's6', day: 'mon', time: '13:00', title: 'Prep for the board' }
  ];
  var SOLO_WEEK = [
    { id: 'w1', day: 'wed', time: '19:00', title: 'Gym' },
    { id: 'w2', day: 'thu', time: '09:00', title: 'Write the Q4 plan' },
    { id: 'w3', day: 'thu', time: '12:30', title: 'Lunch' },
    { id: 'w4', day: 'thu', time: '19:00', title: 'Gym' },
    { id: 'w5', day: 'fri', time: '16:30', title: 'Dentist' },
    { id: 'w6', day: 'sat', time: '10:00', title: 'Farmers market' },
    { id: 'w7', day: 'sun', time: '08:00', title: 'Long run' },
    { id: 'w8', day: 'mon', time: '09:00', title: 'Prep for the board' },
    { id: 'w9', day: 'mon', time: '19:00', title: 'Gym' },
    { id: 'w10', day: 'tue', time: '09:00', title: 'Write the Q4 plan' },
    { id: 'w11', day: 'tue', time: '15:00', title: 'Pick up the new chairs' },
    { id: 'w12', day: 'tue', time: '19:00', title: 'Gym' }
  ];
  var EVENTS = [
    { id: 'k1', day: 'wed', time: '17:30', title: 'Design sync', faces: 'priya,kofi', kind: 'alcove' },
    { id: 'e3', day: 'thu', time: '11:00', title: 'Intro with Harbourline', faces: 'diego,lena', kind: 'cal', mine: true },
    { id: 'k4', day: 'thu', time: '14:00', title: 'Launch planning', faces: 'priya,aiko', kind: 'alcove', answer: true },
    { id: 'k3', day: 'thu', time: '15:30', title: '1:1 with Maya', faces: 'maya', kind: 'alcove' },
    { id: 'e1', day: 'fri', time: '10:00', title: 'Product sync', faces: 'kofi', kind: 'cal' },
    { id: 'e2', day: 'fri', time: '14:00', title: 'Pricing review', faces: 'maya,lena', kind: 'cal', mine: true },
    { id: 'k5', day: 'mon', time: '09:00', title: 'Team standup', faces: 'priya,kofi,maya', kind: 'alcove' },
    { id: 'k6', day: 'tbd', time: '', title: 'Customer research', faces: 'lena', kind: 'alcove', picking: true }
  ];
  /* The first day's calendar, once it's connected: meetings elsewhere. */
  var FIRST_EVENTS = [
    { id: 'f1', day: 'wed', time: '17:30', title: 'Design sync', faces: 'priya,kofi', kind: 'cal' },
    { id: 'f2', day: 'thu', time: '11:00', title: 'Intro with Harbourline', faces: 'diego,lena', kind: 'cal', mine: true },
    { id: 'f3', day: 'thu', time: '15:30', title: '1:1 with Maya', faces: 'maya', kind: 'cal' },
    { id: 'f4', day: 'fri', time: '10:00', title: 'Product sync', faces: 'kofi', kind: 'cal' },
    { id: 'f5', day: 'mon', time: '09:00', title: 'Team standup', faces: 'priya,kofi,maya', kind: 'cal' }
  ];
  /* The calls you made in Alcove, which show whether the calendar is connected or not. */
  var OWN = ['k1', 'k3', 'k5'];

  /* Each note keeps its own small sunset, as its cover. */
  var COVERS = [
    '--c1: oklch(.34 .07 282); --c2: oklch(.56 .12 345); --c3: oklch(.8 .12 62); --sx: 64%; --sun: oklch(.93 .1 85); --sea: oklch(.3 .06 270)',
    '--c1: oklch(.4 .08 300); --c2: oklch(.64 .12 12); --c3: oklch(.84 .1 75); --sx: 30%; --sun: oklch(.95 .08 92); --sea: oklch(.34 .07 290)',
    '--c1: oklch(.3 .06 252); --c2: oklch(.5 .1 300); --c3: oklch(.74 .11 35); --sx: 72%; --sun: oklch(.9 .11 75); --sea: oklch(.27 .05 258)',
    '--c1: oklch(.36 .07 270); --c2: oklch(.6 .11 330); --c3: oklch(.82 .1 50); --sx: 46%; --sun: oklch(.94 .09 88); --sea: oklch(.3 .06 268)',
    '--c1: oklch(.28 .05 262); --c2: oklch(.42 .08 290); --c3: oklch(.62 .1 330); --sx: 56%; --sun: oklch(.86 .08 60); --sea: oklch(.24 .05 262)',
    '--c1: oklch(.42 .07 250); --c2: oklch(.66 .09 300); --c3: oklch(.86 .08 40); --sx: 38%; --sun: oklch(.96 .07 90); --sea: oklch(.36 .06 262)'
  ];
  var NOTES = [
    { id: 'n1', title: 'Art’s call', when: 'Today · 14 min', faces: 'maya', cover: 0 },
    { id: 'n2', title: 'Team standup', when: 'Today · 20 min', faces: 'priya,kofi,maya', cover: 1 },
    { id: 'n3', title: 'Pricing sync', when: 'Yesterday · 32 min', faces: 'maya,lena', cover: 2 },
    { id: 'n4', title: 'Design review', when: 'Yesterday · 45 min', faces: 'priya,kofi,aiko', cover: 3 },
    { id: 'n5', title: 'Interview: Jonas Weber', when: 'Mon · 52 min', faces: '', room: true, cover: 4 },
    { id: 'n6', title: 'Site visit, Harbourline', when: 'Mon · 1 h 12 min', faces: '', room: true, cover: 5 }
  ];
  var FIRST_NOTE = { id: 'c1', title: 'Call with Maya', when: 'Today · 18 min', faces: 'maya', cover: 1 };
  var EXAMPLE = { id: 'example', title: 'Weekly product call', when: 'Example · 24 min', faces: 'theo,priya', cover: 3, example: true };
  var FIRST_ASKS = [
    { id: 'q1', kind: 'decide', text: 'Orders before the move ship from the old warehouse.', faces: 'maya', from: 'Call with Maya' },
    { id: 'q2', kind: 'own', text: 'Book the movers for the 14th', faces: 'maya', from: 'Call with Maya', due: 'Fri' }
  ];

  /* ------------------------------------------------------------------ the states, each a step */
  /*
   * `day`: the first day, or any day after. `cal`: none, google (Google's own page), on, denied, skipped. `notes`: none,
   * writing, first, all. `tab`: For you's tab. `alone`: someone on their own, with nobody to ring.
   */
  var BASE = { day: 'today', cal: 'on', notes: 'all', tab: 'ask', asks: {}, ticks: {}, moved: {} };
  var FIRST = { day: 'first', cal: 'none', notes: 'none' };
  var STEPS = {
    today: {},
    first: FIRST,
    firstHotConnect: assign(FIRST, { hot: 'connect' }),
    firstGoogle: assign(FIRST, { cal: 'google' }),
    firstConnected: assign(FIRST, { cal: 'on', fresh: true }),
    firstDenied: assign(FIRST, { cal: 'denied' }),
    firstFollow: assign(FIRST, { cal: 'on', tab: 'todo' }),
    firstWriting: assign(FIRST, { cal: 'on', notes: 'writing' }),
    firstNotes: assign(FIRST, { cal: 'on', notes: 'first' }),
    alone: { day: 'first', cal: 'none', notes: 'none', alone: true },
    soon: { soon: true },
    soonHot: { soon: true, hot: 'join' },
    askHot: { hot: 'yes-d1' },
    askConfirmed: { asks: { d1: 'yes' } },
    askHotTake: { asks: { d1: 'yes' }, hot: 'yes-a2' },
    askTaken: { asks: { d1: 'yes', a2: 'yes' } },
    tabHot: { asks: { d1: 'yes', a2: 'yes' }, hot: 'tab-todo' },
    tabTodos: { asks: { d1: 'yes', a2: 'yes' }, tab: 'todo' },
    todoHot: { tab: 'todo', hot: 'tick-y1' },
    todoTicked: { tab: 'todo', ticks: { y1: true } },
    nothing: { noAsks: true, noTodos: true },
    meetingHot: { hot: 'move-e3' },
    meetingMoved: { moved: { e3: true }, toast: 'Intro with Harbourline is an Alcove call now. Diego and Lena get the new link.' },
    later: { cal: 'skipped' },
    laterHot: { cal: 'skipped', hot: 'connect' },
    laterConnected: { cal: 'on', fresh: true, toast: 'Google Calendar is connected.' },
    lots: { lots: true },
    loading: { load: 'loading' },
    failed: { load: 'failed' },
    /*
     * Upcoming, redesigned. `week`: mixed (calls and meetings, and events with only you), own (only events with only you),
     * clear (nothing at all). `solo`: the events with only you are shown, in their days. `before`: how Upcoming reads today,
     * to compare. `calLoad`: the calendar didn't load.
     */
    upSoloHot: { hot: 'solo' },
    upSolo: { solo: true },
    upSoloHideHot: { solo: true, hot: 'solo' },
    upOwnWeek: { week: 'own' },
    upOwnWeekHot: { week: 'own', hot: 'show-own' },
    upOwnWeekShown: { week: 'own', solo: true },
    upOwnWeekBefore: { week: 'own', before: true },
    upClear: { week: 'clear' },
    upClearBefore: { week: 'clear', before: true },
    upFirstOwn: assign(FIRST, { week: 'own' }),
    upFirstOwnHot: assign(FIRST, { week: 'own', hot: 'connect' }),
    upFirstOwnGoogle: assign(FIRST, { week: 'own', cal: 'google' }),
    upConnectedOwn: assign(FIRST, { week: 'own', cal: 'on', fresh: true, toast: 'Google Calendar is connected.' }),
    upConnectedOwnHot: assign(FIRST, { week: 'own', cal: 'on', hot: 'show-own' }),
    upConnectedOwnShown: assign(FIRST, { week: 'own', cal: 'on', solo: true }),
    upCalFailed: { calLoad: 'failed' },
    upCalFailedEmpty: { calLoad: 'failed', week: 'clear' }
  };

  /*
   * Journeys: one row each, from the click to what it leads to. `kind`: page (Home, at half size, scrolled to the widgets)
   * or widget (Upcoming alone, at its real size).
   */
  var JOURNEYS = [
    { name: 'Connect, and the week has only events of your own', kind: 'page', frames: [
      { step: 'upFirstOwnHot', scroll: 'water', t: 'The first day. Click Connect Google Calendar.' },
      { step: 'upFirstOwnGoogle', t: 'Google asks on its own page. Click Allow.' },
      { step: 'upConnectedOwn', scroll: 'water', t: 'Back on Home. Upcoming says nobody else is on anything this week, and how many events it isn’t showing.' },
      { step: 'upConnectedOwnHot', scroll: 'water', t: 'Click Show them.' },
      { step: 'upConnectedOwnShown', scroll: 'water', t: 'They show in their days, quieter. Pressing the foot’s count hides them again.' }
    ] },
    { name: 'Calls and meetings, and some events of your own', kind: 'widget', frames: [
      { step: 'today', t: 'Calls and meetings with other people. The foot counts the events with only you on them.' },
      { step: 'upSoloHot', t: 'Click 6 with only you.' },
      { step: 'upSolo', t: 'They show in their days: one slim line each, with the hatch your own time has when you schedule.' },
      { step: 'upSoloHideHot', t: 'Click it again.' },
      { step: 'today', t: 'Hidden again. Upcoming keeps whichever you chose.' }
    ] },
    { name: 'A week of only your own events', kind: 'widget', frames: [
      { step: 'upOwnWeekBefore', t: 'Today: Nothing in the next 7 days, with 12 events on the calendar. It reads as broken.' },
      { step: 'upOwnWeek', t: 'Redesigned: nothing with other people, and how many of your own events it isn’t showing.' },
      { step: 'upOwnWeekHot', t: 'Click Show them.' },
      { step: 'upOwnWeekShown', t: 'Your week, quietly, with Show 4 more. The foot’s count hides them again.' }
    ] },
    { name: 'Nothing at all', kind: 'widget', frames: [
      { step: 'upClearBefore', t: 'Today: Nothing in the next 7 days.' },
      { step: 'upClear', t: 'Redesigned: it says the calendar has nothing, so it can’t be mistaken for one that didn’t load.' }
    ] }
  ];
  var PHONE_JOURNEYS = [
    { name: 'On a phone', phone: true, kind: 'page', frames: [
      { step: 'upOwnWeek', scroll: 'water', t: 'A week of only your own events.' },
      { step: 'upOwnWeekShown', scroll: 'water', t: 'Show them.' },
      { step: 'today', scroll: 'water', t: 'Calls and meetings, with the count at the foot.' },
      { step: 'upSolo', scroll: 'water', t: 'Your own events shown.' }
    ] }
  ];
  var STATES = [
    { name: 'Calls and meetings with other people', kind: 'widget', frames: [
      { step: 'today', t: 'Events with only you on them are counted at the foot, not listed.' },
      { step: 'upSolo', t: 'Shown: one slim line each, in their days.' },
      { step: 'soon', t: 'A call about to start.' },
      { step: 'firstConnected', t: 'Just connected, on the first day.' }
    ] },
    { name: 'Only your own events: what you saw, and the redesign', kind: 'widget', frames: [
      { step: 'upOwnWeekBefore', t: 'Today.' },
      { step: 'upOwnWeek', t: 'Redesigned: why it’s empty, and how many.' },
      { step: 'upOwnWeekShown', t: 'Show them.' }
    ] },
    { name: 'Nothing, not yet, and problems', kind: 'widget', frames: [
      { step: 'upClear', t: 'Nothing at all.' },
      { step: 'first', t: 'Not connected yet.' },
      { step: 'loading', t: 'Loading.' },
      { step: 'upCalFailedEmpty', t: 'The calendar didn’t load.' },
      { step: 'upCalFailed', t: 'It didn’t load, with calls to show.' },
      { step: 'firstDenied', t: 'Google wasn’t allowed.' }
    ] },
    { name: 'In the light', kind: 'widget', frames: [
      { step: 'today', mode: 'light', t: 'Calls and meetings.' },
      { step: 'upSolo', mode: 'light', t: 'Your own events shown.' },
      { step: 'upOwnWeek', mode: 'light', t: 'Only your own events.' },
      { step: 'upClear', mode: 'light', t: 'Nothing at all.' }
    ] },
    { name: 'On Home', kind: 'page', frames: [
      { step: 'upOwnWeek', scroll: 'water', t: 'Only your own events.' },
      { step: 'upSolo', scroll: 'water', t: 'Your own events shown beside your calls.' },
      { step: 'upOwnWeek', mode: 'light', scroll: 'water', t: 'In the light.' },
      { step: 'upOwnWeek', phone: true, scroll: 'water', t: 'On a phone.' },
      { step: 'upSolo', phone: true, scroll: 'water', t: 'Shown, on a phone.' }
    ] }
  ];
  /* How far down a frame starts, so the widgets are in view: Home's water, by the frame's width. */
  var WATER = { page: 340, phone: 740 };

  /* ------------------------------------------------------------------ the view */
  function view(c) {
    var p = c.props || {}, hs = AH.hash();
    var stepId = hs.step || p.step || 'today';
    var st = assign(BASE, STEPS[stepId] || {}, c.state || {});
    var set = function (patch) { c.setState(patch); };
    var hot = function (k) { return st.hot === k ? ' is-hot' : ''; };
    var first = st.day === 'first';
    var loading = st.load === 'loading';
    var toast = function (msg) {
      clearTimeout(c.__hwToast);
      set({ toast: msg, hot: '' });
      c.__hwToast = setTimeout(function () { c.setState({ toast: '' }); }, 3600);
    };
    var calOn = st.cal === 'on';
    var cal = {
      connect: function () { set({ cal: 'google', hot: '' }); },
      allow: function () { set({ cal: 'on', fresh: true, hot: '' }); toast('Google Calendar is connected.'); },
      cancel: function () { set({ cal: 'denied', hot: '' }); }
    };

    /* ---------------- For you: To answer, and Follow-ups */
    var askSrc = [];
    if (!st.noAsks && !st.load) askSrc = first ? (st.notes === 'first' ? FIRST_ASKS : []) : ASKS.concat(st.lots ? MORE_ASKS : []);
    var answered = st.asks || {};
    var openAsks = 0;
    var asks = askSrc.map(function (it) {
      var a = answered[it.id];
      if (!a) openAsks++;
      var decide = it.kind === 'decide', own = it.kind === 'own', shared = it.kind === 'shared';
      return assign({}, it, {
        open: !a, answered: !!a, hasFaces: !!it.faces, room: !!it.room, shared: shared,
        cls: ' is-' + it.kind + (a ? ' is-answered' : ''),
        icon: decide ? I.diamond : own ? I.box : I.share,
        yes: decide ? 'Confirm' : own ? 'I’ll do it' : 'Read', no: decide ? 'It wasn’t decided' : 'Not mine', canNo: !shared,
        done: decide ? (a === 'yes' ? 'Confirmed' : 'Not decided') : own ? (a === 'yes' ? 'In your follow-ups' : 'Not yours') : 'Opened',
        hotYes: hot('yes-' + it.id), hotNo: hot('no-' + it.id),
        goYes: function () { var m = assign({}, answered); m[it.id] = 'yes'; set({ asks: m, hot: '' }); },
        goNo: function () { var m = assign({}, answered); m[it.id] = 'no'; set({ asks: m, hot: '' }); },
        undo: function () { var m = assign({}, answered); delete m[it.id]; set({ asks: m }); }
      });
    });
    var todoSrc = [];
    if (!st.noTodos && !st.load && !first) todoSrc = TODOS.concat(st.lots ? MORE_TODOS : []);
    askSrc.forEach(function (it) { if (it.kind === 'own' && answered[it.id] === 'yes') todoSrc = [{ id: it.id, text: it.text, from: it.from, due: it.due || '', fresh: true }].concat(todoSrc); });
    var todos = todoSrc.map(function (t) {
      var on = !!st.ticks[t.id];
      return assign({}, t, {
        onAria: on ? 'true' : 'false',
        cls: (on ? ' is-done' : '') + (t.fresh ? ' is-new' : ''), dueCls: t.late ? ' is-late' : t.today ? ' is-now' : '',
        hotTick: hot('tick-' + t.id),
        tick: function () { var m = assign({}, st.ticks); m[t.id] = !on; set({ ticks: m, hot: '' }); }
      });
    });
    var openTodos = todos.filter(function (t) { return !st.ticks[t.id]; }).length;
    var SHOWN = 5;
    var tab = st.tab === 'todo' ? 'todo' : 'ask';
    var list = tab === 'ask' ? asks : todos;
    var shown = st.all ? list : list.slice(0, SHOWN);
    var writing = first && st.notes === 'writing';
    var empty = tab === 'ask'
      ? (first ? { t: 'Nothing to answer yet', l: writing ? 'Call with Maya’s notes are being written.' : 'Decisions to confirm and follow-ups from your calls show up here.' }
        : todos.length ? { t: 'Nothing to answer', l: 'Your follow-ups are in the next tab.' } : { t: 'You’re all caught up', l: 'New ones show up after your calls.' })
      : (first ? { t: 'No follow-ups yet', l: 'What you take on shows up here, with when it’s due.' } : { t: 'You’re all caught up', l: 'New ones show up after your calls.' });
    var forYou = {
      shown: true,
      loading: loading, failed: st.load === 'failed',
      retry: function () { set({ load: '' }); },
      onAsk: tab === 'ask', onTodo: tab === 'todo',
      askTab: { label: 'To answer', n: openAsks ? String(openAsks) : '', hasN: openAsks > 0, cls: tab === 'ask' ? ' is-on' : '', hot: hot('tab-ask'), sel: tab === 'ask' ? 'true' : 'false', go: function () { set({ tab: 'ask', all: false, hot: '' }); } },
      todoTab: { label: 'Follow-ups', n: openTodos ? String(openTodos) : '', hasN: openTodos > 0, cls: tab === 'todo' ? ' is-on' : '', hot: hot('tab-todo'), sel: tab === 'todo' ? 'true' : 'false', go: function () { set({ tab: 'todo', all: false, hot: '' }); } },
      asks: tab === 'ask' ? shown : [], todos: tab === 'todo' ? shown : [],
      hasAsks: tab === 'ask' && shown.length > 0, hasTodos: tab === 'todo' && shown.length > 0,
      more: 'Show ' + (list.length - shown.length) + ' more', hasMore: list.length > shown.length && !st.load,
      showMore: function () { set({ all: true }); },
      empty: !st.load && list.length === 0,
      emptyTitle: empty.t, emptyLine: empty.l,
      /* Nothing yet: a picture of what will come. All done: the page's own small sunset. */
      emptyYet: first, emptyDone: !first, emptyTodo: tab === 'todo'
    };

    /* ---------------- Upcoming: a calendar widget */
    /*
     * Calls and meetings with someone else on them are listed. Events with only you on them aren't calls: Upcoming counts
     * them at its foot and shows them, quieter, in their days when you ask (`solo`). With nothing else, it says why it's empty.
     */
    var calFailed = st.calLoad === 'failed';
    var calRead = calOn && !calFailed;
    var week = st.week || 'mixed';
    var callsOnly = EVENTS.filter(function (x) { return OWN.indexOf(x.id) >= 0; });
    var meetSrc = [], soloSrc = [];
    if (!loading && week === 'own') soloSrc = calRead ? SOLO_WEEK : [];
    else if (!loading && week === 'mixed') {
      meetSrc = first ? (calRead ? FIRST_EVENTS : []) : calRead ? EVENTS : callsOnly;
      soloSrc = calRead ? SOLO : [];
    }
    var showSolo = !!st.solo && soloSrc.length > 0;
    var dayIx = function (x) { return DAY_ORDER.indexOf(x.day); };
    var evSrc = meetSrc.concat(showSolo ? soloSrc.map(function (s) { return assign({}, s, { solo: true }); }) : [])
      .sort(function (a, b) { return dayIx(a) - dayIx(b) || (a.time < b.time ? -1 : a.time > b.time ? 1 : 0); });
    var events = evSrc.map(function (x, i) {
      if (x.solo) {
        return assign({}, x, {
          notSolo: false, timeText: x.time, cls: ' is-solo', delay: '',
          go: function () { toast('Opens in Google Calendar, in a new tab.'); }
        });
      }
      var moved = !!st.moved[x.id];
      var isCal = x.kind === 'cal' && !moved;
      var soonRow = st.soon && x.id === 'k1';
      return assign({}, x, {
        notSolo: true,
        hasFaces: !!x.faces, picking: !!x.picking, answer: !!x.answer && !soonRow, soonRow: soonRow,
        canMove: isCal && !!x.mine, isCal: isCal, plain: !(isCal && x.mine) && !x.answer && !soonRow && !moved,
        movedNow: moved,
        timeText: x.picking ? '—' : x.time,
        cls: (st.fresh && calOn && x.kind === 'cal' ? ' is-new' : '') + (soonRow ? ' is-soon' : '') + (moved ? ' is-moved' : ''),
        delay: 'animation-delay: ' + (i * 45) + 'ms',
        hotMove: hot('move-' + x.id),
        move: function () { var m = assign({}, st.moved); m[x.id] = true; set({ moved: m, hot: '' }); toast(x.title + ' is an Alcove call now. Everyone on it gets the new link.'); },
        go: function () { if (isCal) toast('Opens in Google Calendar, in a new tab.'); else set({ card: x.id, hot: '' }); }
      });
    });
    /* Rows of your own are slimmer, so more of them fit before Show N more. */
    var EV_SHOWN = showSolo ? 8 : 5;
    var evShown = st.allEvents ? events : events.slice(0, EV_SHOWN);
    var days = [];
    DAYS.forEach(function (d) {
      var rows = evShown.filter(function (e) { return e.day === d.id; });
      if (rows.length) days.push(assign({}, d, { rows: rows, cls: d.today ? ' is-today' : '', hasNum: !!d.num }));
    });
    var noRows = events.length === 0;
    var settled = !loading && calRead;
    var nSolo = soloSrc.length;
    var upcoming = {
      loading: loading,
      days: days, hasDays: days.length > 0,
      more: 'Show ' + (events.length - evShown.length) + ' more', hasMore: events.length > evShown.length,
      showMore: function () { set({ allEvents: true }); },
      /* Never connected, on the first day: the widget is the way to connect. */
      connectState: !loading && !calOn && first && st.cal !== 'denied',
      denied: !loading && st.cal === 'denied',
      /* A later day without the calendar: your calls, then what's missing at the foot. */
      missing: !loading && !calOn && !first,
      hotConnect: hot('connect'),
      connect: cal.connect,
      /* The calendar didn't load: said in the body with nothing else to show, otherwise at the foot. */
      failedBody: !loading && calOn && calFailed && noRows,
      failedFoot: !loading && calOn && calFailed && !noRows,
      retry: function () { set({ calLoad: '' }); },
      /* Nothing with other people, but events with only you: why it's empty, how many, and the way to see them. */
      ownEmpty: settled && noRows && nSolo > 0 && !st.before,
      ownLine: nSolo + ' events with only you on them aren’t shown.',
      showOwn: function () { set({ solo: true, allEvents: false, hot: '' }); },
      hotShowOwn: hot('show-own'),
      /* Nothing at all: the calendar was read, and it's clear. */
      clear: settled && noRows && nSolo === 0 && !st.before,
      /* How Upcoming reads today, whatever the calendar holds. */
      before: settled && noRows && !!st.before,
      /* The foot's toggle: how many events have only you on them, pressed while they show. */
      hasSolo: settled && nSolo > 0 && !noRows && !st.before,
      soloLabel: nSolo + ' with only you',
      soloCls: (showSolo ? ' is-on' : '') + hot('solo'),
      soloPressed: showSolo ? 'true' : 'false',
      soloTip: showSolo ? 'Hide the events with only you on them' : 'Show the events with only you on them',
      toggleSolo: function () { set({ solo: !showSolo, allEvents: false, hot: '' }); },
      settings: function () { toast('Settings opens at Google Calendar.'); }
    };
    upcoming.hasFoot = upcoming.hasMore || upcoming.hasSolo;
    upcoming.moreOnly = upcoming.hasMore && !upcoming.hasSolo;

    /* ---------------- Recent notes: a row of cards */
    var noteSrc = loading ? [] : first ? (st.notes === 'writing' ? [assign({}, FIRST_NOTE, { writing: true }), EXAMPLE] : st.notes === 'first' ? [FIRST_NOTE] : [EXAMPLE]) : NOTES;
    var notes = {
      loading: loading,
      cards: noteSrc.map(function (n) {
        var face = (n.faces || '').split(',').slice(0, 2).join(',');
        return assign({}, n, {
          face: face, hasFaces: !!face, room: !!n.room, writing: !!n.writing, ready: !n.writing, example: !!n.example,
          cover: COVERS[n.cover % COVERS.length], cls: (n.writing ? ' is-writing' : '') + (n.example ? ' is-example' : ''),
          hotCls: n.example ? hot('example') : '',
          go: function () { toast(n.writing ? 'Its note opens as it’s written.' : n.example ? 'The example note opens here.' : 'The note opens here.'); }
        });
      }),
      firstSlot: first && st.notes === 'none'
    };

    var soon = !!st.soon;
    var count = st.load ? 0 : openAsks + openTodos;
    var side = {
      I: I, style: AH.rootStyle('blue-hour', 'dark', 16.2),
      places: [
        { label: 'Home', icon: I.home, n: count, on: true },
        { label: 'Notes', icon: I.notes, n: first ? (st.notes === 'none' ? 0 : 1) : 11 },
        { label: 'Drive', icon: I.folder, n: first ? 0 : 1 },
        { label: 'Record', icon: I.recordDot, n: 0 },
        { label: 'Team', icon: I.people, n: st.alone ? -1 : 6 }
      ].filter(function (x) { return x.n >= 0; }).map(function (x) {
        return { label: x.label, icon: x.icon, count: x.n ? String(x.n) : '', hasCount: x.n > 0, cls: x.on ? ' is-on' : '', current: x.on ? 'page' : 'false', go: function () { toast(x.label + ' opens here. It isn’t part of this canvas.'); } };
      }),
      upNext: !soon && (first ? calOn : true),
      next: { title: 'Design sync', when: '17:30 · in 1 h 18 min', faces: 'priya,kofi' },
      hasPinned: !first, pinned: [{ t: 'Design review', c: 'a' }, { t: 'Site visit, Harbourline', c: 'b' }],
      noPinned: first,
      hasGroups: !first, groups: [{ t: 'Leads', n: '3' }, { t: 'Product', n: '4' }],
      minutes: first ? '6 h 40 min' : '6 h 26 min', meter: first ? 'width: 100%' : 'width: 64%'
    };

    var scrollTo = Number(p.scroll || hs.scroll || st.scroll || 0);
    return {
      scrollRef: function (el) {
        if (!el || !scrollTo || el.__hwScrolled) return;
        el.__hwScrolled = true;
        var go = function () { el.scrollTop = scrollTo; };
        setTimeout(go, 60); setTimeout(go, 700); setTimeout(go, 1600);
      },
      st: st, step: stepId, first: first,
      startTitle: first && st.notes === 'none' ? 'Start your first call' : 'Start a call',
      soon: soon, soonFlag: soon ? 'true' : 'false',
      goCls: soon ? 'b-sky' : 'b-press',
      hotJoin: hot('join'),
      /* No row of people to ring under the buttons: ringing someone starts from Team or from Start a call. */
      people: [],
      cal: cal, forYou: forYou, upcoming: upcoming, notes: notes, side: side,
      google: st.cal === 'google', email: EMAIL,
      toast: st.toast || '', hasToast: !!st.toast,
      card: st.card ? EVENTS.filter(function (x) { return x.id === st.card; })[0] || null : null,
      closeCard: function () { set({ card: '' }); },
      set: set, hot: hot, toastFn: toast
    };
  }

  /* A board's rows of frames: Home at half size (on a phone at 0.641), or the widget alone at its real size. */
  function frames(rows) {
    return rows.map(function (r) {
      return {
        name: r.name,
        frames: r.frames.map(function (f, i) {
          var phone = !!(f.phone || r.phone);
          var widget = (f.kind || r.kind) === 'widget' && !phone;
          return {
            n: i + 1, t: f.t, step: f.step, mode: f.mode || 'dark',
            scroll: f.scroll === 'water' ? (phone ? WATER.phone : WATER.page) : (f.scroll || 0),
            isWidget: widget, isPage: !widget,
            cls: widget ? ' is-widget' : phone ? ' is-phone' : ' is-page'
          };
        })
      };
    });
  }

  AH.HW = { STEPS: STEPS, JOURNEYS: JOURNEYS, PHONE_JOURNEYS: PHONE_JOURNEYS, STATES: STATES, WATER: WATER, frames: frames, view: view, EMAIL: EMAIL };
})();
