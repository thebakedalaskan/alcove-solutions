/* 04 Flows / Notes from a shared screen (stretch goal). */
(function () {
  var AL = window.AL, I = AL.icon, U = AL.ui;
  AL.flowPage({
    id: 'flow-share', order: 5, title: 'Notes from a shared screen', nav: 'Notes from a shared screen', file: 'share', icon: 'screen', kicker: 'Stretch goal', time: 'About 30 seconds',
    keywords: 'screen share slides notes ocr stretch',
    lede: 'Stretch goal. When someone shares their screen, the notes service reads slides and text every few seconds inside the same verified private server, and adds them to the notes with the moment they appeared.',
    headline: 'Slides become notes, privately',
    summary: 'Four steps, from sharing to a slide in the notes.',
    steps: [
      { title: 'Share a screen', line: 'The share takes the stage', dur: 5000, truth: ['Shared frames are encrypted like video'],
        body: 'When Maya shares, the share takes the stage and people move to a strip beside it.',
        screen: function () { return U.callWin({ sharing: true }); } },
      { title: 'Read, privately', line: 'Every few seconds', dur: 6000, truth: ['Read inside the TEE'],
        body: 'Every few seconds the notes service reads the shared screen. A soft lamp outline shows which part is being read.',
        screen: function () { return U.callWin({ sharing: true, reading: true }); } },
      { title: 'Into the notes', line: 'With the time', dur: 5600, truth: ['Marked as read from the screen'],
        body: 'New slides appear in the notes with the time they were shown, marked as read from the screen so they’re never mistaken for something said.',
        screen: function () { return U.callWin({ sharing: true, slides: true }); } },
      { title: 'In the finished notes', line: 'Next to what was said', dur: 5600, truth: ['Slides and speech, together'],
        body: 'The finished notes keep the slides beside the decision they supported.',
        screen: function () { return U.win({ main: U.notesPage({}), path: 'notes/launch-planning', title: 'Launch planning', sideOpts: { active: 'notes', open: 'n1' } }); } }
    ],
    notes: [['How it reads', ['Frames are sampled every few seconds, not recorded as video.', 'Text and slide changes are read inside the verified private server.']],
      ['Who controls it', ['The person sharing can turn screen notes off for their share.', 'Preferences has its own switch for screen notes.']],
      ['To confirm in the build', ['Whether the private inference provider offers a vision model, or reading runs on a model inside our TEE.', 'How often to sample without missing quick slides.']]]
  });
})();
