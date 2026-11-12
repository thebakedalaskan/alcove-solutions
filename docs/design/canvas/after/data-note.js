/*
 * A single note, written out in full: Team standup (`n2` in AH.D.notes) and the example a first day opens. Everything on
 * the page comes from here: what was decided and said, the waveform drawn from what was said, and the journeys.
 */
(function () {
  var AH = window.AH;

  /* Lucide, as the app's Icon uses it. */
  Object.assign(AH.I, {
    play: 'M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z',
    pause: 'M15 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-16a1 1 0 0 1 1 -1zM6 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-16a1 1 0 0 1 1 -1z',
    pin: 'M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z',
    more: 'M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M18 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M4 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0',
    trash: 'M10 11v6M14 11v6M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
    pen: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497zM15 5l4 4',
    bookmark: 'M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z',
    door: 'M10 21H2M10 3H7a2 2 0 00-2 2v16M14 12h.01M19 21V5a2 2 0 00-1.675-1.974l-6.163-1.013A1 1 0 0010 3v18a1 1 0 001.124.992zM22 21h-3',
    history: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2',
    monitor: 'M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2zM8 21L16 21M12 17L12 21',
    repeat: 'M17 2l4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3',
    send: 'M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11zM21.854 2.147l-10.94 10.939',
    clock: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0M12 6v6l4 2',
    external: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
    undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11',
    question: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01',
    up: 'M5 12l7-7 7 7M12 19V5',
    alert: 'M21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01',
    plus: 'M5 12h14M12 5v14'
  });

  var s = function (m) { var p = m.split(':'); return Number(p[0]) * 60 + Number(p[1]); };
  /* A moment, as the app writes it: 8:40. */
  AH.mmss = function (n) { n = Math.max(0, Math.round(n)); var m = Math.floor(n / 60), x = n % 60; return m + ':' + (x < 10 ? '0' : '') + x; };

  /*
   * The light under the horizon is what was said, as in the app (features/notes/wave.ts): the page never decodes a call's
   * audio, so it's drawn from the transcript. Each row of glints is one level of how much was said, so the row nearest the
   * line is almost unbroken, the deepest rows catch only the busiest moments, and where nobody spoke the water is still.
   */
  function seeded(n) { return function () { n = (n * 16807) % 2147483647; return (n - 1) / 2147483646; }; }
  var ROWS = 6, HOLD = 40, BUSY = 3;
  AH.noteWave = function (note) {
    if (note.__wave) return note.__wave;
    var N = 300, len = note.seconds, r = seeded(note.seed || 19), amp = [];
    for (var z = 0; z < N; z++) amp.push(0);
    var a = r() * 6, b = r() * 6, c = r() * 6;
    note.lines.forEach(function (l, i) {
      var next = note.lines[i + 1] ? note.lines[i + 1].at : len, words = l.text.trim().split(/\s+/).length, length = Math.max(1, Math.min(HOLD, next - l.at));
      var busy = Math.min(1, words / length / BUSY), from = Math.floor(l.at / len * N), to = Math.min(N - 1, Math.ceil((l.at + length) / len * N));
      for (var k = from; k <= to; k++) {
        var swell = 0.5 + 0.5 * Math.sin(k / 21 + a), phrase = 0.5 + 0.5 * Math.sin(k / 7 + b), word = 0.5 + 0.5 * Math.sin(k / 2.6 + c);
        amp[k] = Math.max(amp[k], Math.max(0, Math.min(1, 0.14 + 0.3 * busy + 0.34 * swell * swell + 0.2 * phrase * phrase + 0.1 * word + (r() - 0.5) * 0.14)));
      }
    });
    /* A glint is a short stroke. The nearer the line, the longer it runs; the deeper rows only catch the loud moments. */
    var out = [], g = seeded(31), e = seeded(53);
    for (var row = 0; row < ROWS; row++) {
      var far = row / (ROWS - 1), thr = 0.1 + row * 0.135, x = g() * 3;
      while (x < N) {
        var w = (3 + g() * 8) * (1 - far * 0.55), gap = 1 + g() * (3 + far * 7), mid = Math.min(N - 1, Math.round(x + w / 2));
        if (amp[mid] > thr + (g() - 0.5) * 0.06) {
          var left = x / N * 100, wd = Math.min(w, N - x) / N * 100;
          out.push({
            x: left, w: wd, far: far, row: row,
            style: 'left: ' + left.toFixed(2) + '%; top: ' + (7 + row * 8) + 'px; width: ' + wd.toFixed(2) + '%; --o: ' + (0.95 - far * 0.55).toFixed(2) + '; --far: ' + far.toFixed(2) + '; --every: ' + (34 + e() * 22).toFixed(1) + 's; --after: ' + (-e() * 56).toFixed(1) + 's'
          });
        }
        x += w + gap;
      }
    }
    note.__wave = out;
    return out;
  };

  /* Team standup. Art organized it, so this is the organizer's page unless a step says otherwise. */
  var n2 = {
    id: 'n2', title: 'Team standup', when: 'Today at 09:00', seconds: 1200, minutes: 20, checked: '09:24', organizer: 'art', seed: 19, still: [[s('12:10'), s('16:20')]],
    summary: 'The new onboarding ships behind a flag on 12 November, and support gets the help article first. Kofi flagged two items still open on the launch checklist, to look at before the design review.',
    chapters: [
      { at: 0, t: 'Onboarding', gist: 'Ready, and it goes out behind a flag.' },
      { at: s('05:12'), t: 'Support', gist: 'The help article comes before the flag.' },
      { at: s('08:40'), t: 'Launch checklist', gist: 'Two items are still open.' },
      { at: s('12:02'), t: '3 breakout rooms', gist: 'Support handover: Priya and Maya. Flag rollout: you and Kofi. Room 3: Kofi. 4 min.', rooms: true },
      { at: s('16:24'), t: 'Back together', gist: 'Support is happy if the article comes first.' }
    ],
    decisions: [
      { id: 'd1', at: s('03:15'), line: 'l7', text: 'The new onboarding ships behind a flag on 12 November.', state: 'proposed' },
      { id: 'd2', at: s('06:02'), line: 'l11', text: 'Support gets the help article before the flag goes on.', state: 'confirmed', by: 'Priya', log: [['Priya confirmed it', 'Today, 09:31']] }
    ],
    questions: [
      { id: 'q1', at: s('07:05'), line: 'l13', text: 'Who tells existing customers about the new onboarding?', state: 'open' }
    ],
    actions: [
      { id: 'a1', at: s('08:40'), line: 'l15', text: 'Review the launch checklist', owner: 'art', taken: false, due: 'Today', soon: true, log: [] },
      { id: 'a2', at: s('06:20'), line: 'l12', text: 'Write the help article for support', owner: 'priya', taken: true, due: 'Friday', log: [['Priya took it on', 'Today, 09:33'], ['Priya set it due Friday', 'Today, 09:33']] },
      { id: 'a3', at: s('10:05'), line: 'l18', text: 'Add the flag to the rollout plan', owner: 'kofi', taken: true, due: '', done: true, log: [['Kofi took it on', 'Today, 09:40'], ['Kofi ticked it', 'Today, 10:02']] }
    ],
    lines: [
      { id: 'l1', at: s('00:04'), who: 'art', text: 'Morning, everyone. Let’s start with onboarding, since that’s the one with a date on it.' },
      { id: 'l2', at: s('00:21'), who: 'priya', text: 'The new onboarding is done. Design signed off last night and the last coffee changes went in first thing.', unsure: 'coffee changes' },
      { id: 'l3', at: s('01:10'), who: 'priya', text: 'I’d still rather not turn it on for everyone at once. If the first run breaks, it’s the first thing anyone sees.' },
      { id: 'l4', at: s('01:48'), who: 'kofi', text: 'Agreed. Put it behind a flag and we can watch the first few hundred people go through it.' },
      { id: 'l5', at: s('02:36'), who: 'maya', text: 'Does the flag change anything for the trial numbers? I’m closing the month on the twelfth.', fixed: [['Maya corrected it from “closing the mouth on the twelfth”', 'Today, 09:22']] },
      { id: 'l6', at: s('02:55'), who: 'priya', text: 'No. Same plans, same trial. Only the first run changes.' },
      { id: 'l7', at: s('03:15'), who: 'art', text: 'Then let’s say it. The new onboarding ships behind a flag on 12 November.', kind: 'decide' },
      { id: 'l8', at: s('03:31'), who: 'kofi', text: 'Twelfth works for design.' },
      { id: 'l9', at: s('05:12'), who: 'priya', text: 'The other thing is support. They haven’t seen any of this yet.' },
      { id: 'l10', at: s('05:40'), who: 'maya', text: 'They’ll get the questions on day one, whatever we do.' },
      { id: 'l11', at: s('06:02'), who: 'art', text: 'So support gets the help article before the flag goes on. Before, not the same day.', kind: 'decide' },
      { id: 'l12', at: s('06:20'), who: 'priya', text: 'I’ll write it. Friday at the latest.', kind: 'follow' },
      { id: 'l13', at: s('07:05'), who: 'maya', text: 'Who tells existing customers, though? Is that an email, or a note in the app?' },
      { id: 'l14', at: s('07:22'), who: 'kofi', text: 'I don’t think we’ve decided. Can we come back to it?' },
      { id: 'l15', at: s('08:40'), who: 'kofi', text: 'Launch checklist. Two items are still open, and I’d like someone to look before the design review.', kind: 'follow', screen: 's1' },
      { id: 'l16', at: s('08:58'), who: 'art', text: 'I can look after this.' },
      { id: 'l17', at: s('09:20'), who: 'kofi', text: 'Thanks. One is the empty state on the team page, the other is the flag name in the rollout plan.' },
      { id: 'l18', at: s('10:05'), who: 'kofi', text: 'I’ll put the flag in the rollout plan now, that one’s quick.', kind: 'follow' },
      { id: 'l19', at: s('12:02'), who: 'art', text: 'Let’s split up for a few minutes. Priya and Maya on the support handover, Kofi and me on the rollout.' },
      { id: 'l20', at: s('16:24'), who: 'priya', text: 'We’re back. Short version, support is happy as long as the article comes first.' },
      { id: 'l21', at: s('16:58'), who: 'kofi', text: 'Rollout’s fine. We start with one per cent and go from there.', unsureWho: true },
      { id: 'l22', at: s('19:10'), who: 'art', text: 'Good. Thanks, all. Same time next week.' }
    ],
    screens: { s1: { id: 's1', at: s('08:52'), title: 'Launch checklist', by: 'Kofi’s screen' } },
    rooms: [
      {
        id: 'r1', name: 'Support handover', who: 'priya,maya', names: 'Priya and Maya', length: '4 min',
        summary: 'Support will take the first week of questions as long as the help article lands before the flag. Maya wants the refund wording checked.',
        decisions: [{ id: 'rd1', text: 'Support gets a preview workspace on Monday.', state: 'confirmed', by: 'Maya' }],
        questions: [],
        actions: [{ id: 'ra1', text: 'Check the refund wording in the article', owner: 'maya', taken: true, due: 'Monday' }],
        chapters: ['A preview workspace', 'Refund wording'],
        lines: [
          { id: 'r1l1', at: '00:08', who: 'priya', text: 'Would a preview workspace help, so the team can click through it before anyone asks?' },
          { id: 'r1l2', at: '00:41', who: 'maya', text: 'Yes, Monday if we can. And the refund wording needs checking before it goes out.' },
          { id: 'r1l3', at: '01:30', who: 'priya', text: 'I’ll leave a space for it in the article.' }
        ]
      },
      {
        id: 'r2', name: 'Flag rollout', who: 'art,kofi', names: 'You and Kofi', length: '4 min',
        summary: 'The flag starts at one per cent and doubles each day if the first run holds.',
        decisions: [{ id: 'rd2', text: 'The flag starts at one per cent.', state: 'confirmed', by: 'you' }],
        questions: [{ id: 'rq1', text: 'Do trial accounts count towards the percentage?', state: 'open' }],
        actions: [],
        chapters: ['Starting small', 'What counts'],
        lines: [
          { id: 'r2l1', at: '00:12', who: 'kofi', text: 'One per cent first, then double it each day if nothing falls over.' },
          { id: 'r2l2', at: '00:55', who: 'art', text: 'Do trial accounts count towards that? I’d rather not guess.' }
        ]
      },
      { id: 'r3', name: 'Room 3', who: 'kofi', names: 'Kofi', length: '1 min', quiet: true, decisions: [], questions: [], actions: [], chapters: [], lines: [] }
    ],
    additions: [
      { id: 'x1', by: 'priya', name: 'Priya', when: 'Today, 10:12', text: 'The outline is in the shared folder. Comments welcome before Friday.', at: s('06:20'), line: 'l12' }
    ],
    own: [
      { id: 'o1', kind: 'note', text: 'Ask Priya whether the article covers the team plan.', at: s('06:20'), line: 'l12', quoteWho: 'Priya', quote: 'I’ll write it. Friday at the latest.' },
      { id: 'o2', kind: 'bookmark', text: 'Launch checklist. Two items are still open, and I’d like someone to look before the design review.', quoteWho: 'Kofi', at: s('08:40'), line: 'l15' }
    ],
    recipients: [
      { id: 'art', name: 'Art Vandelay', you: true, role: 'Organizer' },
      { id: 'priya', name: 'Priya Raman', role: 'Invited' },
      { id: 'kofi', name: 'Kofi Asante', role: 'Invited' },
      { id: 'maya', name: 'Maya Chen', role: 'Invited' }
    ],
    series: {
      label: 'Every Wednesday',
      calls: [
        { id: 'c1', day: '28 Oct', length: '18 min', gist: 'Sign-ups are back up after the pricing change.', face: 'priya' },
        { id: 'c2', day: '21 Oct', length: '22 min', gist: 'Two first-run screens go back to design.', face: 'kofi' },
        { id: 'c3', day: '14 Oct', length: '19 min', gist: 'Onboarding slips a week for the team plan.', face: 'maya' }
      ],
      open: '1 question and 3 follow-ups are still open across its 9 calls.',
      next: 'Wed 11 Nov, 09:00'
    },
    suggested: ['What did we decide?', 'What do I need to do?', 'Draft a follow-up'],
    answers: {
      'What did we decide?': { text: 'Two things. The new onboarding ships behind a flag on 12 November, and support gets the help article before the flag goes on. The first one is waiting for someone to confirm it.', cites: [s('03:15'), s('06:02')] },
      'What do I need to do?': { text: 'One thing. Kofi asked for someone to look at the launch checklist before the design review, and you said you could.', cites: [s('08:40'), s('08:58')] },
      'Draft a follow-up': { text: 'Thanks, all. Onboarding ships behind a flag on 12 November. Priya writes the help article by Friday, so support has it first. Still open: who tells existing customers.', cites: [s('03:15'), s('06:20'), s('07:05')] }
    },
    fallback: { text: 'From the call: onboarding is done, and it goes out behind a flag on 12 November.', cites: [s('03:15')] },
    gone: { rooms: '3 breakout rooms’ sections', audio: '20 min of audio' }
  };

  /* The call from the welcome screen, written out. Nothing to share or delete. */
  var example = {
    id: 'example', example: true, title: 'Weekly product call', when: '', seconds: 1440, minutes: 24, checked: '', organizer: 'theo', seed: 7, still: [],
    summary: 'Sign-ups are back up since Tuesday’s fix, so the launch moves to the 18th. Kofi sends the new screens by Wednesday.',
    chapters: [{ at: 0, t: 'Sign-ups', gist: 'Back up since the fix.' }, { at: s('08:30'), t: 'The launch date', gist: 'Moves to the 18th.' }, { at: s('16:00'), t: 'New screens', gist: 'Kofi, by Wednesday.' }],
    decisions: [{ id: 'd1', at: s('10:12'), line: 'e4', text: 'The launch moves to the 18th.', state: 'confirmed', by: 'Theo' }],
    questions: [{ id: 'q1', at: s('11:41'), line: 'e5', text: 'Do we tell the press before the 18th?', state: 'open' }],
    actions: [{ id: 'a1', at: s('16:22'), line: 'e6', text: 'Send the new screens', owner: 'kofi', taken: true, due: 'Wednesday', log: [] }],
    lines: [
      { id: 'e1', at: 6, who: 'theo', text: 'Sign-ups first. They’re back up since Tuesday’s fix.' },
      { id: 'e2', at: 74, who: 'priya', text: 'Nice. Back to where they were before the pricing change?' },
      { id: 'e3', at: s('08:30'), who: 'theo', text: 'Close enough that I’d move the launch.' },
      { id: 'e4', at: s('10:12'), who: 'theo', text: 'Let’s move it to the 18th.', kind: 'decide' },
      { id: 'e5', at: s('11:41'), who: 'priya', text: 'Do we tell the press before the 18th?' },
      { id: 'e6', at: s('16:22'), who: 'kofi', text: 'I’ll send the new screens by Wednesday.', kind: 'follow' }
    ],
    screens: {}, rooms: [], additions: [], own: [],
    recipients: [
      { id: 'art', name: 'Art Vandelay', you: true, role: 'Invited' },
      { id: 'theo', name: 'Theo Martin', role: 'Organizer' },
      { id: 'priya', name: 'Priya Raman', role: 'Invited' },
      { id: 'kofi', name: 'Kofi Asante', role: 'Invited' }
    ],
    suggested: ['What did we decide?', 'What do I need to do?', 'Draft a follow-up'],
    answers: {
      'What did we decide?': { text: 'One thing. The launch moves to the 18th.', cites: [s('10:12')] },
      'What do I need to do?': { text: 'Nothing for you from this call. Kofi sends the new screens by Wednesday.', cites: [s('16:22')] },
      'Draft a follow-up': { text: 'Hi all, thanks for today. The launch moves to the 18th. Next up: Kofi sends the new screens by Wednesday.', cites: [s('10:12'), s('16:22')] }
    },
    fallback: { text: 'From the call: sign-ups are back up since Tuesday’s fix.', cites: [6] },
    gone: {}
  };
  AH.NOTE = { n2: n2, example: example };

  /* A series, on the same evening: the calls you have notes from, and what carries over from them. */
  AH.NOTE_SERIES = {
    title: 'Team standup', next: 'Wed 11 Nov, 09:00', nextDay: 'Wednesday 11 November', nextTime: '09:00 to 09:30', count: '9 calls with notes',
    calls: [
      { day: '14 Oct', length: '19 min', gist: 'Onboarding slips a week for the team plan.' },
      { day: '21 Oct', length: '22 min', gist: 'Two first-run screens go back to design.' },
      { day: '28 Oct', length: '18 min', gist: 'Sign-ups are back up after the pricing change.' },
      { day: '4 Nov', length: '20 min', gist: 'The new onboarding ships behind a flag on 12 November.' }
    ],
    parts: [
      { title: 'Decided', kind: 'decide', count: '1 to confirm', rows: [
        { kind: 'decide', set: true, text: 'Support gets the help article before the flag goes on.', from: 'Wed 4 Nov', status: 'Confirmed by Priya', at: '6:02' },
        { kind: 'decide', set: true, text: 'Two first-run screens go back to design.', from: 'Wed 21 Oct', status: 'Confirmed by you', at: '11:40', later: 'Wed 4 Nov may have replaced this: The new onboarding is done.' },
        'Not confirmed yet',
        { kind: 'decide', text: 'The new onboarding ships behind a flag on 12 November.', from: 'Wed 4 Nov', status: 'Proposed by the notes. Nobody has confirmed it yet', at: '3:15', yes: 'Confirm', no: true }
      ] },
      { title: 'Still open', count: '1', rows: [
        { kind: 'ask', text: 'Who tells existing customers about the new onboarding?', from: 'Wed 4 Nov', status: '', at: '7:05', yes: 'It was answered' }
      ] },
      { title: 'Follow-ups', kind: 'follow', count: '2 open', rows: [
        { kind: 'follow', text: 'Write the help article for support', from: 'Wed 4 Nov', status: 'Priya took this on  Due Friday', at: '6:20' },
        'Not taken on yet',
        { kind: 'follow', text: 'Review the launch checklist', from: 'Wed 4 Nov', status: 'Suggested for you  Suggested due Today', at: '8:40', take: true }
      ] }
    ]
  };

  /* What was checked: the seal opens this. */
  AH.NOTE_EVIDENCE = {
    models: [{ what: 'Wrote the notes', model: 'z-ai/glm-5.3-flash', when: 'Today, 09:24' }, { what: 'Transcribed the speech', model: 'openai/whisper-large-v3', when: 'Today, 09:21' }],
    checks: [
      { t: 'Intel TDX confidential VM', d: 'Signed by Intel, firmware up to date' },
      { t: 'Booted the published dstack image', d: 'Measured as it builds' },
      { t: '8 NVIDIA Hopper GPUs in confidential mode', d: 'Confirmed by NVIDIA, for the same challenge' },
      { t: 'Its key', d: 'Bound in the quote to a fresh challenge from Alcove' },
      { t: 'Sealed to that key with Oblivious HTTP', d: 'Its reply came back sealed the same way' }
    ]
  };

  /* A long list, for the note that was shared widely. */
  AH.NOTE_MANY = [['aiko', 'Aiko Tanaka'], ['lena', 'Lena Fischer'], ['sam', 'Sam Ortiz'], ['diego', 'Diego Ruiz'], ['ines', 'Ines'], ['nadia', 'Nadia Haddad'], ['omar', 'Omar Farouk'], ['elena', 'Elena Petrova']].map(function (p) { return { id: p[0], name: p[1], role: 'Shared by Kofi with Leads' }; });

  /* Who the notes can go to in Share: your groups by name first, then people. */
  AH.NOTE_SHARE = [
    { id: 'g1', group: true, name: 'Leads', sub: 'Adds Ines. The others have them already.', adds: ['ines'] },
    { id: 'g2', group: true, name: 'Product', sub: 'Adds Aiko. The others have them already.', adds: ['aiko'] },
    { id: 'lena', name: 'Lena Fischer', sub: 'Research', adds: ['lena'] },
    { id: 'sam', name: 'Sam Ortiz', sub: 'Product design', adds: ['sam'] }
  ];

  /* Where each journey frame starts. `to` scrolls the page there; `hot` rings the thing to click. */
  var CONFIRMED = { d1: { state: 'confirmed', by: 'you', log: [['You confirmed it', 'Today, 16:12']] } };
  var NEW_WORDS = 'The new onboarding ships behind a flag on 12 November, to one per cent first.';
  var REWORDED = { d1: { state: 'confirmed', by: 'you', text: NEW_WORDS, reworded: 'you', log: [['You confirmed it', 'Today, 16:12'], ['You reworded it', 'Today, 16:13']] } };
  var TAKEN = { a1: { taken: true, log: [['You took it on', 'Today, 16:12']] } };
  var GIVEN = { a1: { owner: 'kofi', taken: false, log: [['You took it on', 'Today, 16:12'], ['You gave it to Kofi', 'Today, 16:13']] } };
  var FIXED_WORDS = 'The new onboarding is done. Design signed off last night and the last copy changes went in first thing.';
  var FIX = { l2: { text: FIXED_WORDS, line: 'You corrected it from “…the last coffee changes went in first thing.”' } };
  var Q = 'What did we decide?';
  var KEPT = { id: 'k1', kind: 'answer', text: n2.answers[Q].text, q: Q, at: s('03:15'), line: 'l7' };
  var DRAFT = 'Support should see the refund wording before Friday, or the first week of questions lands on Maya.';
  var CUT = 'Support should see the refund wording before Friday.';
  var WROTE = { id: 'w1', kind: 'note', text: DRAFT };
  var ADDED = { id: 'x-w1', from: 'w1', by: 'art', name: 'You', when: 'Today, 16:14', text: CUT };
  AH.NOTE_STEPS = {
    'n-mark': { tip: 'd1', hot: 'mark-d1' },
    'n-gap': { tip: 'gap', gaps: [{ at: s('11:10'), label: 'Paused 09:11–09:14' }] },
    'n-jumped': { pos: s('03:15'), line: 'l7', full: true, to: 'l7' },
    'n-chip': { hot: 'chip-a1', to: 's-follow' },
    'n-chipped': { pos: s('08:40'), line: 'l15', full: true, to: 'l15' },
    'n-playing': { pos: s('09:24'), line: 'l17', full: true, to: 'l17', playing: true },
    'n-lit': { pos: s('09:24'), line: 'l17', playing: true },

    'n-confirm': { hot: 'yes-d1' },
    'n-confirmed': { dec: CONFIRMED, just: 'd1' },
    'n-dmenu': { dec: CONFIRMED, just: 'd1', menu: 'd1', hot: 'rew-d1' },
    'n-reword': { dec: CONFIRMED, just: 'd1', rew: 'd1', rewText: NEW_WORDS, hot: 'save-d1' },
    'n-reworded': { dec: REWORDED, just: 'd1', hot: 'undo-d1' },
    'n-undone': { dec: { d1: { state: 'proposed', by: '', text: NEW_WORDS, reworded: 'you', log: REWORDED.d1.log.concat([['You undid it', 'Today, 16:14']]) } } },

    'n-rej0': { menu: 'd1' },
    'n-rej1': { dec: { d1: { state: 'rejected', by: 'you', log: [['You said it wasn’t decided', 'Today, 16:12']] } } },
    'n-sup': { dec: { d2: { state: 'superseded', by: 'you', log: [['Priya confirmed it', 'Today, 09:31'], ['You said it no longer holds', 'Today, 16:13']] } } },
    'n-ans': { qs: { q1: { state: 'answered', by: 'you', log: [['You said it was answered', 'Today, 16:13']] } }, to: 's-open' },
    'n-disp': { dec: { d2: { flags: ['Maya says this wasn’t decided'], log: [['Priya confirmed it', 'Today, 09:31'], ['Maya said it wasn’t decided', 'Today, 11:05']] } } },
    'n-disp2': { dec: { d2: { flags: ['Maya says this wasn’t decided', 'A line behind this was corrected'], log: [['Priya confirmed it', 'Today, 09:31'], ['Maya said it wasn’t decided', 'Today, 11:05']] } }, menu: 'd2' },
    'n-prop0': { hot: 'add-decision' },
    'n-prop1': { proposing: 'decision', proposeText: 'Support reviews the article on Thursday.' },
    'n-prop2': { decNew: [{ id: 'd9', at: undefined, text: 'Support reviews the article on Thursday.', state: 'proposed', proposedBy: 'you', log: [['You proposed it', 'Today, 16:12']] }] },
    'n-prop3': { hoverLine: 'l3', hot: 'plus-l3', to: 'l3', linePop: 'l3' },

    'n-take': { hot: 'take-a1', to: 's-follow' },
    'n-taken': { fu: TAKEN, to: 's-follow', toast: 'It’s yours. Everyone with the notes sees that.' },
    'n-fmenu': { fu: TAKEN, menu: 'a1', to: 's-follow' },
    'n-given': { fu: GIVEN, to: 's-follow' },

    'n-fix0': { hoverLine: 'l2', hot: 'fix-l2', to: 'l2' },
    'n-fix1': { edit: 'l2', editText: n2.lines[1].text, editWho: 'priya', to: 'l2' },
    'n-fix2': { edit: 'l2', editText: FIXED_WORDS, editWho: 'priya', whoOpen: true, to: 'l2' },
    'n-fix3': { fix: FIX, hot: 'rewrite', to: 's-said' },
    'n-fix4': { fix: FIX, view: 'again', hold: true },
    'n-fix5': { fix: FIX, rewritten: true, tipFix: 'l2', to: 's-said' },

    'n-ask0': { hot: 'askbar' },
    'n-ask1': { askBar: 'focus', hot: 'q0' },
    'n-ask2': { askBar: 'wait', aq: Q },
    'n-ask3': { askBar: 'answer', aq: Q, hot: 'cite-0' },
    'n-ask4': { askBar: 'answer', aq: Q, pos: s('03:15'), line: 'l7', full: true, to: 'l7', hot: 'keep' },
    'n-ask5': { askBar: 'answer', aq: Q, ownAdd: [KEPT], keptQ: [Q] },

    'n-own0': { draft: DRAFT, hot: 'own-send' },
    'n-own1': { ownAdd: [WROTE], hot: 'share-w1' },
    'n-own2': { ownAdd: [WROTE], adding: 'w1', addText: DRAFT, to: 's-own' },
    'n-own3': { ownAdd: [WROTE], adding: 'w1', addText: CUT, hot: 'add-go', to: 's-own' },
    'n-since': { ownAdd: [WROTE], adding: 'w1', addText: CUT, shared: ['lena'], sinceNote: true, to: 's-own' },
    'n-own4': { ownAdd: [WROTE], addsNew: [ADDED], to: 's-adds', toast: 'It’s in the shared notes. Your own stays yours.' },
    'n-back0': { ownAdd: [WROTE], addsNew: [ADDED], hot: 'back-x-w1', to: 's-adds' },
    'n-back1': { ownAdd: [WROTE], addsNew: [ADDED], sure: 'x-w1', hot: 'yes-x-w1', to: 's-adds' },
    'n-back2': { ownAdd: [WROTE], to: 's-adds', toast: 'It’s out of the shared notes, for everyone.' },
    'n-back3': { sure: 'x1', to: 's-adds' },

    'n-mark0': { hoverLine: 'l3', hot: 'mark-line-l3', to: 'l3' },
    'n-mark1': { marks: { l3: true }, toast: 'Bookmarked. Only you can see it.' },
    'n-scrl': { hot: 'screen-link', to: 's-said' },
    'n-scr0': { full: true, hot: 'screen', to: 'l15' },
    'n-scr1': { full: true, screen: 's1', to: 'l15' },
    'n-scr2': { full: true, shotMark: true, to: 's-own', toast: 'Bookmarked. Only you can see it.' },

    'n-sh0': { hot: 'share' },
    'n-sh1': { menu: 'share' },
    'n-sh2': { menu: 'share', shareTo: ['lena'], hot: 'share-go' },
    'n-sh3': { shared: ['lena'], to: 's-who', toast: 'Shared with Lena.' },
    'n-many': { many: true, to: 's-who' },
    'n-pin0': { hot: 'pin' },
    'n-pin1': { pinned: true },
    'n-pin2': { toast: '8 notes are pinned, the most there can be. Unpin one to pin these.' },
    'n-seal0': { hot: 'seal' },
    'n-seal1': { menu: 'seal' },

    'n-del0': { menu: 'more', hot: 'delete' },
    'n-del1': { menu: 'del', hot: 'delete-go' },
    'n-del2': { gone: 'deleted' },
    'n-them': { role: 'invited' },
    'n-them2': { role: 'shared' },
    'n-rm0': { role: 'invited', menu: 'more', hot: 'delete' },
    'n-rm1': { role: 'invited', menu: 'del', hot: 'delete-go' },
    'n-rm2': { gone: 'removed' },

    'n-w1': { view: 'writing', prog: 2 },
    'n-w2': { view: 'writing', prog: 3 },
    'n-w3': { view: 'writing', prog: 4 },
    'n-rec': { view: 'recording', edge: s('12:24'), pos: s('05:20'), playing: true, line: 'l9' },
    'n-quiet': { view: 'quiet', hot: 'play' },
    'n-quiet2': { view: 'quiet', pos: 96, playing: true },
    'n-notr': { view: 'noTranscript', to: 's-said' },
    'n-norec': { view: 'noRecording' },
    'n-nokeep': { view: 'noKeep' },
    'n-missing': { gone: 'missing' },

    'n-room0': { hot: 'room-r1', to: 's-rooms' },
    'n-room1': { rooms: { r1: true }, to: 's-rooms' },
    'n-room2': { rooms: { r1: true }, said: { r1: true }, to: 's-rooms' },
    'n-room3': { rooms: { r3: true }, to: 's-rooms' },

    'n-ser0': { to: 's-series' },
    'n-ser1': { noSeries: true, hot: 'meet', to: 's-series' },
    'n-ser2': { hot: 'next-change', to: 's-series' },

    'n-chapters': { to: 's-chapters' },
    'n-example': { view: 'example' },
    'n-empty': { ownGone: { o1: true, o2: true }, to: 's-own' }
  };

  /* Every journey on the note, one row each. */
  AH.JOURNEYS_NOTE = [
    { name: 'Jump to a moment from the horizon', frames: [
      { step: 'n-mark', t: 'Point at a mark. It says what happened there.' },
      { step: 'n-jumped', t: 'Click it. The sun moves there and the transcript goes to that line.' },
      { step: 'n-chip', t: 'A moment chip does the same, from anywhere on the page.' },
      { step: 'n-chipped', t: 'The horizon stays at the top, so the next jump is one click.' },
      { step: 'n-lit', t: 'Press play. The sun moves along the line, and the glitter lights up behind it.' },
      { step: 'n-playing', t: 'The line being said is marked in the transcript.' }
    ] },
    { name: 'Confirm, reword and undo a decision', frames: [
      { step: 'n-confirm', t: 'Click Confirm.' },
      { step: 'n-confirmed', t: 'It says who did, with Undo. Its mark on the horizon fills in.' },
      { step: 'n-dmenu', t: 'The menu rewords it, or says it no longer holds.' },
      { step: 'n-reword', t: 'It rewords in place.' },
      { step: 'n-reworded', t: 'Reworded. Click Undo to take the confirmation back.' },
      { step: 'n-undone', t: 'Proposed again, with the new words. The mark is hollow again.' }
    ] },
    { name: 'When it wasn’t decided, or stopped holding', frames: [
      { step: 'n-rej0', t: 'The menu says it wasn’t decided.' },
      { step: 'n-rej1', t: 'It says who said so, with Reopen. Its mark leaves the horizon.' },
      { step: 'n-sup', t: 'A confirmed decision can stop holding when a later one replaces it.' },
      { step: 'n-ans', t: 'An open question works the same way: It was answered, then Reopen.' }
    ] },
    { name: 'When someone says it wasn’t decided', frames: [
      { step: 'n-disp', t: 'Someone who can’t reject it says so, in their name, for the organizer to settle.' },
      { step: 'n-disp2', t: 'The menu shows what was said behind it, and every change. Keep it confirmed settles it.' }
    ] },
    { name: 'Add what the notes missed', frames: [
      { step: 'n-prop0', t: 'Under each list: Propose a decision, or Add a follow-up.' },
      { step: 'n-prop1', t: 'It opens in place, in your words. Everyone with the notes sees it.' },
      { step: 'n-prop2', t: 'It’s proposed by you, until someone else confirms it.' },
      { step: 'n-prop3', t: 'The plus on a transcript line starts one from what was said there.' }
    ] },
    { name: 'Take on and reassign a follow-up', frames: [
      { step: 'n-take', t: 'The notes suggest you, dashed. Click I’ll do it.' },
      { step: 'n-taken', t: 'It’s yours, and solid on the horizon.' },
      { step: 'n-fmenu', t: 'Its menu gives it to anyone with the notes, dates it, rewords it and lists every change.' },
      { step: 'n-given', t: 'Give it to Kofi. It stays dashed until Kofi takes it on.' }
    ] },
    { name: 'Correct a transcript line', frames: [
      { step: 'n-fix0', t: 'Point at a line and click the pencil. Dots mark what it wasn’t sure of.' },
      { step: 'n-fix1', t: 'The line becomes its own editor.' },
      { step: 'n-fix2', t: 'Fix the words. The organizer can change who said it too.' },
      { step: 'n-fix3', t: 'It says Corrected, and the organizer can write the notes again.' },
      { step: 'n-fix4', t: 'Everyone keeps reading, and the seal says it’s being written again.' },
      { step: 'n-fix5', t: 'Done, and what people settled stayed. Corrected says who, when and what was heard.' }
    ] },
    { name: 'Ask about this call', frames: [
      { step: 'n-ask0', t: 'Click the bar. It stays at the bottom as you read.' },
      { step: 'n-ask1', t: 'Suggested questions show above it. Pick one, or type your own.' },
      { step: 'n-ask2', t: 'It reads the call in confidential compute.' },
      { step: 'n-ask3', t: 'The answer cites the moments it came from. Click one.' },
      { step: 'n-ask4', t: 'The horizon and the transcript go there. Keep the answer if you want it.' },
      { step: 'n-ask5', t: 'It’s in Your notes. Only you can read it.' }
    ] },
    { name: 'Your notes, then the shared notes', frames: [
      { step: 'n-own0', t: 'Write in Your notes. Nobody else reads them, the organizer included.' },
      { step: 'n-own1', t: 'It’s kept. The arrow adds it to the shared notes.' },
      { step: 'n-own2', t: 'In place of the box you write in: what goes, where, and who reads it.' },
      { step: 'n-own3', t: 'Cut the words down. Nothing goes until Add for 3 people.' },
      { step: 'n-since', t: 'If someone got the notes since, it says so and shows them.' },
      { step: 'n-own4', t: 'It’s in Added by people, for everyone. Your own stays yours.' }
    ] },
    { name: 'Take back what you added', frames: [
      { step: 'n-back0', t: 'Click Take back on what you added.' },
      { step: 'n-back1', t: 'It asks in the row. Nothing is gone yet.' },
      { step: 'n-back2', t: 'It’s out for everyone, and it stays in Your notes.' },
      { step: 'n-back3', t: 'The organizer can Remove anyone’s the same way.' }
    ] },
    { name: 'Bookmark a line or a shared screen', frames: [
      { step: 'n-mark0', t: 'Point at a line and click the bookmark.' },
      { step: 'n-mark1', t: 'It’s in Your notes, and only you see it.' },
      { step: 'n-scrl', t: 'The transcript says when a screen was shared.' },
      { step: 'n-scr0', t: 'With all of it open, the screen sits where it was shown.' },
      { step: 'n-scr1', t: 'It opens over the note, with its own bookmark.' },
      { step: 'n-scr2', t: 'Bookmarked, it’s in Your notes too.' }
    ] },
    { name: 'Share', frames: [
      { step: 'n-sh0', t: 'Click Share.' },
      { step: 'n-sh1', t: 'A popover opens under it, with your groups first.' },
      { step: 'n-sh2', t: 'Pick people or a group, then Share.' },
      { step: 'n-sh3', t: 'They’re in Who has these notes, with how they got them.' },
      { step: 'n-many', t: 'A long list shows its first eight, until Show all.' }
    ] },
    { name: 'Pin, and what was checked', frames: [
      { step: 'n-pin0', t: 'Click the pin.' },
      { step: 'n-pin1', t: 'It’s in the side panel.' },
      { step: 'n-pin2', t: 'Eight is the most. It says so.' },
      { step: 'n-seal0', t: 'Click the seal.' },
      { step: 'n-seal1', t: 'It opens what was checked about the models.' }
    ] },
    { name: 'Delete', frames: [
      { step: 'n-del0', t: 'More, then Delete notes.' },
      { step: 'n-del1', t: 'The popover asks, and says what goes.' },
      { step: 'n-del2', t: 'It lists what went.' }
    ] },
    { name: 'Notes from someone else', frames: [
      { step: 'n-them', t: 'It says how you got them, beside when it was.' },
      { step: 'n-them2', t: 'Shared afterwards, it says by whom, and with which group.' },
      { step: 'n-rm0', t: 'More says Remove from your notes.' },
      { step: 'n-rm1', t: 'Everyone else keeps them.' },
      { step: 'n-rm2', t: 'They’re out of your notes.' }
    ] },
    { name: 'A note being written', frames: [
      { step: 'n-rec', t: 'Still recording: the line ends where the call has got to, and Play plays what’s there so far.' },
      { step: 'n-w1', t: 'The call ended. Each step ticks off, with the one in progress marked.' },
      { step: 'n-w2', t: 'The audio is saved, so it can be played.' },
      { step: 'n-w3', t: 'The transcript is ready to read, before the notes are, and the light comes in with it.' },
      { step: 'home', t: 'Written. The marks arrive on the horizon.' }
    ] },
    { name: 'Nothing said', frames: [
      { step: 'n-quiet', t: 'Still water. It says so, and Play stays on the line.' },
      { step: 'n-quiet2', t: 'Play moves the sun along the line.' }
    ] },
    { name: 'A call that didn’t keep everything', frames: [
      { step: 'n-notr', t: 'No transcript: one line where it would have been, and no light on the water.' },
      { step: 'n-norec', t: 'No recording: one line under the horizon, and no player.' },
      { step: 'n-nokeep', t: 'Neither. You can still ask about what the notes say.' },
      { step: 'n-gap', t: 'Where nothing was captured is a point on the line, and says when.' }
    ] },
    { name: 'A note that’s gone', frames: [
      { step: 'n-missing', t: 'Deleted, or never shared with you. It says so.' }
    ] },
    { name: 'Breakout rooms', frames: [
      { step: 'n-room0', t: 'Each room is folded under the note. Click one.' },
      { step: 'n-room1', t: 'Its own summary, decisions, open questions and follow-ups.' },
      { step: 'n-room2', t: 'And what was said there, folded again.' },
      { step: 'n-room3', t: 'A room where nothing was said says so.' }
    ] },
    { name: 'A series, and meeting again', frames: [
      { step: 'n-ser0', t: 'In a series, the other calls sit beside the note.' },
      { step: 'n-ser1', t: 'Not in one, the organizer can schedule next week’s call.' },
      { step: 'n-ser2', t: 'That starts the series. Change opens the call, to move it or cancel it.' }
    ] },
    { name: 'First day', frames: [
      { scene: 'first', step: 'home', t: 'Home’s example note, written out, with nothing to share or delete.' },
      { step: 'n-empty', t: 'Your notes before you’ve kept anything.' }
    ] },
    { name: 'By day', frames: [
      { step: 'home', mode: 'light', t: 'The note.' },
      { step: 'n-jumped', mode: 'light', t: 'At a moment.' },
      { step: 'n-sh1', mode: 'light', t: 'Share.' },
      { step: 'n-ask3', mode: 'light', t: 'An answer.' },
      { step: 'n-own2', mode: 'light', t: 'Adding to the shared notes.' },
      { step: 'n-w3', mode: 'light', t: 'Being written.' }
    ] }
  ];
  AH.JOURNEYS_NOTE_PHONE = { name: 'On a phone', phone: true, frames: [
    { step: 'home', t: 'The note.' },
    { step: 'n-jumped', t: 'At a moment.' },
    { step: 'n-take', t: 'Follow-ups.' },
    { step: 'n-chapters', t: 'Chapters, listed beside the note.' },
    { step: 'n-ask3', t: 'An answer.' },
    { step: 'n-sh1', t: 'Share.' },
    { step: 'n-own2', t: 'Adding to the shared notes.' },
    { step: 'n-w3', t: 'Being written.' },
    { step: 'n-del2', t: 'Deleted.' }
  ] };
})();
