/*
 * The tour's art: one short loop per stop on the dawn sky, drawn on night whatever the page's theme, as the app's
 * features/onboarding/art.tsx draws it. Each loop runs on one clock (Art.dc.html keeps it) and `view(t)` says where
 * everything is `t` seconds in; `still` is the moment shown with reduced motion and in journey frames. Room and the sun
 * are the old tour's, unchanged; Notes and Join are refreshed; Start, Search, the Drive and Agents are new.
 */
(function () {
  var AH = window.AH;

  var clamp01 = function (x) { return Math.max(0, Math.min(1, x)); };
  var out3 = function (x) { return 1 - Math.pow(1 - x, 3); };
  var in2 = function (x) { return x * x; };
  var inOut2 = function (x) { return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; };
  var lin = function (x) { return x; };
  var backOut = function (s) { return function (x) { return 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2); }; };
  /* Progress from `at` over `dur` seconds, eased. */
  var ramp = function (t, at, dur, ease) { return (ease || out3)(clamp01((t - at) / dur)); };
  /* In at `a`, out at `b`. */
  var span = function (t, a, inDur, b, outDur) { return ramp(t, a, inDur) * (1 - ramp(t, b, outDur, in2)); };
  var n3 = function (x) { return Math.round(x * 1000) / 1000; };
  var css = function (o) { var s = []; for (var k in o) s.push(k + ': ' + o[k]); return s.join('; '); };
  /* Comes up `dy` pixels into its place as `p` goes 0 → 1. */
  var rise = function (p, dy) { return css({ opacity: n3(p), transform: 'translateY(' + n3(dy * (1 - p)) + 'px)' }); };
  var pop = function (p, s) { return css({ opacity: n3(clamp01(p)), transform: 'scale(' + n3(0.6 + 0.4 * backOut(s || 1.7)(clamp01(p))) + ')' }); };

  /* Lucide, as the app's Icon draws it (1.8 stroke). */
  var I = {
    check: 'M20 6 9 17l-5-5',
    right: 'M5 12h14M12 5l7 7-7 7',
    video: 'M16 13l5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
    cal: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    search: 'M21 21l-4.34-4.34M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0',
    sparkles: 'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0zM20 3v4M22 5h-4M4 17v2M5 18H3',
    play: 'M7 5.5v13a.5.5 0 0 0 .76.43l10.5-6.5a.5.5 0 0 0 0-.86L7.76 5.07A.5.5 0 0 0 7 5.5z',
    diamond: 'M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41L13.7 2.71a2.41 2.41 0 0 0-3.41 0z',
    sealed: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1zM9 12l2 2 4-4',
    wifi: 'M12 20h.01M2 8.82a15 15 0 0 1 20 0M5 12.859a10 10 0 0 1 14 0M8.5 16.429a5 5 0 0 1 7 0',
    wifiOff: 'M12 20h.01M8.5 16.429a5 5 0 0 1 7 0M5 12.859a10 10 0 0 1 5.17-2.69M19 12.859a10 10 0 0 0-2.007-1.523M2 8.82a15 15 0 0 1 4.177-2.643M22 8.82a15 15 0 0 0-11.288-3.764M2 2l20 20',
    folder: 'M6 14l1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2',
    pointer: 'M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z',
    agent: 'M12 8V4H8M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM2 14h2M20 14h2M15 13v2M9 13v2',
    captions: 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM7 15h4M15 15h2M7 11h2M13 11h4',
    compass: 'M16.24 7.76l-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265zM2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0',
    grip: 'M9 8h6M9 12h6M9 16h6'
  };

  /* ------------------------------------------------------------------ Start or schedule a call (new) */
  /* Schedule, as the week on Calls draws it: who's in, busy time hatched, the free times lit, one picked, invites sent. */
  var WEEK = [
    { label: 'Wed', busy: [[8, 28], [58, 26]] },
    { label: 'Thu', busy: [[6, 30]], pick: [50, 30] },
    { label: 'Fri', busy: [[44, 36]], hint: [8, 28] },
    { label: 'Mon', busy: [[20, 36]] },
    { label: 'Tue', busy: [[8, 24], [62, 30]] }
  ];
  function start(t) {
    var gone = 1 - ramp(t, 5.95, 0.3, in2);
    var busy = ramp(t, 1.55, 0.5) * gone;
    var glow = ramp(t, 2.15, 0.45);
    var pick = ramp(t, 3.05, 0.38, lin);
    var hintOut = 1 - ramp(t, 3.05, 0.3);
    var days = WEEK.map(function (d) {
      var blocks = d.busy.map(function (b) { return { cls: 'ta-busy', style: css({ top: b[0] + '%', height: b[1] + '%', opacity: n3(busy) }) }; });
      if (d.hint) blocks.push({ cls: 'ta-hint', style: css({ top: d.hint[0] + '%', height: d.hint[1] + '%', opacity: n3(glow * hintOut * gone) }) });
      if (d.pick) {
        blocks.push({ cls: 'ta-hint', style: css({ top: d.pick[0] + '%', height: d.pick[1] + '%', opacity: n3(glow * (1 - pick) * gone) }) });
        blocks.push({ cls: 'ta-picked', style: css({ top: d.pick[0] + '%', height: d.pick[1] + '%', opacity: n3(pick * gone), transform: 'scale(' + n3(0.82 + 0.18 * backOut(1.6)(pick)) + ')' }) });
      }
      return { label: d.label, blocks: blocks, on: !!d.pick && pick > 0.5 };
    });
    return {
      title: t < 0.6 ? 'Schedule a call' : t < 1.2 ? 'Call with Maya' : 'Call with Maya and Kofi',
      titleCls: t < 0.6 ? 'ta-sh-t is-empty' : 'ta-sh-t',
      titleStyle: css({ opacity: n3(gone) }),
      who1: pop(ramp(t, 0.5, 0.42, lin) * gone), who2: pop(ramp(t, 1.1, 0.42, lin) * gone),
      days: days,
      done: rise(ramp(t, 3.7, 0.45) * gone, 8)
    };
  }

  /* ------------------------------------------------------------------ Notes for your calls (refreshed) */
  /* A call's notes write themselves: decisions in rose, a follow-up with whose it is, each with the moment it was said. */
  var NOTE_ROWS = [
    { kind: 'decide', text: 'Launch moves to the 18th', at: '6:12' },
    { kind: 'decide', text: 'Waitlist stays open', at: '14:40' },
    { kind: 'own', who: 'kofi', name: 'Kofi', text: 'Sends the screens by Wednesday', at: '22:05' }
  ];
  function notes(t) {
    var gone = 1 - ramp(t, 4.6, 0.3, in2);
    return {
      rows: NOTE_ROWS.map(function (r, i) {
        var p = ramp(t, 0.4 + i * 0.7, 0.55);
        var s = 0.4 + 0.6 * backOut(2.2)(clamp01((t - 0.5 - i * 0.7) / 0.5));
        var m = ramp(t, 0.9 + i * 0.7, 0.4);
        return {
          isDecide: r.kind === 'decide', isOwn: r.kind === 'own', who: r.who || '', name: r.name || '', text: r.text, at: r.at,
          style: css({ height: n3(26 * p) + 'px', opacity: n3(p * gone), transform: 'translateY(' + n3(8 * (1 - p)) + 'px)' }),
          mark: css({ transform: 'scale(' + n3(s) + ')' }),
          atStyle: css({ opacity: n3(m) })
        };
      })
    };
  }

  /* ------------------------------------------------------------------ Search or ask (new) */
  /* A question typed into the palette, Ask lit, then the answer with the moments it came from. */
  var Q = 'What did we decide on pricing?';
  var ANSWER = 'Keep the free plan, and Pro goes up in January. Maya sends the new pricing page by Friday.'.split(' ');
  function ask(t) {
    var gone = 1 - ramp(t, 6.3, 0.3, in2);
    var typed = Math.round(clamp01((t - 0.35) / 1.45) * Q.length);
    var lit = span(t, 1.95, 0.25, 2.6, 0.2);
    var mom = function (p) { return css({ opacity: n3(p * gone), transform: 'translateY(' + n3(6 * (1 - p)) + 'px) scale(' + n3(0.94 + 0.06 * backOut(1.7)(p)) + ')' }); };
    return {
      q: Q.slice(0, typed), empty: typed === 0, qStyle: css({ opacity: n3(gone) }),
      caret: css({ opacity: n3((t < 2.3 ? (Math.floor(t * 2.4) % 2 === 0 ? 1 : 0.2) : 0) * gone) }),
      askRow: css({ opacity: n3(lit) }),
      words: ANSWER.map(function (w, i) { var p = ramp(t, 2.7 + i * 0.045, 0.32); return { w: w, style: css({ opacity: n3(p * gone), transform: 'translateY(' + n3(4 * (1 - p)) + 'px)' }) }; }),
      m1: mom(ramp(t, 3.75, 0.4)), m2: mom(ramp(t, 3.95, 0.4))
    };
  }

  /* ------------------------------------------------------------------ Documents and boards (new) */
  /* A document writes itself beside a board where stickies land, each with someone's pointer; both stay with the call. */
  var LINES = [{ at: 0.4, w: 84, y: 37 }, { at: 1.05, w: 68, y: 51 }, { at: 1.7, w: 46, y: 65 }];
  var STICKIES = [{ at: 1.9, x: 16, y: 22, r: -5 }, { at: 2.35, x: 62, y: 14, r: 4 }, { at: 2.8, x: 40, y: 56, r: -2 }];
  function drive(t) {
    var gone = 1 - ramp(t, 6.3, 0.3, in2);
    var ls = LINES.map(function (l) { return ramp(t, l.at, 0.6, lin); });
    var cur = 0;
    for (var i = 0; i < LINES.length; i++) if (t >= LINES[i].at) cur = i;
    var cx = 12 + 150 * (LINES[cur].w / 100) * ls[cur], cy = LINES[cur].y - 3;
    var kx = 96, ky = 90;
    STICKIES.forEach(function (s) { var p = ramp(t, s.at - 0.4, 0.42, inOut2); kx += (s.x + 24 - kx) * p; ky += (s.y + 24 - ky) * p; });
    var st = STICKIES.map(function (s) {
      var p = ramp(t, s.at, 0.42, lin);
      return css({ left: s.x + 'px', top: s.y + 'px', opacity: n3(p * gone), transform: 'rotate(' + s.r + 'deg) scale(' + n3(1.3 - 0.3 * backOut(1.8)(p)) + ')' });
    });
    return {
      l1: css({ width: n3(84 * ls[0]) + '%', opacity: n3(gone) }),
      l2: css({ width: n3(68 * ls[1]) + '%', opacity: n3(gone) }),
      l3: css({ width: n3(46 * ls[2]) + '%', opacity: n3(gone) }),
      c1: css({ transform: 'translate(' + n3(cx) + 'px, ' + n3(cy) + 'px)', opacity: n3(ramp(t, 0.2, 0.3) * (1 - ramp(t, 2.7, 0.4)) * gone) }),
      s1: st[0], s2: st[1], s3: st[2],
      c2: css({ transform: 'translate(' + n3(kx) + 'px, ' + n3(ky) + 'px)', opacity: n3(ramp(t, 1.3, 0.3) * (1 - ramp(t, 4.4, 0.4)) * gone) })
    };
  }

  /* ------------------------------------------------------------------ Record in the room (the old tour's, unchanged) */
  var PILLS = [
    { icon: 'wifiOff', title: 'Offline', sub: 'Saved on this phone, encrypted', a: 0.2, b: 2.1 },
    { icon: 'wifi', title: 'Back online', sub: 'Sending the sealed recording', a: 2.3, b: 3.7 },
    { icon: 'sealed', gold: true, title: 'Notes written', sub: 'In confidential compute', a: 3.9, b: 6 }
  ];
  function room(t) {
    var bars = [];
    for (var i = 0; i < 14; i++) bars.push({ style: css({ transform: 'scaleY(' + n3(0.25 + 0.75 * Math.abs(Math.sin(t * (2.4 + (i % 5) * 0.55) + i * 1.7))) + ')' }) });
    return {
      bars: bars,
      pills: PILLS.map(function (p) {
        var show = span(t, p.a, 0.45, p.b, 0.3);
        var y = t < p.b ? 8 * (1 - ramp(t, p.a, 0.45)) : -8 * ramp(t, p.b, 0.3, in2);
        return { icon: I[p.icon], icCls: p.gold ? 'ic is-gold' : 'ic', title: p.title, sub: p.sub, style: css({ opacity: n3(show), transform: 'translateY(' + n3(y) + 'px)' }) };
      })
    };
  }

  /* ------------------------------------------------------------------ Bring your agent (new) */
  /* Claude's window and you on the horizon, joined while it asks; you allow what it can do, and it does it. */
  function agents(t) {
    var gone = 1 - ramp(t, 6.3, 0.3, in2);
    var joined = ramp(t, 0.2, 0.7, inOut2) * (1 - ramp(t, 3.0, 0.4));
    var asking = span(t, 0.6, 0.45, 2.85, 0.3);
    var sw = ramp(t, 1.85, 0.28, inOut2);
    var allowed = ramp(t, 2.95, 0.45);
    var tick = ramp(t, 3.05, 0.4, lin);
    return {
      join: css({ opacity: n3(joined * gone) }),
      ask: rise(asking * gone, 8),
      ring: css({ opacity: n3((1 - allowed) * ramp(t, 0.6, 0.4) * gone) }),
      knob: css({ transform: 'translateX(' + n3(11 * sw) + 'px)' }),
      track: css({ opacity: n3(sw) }),
      halo: css({ opacity: n3(allowed * gone), transform: 'scale(' + n3(0.86 + 0.14 * allowed) + ')' }),
      tick: css({ opacity: n3(clamp01(tick) * gone), transform: 'scale(' + n3(Math.max(0, backOut(2)(tick))) + ')' }),
      did: rise(ramp(t, 3.5, 0.45) * gone, 8)
    };
  }

  /* ------------------------------------------------------------------ You're ready (the old tour's, unchanged) */
  var STARS = [[60, 34, 1.3], [130, 22, 1], [250, 30, 1.4], [320, 52, 1], [352, 24, 1.2], [96, 70, 0.9]];
  function sun(t) {
    var up = ramp(t, 0.2, 2.6), fade = 1 - ramp(t, 4.4, 0.5, in2);
    var v = { sunT: 'translate(0 ' + n3(70 * (1 - up)) + ')', fade: String(n3(fade)), refl: String(n3(ramp(t, 1.4, 1, lin) * fade)) };
    STARS.forEach(function (s, i) { v['s' + i] = String(n3(0.9 - 0.75 * ramp(t, 0.8 + i * 0.08, 1.6, inOut2))); });
    return v;
  }

  /* ------------------------------------------------------------------ Join a call (refreshed) */
  var SAID = [['priya', 'Priya', 'The sign-in step tested well.'], ['theo', 'Theo', 'Then we ship it on Thursday.'], ['kofi', 'Kofi', 'I’ll send the screens tonight.']];
  function call(t) {
    var k = Math.max(0, Math.min(2, Math.floor(t / 2.2))), local = t - k * 2.2, now = SAID[k];
    return {
      tiles: SAID.map(function (s, i) { return { who: s[0], name: s[1], cls: 'ta-tile' + (i === k ? ' is-speaking' : '') }; }),
      who: now[0], name: now[1],
      words: now[2].split(' ').map(function (w, i) { var p = ramp(local, i * 0.11, 0.3); return { w: w, style: css({ opacity: n3(p), transform: 'translateY(' + n3(4 * (1 - p)) + 'px)' }) }; })
    };
  }

  AH.ART = {
    I: I,
    start: { period: 6.4, still: 4.9, view: start },
    notes: { period: 5.4, still: 3.6, view: notes },
    ask: { period: 6.8, still: 5.2, view: ask },
    drive: { period: 6.8, still: 5.2, view: drive },
    room: { period: 6.8, still: 4.5, view: room },
    agents: { period: 6.8, still: 5.3, view: agents },
    sun: { period: 5.2, still: 3, view: sun },
    call: { period: 6.6, still: 1.5, view: call }
  };
})();
