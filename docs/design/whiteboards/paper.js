/*
 * Turns a board's state into what the templates draw. `m` says which board, what's on it and what's happening;
 * the same model drives the static journeys (scenes.js) and the live board (live.js).
 */
window.AP = (function () {
  var P = window.WB.PEOPLE, B = window.WB.BOARDS, IC = window.IC;
  var IDS = ['title', 'seal', 'timer', 'vote', 'present', 'more', 'undo', 'redo', 'zoomIn', 'zoomOut', 'fit', 'map',
    'toolSelect', 'toolNote', 'toolText', 'toolShape', 'toolLine', 'toolPen', 'toolFrame', 'toolMore',
    'ctxColor', 'ctxSort', 'ctxLink', 'ctxMore', 'ctxTidy', 'ctxDup', 'ctxDelete', 'ctxText', 'ctxLock',
    'heard', 'addAll', 'add0', 'add1', 'add2', 'trayClose', 'pillAct', 'popA', 'popB', 'popC', 'popD', 'popGo', 'spot'];

  function bounds(rs) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    rs.forEach(function (r) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  /* The camera that shows a box inside the sheet, clear of the islands */
  function fit(b, W, H, pad) {
    var p = pad || { l: 36, r: 36, t: 94, b: 30 };
    var z = Math.min((W - p.l - p.r) / b.w, (H - p.t - p.b) / b.h, 1.15);
    z = Math.round(z * 1000) / 1000;
    return { x: p.l + (W - p.l - p.r - b.w * z) / 2 - b.x * z, y: p.t + (H - p.t - p.b - b.h * z) / 2 - b.y * z, z: z };
  }
  function shapePath(s, w, h) {
    var r;
    if (s === 'ellipse') return 'M0 ' + h / 2 + 'a' + w / 2 + ' ' + h / 2 + ' 0 1 0 ' + w + ' 0a' + w / 2 + ' ' + h / 2 + ' 0 1 0 ' + -w + ' 0z';
    if (s === 'diamond') return 'M' + w / 2 + ' 0L' + w + ' ' + h / 2 + 'L' + w / 2 + ' ' + h + 'L0 ' + h / 2 + 'Z';
    r = s === 'pill' ? h / 2 : 12;
    return 'M' + r + ' 0H' + (w - r) + 'a' + r + ' ' + r + ' 0 0 1 ' + r + ' ' + r + 'V' + (h - r) + 'a' + r + ' ' + r + ' 0 0 1 ' + -r + ' ' + r + 'H' + r + 'a' + r + ' ' + r + ' 0 0 1 ' + -r + ' ' + -r + 'V' + r + 'a' + r + ' ' + r + ' 0 0 1 ' + r + ' ' + -r + 'Z';
  }
  /* A connector: leaves one edge, arrives at another, with rounded corners. */
  function anchor(o, side) {
    if (side === 'r') return [o.x + o.w, o.y + o.h / 2];
    if (side === 'l') return [o.x, o.y + o.h / 2];
    if (side === 't') return [o.x + o.w / 2, o.y];
    return [o.x + o.w / 2, o.y + o.h];
  }
  function sides(a, b) {
    var dx = (b.x + b.w / 2) - (a.x + a.w / 2), dy = (b.y + b.h / 2) - (a.y + a.h / 2);
    if (Math.abs(dx) >= Math.abs(dy) * 0.8) return dx > 0 ? ['r', 'l'] : ['l', 'r'];
    return dy > 0 ? ['b', 't'] : ['t', 'b'];
  }
  function elbow(p, q, s, e) {
    var r = 14, x0 = p[0], y0 = p[1], x1 = q[0], y1 = q[1];
    var horiz = s === 'r' || s === 'l';
    if (horiz && Math.abs(y1 - y0) < 1 || !horiz && Math.abs(x1 - x0) < 1) return { d: 'M' + x0 + ' ' + y0 + 'L' + x1 + ' ' + y1, end: horiz ? (x1 > x0 ? 'r' : 'l') : (y1 > y0 ? 'd' : 'u') };
    if (horiz) {
      var mx = (x0 + x1) / 2, sy = y1 > y0 ? 1 : -1, sx = x1 > x0 ? 1 : -1, rr = Math.min(r, Math.abs(y1 - y0) / 2, Math.abs(x1 - x0) / 2);
      return { d: 'M' + x0 + ' ' + y0 + 'H' + (mx - sx * rr) + 'Q' + mx + ' ' + y0 + ' ' + mx + ' ' + (y0 + sy * rr) + 'V' + (y1 - sy * rr) + 'Q' + mx + ' ' + y1 + ' ' + (mx + sx * rr) + ' ' + y1 + 'H' + x1, end: sx > 0 ? 'r' : 'l' };
    }
    var my = (y0 + y1) / 2, ty = y1 > y0 ? 1 : -1, tx = x1 > x0 ? 1 : -1, r2 = Math.min(r, Math.abs(y1 - y0) / 2, Math.abs(x1 - x0) / 2);
    return { d: 'M' + x0 + ' ' + y0 + 'V' + (my - ty * r2) + 'Q' + x0 + ' ' + my + ' ' + (x0 + tx * r2) + ' ' + my + 'H' + (x1 - tx * r2) + 'Q' + x1 + ' ' + my + ' ' + x1 + ' ' + (my + ty * r2) + 'V' + y1, end: ty > 0 ? 'd' : 'u' };
  }
  function head(q, dir) {
    var x = q[0], y = q[1], a = 11, b = 6;
    if (dir === 'r') return 'M' + x + ' ' + y + 'l' + -a + ' ' + -b + 'l0 ' + 2 * b + 'z';
    if (dir === 'l') return 'M' + x + ' ' + y + 'l' + a + ' ' + -b + 'l0 ' + 2 * b + 'z';
    if (dir === 'd') return 'M' + x + ' ' + y + 'l' + -b + ' ' + -a + 'l' + 2 * b + ' 0z';
    return 'M' + x + ' ' + y + 'l' + -b + ' ' + a + 'l' + 2 * b + ' 0z';
  }
  function route(a, b) {
    var sd = sides(a, b), p = anchor(a, sd[0]), q = anchor(b, sd[1]);
    var e = elbow(p, q, sd[0], sd[1]);
    return { d: e.d, head: head(q, e.end) };
  }
  function freeRoute(a, q) {
    var dx = q[0] - (a.x + a.w / 2), dy = q[1] - (a.y + a.h / 2);
    var s = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'b' : 't');
    var p = anchor(a, s), e = elbow(p, q, s, '');
    return { d: e.d, head: head(q, e.end) };
  }
  function tick(x, n) { return x; }

  function objects(m) {
    var bd = B[m.board] || B.blank;
    var items = (m.items || bd.items).slice();
    if (m.add) items = items.concat(m.add);
    if (m.show) items = items.filter(function (o) { return m.show.indexOf(o.id) >= 0 || (m.add || []).indexOf(o) >= 0; });
    if (m.hide) items = items.filter(function (o) { return m.hide.indexOf(o.id) < 0; });
    if (m.sorted) items = items.map(function (o) { return o.tx === undefined ? o : Object.assign({}, o, { x: o.tx, y: o.ty, c: o.tc }); }).concat(bd.labels || []);
    var frames = m.frames || bd.frames, links = m.links || bd.links || [];
    if (m.only) { frames = frames.filter(function (f) { return f.id === m.only; }); items = items.filter(function (o) { return o.f === m.only; }); links = []; }
    return { bd: bd, items: items, frames: frames, links: links };
  }

  function vm(m, W, H, hot, go) {
    m = m || {};
    var o = objects(m);
    var byId = {};
    o.items.forEach(function (x) { byId[x.id] = x; });
    o.frames.forEach(function (x) { byId[x.id] = x; });

    /* The camera */
    var cam;
    /* `clear` keeps a frame's title out from under the pill */
    var pad = m.chrome === false ? { l: 40, r: 40, t: m.clear ? 96 : 56, b: 40 } : { l: 36, r: 36, t: m.clear ? 136 : 94, b: 30 };
    if (m.cam && m.cam.length) cam = { x: m.cam[0], y: m.cam[1], z: m.cam[2] };
    else if (m.cam) cam = m.cam;
    else if (m.focus) {
      var fs = [].concat(m.focus).map(function (id) { return byId[id]; }).filter(Boolean);
      cam = fit(bounds(fs.length ? fs : [{ x: 0, y: 0, w: 1160, h: 530 }]), W, H, pad);
    } else {
      var all = o.frames.concat(o.items);
      cam = fit(all.length ? bounds(all) : { x: 0, y: 0, w: 1160, h: 530 }, W, H, pad);
    }
    var z = cam.z;
    var toS = function (x, y) { return [x * z + cam.x, y * z + cam.y]; };

    /* What's on it */
    var sel = m.sel || [];
    var votes = m.votes || {}, dots = m.dots || {}, top = m.top || [], other = m.other || {}, typed = m.typed || {}, pops = m.pop_ || [], muted = m.muted || [];
    var hasNote = {};
    o.items.forEach(function (x) { if (x.f) hasNote[x.f] = (hasNote[x.f] || 0) + 1; });
    var frames = o.frames.map(function (f, i) {
      var empty = !hasNote[f.id];
      return { id: f.id, x: f.x, y: f.y, w: f.w, h: f.h, t: f.t, sub: f.sub || (hasNote[f.id] ? String(hasNote[f.id]) : ''), hint: empty ? f.hint : '', hasHint: empty && !!f.hint,
        cls: ((m.land || []).indexOf(f.id) >= 0 ? 'is-land ' : '') + ((m.dim || []).indexOf(f.id) >= 0 ? 'is-dim ' : '') + (m.sorted ? 'is-theme ' : ''), d: (i * 180) + 'ms' };
    });
    var items = o.items.map(function (x, i) {
      var cls = 'k-' + x.k + (x.c ? ' c-' + x.c : '');
      if (sel.indexOf(x.id) >= 0) cls += ' is-sel';
      if (m.edit === x.id) cls += ' is-editing';
      if (other[x.id]) cls += ' is-other';
      if (m.glide) cls += ' is-glide';
      if (pops.indexOf(x.id) >= 0) cls += ' is-pop';
      if (votes[x.id]) cls += ' has-v';
      if (dots[x.id]) cls += ' has-dots';
      if (top.indexOf(x.id) >= 0) cls += ' is-top';
      if (muted.indexOf(x.id) >= 0) cls += ' is-muted';
      if (x.lift) cls += ' is-lift';
      if (m.liveEdit === x.id) cls += ' is-live-edit';
      return { id: x.id, cls: cls, shot: x.k === 'shot', x: x.x, y: x.y, w: x.w, h: x.h, t: typed[x.id] !== undefined ? typed[x.id] : x.t, path: x.k === 'shape' ? shapePath(x.s, x.w, x.h) : 'M0 0', pc: other[x.id] ? P[other[x.id]].c : 'transparent', votes: votes[x.id] || 0, hasDots: !!dots[x.id], dots: new Array(dots[x.id] || 0).fill(0).map(function () { return {}; }), d: (m.stagger ? pops.indexOf(x.id) * 90 : 0) + 'ms', editing: m.liveEdit === x.id };
    });
    var links = [];
    o.links.forEach(function (l) {
      var a = byId[l.a], b = byId[l.b];
      if (!a || !b) return;
      var r = route(a, b), on = sel.indexOf(l.id) >= 0;
      links.push({ d: r.d, cls: on ? 'is-sel' : '' });
      links.push({ d: r.head, cls: 'head ' + (on ? 'is-sel' : '') });
    });
    if (m.draft && byId[m.draft.from]) {
      var dr = freeRoute(byId[m.draft.from], m.draft.to);
      links.push({ d: dr.d, cls: 'is-draft' });
      links.push({ d: dr.head, cls: 'head is-draft' });
    }
    (m.ink || []).forEach(function (s) { links.push({ d: s.d, cls: 'ink c-' + (s.c || 'horizon') }); });

    /* Everyone's pointer */
    var cursors = (m.cursors || []).map(function (c) {
      var who = c[0] || c.who, p = P[who] || {}, st = c[3] || c.st || '';
      return { id: who, name: p.name, x: c[1], y: c[2], pc: p.c, cls: st === 'talk' ? 'is-talk' : '', talk: st === 'talk', type: st === 'type', iz: Math.round(1000 / z) / 1000 };
    });

    /* Selection */
    var box = null, points = [], ctx = null;
    var selObjs = sel.map(function (id) { return byId[id]; }).filter(Boolean);
    if (selObjs.length) {
      var b = bounds(selObjs), s0 = toS(b.x, b.y);
      box = { x: s0[0] - 3, y: s0[1] - 3, w: b.w * z + 6, h: b.h * z + 6 };
      var solo = selObjs.length === 1 && selObjs[0];
      if (solo && m.handles !== false) {
        points = [[b.x + b.w + 18 / z, b.y + b.h / 2], [b.x - 18 / z, b.y + b.h / 2], [b.x + b.w / 2, b.y - 18 / z], [b.x + b.w / 2, b.y + b.h + 18 / z]].map(function (p, i) { var s = toS(p[0], p[1]); return { x: s[0], y: s[1], dir: 'rltb'.charAt(i) }; });
      }
      if (m.ctx !== false) {
        var kind = selObjs.length > 1 ? 'multi' : selObjs[0].k;
        ctx = { colour: kind !== 'shot', x: box.x + box.w / 2, y: Math.max(66, box.y - 52), multi: kind === 'multi', note: kind === 'note', shape: kind === 'shape', n: selObjs.length, c: 'c-' + (selObjs[0].c || 'mist'), sw: !!m.swatch };
      }
    }

    if (!selObjs.length && m.hover && byId[m.hover]) {
      var hb = byId[m.hover];
      points = [[hb.x + hb.w + 18 / z, hb.y + hb.h / 2], [hb.x - 18 / z, hb.y + hb.h / 2], [hb.x + hb.w / 2, hb.y - 18 / z], [hb.x + hb.w / 2, hb.y + hb.h + 18 / z]].map(function (q, i) { var s1 = toS(q[0], q[1]); return { x: s1[0], y: s1[1], dir: 'rltb'.charAt(i) }; });
    }
    var tool = m.tool || 'select';
    var h = {}, c = {};
    IDS.forEach(function (id) { h[id] = hot === id ? 'is-hot' : ''; c[id] = function (e) { if (e && e.stopPropagation) e.stopPropagation(); if (go) go(id); }; });
    var rail = [['toolSelect', 'select', 'Select · Esc', 'select'], ['toolNote', 'stickyNote', 'Sticky · N', 'note'], ['toolText', 'type', 'Text · T', 'text'], ['toolShape', 'shapes', 'Shape · S', 'shape'], ['toolLine', 'line', 'Line · L', 'line'], ['toolPen', 'pencil', 'Pen · P', 'pen'], ['toolFrame', 'frame', 'Frame · F', 'frame']]
      .map(function (t) { return { id: t[0], d: IC[t[1]], label: t[2], on: tool === t[3] ? 'true' : 'false', cls: tool === t[3] ? 'is-on' : '', hot: h[t[0]], go: c[t[0]], tool: t[3] }; });

    var pct = Math.round(z * 100) + '%';
    var pill = m.pill ? Object.assign({ d: IC[m.pill.icon || 'clock'], cls: (m.pill.soon ? 'is-soon ' : '') + (m.pill.act ? 'has-act ' : ''), hasAct: !!m.pill.act, hasText: !!m.pill.text, hasT: !!m.pill.t, hasB: !!m.pill.b, hasIcon: m.pill.icon !== null, sep: !!(m.pill.t && (m.pill.text || m.pill.b)) }, m.pill) : null;
    var pop = m.pop ? Object.assign({ hasHd: !!m.pop.hd, hasSub: !!m.pop.sub, rows: (m.pop.rows || []).map(function (r) { return { d: IC[r[0]], t: r[1] }; }), hasRows: !!(m.pop.rows && m.pop.rows.length), items: (m.pop.items || []).map(function (it, i) { var id = 'pop' + 'ABCD'.charAt(i); return { d: IC[it[0]], t: it[1], small: it[2] || '', hot: h[id], go: c[id] }; }), hasItems: !!(m.pop.items && m.pop.items.length), opts: (m.pop.opts || []).map(function (t, i) { var id = 'pop' + 'ABCD'.charAt(i); return { t: t, on: m.pop.on === i ? 'true' : 'false', hot: h[id], go: c[id] }; }), hasOpts: !!(m.pop.opts && m.pop.opts.length), hasGo: !!m.pop.go, goHot: h.popGo, goFn: c.popGo, style: 'left: ' + (m.pop.x || 0) + 'px; top: ' + (m.pop.y || 0) + 'px' }, {}) : null;
    if (pop) { pop.hd = m.pop.hd; pop.sub = m.pop.sub; pop.goLabel = m.pop.go; }
    var heardLines = (m.tray || []).map(function (l, i) { return { who: l[0], t: l[1], sub: l[2], hot: h['add' + i], go: c['add' + i], added: !!l[3], label: l[3] ? 'Added' : 'Add' }; });

    return {
      W: W, H: H,
      cls: (m.chrome === false ? 'is-clean ' : '') + (m.isNew ? 'is-new ' : '') + (m.follow ? 'is-follow ' : '') + (m.page ? 'is-page ' : '') + (m.mini ? 'is-mini ' : '') + (m.glide ? 'is-glide ' : '') + 'is-tool-' + tool + ' ' + (m.extra || ''),
      theme: m.theme || 'light',
      dot: Math.max(12, Math.round(24 * z * 100) / 100), cam: { x: Math.round(cam.x * 100) / 100, y: Math.round(cam.y * 100) / 100, z: z },
      fc: m.follow ? (P[m.follow] || {}).c : 'transparent',
      frames: frames, items: items, links: links, cursors: cursors,
      chrome: m.chrome !== false && !m.mini, rail2: m.chrome !== false && !m.mini && m.rail !== false, zCls: (m.chrome !== false && !m.mini && m.rail !== false ? 'has-rail ' : '') + (m.page ? 'is-page ' : ''),
      isEmpty: !o.frames.length && !o.items.length && m.chrome !== false,
      title: m.title || o.bd.title, seal: m.seal === undefined ? 'Sealed' : m.seal, hasSeal: m.seal !== '', sealD: IC[m.sealIcon || 'sealed'],
      rail: rail, pct: pct,
      showActs: m.acts !== false, showRail: m.rail !== false,
      undoOff: m.canUndo === false, redoOff: m.canRedo !== true,
      box: box, hasBox: !!box, handles: m.handles !== false, points: points, hasPoints: points.length > 0, ctx: ctx, hasCtx: !!ctx,
      swatches: ['butter', 'peach', 'rose', 'lilac', 'sky', 'mist'].map(function (k) { return { k: k, cls: 'c-' + k, on: ctx && ctx.c === 'c-' + k ? 'true' : 'false' }; }),
      fly: m.fly || '', flyNote: m.fly === 'note', flyShape: m.fly === 'shape', flyLine: m.fly === 'line', flyPen: m.fly === 'pen', flyMore: m.fly === 'more',
      pill: pill, hasPill: !!pill, pop: pop, hasPop: !!pop,
      heard: m.heard || 0, hasHeard: !!m.heard, heardText: m.heard === 1 ? '1 idea from the call' : m.heard + ' ideas from the call',
      tray: heardLines, hasTray: heardLines.length > 0,
      spot: spotOf(m.spot, byId, toS, z), hasSpot: !!m.spot, spotCls: m.spot && m.spot.dot ? 'is-dot' : '',
      map: m.map ? mapOf(o, cam, W, H) : null, hasMap: !!m.map,
      h: h, c: c
    };
  }
  /* A place to press, on something on the board, wherever the camera has put it */
  function spotOf(sp, byId, toS, z) {
    if (!sp) return null;
    var o = byId[sp.on];
    if (!o) return sp;
    var p = toS(o.x, o.y), w = o.w * z, h = o.h * z;
    if (sp.dot) return { x: p[0] + w + 18, y: p[1] + h / 2, w: 22, h: 22, label: sp.label || '' };
    return { x: p[0] + 6, y: p[1] + 6, w: w - 12, h: Math.min(h - 12, 150 * z), label: sp.label || '' };
  }
  function mapOf(o, cam, W, H) {
    var all = o.frames.concat(o.items);
    var b = all.length ? bounds(all) : { x: 0, y: 0, w: 1000, h: 600 };
    var view = { x: -cam.x / cam.z, y: -cam.y / cam.z, w: W / cam.z, h: H / cam.z };
    var u = bounds([b, view]), k = Math.min(160 / u.w, 100 / u.h);
    return {
      blocks: o.frames.map(function (r) { return { s: 'left: ' + (6 + (r.x - u.x) * k) + 'px; top: ' + (6 + (r.y - u.y) * k) + 'px; width: ' + r.w * k + 'px; height: ' + r.h * k + 'px' }; }),
      view: 'left: ' + (6 + (view.x - u.x) * k) + 'px; top: ' + (6 + (view.y - u.y) * k) + 'px; width: ' + view.w * k + 'px; height: ' + view.h * k + 'px'
    };
  }
  return { vm: vm, fit: fit, bounds: bounds, shapePath: shapePath, objects: objects, IDS: IDS };
})();
