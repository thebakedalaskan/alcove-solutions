/*
 * Search, rethought. One search over everything you have: the people in it, what each of them said and when, what was
 * decided and to do, and the notes. The window (Search.dc.html) draws what `view()` returns.
 *
 * It runs over the same made-up world as every other board (appdata.js, data-notes.js, data-note.js), so whatever you
 * type finds something real. Team standup is written out in full; the other calls have their best lines.
 */
(function () {
  var AH = window.AH, D = AH.D, NT = AH.NT;

  Object.assign(AH.I, {
    enter: 'M9 10l-5 5 5 5M20 4v7a4 4 0 0 1-4 4H4',
    mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3',
    wifiOff: 'M12 20h.01M8.5 16.429a5 5 0 0 1 7 0M5 12.859a10 10 0 0 1 5.17-2.69M19 12.859a10 10 0 0 0-2.007-1.523M2 8.82a15 15 0 0 1 4.177-2.643M22 8.82a15 15 0 0 0-11.288-3.764M2 2l20 20',
    retry: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5',
    chev: 'M6 9l6 6 6-6',
    alert: 'M21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01',
    play: 'M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z'
  });

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function secs(t) {
    if (typeof t === 'number') return t;
    var p = String(t).split(':').map(Number);
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
  }
  /* Times read 6:12, as the app writes them. */
  function clock(s) { var m = Math.floor(s / 60), r = s % 60; return m >= 60 ? Math.floor(m / 60) + ':' + pad(m % 60) + ':' + pad(r) : m + ':' + pad(r); }

  /* ------------------------------------------------------------------ who's who */
  var PEOPLE = {};
  D.people.forEach(function (p) { PEOPLE[p.id] = { id: p.id, name: p.name, first: p.first, title: p.title }; });
  Object.keys(NT.names || {}).forEach(function (id) { var n = NT.names[id]; PEOPLE[id] = { id: id, name: n, first: n.split(' ')[0], title: '' }; });
  PEOPLE.art = { id: 'art', name: 'Art Vandelay', first: 'You', title: '', me: true };
  function first(id) { return (PEOPLE[id] && PEOPLE[id].first) || id; }
  function nameWords(id) { var p = PEOPLE[id]; return p ? p.name.toLowerCase().split(' ') : []; }
  /* A word names someone when it starts one of their names: "may" finds Maya. */
  function names(id, t) { return t.length >= 2 && nameWords(id).some(function (w) { return w.indexOf(t) === 0; }); }

  /* ------------------------------------------------------------------ every note, newest first, with what was said */
  var ORDER = NT.order;
  var NOTE = {};
  NT.notes.forEach(function (n) { NOTE[n.id] = n; });
  function linesOf(id) {
    var full = AH.NOTE && AH.NOTE[id];
    if (full && full.lines) return full.lines.map(function (l) { return { id: l.id, at: l.at, who: l.who, name: first(l.who), text: l.text }; });
    var d = NT.detail[id];
    return d ? d.said.map(function (l, i) { return { id: id + '-' + i, at: secs(l.at), who: l.who || '', name: l.who ? first(l.who) : l.name, text: l.t }; }) : [];
  }
  var IDX = {};
  ORDER.forEach(function (id) {
    var n = NOTE[id], d = NT.detail[id] || {};
    /* What a moment became: the decision or follow-up made there, said where it was said. */
    var tags = {};
    (d.decisions || []).forEach(function (x) { tags[secs(x.at)] = { kind: 'decide', id: x.id, t: x.t, state: x.state, by: x.by || '' }; });
    (d.follow || []).forEach(function (x) { if (!tags[secs(x.at)]) tags[secs(x.at)] = { kind: 'follow', id: x.id, t: x.t, due: x.due || '', owner: x.owner || 'art', done: !!x.done }; });
    var who = (n.faces || '').split(',').filter(Boolean);
    IDX[id] = { id: id, n: n, d: d, lines: linesOf(id), tags: tags, who: who, text: (n.title + ' ' + (d.long || n.summary || '')).toLowerCase() };
  });
  var COUNT = ORDER.length;

  /* Every line of a call becomes a step on the note's own board, so opening any moment of Team standup lands on it. */
  if (AH.NOTE_STEPS && IDX.n2) IDX.n2.lines.forEach(function (l) { AH.NOTE_STEPS['sr-' + l.id] = { pos: l.at, line: l.id, full: true, to: l.id }; });

  /* ------------------------------------------------------------------ reading what was typed (as searchOf does in the app) */
  var SMALL = {};
  ('a an and are about all at be been but by can could did do does for from get got had has have how i if in into is it its just like me more my not of on or our out over '
    + 'said say she should so some than that the their them then there these they this those to too up us was we were what when where which who why will with would you your').split(' ').forEach(function (w) { SMALL[w] = 1; });
  var ASKS = /^(what|who|whom|whose|when|where|why|how|did|do|does|is|are|was|were|can|could|should|which|has|have|catch|draft|summarise|summarize)\b/i;
  function read(text) {
    var typed = String(text || '').trim();
    var question = /\?$/.test(typed) || ASKS.test(typed);
    var words = [];
    typed.toLowerCase().replace(/[?!.,;:"“”()]/g, ' ').split(/\s+/).forEach(function (w) { if (w && words.indexOf(w) < 0) words.push(w); });
    return { typed: typed, question: question, terms: question ? words.filter(function (w) { return w.length > 2 && !SMALL[w]; }) : words };
  }

  /* What a line has of a search: each word in its words, or starting the name of who said it. */
  function hits(l, terms) {
    var low = l.text.toLowerCase(), n = 0;
    terms.forEach(function (t) { if (low.indexOf(t) >= 0 || (l.who && names(l.who, t))) n++; });
    return n;
  }

  /* The words marked where they were found, as runs of text. */
  function parts(text, terms) {
    var low = text.toLowerCase(), on = [];
    terms.forEach(function (t) {
      if (t.length < 2) return;
      var i = low.indexOf(t);
      while (i >= 0) {
        /* Mark to the end of the word, so "ship" marks all of "ships". */
        var end = i + t.length;
        while (end < low.length && /[a-z0-9]/.test(low.charAt(end))) end++;
        for (var k = i; k < end; k++) on[k] = true;
        i = low.indexOf(t, end);
      }
    });
    var out = [], cur = null;
    for (var j = 0; j < text.length; j++) {
      var h = !!on[j];
      if (!cur || cur.h !== h) { cur = { h: h, t: '' }; out.push(cur); }
      cur.t += text.charAt(j);
    }
    return out.map(function (p) { return { t: p.t, c: p.h ? 'sr-hl' : '' }; });
  }
  /* A long line starts a little before its first match, so the match is never cut off. */
  function snippet(text, terms) {
    var low = text.toLowerCase(), at = -1;
    terms.forEach(function (t) { var i = low.indexOf(t); if (t.length > 1 && i >= 0 && (at < 0 || i < at)) at = i; });
    if (at > 64) { var from = text.lastIndexOf(' ', at - 28); return '…' + text.slice(from + 1); }
    return text;
  }

  function personOf(id) {
    var calls = ORDER.filter(function (n) { return IDX[n].who.indexOf(id) >= 0 || IDX[n].lines.some(function (l) { return l.who === id; }); });
    var last = calls[0] ? IDX[calls[0]].n.day : '';
    return { id: id, name: PEOPLE[id].name, first: PEOPLE[id].first, title: PEOPLE[id].title, calls: calls.length, callsLabel: calls.length === 1 ? '1 call' : calls.length + ' calls', last: last, ids: calls };
  }

  /* ------------------------------------------------------------------ the search itself */
  function find(q, who) {
    var r = read(q), terms = r.terms, any = r.question;
    var people = (!who && !r.question && terms.length && terms.length <= 2) ? Object.keys(PEOPLE).filter(function (id) {
      return !PEOPLE[id].me && terms.every(function (t) { return names(id, t); });
    }).map(personOf).filter(function (p) { return p.calls > 0; }) : [];
    var calls = [], notes = [], total = 0;
    ORDER.forEach(function (id) {
      var x = IDX[id];
      var found = x.lines.map(function (l) {
        if (who && l.who !== who) return null;
        if (!terms.length) return who ? { l: l, n: 1 } : null;
        var n = hits(l, terms);
        return (any ? n > 0 : n === terms.length) ? { l: l, n: n } : null;
      }).filter(Boolean);
      if (any) found.sort(function (a, b) { return b.n - a.n || a.l.at - b.l.at; });
      if (found.length) { calls.push({ id: id, x: x, lines: found.map(function (f) { return f.l; }) }); total += found.length; return; }
      if (!who && terms.length && terms.every(function (t) { return x.text.indexOf(t) >= 0; })) notes.push(id);
    });
    return { r: r, terms: terms, people: people, calls: calls, notes: notes, total: total };
  }

  /* An answer from every note, as data-notes.js writes them, with each cited moment found in its call. */
  function answerFor(q) {
    var a = NT.answers.filter(function (x) { return x.match.test(q); })[0];
    if (!a) return null;
    return {
      text: a.text,
      calls: a.cites.map(function (c) {
        var x = IDX[c.note];
        if (!x) return null;
        var lines = c.at.map(function (t) { var s = secs(t); return x.lines.filter(function (l) { return l.at === s; })[0]; }).filter(Boolean);
        return lines.length ? { id: c.note, x: x, lines: lines } : null;
      }).filter(Boolean)
    };
  }

  /* The lines around a moment, for the preview: two before, the moment, two after. */
  function around(id, at, terms) {
    var x = IDX[id], i = 0;
    x.lines.forEach(function (l, j) { if (l.at === at) i = j; });
    /* One line before it and three after: what led to it, and what came of it. */
    var from = Math.max(0, Math.min(i - 1, x.lines.length - 5));
    return x.lines.slice(from, from + 5).map(function (l) {
      return { key: l.id, at: clock(l.at), name: l.name, face: l.who || l.name.toLowerCase(), parts: parts(l.text, terms), cls: l.at === at ? ' is-on' : '' };
    });
  }

  function noteMeta(x) {
    var n = x.n;
    var bits = [n.day];
    if (n.kind === 'shared' && n.sharedBy) bits.push('Shared by ' + n.sharedBy);
    else if (n.kind === 'room') bits.push('In the room');
    return bits.join(' · ');
  }
  function noteFace(x) { return x.who[0] || ''; }

  function tagOf(t) {
    if (!t) return null;
    if (t.kind === 'decide') {
      var waiting = t.state === 'proposed';
      return { kind: 'decide', word: 'Decision', icon: AH.I.decide, cls: 'is-decide', t: t.t, state: waiting ? 'Waiting for you to confirm' : 'Confirmed by ' + (t.by === 'you' ? 'you' : t.by), waiting: waiting };
    }
    var mine = t.owner === 'art';
    return { kind: 'follow', word: 'Follow-up', icon: AH.I.own, cls: 'is-follow', t: t.t, state: t.done ? 'Done' : (mine ? 'Yours' : first(t.owner) + '’s') + (t.due ? ', due ' + t.due : ''), waiting: false, done: t.done };
  }

  /* ------------------------------------------------------------------ what the window shows, for a state */
  /*
   * st: { q, who, mode ('', 'asking', 'answer'), askQ, act, actKey, more, first, failed, offline, hot }
   * api: { set(patch), ask(), openAt(noteId, at), seeAll(), close() }
   */
  function view(st, api) {
    var r = read(st.q), typed = r.typed, who = st.who || '';
    var letters = typed.replace(/\s/g, '').length;
    var searching = !!who || letters >= 2;
    var rows = [], sel = [];
    var hot = function (k) { return st.hot === k ? ' is-hot' : ''; };
    function add(row) {
      row.key = row.key || 'k' + rows.length;
      if (row.sel) { row.i = sel.length; sel.push(row); }
      rows.push(row);
      return row;
    }
    function label(text, count) { add({ isLabel: true, text: text, count: count || '', hasCount: !!count }); }
    function noteRow(id, key) {
      var x = IDX[id];
      return add({
        sel: true, isNote: true, kind: 'note', key: key || 'note-' + id, id: id, title: x.n.title, meta: noteMeta(x), face: noteFace(x), room: x.n.kind === 'room',
        go: function () { api.openAt(id, 0); }
      });
    }
    var hidden = 0;
    function momentRows(c, terms, limit, prefix) {
      var x = c.x, open = st.more && st.more[c.id];
      var shown = open ? c.lines : c.lines.slice(0, limit);
      hidden += c.lines.length - shown.length;
      add({ isHead: true, key: 'head-' + c.id, title: x.n.title, meta: x.n.day, face: noteFace(x), room: x.n.kind === 'room' });
      shown.forEach(function (l) {
        var tag = tagOf(x.tags[l.at]);
        add({
          sel: true, isMoment: true, kind: 'moment', key: (prefix || 'm') + '-' + c.id + '-' + l.id, id: c.id, at: l.at, atLabel: clock(l.at),
          name: l.name, face: l.who || l.name.toLowerCase(), nameParts: parts(l.name, terms), parts: parts(snippet(l.text, terms), terms),
          tag: tag || {}, hasTag: !!tag, terms: terms,
          go: function () { api.openAt(c.id, l.at); }
        });
      });
      if (!open && c.lines.length > limit) {
        var more = c.lines.length - limit;
        add({
          sel: true, isMore: true, kind: 'more', key: 'more-' + c.id, id: c.id, text: more + ' more in ' + x.n.title,
          go: function () { var m = AH.assign({}, st.more); m[c.id] = true; api.set({ more: m }); }
        });
      }
    }

    var state = 'results', answer = null, f = null;
    if (st.first) {
      state = 'first';
    } else if (st.mode === 'asking' || st.mode === 'answer') {
      state = st.mode;
      add({ isBack: true, key: 'back', go: function () { api.set({ mode: '', act: null, actKey: null }); } });
      if (st.mode === 'asking') add({ isReading: true, key: 'reading' });
      else {
        answer = answerFor(st.askQ || typed);
        if (answer) {
          add({ isAnswer: true, key: 'answer', text: answer.text });
          var n = answer.calls.reduce(function (s, c) { return s + c.lines.length; }, 0);
          label('From your notes', n + (n === 1 ? ' moment' : ' moments'));
          var aterms = read(st.askQ || typed).terms;
          answer.calls.forEach(function (c) { momentRows({ id: c.id, x: c.x, lines: c.lines }, aterms, 9, 'c'); });
        } else {
          add({ isAnswer: true, key: 'answer', text: 'None of your notes say. The answer reads every note you have, all ' + COUNT + ' of them.' });
        }
      }
    } else if (st.offline) {
      state = 'offline';
    } else if (st.failed) {
      state = 'failed';
      add({ sel: true, isAsk: true, kind: 'ask', key: 'ask', text: typed, go: api.ask });
    } else if (!searching) {
      state = 'idle';
      add({ isPeople: true, key: 'people', label: 'People', people: ['maya', 'priya', 'kofi', 'aiko', 'lena'].map(function (id) {
        return { id: id, first: first(id), cls: hot('pick-' + id), go: function () { api.set({ who: id, q: '', act: null, actKey: null, more: {} }); } };
      }) });
      label('Recent notes');
      ORDER.slice(0, 5).forEach(function (id) { noteRow(id, 'recent-' + id); });
    } else {
      f = find(st.q, who);
      if (typed) add({ sel: true, isAsk: true, kind: 'ask', key: 'ask', text: typed, go: api.ask });
      if (f.people.length) {
        label('People');
        f.people.forEach(function (p) {
          add({
            sel: true, isPerson: true, kind: 'person', key: 'person-' + p.id, p: p, id: p.id, name: p.name, nameParts: parts(p.name, f.terms), meta: [p.title, p.callsLabel].filter(Boolean).join(' · '),
            go: function () { api.set({ who: p.id, q: '', act: null, actKey: null, more: {} }); }
          });
        });
      }
      if (f.calls.length) {
        var callWord = f.calls.length === 1 ? '1 call' : f.calls.length + ' calls';
        label(who && !typed ? 'What ' + first(who) + ' said' : r.question ? 'Moments with these words' : 'What was said', f.total + (f.total === 1 ? ' moment in ' : ' moments in ') + callWord);
        /* Up to three moments of the first call and two of the others, so a few calls show at once. */
        f.calls.forEach(function (c, i) { momentRows(c, f.terms, f.calls.length > 2 && i > 0 ? 2 : 3); });
      }
      if (f.notes.length) {
        label('Notes', f.notes.length > 1 ? f.notes.length + ' notes' : '');
        f.notes.forEach(function (id) { noteRow(id); });
      }
      if (f.calls.length || f.notes.length) {
        var all = f.total + f.notes.length;
        add({ sel: true, isAll: true, kind: 'all', key: 'all', text: hidden ? 'See all ' + f.total + ' moments in Notes' : 'Open ' + (all === 1 ? 'it' : 'these') + ' in Notes', go: api.seeAll });
      }
      if (!f.calls.length && !f.notes.length && !f.people.length) state = 'none';
    }

    /* Which row is lit. A question lights Ask; anything else lights the first thing found. */
    var act;
    if (st.actKey) sel.forEach(function (s) { if (s.key === st.actKey) act = s.i; });
    if (act === undefined && typeof st.act === 'number') act = st.act;
    if (act === undefined) {
      var firstFound = sel.filter(function (s) { return s.kind !== 'ask'; })[0];
      act = r.question || !firstFound ? 0 : firstFound.i;
    }
    act = Math.max(0, Math.min(act, sel.length - 1));
    var on = sel[act] || null;
    rows.forEach(function (row) {
      row.on = !!(on && row === on);
      row.cls = (row.on ? ' is-on' : '') + hot(row.key) + (row.hasTag ? ' has-tag' : '');
      if (row.sel) row.hover = function () { if (!row.on) api.set({ act: row.i, actKey: null }); };
    });

    return {
      state: state, rows: rows, sel: sel, act: act, on: on, typed: typed, question: r.question, who: who,
      whoName: who ? PEOPLE[who].name : '', whoFirst: who ? first(who) : '',
      preview: preview(on, st, api, f, r),
      askLit: !!(on && on.kind === 'ask') || state === 'asking' || state === 'answer',
      empty: state === 'none' || state === 'first' || state === 'failed' || state === 'offline'
    };
  }

  /* ------------------------------------------------------------------ the preview beside the list */
  function preview(on, st, api, f, r) {
    var hot = function (k) { return st.hot === k ? ' is-hot' : ''; };
    if (!on) return { none: true };
    var pv = { kind: on.kind, isMoment: false, isPerson: false, isNote: false, isAsk: false, isAll: false };
    if (on.kind === 'moment') {
      var x = IDX[on.id];
      pv.isMoment = true;
      pv.title = x.n.title;
      pv.meta = (x.d.at || x.n.day) + (x.n.length ? ' · ' + x.n.length : '');
      pv.faces = x.who.join(',');
      pv.hasFaces = x.who.length > 0;
      pv.room = x.n.kind === 'room';
      pv.lines = around(on.id, on.at, on.terms || []);
      pv.atLabel = on.atLabel;
      pv.tag = on.tag; pv.hasTag = on.hasTag;
      pv.openCls = hot('open');
      pv.open = function () { api.openAt(on.id, on.at); };
      pv.play = function () { api.toast('Plays ' + x.n.title + ' from ' + on.atLabel + '.'); };
      pv.confirm = function () { api.toast('Confirmed. Everyone with the notes sees it.'); };
      pv.notDecided = function () { api.toast('Marked as not decided.'); };
    } else if (on.kind === 'person') {
      var p = on.p;
      pv.isPerson = true;
      pv.id = p.id; pv.name = p.name; pv.title = p.title || 'Vandelay Industries'; pv.first = p.first;
      pv.meta = p.callsLabel + ' together' + (p.last ? ', most recently ' + (p.last === 'Today' || p.last === 'Yesterday' ? p.last.toLowerCase() : p.last) : '');
      var said = [];
      ORDER.forEach(function (id) { IDX[id].lines.forEach(function (l) { if (l.who === p.id && said.length < 3) said.push({ key: id + l.id, call: IDX[id].n.title, at: clock(l.at), text: l.text }); }); });
      pv.said = said; pv.hasSaid = said.length > 0;
      pv.saidLabel = 'Latest from ' + p.first;
      pv.go = on.go;
      pv.goCls = hot('what');
      pv.withCalls = function () { api.toast('Notes opens with ' + p.first + '’s calls.'); };
    } else if (on.kind === 'note' || on.kind === 'more') {
      var xn = IDX[on.id];
      pv.isNote = true;
      pv.title = xn.n.title;
      pv.meta = (xn.d.at || xn.n.day) + (xn.n.length ? ' · ' + xn.n.length : '');
      pv.faces = xn.who.join(','); pv.hasFaces = xn.who.length > 0;
      pv.summary = xn.d.long || xn.n.summary;
      pv.chips = [];
      if (xn.n.open) pv.chips.push({ t: xn.n.open + ' to confirm', cls: 'is-decide' });
      if (xn.n.todo) pv.chips.push({ t: xn.n.todo + (xn.n.todo === 1 ? ' follow-up' : ' follow-ups'), cls: 'is-follow' });
      pv.hasChips = pv.chips.length > 0;
      pv.go = function () { api.openAt(on.id, 0); };
      pv.goCls = hot('open');
    } else if (on.kind === 'ask') {
      pv.isAsk = true;
      pv.q = on.text;
      pv.count = COUNT;
      pv.line = 'The answer reads all ' + COUNT + ' of your notes, and points to the moments it comes from.';
      pv.go = api.ask;
      pv.goCls = hot('ask-go');
    } else if (on.kind === 'all') {
      pv.isAll = true;
      pv.q = r.typed || (st.who ? first(st.who) : '');
      pv.counts = [];
      if (f && f.total) pv.counts.push(f.total + (f.total === 1 ? ' moment' : ' moments') + ' in ' + f.calls.length + (f.calls.length === 1 ? ' call' : ' calls'));
      if (f && f.notes.length) pv.counts.push(f.notes.length + (f.notes.length === 1 ? ' note' : ' notes'));
      pv.countText = pv.counts.join(', ');
      pv.go = api.seeAll;
      pv.goCls = hot('all-go');
    }
    return pv;
  }

  /* ------------------------------------------------------------------ the states, by name */
  var Q = 'When does onboarding ship?';
  var STEPS = {
    home: {},
    pillHot: { homeStep: 'hotAsk' },
    open: { open: true },
    openHot: { open: true, hot: 'pick-maya' },
    maya: { open: true, q: 'maya' },
    mayaHot: { open: true, q: 'maya', hot: 'person-maya' },
    mayaPicked: { open: true, who: 'maya' },
    mayaFlag: { open: true, who: 'maya', q: 'flag' },
    mayaFlagHot: { open: true, who: 'maya', q: 'flag', hot: 'open' },
    flag: { open: true, q: 'flag' },
    flagDown: { open: true, q: 'flag', actKey: 'm-n2-l7', hot: 'open' },
    flagMore: { open: true, q: 'flag', actKey: 'all', hot: 'all' },
    flagAsk: { open: true, q: 'flag', actKey: 'ask', hot: 'ask' },
    flagAnswer: { open: true, q: 'flag', mode: 'answer', askQ: 'flag' },
    question: { open: true, q: Q },
    asking: { open: true, q: Q, mode: 'asking', askQ: Q },
    answer: { open: true, q: Q, mode: 'answer', askQ: Q },
    answerHot: { open: true, q: Q, mode: 'answer', askQ: Q, actKey: 'c-n2-l7', hot: 'open' },
    cake: { open: true, q: 'cake' },
    cakeAsked: { open: true, q: 'Who ordered the cake?', mode: 'answer', askQ: 'Who ordered the cake?' },
    harbourline: { open: true, q: 'harbourline' },
    first: { open: true, first: true },
    failed: { open: true, q: 'flag', failed: true },
    offline: { open: true, q: 'flag', offline: true },
    phoneHot: { homeStep: 'hotAsk' },
    phoneFlagHot: { open: true, q: 'flag', actKey: 'm-n2-l7', hot: 'm-n2-l7' }
  };

  var JOURNEYS = [
    { name: 'Find what someone said', frames: [
      { step: 'pillHot', t: 'Click Search or ask, or press ⌘K on any page.' },
      { step: 'openHot', t: 'The window opens over the page, solid. The people you meet most, then your recent notes.' },
      { step: 'mayaHot', t: 'Or type a name. They come first, then every moment they spoke, call by call.' },
      { step: 'mayaPicked', t: 'Press Enter. Only what Maya said, newest first. Her name stays in the line.' },
      { step: 'mayaFlagHot', t: 'Type flag to narrow it. The lit moment shows beside the list, in its transcript.' },
      { board: 'Note', step: 'sr-l5', t: 'Press Enter, or click Open at 2:36. The note opens there, the line lit.' }
    ] },
    { name: 'Search for a word', frames: [
      { step: 'flag', t: 'Type a word. Each match is a moment: who said it, their words, and when.' },
      { step: 'flagDown', t: 'Press ↓. A moment that became a decision says so, and can be confirmed right here.' },
      { board: 'Note', step: 'n-jumped', t: 'Press Enter. The note opens at 3:15.' }
    ] },
    { name: 'See every result', frames: [
      { step: 'flagMore', t: 'More than fits? See all, at the foot of the list.' },
      { board: 'Notes', step: 'typing', t: 'Notes opens with the same words: every note, each with its moments.' }
    ] },
    { name: 'Ask a question', frames: [
      { step: 'question', t: 'Type a question. Ask comes first and is lit, so Enter asks.' },
      { step: 'asking', t: 'The answer is written in confidential compute, from your notes only.' },
      { step: 'answer', t: 'It shows the moments it comes from, each with its words.' },
      { step: 'answerHot', t: 'Press ↓ to a moment. It shows beside the answer. Enter opens it.' },
      { board: 'Note', step: 'n-jumped', t: 'The note opens at 3:15.' }
    ] },
    { name: 'Ask about a word', frames: [
      { step: 'flagAsk', t: 'Press Tab, or click Ask, to ask about what you typed instead.' },
      { step: 'flagAnswer', t: 'The answer reads every note, not only the ones with the word. Esc goes back to the results.' }
    ] },
    { name: 'Nothing matches', frames: [
      { step: 'cake', t: 'No note has the word. It says what it looked through, and Ask is lit.' },
      { step: 'cakeAsked', t: 'Ask anyway. When no note says, the answer says so.' }
    ] },
    { name: 'On a phone', phone: true, frames: [
      { step: 'phoneHot', t: 'Tap search in the top bar.' },
      { step: 'open', t: 'Search takes the screen.' },
      { step: 'phoneFlagHot', t: 'Type. Moments, with nothing beside them. Tap one.' },
      { board: 'Note', step: 'n-jumped', t: 'The note opens at that moment.' }
    ] },
    { name: 'Every other state', frames: [
      { step: 'harbourline', t: 'A word only in titles and summaries finds the notes.' },
      { step: 'first', t: 'The first day: nothing to search yet.' },
      { step: 'failed', t: 'The search didn’t go through. Ask still works.' },
      { step: 'offline', t: 'Offline. Search needs a connection.' },
      { step: 'mayaFlag', mode: 'light', t: 'Light.' },
      { step: 'answer', mode: 'light', t: 'Light, answered.' }
    ] }
  ];

  AH.SR = { view: view, read: read, find: find, STEPS: STEPS, JOURNEYS: JOURNEYS, IDX: IDX, PEOPLE: PEOPLE, clock: clock, first: first, count: COUNT };
})();
