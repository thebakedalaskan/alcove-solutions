/* 03 Screens: every part of the web app, annotated, with its states. One file registers all ten pages. */
(function () {
  var AL = window.AL, I = AL.icon, U = AL.ui, esc = AL.esc;

  function pins(list) {
    return list.map(function (p, k) { return '<div class="sc-pin" style="left:' + p[0] + 'px;top:' + p[1] + 'px;--b:' + k + '">' + (k + 1) + '</div>'; }).join('');
  }
  function screen(def) {
    AL.page({
      id: def.id, group: 'screens', order: def.order, title: def.title, icon: def.icon, file: 'screens', keywords: def.keywords || '', lede: def.lede,
      meta: [['screen', 'Web app · 1100 × 690']],
      render: function () {
        var main = def.main();
        var stage = '<section class="al-sec" id="screen"><div class="sc-tools"><span class="al-seg" role="group" aria-label="Mockup theme">' +
          '<button type="button" id="' + def.id + '-th-page" data-th="" aria-pressed="true">Like this page</button><button type="button" id="' + def.id + '-th-light" data-th="t-light" aria-pressed="false">Mist</button>' +
          '<button type="button" id="' + def.id + '-th-dark" data-th="t-dark" aria-pressed="false">After hours</button></span><span class="al-small">Sample data. Numbered notes are below.</span></div>' +
          '<div class="sc-stage js-th">' + AL.frame(main.replace(/<\/div>$/, '') + pins(def.pins.map(function (p) { return p[0]; })) + '</div>') + '</div></section>';
        var notes = '<section class="al-sec" id="notes"><div class="al-sec-h"><p class="al-eyebrow">What’s on it</p><h2>Annotated</h2></div><div class="sc-notes al-stagger">' +
          def.pins.map(function (p, k) { return '<div class="sc-note"><i>' + (k + 1) + '</i><b>' + esc(p[1]) + '</b><span>' + esc(p[2]) + '</span></div>'; }).join('') + '</div></section>';
        var variants = def.variants ? '<section class="al-sec" id="states"><div class="al-sec-h"><p class="al-eyebrow">States</p><h2>The same screen, other moments</h2></div><div class="sc-variants">' +
          def.variants.map(function (v) {
            return '<figure><div class="sc-mini">' + AL.frame(v[2]()) + '</div><figcaption><b>' + esc(v[0]) + '</b>' + esc(v[1]) + '</figcaption></figure>';
          }).join('') + '</div></section>' : '';
        var rules = def.rules ? '<section class="al-sec" id="rules"><div class="al-sec-h"><p class="al-eyebrow">Rules</p><h2>What this screen must always do</h2></div><ul class="spec-list">' +
          def.rules.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul></section>' : '';
        return stage + notes + variants + rules;
      },
      mount: function (view) {
        var box = view.querySelector('.js-th');
        AL.each(view, '[data-th]', function (b) {
          b.addEventListener('click', function () {
            box.classList.remove('t-light', 't-dark');
            if (b.getAttribute('data-th')) box.classList.add(b.getAttribute('data-th'));
            AL.each(view, '[data-th]', function (x) { x.setAttribute('aria-pressed', String(x === b)); });
          });
        });
      }
    });
  }

  screen({
    id: 'screen-unlock', order: 1, title: 'Unlock', icon: 'lock', keywords: 'lock screen closed passkey',
    lede: 'The first thing anyone sees: a closed room at dusk and one warm button. It never shows a lit lamp until the vault is actually open.',
    main: function () { return U.win({ raw: U.lock({ state: 'closed' }), lamp: 'off', path: '', label: 'Lock screen' }); },
    pins: [[[640, 160], 'The closed door', 'The lamp is out because the vault is.'],
      [[700, 330], 'Safe first, then next', 'The title says what is true; the line says what to do.'],
      [[700, 420], 'The lamp button', 'Lamp is reserved for the two actions that change what is lit: unlock and buy.']],
    variants: [['Checking the private server', 'Attestation runs before the key is released.', function () { return U.win({ raw: U.lock({ state: 'checking' }), lamp: 'off' }); }],
      ['Server didn’t check out', 'Nothing is sent.', function () { return U.win({ raw: U.lock({ state: 'failed' }), lamp: 'off' }); }],
      ['Lamp on', 'Open for the next 15 idle minutes.', function () { return U.win({ raw: U.lock({ state: 'open' }), lamp: 'warming' }); }]],
    rules: ['Never draw the lamp lit before the session is open and verified.', 'Unlock always uses your passkey; there is no Alcove password.']
  });

  screen({
    id: 'screen-home', order: 2, title: 'Home', icon: 'arch', keywords: 'home dashboard start call record',
    lede: 'Home answers one question: what do you want to do now? Start a private call, record what’s said in the room, or ask about a call you already had.',
    main: function () { return U.win({ main: U.home(), path: 'home', title: 'Home', sideOpts: { active: 'home' }, label: 'Home' }); },
    pins: [[[150, 96], 'Two ways in', 'New call and Record sit at the top of every screen.'],
      [[460, 150], 'New private call', 'The dusk card: encrypted video with notes built in.'],
      [[930, 70], 'Encrypted, said once', 'One green chip, not a wall of badges.'],
      [[1010, 420], 'Notes ready', 'Every call and recording says whether its notes are ready.']],
    rules: ['Never show an upcoming call’s title to anyone outside it.', 'Calls and recordings live together; notes are the thing people come back for.']
  });

  screen({
    id: 'screen-lobby', order: 3, title: 'Joining a call', nav: 'Joining a call', icon: 'users', keywords: 'lobby join guest preview consent',
    lede: 'Before anyone joins, they see their camera, their devices and the terms of the room: encrypted end to end, notes on, nobody else listening. Guests need only a name.',
    main: function () { return U.win({ main: U.lobby({ guest: true }), side: false, barRight: '', path: 'c/launch-planning#k=…', title: 'Launch planning', label: 'Joining as a guest' }); },
    pins: [[[300, 420], 'Your preview', 'Camera and microphone are checked before joining.'],
      [[560, 18], 'The key is in the link', 'The part after # never reaches our servers.'],
      [[780, 330], 'Terms before joining', 'Encrypted, notes on, nobody else. Three lines, every time.'],
      [[780, 500], 'Join as a guest', 'No account. Joining means agreeing to notes; leave at any time.']],
    variants: [['Host, ready to join', 'Three people are already here.', function () { return U.win({ main: U.lobby({}), sideOpts: { active: 'calls' }, path: 'c/launch-planning' }); }],
      ['Inviting people', 'The link carries the key.', function () { return U.win({ main: U.home(), sideOpts: { active: 'calls' }, overlay: U.inviteSheet() }); }]],
    rules: ['Everyone sees that notes are on before they join, never after.', 'The call key stays in the link fragment and in browsers; it is never sent to our servers.']
  });

  screen({
    id: 'screen-call', order: 4, title: 'In a call', nav: 'In a call', icon: 'meeting', keywords: 'call video grid notes live e2ee',
    lede: 'A call that feels like any good video call, with two differences: it is encrypted end to end, and notes write themselves beside it, for the people in the call only.',
    main: function () { return U.callWin({}); },
    pins: [[[330, 58], 'Encrypted and noted', 'Two chips, always visible: end-to-end encrypted, and whether notes are on.'],
      [[262, 100], 'Who’s speaking', 'A lamp ring around the speaker. Bars show voice, never volume.'],
      [[562, 630], 'Notes in the controls', 'Anyone in the call can see notes are on; the host can pause them.'],
      [[694, 638], 'Leave', 'The only red in the app: leaving a call.'],
      [[760, 140], 'Live notes', 'Decisions and action items, written as the call happens.'],
      [[760, 650], 'Who gets them', 'Notes are written in a verified private server and shared only with the people in the call.']],
    variants: [['Transcript tab', 'Speaker and time on every line.', function () { return U.callWin({ tab: 'transcript' }); }],
      ['Notes paused', 'Paused for everyone; the chip says so.', function () { return U.callWin({ notes: 'paused' }); }],
      ['Notes off', 'A call can be just a call.', function () { return U.callWin({ notes: 'off', panel: false }); }]],
    rules: ['Notes never start without every participant having seen that they are on.', 'The relay forwards encrypted media only; it never holds a call key.', 'If the notes service fails its check, notes stay off and the call carries on.']
  });

  screen({
    id: 'screen-share', order: 5, title: 'Sharing a screen', nav: 'Sharing a screen', icon: 'screen', keywords: 'screen share slides ocr notes stretch',
    lede: 'Stretch goal. When someone shares their screen, the notes service reads slides and text every few seconds and adds what matters to the notes, with the moment it appeared.',
    main: function () { return U.callWin({ sharing: true, reading: true }); },
    pins: [[[300, 100], 'Shared by Maya', 'The share takes the stage; people move to a strip.'],
      [[460, 520], 'Being read', 'A soft lamp outline shows which part of the screen the notes are reading.'],
      [[660, 140], 'The strip', 'Speakers stay visible beside the share.'],
      [[760, 430], 'From the shared screen', 'Each slide becomes a note with its time and what was read.']],
    rules: ['Shared screens are read inside the same verified private server as the audio, never by a third party.', 'Anyone sharing can turn screen notes off for their share.', 'Notes say “read from the screen” so text is never mistaken for something said.']
  });

  screen({
    id: 'screen-record', order: 6, title: 'Notes in the room', nav: 'Notes in the room', icon: 'mic', keywords: 'solo record room transcribe background',
    lede: 'Not a call: a conversation around you. Press record and Alcove takes notes in the background from your device’s microphone. Only you can read them.',
    main: function () { return U.win({ main: U.solo({ state: 'recording' }), path: 'record', title: 'Recording', lamp: 'rec', sideOpts: { active: 'record', rec: true }, label: 'Recording in the room' }); },
    pins: [[[700, 200], 'The record button', 'Shaped like the arch; the red dot breathes while recording.'],
      [[470, 300], 'Time, honestly', 'Counts what was actually captured.'],
      [[680, 470], 'Pause and stop', 'Stop is gentle; the notes still finish.'],
      [[470, 520], 'Where the audio goes', 'Encrypted on this device in 5-second pieces, transcribed in a verified private server.'],
      [[900, 150], 'Live transcript', 'Appears as people talk, with times.']],
    variants: [['Before recording', 'One button, one sentence.', function () { return U.win({ main: U.solo({ state: 'idle' }), sideOpts: { active: 'record' } }); }],
      ['Paused', 'Nothing is captured while paused.', function () { return U.win({ main: U.solo({ state: 'paused' }), sideOpts: { active: 'record' } }); }],
      ['Writing it up', 'Notes finish even if you close the tab.', function () { return U.win({ main: U.solo({ state: 'processing' }), sideOpts: { active: 'record' } }); }]],
    rules: ['Recording only starts when you press it, and the tab says Recording the whole time.', 'Remind people in the room: Alcove shows a gentle “Let people know you’re recording” the first time.']
  });

  screen({
    id: 'screen-notes', order: 7, title: 'Call notes', nav: 'Call notes', icon: 'page', keywords: 'notes summary action items transcript editor',
    lede: 'Every call and recording becomes a page you can edit like any good doc: the decision in a callout, action items as to-dos, slides from the shared screen, and the full transcript below.',
    main: function () { return U.win({ main: U.notesPage({}), path: 'notes/launch-planning', title: 'Launch planning', sideOpts: { active: 'notes', open: 'n1' }, label: 'Call notes' }); },
    pins: [[[760, 44], 'Who can read it', 'Only the people who were in the call.'],
      [[392, 160], 'A page like any other', 'Cover, icon, title, editable blocks.'],
      [[330, 330], 'The decision', 'One callout at the top: what was decided.'],
      [[330, 400], 'Action items', 'To-dos with owners, taken from what people said.'],
      [[330, 520], 'From the screen', 'Slides with their time and what was read.']],
    rules: ['Summaries only state what was said or shown; nothing is invented.', 'Editing notes creates a new revision; the original transcript is kept.']
  });

  screen({
    id: 'screen-ask', order: 8, title: 'Ask about a call', nav: 'Ask about a call', icon: 'ask', keywords: 'chat ask question answer bookmarks transcript',
    lede: 'A private chat over your calls and recordings. Answers quote the exact moment, with who said it and when, and only you can read the conversation.',
    main: function () { return U.win({ main: U.askCall({}), path: 'ask/launch-date', title: 'Ask', sideOpts: { active: 'chat' }, label: 'Ask about a call' }); },
    pins: [[[760, 62], 'Which call', 'Answers come from the calls you choose.'],
      [[460, 100], 'Private chat', 'Encrypted in the browser, answered in a verified private server.'],
      [[540, 290], 'Bookmarks', 'Each quote opens the exact moment in the transcript.'],
      [[262, 520], 'Answered privately', 'And what it cost.']],
    variants: [['Before asking', 'Suggestions about real calls.', function () { return U.win({ main: U.askCall({ stage: 'empty' }), sideOpts: { active: 'chat' } }); }],
      ['Opening a bookmark', 'The transcript line glows once.', function () { return U.win({ main: U.notesPage({ hl: true }), sideOpts: { active: 'notes', open: 'n1' } }); }]],
    rules: ['A quote must appear word for word in the transcript.', 'Without a call chosen, it is a general private chat and says so.']
  });

  screen({
    id: 'screen-credits', order: 9, title: 'Credits', icon: 'credits', keywords: 'balance ledger payment receipt pack free',
    lede: 'Calls are free. Notes and questions use credits, and everyone starts with 10,000 free. After that, one pack, paid privately.',
    main: function () { return U.win({ main: U.credits({ state: 'normal' }), path: 'credits', title: 'Credits', sideOpts: { active: 'credits' }, label: 'Credits' }); },
    pins: [[[330, 168], 'Credits left', 'Never mixed with money or the wallet balance.'],
      [[880, 168], 'The pack', 'Only needed once the free credits run out.'],
      [[1040, 418], 'Ledger', 'Welcome credits are the first row: free, added once.']],
    variants: [['Welcome', '10,000 free credits, no wallet needed.', function () { return U.win({ main: U.credits({ state: 'welcome' }), sideOpts: { active: 'credits', credits: '10,000' } }); }],
      ['Running low', 'The pack is offered, never pushed.', function () { return U.win({ main: U.credits({ state: 'low' }), sideOpts: { active: 'credits', credits: '412' } }); }],
      ['Credits added', 'Once, even if the confirmation arrives twice.', function () { return U.win({ main: U.credits({ state: 'added' }), sideOpts: { active: 'credits', credits: '10,412' } }); }]],
    rules: ['A call never stops because credits ran out; notes pause and say why.', 'A pending purchase never funds work.']
  });

  screen({
    id: 'screen-preferences', order: 10, title: 'Preferences', icon: 'sliders', keywords: 'settings preferences options',
    lede: 'Few choices, and honest ones: whether your calls take notes, whether shared screens are read, and your devices.',
    main: function () { return U.win({ main: U.prefs(), path: 'preferences', title: 'Preferences', sideOpts: { active: 'none' }, label: 'Preferences' }); },
    pins: [[[620, 150], 'Notes by default', 'On, and everyone sees it before joining.'],
      [[620, 210], 'Screen notes', 'The stretch goal has its own switch.'],
      [[1010, 160], 'Verified', 'The notes service’s last check.']]
  });
})();
