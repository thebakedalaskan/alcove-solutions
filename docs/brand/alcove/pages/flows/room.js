/* 04 Flows / Notes in the room: a solo recording of a conversation around you. */
(function () {
  var AL = window.AL, I = AL.icon, U = AL.ui;
  function w(o, extra) { return U.win({ main: U.solo(o), path: 'record', title: o.state === 'idle' ? 'Record' : 'Recording', lamp: o.state === 'recording' ? 'rec' : 'on', sideOpts: { active: 'record', rec: o.state === 'recording' }, overlay: extra && extra.overlay, toasts: extra && extra.toasts }); }
  AL.flowPage({
    id: 'flow-room', order: 4, title: 'Notes in the room', nav: 'Notes in the room', file: 'room', icon: 'mic', kicker: 'Notes in the room', time: 'About 40 seconds',
    keywords: 'solo record room transcribe background',
    lede: 'Not every conversation is a call. In a room with people, press record and Alcove takes private notes in the background from your device’s microphone.',
    headline: 'Private notes from a conversation around you',
    summary: 'Six steps, from one button to finished notes.',
    steps: [
      { title: 'One button', line: 'Record in the room', dur: 4600, truth: ['Nothing captured until pressed'],
        body: 'Record opens a calm screen with one button shaped like the arch.',
        screen: function () { return w({ state: 'idle' }); } },
      { title: 'Let people know', line: 'The first time', dur: 5400, truth: ['Consent is the owner’s responsibility'],
        body: 'The first time, Alcove asks you to let people know you’re taking notes. It’s their conversation too.',
        screen: function () { return w({ state: 'idle' }, { overlay: U.sheet({ title: 'Let people know you’re recording', text: 'Alcove will transcribe what’s said around you. Only you can read the notes, but the people in the room should know.', actions: '<span class="al-btn al-btn--primary al-btn--block">' + I('record') + 'Start recording</span><span class="al-btn al-btn--quiet al-btn--block">Not now</span>' }) }); } },
      { title: 'Recording', line: 'Notes as people talk', dur: 7000, truth: ['5-second encrypted pieces', 'Transcribed in the TEE'],
        body: 'Audio is encrypted on the device in 5-second pieces and transcribed in a verified private server. Lines appear as people talk.',
        screen: function () { return w({ state: 'recording', lines: 4 }); },
        enter: function (el) { var s = AL.seq(el); s.count('.js-time', 84, 91, 6000, function (v) { return Math.floor(v / 60) + ':' + ('0' + (v % 60)).slice(-2); }); return s.stop; } },
      { title: 'Pause', line: 'Nothing captured', dur: 4600, truth: ['Paused means not recording'],
        body: 'Pause stops capture completely. The wave goes flat and the tab says Paused.',
        screen: function () { return w({ state: 'paused' }); } },
      { title: 'Stop', line: 'Writing it up', dur: 4600, truth: ['Finishes even if the tab closes'],
        body: 'Stopping hands the last pieces to the private server. The notes finish even if you close the tab.',
        screen: function () { return w({ state: 'processing' }); } },
      { title: 'Your notes', line: 'Only yours', dur: 5600, truth: ['Readable only by you'],
        body: 'The notes arrive as a page: what was decided, what to do, and the transcript with times.',
        screen: function () { return U.win({ main: U.notesPage({}).replace('Only the 4 people in the call', 'Only you').replace('Launch planning</b>', 'Offsite planning</b>'), path: 'notes/offsite-planning', title: 'Offsite planning', sideOpts: { active: 'notes', open: 'n3' }, toasts: U.toast('mic', 'Offsite planning notes are ready', 'In the room · 18 min', 'Open', 1) }); } }
    ],
    notes: [['Only you', ['Room notes are encrypted to you alone.', 'Nobody in the room gets a copy unless you share the page.']],
      ['What is captured', ['Only while recording; paused means nothing is captured.', 'The tab shows Recording the whole time.']],
      ['Costs', ['Room notes use credits while recording.', 'The first 10,000 credits are free.']]]
  });
})();
