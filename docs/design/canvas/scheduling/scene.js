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

  AH.scene = function (moment, pal, mode) {
    var M = MOMENTS[moment] || MOMENTS.notes, night = !!M.night, dark = mode === 'dark' || night;
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

  /* What every new page starts from: the shell Home uses, with the sidebar marking this page and giving way to its one filled button. */
  var IDS = { home: 'Home', calls: 'Calls', call: 'Calls', drive: 'Drive', record: 'Record', team: 'Team', settings: '' };
  AH.page = function (c, id, opts) {
    var o = opts || {}, p = c.props || {};
    var v = AH.vm(c, 'home', { pal: 'blue-hour', mode: o.night ? 'dark' : 'dark' });
    var go = function (to) { if (typeof p.go === 'function') p.go(to); else v.toast('Opens ' + to + '.'); };
    v.side = AH.assign({}, v.side, {
      startCls: 'b-tint',
      nav: v.side.nav.map(function (n) {
        var on = n.label === IDS[id];
        return AH.assign({}, n, { cls: on ? ' is-on' : '', current: on ? 'page' : 'false', go: function () { go(n.label.toLowerCase()); } });
      })
    });
    v.nav = v.nav.map(function (n) { var on = n.label === IDS[id] || (id === 'settings' && n.label === 'Settings'); return AH.assign({}, n, { cls: (n.label === 'Record' ? ' is-rec' : '') + (on ? ' is-on' : ''), go: function () { go(n.label.toLowerCase()); } }); });
    v.go = go;
    v.scene = AH.assign({ page: true }, AH.scene(o.moment || id, v.pal, v.mode));
    return v;
  };
})();
