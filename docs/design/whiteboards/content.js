/*
 * The fictional world: Art Vandelay's Product group, in a launch retro on Wed 4 Nov. Everything on a board is
 * world coordinates; a note is 150 x 150. Colours stay in the sunrise family: butter, peach, rose, lilac, sky, mist.
 */
window.WB = (function () {
  var PEOPLE = {
    art: { name: 'Art', full: 'Art Vandelay', c: '#5B4BE0', bg: '#FFE3CF' },
    priya: { name: 'Priya', full: 'Priya Raman', c: '#C2406E', bg: '#F8D6E4' },
    theo: { name: 'Theo', full: 'Theo Martin', c: '#2F6FD6', bg: '#D5DEFF' },
    kofi: { name: 'Kofi', full: 'Kofi Asante', c: '#96600F', bg: '#FFE1C4' },
    maya: { name: 'Maya', full: 'Maya Chen', c: '#8A4FD0', bg: '#E2E7FF' },
    lena: { name: 'Lena', full: 'Lena Fischer', c: '#9C4A86', bg: '#FBE3EE' },
    sam: { name: 'Sam', full: 'Sam Okafor', c: '#4A6BD6', bg: '#FFEBD8' },
    aiko: { name: 'Aiko', full: 'Aiko Tanaka', c: '#7A4FD0', bg: '#E8E2FF' }
  };
  var S = 150, G = 20;
  function slot(f, i, cols) { cols = cols || 2; return { x: f.x + G + (i % cols) * (S + G), y: f.y + G + Math.floor(i / cols) * (S + G), w: S, h: S }; }
  function note(id, f, i, c, t, by, cols) { var p = slot(f, i, cols); return { id: id, k: 'note', f: f.id, c: c, t: t, by: by, x: p.x, y: p.y, w: S, h: S }; }
  function frame(id, t, x, y, w, h, hint, sub) { return { id: id, t: t, x: x, y: y, w: w, h: h, hint: hint || '', sub: sub || '' }; }

  /* The retro */
  var well = frame('well', 'Went well', 0, 0, 360, 530, 'What should we keep doing?');
  var fix = frame('fix', 'Could improve', 400, 0, 360, 530, 'What got in the way?');
  var act = frame('act', 'Actions', 800, 0, 360, 530, 'Who does what next?');
  var retro = {
    title: 'Launch retro', frames: [well, fix, act],
    items: [
      note('w1', well, 0, 'butter', 'Beta sign-ups beat the plan', 'priya'),
      note('w2', well, 1, 'butter', 'Support ran launch day with no queue', 'maya'),
      note('w3', well, 2, 'butter', 'Design and engineering paired on the importer', 'theo'),
      note('w4', well, 3, 'butter', 'Pricing page shipped a week early', 'lena'),
      note('w5', well, 4, 'butter', 'No rollbacks', 'kofi'),
      note('f3', fix, 0, 'rose', 'Nobody owned the status page', 'maya'),
      note('f1', fix, 1, 'rose', 'Changelog went out after the launch post', 'priya'),
      note('f5', fix, 2, 'rose', 'QA found the billing bug on launch day', 'lena'),
      note('f2', fix, 3, 'rose', 'Staging data was two days stale', 'kofi'),
      note('f4', fix, 5, 'rose', 'One checklist lived in three tools', 'theo'),
      note('a1', act, 0, 'sky', 'One owner for launch comms', 'art'),
      note('a2', act, 2, 'sky', 'Refresh staging every night', 'kofi'),
      note('a3', act, 4, 'sky', 'Write the launch runbook', 'theo')
    ],
    links: [{ id: 'l1', a: 'f1', b: 'a1' }, { id: 'l2', a: 'f2', b: 'a2' }, { id: 'l3', a: 'f4', b: 'a3' }]
  };

  /* Ideas, before and after sorting */
  var idf = frame('ideas', 'How do we launch better?', 0, 0, 1160, 530, '');
  var ideaText = [
    ['i1', 'Write the changelog first', 'butter', 'priya', 40, 30, 0, 0],
    ['i2', 'One launch calendar', 'peach', 'theo', 250, 90, 0, 1],
    ['i3', 'Tell support a week ahead', 'rose', 'maya', 470, 26, 0, 2],
    ['i4', 'Refresh staging every night', 'sky', 'kofi', 690, 120, 1, 0],
    ['i5', 'Test billing with real cards', 'lilac', 'lena', 900, 40, 1, 1],
    ['i6', 'Dry run the day before', 'butter', 'sam', 130, 300, 1, 2],
    ['i7', 'Name an owner for every launch', 'rose', 'art', 370, 280, 2, 0],
    ['i8', 'The status page gets an owner', 'sky', 'maya', 620, 330, 2, 1],
    ['i9', 'Keep the runbook in the workspace', 'peach', 'theo', 860, 300, 2, 2]
  ];
  var themeC = ['butter', 'sky', 'rose'];
  var ideas = {
    title: 'Launch retro', frames: [idf],
    items: ideaText.map(function (r) {
      var col = r[6], k = r[7];
      return { id: r[0], k: 'note', f: 'ideas', t: r[1], c: r[2], by: r[3], x: r[4], y: r[5], w: S, h: S, tx: 30 + col * 380 + (k % 2) * (S + 14), ty: 92 + Math.floor(k / 2) * (S + 14), tc: themeC[col] };
    }),
    labels: [
      { id: 't1', k: 'label', t: 'Comms', x: 34, y: 34, w: 300, h: 30 },
      { id: 't2', k: 'label', t: 'Testing', x: 414, y: 34, w: 300, h: 30 },
      { id: 't3', k: 'label', t: 'Ownership', x: 794, y: 34, w: 300, h: 30 }
    ],
    links: []
  };

  /* A flow, from the workspace */
  function shape(id, s, t, x, y, w, h, c) { return { id: id, k: 'shape', s: s, t: t, x: x, y: y, w: w, h: h, c: c || '' }; }
  var flow = {
    title: 'Onboarding flow', frames: [],
    items: [
      shape('s1', 'pill', 'Sign up', 0, 130, 170, 76, 'sky'),
      shape('s2', 'rect', 'Verify email', 240, 130, 170, 76),
      shape('s3', 'diamond', 'Invited by a team?', 480, 88, 180, 160, 'butter'),
      shape('s4', 'rect', 'Join their workspace', 740, 20, 190, 76),
      shape('s5', 'rect', 'Create a workspace', 740, 240, 190, 76),
      shape('s6', 'pill', 'Invite people', 1000, 240, 170, 76, 'sky'),
      { id: 'n1', k: 'note', c: 'rose', t: 'Most people stop here. Can we skip it for invited people?', by: 'aiko', x: 250, y: 260, w: S, h: S },
      { id: 'y', k: 'label', t: 'Yes', x: 672, y: 96, w: 40, h: 24 },
      { id: 'no', k: 'label', t: 'No', x: 672, y: 226, w: 40, h: 24 }
    ],
    links: [{ id: 'k1', a: 's1', b: 's2' }, { id: 'k2', a: 's2', b: 's3' }, { id: 'k3', a: 's3', b: 's4' }, { id: 'k4', a: 's3', b: 's5' }, { id: 'k5', a: 's5', b: 's6' }]
  };

  /* A board in each room: what happened, why, what next */
  var ROOMS = [
    { id: 'room1', name: 'Comms', who: ['priya', 'theo'], rows: [['Changelog went out after the launch post', 'Two people wrote the same email'], ['Nobody owned the date', 'The plan moved on Monday'], ['One owner for launch comms', 'One shared launch calendar']] },
    { id: 'room2', name: 'Staging', who: ['kofi', 'maya'], rows: [['Data was two days stale', 'A billing bug reached launch day'], ['The nightly job was off', 'Nobody watches it'], ['Refresh staging every night', 'Alert when the job fails']] },
    { id: 'room3', name: 'Support', who: ['lena', 'sam'], rows: [['Replies were out of date', 'Tickets went to the wrong queue'], ['Support saw the docs late', 'New plans had no tag'], ['Support joins the launch review', 'Tag plans before launch']] }
  ];
  var COLS = [['what', 'What happened', 'rose'], ['why', 'Why', 'peach'], ['next', 'What next', 'sky']];
  function roomBoard(r) {
    var frames = COLS.map(function (c, k) { return frame(r.id + c[0], c[1], k * 220, 0, 190, 360, ''); });
    var items = [];
    COLS.forEach(function (c, k) { r.rows[k].forEach(function (t, i) { items.push(note(r.id + c[0] + i, frames[k], i, c[2], t, r.who[(k + i) % r.who.length], 1)); }); });
    return { title: r.name, frames: frames, items: items, links: [] };
  }

  /* When rooms close: every room's board, side by side on the main board */
  function wall() {
    var frames = [], items = [];
    ROOMS.forEach(function (r, n) {
      var f = frame('w' + r.id, r.name, n * 400, 0, 360, 530, '', r.who.map(function (w) { return PEOPLE[w].name; }).join(', '));
      frames.push(f);
      COLS.forEach(function (c, k) { r.rows[k].forEach(function (t, i) { items.push(note('w' + r.id + c[0] + i, f, k * 2 + i, c[2], t, r.who[(k + i) % r.who.length])); }); });
    });
    return { title: 'Launch retro', frames: frames, items: items, links: [] };
  }

  var boards = { retro: retro, ideas: ideas, flow: flow, wall: wall(), blank: { title: 'Launch retro', frames: [], items: [], links: [] } };
  ROOMS.forEach(function (r) { boards[r.id] = roomBoard(r); });

  return { PEOPLE: PEOPLE, BOARDS: boards, ROOMS: ROOMS, S: S };
})();
