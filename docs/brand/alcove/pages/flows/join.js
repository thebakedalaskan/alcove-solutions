/* 04 Flows / Joining from a link: a guest with no account. */
(function () {
  var AL = window.AL, I = AL.icon, U = AL.ui;
  AL.flowPage({
    id: 'flow-join', order: 3, title: 'Joining from a link', nav: 'Joining from a link', file: 'join', icon: 'users', kicker: 'Guest', time: 'About 30 seconds',
    keywords: 'guest join link invite no account',
    lede: 'Guests open a link, type a name and join. No account, no download. The key travels in the link, the terms are clear before joining, and the guest gets the notes too.',
    headline: 'A guest, from link to notes',
    summary: 'Five steps, seen from the guest’s side.',
    steps: [
      { title: 'Open the link', line: 'No account', dur: 5000, truth: ['Key read from the # in the browser'],
        body: 'The link opens Alcove in the browser. The key after the # is read locally and never sent anywhere.',
        screen: function () { return U.win({ main: U.lobby({ guest: true }), side: false, barRight: '', path: 'c/launch-planning#k=…', title: 'Launch planning' }); } },
      { title: 'Say who you are', line: 'Just a name', dur: 5200, truth: ['Name shared only with the call'],
        body: 'A guest types the name others will see. That is the only thing asked.',
        screen: function () { return U.win({ main: U.lobby({ guest: true }), side: false, barRight: '', path: 'c/launch-planning#k=…', title: 'Launch planning' }); },
        enter: function (el) { var s = AL.seq(el); s.type('.js-name', 'Priya Nair', { delay: 300, ms: 120 }); return s.stop; } },
      { title: 'Read the terms', line: 'Before joining', dur: 5600, truth: ['Joining means agreeing to notes'],
        body: 'Three lines say what the room is: encrypted end to end, notes on, nobody else listening. Joining means agreeing to notes.',
        screen: function () { return U.win({ main: U.lobby({ guest: true }), side: false, barRight: '', path: 'c/launch-planning#k=…', title: 'Launch planning', extra: '<div class="ap-spot" style="left:620px;top:262px;width:440px;height:170px"></div>' }); } },
      { title: 'In the call', line: 'Marked as a guest', dur: 5200, truth: ['Same encryption as everyone'],
        body: 'Guests appear with a small guest label, with the same encryption as everyone else.',
        screen: function () { return U.callWin({ guest: true, speaker: 2 }); } },
      { title: 'Notes in the inbox', line: 'For everyone who was there', dur: 5400, truth: ['Shared only with participants'],
        body: 'After the call the guest gets a private link to the notes, opened with a key only they hold.',
        screen: function () { return U.win({ main: U.notesPage({}), side: false, path: 'notes/launch-planning#k=…', title: 'Launch planning' }); } }
    ],
    notes: [['No account', ['A name is all a guest needs.', 'The call key comes in the link and stays in the browser.']],
      ['Same privacy', ['Guests are encrypted end to end like everyone else.', 'Guests see Notes on before they join.']],
      ['Their copy of the notes', ['Every participant gets the notes, encrypted to them.', 'A guest can save them by creating an account later, or let the link expire.']]]
  });
})();
