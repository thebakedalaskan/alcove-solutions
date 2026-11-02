/* 04 Flows / Ask about a call: a private chat over calls and recordings, with quotes that open the moment. */
(function () {
  var AL = window.AL, I = AL.icon, U = AL.ui;
  function w(main, extra) { return U.win({ main: main, path: 'ask/launch-date', title: 'Ask', sideOpts: { active: 'chat' }, toasts: extra && extra.toasts }); }
  AL.flowPage({
    id: 'flow-ask', order: 6, title: 'Ask about a call', nav: 'Ask about a call', file: 'ask', icon: 'ask', kicker: 'Ask', time: 'About 35 seconds',
    keywords: 'ask chat question answer bookmark transcript',
    lede: 'A private chat over everything you’ve said in calls and rooms. Answers quote the exact moment, with who said it and when, and only you can read the conversation.',
    headline: 'Remember exactly what was said',
    summary: 'Five steps, from a question to the moment in the transcript.',
    steps: [
      { title: 'Ask anything', line: 'About any call', dur: 4800, truth: ['Private chat'],
        body: 'Ask opens with suggestions about real calls: decisions, action items, what someone said, what was on a slide.',
        screen: function () { return w(U.askCall({ stage: 'empty' })); } },
      { title: 'Type the question', line: 'Plain words', dur: 5600, truth: ['Encrypted in the browser'],
        body: 'The question is encrypted in the browser before it leaves.',
        screen: function () { return w(U.askCall({ stage: 'empty', draft: ' ' })); },
        enter: function (el) { var s = AL.seq(el); s.type('.js-draft', U.CALL_Q, { delay: 300, ms: 60 }); return s.stop; } },
      { title: 'Reading the call', line: 'Privately', dur: 4600, truth: ['Up to 132 credits held'],
        body: 'Alcove reads the transcript inside a verified private server.',
        screen: function () { return w(U.askCall({ stage: 'thinking' })); } },
      { title: 'The answer, with quotes', line: 'Who said it, and when', dur: 7600, truth: ['Quotes match the transcript exactly'],
        body: 'The answer streams in, then bookmarks drop in once each quote is found word for word in the transcript.',
        screen: function () { return w(U.askCall({ stage: 'answer', typing: true })); },
        enter: function (el) { var s = AL.seq(el); s.type('.js-answer', U.CALL_A_TEXT, { delay: 300, ms: 55, html: U.CALL_A_HTML, done: function () { s.show('.js-after'); } }); return s.stop; } },
      { title: 'Open the moment', line: 'The line glows once', dur: 5400, truth: ['Opens at 12:40'],
        body: 'Opening S1 jumps to the transcript line at 12:40 and lets it glow once.',
        screen: function () { return U.win({ main: U.notesPage({ hl: true }), path: 'notes/launch-planning#12:40', title: 'Launch planning', sideOpts: { active: 'notes', open: 'n1' } }); } }
    ],
    notes: [['Only your calls', ['Ask reads only calls and recordings you were part of.', 'Pick a call to narrow it; with none chosen it is a general private chat and says so.']],
      ['Quotes you can check', ['Every quote appears word for word in the transcript, with speaker and time.', 'An answer without matching quotes is shown as not found.']],
      ['Private', ['Encrypted in the browser, answered in a verified private server, never kept by the model.']]]
  });
})();
