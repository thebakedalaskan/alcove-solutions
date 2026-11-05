/*
 * Settings: what the page knows. The parts in order, the three people it can be open for, every list a control offers,
 * and the steps that land the page on each of its states. Keyed to AH.D, so it tells the same story as the other pages.
 */
(function () {
  var AH = window.AH, D = AH.D;

  /* Lucide, written as one path each. */
  var I = {
    compass: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0M16.24 7.76l-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z',
    out: 'M16 17l5-5-5-5M21 12H9M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4',
    key: 'M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4zM16.5 7.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z',
    ext: 'M7 7h10v10M7 17L17 7',
    bell: 'M10.268 21a2 2 0 0 0 3.464 0M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326',
    bellOff: 'M10.268 21a2 2 0 0 0 3.464 0M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742M2 2l20 20M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05',
    speaker: 'M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298zM16 9a5 5 0 0 1 0 6M19.364 18.364a9 9 0 0 0 0-12.728',
    micOff: 'M12 19v3M15 9.34V5a3 3 0 0 0-5.68-1.33M16.95 16.95A7 7 0 0 1 5 12v-2M18.89 13.23A7 7 0 0 0 19 12v-2M2 2l20 20M9 9v3a3 3 0 0 0 5.12 2.12',
    videoOff: 'M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2M2 2l20 20',
    globe: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20',
    trash: 'M10 11v6M14 11v6M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
    retry: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5',
    server: 'M4 2h16a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-4a2 2 0 0 1 2 -2zM4 14h16a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-4a2 2 0 0 1 2 -2zM6 6h.01M6 18h.01',
    alert: 'M21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01',
    gear: 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0'
  };

  var PARTS = [
    { id: 'profile', nav: 'Profile', h: 'Profile' },
    { id: 'notes', nav: 'Notes', h: 'Notes' },
    { id: 'recording', nav: 'Recording', h: 'Recording in the room' },
    { id: 'calendar', nav: 'Calendar', h: 'Calendar' },
    { id: 'devices', nav: 'Devices', h: 'Microphone, speaker and camera', tag: 'This browser only' },
    { id: 'alerts', nav: 'Notifications', h: 'Notifications' },
    { id: 'look', nav: 'Appearance', h: 'Appearance', tag: 'This browser only' },
    { id: 'plan', nav: 'Plan and credits', h: 'Plan and credits' },
    { id: 'privacy', nav: 'Privacy', h: 'Privacy' }
  ];

  var LANGS = ['Same as the call', 'English', 'Spanish', 'French', 'German', 'Portuguese', 'Italian', 'Dutch', 'Japanese', 'Chinese', 'Korean', 'Hindi', 'Arabic'];
  var MICS = ['Same as system (MacBook Pro Microphone)', 'MacBook Pro Microphone', 'Shure MV7', 'AirPods Pro'];
  var SPEAKERS = ['Same as system (MacBook Pro Speakers)', 'MacBook Pro Speakers', 'Studio Display Speakers', 'AirPods Pro'];
  var CAMERAS = ['FaceTime HD Camera', 'Studio Display Camera'];

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
    },
    personal: {
      me: { id: D.me.id, name: D.me.name, email: 'art@example.com' }, via: 'Google', company: '', mine: 2, calls: 1,
      left: '6 h 26 min', share: 0.64, used: '3 h 34 min', groups: false
    }
  };

  /* Where each person starts. Every control's state lives here, so a step only names what's different. */
  var PREFS = { notes: 'on', lang: 0, summary: 'short', offline: true, addCal: true, others: true, mic: 0, speaker: 0, camera: 0, noise: true, before: '5', ready: true, shared: true, asked: true, due: false, theme: 'system' };
  function start(scene) {
    var first = scene === 'first', demo = scene === 'demo', quiet = scene === 'sso' || scene === 'personal';
    return {
      p: AH.assign({}, PREFS), cal: demo ? 'sample' : first ? 'none' : 'google', calBusy: '', perm: first ? 'default' : 'granted',
      micPerm: first ? 'prompt' : 'granted', camPerm: first ? 'prompt' : 'granted', canPick: true, waiting: first || demo || quiet ? 0 : 2, stuck: 0, size: '184 MB',
      trust: 'verified', loaded: true, checking: false, lvl: 0, left: 8, playing: false, saved: '', bad: '', open: '', prompt: '', out: false, outBusy: false, del: '', gone: '', at: 'profile'
    };
  }

  /*
   * What each step of a journey starts from. `to` is the part or row the page lands on; `hot` marks what's about to be
   * pressed. None of these ids may be one of Home's in home.js, which reads the same `step`.
   */
  function p(patch) { return AH.assign({}, PREFS, patch); }
  var STEPS = {
    rest: {},
    /* Change something. */
    summaryHot: { to: 'notes', hot: 'summary-detailed' },
    summarySaved: { to: 'notes', p: p({ summary: 'detailed' }), saved: 'summary' },
    summaryRest: { to: 'notes', p: p({ summary: 'detailed' }) },
    langHot: { to: 'notes', hot: 'lang' },
    langOpen: { to: 'notes', open: 'lang', hot: 'lang-3' },
    langSaved: { to: 'notes', p: p({ lang: 3 }), saved: 'lang' },
    /* The server refuses. */
    refuseHot: { to: 'calendar', hot: 'others', refuse: true },
    refusing: { to: 'calendar', p: p({ others: false }), saving: 'others' },
    refused: { to: 'calendar', bad: 'Couldn’t reach Alcove, so Show my other meetings on Home is back as it was.' },
    /* Google Calendar. */
    calHot: { to: 'calendar', hot: 'disconnect' },
    calBusyOff: { to: 'calendar', calBusy: 'off' },
    calOff: { to: 'calendar', cal: 'none', toast: 'Google Calendar is disconnected.' },
    calOffHot: { to: 'calendar', cal: 'none', hot: 'connect' },
    calGoing: { to: 'calendar', cal: 'none', calBusy: 'on' },
    calSample: { scene: 'demo', to: 'calendar' },
    calFailed: { to: 'calendar', cal: 'failed' },
    calOther: { scene: 'sso', to: 'calendar', cal: 'other' },
    /* Microphone, speaker and camera. */
    devices: { to: 'devices' },
    checkHot: { to: 'devices', hot: 'check' },
    checkAsk: { to: 'devices', micPerm: 'prompt', prompt: 'mic', hot: 'allow' },
    checking: { to: 'devices', checking: true, lvl: 0.62, left: 5 },
    checkLoud: { to: 'devices', checking: true, lvl: 0.9, left: 3 },
    micBlocked: { to: 'devices', micPerm: 'denied' },
    micPick: { to: 'devices', open: 'mic', hot: 'mic-2' },
    speakerOpen: { to: 'devices', open: 'speaker' },
    playHot: { to: 'devices', hot: 'play' },
    playing: { to: 'devices', playing: true },
    speakerSystem: { to: 'devices', canPick: false },
    cameraList: { to: 'devices', open: 'camera' },
    cameraSaved: { to: 'devices', p: p({ camera: 1 }), saved: 'camera' },
    cameraNotYet: { to: 'devices', camPerm: 'prompt' },
    cameraBlocked: { to: 'devices', camPerm: 'denied' },
    cameraNone: { to: 'devices', camPerm: 'none' },
    /* Browser notifications. */
    alertsOff: { to: 'alerts', perm: 'default', hot: 'turnon' },
    alertsAsk: { to: 'alerts', perm: 'default', prompt: 'notify', hot: 'allow' },
    alertsAskBlock: { to: 'alerts', perm: 'default', prompt: 'notify', hot: 'block' },
    alertsOn: { to: 'alerts', perm: 'granted' },
    alertsHot: { to: 'alerts', hot: 'before-1' },
    alertsSaved: { to: 'alerts', p: p({ before: '1' }), saved: 'before' },
    alertsBlocked: { to: 'alerts', perm: 'denied' },
    alertsNone: { to: 'alerts', perm: 'unsupported' },
    /* Sign out. */
    outHot: { hot: 'signout' },
    outOpen: { out: true },
    outSome: { out: true, stuck: 1 },
    outStuck: { out: true, stuck: 2 },
    outOne: { out: true, waiting: 1, size: '72 MB' },
    outBusy: { out: true, outBusy: true },
    outClear: { waiting: 0, hot: 'signout' },
    outOffline: { waiting: 0, bad: 'Can’t reach Alcove. Check your connection.' },
    outGone: { gone: 'out' },
    /* Delete account. */
    delHot: { to: 'del', hot: 'delete' },
    delOpen: { to: 'del', del: 'open' },
    delBusy: { to: 'del', del: 'busy' },
    delFailed: { to: 'del', del: 'failed' },
    delOther: { to: 'del', del: 'other' },
    delGone: { gone: 'deleted' },
    demoHot: { scene: 'demo', to: 'del', hot: 'delete' },
    demoNo: { scene: 'demo', to: 'del', del: 'demo' },
    /* Getting around, and the rest. */
    jumpHot: { hot: 'idx-calendar' },
    jumped: { to: 'calendar' },
    tourHot: { hot: 'tour' },
    lookHot: { to: 'look', hot: 'theme-light' },
    lookLight: { to: 'look', p: p({ theme: 'light' }), saved: 'theme' },
    lookDark: { to: 'look', p: p({ theme: 'dark' }), saved: 'theme' },
    plan: { to: 'plan' },
    planLow: { to: 'plan', minutes: { left: '12 min', share: 0.03, used: '6 h 28 min' } },
    planOut: { to: 'plan', minutes: { left: '0 min', share: 0, used: '6 h 40 min' } },
    privacy: { to: 'privacy' },
    notChecked: { to: 'privacy', trust: 'none' },
    notVerified: { to: 'privacy', trust: 'unbound' },
    checkingTrust: { to: 'privacy', trust: 'checking' },
    noPrefs: { loaded: false },
    noPlan: { to: 'plan', planLoaded: false },
    /* Who the page is open for, as steps, so every state can be reached the same way. */
    firstDay: { scene: 'first' },
    demoAccount: { scene: 'demo' },
    ssoAccount: { scene: 'sso' },
    personalAddress: { scene: 'personal' }
  };

  AH.ST2 = { I: I, PARTS: PARTS, LANGS: LANGS, MICS: MICS, SPEAKERS: SPEAKERS, CAMERAS: CAMERAS, LEDGER: LEDGER, PEOPLE: PEOPLE, start: start, STEPS: STEPS };

  /* What staying signed in does for what's waiting: they upload by themselves, unless they're too old or won't open here. */
  AH.ST2.staying = function (count, stuck) {
    var one = count === 1;
    if (stuck >= count) return one ? 'It can’t upload: it’s too old, or won’t open on this device. It stays here until you delete it on Record.' : 'They can’t upload: they’re too old, or won’t open on this device. They stay here until you delete them on Record.';
    var going = count - stuck;
    var upload = stuck === 0 ? (one ? 'it uploads by itself' : 'they upload by themselves') : (going === 1 ? 'one uploads by itself' : going + ' upload by themselves');
    var rest = stuck === 0 ? '' : stuck === 1 ? ' The other can’t upload: it’s too old, or won’t open on this device.' : ' The other ' + stuck + ' can’t upload: they’re too old, or won’t open on this device.';
    return 'Stay signed in and ' + upload + ' once you’re online, then the notes are written.' + rest;
  };

  /* The journeys, one row each, in the order someone would meet them. */
  AH.ST2.JOURNEYS = [
    { name: 'Change a setting', frames: [
      { step: 'summaryHot', t: 'Click Detailed. There’s nothing to save and nothing else to press.' },
      { step: 'summarySaved', t: 'It’s kept. Saved shows in the row, and says it’s for new notes.' },
      { step: 'summaryRest', t: 'Two seconds later Saved has gone, and the row just says Detailed.' }
    ] },
    { name: 'Pick from a list', frames: [
      { step: 'langHot', t: 'Click the language.' },
      { step: 'langOpen', t: 'The list opens under it, on the page. The current one has a tick.' },
      { step: 'langSaved', t: 'Click French. The list closes and the row says Saved.' }
    ] },
    { name: 'The server refuses', frames: [
      { step: 'refuseHot', t: 'Turn off Show my other meetings on Home.' },
      { step: 'refusing', t: 'The switch moves straight away, while it’s being kept.' },
      { step: 'refused', t: 'Refused: it goes back, and a toast says why. No Saved.' }
    ] },
    { name: 'Disconnect Google Calendar', frames: [
      { step: 'calHot', t: 'Click Disconnect.' },
      { step: 'calBusyOff', t: 'It forgets the connection and withdraws Alcove’s access at Google.' },
      { step: 'calOff', t: 'Done. Connect takes its place, and a toast says so.' }
    ] },
    { name: 'Connect Google Calendar', frames: [
      { step: 'calOffHot', t: 'Click Connect.' },
      { step: 'calGoing', t: 'The page goes to Google, which asks about the calendar.' },
      { home: true, t: 'Google sends you back to Home, with your meetings on it.' }
    ] },
    { name: 'A calendar that isn’t Google’s to connect', frames: [
      { scene: 'demo', step: 'calSample', t: 'A demo account has a sample calendar instead. There’s nothing to connect.' },
      { scene: 'sso', step: 'calOther', t: 'Signed in another way, there’s no calendar yet. This is where Home’s Connect your calendar lands.' }
    ] },
    { name: 'Check the level', frames: [
      { step: 'checkHot', t: 'Click Check the level. Nothing opens until you do.' },
      { step: 'checking', t: 'The microphone is open for eight seconds. The level moves as you speak.' },
      { step: 'checkLoud', t: 'Click Stop, or scroll this part away, and it closes sooner.' },
      { step: 'devices', t: 'Closed. Nothing was recorded.' }
    ] },
    { name: 'The browser hasn’t allowed the microphone', frames: [
      { scene: 'first', step: 'checkHot', t: 'First time: click Check the level.' },
      { scene: 'first', step: 'checkAsk', t: 'The browser asks first. Allow, and the level starts.' },
      { step: 'micBlocked', t: 'Block, and the row says how to allow it for this browser, with Try again.' }
    ] },
    { name: 'Play test sound', frames: [
      { step: 'playHot', t: 'Click Play test sound.' },
      { step: 'playing', t: 'A short sound plays through the chosen speaker.' },
      { step: 'speakerSystem', t: 'A browser that can’t choose a speaker says which one it uses.' }
    ] },
    { name: 'The camera is a list', frames: [
      { step: 'cameraList', t: 'Pick a camera. It never opens here, so there’s no picture.' },
      { step: 'cameraSaved', t: 'Saved. You see yourself when you join a call.' },
      { step: 'cameraNotYet', t: 'Until you’ve allowed a camera on the join screen, it says so.' },
      { step: 'cameraBlocked', t: 'Blocked in the browser, or none plugged in, it says that instead.' }
    ] },
    { name: 'Turn on browser notifications', frames: [
      { step: 'alertsOff', t: 'The choices wait, greyed out. Click Turn on.' },
      { step: 'alertsAsk', t: 'The browser asks, only now. Allow.' },
      { step: 'alertsOn', t: 'Allowed. Focus stays on the row and the choices wake up.' },
      { step: 'alertsHot', t: 'Pick how long before a call.' },
      { step: 'alertsSaved', t: 'Saved, like everything else.' }
    ] },
    { name: 'Notifications are blocked', frames: [
      { step: 'alertsAskBlock', t: 'At the same question, Block.' },
      { step: 'alertsBlocked', t: 'The row says where to allow them, and the choices stay as they are.' },
      { step: 'alertsNone', t: 'A browser that can’t show them says which can.' }
    ] },
    { name: 'Sign out with recordings waiting', frames: [
      { step: 'outHot', t: 'Click Sign out.' },
      { step: 'outOpen', t: 'The sky opens under it and asks. Stay signed in has focus, and Escape is the same.' },
      { step: 'outSome', t: 'If one can’t ever upload, it says so.' },
      { step: 'outBusy', t: 'Sign out and delete them: only this account’s recordings go.' },
      { step: 'outGone', t: 'The welcome page, signed out.' }
    ] },
    { name: 'Sign out with nothing waiting', frames: [
      { step: 'outClear', t: 'Nothing on this device, so Sign out asks nothing.' },
      { step: 'outGone', t: 'The welcome page, signed out.' },
      { step: 'outOffline', t: 'With no connection it says so. You stay signed in, and nothing happens later by itself.' }
    ] },
    { name: 'Delete account', frames: [
      { step: 'delHot', t: 'At the end of Privacy, click Delete account.' },
      { step: 'delOpen', t: 'The row opens in place: what goes beside what stays. Keep my account has focus.' },
      { step: 'delFailed', t: 'With no connection, or if it fails, it says so here. Delete my account tries again, and nothing happens later by itself.' },
      { step: 'delBusy', t: 'Delete my account. It says Deleting until it’s done.' },
      { step: 'delGone', t: 'The welcome page, signed out, even if you’d left Settings meanwhile.' }
    ] },
    { name: 'When it can’t be deleted', frames: [
      { scene: 'demo', step: 'demoHot', t: 'On the shared demo account, click Delete account.' },
      { scene: 'demo', step: 'demoNo', t: 'The row says it can’t be deleted, and offers only Close.' },
      { step: 'delOther', t: 'Another tab changed who’s signed in: deleting asks first, so nothing goes, and the row says to reload.' }
    ] },
    { name: 'Get around', frames: [
      { step: 'jumpHot', t: 'The index marks the part in view. Click Calendar.' },
      { step: 'jumped', t: 'The page moves there, and the small sun goes with it.' },
      { step: 'tourHot', t: 'Take the tour, at the top.' },
      { home: true, t: 'Home opens and the tour plays again, one slide at a time.' }
    ] },
    { name: 'Appearance', frames: [
      { step: 'lookHot', t: 'Each choice is a small evening in its own colours. Click Light.' },
      { step: 'lookLight', t: 'The whole page changes at once, and it’s kept in this browser.' }
    ] },
    { name: 'The time of notes left', frames: [
      { scene: 'first', step: 'planFirst', t: 'A new account: the sun is at the end of the line, with all of it behind it.' },
      { step: 'plan', t: 'It moves back along the line as notes are written.' },
      { step: 'planLow', t: 'Nearly out, it’s at the start.' },
      { step: 'planOut', t: 'Run out, it has set. Calls without notes are still free.' }
    ] },
    { name: 'How you signed in', frames: [
      { step: 'rest', t: 'With Google: your name, address and photo come from there, and the link changes them.' },
      { scene: 'demo', step: 'rest', t: 'With Microsoft, the same.' },
      { scene: 'sso', step: 'rest', t: 'With single sign-on there’s nowhere to link to.' },
      { scene: 'personal', step: 'rest', t: 'At a personal address there’s no company, and no Team.' }
    ] },
    { name: 'When a part doesn’t load', frames: [
      { step: 'noPrefs', t: 'Your preferences didn’t load. The rest of the page, and Sign out, still work.' },
      { step: 'noPlan', t: 'Your minutes didn’t load. The part stays, and says so.' },
      { step: 'calFailed', t: 'The calendar didn’t answer. Try again, in the row.' },
      { step: 'notChecked', t: 'With no hardware answer to show, the row just says what it is.' },
      { step: 'notVerified', t: 'The answer wasn’t bound to this browser’s request, so it doesn’t count as verified.' }
    ] },
    { name: 'First day', frames: [
      { scene: 'first', step: 'rest', t: 'The same page. Nothing’s waiting and nothing’s used.' },
      { scene: 'first', step: 'calendarFirst', t: 'Connect is there when you want it.' },
      { scene: 'first', step: 'devicesFirst', t: 'The browser doesn’t name your devices until they’re allowed, so there’s no list yet.' },
      { scene: 'first', step: 'alertsFirst', t: 'Nothing asks the browser for anything until you press.' },
      { scene: 'first', step: 'planFirst', t: 'All of your minutes, with the sun at the end of the line.' }
    ] }
  ];
  AH.ST2.STEPS.calendarFirst = { scene: 'first', to: 'calendar' };
  AH.ST2.STEPS.alertsFirst = { scene: 'first', to: 'alerts' };
  AH.ST2.STEPS.devicesFirst = { scene: 'first', to: 'devices' };
  AH.ST2.STEPS.planFirst = { scene: 'first', to: 'plan' };

  AH.ST2.LIGHT = [
    { mode: 'light', step: 'rest', t: 'At rest.' },
    { mode: 'light', step: 'langOpen', t: 'A list, open.' },
    { mode: 'light', step: 'outOpen', t: 'Sign out with recordings waiting.' },
    { mode: 'light', step: 'checking', t: 'Check the level.' },
    { mode: 'light', step: 'delOpen', t: 'Delete account.' }
  ];

  AH.ST2.PHONE = [
    { step: 'rest', t: 'Settings.' },
    { step: 'phoneCal', t: 'One part at a time, picked from the strip.' },
    { step: 'phoneSaved', t: 'Saved, in the row.' },
    { step: 'outOpen', t: 'Sign out with recordings waiting.' },
    { step: 'phoneDevices', t: 'Check the level.' },
    { step: 'phoneDel', t: 'Delete account.' },
    { scene: 'first', step: 'rest', t: 'First day.' }
  ];
  AH.ST2.STEPS.phoneCal = { to: 'calendar' };
  AH.ST2.STEPS.phoneSaved = { to: 'notes', p: p({ summary: 'detailed' }), saved: 'summary' };
  AH.ST2.STEPS.phoneDevices = { to: 'devices', checking: true, lvl: 0.62, left: 5 };
  AH.ST2.STEPS.phoneDel = { to: 'del', del: 'open' };
})();
