/*
 * Notes: what each note says beyond its row, who has it, what was said in it, and the page's steps.
 * Keyed by the ids in appdata.js. All made up, and all one story with the other pages.
 */
(function () {
  var AH = window.AH, D = AH.D;

  /* Lucide, as the app's Icon uses it. */
  var ICONS = {
    pin: 'M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z',
    more: 'M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M18 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M4 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0',
    trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6',
    hash: 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18',
    mail: 'M22 7l-8.991 5.727a2 2 0 0 1-2.009 0L2 7M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    alert: 'M21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01',
    pen: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497zM15 5l4 4'
  };

  /* Notes older than the ones every page shares, so the list reaches its months. */
  var OLDER = [
    { id: 'n9', title: 'Customer research readout', group: 'October', time: '13:00', day: '22 Oct', length: '36 min', kind: 'shared', faces: 'priya,lena,aiko', summary: 'People pay for minutes of notes, not seats. Three teams asked for notes in their own language.', open: 0, todo: 0 },
    { id: 'n10', title: 'Harbourline intro', group: 'October', time: '11:00', day: '14 Oct', length: '28 min', kind: 'call', faces: 'priya,diego', summary: 'Harbourline cares where the notes are written and who can read them.', open: 0, todo: 0 },
    { id: 'n11', title: 'All hands', group: 'September', time: '16:30', day: '24 Sep', length: '48 min', kind: 'call', faces: 'priya,kofi,ines,aiko,maya,lena,diego,nadia,omar,felix,zara', summary: 'Alcove opens to teams in November, and everyone gets a say in the launch checklist.', open: 0, todo: 0 }
  ];

  var DETAIL = {
    n1: {
      organizer: 'art', at: 'Today at 11:58', verified: '11:58',
      long: 'Art walks Ines through moving the warehouse to the new site, from booking the movers to which suppliers come too. They agree that orders placed before the move ship from the old warehouse, and that the order page shows the new delivery times once the date is set.',
      decisions: [{ id: 'd1', t: 'Orders placed before the move ship from the old warehouse.', at: '06:12', state: 'proposed' }],
      follow: [{ id: 'y1', t: 'Book the movers for the 14th', at: '04:10', due: 'Friday' }, { id: 'y2', t: 'List which suppliers move with us', at: '04:52', due: 'Monday' }],
      said: [
        { who: 'art', at: '00:40', t: 'The plan is to move the warehouse to the new site by the end of the month.' },
        { who: 'ines', at: '04:10', t: 'Book the movers first. Nothing else can be planned until we have a date, and the order page can wait a week.' },
        { who: 'art', at: '04:52', t: 'I’ll list which suppliers move with us, so nobody’s caught out.' },
        { who: 'ines', at: '06:12', t: 'Orders placed before the move have to ship from the old warehouse, or customers wait twice.' },
        { who: 'art', at: '09:32', t: 'Let’s update the delivery times on the order page once the date’s set.' }
      ]
    },
    /* Team standup, as Note.dc.html writes it out: same organizer, decisions, follow-ups and moments. */
    n2: {
      organizer: 'art', at: 'Today at 09:00', verified: '09:24',
      long: 'The new onboarding ships behind a flag on 12 November, and support gets the help article first. Kofi flagged two items still open on the launch checklist, to look at before the design review.',
      decisions: [
        { id: 'd2', t: 'The new onboarding ships behind a flag on 12 November.', at: '03:15', state: 'proposed' },
        { id: 'd2b', t: 'Support gets the help article before the flag goes on.', at: '06:02', state: 'confirmed', by: 'Priya' }
      ],
      follow: [
        { id: 'y3', t: 'Review the launch checklist', at: '08:40', due: 'Today', soon: true },
        { id: 'y3b', t: 'Write the help article for support', at: '06:20', due: 'Friday', owner: 'priya' },
        { id: 'y3c', t: 'Add the flag to the rollout plan', at: '10:05', due: '', owner: 'kofi', done: true }
      ],
      said: [
        { who: 'kofi', at: '01:48', t: 'Agreed. Put it behind a flag and we can watch the first few hundred people go through it.' },
        { who: 'maya', at: '02:36', t: 'Does the flag change anything for the trial numbers? I’m closing the month on the twelfth.' },
        { who: 'art', at: '03:15', t: 'Then let’s say it. The new onboarding ships behind a flag on 12 November.' },
        { who: 'maya', at: '05:40', t: 'They’ll get the questions on day one, whatever we do.' },
        { who: 'art', at: '06:02', t: 'So support gets the help article before the flag goes on. Before, not the same day.' },
        { who: 'priya', at: '06:20', t: 'I’ll write it. Friday at the latest.' },
        { who: 'kofi', at: '08:40', t: 'Launch checklist. Two items are still open, and I’d like someone to look before the design review.' },
        { who: 'kofi', at: '16:58', t: 'Rollout’s fine. We start with one per cent and go from there.' }
      ]
    },
    n3: {
      organizer: 'maya', got: { role: 'invited', by: 'maya' }, at: 'Yesterday at 15:00', verified: 'Tue 15:33',
      long: 'Maya compares seat pricing with usage pricing, and everyone leans towards minutes of notes as the thing people pay for. The team plan gets a monthly option, and free minutes stay as they are.',
      decisions: [
        { id: 'd3', t: 'The team plan gets a monthly option.', at: '12:48', state: 'confirmed', by: 'Maya' },
        { id: 'd4', t: 'Free minutes stay as they are.', at: '17:05', state: 'confirmed', by: 'Lena' }
      ],
      follow: [{ id: 'y4', t: 'Send Kofi the pricing draft', at: '24:30', due: 'Friday' }],
      said: [
        { who: 'maya', at: '04:20', t: 'Seats or usage: everyone leans towards minutes of notes as the thing people pay for.' },
        { who: 'maya', at: '12:48', t: 'The team plan gets a monthly option, because nobody wants to commit for a year.' },
        { who: 'lena', at: '17:05', t: 'Free minutes stay as they are. Cutting them would hurt sign-ups.' },
        { who: 'art', at: '24:30', t: 'I’ll send Kofi the pricing draft before Friday.' },
        { who: 'maya', at: '28:15', t: 'Keep the monthly option behind a flag until the launch.' }
      ]
    },
    n4: {
      organizer: 'art', at: 'Yesterday at 11:00', verified: 'Tue 11:46',
      long: 'Kofi walks through the sidebar in both themes, and it reads better dark. The team agrees on one filled button per view, and Aiko finds three on the pricing page.',
      decisions: [
        { id: 'd5', t: 'One filled button per view from now on.', at: '18:22', state: 'confirmed', by: 'you' },
        { id: 'd6', t: 'The sidebar stays dark in both themes.', at: '07:10', state: 'confirmed', by: 'Kofi' }
      ],
      follow: [{ id: 'y5', t: 'Cut the pricing page to one filled button', at: '31:40', due: 'Done', done: true, owner: 'aiko' }],
      said: [
        { who: 'kofi', at: '07:10', t: 'The sidebar reads better dark, in both themes.' },
        { who: 'priya', at: '18:22', t: 'One filled button per view from now on.' },
        { who: 'aiko', at: '31:02', t: 'The pricing page needs the same rule. It has three filled buttons.' },
        { who: 'kofi', at: '38:10', t: 'The new empty states can ride the same flag.' }
      ]
    },
    n5: {
      organizer: 'art', at: 'Monday at 14:10', verified: 'Mon 15:04', only: true,
      long: 'Jonas is strong on distributed systems and wants to stay close to customers. They’d rather ship to people than join a platform team.',
      decisions: [],
      follow: [{ id: 'y6', t: 'Send Jonas the take-home', at: '49:20', due: 'Thursday' }],
      said: [
        { name: 'Jonas', at: '11:30', t: 'Most of my work has been distributed systems: consensus, storage, the boring parts.' },
        { name: 'Jonas', at: '38:05', t: 'I want to stay close to customers, not disappear into a platform team.' },
        { who: 'art', at: '49:20', t: 'I’ll send the take-home tomorrow.' }
      ]
    },
    n6: {
      organizer: 'art', at: 'Monday at 10:30', verified: 'Mon 11:43', only: true,
      long: 'The Harbourline team records every handover on the floor, shift to shift. Half the crew reads Portuguese, so they need notes in Portuguese.',
      decisions: [], follow: [],
      said: [
        { name: 'Inês', at: '08:15', t: 'Every handover on the floor gets recorded, shift to shift.' },
        { name: 'Inês', at: '41:40', t: 'Half the crew reads Portuguese, so the notes need to be in Portuguese.' }
      ]
    },
    n7: {
      organizer: 'priya', got: { role: 'invited', by: 'priya' }, at: 'Tuesday 27 October at 16:00', verified: '27 Oct',
      long: 'The launch moves to the 18th so the onboarding flag has a week to settle. Sign-ups are back up after the pricing change.',
      decisions: [{ id: 'd7', t: 'The launch moves to the 18th.', at: '06:30', state: 'confirmed', by: 'Priya' }],
      follow: [],
      said: [
        { who: 'priya', at: '06:30', t: 'The launch moves to the 18th, so the onboarding flag has a week to settle.' },
        { who: 'ines', at: '21:30', t: 'Sign-ups are back up after the pricing change.' }
      ]
    },
    n8: {
      organizer: 'ines', got: { role: 'shared', by: 'ines' }, at: 'Monday 26 October at 09:30', verified: '26 Oct',
      long: 'Runway is 22 months at the current burn. The ask stays at the same size, and the pricing change is the story.',
      decisions: [], follow: [],
      said: [
        { who: 'maya', at: '02:50', t: 'Runway is 22 months at the current burn.' },
        { who: 'ines', at: '19:40', t: 'The ask stays at the same size. The pricing change is the story.' }
      ]
    },
    n9: {
      organizer: 'priya', got: { role: 'shared', by: 'priya', group: 'Product' }, at: 'Thursday 22 October at 13:00', verified: '22 Oct',
      long: 'Lena’s interviews point to minutes of notes, not seats, as the thing people pay for. Three teams asked for notes in their own language.',
      decisions: [], follow: [],
      said: [
        { who: 'lena', at: '09:12', t: 'Nobody asked for seats. They asked what a minute of notes costs.' },
        { who: 'lena', at: '22:47', t: 'Three teams asked for notes in their own language.' }
      ]
    },
    n10: {
      organizer: 'priya', got: { role: 'invited', by: 'priya' }, at: 'Wednesday 14 October at 11:00', verified: '14 Oct',
      long: 'Harbourline cares where the notes are written and who can read them. Priya leads with confidential compute.',
      decisions: [], follow: [],
      said: [
        { who: 'diego', at: '05:02', t: 'They want to know where the notes are written, and who can read them.' },
        { who: 'priya', at: '11:18', t: 'Then we lead with confidential compute.' }
      ]
    },
    n11: {
      organizer: 'ines', got: { role: 'invited', by: 'ines' }, at: 'Thursday 24 September at 16:30', verified: '24 Sep',
      long: 'The quarter in ten minutes: Alcove opens to teams in November, and everyone gets a say in the launch checklist.',
      decisions: [], follow: [],
      said: [{ who: 'ines', at: '03:20', t: 'Alcove opens to teams in November.' }]
    }
  };

  /* What the two notes in progress look like, when a step brings them in. */
  var BUSY = {
    n0: { id: 'n0', title: 'Pricing follow-up', group: 'Today', time: '15:40', day: 'Today', length: '26 min', kind: 'call', faces: 'maya,lena', summary: '', status: 'writing', open: 0, todo: 0 },
    r0: { id: 'r0', title: 'Harbourline walkthrough', group: 'Today', time: '16:02', day: 'Today', length: '', kind: 'room', faces: '', summary: '', status: 'recording', open: 0, todo: 0 },
    /* A call still going: its notes can be deleted once it ends. */
    c0: { id: 'c0', title: 'Launch check-in', group: 'Today', time: '16:30', day: 'Today', length: '', kind: 'call', faces: 'priya,kofi', summary: '', status: 'recording', open: 0, todo: 0 },
    /* Ready, with nothing to say or no summary: the row says so where the summary would be. */
    e0: { id: 'e0', title: 'Supplier check-in', group: 'Today', time: '13:30', day: 'Today', length: '4 min', kind: 'call', faces: 'lena', summary: 'Nothing was said while notes were on.', open: 0, todo: 0 },
    e1: { id: 'e1', title: 'Quarterly numbers', group: 'Today', time: '12:40', day: 'Today', length: '31 min', kind: 'call', faces: 'maya', summary: 'Nothing was said while notes were on.', open: 0, todo: 0 }
  };
  DETAIL.n0 = { organizer: 'art', at: 'Today at 15:40', decisions: [], follow: [], said: [], long: '' };
  DETAIL.r0 = { organizer: 'art', at: 'Today at 16:02', decisions: [], follow: [], said: [], long: '', only: true };
  DETAIL.c0 = { organizer: 'art', at: 'Today at 16:30', decisions: [], follow: [], said: [], long: '' };
  DETAIL.e0 = { organizer: 'art', at: 'Today at 13:30', decisions: [], follow: [], said: [], long: '', blank: 'nothing' };
  DETAIL.e1 = { organizer: 'art', at: 'Today at 12:40', decisions: [], follow: [], said: [], long: '', blank: 'unwritten' };

  /* Answers to questions across every note. Each cites the notes and the moments in them. */
  var ANSWERS = [
    {
      match: /pric|plan\b|seat|free minutes/i, picked: 'n3',
      text: 'The team plan gets a monthly option, and free minutes stay as they are. Everyone leans towards minutes of notes as the thing people pay for, not seats. Aiko found three filled buttons on the pricing page, so that page changes too.',
      cites: [{ note: 'n3', at: ['04:20', '12:48', '17:05'] }, { note: 'n4', at: ['31:02'] }, { note: 'n9', at: ['09:12'] }]
    },
    {
      match: /launch|ship|onboarding|18th|flag/i, picked: 'n2',
      text: 'The new onboarding ships behind a flag on 12 November, and support gets the help article first. The launch itself moves to the 18th, so the flag has a week to settle, and the monthly option stays behind a flag until then. The 12 November date is still waiting for someone to confirm it.',
      cites: [{ note: 'n2', at: ['03:15', '06:02'] }, { note: 'n3', at: ['28:15'] }, { note: 'n7', at: ['06:30'] }]
    },
    {
      match: /harbourline|portuguese|language/i, picked: 'n6',
      text: 'Harbourline records every handover, and half the crew reads Portuguese, so they need notes in Portuguese. They also want to know where the notes are written and who can read them.',
      cites: [{ note: 'n6', at: ['08:15', '41:40'] }, { note: 'n10', at: ['05:02'] }]
    },
    {
      match: /runway|board|burn|raise/i, picked: 'n8',
      text: 'Runway is 22 months at the current burn. The ask stays at the same size, and the pricing change is the story.',
      cites: [{ note: 'n8', at: ['02:50', '19:40'] }]
    },
    {
      match: /decid|this week|what.*(open|left|waiting)/i, picked: 'n1',
      text: 'Two decisions are waiting for you: orders before the move ship from the old warehouse, and onboarding ships behind a flag on 12 November. The team plan’s monthly option and keeping free minutes are confirmed.',
      cites: [{ note: 'n1', at: ['06:12'] }, { note: 'n2', at: ['03:15'] }, { note: 'n3', at: ['12:48', '17:05'] }]
    }
  ];

  /* The page's states. The ids stay clear of Home's table, which AH.page reads too. */
  var ALL = { d1: 'yes' };
  var STEPS = {
    list: {},
    /* Search */
    lineHot: { hot: 'line' },
    typing: { q: 'flag', focus: true, picked: 'n2' },
    momentHot: { q: 'flag', focus: true, picked: 'n2', hot: 'said-03:15' },
    moment: { picked: 'n2', opened: 'n2', openedAt: '03:15' },
    noMatch: { q: 'portugal', focus: true, hot: 'none-clear' },
    searchFailed: { q: 'portugal', focus: true, failed: true },
    /* A person */
    chipHot: { hot: 'who-priya' },
    withPriya: { who: 'priya', picked: 'n2' },
    withPriyaHot: { who: 'priya', picked: 'n2', hot: 'with-x' },
    addHot: { hot: 'add' },
    pickOpen: { pop: 'pick', hot: 'pick-lena' },
    withLena: { who: 'lena', picked: 'n3' },
    withNobody: { who: 'sam', hot: 'none-anyone' },
    /* Kinds */
    roomHot: { hot: 'tab-room' },
    room: { show: 'room', picked: 'n5' },
    sharedHot: { hot: 'tab-shared' },
    sharedList: { show: 'shared', picked: 'n8' },
    noneSharedHot: { noShared: true, hot: 'tab-shared' },
    noneShared: { noShared: true, show: 'shared' },
    /* Picking and opening */
    rowHot: { hot: 'row-n2' },
    rowPicked: { picked: 'n2' },
    openHot: { picked: 'n2', hot: 'open' },
    opened: { picked: 'n2', opened: 'n2' },
    openedOther: { picked: 'n3', opened: 'n3' },
    /* Settling */
    confirmHot: { hot: 'yes-d1' },
    confirmedOne: { done: ALL, hot: 'tick-y1' },
    tickedOne: { done: ALL, ticks: { y1: true } },
    /* Someone says a decision wasn't decided */
    disputedYours: { picked: 'n3', disputed: 'd3' },
    disputedOrganizer: { picked: 'n4', settling: 'd5' },
    /* Pinning */
    pinHot: { hot: 'pin' },
    pinnedOne: { pins: ['n4', 'n6', 'n1'] },
    /* Share */
    shareHot: { hot: 'share' },
    shareOpen: { pop: 'share', hot: 'share-g1' },
    sharePicked: { pop: 'share', shareSel: ['g1'], hot: 'share-go' },
    shareSent: { shares: { n1: { group: 'Leads', ids: ['priya', 'kofi'] } }, toast: 'Shared with Leads', stay: true },
    /* Who has it */
    whoHot: { picked: 'n11', hot: 'who' },
    whoOpen: { picked: 'n11', pop: 'who', whoTop: 146, hot: 'who-all' },
    whoAll: { picked: 'n11', pop: 'who', whoTop: 146, whoAll: true },
    /* More */
    moreHot: { hot: 'more' },
    moreOpen: { pop: 'more', hot: 'more-delete' },
    moreConfirm: { pop: 'more', sure: true, hot: 'more-sure' },
    moreGone: { gone: ['n1'], toast: 'Art’s call is deleted for everyone: the notes, the transcript and the audio.', stay: true },
    moreTheirs: { picked: 'n3', pop: 'more' },
    moreInCall: { busy: ['c0'], picked: 'c0', pop: 'more' },
    /* Asking */
    askTyped: { q: 'When does onboarding ship?', focus: true, picked: 'n2', hot: 'ask' },
    asking: { q: 'When does onboarding ship?', asked: 'reading', askQ: 'When does onboarding ship?', picked: 'n2' },
    askDone: { q: 'When does onboarding ship?', asked: 'answer', askQ: 'When does onboarding ship?', picked: 'n2' },
    askDoneHot: { q: 'When does onboarding ship?', asked: 'answer', askQ: 'When does onboarding ship?', picked: 'n2', hot: 'cite-n2-03:15' },
    answerNone: { q: 'Who ordered the cake?', asked: 'none', askQ: 'Who ordered the cake?' },
    answerGone: { q: 'When does onboarding ship?', asked: 'gone', askQ: 'When does onboarding ship?', picked: 'n2' },
    /* Notes still on their way */
    writing: { busy: ['n0'], picked: 'n0' },
    recording: { busy: ['r0'], picked: 'r0' },
    writingAgain: { picked: 'n3', again: 'n3' },
    /* A note with no summary, and one that went */
    nothingSaid: { busy: ['e0'], picked: 'e0' },
    summaryFailed: { busy: ['e1'], picked: 'e1' },
    pvGone: { picked: 'n4', gonePv: true },
    /* The first day */
    first: { first: true },
    firstHot: { first: true, hot: 'first-go' },
    exHot: { first: true, hot: 'ex-open' },
    exOpen: { first: true, opened: 'ex' }
  };

  AH.NT = {
    icons: ICONS,
    notes: D.notes.concat(OLDER),
    busy: BUSY,
    detail: DETAIL,
    answers: ANSWERS,
    steps: STEPS,
    /* Everyone in a note's faces who isn't in AH.D.people. */
    /* The notes Note.dc.html writes out: the step that lands on each moment, and the example, which is its first-day scene. */
    written: { n2: { '03:15': 'n-jumped', '08:40': 'n-chipped' }, ex: { scene: 'first' } },
    names: { nadia: 'Nadia Haddad', omar: 'Omar Farouk', felix: 'Felix Wagner', zara: 'Zara Ahmed' },
    /* Newest first, as the groups read. */
    order: ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'n10', 'n11'],
    example: {
      title: 'Weekly product call', length: '24 min', faces: 'art,theo,priya,kofi', people: 'You, Theo, Priya and Kofi',
      summary: 'Sign-ups are back up since Tuesday’s fix, so the launch moves to the 18th. Kofi sends the new screens by Wednesday.',
      said: { by: 'Priya', t: 'Do we tell the press before the 18th?', at: '04:41' },
      decide: { t: 'The launch moves to the 18th.', at: '04:12', by: 'Theo' },
      follow: { t: 'Send the new screens', at: '05:02', due: 'Wed', owner: 'kofi' }
    }
  };
})();
