/*
 * The tour, renewed: the old tour's card, spotlight, arrow and art, pointed at Alcove as it is now. AH.TR holds the
 * stops (what each says and the real thing it points at), the card's placement (ported from TourDialog in
 * packages/ui/src/onboarding/guidance.tsx) and the journeys. Everyone is made up: you are Art Vandelay at Vandelay
 * Industries, on Wednesday 4 November.
 */
(function () {
  var AH = window.AH;

  /*
   * The stops for a day, in order. `hook` is the data-tour hook of what the stop points at (the first one on screen), and
   * `prefer` the sides the card tries first. A stop whose hook isn't on screen is left out, as the app does: on a phone,
   * Agents opens from Settings, so its stop goes. `called` names a stop on the button before it ("Show me search").
   *   o.day   first (a new account), today (any later day, the tour taken again from Settings) or soon (a call about to start)
   *   o.keys  a keyboard is there, so shortcuts are worth saying
   */
  function stops(o) {
    var keys = !!o.keys, first = o.day === 'first';
    var list = [];
    list.push({
      id: 'start', tag: 'New art', where: 'Start now and Schedule, on Home’s sky', art: 'start', title: 'Start or schedule a call', hook: 'start', prefer: ['below', 'right', 'left'], called: 'where to start',
      was: 'Kept, with new art: scheduling is now a week with the free times lit, not questions one at a time.',
      text: 'Start now goes straight to the call. Schedule suggests times that suit everyone and sends the invites.' + (keys ? ' N starts one from any page.' : '')
    });
    if (o.day === 'soon') {
      list.push({
        id: 'join', tag: 'Kept', where: 'The line with Join, while a call is about to start', art: 'call', title: 'Join a call', hook: 'join', prefer: ['below', 'right', 'left'], called: 'the call',
        was: 'Kept, for a call about to start. The call now has chat and boards as well as captions.',
        text: 'Design sync starts in 4 minutes. Join from here' + (keys ? ', or press J' : '') + '. Captions, chat and boards are in the call.'
      });
    }
    list.push(first
      ? {
        id: 'notes', tag: 'Updated', where: 'The example note in Recent notes', art: 'notes', title: 'Notes for your calls', hook: 'example', prefer: ['right', 'above', 'left'], called: 'notes',
        was: 'Kept. Before your first notes it points at the example in Recent notes, and the privacy stop folds in here.',
        text: 'Open the example to see what a call leaves you: a summary, decisions and follow-ups, written in confidential compute.'
      }
      : {
        id: 'notes', tag: 'Updated', where: 'Calls, in the side panel', art: 'notes', title: 'Notes for your calls', hook: 'calls', prefer: ['right', 'below', 'above'], called: 'notes',
        was: 'Points at Calls, which took over from Notes. The privacy stop folds in here.',
        text: 'Every call’s notes are in Calls: a summary, decisions and follow-ups, written in confidential compute.'
      });
    list.push({
      id: 'ask', tag: 'New', where: 'Search or ask, at the top right', art: 'ask', title: 'Search or ask', hook: 'ask', prefer: ['below', 'left'], called: 'search',
      was: 'New: Search or ask, at the top right of every page.',
      text: 'Find what anyone said in any call, or ask a question and get an answer with the moments it came from.' + (keys ? ' Press ⌘K.' : '')
    });
    list.push({
      id: 'drive', tag: 'New', where: 'Drive, in the side panel', art: 'drive', title: 'Documents and boards', hook: 'drive', prefer: ['right', 'above', 'below'], called: 'the Drive',
      was: 'New: the Drive, and the documents and boards made in calls.',
      text: 'Write and sketch together in a call. Each call keeps what it made, and the Drive keeps it all.'
    });
    list.push({
      id: 'record', tag: 'Kept', where: 'Record, in the side panel', art: 'room', title: 'Record in the room', hook: 'record', prefer: ['right', 'above', 'below'], called: 'recording',
      was: 'Kept as it was: Record, in the side panel or the middle of the tab bar.',
      text: 'Meeting in person? Record on your phone, even offline. Notes are written when you’re back online.'
    });
    list.push({
      id: 'agents', tag: 'New', where: 'Agents, at the side panel’s foot', art: 'agents', title: 'Bring your agent', hook: 'agents', prefer: ['right', 'above'], called: 'agents',
      was: 'New: Agents, at the foot of the side panel. Not on a phone, where it opens from Settings.',
      text: 'Let Claude or another agent find notes and book calls for you, with only what you allow.'
    });
    list.push({
      id: 'ready', tag: 'Kept', where: 'Start now and Schedule, again', art: 'sun', title: 'You’re ready', hook: 'start', prefer: ['below', 'right', 'left'], called: 'where to start', lead: 'Back to the start',
      was: 'Kept as it was, back on Start now.',
      text: 'Start a call now, or schedule one for later.'
    });
    return list;
  }

  /* What the old tour had, for the board that sets them side by side. */
  var OLD = [
    { title: 'Start or schedule a call', at: 'Start a call, in the side panel', note: 'Its art asked who, when and notes one at a time; scheduling moved to the week on Calls.' },
    { title: 'Notes for your calls', at: 'the example note, then Notes', note: 'Notes is Calls now.' },
    { title: 'Join a call', at: 'Join, on Home', note: 'Still right; the call has grown.' },
    { title: 'Record in the room', at: 'Record', note: 'Still right.' },
    { title: 'Your notes stay yours', at: 'the check at the foot of the side panel', note: '“Alcove encrypts stored notes”, where the app now says confidential compute.' },
    { title: 'You’re ready', at: 'Start a call', note: 'Still right.' }
  ];

  /* ------------------------------------------------------------------ placement, as TourDialog does it */
  var EDGE = 16, GAP = 58, SHEET = 640;
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };

  /* Where the card goes: the first preferred side it fits on, else the side with the most room. */
  function place(t, cw, ch, prefer, vw, vh) {
    var cx = t.x + t.w / 2, cy = t.y + t.h / 2;
    var at = {
      below: { x: clamp(cx - cw / 2, EDGE, vw - cw - EDGE), y: t.y + t.h + GAP },
      above: { x: clamp(cx - cw / 2, EDGE, vw - cw - EDGE), y: t.y - GAP - ch },
      right: { x: t.x + t.w + GAP, y: clamp(cy - ch / 2, EDGE, vh - ch - EDGE) },
      left: { x: t.x - GAP - cw, y: clamp(cy - ch / 2, EDGE, vh - ch - EDGE) }
    };
    var all = ['below', 'above', 'right', 'left'];
    var order = prefer.concat(all.filter(function (s) { return prefer.indexOf(s) < 0; }));
    for (var i = 0; i < order.length; i++) {
      var p = at[order[i]];
      if (p.x >= EDGE && p.y >= EDGE && p.x + cw <= vw - EDGE && p.y + ch <= vh - EDGE) return { side: order[i], x: p.x, y: p.y };
    }
    var room = { below: vh - (t.y + t.h), above: t.y, right: vw - (t.x + t.w), left: t.x };
    var best = order.slice().sort(function (a, b) { return room[b] - room[a]; })[0] || 'below';
    return { side: best, x: clamp(at[best].x, EDGE, vw - cw - EDGE), y: clamp(at[best].y, EDGE, vh - ch - EDGE) };
  }

  /* A curved arrow from the card's edge to the target's, or null when they nearly touch. */
  function arrowFor(side, c, t) {
    var cx = t.x + t.w / 2, s, e;
    if (side === 'below' || side === 'sheet') { s = { x: clamp(cx, c.x + 44, c.x + c.w - 44), y: c.y - 10 }; e = { x: clamp(s.x, t.x + 18, t.x + t.w - 18), y: t.y + t.h + 9 }; }
    else if (side === 'above') { s = { x: clamp(cx, c.x + 44, c.x + c.w - 44), y: c.y + c.h + 10 }; e = { x: clamp(s.x, t.x + 18, t.x + t.w - 18), y: t.y - 9 }; }
    else if (side === 'right') { s = { x: c.x - 10, y: clamp(t.y + t.h / 2, c.y + 44, c.y + c.h - 44) }; e = { x: t.x + t.w + 9, y: clamp(s.y, t.y + 12, t.y + t.h - 12) }; }
    else { s = { x: c.x + c.w + 10, y: clamp(t.y + t.h / 2, c.y + 44, c.y + c.h - 44) }; e = { x: t.x - 9, y: clamp(s.y, t.y + 12, t.y + t.h - 12) }; }
    var dx = e.x - s.x, dy = e.y - s.y, len = Math.hypot(dx, dy);
    if (len < 24) return null;
    var bend = Math.min(34, len * 0.26);
    var sign = side === 'right' || side === 'below' || side === 'sheet' ? 1 : -1;
    var q = { x: s.x + dx / 2 + (-dy / len) * bend * sign, y: s.y + dy / 2 + (dx / len) * bend * sign };
    var tl = Math.hypot(e.x - q.x, e.y - q.y) || 1, tx = (e.x - q.x) / tl, ty = (e.y - q.y) / tl, L = 9;
    var wing = function (a) { return { x: e.x - L * (tx * Math.cos(a) - ty * Math.sin(a)), y: e.y - L * (ty * Math.cos(a) + tx * Math.sin(a)) }; };
    var h1 = wing(0.5), h2 = wing(-0.5), f = function (n) { return n.toFixed(1); };
    return {
      line: 'M' + f(s.x) + ' ' + f(s.y) + 'Q' + f(q.x) + ' ' + f(q.y) + ' ' + f(e.x) + ' ' + f(e.y),
      head: 'M' + f(h1.x) + ' ' + f(h1.y) + 'L' + f(e.x) + ' ' + f(e.y) + 'L' + f(h2.x) + ' ' + f(h2.y)
    };
  }

  /* The first element with this hook inside `root` that's laid out. */
  function find(root, hook) {
    var all = root.querySelectorAll('[data-tour="' + hook + '"]');
    for (var i = 0; i < all.length; i++) if (all[i].getClientRects().length && all[i].offsetWidth > 0) return all[i];
    return null;
  }

  /* The nearest ancestor of `el` (inside `root`) that scrolls, or null when the element stays put. */
  function scroller(el, root) {
    for (var n = el.parentElement; n && n !== root; n = n.parentElement) {
      var oy = getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) return n;
    }
    return null;
  }

  /*
   * Everything the overlay needs for one stop: the spot (the cut-out, padded), the card's place and side, the arrow, and
   * how far the page scrolls first. Measured in the board's own pixels, so a journey frame drawn at half size measures
   * the same.
   */
  function layout(root, card, stop) {
    var el = find(root, stop.hook);
    if (!el || !card) return null;
    var vw = root.offsetWidth, vh = root.offsetHeight;
    var rr = root.getBoundingClientRect(), k = rr.width / vw || 1;
    var r = el.getBoundingClientRect();
    var box = { x: (r.left - rr.left) / k, y: (r.top - rr.top) / k, w: r.width / k, h: r.height / k };
    var sheet = vw < SHEET;
    var cw = card.offsetWidth, ch = card.offsetHeight;
    var sc = scroller(el, root);
    var dy = 0;
    if (sc) {
      var top = sheet ? 88 : 96, bottom = sheet ? vh - ch - 70 : vh - 40;
      if (box.y < top || box.y + box.h > bottom) {
        var room = Math.max(0, sc.scrollHeight - sc.clientHeight);
        var want = sheet ? box.y - Math.max(top, (bottom - box.h) * 0.55) : box.y - vh * 0.3;
        dy = Math.round(clamp(want, -sc.scrollTop, room - sc.scrollTop));
      }
    }
    var pad = box.h < 34 ? 7 : 8;
    if (!sc) pad = clamp(box.y - 7, 3, pad);
    var radius = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 10, 30);
    var t = { x: box.x - pad, y: box.y - pad - dy, w: box.w + pad * 2, h: box.h + pad * 2, r: radius + pad };
    var lifted = sheet && t.y + t.h > vh - ch;
    var p;
    if (lifted) p = { side: 'above', x: 0, y: Math.max(EDGE, t.y - ch - GAP) };
    else if (sheet) p = { side: 'sheet', x: 0, y: vh - ch };
    else {
      p = place(t, cw, ch, stop.prefer, vw, vh);
      if (sc && p.side !== 'right' && p.side !== 'left' && (p.y < EDGE || p.y + ch > vh - EDGE)) p.y = clamp(p.y, EDGE, vh - ch - EDGE);
    }
    var a = arrowFor(p.side, { x: p.x, y: p.y, w: cw, h: ch }, t);
    return { spot: t, card: { x: p.x, y: p.y }, side: p.side, sheet: sheet, lifted: lifted, arrow: a, vw: vw, vh: vh, dy: dy, scroller: sc };
  }

  /* ------------------------------------------------------------------ the journeys */
  /* Each frame is the first run (Main) at one moment: `begin` arrival (with `at`, seconds in), tour (with `stop`) or home. */
  var JOURNEYS = [
    { name: 'A new account, from sign-in to Home', frames: [
      { begin: 'arrival', at: '2.3', t: 'Signed in with Google for the first time. The arch draws itself and fills with dawn, while what came with the account arrives a row at a time.' },
      { begin: 'arrival', at: '3.7', t: 'Every row is ticked. “You’re in, Art”, and Home is ready behind the night.' },
      { begin: 'arrival', at: '4.75', t: 'The arch opens into Home: it grows past the edges of the window. Skip, Escape or Enter opens it at once.' },
      { begin: 'tour', stop: '0', t: 'Home settles in, and the tour starts at the page’s one job: Start now and Schedule, on the sky.' }
    ] },
    { name: 'The tour, stop by stop (a new account)', frames: [
      { begin: 'tour', stop: '1', t: 'Show me notes. The card glides to the example note in Recent notes, and the page scrolls to it.' },
      { begin: 'tour', stop: '2', t: 'Show me search. Search or ask, at the top right of every page.' },
      { begin: 'tour', stop: '3', t: 'Show me the Drive. The card moves beside the side panel’s Drive.' },
      { begin: 'tour', stop: '4', t: 'Show me recording. Record, two places down.' },
      { begin: 'tour', stop: '5', t: 'Show me agents. Agents, at the panel’s foot with Team.' },
      { begin: 'tour', stop: '6', t: 'Show me where to start. Back on Start now, as the sun comes up. Start using Alcove closes it.' }
    ] },
    { name: 'Skip it, then take it again', frames: [
      { begin: 'tour', stop: '2', t: 'Press Skip tour, or Escape, on any stop.' },
      { begin: 'home', toast: 'skip', t: 'The tour fades. A toast says it can be taken again from Settings, and it isn’t shown again on this browser.' },
      { settings: true, t: 'Settings: Take the tour sits beside your name, at the top of the page.' },
      { begin: 'tour', stop: '0', day: 'today', t: 'The tour plays again over Home, as it is that day.' },
      { begin: 'tour', stop: '1', day: 'today', t: 'Once there are notes, Notes for your calls points at Calls in the side panel.' }
    ] },
    { name: 'A call about to start', frames: [
      { begin: 'tour', stop: '0', day: 'soon', t: 'Design sync starts in 4 minutes, so Home’s line offers Join, and Start now gives up its fill.' },
      { begin: 'tour', stop: '1', day: 'soon', t: 'Show me how to join. One more stop, at the line with Join (or J).' },
      { begin: 'tour', stop: '2', day: 'soon', t: 'Then the tour goes on as before: Notes for your calls.' }
    ] }
  ];
  var PHONE = { name: 'On a phone', phone: true, frames: [
    { begin: 'tour', stop: '0', t: 'The card is a sheet along the bottom, pointing up at Start now.' },
    { begin: 'tour', stop: '1', t: 'The example note, scrolled into view above the sheet.' },
    { begin: 'tour', stop: '2', t: 'Search, in the top bar.' },
    { begin: 'tour', stop: '3', t: 'A target along the bottom: the card stands above the tab bar and points down at Drive.' },
    { begin: 'tour', stop: '4', t: 'Record, raised in the middle of the tab bar.' },
    { begin: 'tour', stop: '5', t: 'No Agents stop: on a phone it opens from Settings. You’re ready closes the tour.' }
  ] };

  AH.TR = { stops: stops, OLD: OLD, place: place, arrowFor: arrowFor, find: find, layout: layout, JOURNEYS: JOURNEYS, PHONE: PHONE, SHEET: SHEET };
})();
