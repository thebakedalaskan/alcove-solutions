/*
 * One evening, page by page. Home is the sunset. Every other page is a moment of the same evening, drawn from the
 * palette's own sky, and the sky is only as tall as the page is one action. `AH.scene(moment, pal, mode)` feeds
 * Scene.dc.html. Everything that moves is a plain element animating transform and opacity, as in the real Horizon.
 */
(function () {
  var AH = window.AH, ok = AH.ok, PALS = AH.PALS;
  function mix(a, b, t) {
    var d = ((b[2] - a[2] + 540) % 360) - 180;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (a[2] + d * t + 360) % 360];
  }
  function rampOf(m) {
    var s = m.sky;
    return function (t) {
      var p = t * 100;
      for (var i = 1; i < s.length; i++) if (p <= s[i][3]) return mix(s[i - 1], s[i], (p - s[i - 1][3]) / (s[i][3] - s[i - 1][3]));
      return s[s.length - 1].slice(0, 3);
    };
  }
  function seeded(n) { return function () { n = (n * 16807) % 2147483647; return (n - 1) / 2147483646; }; }
  function grad(stops) { return 'linear-gradient(to bottom in oklch, ' + stops.map(function (x) { return ok(x[0]) + ' ' + x[1] + '%'; }).join(', ') + ')'; }

  /*
   * sun: how much shows and where. 'home' is half risen in the middle; 'team' is low and off to the left, behind the
   * people; 'record' is the recorder itself, in `rec`; the rest have set, and only the glow is left.
   */
  var MOMENTS = {
    home: { sky: [0.40, 0.66], lightSky: [0.46, 0.78], sun: { r: 48, x: 0 }, glitter: 190, stars: 0 },
    team: { sky: [0.36, 0.62], lightSky: [0.44, 0.74], sun: { r: 40, x: -300 }, glitter: 120, stars: 0 },
    notes: { sky: [0.30, 0.52], lightSky: [0.40, 0.66], sun: null, glitter: 70, stars: 7, glowW: 980, glowH: 150 },
    note: { sky: [0.24, 0.40], lightSky: [0.30, 0.50], sun: null, glitter: 0, stars: 4, glowW: 760, glowH: 90 },
    settings: { sky: [0.18, 0.32], lightSky: [0.26, 0.42], sun: null, glitter: 0, stars: 0, glowW: 620, glowH: 70 },
    /* Agents: Team's moment the other way round. The sun is low and to the right, just past the end of the line of agents. */
    agents: { sky: [0.35, 0.6], lightSky: [0.43, 0.72], sun: { r: 36, x: 470 }, glitter: 70, stars: 3 },
    record: { night: true, sky: [0.08, 0.26], lightSky: [0.08, 0.26], sun: { r: 58, x: 0, rec: true }, glitter: 150, stars: 22 }
  };

  function glitter(span, cx, k) {
    var r = seeded(7), beat = seeded(11), out = [];
    for (var y = 7; y < span; y += 8) {
      var far = y / span, spread = 16 + far * 70, n = 1 + Math.round(r() * 2);
      for (var i = 0; i < n; i++) {
        var w = (8 + r() * 30) * (0.7 + far) * 1.4, off = (r() - 0.5) * 2 * spread;
        out.push({ far: far, style: 'left: ' + (cx + off - w / 2).toFixed(1) + 'px; top: ' + y + 'px; width: ' + w.toFixed(1) + 'px; --o: ' + ((0.86 - far * 0.6) * k).toFixed(2) + '; --far: ' + far.toFixed(2) + '; --every: ' + (34 + beat() * 22).toFixed(1) + 's; --after: ' + (-beat() * 56).toFixed(1) + 's' });
      }
    }
    return out;
  }
  function chop(rows) {
    var r = seeded(23), layers = [[], [], []], row = 0;
    for (var y = 11, n = 0; n < rows; y += 13, n++, row++) for (var k = 0; k < 26; k++) {
      var w = 20 + r() * 70, x = -1700 + r() * 3400;
      if (Math.abs(x) < 106) continue;
      layers[row % 3].push({ style: 'left: ' + x.toFixed(1) + 'px; top: ' + y + 'px; width: ' + w.toFixed(1) + 'px; opacity: ' + (0.05 + r() * 0.09).toFixed(2) });
    }
    return layers.map(function (l, i) { return { i: i, style: '--i: ' + i, strokes: l }; });
  }
  function stars(n) {
    var r = seeded(41), out = [];
    for (var i = 0; i < n; i++) out.push({ style: 'left: ' + (3 + r() * 94).toFixed(1) + '%; top: ' + (6 + r() * r() * 52).toFixed(1) + '%; --s: ' + (1 + r() * 1.4).toFixed(1) + 'px; --o: ' + (0.25 + r() * 0.5).toFixed(2) + '; --after: ' + (-r() * 20).toFixed(1) + 's' });
    return out;
  }

  /* `over.sunX` moves the sun along the horizon for one page, as Agents does to keep it just past the end of its line. */
  AH.scene = function (moment, pal, mode, over) {
    var M = MOMENTS[moment] || MOMENTS.notes, night = !!M.night, dark = mode === 'dark' || night;
    if (over && over.sunX !== undefined && M.sun) M = AH.assign(M, { sun: AH.assign(M.sun, { x: over.sunX }) });
    var m = PALS[pal || 'blue-hour'][dark ? 'dark' : 'light'], R = rampOf(m);
    var low = dark ? M.sky : M.lightSky, top = night ? m.well : dark ? m.ground : R(0);
    var skyCss = grad([[top, 0], [night ? m.ground : R(low[0]), night ? 55 : 58], [R(low[1]), 100]]);
    var waterCss = grad(dark
      ? [[mix(m.surface, R(0.55), night ? 0.12 : 0.3), 0], [m.ground, 46], [m.well, 100]]
      : [[R(0.46), 0], [R(0.16), 46], [R(0.1), 100]]);
    var sunC = ok(dark ? [0.86, 0.085, 74] : [0.92, 0.1, 78]), glowC = ok(dark ? [0.66, 0.12, 22] : [0.93, 0.08, 45], 0.55), rimC = ok(dark ? [0.8, 0.1, 50] : [0.9, 0.09, 60]);
    if (M.sun && M.sun.rec) { sunC = ok(m.well); glowC = ok([0.5, 0.11, 340], 0.3); rimC = ok([0.82, 0.08, 62]); }
    var near = ok(dark ? [0.84, 0.09, 72] : [0.86, 0.1, 66]), far = ok(dark ? [0.58, 0.09, 355] : [0.76, 0.09, 10]);
    if (M.sun && M.sun.rec) { near = ok([0.8, 0.05, 60]); far = ok([0.45, 0.06, 340]); }
    var sx = M.sun ? M.sun.x : 0, r = M.sun ? M.sun.r : 0, gw = M.glowW || 1520, gh = M.glowH || 460;
    var shape = ok(night ? [0.14, 0.035, 262] : dark ? [0.17, 0.04, 262] : [0.42, 0.07, 262]), leaper = ok(night ? [0.8, 0.05, 60] : dark ? [0.78, 0.08, 62] : [0.5, 0.1, 250]);
    var vars = ['--sc-shape: ' + shape, '--sc-leaper: ' + leaper, '--sc-sky: ' + skyCss, '--sc-sea: ' + waterCss, '--sc-sun: ' + sunC, '--sc-glow: ' + glowC, '--sc-rim: ' + rimC, '--sc-cloud: ' + ok(dark ? R(0.5) : [0.86, 0.04, 330]), '--sc-chop: ' + ok(dark ? m.ink2 : R(0)), '--sc-near: ' + near, '--sc-far: ' + far, '--sc-star: ' + ok(m.ink)].join('; ');
    return {
      vars: vars, moment: moment, mode: mode, hasSun: !!M.sun, sunCls: M.sun && M.sun.rec ? ' is-rim' : '',
      sunStyle: 'left: ' + (sx - r) + 'px; top: ' + (-r) + 'px; width: ' + (r * 2) + 'px; height: ' + (r * 2) + 'px',
      glowStyle: 'left: ' + (sx - gw / 2) + 'px; top: ' + (-gh / 2) + 'px; width: ' + gw + 'px; height: ' + gh + 'px',
      stars: dark ? stars(M.stars) : [], glints: M.glitter ? glitter(M.glitter, sx, M.sun ? 1 : 0.55) : [], chop: chop(M.glitter ? 5 : 2),
      clouds: M.sun && !M.sun.rec ? [{ style: 'left: -430px; top: -92px; width: 460px; opacity: .5; --i: 0' }, { style: 'left: 40px; top: -60px; width: 340px; opacity: .4; --i: 1' }, { style: 'left: -300px; top: -34px; width: 520px; opacity: .35; --i: 2' }] : []
    };
  };

  /*
   * What every new page starts from: the shell Home uses, with the sidebar marking this page and giving way to its one
   * filled button. The side panel's places are the app's today, with Agents after Team: Home, Notes, Drive, Record, Team
   * and Agents. Start a call is a row like them, its camera in a warm circle. Agents counts the agents connected, as Team
   * counts people. The phone's tab bar keeps the app's five, so Agents is reached from Settings there.
   */
  var IDS = { home: 'Home', notes: 'Notes', record: 'Record', team: 'Team', note: 'Notes', settings: '', agents: 'Agents', drive: 'Drive' };
  var PLACE_ICON = {
    folder: 'M6 14l1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2',
    bot: 'M12 8V4H8M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM2 14h2M20 14h2M15 13v2M9 13v2'
  };
  AH.page = function (c, id, opts) {
    var o = opts || {}, p = c.props || {};
    var v = AH.vm(c, 'home', { pal: 'blue-hour', mode: o.night ? 'dark' : 'dark' });
    var go = function (to) { if (typeof p.go === 'function') p.go(to); else v.toast(to.charAt(0).toUpperCase() + to.slice(1) + ' opens here.'); };
    var I = AH.I, st = v.st, agentsN = o.agents === undefined ? 3 : o.agents;
    var places = [
      { label: 'Home', icon: I.home, count: 2, waiting: true },
      { label: 'Notes', icon: I.notes, count: 8 },
      { label: 'Drive', icon: PLACE_ICON.folder, count: 0 },
      { label: 'Record', icon: I.recordDot, count: 0 },
      { label: 'Team', icon: I.people, count: 6 },
      { label: 'Agents', icon: PLACE_ICON.bot, count: agentsN }
    ];
    v.side = AH.assign({}, v.side, {
      startCls: 'b-tint',
      nav: places.map(function (n) {
        var on = n.label === IDS[id], hotNav = st.hot === 'nav-' + n.label.toLowerCase();
        return {
          label: n.label, icon: n.icon, count: n.count, hasCount: n.count > 0, countCls: n.waiting ? '' : ' is-quiet',
          cls: (on ? ' is-on' : '') + (hotNav ? ' is-hot' : ''), current: on ? 'page' : 'false',
          go: function () { if (n.label === IDS[id]) return; if (typeof o.onNav === 'function') o.onNav(n.label.toLowerCase()); else go(n.label.toLowerCase()); }
        };
      })
    });
    var tabs = [
      { label: 'Home', icon: I.home }, { label: 'Notes', icon: I.notes }, { label: 'Record', icon: I.recordDot, rec: true },
      { label: 'Drive', icon: PLACE_ICON.folder }, { label: 'Team', icon: I.people }
    ];
    v.nav = tabs.map(function (n) { var on = n.label === IDS[id]; return { label: n.label, icon: n.icon, cls: (n.rec ? ' is-rec' : '') + (on ? ' is-on' : ''), current: on ? 'page' : 'false', go: function () { go(n.label.toLowerCase()); } }; });
    v.go = go;
    v.scene = AH.assign({ page: true }, AH.scene(o.moment || id, v.pal, v.mode, o.sunX === undefined ? undefined : { sunX: o.sunX }));
    return v;
  };
})();
