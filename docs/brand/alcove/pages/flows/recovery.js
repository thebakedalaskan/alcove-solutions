/* 04 Flows / When things go wrong: honest failures in calls, recordings, notes and payments. */
(function () {
  var AL = window.AL, I = AL.icon, U = AL.ui, M = AL.marks;
  function banner(kind, icon, title, text, action) { return '<div class="al-banner al-banner--' + kind + '" style="position:absolute;left:250px;right:390px;top:52px;z-index:6">' + I(icon) + '<div><b>' + title + '</b>' + text + '</div>' + (action ? U.btn('secondary', action, '', 'al-btn--sm') : '<span></span>') + '</div>'; }
  AL.flowPage({
    id: 'flow-recovery', order: 8, title: 'When things go wrong', file: 'recovery', icon: 'help', kicker: 'When things go wrong', time: 'About 45 seconds',
    keywords: 'errors failure notes off reconnect mic blocked key missing payment',
    lede: 'Failures are where a privacy product earns trust. Each one says what was protected first, then what happened and what to do.',
    headline: 'Seven honest failures',
    summary: 'Each step is a different failure, worded and drawn the Alcove way.',
    steps: [
      { title: 'Notes service didn’t check out', line: 'The call carries on', dur: 5600, truth: ['Attestation failed, key not released'],
        body: 'If the notes service fails its check, it never gets the call key. Notes stay off for everyone, and the call carries on, still encrypted.',
        screen: function () { return U.callWin({ notes: 'off', panel: false, extra: banner('problem', 'shield', 'Notes are off for this call.', 'The notes service didn’t pass its check, so it never got the key. Your call is still encrypted.', 'Try again') }); } },
      { title: 'The link has no key', line: 'Nothing to decrypt', dur: 5400, truth: ['Key missing from the link'],
        body: 'If an invite link was cut short, the key is missing and the call can’t be opened. Alcove says to ask for the full link.',
        screen: function () { return U.win({ side: false, path: 'c/launch-planning', title: 'Launch planning', main: '<div class="al-empty" style="margin:auto">' + '<div style="width:190px">' + AL.art.spot('closed') + '</div><h4>This link is missing its key</h4><p>The part after # opens the call, and it isn’t here. Ask whoever invited you for the full link.</p>' + U.btn('secondary', 'Copy what I have', 'copy') + '</div>' }); } },
      { title: 'Microphone blocked', line: 'How to allow it', dur: 5000, truth: ['Browser permission denied'],
        body: 'If the browser blocks the microphone, Alcove shows exactly where to allow it and doesn’t start until it can actually hear.',
        screen: function () { return U.win({ main: U.solo({ state: 'idle' }), sideOpts: { active: 'record' }, extra: banner('waiting', 'micoff', 'Alcove can’t hear yet.', 'Your browser blocked the microphone. Allow it from the lock icon in the address bar, then press record.', '') }); } },
      { title: 'Connection dropped', line: 'Reconnecting, honestly', dur: 5400, truth: ['Gap marked in the notes'],
        body: 'If your connection drops, the call says Reconnecting and the notes mark the gap with its time instead of guessing what was said.',
        screen: function () { return U.callWin({ extra: banner('waiting', 'refresh', 'Reconnecting…', 'You’ll be back in a moment. The notes mark the gap so nothing is made up.', '') }); } },
      { title: 'Out of credits mid-call', line: 'Notes pause, the call doesn’t', dur: 5400, truth: ['Calls never stop for credits'],
        body: 'If credits run out, notes pause and say why. The call itself never stops.',
        screen: function () { return U.callWin({ notes: 'paused', extra: banner('waiting', 'credits', 'Notes paused: out of credits.', 'The call carries on. Add credits to resume notes.', 'Buy credits') }); } },
      { title: 'Not sure it went through', line: 'Never charged twice', dur: 5600, truth: ['outcome_unknown, never resent'],
        body: 'If a question was sent but the answer never arrived, Alcove says so, never resends, and checks the cost quietly.',
        screen: function () { return U.win({ main: U.askCall({ stage: 'thinking' }), sideOpts: { active: 'chat' }, extra: banner('unknown', 'help', 'We’re not sure this answer went through.', 'We won’t send it again, so you can’t be charged twice.', '') }); } },
      { title: 'The payment didn’t go through', line: 'Nothing added', dur: 5600, truth: ['Failed or refunded outcome'],
        body: 'A failed payment adds nothing and says where any money went.',
        screen: function () { return U.win({ main: U.credits({ state: 'failed' }), sideOpts: { active: 'credits', credits: '412' } }); } }
    ],
    notes: [['How a failure reads', ['First, what was protected.', 'Then what happened, in one sentence, without codes.', 'Then one way forward.']],
      ['What Alcove never does', ['Hand a call key to a service that failed its check.', 'Fill a gap in the notes with a guess.', 'Retry a paid request on its own.']],
      ['Calls come first', ['Nothing about notes, credits or payments ever ends a call.']]]
  });
})();
