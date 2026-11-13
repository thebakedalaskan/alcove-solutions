/*
 * After the call: a page of its own. Whenever a call is over for you (you ended it, someone else did, or you left it),
 * the call's night stays and says what happened, then offers the next step: Rejoin while it's still going, the notes
 * once it has ended, or Home. Every board here draws from this model: the over screen's states (OVER), the moments of
 * each journey (STEPS) and the journeys.
 */
(function () {
  var AH = window.AH, I = window.NCI, assign = AH.assign;

  var W = { w: 1440, h: 900, tiles: [[16, 64], [726, 64], [16, 452], [726, 452]], tw: 698, th: 376 };
  var PH = { w: 390, h: 844, tiles: [[12, 64], [201, 64], [12, 372], [201, 372]], tw: 177, th: 296 };
  var ORDER = ['art', 'priya', 'kofi', 'maya'];

  /* ------------------------------------------------------------------ the over screen, by state */
  /*
   * people: who stands on the horizon (who was in the call, or who's still in it). talking: whoever is speaking, so a
   * call that goes on looks alive. notes: writing, ready, slow, none, or on (still going: they come when it ends).
   * acts: the buttons, the first one filled. guest: someone with no account, so no Home and no notes.
   */
  var EVERYONE = ['art', 'priya', 'kofi', 'maya'];
  var STILL = ['priya', 'kofi', 'maya'];
  var OVER = {
    endWriting: { people: EVERYONE, title: 'Team standup has ended', meta: '20 min with Priya, Kofi and Maya', notes: 'writing', who: 'Priya, Kofi, Maya and you get them.', acts: ['notes', 'home'] },
    endReady: { people: EVERYONE, title: 'Team standup has ended', meta: '20 min with Priya, Kofi and Maya', notes: 'ready', acts: ['read', 'home'] },
    endSlow: { people: EVERYONE, title: 'Team standup has ended', meta: '20 min with Priya, Kofi and Maya', notes: 'slow', acts: ['notes', 'home'] },
    endedBy: { people: EVERYONE, title: 'Team standup has ended', meta: 'Priya ended it for everyone · 20 min', notes: 'writing', who: 'Everyone invited gets them, you included.', acts: ['notes', 'home'] },
    left: { people: STILL, talking: 'priya', title: 'You left Team standup', meta: 'Priya, Kofi and Maya are still in it', clock: '19:42', notes: 'on', acts: ['rejoin', 'home'] },
    leftHost: { people: STILL, talking: 'kofi', title: 'You left Team standup', meta: 'Kofi is hosting until you’re back', clock: '19:42', notes: 'on', acts: ['rejoin', 'home'] },
    leftEnded: { people: EVERYONE, title: 'Team standup has ended', meta: 'Priya ended it after you left · 34 min', notes: 'writing', who: 'Everyone invited gets them, you included.', acts: ['notes', 'home'] },
    noNotes: { people: EVERYONE, title: 'Team standup has ended', meta: '20 min with Priya, Kofi and Maya', notes: 'none', acts: ['home'] },
    guestLeft: { guest: true, people: STILL, talking: 'priya', title: 'You left Team standup', meta: 'Priya, Kofi and Maya are still in it', clock: '19:42', acts: ['rejoin'] },
    guestEnded: { guest: true, people: STILL, title: 'Team standup has ended', meta: 'Priya can share the notes with you.', acts: [] }
  };
  var ACTS = {
    notes: { t: 'Open the notes', icon: 'notebook' },
    read: { t: 'Read the notes', icon: 'notebook' },
    rejoin: { t: 'Rejoin', icon: 'video', key: 'J' },
    home: { t: 'Go to Home', icon: 'home' }
  };
  var READY = {
    summary: 'The new onboarding ships behind a flag on 12 November, and support gets the help article first. Kofi flagged two items still open on the launch checklist.',
    decided: '2 decided', follow: '3 follow-ups'
  };

  /* ------------------------------------------------------------------ the moments of each journey */
  /*
   * on: what's in front of you. call (the call, maybe with Leave's question), over (the over screen, in state),
   * note (the note, being written or written), home (Home).
   */
  var BASE = { on: 'call', you: 'host', ask: '', hot: '', toast: '', phone: false, notes: true };
  var STEPS = {
    hLeave: { hot: 'leave' },
    hAsk: { ask: 'host', hot: 'end' },
    hOver: { on: 'over', over: 'endWriting', hot: 'notes' },
    hReady: { on: 'over', over: 'endReady', hot: 'read' },
    hNote: { on: 'note', note: 'ce-fresh' },
    hHome: { on: 'home', home: 'after' },

    mCall: { you: 'member' },
    mOver: { you: 'member', on: 'over', over: 'endedBy', hot: 'notes' },
    mNote: { you: 'member', on: 'note', note: 'ce-them' },

    lLeave: { you: 'member', hot: 'leave' },
    lOver: { you: 'member', on: 'over', over: 'left' },
    lEnded: { you: 'member', on: 'over', over: 'leftEnded', hot: 'home' },
    lHome: { you: 'member', on: 'home', home: 'after' },

    kAsk: { ask: 'host', hot: 'keep' },
    kOver: { on: 'over', over: 'leftHost', hot: 'rejoin' },
    kBack: { toast: 'You’re back, and hosting again.' },

    zAsk: { ask: 'host', notes: false, hot: 'end' },
    zOver: { on: 'over', over: 'noNotes', notes: false, hot: 'home' },
    zHome: { on: 'home', home: 'after', notes: false },

    gLeave: { you: 'guest', hot: 'leave' },
    gOver: { you: 'guest', on: 'over', over: 'guestLeft', hot: 'rejoin' },
    gEnded: { you: 'guest', on: 'over', over: 'guestEnded' },

    pLeave: { phone: true, hot: 'leave' },
    pAsk: { phone: true, ask: 'host', hot: 'end' },
    pOver: { phone: true, on: 'over', over: 'endWriting', hot: 'notes' },
    pNote: { phone: true, on: 'note', note: 'ce-w1' }
  };

  /* ------------------------------------------------------------------ the journeys, one row each */
  var JOURNEYS = [
    { n: 1, id: 'end', title: 'You end it for everyone', blurb: 'You host, and notes were on. The call is over, and its page says so.', frames: [
      { step: 'hLeave', did: 'Press Leave.', see: 'You host, so Leave asks first. Nobody else is asked anything.', hold: 1400 },
      { step: 'hAsk', did: 'A question opens over Leave.', see: 'End for everyone, or Leave, Kofi hosts. The call carries on behind it.', hold: 1800 },
      { step: 'hOver', did: 'Press End for everyone.', see: 'The call’s page: it has ended, who was in it, and the notes being written. Open the notes is the one filled button.', hold: 3200 },
      { step: 'hReady', did: 'Stay a moment, and they’re written.', see: 'The panel turns into the first lines of the summary, with what was decided and the follow-ups. Read the notes.', hold: 3200 },
      { step: 'hNote', did: 'Press Read the notes.', see: 'The note. Go to Home would have gone home instead.', hold: 3000 }
    ] },
    { n: 2, id: 'ended', title: 'Whoever hosts ends it', blurb: 'You’re in the call, and you get the notes. Your call ends with theirs.', frames: [
      { step: 'mCall', did: 'Priya presses End for everyone.', see: 'Nothing to press on your side.', hold: 1400 },
      { step: 'mOver', did: 'The call’s page.', see: 'It says Priya ended it for everyone, and that everyone invited gets the notes, you included.', hold: 3200 },
      { step: 'mNote', did: 'Press Open the notes.', see: 'Yours too, being written.', hold: 3000 }
    ] },
    { n: 3, id: 'leave', title: 'You leave, and it goes on', blurb: 'Someone else hosts. You step out; the call carries on without you.', frames: [
      { step: 'lLeave', did: 'Press Leave.', see: 'You don’t host, so nothing is asked. You’re out at once.', hold: 1400 },
      { step: 'lOver', did: 'The call’s page.', see: 'You left, who’s still in it (whoever’s talking has the ring), and how long it’s been going. Rejoin (J) goes straight back in. No camera: this isn’t the join screen.', hold: 3200 },
      { step: 'lEnded', did: 'Stay, and it ends while you’re here.', see: 'The page turns: it has ended, Priya ended it after you left, and the notes are being written.', hold: 3000 },
      { step: 'lHome', did: 'Press Go to Home.', see: 'Home. The notes come to Notes when they’re written. Had the call still been going, Home’s line at the top would offer Rejoin too.', hold: 3000 }
    ] },
    { n: 4, id: 'keep', title: 'You host, and leave it with someone', blurb: 'The call goes on with someone else hosting, until you’re back.', frames: [
      { step: 'kAsk', did: 'Press Leave, then Leave, Kofi hosts.', see: 'Kofi is the best person to host. Change picks someone else, in the same question.', hold: 2000 },
      { step: 'kOver', did: 'The call’s page.', see: 'Kofi is hosting until you’re back. Rejoin takes it back.', hold: 3000 },
      { step: 'kBack', did: 'Press Rejoin.', see: 'You’re back in, and hosting again.', hold: 2400 }
    ] },
    { n: 5, id: 'none', title: 'A call without notes', blurb: 'Notes were never on, so there’s nothing to open.', frames: [
      { step: 'zAsk', did: 'Press Leave, then End for everyone.', see: 'The question doesn’t mention notes.', hold: 2000 },
      { step: 'zOver', did: 'The call’s page.', see: 'It has ended, and no notes were taken. Go to Home is the filled button.', hold: 3000 },
      { step: 'zHome', did: 'Press Go to Home.', see: 'Home.', hold: 2400 }
    ] },
    { n: 6, id: 'guest', title: 'A guest', blurb: 'Someone who came in from the link with only a name: no Home and no notes to go to.', frames: [
      { step: 'gLeave', did: 'Press Leave.', see: 'A guest is never asked. They’re out at once.', hold: 1400 },
      { step: 'gOver', did: 'The call’s page.', see: 'You left, who’s still in it, and Rejoin.', hold: 3000 },
      { step: 'gEnded', did: 'If it ends.', see: 'It says so, and that Priya can share the notes. Nothing else to press.', hold: 3000 }
    ] },
    { n: 7, id: 'phone', title: 'On a phone', blurb: 'The same page, in one column, its buttons across the foot.', phone: true, frames: [
      { step: 'pLeave', did: 'Press Leave.', see: 'The last button in the dock.', hold: 1400 },
      { step: 'pAsk', did: 'The question is a sheet.', see: 'End for everyone, or Leave, Kofi hosts.', hold: 2000 },
      { step: 'pOver', did: 'Press End for everyone.', see: 'The call’s page, its buttons in reach of a thumb.', hold: 3000 },
      { step: 'pNote', did: 'Press Open the notes.', see: 'The note, being written.', hold: 3000 }
    ] }
  ];

  /* ------------------------------------------------------------------ what the note and Home show, added to their boards */
  Object.assign(AH.NOTE_STEPS || (AH.NOTE_STEPS = {}), {
    'ce-w1': { view: 'writing', prog: 2 },
    'ce-fresh': { view: 'ready', fresh: true },
    'ce-them': { view: 'writing', prog: 2, role: 'invited' }
  });
  var H = AH.HOME;
  if (H && H.soon) {
    H.soon.imminent = Object.assign({}, H.soon.imminent, { join: 'Join', icon: I.video });
    /* 09:14 on the demo Wednesday: Team standup is still going, so its note isn't anywhere yet. */
    var during = Object.assign({}, H.soon, {
      clock: '09:14', hour: 9.23,
      items: H.soon.items.filter(function (it) { return it.note !== 'n2'; }),
      mine: H.soon.mine.filter(function (m) { return m.note !== 'n2'; }),
      notes: H.soon.notes.filter(function (n) { return n.id !== 'n2'; }),
      people: [{ id: 'priya', name: 'Priya Raman' }, { id: 'kofi', name: 'Kofi Asante' }, { id: 'aiko', name: 'Aiko Tanaka' }, { id: 'maya', name: 'Maya Chen' }]
    });
    H.left = Object.assign({}, during, { imminent: { id: 'standup', title: 'Team standup', when: 'Happening now', faces: 'priya,kofi,maya', join: 'Rejoin', icon: I.video } });
    H.after = Object.assign({}, during, { clock: '09:21', hour: 9.35, imminent: null });
  }

  function step(id) { return assign({}, BASE, STEPS[id] || {}, { id: id }); }
  function journey(id) { return JOURNEYS.filter(function (j) { return j.id === id || String(j.n) === String(id); })[0] || JOURNEYS[0]; }

  window.CE = { I: I, W: W, PH: PH, ORDER: ORDER, OVER: OVER, ACTS: ACTS, READY: READY, STEPS: STEPS, JOURNEYS: JOURNEYS, step: step, journey: journey };
})();
