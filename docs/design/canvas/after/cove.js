/*
 * The welcome page's cove (packages/ui/src/evening/cove.tsx), drawn by the same numbers: three headlands a side, rolling
 * hills with pines and cypresses, cliff faces lit on one side, sea stacks by the mouth, their reflections, foam and the
 * bay's ripples. Here it stands at night, behind the page a call leaves you on. `window.COVE.draw(plan)` returns the paths;
 * `window.COVE.sky(...)` the stars and the light on the water, from the same kind of seed.
 */
(function () {
  function seeded(seed) {
    var n = seed;
    return function () { n = (n * 16807) % 2147483647; return (n - 1) / 2147483646; };
  }
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var r1 = function (v) { return Math.round(v * 10) / 10; };
  var xy = function (x, y) { return r1(x) + ' ' + r1(y); };
  var pathOf = function (pts, X) { return 'M' + pts.map(function (p) { return xy(X(p[0]), p[1]); }).join('L') + 'Z'; };
  function pine(x, y, h) {
    var d = 'M' + xy(x - 1, y) + 'h2v' + r1(-h * 0.2) + 'h-2Z';
    for (var k = 0; k < 3; k++) {
      var bottom = y - h * (0.14 + k * 0.24), apex = bottom - h * 0.42, half = h * 0.25 * (1 - k * 0.22);
      d += 'M' + xy(x - half, bottom) + 'L' + xy(x, apex) + 'L' + xy(x + half, bottom) + 'Z';
    }
    return d;
  }
  function cypress(x, y, h) {
    var w = h * 0.3;
    return 'M' + xy(x, y - h) + 'C' + xy(x + w * 0.62, y - h * 0.62) + ' ' + xy(x + w * 0.56, y - h * 0.08) + ' ' + xy(x, y) + 'C' + xy(x - w * 0.56, y - h * 0.08) + ' ' + xy(x - w * 0.62, y - h * 0.62) + ' ' + xy(x, y - h) + 'Z';
  }
  var HEADLANDS = [
    { tone: 'far', reach: 0.43, out: 0.17, tip: 0.055 },
    { tone: 'mid', reach: 0.3, out: 0.38, tip: 0.14 },
    { tone: 'near', reach: 0.16, out: 0.66, tip: 0.27 }
  ];
  var CLEAR = 24, LOW = 6, REFLECTION = 64;
  function roofOver(words, a, b) {
    var v = -Infinity;
    words.forEach(function (k) { if (b > k.l - CLEAR - 4 && a < k.r + CLEAR + 4) v = Math.max(v, k.b + CLEAR); });
    return v;
  }
  var bend = function (a, c, b, t) { return (1 - t) * (1 - t) * a + 2 * t * (1 - t) * c + t * t * b; };

  function draw(P, S, reach) {
    var W = P.width, hz = P.line, foot = P.foot, words = P.words, r = seeded(P.seed);
    var roof = function (a, b, y) { return Math.min(Math.max(y, roofOver(words, a, b)), hz - LOW); };
    var baseOf = function (tone) { return tone === 'far' ? hz + 4 : tone === 'mid' ? hz + (foot - hz) * 0.36 : foot; };
    var ripples = '';
    for (var y = hz + 84, k = 0; y < foot + 40; y += 9 + k * 1.6, k++) {
      var n0 = 3 + Math.floor(r() * 4);
      for (var i0 = 0; i0 < n0; i0++) {
        var w0 = (18 + r() * 46) * (1 + k * 0.12), x0 = W * (0.18 + r() * 0.64);
        ripples += 'M' + xy(x0 - w0 / 2, y) + 'h' + r1(w0);
      }
    }
    var parts = [];
    HEADLANDS.forEach(function (L) {
      if (L.tone === 'mid') {
        var sb = hz + 9, sh = S * 0.13, sw = Math.max(16, S * 0.045), sx = W * (0.655 + r() * 0.03);
        var stack = function (x, h, w) { return [[x - w / 2, sb], [x - w * 0.42, sb - h * 0.55], [x - w * 0.3, sb - h * 0.96], [x + w * 0.05, sb - h], [x + w * 0.34, sb - h * 0.82], [x + w * 0.46, sb - h * 0.4], [x + w / 2, sb]]; };
        var I = function (x) { return x; };
        var under = function (pts) { return pts.map(function (p) { return [p[0], sb + (sb - p[1]) * 0.28]; }); };
        var one = stack(sx, sh, sw), two = stack(sx + sw * 1.35, sh * 0.5, sw * 0.7);
        var left = sx - sw / 2, right = sx + sw * 1.7;
        if (reach) for (var j = 0; j <= 6; j++) reach.push({ x: left + ((right - left) * j) / 6, k: 0.13, lift: 9 });
        parts.push({ kind: 'stacks', base: r1(sb), refl: pathOf(under(one), I) + pathOf(under(two), I), rock: pathOf(one, I) + pathOf(two, I), face: 'M0 0', foam: 'M0 0' });
      }
      var base = baseOf(L.tone);
      ['l', 'r'].forEach(function (side) {
        var X = function (x) { return side === 'l' ? x : W - x; };
        var xOut = -40, xTip = W * L.reach * (0.94 + r() * 0.12), n = 12;
        var top = [], ks = [];
        var waves = [[2 + r() * 1.5, r() * 6.3, 0.03], [4.5 + r() * 2, r() * 6.3, 0.012]];
        for (var i = 0; i <= n; i++) {
          var t = i / n, x = xOut + (xTip - xOut) * t;
          var kk = L.out + (L.tip - L.out) * Math.pow(t, 1.15);
          waves.forEach(function (wv) { kk -= Math.sin(t * Math.PI * wv[0] + wv[1]) * wv[2] * (1 - t * 0.6); });
          kk -= (r() - 0.5) * 0.008;
          ks.push(kk);
          top.push([x, roof(X(x), X(x), hz - S * kk)]);
        }
        var last = top[n];
        if (reach) {
          var at = function (q) { return [top[q] ? top[q][0] : xOut, ks[q] || 0]; };
          var mid = function (q) { var A = at(q), B = at(q + 1); return [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]; };
          for (var q = 1; q < n; q++) {
            var a0 = q === 1 ? at(0) : mid(q - 1), a1 = at(q), a2 = mid(q);
            for (var jj = 0; jj <= 8; jj++) reach.push({ x: X(bend(a0[0], a1[0], a2[0], jj / 8)), k: bend(a0[1], a1[1], a2[1], jj / 8), lift: 0 });
          }
          var mm = mid(n - 1), kn = ks[n] || 0, edge = Math.max(16, (base - hz + S * kn) * 0.36) * 0.26;
          for (var j1 = 0; j1 <= 4; j1++) reach.push({ x: X(mm[0] + ((last[0] - mm[0]) * j1) / 4), k: mm[1] + ((kn - mm[1]) * j1) / 4, lift: 0 });
          for (var j2 = 1; j2 <= 4; j2++) reach.push({ x: X(last[0] + (edge * j2) / 4), k: kn, lift: 0 });
        }
        var drop = base - last[1], faceW = Math.max(16, drop * (0.24 + r() * 0.12));
        var jag = function (u, v) { return [last[0] + faceW * u + (r() - 0.5) * faceW * 0.12, last[1] + drop * v]; };
        var f1 = jag(0.2, 0.18), f2 = jag(0.44, 0.42), f3 = jag(0.7, 0.7), toe = [last[0] + faceW, base];
        var first = top[0];
        var hill = 'M' + xy(X(first[0]), first[1]);
        for (var h = 1; h < n; h++) {
          var p = top[h], pq = top[h + 1];
          hill += 'Q' + xy(X(p[0]), p[1]) + ' ' + xy(X((p[0] + pq[0]) / 2), (p[1] + pq[1]) / 2);
        }
        var tail = [last, f1, f2, f3, toe, [xOut, base]];
        var rockD = hill + tail.map(function (pt) { return 'L' + xy(X(pt[0]), pt[1]); }).join('') + 'Z';
        var band = [last, f1, f2, f3, toe, [toe[0] - faceW * 0.5, base], [f3[0] - faceW * 0.42, f3[1]], [f2[0] - faceW * 0.34, f2[1]], [f1[0] - faceW * 0.26, f1[1]]];
        var rock = top.concat([f1, f2, f3, toe, [xOut, base]]);
        var depth = Math.min(L.tone === 'near' ? REFLECTION : 40, (base - Math.min.apply(null, top.map(function (pt) { return pt[1]; }))) * 0.3);
        var refl = rock.map(function (pt) { return [pt[0], base + Math.min(depth, (base - pt[1]) * 0.3)]; });
        var trees = '';
        var stands = L.tone === 'near' ? 3 : L.tone === 'mid' ? 2 : 1, each = L.tone === 'far' ? 2 : 3;
        var size = L.tone === 'near' ? [26, 30] : L.tone === 'mid' ? [13, 15] : [7, 5];
        for (var s2 = 0; s2 < stands; s2++) {
          var c = 0.08 + r() * 0.66;
          for (var m = 0; m < each; m++) {
            var tt = clamp(c + (r() - 0.5) * 0.09, 0.03, 0.82), ii = Math.min(n - 1, Math.floor(tt * n)), ff = tt * n - ii, pp = top[ii], qq = top[ii + 1];
            if (!pp || !qq) continue;
            var hh = (size[0] + r() * size[1]) * Math.min(1.15, Math.max(0.7, S / 640)), cyp = r() < 0.4;
            var tx = pp[0] + (qq[0] - pp[0]) * ff, ty = pp[1] + (qq[1] - pp[1]) * ff + 3, tall = cyp ? hh * 1.18 : hh, half = cyp ? tall * 0.19 : hh * 0.25;
            if (roof(X(tx) - half, X(tx) + half, ty - tall) > ty - tall + 0.5) continue;
            trees += cyp ? cypress(X(tx), ty, tall) : pine(X(tx), ty, hh);
          }
        }
        var foam = '';
        for (var f = 0; f < 4; f++) {
          var fw = 6 + r() * 16, fx = toe[0] - 6 - f * (14 + r() * 18);
          foam += 'M' + xy(X(fx) - fw / 2, base - 1) + 'h' + r1(fw);
        }
        parts.push({ kind: 'land', side: side, tone: L.tone, base: r1(base), refl: pathOf(refl, X), rock: rockD + trees, face: pathOf(band, X), foam: foam });
      });
    });
    return { ripples: ripples, parts: parts, height: r1(foot + 90) };
  }

  /* The land stands as high as the sky allows, unless the words would meet it: then all of it is drawn lower. */
  function drawCove(P) {
    var reach = [], full = draw(P, P.sky, reach), fit = P.sky;
    reach.forEach(function (p) {
      var roof = Math.min(roofOver(P.words, p.x, p.x), P.line - LOW);
      if (p.k > 0 && isFinite(roof)) fit = Math.min(fit, (P.line + p.lift - roof) / p.k);
    });
    return fit < P.sky ? draw(P, Math.max(0, fit * 0.995)) : full;
  }

  /* Stars, in three sets that twinkle on their own long cycles, kept off the words; and light lying on the water. */
  function sky(seed, W, line, words) {
    var r = seeded(seed * 7 + 3), sets = ['', '', ''];
    for (var i = 0; i < 70; i++) {
      var x = r() * W, y = 70 + Math.pow(r(), 1.5) * (line - 150), rad = 0.5 + r() * 0.9;
      var inWords = words.some(function (k) { return x > k.l - 30 && x < k.r + 30 && y > k.t - 30 && y < k.b + 30; });
      if (inWords) continue;
      sets[i % 3] += 'M' + r1(x - rad) + ' ' + r1(y) + 'a' + r1(rad) + ' ' + r1(rad) + ' 0 1 0 ' + r1(rad * 2) + ' 0a' + r1(rad) + ' ' + r1(rad) + ' 0 1 0 ' + r1(-rad * 2) + ' 0';
    }
    var light = ['', ''];
    for (var g = 0; g < 18; g++) {
      var gy = line + 6 + Math.pow(g / 18, 1.25) * 120, spread = 26 + (g / 18) * 120, gw = 8 + r() * (18 + g * 1.2), gx = W / 2 + (r() - 0.5) * spread;
      light[g % 2] += 'M' + r1(gx - gw / 2) + ' ' + r1(gy) + 'h' + r1(gw);
    }
    return { stars: sets, light: light };
  }

  window.COVE = { draw: drawCove, sky: sky };
})();
