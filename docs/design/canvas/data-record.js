/*
 * Record: what's recorded, what's waiting on this device, and every state the page and the stage can be in.
 * The two room notes in appdata.js lead Recorded before; everything else here is this page's own.
 */
(function () {
  var AH = window.AH, D = AH.D;

  /* Lucide, as the app's Icon uses it. */
  var I = AH.assign({}, AH.I, {
    pause: 'M15 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-16a1 1 0 0 1 1 -1zM6 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-16a1 1 0 0 1 1 -1z',
    stop: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2z',
    cloudOff: 'M10.94 5.274A7 7 0 0 1 15.71 10h1.79a4.5 4.5 0 0 1 4.222 6.057M18.796 18.81A4.5 4.5 0 0 1 17.5 19H9A7 7 0 0 1 5.79 5.78M2 2l20 20',
    drive: 'M10 16h.01M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11zM21.946 12.013H2.054M6 16h.01',
    upload: 'M12 3v12M17 8l-5-5-5 5M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4',
    more: 'M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M18 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M4 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0',
    trash: 'M10 11v6M14 11v6M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
    wifiOff: 'M12 20h.01M8.5 16.429a5 5 0 0 1 7 0M5 12.859a10 10 0 0 1 5.17-2.69M19 12.859a10 10 0 0 0-2.007-1.523M2 8.82a15 15 0 0 1 4.177-2.643M22 8.82a15 15 0 0 0-11.288-3.764M2 2l20 20',
    clock: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0M12 6v6l4 2',
    alert: 'M21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01',
    micOff: 'M12 19v3M15 9.34V5a3 3 0 0 0-5.68-1.33M16.95 16.95A7 7 0 0 1 5 12v-2M18.89 13.23A7 7 0 0 0 19 12v-2M2 2l20 20M9 9v3a3 3 0 0 0 5.12 2.12',
    spin: 'M21 12a9 9 0 1 1-6.219-8.56',
    retry: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8M21 3v5h-5'
  });

  var UNNAMED = 'Notes from the room';
  var MICS = [
    { id: 'mbp', name: 'MacBook Pro Microphone' },
    { id: 'studio', name: 'Studio Display Microphone' },
    { id: 'pods', name: 'AirPods Pro' }
  ];

  /* What's said in the room. Nobody is named: the room isn't told apart by voice. */
  var LINES = [
    'Right, shall we start with what changed on the night shift?',
    'The cold store alarm went off twice, both before four.',
    'Did anyone log it, or is that still on paper?',
    'Still on paper. We said we’d move the log over by Friday.',
    'Let’s keep the handover in Portuguese for the morning crew.',
    'I’ll send the new rota round once Maya has signed it off.',
    'And the forklift service moves to Tuesday, so plan around it.',
    'Anything else before we walk the floor?'
  ];

  /* On this device. `status` is how each stands. How far an upload has got isn't known, so its bar only says that it's going. */
  var KEPT = {
    handover: { id: 'handover', title: 'Harbourline handover', long: '24 min', at: 'today at 09:40', status: 'uploading' },
    supplier: { id: 'supplier', title: 'Supplier walk-through', long: '38 min', at: 'today at 13:10', status: 'waiting' },
    unnamed: { id: 'unnamed', title: UNNAMED, long: 'Under a minute', at: 'yesterday at 18:02', status: 'refused', why: 'Your account has no minutes of notes left.' },
    tab: { id: 'tab', title: 'Morning walk-round', long: '7 min', at: 'today at 15:58', status: 'recording' },
    old: { id: 'old', title: 'Yard inspection', long: '1 h 04 min', at: 'on Mon 19 Oct at 08:15', status: 'expired', why: 'More than 14 days old, so it can only be deleted.' },
    lost: { id: 'lost', title: 'Interview: Tomás Vale', long: '41 min', at: 'on Fri 30 Oct at 11:20', status: 'unreadable', why: 'This device can’t open it any more, so it can only be deleted.' }
  };
  var pick = function () { return [].slice.call(arguments).map(function (k) { return AH.assign({}, typeof k === 'string' ? KEPT[k] : KEPT[k[0]], typeof k === 'string' ? {} : k[1]); }); };
  var DEVICE = {
    usual: pick('handover', 'supplier', 'unnamed'),
    away: pick(['handover', { status: 'waiting' }], 'supplier', 'unnamed'),
    back: pick('handover', 'supplier', 'unnamed'),
    second: pick(['supplier', { status: 'uploading' }], 'unnamed'),
    every: pick('tab', 'handover', 'supplier', 'unnamed', 'old', 'lost')
  };

  /* Recorded before: the newest four. Who has it, and the follow-ups still open, are this page's detail on the shared notes. */
  var room = D.notes.filter(function (n) { return n.kind === 'room'; });
  var EXTRA = { n5: { when: 'Mon', left: 1 }, n6: { when: 'Mon', who: 'priya,kofi' } };
  var BEFORE = room.map(function (n) {
    return AH.assign({ id: n.id, title: n.title, long: n.length, gist: n.summary, left: 0, who: '' }, EXTRA[n.id]);
  }).concat([
    { id: 'r3', title: 'Workshop with the sales team', when: '29 Oct', long: '1 h 5 min', gist: 'The demo opens on the note, not the call. Diego rewrites the first five minutes.', left: 2, who: 'maya,lena' },
    { id: 'r4', title: 'Interview: Mira Olsen', when: '27 Oct', long: '47 min', gist: 'Ran support at a logistics firm for six years. Wants a team of their own.', left: 0, who: '' }
  ]);
  var FRESH = { id: 'handover', title: 'Harbourline handover', when: 'Today', long: '24 min', gist: '', left: 0, who: '', writing: true };

  /* The voice on the water. Each row is one moment: the newest at the horizon, the older ones further out. */
  function seeded(n) { return function () { n = (n * 16807) % 2147483647; return (n - 1) / 2147483646; }; }
  function speech(i) {
    var t = i * 0.42, v = Math.pow(Math.abs(Math.sin(t * 2.3)), 1.4) * (0.62 + 0.38 * Math.sin(t * 0.77 + 1.1)) + 0.28 * Math.abs(Math.sin(t * 5.1 + 0.6));
    return Math.max(0.08, Math.min(1, v));
  }
  var shapes = {};
  function voice(kind, span) {
    var key = kind + span;
    if (shapes[key]) return shapes[key];
    var r = seeded(7), beat = seeded(11), out = [], i = 0, calm = kind === 'idle' || kind === 'still';
    for (var y = 7; y < span; y += 8, i++) {
      var far = y / span, w = calm ? 300 : (span > 100 ? 190 : 150) + far * 120, n = 1 + Math.round(r() * (calm ? 1 : 2)), bits = [], x = 2 + r() * 8;
      for (var k = 0; k < n; k++) {
        var bw, at;
        if (calm) {
          /* Still water: short dashes close to the middle, a little wider further out, as under the sun on Home. */
          var spread = (kind === 'still' ? 7 : 12) + far * (kind === 'still' ? 14 : 34);
          bw = (6 + r() * (kind === 'still' ? 14 : 24)) * (0.8 + far) / 3;
          at = 50 + (r() - 0.5) * 2 * spread / 3 - bw / 2;
        } else {
          var room2 = 96 - x;
          bw = room2 * (k === n - 1 ? 1 : 0.34 + r() * 0.3);
          at = x;
          x += bw + 2 + r() * 5;
        }
        bits.push({ style: 'left: ' + at.toFixed(1) + '%; width: ' + bw.toFixed(1) + '%; --every: ' + (34 + beat() * 22).toFixed(1) + 's; --after: ' + (-beat() * 56).toFixed(1) + 's' });
      }
      var a = calm ? 1 : (kind === 'level' ? 0.72 : 1) * speech(i + 3);
      out.push({ style: 'top: ' + y + 'px; --w: ' + w.toFixed(0) + 'px; --a: ' + a.toFixed(3) + '; --o: ' + (0.92 - far * 0.66).toFixed(2) + '; --t: ' + far.toFixed(2), bits: bits });
    }
    shapes[key] = out;
    return out;
  }

  /* A recording's own print, for its row: the same seed always draws the same bars. */
  function print(id) {
    var n = 0;
    for (var c = 0; c < id.length; c++) n = n * 31 + id.charCodeAt(c);
    var r = seeded(n % 2147483646 + 1), out = [];
    for (var i = 0; i < 7; i++) out.push({ style: '--h: ' + (0.24 + r() * 0.76).toFixed(2) });
    return out;
  }

  function clock(s) {
    var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60, two = function (n) { return (n < 10 ? '0' : '') + n; };
    return (h ? h + ':' + two(m) : two(m)) + ':' + two(x);
  }

  /* Where each journey frame starts. */
  var REC = { view: 'stage', name: 'Harbourline handover', elapsed: 754, lines: 5 };
  var NOW = { id: 'now', title: 'Harbourline handover', long: '13 min', at: 'today at 16:12', status: 'waiting' };
  var away = { net: 'offline', device: DEVICE.away };
  var STEPS = {
    record: {},
    first: { day1: true },
    typed: { name: 'Harbourline handover', hot: 'start' },
    hotMic: { hot: 'mic' },
    micOpen: { micOpen: true, hot: 'mic-studio' },
    micChosen: { mic: 'studio' },
    micUnnamed: { unnamed: true },
    hotCheck: { hot: 'check' },
    checking: { check: true },
    hotStop: { check: true, hot: 'check' },
    micHotChoose: { check: true, micOpen: true, hot: 'mic-studio' },
    micFailed: { check: true, say: 'didnt' },
    micUnplugged: { check: true, mic: 'mbp', say: 'unplugged' },
    micBusy: { check: true, trouble: 'busy', hot: 'retry' },
    micBlocked: { check: true, trouble: 'blocked', hot: 'retry' },
    micMissing: { check: true, trouble: 'missing' },

    offline: away,
    uploadBack: { device: DEVICE.back },
    uploadOne: { device: DEVICE.second, before: [FRESH].concat(BEFORE.slice(0, 3)), toast: '“Harbourline handover” uploaded. Its notes are being written.' },
    goneElsewhere: { device: [DEVICE.second[0]], before: [FRESH].concat(BEFORE.slice(0, 3)), toast: '“Notes from the room” was deleted on Alcove, so what was left of it on this device is deleted too.' },
    uploadAll: { device: [], before: [AH.assign({}, FRESH, { id: 'supplier', title: 'Supplier walk-through', long: '38 min' }), AH.assign({}, FRESH, { writing: false, gist: 'The cold store alarm stays on paper until Friday. The handover stays in Portuguese.', left: 2 })].concat(BEFORE.slice(0, 2)) },
    hotBefore: { hot: 'note-n5' },
    noteOffline: { net: 'offline', device: DEVICE.away, toast: 'Notes open when you’re back online.' },
    beforeGoing: { before: [AH.assign({}, FRESH, { id: 'going', title: 'Morning walk-round', going: true }), FRESH].concat(BEFORE.slice(0, 2)) },
    hotInNotes: { hot: 'in-notes' },
    hotRow: { hot: 'row-unnamed' },
    rowMenu: { menu: 'unnamed', hot: 'upload-unnamed' },
    rowUploading: { device: [KEPT.handover, KEPT.supplier, AH.assign({}, KEPT.unnamed, { status: 'uploading', why: '' })] },
    rowMenuDelete: { menu: 'unnamed', hot: 'delete-unnamed' },
    rowSure: { menu: 'unnamed', sure: true, hot: 'sure-unnamed' },
    rowDeleted: { device: DEVICE.usual.slice(0, 2), toast: 'Deleted from this device.' },
    statusGoing: { device: DEVICE.every.slice(0, 3) },
    statusStuck: { device: DEVICE.every.slice(3) },
    deleteBusy: { toast: 'Another tab is using it, so it wasn’t deleted. Try again in a moment.' },

    keepOff: { keep: false, device: [] },
    keepOffNet: { keep: false, net: 'offline', device: [] },

    /* The stage. */
    live0: AH.assign({}, REC, { elapsed: 4, lines: 0 }),
    live: REC,
    hotPause: AH.assign({}, REC, { hot: 'pause' }),
    paused: AH.assign({}, REC, { paused: true, hot: 'pause' }),
    hotFinish: AH.assign({}, REC, { hot: 'finish' }),
    finishing: AH.assign({}, REC, { ending: true }),
    writing: { view: 'writing', name: 'Harbourline handover', elapsed: 754 },
    hotRename: AH.assign({}, REC, { name: 'Notes from the room', hot: 'rename' }),
    renaming: AH.assign({}, REC, { name: 'Harbourline handover, night shift', focus: true }),
    readBack: AH.assign({}, REC, { lines: 8, back: true }),
    hotLeave: AH.assign({}, REC, { hot: 'leave' }),
    leave: AH.assign({}, REC, { leave: true, hot: 'discard' }),
    discarded: { toast: 'Recording discarded. Nothing was kept.' },
    liveOffline: AH.assign({}, REC, { net: 'offline', lines: 5 }),
    hotSave: AH.assign({}, REC, { net: 'offline', hot: 'finish' }),
    liveBack: AH.assign({}, REC, { lines: 6, elapsed: 802 }),
    behind: AH.assign({}, REC, { behind: true }),
    savedHere: { net: 'offline', device: [NOW].concat(DEVICE.away.slice(1)), toast: 'Saved on this device. It uploads when you’re back online.' },
    savedBack: { device: [NOW, AH.assign({}, DEVICE.away[1], { status: 'uploading' }), DEVICE.away[2]] },
    startedNow: AH.assign({}, REC, { net: 'offline', lines: 0, elapsed: 4 }),
    startedOffline: AH.assign({}, REC, { net: 'offline', lines: 0, elapsed: 96 }),
    starting: { view: 'stage', name: 'Harbourline handover', starting: true },
    cantStart: { view: 'stage', failed: 'Can’t reach Alcove. Check your connection.' },
    unreachable: AH.assign({}, REC, { net: 'unreachable' }),
    full: AH.assign({}, REC, { net: 'offline', held: 'full' }),
    otherAccount: AH.assign({}, REC, { account: 'other' }),
    signedOut: AH.assign({}, REC, { account: 'signed-out' }),
    forgotten: AH.assign({}, REC, { held: 'forgotten' }),
    heldOffline: AH.assign({}, REC, { net: 'offline', keep: false, held: 'offline', device: [] }),
    notFinished: AH.assign({}, REC, { keep: false, notFinished: true, device: [] }),
    liveMic: AH.assign({}, REC, { trouble: 'busy', hot: 'retry' })
  };

  /* Every journey, frame by frame. Frames are one row each; the phone row is added by the board. */
  var JOURNEYS = [
    { name: 'Record, and get the notes', frames: [
      { step: 'typed', t: 'Name it, or leave it: empty, it’s “Notes from the room”. Click Start recording, or press R.' },
      { step: 'live0', t: 'The page gives way to the stage. The orb fills, and the reminder holds its place for the first moments.' },
      { step: 'live', t: 'Your voice runs across the water. What’s said comes up under it, seconds later.' },
      { step: 'hotFinish', t: 'Click Finish and write notes.' },
      { step: 'finishing', t: 'The orb sets while the last of it is saved.' },
      { step: 'writing', t: 'The note opens, and ticks off each step until it’s written.' }
    ] },
    { name: 'Check the level', frames: [
      { step: 'hotCheck', t: 'Click Check the level. The page never opens the microphone by itself.' },
      { step: 'checking', t: 'The reflection moves with your voice. The orb stays dark: nothing is recorded.' },
      { step: 'hotStop', t: 'Click Stop.' },
      { step: 'record', t: 'It lets go of the microphone, and the water goes still.' }
    ] },
    { name: 'Choose a microphone', frames: [
      { step: 'hotMic', t: 'Click the microphone.' },
      { step: 'micOpen', t: 'This browser’s microphones, the same choice calls use.' },
      { step: 'micChosen', t: 'It’s chosen. Choosing one doesn’t open it.' },
      { step: 'micUnnamed', t: 'Until the browser has named its microphones there’s nothing to choose: it uses the default.' }
    ] },
    { name: 'A microphone that fails', frames: [
      { step: 'micHotChoose', t: 'While checking, pick another one.' },
      { step: 'micFailed', t: 'It doesn’t start. It says so, and the one still in use stays shown.' },
      { step: 'micUnplugged', t: 'One unplugged while it’s open: the same.' },
      { step: 'micBusy', t: 'Nothing starts. It says what to do, with Try again.' },
      { step: 'micBlocked', t: 'Blocked in the browser.' },
      { step: 'micMissing', t: 'No microphone at all. Nothing to retry: it picks one up when it’s plugged in.' }
    ] },
    { name: 'Pause and resume', frames: [
      { step: 'hotPause', t: 'Click Pause.' },
      { step: 'paused', t: 'The orb empties and the water goes still. Nothing is heard. Click Resume.' },
      { step: 'live', t: 'The orb fills again, and the time carries on from where it stopped.' }
    ] },
    { name: 'While it records', frames: [
      { step: 'hotRename', t: 'Click the name.' },
      { step: 'renaming', t: 'Type. It keeps recording, and the name saves when you click away.' },
      { step: 'readBack', t: 'Scroll up what’s said to read back the rest. Dotted words were hard to hear. Latest goes back.' }
    ] },
    { name: 'Discard', frames: [
      { step: 'hotLeave', t: 'Click Home.' },
      { step: 'leave', t: 'It asks first: finish, or discard.' },
      { step: 'discarded', t: 'Discard recording. Nothing is kept, and you’re back on Record.' }
    ] },
    { name: 'The connection drops mid-recording', frames: [
      { step: 'live', t: 'Recording, online.' },
      { step: 'liveOffline', t: 'Offline shows at the top. It keeps recording, and saves here.' },
      { step: 'liveBack', t: 'Back while still recording: the rest goes up as it’s recorded, and the words catch up.' },
      { step: 'behind', t: 'Online, but the words are running behind. It says so, and nothing is lost.' }
    ] },
    { name: 'Finish and save, offline', frames: [
      { step: 'hotSave', t: 'Still offline, the button says what it will do. Click Finish and save.' },
      { step: 'savedHere', t: 'It stays on this device, and you’re back on Record.' },
      { step: 'savedBack', t: 'Back online, they upload by themselves, the oldest first.' }
    ] },
    { name: 'Starting', frames: [
      { step: 'starting', t: 'The moment before it records: the orb is still to rise.' },
      { step: 'offline', t: 'Offline, Record says recording still works.' },
      { step: 'startedNow', t: 'Start recording, and it works the same way, with the reminder first.' },
      { step: 'startedOffline', t: 'After the first moments it says it’s saving here. Words wait for the connection.' },
      { step: 'cantStart', t: 'If it can’t start at all, it says why, and the way back is one click.' }
    ] },
    { name: 'When it can’t get through, or can’t keep going', frames: [
      { step: 'unreachable', t: 'Online, but Alcove isn’t answering. It’s sent when it does.' },
      { step: 'full', t: 'This device is full. It pauses and says so.' },
      { step: 'otherAccount', t: 'Someone else signs in on this browser. It stays here for you.' },
      { step: 'signedOut', t: 'Signed out in another tab. It uploads once you’re back.' },
      { step: 'forgotten', t: 'Signed out on this browser: it pauses, and nothing more can be kept.' },
      { step: 'liveMic', t: 'The microphone stops. What’s wrong, and Try again.' }
    ] },
    { name: 'Recordings waiting on this device', frames: [
      { step: 'offline', t: 'Offline, they wait for a connection.' },
      { step: 'uploadBack', t: 'Back online, they upload by themselves, the oldest first.' },
      { step: 'uploadOne', t: 'One’s done. A toast says so, and it moves to Recorded before.' },
      { step: 'goneElsewhere', t: 'One whose note was deleted on Alcove goes from here too.' },
      { step: 'uploadAll', t: 'Nothing left to upload: the list goes, and the notes are there.' }
    ] },
    { name: 'Upload now, or delete from this device', frames: [
      { step: 'hotRow', t: 'Click the menu on a row.' },
      { step: 'rowMenu', t: 'Upload now.' },
      { step: 'rowUploading', t: 'It goes straight away.' },
      { step: 'rowMenuDelete', t: 'Or Delete from this device.' },
      { step: 'rowSure', t: 'It asks first, in the same menu.' },
      { step: 'rowDeleted', t: 'Gone, here and on Alcove.' }
    ] },
    { name: 'Recorded before', frames: [
      { step: 'hotBefore', t: 'Click a recording, and its note opens.' },
      { step: 'hotInNotes', t: 'The four newest show here. In Notes has the rest.' },
      { step: 'beforeGoing', t: 'One still recording elsewhere, and one whose notes are being written.' },
      { step: 'noteOffline', t: 'Offline, a note doesn’t open, and it says so.' }
    ] },
    { name: 'How a recording on this device can stand', frames: [
      { step: 'statusGoing', t: 'Recording now in another tab, uploading, or waiting. The menu goes while one is busy, and the column stays.' },
      { step: 'statusStuck', t: 'The three that can’t go, each saying why. The last two can only be deleted.' },
      { step: 'deleteBusy', t: 'One another tab has just taken isn’t deleted, and it says so.' }
    ] },
    { name: 'Record without a connection, off', frames: [
      { step: 'keepOff', t: 'Off in Settings: nothing is kept here, and the line says recording needs a connection.' },
      { step: 'heldOffline', t: 'The connection drops mid-recording, and it pauses. Resume waits for the connection.' },
      { step: 'keepOffNet', t: 'Offline, it can’t start. Start recording waits for the connection.' },
      { step: 'notFinished', t: 'A finish that fails says so, and Finish can be pressed again. It never records again.' }
    ] },
    { name: 'First day', frames: [
      { step: 'first', t: 'Nothing recorded yet. The sky has the job, and the water says what will show up.' }
    ] }
  ];

  AH.RC = { I: I, UNNAMED: UNNAMED, MICS: MICS, LINES: LINES, DEVICE: DEVICE, BEFORE: BEFORE, voice: voice, print: print, clock: clock, STEPS: STEPS, JOURNEYS: JOURNEYS };
})();
