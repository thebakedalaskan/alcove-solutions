/* 04 Flows / A private call: invite, join, notes written live, and notes ready when it ends. */
(function () {
  var AL = window.AL, I = AL.icon, U = AL.ui;

  AL.flowPage({
    id: 'flow-call', order: 2, title: 'A private call', file: 'call', icon: 'meeting', kicker: 'Private call', time: 'About 50 seconds',
    keywords: 'call video encrypted notes live invite',
    lede: 'Start a call, share a link, talk. Video and audio are encrypted in every browser, and notes write themselves beside the call for the people in it. When it ends, the notes are already there.',
    headline: 'A call where only the people in it can listen',
    summary: 'Eight steps, from a new call to finished notes.',
    steps: [
      { title: 'New call', line: 'From anywhere', dur: 4800, truth: ['Call key made in the browser'],
        body: 'New call sits at the top of every screen. Starting one makes a fresh key for this call, in the browser.',
        screen: function () { return U.win({ main: U.home(), path: 'home', title: 'Home', sideOpts: { active: 'home' } }); } },
      { title: 'Invite people', line: 'The key is in the link', dur: 6000, truth: ['Key after # never reaches our servers'],
        body: 'The invite link carries the call’s key after the #, which browsers never send to a server. Guests need no account.',
        screen: function () { return U.win({ main: U.home(), sideOpts: { active: 'calls' }, overlay: U.inviteSheet() }); } },
      { title: 'Check before joining', line: 'Camera, mic, terms', dur: 5400, truth: ['Notes on, said before joining'],
        body: 'The lobby checks camera and microphone, then states the terms of the room: encrypted, notes on, nobody else listening.',
        screen: function () { return U.win({ main: U.lobby({}), sideOpts: { active: 'calls' }, path: 'c/launch-planning' }); } },
      { title: 'Everyone arrives', line: 'Encrypted from the first frame', dur: 5200, truth: ['Relay forwards encrypted media only'],
        body: 'People appear as they join. The relay in the middle forwards encrypted media it can’t decode.',
        screen: function () { return U.callWin({ joined: true, lines: 1 }); } },
      { title: 'Notes join, verified', line: 'Before getting the key', dur: 5600, truth: ['Attestation before key release', 'Shown to everyone'],
        body: 'The notes service runs in a verified private server. It is checked before it receives the call key, and the call shows Notes on to everyone.',
        screen: function () { return U.callWin({ toasts: U.toast('shield', 'Notes service verified', 'Approved build, key bound, fresh proof', '', 0.5) }); } },
      { title: 'Notes, live', line: 'Decisions as they happen', dur: 7000, truth: ['Speech transcribed inside the TEE'],
        body: 'Decisions and action items appear as they are said. The transcript tab has every line with its speaker and time.',
        screen: function () { return U.callWin({}); },
        enter: function (el) { var s = AL.seq(el); s.count('.js-time', 861, 872, 6000, function (v) { return Math.floor(v / 60) + ':' + ('0' + (v % 60)).slice(-2); }); return s.stop; } },
      { title: 'Every word, every speaker', line: 'The transcript', dur: 5400, truth: ['Speaker and time on each line'],
        body: 'Switching to Transcript shows each line as it was said, with who said it and when.',
        screen: function () { return U.callWin({ tab: 'transcript' }); } },
      { title: 'Notes ready', line: 'Before you’ve closed the tab', dur: 6000, truth: ['Shared only with participants'],
        body: 'When the call ends, the notes are a page: the decision, the action items, the slides and the transcript. Only the people in the call can open it.',
        screen: function () { return U.win({ main: U.notesPage({}), path: 'notes/launch-planning', title: 'Launch planning', sideOpts: { active: 'notes', open: 'n1' }, toasts: U.toast('page', 'Launch planning notes are ready', '32 minutes · 4 people', 'Open', 1) }); } }
    ],
    notes: [['Encrypted end to end', ['Media is encrypted in each browser before it leaves.', 'The relay that routes the call never holds a key.', 'The call key lives in the invite link after the #, never on our servers.']],
      ['Notes, honestly', ['Everyone sees Notes on before joining, and in the call the whole time.', 'The notes service is checked by attestation before it gets the key; if it fails, notes stay off.', 'Notes go only to the people who were in the call.']],
      ['Costs', ['Calls are free.', 'Notes use credits while they run, and pause rather than stop the call if credits run out.', 'Everyone starts with 10,000 free credits.']]]
  });
})();
