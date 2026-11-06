/*
 * Team: who stands on the horizon, how the line is laid out, every state a step can open, and the journeys.
 * Names come from AH.D so the pages tell one story. Everything here is made up.
 */
(function () {
  var AH = window.AH, D = AH.D, assign = AH.assign;

  /* Lucide, added to the shared map at runtime. */
  Object.assign(AH.I, {
    phone: 'M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384',
    mail: 'M22 7l-8.991 5.727a2 2 0 0 1-2.009 0L2 7M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    addUser: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M19 8v6M22 11h-6',
    pen: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497zM15 5l4 4',
    trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6',
    alert: 'M21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01',
    retry: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8M21 3v5h-5',
    wifiOff: 'M12 20h.01M8.5 16.429a5 5 0 0 1 7 0M5 12.859a10 10 0 0 1 5.17-2.69M19 12.859a10 10 0 0 0-2.007-1.523M2 8.82a15 15 0 0 1 4.177-2.643M22 8.82a15 15 0 0 0-11.288-3.764M2 2l20 20',
    up: 'M18 15l-6-6-6 6',
    settings: 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0'
  });

  /*
   * The people the shared data leaves out: how much you see them, for the order on the line and the rows. What's coming
   * up is your Alcove calls and the coming week of your calendar, which is as far as Alcove reads it: no month to count.
   */
  var SEEN = { priya: 1, kofi: 2, maya: 3, ines: 4, aiko: 5 };
  var MEETS = { priya: 4, kofi: 3, maya: 3, sam: 2, lena: 1, aiko: 1, ines: 1 };
  var coming = function (id) { var n = MEETS[id] || 0; return n ? n + (n === 1 ? ' meeting coming up' : ' meetings coming up') : ''; };

  /* Twenty-four more, for the company with thirty people on Alcove. */
  var MORE = [
    ['theo', 'Theo Martin', 'Engineering'], ['nadia', 'Nadia Haddad', 'Legal'], ['omar', 'Omar Farouk', 'Security'], ['elena', 'Elena Petrova', 'Data'],
    ['tom', 'Tom Becker', 'Support'], ['zara', 'Zara Ahmed', 'Marketing'], ['felix', 'Felix Wagner', 'Engineering'], ['milo', 'Milo Grant', 'Operations'],
    ['jamie', 'Jamie Lee', 'Partnerships'], ['ruth', 'Ruth Okoye', 'People'], ['ivan', 'Ivan Sokolov', 'Engineering'], ['mei', 'Mei Lin', 'Design'],
    ['pablo', 'Pablo Ortega', 'Sales'], ['hana', 'Hana Novak', 'Research'], ['Noor Rahimi', 'Noor Rahimi', 'Finance'], ['Erik Lund', 'Erik Lund', 'Engineering'],
    ['Tess Ward', 'Tess Ward', 'Support'], ['Yuki Sato', 'Yuki Sato', 'Design'], ['Caleb Stone', 'Caleb Stone', 'Sales'], ['Ines Costa', 'Ines Costa', 'Marketing'],
    ['Rafael Dias', 'Rafael Dias', 'Engineering'], ['Greta Holm', 'Greta Holm', 'Legal'], ['Luca Moretti', 'Luca Moretti', 'Data'], ['Amara Obi', 'Amara Obi', 'People']
  ].map(function (p, i) {
    return { id: p[0], name: p[1], first: p[1].split(' ')[0], title: p[2], on: true, last: i < 4 ? 'Last call · Mon' : 'Last call · Last week' };
  });

  var ME = { id: 'art', name: D.me.name, first: 'You', title: D.me.email, on: true, me: true };
  var byId = {};
  D.people.concat(MORE, [ME]).forEach(function (p) { byId[p.id] = p; });
  var person = function (id) { return byId[id] || { id: id, name: id, first: id, title: '' }; };
  var notYet = function (p) { return !p.on; };

  /* Who's at the company, for each of the team states. `invited` says who's been asked already. */
  function roster(who, invited) {
    var on = D.people.filter(function (p) { return p.on; }).sort(function (a, b) { return SEEN[a.id] - SEEN[b.id]; });
    var off = D.people.filter(notYet).slice();
    if (who === 'few') { on = on.slice(0, 2); off = []; }
    if (who === 'many') on = on.concat(MORE);
    if (who === 'twelve') on = on.concat(MORE.slice(0, 3));
    if (who === 'first') { off = ['priya', 'kofi', 'maya', 'sam', 'lena', 'diego'].map(function (id) { return assign(person(id), { on: false, invited: false, next: '', last: '' }); }); on = []; }
    if (who === 'failed' || who === 'offline' || who === 'loading') { on = []; off = []; }
    /* Sorted by who'd been asked when the page opened, so nobody jumps when you invite them. */
    off = off.filter(function (p) { return !p.invited; }).sort(function (a, b) { return (MEETS[b.id] || 0) - (MEETS[a.id] || 0); }).concat(off.filter(function (p) { return p.invited; }));
    return { on: on, off: off.map(function (p) { return assign(p, { invited: !!(p.invited || invited[p.id]), meetings: coming(p.id) }); }) };
  }

  /*
   * The line. You stand in the middle, whoever you met most recently beside you, one to each side, and the people not
   * on Alcove yet at the ends. Nine stand at full size. Up to thirteen, everyone gives up a little room and keeps a name.
   * Past that the front stays and the rest recede: smaller, nameless and hazier the further they stand, until they
   * reach the edge of the window. Nobody leaves the horizon, and nobody wraps to a second line.
   * `k` is a person's share of a place on the line, `px` how many places from you, `z` how far hover brings them forward.
   */
  var MOST = 34;
  function line(me, r) {
    var rest = r.on.concat(r.off.map(function (p) { return assign(p, { ghost: true }); }));
    var n = rest.length + 1, shown = rest.slice(0, MOST - 1);
    var kOf = function (d) {
      if (n <= 9) return 1;
      if (n <= 13) return 9.4 / n;
      return d <= 2 ? 0.84 : Math.max(0.2, 0.84 * Math.pow(0.8, d - 2));
    };
    var hazeOf = function (d) { return n <= 13 ? 0 : Math.max(0, Math.min(1, (d - 2) / 8)); };
    var make = function (p, d) {
      var k = kOf(d);
      return assign(p, { d: d, k: k, far: k < 0.6, haze: hazeOf(d), z: k < 0.6 ? 0.62 / k : 1 });
    };
    var left = [], right = [];
    shown.forEach(function (p, i) { (i % 2 ? left : right).push(make(p, Math.floor(i / 2) + 1)); });
    var at = function (side, sign) {
      var x = make(me, 0).k / 2;
      return side.map(function (p) { var c = x + p.k / 2; x += p.k; return assign(p, { px: sign * c }); });
    };
    var R = at(right, 1), L = at(left, -1);
    var sum = function (s) { return s.reduce(function (t, p) { return t + p.k; }, 0); };
    var you = assign(make(me, 0), { px: 0 });
    return { arches: L.reverse().concat([you], R), gap: sum(R) - sum(L), width: you.k + 2 * Math.max(sum(R), sum(L)), n: n, recedes: n > 13 };
  }

  /* The low sun: in the empty arch near where it sets if there is one, otherwise just past the end of the line, or behind whoever has receded far enough. */
  function sunOf(ln) {
    var left = ln.arches.filter(function (a) { return a.px < 0; });
    var near = function (a, b) { return Math.abs(a.px + 3) - Math.abs(b.px + 3); };
    var empty = left.filter(function (a) { return a.ghost && a.k > 0.6; }).sort(near)[0];
    if (empty && Math.abs(empty.px + 3) <= 1.1) return { x: empty.px, r: 0.27 * empty.k, inArch: empty.id };
    if (ln.recedes) { var far = left.filter(function (a) { return a.k <= 0.46; }).sort(function (a, b) { return b.px - a.px; })[0]; return { x: far ? far.px - 0.1 : -3, r: 0.4 }; }
    var end = left.length ? Math.min.apply(null, left.map(function (a) { return a.px; })) : 0;
    return { x: Math.min(-2.85, end - 0.86), r: 0.38 };
  }

  /* The scene, with the sun and its glitter following the line instead of a fixed spot. */
  function scene(s) {
    var move = function (style, from) {
      return style.replace(/left: (-?[\d.]+)px/, function (m, x) { return 'left: calc(var(--sun-x) + ' + (Number(x) - from).toFixed(1) + 'px)'; });
    };
    var topOf = function (style) { return Number((/top: (-?[\d.]+)px/.exec(style) || [0, 0])[1]); };
    var leftOf = function (style) { return Number((/left: (-?[\d.]+)px/.exec(style) || [0, 0])[1]); };
    return assign(s, {
      sunStyle: 'left: calc(var(--sun-x) - var(--sun-r)); top: calc(-1 * var(--sun-r)); width: calc(2 * var(--sun-r)); height: calc(2 * var(--sun-r))',
      glowStyle: move(s.glowStyle, -300),
      /* The water under the names stays clear, so nothing runs through them. */
      glints: s.glints.filter(function (g) { return topOf(g.style) > 36; }).map(function (g) { return assign(g, { style: move(g.style, -300) + '; --gy: ' + topOf(g.style) }); }),
      chop: s.chop.map(function (l) { return assign(l, { strokes: l.strokes.filter(function (k) { return topOf(k.style) > 36 || Math.abs(leftOf(k.style)) > 560; }) }); }),
      clouds: [
        { style: 'left: -640px; top: -158px; width: 360px; opacity: .42; --i: 0' },
        { style: 'left: 300px; top: -128px; width: 300px; opacity: .34; --i: 1' },
        { style: 'left: -560px; top: -112px; width: 220px; opacity: .3; --i: 2' }
      ]
    });
  }

  function groupsOf(who) {
    if (who === 'first') return [];
    if (who === 'few') return [{ id: 'g1', name: 'Leads', people: ['priya', 'kofi'], calls: 12 }];
    return D.groups.map(function (g) { return assign(g, { people: g.people.slice() }); });
  }

  /* Every share with a group in the notes you have, newest first. */
  var SHARED = [
    { note: 'n2', by: 'art', group: 'Product' }, { note: 'n4', by: 'kofi', group: 'Product' },
    { note: 'n7', by: 'priya', group: 'Leads' }, { note: 'n8', by: 'ines', group: 'Leads' }
  ];
  function sharedOf(who) {
    if (who === 'first') return [];
    return (who === 'few' ? SHARED.slice(2, 3) : SHARED).map(function (s) {
      var n = D.notes.filter(function (x) { return x.id === s.note; })[0];
      return { note: s.note, by: s.by, title: n.title, day: n.day.replace(/ \d+ Oct/, ''), line: (s.by === 'art' ? 'You' : person(s.by).first) + ' shared it with ' + s.group };
    });
  }
  function notesWith(id) {
    return D.notes.filter(function (n) { return n.faces.split(',').indexOf(id) >= 0; });
  }
  function names(ids) {
    var f = ids.map(function (id) { return person(id).first; });
    if (f.length > 3) return f.slice(0, 2).join(', ') + ' and ' + (f.length - 2) + ' others';
    return f.length > 1 ? f.slice(0, -1).join(', ') + ' and ' + f[f.length - 1] : (f[0] || '');
  }

  AH.TM = { me: ME, person: person, roster: roster, line: line, sunOf: sunOf, scene: scene, groupsOf: groupsOf, sharedOf: sharedOf, notesWith: notesWith, names: names };

  /* Where each journey frame starts. Prefixed, because AH.STEPS is shared at runtime. */
  var G1 = D.groups[0], G2 = D.groups[1];
  var withPeople = function (ids) { return [assign(G1, { people: ids }), G2]; };
  var DESIGN = { id: 'g3', name: 'Design', people: ['kofi', 'aiko'], calls: 0 };
  var FULL = ['priya', 'kofi', 'ines'];
  var LEADS_CALL = { who: FULL, title: 'Leads', group: true };
  var PRIYA_CALL = { who: ['priya'], title: 'Call with Priya', direct: true };
  var OPEN = { open: 'g1' };
  Object.assign(AH.STEPS, {
    tmFew: { who: 'few' }, tmTwelve: { who: 'twelve' }, tmMany: { who: 'many' }, tmFirst: { who: 'first' },
    tmFailed: { who: 'failed' }, tmOffline: { who: 'offline' }, tmLoading: { who: 'loading' }, tmGroupsFailed: { groupsFailed: true },
    tmFailedHot: { who: 'failed', hot: 'retry' },
    tmHotPerson: { hot: 'p-priya' },
    tmPerson: { pop: 'priya', hot: 'ring' },
    tmPersonQuiet: { pop: 'priya' },
    tmRinging: { page: 'lobby', lobbyTitle: 'Art’s call', lobbySub: 'Priya hears a ring when you join.' },
    tmStartHot: { pop: 'priya', hot: 'p-start' },
    tmCall: { call: PRIYA_CALL, hot: 'c-later' },
    tmCallWhen: { call: PRIYA_CALL, callStep: 'when', slot: 'm10', hot: 'c-next' },
    tmCallDetails: { call: PRIYA_CALL, callStep: 'details', slot: 'm10', hot: 'c-schedule' },
    tmScheduled: { toast: 'On your Google Calendar. Priya gets an invitation.', stay: true },
    tmNotesHot: { pop: 'priya', hot: 'notes' },
    tmNotes: { pop: 'priya', popView: 'notes', hot: 'note-0' },
    tmGhostHot: { hot: 'p-sam' },
    tmGhost: { pop: 'sam', hot: 'p-invite' },
    tmGhostInvited: { pop: 'sam', invited: { sam: true }, toast: 'Your email opens with an invitation to Sam.', stay: true },
    tmYouPop: { pop: 'art' },
    tmInvHot: { hot: 'invite' },
    tmInv: { inv: true, hot: 'pick-sam' },
    tmInvQuiet: { inv: true },
    tmInvPicked: { inv: true, invPick: ['sam', 'lena'], hot: 'inv-send' },
    tmInvSent: { invited: { sam: true, lena: true }, toast: 'Your email opens with an invitation to Sam and Lena.', stay: true },
    tmInvCopyHot: { inv: true, hot: 'inv-copy' },
    tmInvCopied: { toast: 'Invite link copied. It opens the page to sign in.', stay: true },
    tmRowHot: { hot: 'row-sam' },
    tmRowDone: { invited: { sam: true }, toast: 'Your email opens with an invitation to Sam.', stay: true },
    tmRemindHot: { hot: 'row-diego' },
    tmRemindDone: { toast: 'Your email opens with a reminder to Diego.', stay: true },
    tmAllInviteHot: { hot: 'inv-all' },
    tmAllInviteDone: { invited: { sam: true, lena: true }, toast: 'Your email opens with an invitation to Sam and Lena.', stay: true },
    tmNewHot: { hot: 'new' },
    tmFirstGroup: { who: 'first', making: true, draft: { name: 'Design', people: ['kofi', 'sam'] }, hot: 'create' },
    tmNaming: { making: true, draft: { name: '', people: [] } },
    tmNamed: { making: true, draft: { name: 'Design', people: [] }, hot: 'draft-add' },
    tmNameTaken: { making: true, draft: { name: 'Leads', people: [] }, nameError: 'You already have a group called Leads.' },
    tmPicking: { making: true, draft: { name: 'Design', people: [] }, picking: 'new', pick: ['kofi', 'aiko'], hot: 'pick-add' },
    tmFilled: { making: true, draft: { name: 'Design', people: ['kofi', 'aiko'] }, hot: 'create' },
    tmMade: { groups: [G1, G2, DESIGN], open: 'g3' },
    tmWaiting: { draft: { name: 'Design', people: ['kofi'] }, hot: 'draft-x' },
    tmGroupHot: { hot: 'g-g1' },
    tmGroup: OPEN,
    tmAddHot: { open: 'g1', hot: 'add' },
    tmAdd: { open: 'g1', picking: 'g1', pick: ['aiko'], hot: 'pick-add' },
    tmAdded: { open: 'g1', groups: withPeople(FULL.concat(['aiko'])), hot: 'x-kofi' },
    tmRemoved: { open: 'g1', groups: withPeople(['priya', 'ines', 'aiko']) },
    tmGroupCallHot: { hot: 'g-call-g1' },
    tmGroupCall: { call: LEADS_CALL, hot: 'c-now' },
    tmGroupLobby: { page: 'lobby', lobbyTitle: 'Art’s call', lobbySub: 'Priya, Kofi and Ines hear a ring when you join.' },
    tmRenameHot: { open: 'g1', hot: 'rename' },
    tmRenaming: { open: 'g1', renaming: 'g1', renameTo: 'Leadership' },
    tmRenameTaken: { open: 'g1', renaming: 'g1', renameTo: 'Product', nameError: 'You already have a group called Product.' },
    tmRenamed: { open: 'g1', groups: [assign(G1, { name: 'Leadership' }), G2] },
    tmDeleteHot: { open: 'g1', hot: 'delete' },
    tmDeleting: { open: 'g1', deleting: 'g1', hot: 'delete-yes' },
    tmDeleted: { groups: [G2], undo: { group: G1, at: 0 }, hot: 'undo' },
    tmAllHot: { who: 'many', hot: 'all' },
    tmAll: { who: 'many', all: true, hot: 'all-Tess Ward' },
    tmAllFound: { who: 'many', pop: 'Tess Ward' },
    tmFarHover: { who: 'many', forward: 'Tess Ward' }
  });

  /* The journeys, one row each. */
  AH.JOURNEYS_TEAM = [
    { name: 'Ring someone', frames: [
      { step: 'tmHotPerson', t: 'Click someone on the horizon.' },
      { step: 'tmPerson', t: 'A popover opens under their arch. Everything about them is here, not under every arch.' },
      { step: 'tmRinging', t: 'Ring goes straight to the join screen, and they hear a ring when you join.' }
    ] },
    { name: 'Schedule a call with someone', frames: [
      { step: 'tmStartHot', t: 'Click Schedule in their popover.' },
      { step: 'tmCallWhen', t: 'When? Only times you’re both free, with them already picked.' },
      { step: 'tmCallDetails', t: 'Check the details, then Schedule.' },
      { step: 'tmScheduled', t: 'Back on Team, and it’s on your calendar.' }
    ] },
    { name: 'The notes you both have', frames: [
      { step: 'tmNotesHot', t: 'Click Notes you both have.' },
      { step: 'tmNotes', t: 'The same popover lists them. Each one opens its note, and the last line opens them all in Notes.' }
    ] },
    { name: 'Someone not on Alcove yet', frames: [
      { step: 'tmGhostHot', t: 'An empty arch is someone not on Alcove yet. Click it.' },
      { step: 'tmGhost', t: 'The same popover, with Invite in place of Ring.' },
      { step: 'tmGhostInvited', t: 'Invite opens your own email. Now it offers Remind.' }
    ] },
    { name: 'Your own arch', frames: [
      { step: 'tmYouPop', t: 'You stand in the middle. Your popover has your address and Settings.' }
    ] },
    { name: 'Invite people', frames: [
      { step: 'tmInvHot', t: 'Click Invite people, the one filled button.' },
      { step: 'tmInv', t: 'A popover opens under it and takes the filled button. Pick people, or type a whole address.' },
      { step: 'tmInvPicked', t: 'Invite 2 opens your own email to both of them.' },
      { step: 'tmInvSent', t: 'They move to Invited, with Remind.' }
    ] },
    { name: 'Or copy the invite link', frames: [
      { step: 'tmInvCopyHot', t: 'Click Copy link in the same popover.' },
      { step: 'tmInvCopied', t: 'The popover closes, and the link to sign in is on your clipboard.' }
    ] },
    { name: 'Invite and Remind on a row', frames: [
      { step: 'tmRowHot', t: 'Invite sits in the same column on every row.' },
      { step: 'tmRowDone', t: 'Your email opens. The row says Invited, and the button says Remind.' },
      { step: 'tmRemindHot', t: 'Remind, for someone you’ve asked already.' },
      { step: 'tmRemindDone', t: 'Your email opens with a reminder.' }
    ] },
    { name: 'Invite everyone left', frames: [
      { step: 'tmAllInviteHot', t: 'Invite all asks everyone who hasn’t been asked.' },
      { step: 'tmAllInviteDone', t: 'One email to all of them. Every row moves to Remind.' }
    ] },
    { name: 'New group: name it, then fill it', frames: [
      { step: 'tmNewHot', t: 'Click New group.' },
      { step: 'tmNaming', t: 'The tile opens in place, ready for a name.' },
      { step: 'tmNamed', t: 'Enter opens the people picker. So does Add people.' },
      { step: 'tmPicking', t: 'Pick people, or type a whole address, then Add. Enter ticks and clears the line, and Enter again adds them.' },
      { step: 'tmFilled', t: 'They’re in. Create group takes the filled button.' },
      { step: 'tmMade', t: 'The group stays open, with everything you can do to it.' }
    ] },
    { name: 'A name that’s taken, and a group half made', frames: [
      { step: 'tmNameTaken', t: 'A name has to be new. It says so on the line.' },
      { step: 'tmWaiting', t: 'Leave a group half made and it waits on its tile. ✕ throws it away.' }
    ] },
    { name: 'Open a group in place', frames: [
      { step: 'tmGroupHot', t: 'Click a group’s tile. It says how many calls had all of them. The side panel’s groups do the same.' },
      { step: 'tmGroup', t: 'It opens right there, across the column, with everything you can do to it.' }
    ] },
    { name: 'Add and remove people', frames: [
      { step: 'tmAddHot', t: 'Click Add people.' },
      { step: 'tmAdd', t: 'The people picker opens under it.' },
      { step: 'tmAdded', t: 'They’re in the group. ✕ takes someone out.' },
      { step: 'tmRemoved', t: 'Gone from the group, at once. A group always keeps one person.' }
    ] },
    { name: 'Start a call with all of them', frames: [
      { step: 'tmGroupCallHot', t: 'Every tile has a call button, so you don’t have to open it first.' },
      { step: 'tmGroupCall', t: 'Start a call opens with the whole group picked.' },
      { step: 'tmGroupLobby', t: 'Start now rings them all when you join.' }
    ] },
    { name: 'Rename a group', frames: [
      { step: 'tmRenameHot', t: 'Click the pen.' },
      { step: 'tmRenaming', t: 'The name becomes a field where it is. Enter keeps it, Escape leaves it.' },
      { step: 'tmRenameTaken', t: 'A name has to be new, here too.' },
      { step: 'tmRenamed', t: 'Renamed. The side panel follows.' }
    ] },
    { name: 'Delete a group', frames: [
      { step: 'tmDeleteHot', t: 'Click the bin.' },
      { step: 'tmDeleting', t: 'It asks once, in a popover, and says what happens to shared notes.' },
      { step: 'tmDeleted', t: 'Gone, with Undo for a few seconds.' }
    ] },
    { name: 'Three people, and thirty', frames: [
      { step: 'tmFew', t: 'Three people: the line is short, and the sun has room beside it.' },
      { step: 'home', t: 'Nine: the most the line holds at full size.' },
      { step: 'tmTwelve', t: 'Twelve: everyone gives up a little room and keeps their name.' },
      { step: 'tmMany', t: 'Thirty-three: the people you see most stay close and named. Everyone else recedes into the haze, on the same line.' },
      { step: 'tmFarHover', t: 'Hover anyone far away and they step forward with their name. Clicking opens the same popover.' }
    ] },
    { name: 'Find one person out of thirty', frames: [
      { step: 'tmAllHot', t: 'Once the line recedes, this button appears.' },
      { step: 'tmAll', t: 'Everyone, in one list you can search.' },
      { step: 'tmAllFound', t: 'Pick someone. They step forward on the line, and the popover opens from their arch.' }
    ] },
    { name: 'Nobody else here yet', frames: [
      { step: 'tmFirst', t: 'You stand beside empty arches for the people you meet most, with the sun in one of them.' },
      { step: 'tmFirstGroup', t: 'A group opens in its own column here: the name and the tools on one line, the two buttons on the next.' }
    ] },
    { name: 'The team doesn’t load', frames: [
      { step: 'tmFailedHot', t: 'It says why, with Try again. Groups and notes load on their own, so they still work.' },
      { step: 'tmLoading', t: 'Trying again. Empty arches wait on the line.' },
      { step: 'home', t: 'Everyone comes up over the horizon.' }
    ] },
    { name: 'Offline, and groups that don’t load', frames: [
      { step: 'tmOffline', t: 'Offline, it says so, and comes back by itself.' },
      { step: 'tmGroupsFailed', t: 'If only your groups fail, their section says so. The rest of the page works.' }
    ] }
  ];
  AH.JOURNEYS_TEAM_PHONE = [
    { step: 'home', t: 'The line runs off both sides. Swipe along it.' },
    { step: 'tmPersonQuiet', t: 'Tap someone. The popover is a sheet.' },
    { step: 'tmInvQuiet', t: 'Invite people, as a sheet.' },
    { step: 'tmGroup', t: 'A group opens in place.' },
    { step: 'tmMany', t: 'Thirty-three. All 33 people finds anyone.' },
    { step: 'tmFirst', t: 'Nobody else here yet.' },
    { step: 'tmFailed', t: 'The team doesn’t load.' }
  ];
})();
