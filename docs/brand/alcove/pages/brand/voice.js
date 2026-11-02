/* 01 Brand / Voice and words. */
(function () {
  var AL = window.AL, I = AL.icon, U = AL.ui, esc = AL.esc;

  var STATES = [
    ['Opening the app', 'Locked', 'closed', 'Closed', 'Alcove is closed. Unlock with your passkey to pick up where you left off.'],
    ['Checking the server', 'Runtime evidence being verified', 'working', 'Checking', 'Checking the private server before your key goes anywhere.'],
    ['Server didn’t check out', 'RUNTIME_NOT_ACCEPTED', 'problem', 'Not verified', 'We couldn’t verify the private server, so nothing was sent. Try again in a moment.'],
    ['Before joining', 'Lobby terms', 'lit', 'Notes on', 'This call is encrypted end to end. Notes are on, for the people in the call.'],
    ['Joining', 'Connecting media', 'working', 'Joining', 'Joining Launch planning…'],
    ['In a call', 'E2EE established', 'done', 'Encrypted', 'End-to-end encrypted. Nobody else can hear this call.'],
    ['Notes verified', 'Notes service attested, key released', 'lit', 'Notes on', 'Notes on. The notes service passed its check.'],
    ['Notes service failed', 'Attestation failed, key withheld', 'problem', 'Notes off', 'Notes are off for this call. The notes service didn’t pass its check, so it never got the key.'],
    ['Notes paused', 'Host paused notes', 'unknown', 'Notes paused', 'Notes are paused for everyone. Nothing is being written down.'],
    ['Reconnecting', 'Media interrupted', 'waiting', 'Reconnecting', 'Reconnecting… The notes mark the gap so nothing is made up.'],
    ['Link without a key', 'Fragment missing', 'problem', 'Can’t open', 'This link is missing its key. Ask whoever invited you for the full link.'],
    ['Recording in the room', 'Solo capture running', 'rec', 'Recording', 'Recording in the room. Only you can read these notes.'],
    ['Microphone blocked', 'Permission denied', 'waiting', 'Can’t hear', 'Alcove can’t hear yet. Allow the microphone from the lock in the address bar.'],
    ['Writing notes', 'Transcription finishing', 'working', 'Writing notes', 'Writing your notes. You can close the tab.'],
    ['Notes ready', 'Notes revision published', 'done', 'Notes ready', 'Launch planning notes are ready.'],
    ['Read from a screen', 'Screen text captured', 'lit', 'From the screen', 'Read from the shared screen at 14:02.'],
    ['Out of credits', 'Credits exhausted mid-call', 'waiting', 'Notes paused', 'Notes paused: out of credits. The call carries on.'],
    ['Unclear charge', 'outcome_unknown', 'unknown', 'Not sure yet', 'We’re not sure this answer went through. We won’t send it again, so you can’t be charged twice.'],
    ['Payment on its way', 'Purchase pending', 'waiting', 'On its way', 'Your payment is on its way. Credits arrive once it settles.'],
    ['Payment didn’t go', 'Failed or refunded outcome', 'problem', 'Didn’t go through', 'The payment didn’t go through, so nothing was added.']
  ];

  AL.page({
    id: 'voice', group: 'brand', order: 3, title: 'Voice and words', nav: 'Voice and words', icon: 'quote', file: 'voice',
    keywords: 'tone writing copy microcopy states errors vocabulary',
    lede: 'Alcove speaks like a trusted colleague: calm, plain and specific. It says what is safe first, then what happens next, and it never claims more than the product observed.',
    render: function () {
      var pr = [['Say what’s safe first.', 'Lead with what is protected, then what happens next.', 'We couldn’t verify the private server, so nothing was sent.'],
        ['Talk like a trusted colleague.', 'Plain words and short sentences. The assistant uses “I”; the product uses “we”.', 'I couldn’t find that in the calls you chose.'],
        ['No alarms.', 'Problems are calm and specific, and always come with a way forward.', 'This page changed after you opened it. We kept your edits as a draft.']];
      var principles = '<section class="al-sec" id="principles"><div class="al-sec-h"><p class="al-eyebrow">Principles</p><h2>Three rules for every sentence</h2></div><div class="al-grid al-g3 al-stagger">' +
        pr.map(function (p) {
          return '<div class="al-panel al-pad" style="display:flex;flex-direction:column;gap:10px"><h3 class="al-h3">' + esc(p[0]) + '</h3><p class="al-p" style="margin:0;color:var(--al-ink-2)">' + esc(p[1]) +
            '</p><p style="margin:auto 0 0;padding:12px 14px;border-radius:12px;background:var(--al-bg);font:italic 400 16px/1.45 var(--al-font-read)">“' + esc(p[2]) + '”</p></div>';
        }).join('') + '</div></section>';

      var vocab = [['Lamp on', 'Unlocked. Closes after 15 idle minutes or 60 minutes in total.', 'Lamp on · closes in 14 min'],
        ['Closed', 'Locked. The key is sealed on this device; the server has forgotten it.', 'Alcove is closed'],
        ['Notes on', 'A verified notes service is listening for the people in the call.', 'Notes on'],
        ['Bookmark', 'A citation (S1 to S8) that opens the exact place it came from.', 'Open bookmark S2'],
        ['Private server', 'The verified confidential server that writes notes and answers questions.', 'Checking the private server'],
        ['Guest', 'Someone who joined from a link, with no account.', 'Priya (guest)'],
        ['Set aside', 'Credits held before work starts, released if unused.', 'Up to 750 credits set aside'],
        ['On its way', 'A payment or charge waiting to settle.', 'Your payment is on its way'],
        ['Not sure yet', 'An outcome we couldn’t observe. Never shown as done or free.', 'Not sure yet · we won’t resend it']];
      var vocabHtml = '<section class="al-sec" id="vocabulary"><div class="al-sec-h"><p class="al-eyebrow">Vocabulary</p><h2>Brand words and what they mean in the system</h2>' +
        '<p>Use these words everywhere: in the app, on the site and in support. Each one maps to something the product can actually observe.</p></div><div class="vocab-grid al-stagger">' +
        vocab.map(function (v) { return '<div class="al-panel"><b>' + esc(v[0]) + '</b><span>' + esc(v[1]) + '</span><em>In the app: “' + esc(v[2]) + '”</em></div>'; }).join('') + '</div></section>';

      var rows = STATES.map(function (s) {
        var code = /^[A-Z_]+$|^[a-z_]+$/.test(s[1]) ? '<code>' + esc(s[1]) + '</code>' : esc(s[1]);
        return '<tr><td style="font-weight:600;white-space:nowrap">' + esc(s[0]) + '</td><td class="al-small" style="color:var(--al-ink-3)">' + code + '</td><td>' + U.state(s[2], s[3], 'al-state--sm') +
          '</td><td style="font-size:15px">' + esc(s[4]) + '</td></tr>';
      }).join('');
      var table = '<section class="al-sec" id="states"><div class="al-sec-h"><p class="al-eyebrow">Every state, in words</p><h2>What Alcove says when it matters</h2>' +
        '<p>The docs define what each state is. This table defines how it reads: the chip, then the sentence. Never show a state the product didn’t observe.</p></div>' +
        '<div class="al-table-wrap"><table class="al-table" style="min-width:880px"><thead><tr><th>Moment</th><th>What the docs define</th><th>Chip</th><th>What Alcove says</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>';

      var rules = [['Buttons say what happens', 'Unlock with your passkey, Add a file, Stop and leave. Never OK, Submit or Continue.'],
        ['Sentence case, no exclamation marks', 'Calm is the point. “Saved just now.” never “Saved!”'],
        ['Numbers with their unit', '14 minutes, 750 credits, 4 seconds missing, 10.00 USDC. Round only where the receipt keeps every digit.'],
        ['Time as people feel it', '“Closes in 14 minutes”, “Saved just now”. Exact times appear in the ledger and on receipts.'],
        ['No security theatre', 'Never “military-grade”, “unbreakable” or “100% private”. Say what is readable where, and let Details explain the cryptography.'],
        ['Name people’s things', 'Your calls, your key, your notes. The service’s things are ours: our private server, our receipt.']];
      var rulesHtml = '<section class="al-sec" id="rules"><div class="al-sec-h"><p class="al-eyebrow">Writing rules</p><h2>Small habits that keep it calm</h2></div><div class="al-grid al-g3 al-stagger">' +
        rules.map(function (r) { return '<div class="al-panel al-pad"><h3 class="al-h3">' + esc(r[0]) + '</h3><p class="al-p" style="margin:0;color:var(--al-ink-2)">' + esc(r[1]) + '</p></div>'; }).join('') + '</div></section>';

      var rw = [['Error 4012: attestation quote verification failed (TCB status OutOfDate).', 'We couldn’t verify the private server, so nothing was sent. Your files are untouched. Try again in a moment.'],
        ['AI bot joined the meeting.', 'Notes on. The notes service passed its check.'],
        ['Transaction failed. Please retry.', 'We’re not sure this answer went through. We won’t send it again, so you can’t be charged twice.'],
        ['Your calls are 100% secure with military-grade encryption.', 'End-to-end encrypted. Nobody else can hear this call.'],
        ['Recording started.', 'Recording in the room. Only you can read these notes.']];
      var rewrites = '<section class="al-sec" id="rewrites"><div class="al-sec-h"><p class="al-eyebrow">Rewrites</p><h2>Before and after</h2></div><div class="al-stagger" style="display:flex;flex-direction:column;gap:12px">' +
        rw.map(function (r) { return '<div class="rewrite"><div class="before"><small>Before</small>' + esc(r[0]) + '</div><div class="after"><small>Alcove</small>' + esc(r[1]) + '</div></div>'; }).join('') + '</div></section>';
      return principles + vocabHtml + table + rulesHtml + rewrites;
    }
  });
})();
