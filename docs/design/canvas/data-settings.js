/*
 * Settings, regrouped: what the page knows. Seven groups instead of twelve parts, each event that can reach you said
 * once (with an Alert and a Sound column), Google and agents together under Connections, and the steps that land the
 * page on each state. Keyed to AH.D, so it tells the same story as the other pages.
 */
(function () {
  var AH = window.AH, D = AH.D;

  /* Lucide 1.66, written as one path each. */
  var I = {
    user: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M8 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0',
    bell: 'M10.268 21a2 2 0 0 0 3.464 0M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326',
    bellOff: 'M10.268 21a2 2 0 0 0 3.464 0M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742M2 2l 20 20M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05',
    vol: 'M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298zM16 9a5 5 0 0 1 0 6M19.364 18.364a9 9 0 0 0 0-12.728',
    volX: 'M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298zM16.5 14.5l 5-5M16.5 9.5l 5 5',
    play: 'M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z',
    hand: 'M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15',
    question: 'M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01',
    at: 'M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8',
    reply: 'M20 18v-2a4 4 0 0 0-4-4H4M9 17l-5-5 5-5',
    dm: 'M22 8.5V5a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v16.286a.71.71 0 0 0 1.212.502l2.202-2.202A2 2 0 0 1 6.828 19H10M20 15v-2a2 2 0 0 0-4 0v2M15 15h6a1 1 0 0 1 1 1v3a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1z',
    door: 'M10 21H2M10 3H7a2 2 0 00-2 2v16M14 12h.01M19 21V5a2 2 0 00-1.675-1.974l-6.163-1.013A1 1 0 0010 3v18a1 1 0 001.124.992zM22 21h-3',
    timer: 'M10 2L14 2M12 14L15 11M4 14a8 8 0 1 0 16 0a8 8 0 1 0 -16 0',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3.128a4 4 0 0 1 0 7.744M22 21v-2a4 4 0 0 0-3-3.87M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0',
    mic: 'M12 19v3M19 10v2a7 7 0 0 1-14 0v-2M12 2h0a3 3 0 0 1 3 3v7a3 3 0 0 1 -3 3h0a3 3 0 0 1 -3 -3v-7a3 3 0 0 1 3 -3z',
    ring: 'M16 2v6h6M22 2l-6 6M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384',
    fileCheck: 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2zM14 2v5a1 1 0 0 0 1 1h5M9 15l 2 2 4-4',
    share2: 'M15 5a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M3 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M15 19a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M8.59 13.51L15.42 17.49M15.41 6.51L8.59 10.49',
    asks: 'M11 12h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 14M7 18l 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9M2 13l 6 6',
    todo2: 'M21 10.656V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.344M9 11l 3 3L22 4',
    filePen: 'M12.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v9.34M14 2v5a1 1 0 0 0 1 1h5M10.378 12.622a1 1 0 0 1 3 3.003L8.36 20.637a2 2 0 0 1-.854.506l-2.867.837a.5.5 0 0 1-.62-.62l.836-2.869a2 2 0 0 1 .506-.853z',
    folder: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
    building: 'M12 10h.01M12 14h.01M12 6h.01M16 10h.01M16 14h.01M16 6h.01M8 10h.01M8 14h.01M8 6h.01M9 22v-3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-16a2 2 0 0 1 2 -2z',
    bot: 'M12 8V4H8M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-8a2 2 0 0 1 2 -2zM2 14h2M20 14h2M15 13v2M9 13v2',
    monitor: 'M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2zM8 21L16 21M12 17L12 21',
    plus: 'M5 12h14M12 5v14',
    ext: 'M7 7h10v10M7 17 17 7',
    retry: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8M21 3v5h-5',
    trash: 'M10 11v6M14 11v6M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
    sealed: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1zM9 12l 2 2 4-4',
    server: 'M4 2h16a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-4a2 2 0 0 1 2 -2zM4 14h16a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-4a2 2 0 0 1 2 -2zM6 6L6.01 6M6 18L6.01 18',
    lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-7a2 2 0 0 1 2 -2zM7 11V7a5 5 0 0 1 10 0v4',
    globe: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20',
    compass: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0M16.24 7.76l-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z',
    out: 'M16 17l 5-5-5-5M21 12H9M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4',
    check: 'M20 6 9 17l-5-5',
    x: 'M18 6 6 18M6 6l 12 12',
    alert: 'M21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01',
    down: 'M6 9l 6 6 6-6',
    up: 'M18 15l-6-6-6 6',
    chev: 'M9 18l 6-6-6-6',
    copy: 'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2zM4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2',
    key: 'M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4zM16 7.5a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0 -1 0',
    sparkles: 'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594zM20 2v4M22 4h-4M2 20a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
    upload: 'M12 13v8M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M8 17l 4-4 4 4',
    clock: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0M12 6v6l4 2',
    wave: 'M2 10v3M6 6v11M10 3v18M14 8v7M18 5v13M22 10v3',
    laptop: 'M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2zM20.054 15.987H3.946',
    micOff: 'M12 19v3M15 9.34V5a3 3 0 0 0-5.68-1.33M16.95 16.95A7 7 0 0 1 5 12v-2M18.89 13.23A7 7 0 0 0 19 12v-2M2 2l 20 20M9 9v3a3 3 0 0 0 5.12 2.12',
    videoOff: 'M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2M2 2l 20 20',
    speaker: 'M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298zM16 9a5 5 0 0 1 0 6M19.364 18.364a9 9 0 0 0 0-12.728',
    notes: 'M2 6h4M2 10h4M2 14h4M2 18h4M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-16a2 2 0 0 1 2 -2zM9.5 8h5M9.5 12H16M9.5 16H14',
    transcript: 'M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2zM7 8h10M7 12h6'
  };

  /* The seven groups, in the order people come for them. `tag` says what a group is limited to. */
  var GROUPS = [
    { id: 'you', nav: 'You', h: 'You' },
    { id: 'calls', nav: 'Calls and notes', h: 'Calls and notes' },
    { id: 'av', nav: 'Audio and video', h: 'Audio and video', tag: 'This browser' },
    { id: 'alerts', nav: 'Notifications', h: 'Notifications' },
    { id: 'apps', nav: 'Connections', h: 'Connections' },
    { id: 'plan', nav: 'Plan and credits', h: 'Plan and credits' },
    { id: 'privacy', nav: 'Privacy', h: 'Privacy' }
  ];

  /*
   * Everything that can get your attention, each said once. `a`: it can alert you (on screen in Alcove, and in the
   * browser when Alcove is in another tab); `s`: it can make a sound. null: that way doesn't apply. The values are where
   * a new account starts.
   */
  var EVENTS = [
    { id: 'dm', grp: 'call', t: 'Private messages', icon: 'dm', a: true, s: true },
    { id: 'mention', grp: 'call', t: 'Mentions', icon: 'at', a: true, s: true },
    { id: 'reply', grp: 'call', t: 'Replies to you', icon: 'reply', a: true, s: true },
    { id: 'knock', grp: 'call', t: 'Requests to join', q: 'When you host', icon: 'door', a: true, s: true },
    { id: 'hand', grp: 'call', t: 'Raised hands', q: 'When you host or present', icon: 'hand', a: true, s: true },
    { id: 'question', grp: 'call', t: 'New questions', q: 'When you host or present', icon: 'question', a: false, s: true },
    { id: 'timer', grp: 'call', t: 'The timer running out', icon: 'timer', a: true, s: true },
    { id: 'people', grp: 'call', t: 'People joining and leaving', icon: 'users', a: null, s: true },
    { id: 'mic', grp: 'call', t: 'Your microphone on and off', icon: 'mic', a: null, s: true },
    { id: 'ring', grp: 'out', t: 'Someone rings you', icon: 'ring', a: true, s: true },
    { id: 'ready', grp: 'out', t: 'Your notes are ready', icon: 'fileCheck', a: true, s: null },
    { id: 'shared', grp: 'out', t: 'Notes shared with you', icon: 'share2', a: true, s: null },
    { id: 'asked', grp: 'out', t: 'Someone asks for notes', q: 'Calls you organize', icon: 'asks', a: true, s: null },
    { id: 'due', grp: 'out', t: 'A follow-up is due', q: 'At 9:00 that day', icon: 'todo2', a: false, s: null },
    { id: 'tagged', grp: 'out', t: 'Mentions in documents', icon: 'filePen', a: true, s: null }
  ];
  var EVENT_GROUPS = [{ id: 'call', h: 'In a call' }, { id: 'out', h: 'Outside a call' }];

  var LANGS = ['Same as the call', 'English', 'Spanish', 'French', 'German', 'Portuguese', 'Italian', 'Dutch', 'Japanese', 'Chinese', 'Korean', 'Hindi', 'Arabic'];
  /* The demo world's models: two in confidential compute, two that aren't. The first is the default. */
  var MODELS = [
    { t: 'DeepSeek V4.1 Flash', note: 'Default · confidential compute' },
    { t: 'GLM 5.3 Flash', note: 'Confidential compute' },
    { t: 'Claude Haiku 5.5', note: 'Outside confidential compute', open: true },
    { t: 'GPT-6 Luna', note: 'Outside confidential compute', open: true }
  ];
  var MICS = ['Same as system (MacBook Pro Microphone)', 'MacBook Pro Microphone', 'Shure MV7', 'AirPods Pro'];
  var SPEAKERS = ['Same as system (MacBook Pro Speakers)', 'MacBook Pro Speakers', 'Studio Display Speakers', 'AirPods Pro'];
  var CAMERAS = ['FaceTime HD Camera', 'Studio Display Camera'];

  /* Google Drive: the folders it offers, what it can export, and what went lately. */
  var FOLDERS = [
    { t: 'My Drive', sub: 'Google Drive', icon: 'folder' },
    { t: 'Call notes', sub: 'Vandelay Industries · shared drive', icon: 'building' },
    { t: 'Product', sub: 'Vandelay Industries · shared drive', icon: 'building' },
    { t: 'Clients', sub: 'My Drive', icon: 'folder' }
  ];
  var FORMATS = [
    { id: 'notes', t: 'Notes', sub: '.md', icon: 'notes' },
    { id: 'transcript', t: 'Transcript', sub: '.txt', icon: 'transcript' },
    { id: 'recording', t: 'Recording', sub: '.zip', icon: 'wave' }
  ];
  var JOBS = [
    { call: 'Design review', what: 'Notes', state: 'done', when: '16:40' },
    { call: 'Design review', what: 'Transcript', state: 'done', when: '16:40' },
    { call: 'Pricing sync', what: 'Recording', state: 'failed', when: '11:12', why: 'Too large for the folder’s space.' }
  ];

  /* Agents connected to the account. */
  var AGENTS = [
    { id: 'desk', name: 'Claude Desktop', how: 'Signed in with Alcove', can: 'Read notes · Read calls · Read calendar', last: 'Used today' },
    { id: 'script', name: 'Weekly digest script', how: 'Token', can: 'Read notes', last: 'Expires 2 Dec' }
  ];
  var PERMS = [
    { id: 'notes-read', t: 'Read notes', on: true },
    { id: 'notes-write', t: 'Edit notes and follow-ups', on: false },
    { id: 'meet-read', t: 'Read calls and find people', on: true },
    { id: 'meet-write', t: 'Schedule and manage calls', on: false },
    { id: 'cal-read', t: 'Read calendar', on: true }
  ];

  var LEDGER = [
    { a: 'Your name, email and photo', b: 'What was said' },
    { a: 'When calls happen', b: 'Your notes and summaries' },
    { a: 'Who was invited', b: 'The audio' }
  ];

  /* Who the page can be open for. */
  var MINE = D.notes.filter(function (n) { return n.kind !== 'shared'; }).length;
  var PEOPLE = {
    today: {
      me: { id: D.me.id, name: D.me.name, email: D.me.email }, via: 'Google', company: D.company, mine: MINE, calls: 3,
      left: '6 h 26 min', share: 0.64, used: '3 h 34 min', groups: true, spaces: true
    },
    first: {
      me: { id: D.me.id, name: D.me.name, email: D.me.email }, via: 'Google', company: D.company, mine: 0, calls: 0,
      left: '6 h 40 min', share: 1, used: 'None yet', groups: false
    },
    demo: {
      me: { id: 'art', name: 'Art Vandelay', email: 'art@vandelay.industries' }, via: 'Microsoft', company: D.company, mine: 3, calls: 5,
      left: '6 h 26 min', share: 0.64, used: '3 h 34 min', groups: true, demo: true
    },
    sso: {
      me: { id: 'kofi', name: 'Kofi Asante', email: 'kofi@vandelay.industries' }, via: 'single sign-on', sso: true, company: D.company, mine: 12, calls: 4,
      left: '6 h 26 min', share: 0.64, used: '3 h 34 min', groups: true
    }
  };

  /* Where each person starts. Every control's state lives here, so a step only names what's different. */
  var PREFS = {
    notes: 'on', lang: 0, summary: 'short', model: 0, offline: true, addCal: true, others: true,
    mic: 0, speaker: 0, camera: 0, noise: true, theme: 'system', vol: 70, muted: false, quiet: false, before: '5'
  };
  function events() { var o = {}; EVENTS.forEach(function (e) { o[e.id] = { a: e.a, s: e.s }; }); return o; }
  function start(scene) {
    var first = scene === 'first', demo = scene === 'demo';
    return {
      p: AH.assign({}, PREFS), ev: events(), perm: first ? 'default' : 'granted', alertsOn: true,
      cal: demo ? 'sample' : first ? 'none' : 'google', calBusy: '',
      drive: first || demo ? 'none' : 'set', driveOpen: false, folder: 1, formats: { notes: true, transcript: true, recording: false }, auto: true, driveBusy: '',
      agents: first ? [] : AGENTS.slice(), agent: '', perms: PERMS.map(function (x) { return x.on; }), tokenName: 'Weekly digest script',
      micPerm: first ? 'prompt' : 'granted', camPerm: first ? 'prompt' : 'granted', canPick: true,
      waiting: first || demo ? 0 : 2, stuck: 0, size: '184 MB', trust: 'verified',
      checking: false, lvl: 0, left: 8, playing: false, saved: '', bad: '', open: '', prompt: '', notice: '',
      out: false, outBusy: false, del: '', gone: '', at: 'you', topUp: false
    };
  }

  /*
   * What each step of a journey starts from. `to` is the group or block the page lands on; `hot` marks what's about to
   * be pressed. None of these ids may be one of Home's in home.js, which reads the same `step`.
   */
  function p(patch) { return AH.assign({}, PREFS, patch); }
  function ev(patch) { var o = events(); Object.keys(patch).forEach(function (k) { o[k] = AH.assign({}, o[k], patch[k]); }); return o; }
  var STEPS = {
    rest: {},
    /* Getting around. */
    jumpHot: { hot: 'idx-alerts' },
    jumped: { to: 'alerts' },
    jumpApps: { to: 'apps' },
    /* Notifications: each event once, two ways. */
    whatHot: { to: 'alerts-what', hot: 'm-people-s' },
    whatSaved: { to: 'alerts-what', ev: ev({ people: { s: false } }), saved: 'm-people' },
    muteHot: { to: 'alerts', hot: 'mute' },
    muted: { to: 'alerts-what', p: p({ muted: true }), saved: 'vol' },
    quietOn: { to: 'alerts', p: p({ quiet: true }), saved: 'quiet' },
    permHot: { to: 'alerts', perm: 'default', hot: 'turnon' },
    permAsk: { to: 'alerts', perm: 'default', prompt: 'notify', hot: 'allow' },
    permOn: { to: 'alerts', perm: 'granted', saved: 'perm' },
    permBlocked: { to: 'alerts', perm: 'denied' },
    permNone: { to: 'alerts', perm: 'unsupported' },
    /* Calls and notes. */
    summaryHot: { to: 'calls', hot: 'summary-detailed' },
    summarySaved: { to: 'calls', p: p({ summary: 'detailed' }), saved: 'summary' },
    modelHot: { to: 'calls', hot: 'model' },
    modelOpen: { to: 'calls', open: 'model', hot: 'model-1' },
    modelSaved: { to: 'calls', p: p({ model: 1 }), saved: 'model' },
    /* Google Drive, set up in place. */
    driveHot: { to: 'apps', drive: 'none', hot: 'drive-connect' },
    driveGoing: { to: 'apps', drive: 'none', driveBusy: 'on' },
    driveBack: { to: 'apps', drive: 'new', driveOpen: true, notice: 'drive', hot: 'drive-folder' },
    drivePicking: { to: 'drive', drive: 'new', driveOpen: true, open: 'folder', hot: 'folder-1' },
    driveFiled: { to: 'drive', drive: 'new', driveOpen: true, saved: 'drive-folder', hot: 'drive-auto' },
    driveOn: { to: 'drive', drive: 'set', driveOpen: true, saved: 'drive-auto', hot: 'drive-done' },
    driveShut: { to: 'apps', drive: 'set' },
    driveManage: { to: 'drive', drive: 'set', driveOpen: true },
    /* Agents. */
    agentHot: { to: 'apps-agents', hot: 'agent-connect' },
    agentOpen: { to: 'apps-agents', agent: 'connect', hot: 'agent-copy' },
    agentCopied: { to: 'apps-agents', agent: 'connect', toast: 'Copied. Paste it into your agent’s connections.' },
    agentTokenHot: { to: 'apps-agents', agent: 'connect', hot: 'agent-token' },
    agentToken: { to: 'apps-agents', agent: 'token', hot: 'agent-create' },
    agentIssued: { to: 'apps-agents', agent: 'issued' },
    agentNone: { scene: 'first', to: 'apps-agents' },
    /* Google Calendar. */
    calHot: { to: 'apps', hot: 'disconnect' },
    calOff: { to: 'apps', cal: 'none', toast: 'Google Calendar is disconnected.' },
    calSample: { scene: 'demo', to: 'apps' },
    /* Microphone, speaker and camera. */
    devices: { to: 'av' },
    checkHot: { to: 'av', hot: 'check' },
    checking: { to: 'av', checking: true, lvl: 0.62, left: 5 },
    micBlocked: { to: 'av', micPerm: 'denied' },
    cameraNotYet: { to: 'av', camPerm: 'prompt' },
    /* Appearance. */
    lookHot: { to: 'you', hot: 'theme-light' },
    lookLight: { to: 'you', p: p({ theme: 'light' }), saved: 'theme' },
    /* Plan and credits. */
    plan: { to: 'plan' },
    planLow: { to: 'plan', minutes: { left: '12 min', share: 0.03, used: '6 h 28 min' } },
    planOut: { to: 'plan', minutes: { left: '0 min', share: 0, used: '6 h 40 min' } },
    /* Privacy, and the way out. */
    privacy: { to: 'privacy' },
    delHot: { to: 'del', hot: 'delete' },
    delOpen: { to: 'del', del: 'open' },
    delBusy: { to: 'del', del: 'busy' },
    delGone: { gone: 'deleted' },
    demoHot: { scene: 'demo', to: 'del', hot: 'delete' },
    demoNo: { scene: 'demo', to: 'del', del: 'demo' },
    outHot: { hot: 'signout' },
    outOpen: { out: true },
    outGone: { gone: 'out' },
    /* Who the page is open for, as steps, so every state can be reached the same way. */
    firstDay: { scene: 'first' },
    demoAccount: { scene: 'demo' },
    ssoAccount: { scene: 'sso' }
  };

  AH.ST3 = {
    I: I, GROUPS: GROUPS, EVENTS: EVENTS, EVENT_GROUPS: EVENT_GROUPS, LANGS: LANGS, MODELS: MODELS, MICS: MICS, SPEAKERS: SPEAKERS, CAMERAS: CAMERAS,
    FOLDERS: FOLDERS, FORMATS: FORMATS, JOBS: JOBS, AGENTS: AGENTS, PERMS: PERMS, LEDGER: LEDGER, PEOPLE: PEOPLE, start: start, STEPS: STEPS
  };

  /* What staying signed in does for what's waiting. */
  AH.ST3.staying = function (count) {
    return 'Stay signed in and ' + (count === 1 ? 'it uploads by itself' : 'they upload by themselves') + ' once you’re online, then the notes are written.';
  };

  /* The journeys, one row each, in the order someone would meet them. */
  AH.ST3.JOURNEYS = [
    { name: 'Find a setting', frames: [
      { step: 'jumpHot', t: 'Seven groups instead of twelve parts. Click Notifications in the index beside the page.' },
      { step: 'jumped', t: 'The page glides there, and the small sun on the index moves with it.' }
    ] },
    { name: 'Choose what reaches you', frames: [
      { step: 'whatHot', t: 'Each thing that can reach you is one row, with an Alert and a Sound. Untick Sound for People joining and leaving.' },
      { step: 'whatSaved', t: 'It’s kept at once. Saved shows on the row.' },
      { step: 'muteHot', t: 'To silence everything, click the speaker beside Sounds.' },
      { step: 'muted', t: 'Every sound is off. The Sound column steps back, and keeps your choices for when you turn them on.' }
    ] },
    { name: 'Let alerts reach you in another tab', frames: [
      { step: 'permHot', t: 'Browser notifications aren’t on yet. Alerts still show inside Alcove. Click Turn on.' },
      { step: 'permAsk', t: 'The browser asks. Click Allow.' },
      { step: 'permOn', t: 'They’re on, as a switch. Alerts now reach you when Alcove is in another tab.' }
    ] },
    { name: 'Send notes to Google Drive', frames: [
      { step: 'driveHot', t: 'Under Connections, click Connect beside Google Drive.' },
      { step: 'driveGoing', t: 'Google opens to pick the account. The button says so meanwhile.' },
      { step: 'driveBack', t: 'Back on Settings, Drive is connected and open in place. Click Choose a folder.' },
      { step: 'drivePicking', t: 'Your Drive’s folders open under it. Click Call notes.' },
      { step: 'driveFiled', t: 'Notes and Transcript are ticked already. Turn on Export after each call.' },
      { step: 'driveShut', t: 'Click Done. Drive folds back into one line that says where notes go.' }
    ] },
    { name: 'Connect an agent', frames: [
      { step: 'agentHot', t: 'Click Connect an agent.' },
      { step: 'agentOpen', t: 'It opens in place, with Alcove’s address to paste into your agent. It asks you to sign in there.' },
      { step: 'agentToken', t: 'For a script, click Create a token instead: name it and choose what it can do.' },
      { step: 'agentIssued', t: 'The token shows once, with Copy. The agent joins the list above.' }
    ] },
    { name: 'Change a setting', frames: [
      { step: 'modelHot', t: 'Click the AI model.' },
      { step: 'modelOpen', t: 'The list says which models run in confidential compute.' },
      { step: 'modelSaved', t: 'Pick one. It’s kept for new notes, and Saved shows beside it.' }
    ] },
    { name: 'Sign out, or delete your account', frames: [
      { step: 'outHot', t: 'Sign out sits in the sky, beside you.' },
      { step: 'outOpen', t: 'Recordings here haven’t uploaded, so the sky grows to ask first. Stay signed in is the filled answer.' },
      { step: 'delHot', t: 'Delete account is the last thing on the page.' },
      { step: 'delOpen', t: 'It opens in place: what goes, what stays, and Keep my account in the filled button.' }
    ] }
  ];
  AH.ST3.LIGHT = [
    { step: 'rest', mode: 'light', t: 'The first thing in view: you, then You and Calls and notes.' },
    { step: 'jumped', mode: 'light', t: 'Notifications in the light.' },
    { step: 'driveManage', mode: 'light', t: 'Google Drive open in place, with what went lately.' }
  ];
  AH.ST3.PHONE = [
    { step: 'rest', t: 'On a phone, the index is a strip that stays at the top.' },
    { step: 'jumped', t: 'Notifications: the strip keeps the group in view.' },
    { step: 'whatHot', t: 'The two columns fit beside each event.' },
    { step: 'driveManage', t: 'Google Drive opens in place.' },
    { step: 'agentOpen', t: 'Connect an agent, with Copy.' },
    { step: 'delOpen', t: 'Delete account, in place.' }
  ];
})();
