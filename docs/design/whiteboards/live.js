/*
 * The board you can actually use. One controller per live Paper: it holds what's on the board, turns pointer and
 * keyboard input into changes, and plays the other people in the call (their pointers, their notes, who is talking).
 * Your undo only ever touches your own changes; what the others add stays.
 */
window.AL = (function () {
  var WB = window.WB, AP = window.AP, P = WB.PEOPLE;
  var OFF = 650, n = 0;
  var uid = function () { n += 1; return 'x' + n; };
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  var HEARD = [
    ['priya', 'The changelog should go out before the post, not after.', 'Priya, 2 min ago', false, 'rose', 'Changelog goes out before the post'],
    ['kofi', 'Let’s check staging the day before every launch.', 'Kofi, 1 min ago', false, 'sky', 'Check staging the day before'],
    ['maya', 'Someone has to own the status page on the day.', 'Maya, just now', false, 'sky', 'Name a status page owner']
  ];
  var ARRIVALS = [
    { who: 'maya', c: 'butter', t: 'Docs were ready on day one', x: 190, y: 360, f: 'well' },
    { who: 'lena', c: 'rose', t: 'Sales heard about pricing last', x: 590, y: 360, f: 'fix' },
    { who: 'kofi', c: 'sky', t: 'Dry run the day before', x: 990, y: 20, f: 'act' }
  ];
  var CREW = ['priya', 'theo', 'kofi', 'maya', 'lena'];

  function seed() {
    var r = WB.BOARDS.retro, i = WB.BOARDS.ideas;
    return {
      frames: clone(r.frames).concat(clone(i.frames).map(function (f) { f.y += OFF; return f; })),
      items: clone(r.items).concat(clone(i.items).map(function (o) { o.y += OFF; o.ty += OFF; return o; })),
      links: clone(r.links), ink: [], tool: 'select', color: 'butter', shape: 'rect', sel: [], edit: null, draft: null, drag: null, fly: '', swatch: false,
      hist: [], fut: [], map: false, follow: '', glide: false, hover: null, marq: null, guides: [], space: false, pop: null,
      heard: 0, tray: null, timer: null, vote: null, dots: {}, votes: {}, top: [], muted: [], present: null, ticks: 0, arrivals: 0, sorted: false,
      others: [['priya', 575, 214, 'talk'], ['theo', 118, 332, ''], ['kofi', 590, 416, ''], ['maya', 950, 90, ''], ['lena', 300, 470, '']]
    };
  }

  function make(self) {
    var s = seed(), L = {}, timers = [];
    var draw = function () { self.forceUpdate(); };
    var size = function () { return { W: Number(self.props.w) || 1114, H: Number(self.props.h) || 682 }; };
    var all = function () { return s.items.concat(s.frames); };
    var get = function (id) { return all().filter(function (o) { return o.id === id; })[0]; };
    var isFrame = function (id) { return s.frames.some(function (f) { return f.id === id; }); };
    var pt = function (e) {
      var r = L.el.getBoundingClientRect(), k = r.width / L.el.offsetWidth || 1;
      var sx = (e.clientX - r.left) / k, sy = (e.clientY - r.top) / k;
      return { sx: sx, sy: sy, x: (sx - s.cam.x) / s.cam.z, y: (sy - s.cam.y) / s.cam.z };
    };
    var snap = function () { s.hist.push(clone({ items: s.items.filter(function (o) { return !o.sim; }), frames: s.frames, links: s.links, ink: s.ink })); if (s.hist.length > 60) s.hist.shift(); s.fut = []; };
    var restore = function (from, to) {
      if (!from.length) return;
      to.push(clone({ items: s.items.filter(function (o) { return !o.sim; }), frames: s.frames, links: s.links, ink: s.ink }));
      var h = from.pop();
      s.items = h.items.concat(s.items.filter(function (o) { return o.sim; }));
      s.frames = h.frames; s.links = h.links; s.ink = h.ink; s.sel = []; s.glide = true; later(function () { s.glide = false; draw(); }, 720);
    };
    var later = function (f, ms) { timers.push(setTimeout(f, ms)); };
    var stopFollow = function () { if (s.follow) { s.follow = ''; if (self.props.onLive) self.props.onLive({ follow: '' }); } };
    var frameAt = function (x, y) { return s.frames.filter(function (f) { return x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h; })[0]; };
    var colourIn = function (f) {
      if (!f) return s.color;
      var c = s.items.filter(function (o) { return o.f === f.id && o.k === 'note'; })[0];
      return c ? c.c : s.color;
    };
    var addNote = function (x, y, c, t) {
      snap();
      var f = frameAt(x + 75, y + 75), o = { id: uid(), k: 'note', c: c || colourIn(f), t: t || '', by: 'art', x: x, y: y, w: 150, h: 150, f: f ? f.id : '', fresh: true };
      s.items.push(o); s.sel = [o.id];
      return o;
    };
    var startEdit = function (id) { s.edit = id; s.sel = [id]; s.tool = 'select'; s.fly = ''; };
    var finishEdit = function () {
      var o = get(s.edit);
      if (o && !String(o.t || '').trim() && o.fresh) { s.items = s.items.filter(function (x) { return x !== o; }); s.sel = []; }
      if (o) delete o.fresh;
      s.edit = null;
    };
    var remove = function () {
      if (!s.sel.length) return;
      snap();
      var gone = s.sel;
      s.items = s.items.filter(function (o) { return gone.indexOf(o.id) < 0; });
      s.frames = s.frames.filter(function (o) { return gone.indexOf(o.id) < 0; });
      s.links = s.links.filter(function (l) { return gone.indexOf(l.a) < 0 && gone.indexOf(l.b) < 0 && gone.indexOf(l.id) < 0; });
      s.sel = [];
    };
    var duplicate = function () {
      var picked = s.items.filter(function (o) { return s.sel.indexOf(o.id) >= 0; });
      if (!picked.length) return;
      snap();
      var made = picked.map(function (o) { var c = clone(o); c.id = uid(); c.x += 24; c.y += 24; c.by = 'art'; delete c.sim; return c; });
      s.items = s.items.concat(made); s.sel = made.map(function (o) { return o.id; });
    };
    var tidy = function () {
      var picked = s.items.filter(function (o) { return s.sel.indexOf(o.id) >= 0; });
      if (picked.length < 2) return;
      snap();
      var b = AP.bounds(picked), cols = Math.ceil(Math.sqrt(picked.length)), g = 20;
      picked.sort(function (p, q) { return (p.y - q.y) || (p.x - q.x); }).forEach(function (o, i) { o.x = b.x + (i % cols) * (o.w + g); o.y = b.y + Math.floor(i / cols) * (o.h + g); });
      s.glide = true; later(function () { s.glide = false; draw(); }, 720);
    };
    var sortThemes = function () {
      var picked = s.items.filter(function (o) { return s.sel.indexOf(o.id) >= 0 && o.tx !== undefined; });
      if (!picked.length) { tidy(); return; }
      snap();
      picked.forEach(function (o) { o.x = o.tx; o.y = o.ty; o.c = o.tc; });
      if (!s.sorted) { s.items = s.items.concat(clone(WB.BOARDS.ideas.labels).map(function (l) { l.y += OFF; l.id = uid(); return l; })); }
      s.sorted = true; s.sel = []; s.glide = true; later(function () { s.glide = false; draw(); }, 720);
    };
    var setCam = function (c, glide) { s.cam = c; s.glide = !!glide; if (glide) later(function () { s.glide = false; draw(); }, 440); };
    var zoomAt = function (f, sx, sy) {
      var z = Math.max(0.2, Math.min(3, s.cam.z * f)), k = z / s.cam.z;
      s.cam = { x: sx - (sx - s.cam.x) * k, y: sy - (sy - s.cam.y) * k, z: z };
    };
    var fitAll = function () { var d = size(); setCam(AP.fit(AP.bounds(all()), d.W, d.H), true); };
    var center = function (x, y, z) { var d = size(), zz = z || s.cam.z; return { x: d.W / 2 - x * zz, y: d.H / 2 - y * zz, z: zz }; };
    var pickTool = function (t) {
      if (s.edit) finishEdit();
      var same = s.tool === t;
      s.tool = t; s.sel = []; s.pop = null;
      s.fly = (t === 'note' || t === 'shape' || t === 'line' || t === 'pen') && !same ? t : '';
    };

    /* What's happening for everyone: one pill */
    var pill = function () {
      if (s.present !== null) return { icon: 'play', b: 'Presenting', t: (s.present + 1) + ' of ' + s.frames.length, act: s.present + 1 < s.frames.length ? 'Next' : 'Stop' };
      if (s.vote === 'on') { var used = Object.keys(s.dots).length; return { icon: 'vote', b: 'Voting', text: (3 - used) + ' of 3 votes left', act: 'End the vote' }; }
      if (s.vote === 'done') return { icon: 'vote', b: 'Results', text: '7 people voted', act: 'Done' };
      if (s.follow) return { icon: 'eye', b: 'Following ' + P[s.follow].name, act: 'Stop' };
      if (s.timer !== null) return { icon: 'timer', t: Math.floor(s.timer / 60) + ':' + String(s.timer % 60).padStart(2, '0'), text: s.timer ? 'Add your stickies' : 'Time’s up', act: 'Stop' };
      return null;
    };

    /* Chrome */
    L.act = function (id) {
      if (id.indexOf('tool') === 0) {
        var map = { toolSelect: 'select', toolNote: 'note', toolText: 'text', toolShape: 'shape', toolLine: 'line', toolPen: 'pen', toolFrame: 'frame' };
        if (id === 'toolMore') { s.fly = s.fly === 'more' ? '' : 'more'; } else pickTool(map[id]);
      } else if (id === 'zoomIn' || id === 'zoomOut') { var d = size(); stopFollow(); zoomAt(id === 'zoomIn' ? 1.25 : 0.8, d.W / 2, d.H / 2); s.glide = true; later(function () { s.glide = false; draw(); }, 440); }
      else if (id === 'fit') { stopFollow(); fitAll(); }
      else if (id === 'map') s.map = !s.map;
      else if (id === 'undo') restore(s.hist, s.fut);
      else if (id === 'redo') restore(s.fut, s.hist);
      else if (id === 'ctxDelete') remove();
      else if (id === 'ctxDup') duplicate();
      else if (id === 'ctxColor') s.swatch = !s.swatch;
      else if (id === 'ctxTidy') tidy();
      else if (id === 'ctxSort') sortThemes();
      else if (id === 'title') s.pop = s.pop && s.pop.k === 'title' ? null : Object.assign({ k: 'title' }, window.AS.POP.TITLE);
      else if (id === 'seal') s.pop = s.pop && s.pop.k === 'seal' ? null : Object.assign({ k: 'seal' }, window.AS.POP.SEAL_MAIN);
      else if (id === 'timer') s.pop = s.pop && s.pop.k === 'timer' ? null : Object.assign({ k: 'timer' }, window.AS.POP.TIMER);
      else if (id === 'vote') s.pop = s.pop && s.pop.k === 'vote' ? null : Object.assign({ k: 'vote' }, window.AS.POP.VOTE, { hd: 'Vote on these notes' });
      else if (id === 'present') { s.present = 0; s.pop = null; s.sel = []; var d0 = size(); setCam(AP.fit(s.frames[0], d0.W, d0.H, { l: 40, r: 40, t: 96, b: 40 }), true); }
      else if (id === 'more') s.pop = s.pop && s.pop.k === 'more' ? null : Object.assign({ k: 'more' }, window.AS.POP.MORE);
      else if (id === 'popGo') {
        if (s.pop && s.pop.k === 'timer') { s.timer = [180, 300, 600][s.pop.on]; }
        if (s.pop && s.pop.k === 'vote') { s.vote = 'on'; s.dots = {}; s.votes = {}; s.top = []; s.muted = []; }
        s.pop = null;
      } else if (id === 'popA' || id === 'popB' || id === 'popC' || id === 'popD') {
        if (s.pop && s.pop.opts) s.pop = Object.assign({}, s.pop, { on: 'ABCD'.indexOf(id.slice(3)) }); else s.pop = null;
      } else if (id === 'pillAct') {
        if (s.present !== null) {
          if (s.present + 1 < s.frames.length) { s.present += 1; var d1 = size(); setCam(AP.fit(s.frames[s.present], d1.W, d1.H, { l: 40, r: 40, t: 96, b: 40 }), true); } else { s.present = null; fitAll(); }
        } else if (s.vote === 'on') {
          s.vote = 'done';
          var notes = s.items.filter(function (o) { return o.k === 'note' && (s.dots[o.id] || /^f/.test(o.id)); });
          notes.forEach(function (o, i) { s.votes[o.id] = (s.dots[o.id] ? 1 : 0) + ((i * 3 + 2) % 6); });
          s.top = notes.slice().sort(function (p, q) { return s.votes[q.id] - s.votes[p.id]; }).slice(0, 3).map(function (o) { return o.id; });
          s.muted = s.items.filter(function (o) { return o.k === 'note' && s.top.indexOf(o.id) < 0; }).map(function (o) { return o.id; });
          s.dots = {};
        } else if (s.vote === 'done') { s.vote = null; s.votes = {}; s.top = []; s.muted = []; }
        else if (s.follow) stopFollow();
        else if (s.timer !== null) s.timer = null;
      } else if (id === 'heard') { s.tray = clone(HEARD); s.heard = 0; }
      else if (id === 'trayClose') s.tray = null;
      else if (id === 'addAll' || /^add\d$/.test(id)) {
        var ids = id === 'addAll' ? [0, 1, 2] : [Number(id.slice(3))];
        snap();
        var spots = [[420, 360], [990, 190], [990, 360]];
        ids.forEach(function (k) {
          var l = s.tray[k];
          if (l[3]) return;
          l[3] = true;
          s.items.push({ id: uid(), k: 'note', c: l[4], t: l[5], by: l[0], x: spots[k][0], y: spots[k][1], w: 150, h: 150, f: k ? 'act' : 'fix' });
        });
        if (s.tray.every(function (l) { return l[3]; })) s.tray = null;
      }
      draw();
    };

    /* Pointer */
    L.pd = function (e) {
      if (e.button === 2) return;
      var t = e.target;
      if (t.closest('.bi, .bx, .bx-sw, .bfly, .bp, .bd-head, .bd-pill, .bd-heard, .bd-tray, .bo-edit')) return;
      L.el.focus({ preventScroll: true });
      if (s.edit) finishEdit();
      var hadFly = s.fly;
      s.fly = ''; s.swatch = false; s.pop = null;
      var w = pt(e);
      try { L.el.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic pointer */ }
      if (e.button === 1 || s.space) { s.drag = { k: 'pan', sx: w.sx, sy: w.sy, cx: s.cam.x, cy: s.cam.y }; stopFollow(); draw(); return; }
      var p = t.closest('[data-p]');
      if (p) { var from = s.sel.length === 1 ? s.sel[0] : s.hover; if (from) { s.drag = { k: 'link', from: from }; s.draft = { from: from, to: [w.x, w.y] }; draw(); return; } }
      var hd = t.closest('[data-h]');
      if (hd && s.sel.length === 1) { var o = get(s.sel[0]); snap(); s.drag = { k: 'size', o: o, c: hd.getAttribute('data-h'), x: o.x, y: o.y, w: o.w, h: o.h, wx: w.x, wy: w.y }; draw(); return; }
      var idEl = t.closest('[data-id]'), id = idEl ? idEl.getAttribute('data-id') : null;
      var head = t.closest('.bf-h');
      if (id && isFrame(id) && !head) id = null;
      if (s.tool === 'note') { var nn = addNote(w.x - 75, w.y - 75, hadFly === 'note' ? null : null); startEdit(nn.id); draw(); return; }
      if (s.tool === 'text') { snap(); var tx = { id: uid(), k: 'text', t: '', x: w.x, y: w.y - 16, w: 260, h: 34, fresh: true }; s.items.push(tx); startEdit(tx.id); draw(); return; }
      if (s.tool === 'shape') { snap(); var sh = { id: uid(), k: 'shape', s: s.shape, t: '', x: w.x, y: w.y, w: 1, h: 1, c: '' }; s.items.push(sh); s.sel = [sh.id]; s.drag = { k: 'draw', o: sh, x0: w.x, y0: w.y }; draw(); return; }
      if (s.tool === 'frame') { snap(); var fr = { id: uid(), t: 'Frame', x: w.x, y: w.y, w: 1, h: 1, hint: '' }; s.frames.push(fr); s.sel = [fr.id]; s.drag = { k: 'draw', o: fr, x0: w.x, y0: w.y, frame: true }; draw(); return; }
      if (s.tool === 'pen') { s.drag = { k: 'ink', pts: [[w.x, w.y]] }; draw(); return; }
      if (s.tool === 'line') { if (id && !isFrame(id)) { s.drag = { k: 'link', from: id }; s.draft = { from: id, to: [w.x, w.y] }; } draw(); return; }
      if (s.vote === 'on' && id) {
        var ob = get(id);
        if (ob && ob.k === 'note') {
          if (s.dots[id]) delete s.dots[id]; else if (Object.keys(s.dots).length < 3) s.dots[id] = 1;
        }
        draw(); return;
      }
      if (id) {
        if (e.shiftKey) { s.sel = s.sel.indexOf(id) >= 0 ? s.sel.filter(function (x) { return x !== id; }) : s.sel.concat(id); }
        else if (s.sel.indexOf(id) < 0) s.sel = [id];
        var moving = s.sel.slice();
        s.sel.forEach(function (sid) { if (isFrame(sid)) { var f = get(sid); s.items.forEach(function (x) { if (x.f === f.id && moving.indexOf(x.id) < 0) moving.push(x.id); }); } });
        s.drag = { k: 'move', ids: moving, wx: w.x, wy: w.y, from: moving.map(function (m) { var q = get(m); return [q.x, q.y]; }), moved: false, single: id };
        draw(); return;
      }
      s.sel = [];
      s.marq = { x0: w.x, y0: w.y, x1: w.x, y1: w.y };
      s.drag = { k: 'marq' };
      draw();
    };
    L.pm = function (e) {
      var d = s.drag, w;
      if (!L.el) return;
      w = pt(e);
      if (!d) {
        if (e.target.closest('.bi, .bx, .bfly, .bp, .bd-head, .bd-pill')) { if (s.hover) { s.hover = null; draw(); } return; }
        var pad = 30 / s.cam.z, hit = null;
        if (s.tool === 'select' && !s.sel.length) s.items.forEach(function (o) { if (o.k !== 'label' && w.x > o.x - pad && w.x < o.x + o.w + pad && w.y > o.y - pad && w.y < o.y + o.h + pad) hit = o.id; });
        if (hit !== s.hover) { s.hover = hit; draw(); }
        return;
      }
      if (d.k === 'pan') { s.cam = { x: d.cx + w.sx - d.sx, y: d.cy + w.sy - d.sy, z: s.cam.z }; }
      else if (d.k === 'marq') {
        s.marq.x1 = w.x; s.marq.y1 = w.y;
        var x0 = Math.min(s.marq.x0, s.marq.x1), x1 = Math.max(s.marq.x0, s.marq.x1), y0 = Math.min(s.marq.y0, s.marq.y1), y1 = Math.max(s.marq.y0, s.marq.y1);
        s.sel = s.items.filter(function (o) { return o.x < x1 && o.x + o.w > x0 && o.y < y1 && o.y + o.h > y0; }).map(function (o) { return o.id; });
      } else if (d.k === 'link') { s.draft = { from: d.from, to: [w.x, w.y] }; }
      else if (d.k === 'ink') { d.pts.push([w.x, w.y]); }
      else if (d.k === 'draw') {
        var o = d.o;
        o.x = Math.min(d.x0, w.x); o.y = Math.min(d.y0, w.y); o.w = Math.max(1, Math.abs(w.x - d.x0)); o.h = Math.max(1, Math.abs(w.y - d.y0));
      } else if (d.k === 'size') {
        var q = d.o, dx = w.x - d.wx, dy = w.y - d.wy, min = 60;
        if (d.c.indexOf('e') >= 0) q.w = Math.max(min, d.w + dx);
        if (d.c.indexOf('s') >= 0) q.h = Math.max(min, d.h + dy);
        if (d.c.indexOf('w') >= 0) { q.w = Math.max(min, d.w - dx); q.x = d.x + d.w - q.w; }
        if (d.c.indexOf('n') >= 0) { q.h = Math.max(min, d.h - dy); q.y = d.y + d.h - q.h; }
      } else if (d.k === 'move') {
        var mx = w.x - d.wx, my = w.y - d.wy;
        if (!d.moved && Math.abs(mx) + Math.abs(my) < 3 / s.cam.z) return;
        if (!d.moved) { snap(); d.moved = true; }
        /* Line up with what's already there */
        var moved = d.ids.map(function (id, i) { var r = get(id); return { x: d.from[i][0] + mx, y: d.from[i][1] + my, w: r.w, h: r.h }; });
        var b = AP.bounds(moved), th = 6 / s.cam.z, gx = null, gy = null;
        s.items.concat(s.frames).forEach(function (o) {
          if (d.ids.indexOf(o.id) >= 0 || o.k === 'label') return;
          [[o.x, b.x], [o.x + o.w / 2, b.x + b.w / 2], [o.x + o.w, b.x + b.w], [o.x + o.w, b.x], [o.x, b.x + b.w]].forEach(function (c) { if (Math.abs(c[0] - c[1]) < th && gx === null) gx = { at: c[0], d: c[0] - c[1] }; });
          [[o.y, b.y], [o.y + o.h / 2, b.y + b.h / 2], [o.y + o.h, b.y + b.h], [o.y + o.h, b.y], [o.y, b.y + b.h]].forEach(function (c) { if (Math.abs(c[0] - c[1]) < th && gy === null) gy = { at: c[0], d: c[0] - c[1] }; });
        });
        if (gx) mx += gx.d;
        if (gy) my += gy.d;
        d.ids.forEach(function (id, i) { var r = get(id); r.x = d.from[i][0] + mx; r.y = d.from[i][1] + my; });
        s.guides = [];
        var z = s.cam.z;
        if (gx) s.guides.push({ s: 'left: ' + (gx.at * z + s.cam.x) + 'px; top: 0; width: 1px; height: 100%' });
        if (gy) s.guides.push({ s: 'top: ' + (gy.at * z + s.cam.y) + 'px; left: 0; height: 1px; width: 100%' });
      }
      draw();
    };
    L.pu = function (e) {
      var d = s.drag, w = L.el ? pt(e) : null;
      s.drag = null; s.marq = null; s.guides = [];
      if (!d) return;
      if (d.k === 'link') {
        var q = w, target = s.items.filter(function (o) { return o.id !== d.from && o.k !== 'label' && q.x >= o.x && q.x <= o.x + o.w && q.y >= o.y && q.y <= o.y + o.h; })[0];
        s.draft = null;
        snap();
        if (!target && Math.hypot(q.x - (get(d.from).x + get(d.from).w), q.y - get(d.from).y) > 60) { target = addNote(q.x - 10, q.y - 75, get(d.from).c, ''); s.hist.pop(); s.links.push({ id: uid(), a: d.from, b: target.id }); startEdit(target.id); }
        else if (target) { s.links.push({ id: uid(), a: d.from, b: target.id }); s.sel = []; }
        else s.hist.pop();
        s.tool = 'select';
      } else if (d.k === 'ink') {
        if (d.pts.length > 1) {
          snap();
          s.ink.push({ d: path(d.pts), c: 'horizon' });
        }
      } else if (d.k === 'draw') {
        if (d.o.w < 12 && d.o.h < 12) { d.o.w = d.frame ? 360 : 170; d.o.h = d.frame ? 530 : 84; }
        s.tool = 'select';
        if (!d.frame) startEdit(d.o.id);
      } else if (d.k === 'move') {
        if (d.moved) {
          d.ids.forEach(function (id) { var o = get(id); if (o && o.k === 'note') { var f = frameAt(o.x + o.w / 2, o.y + o.h / 2); o.f = f ? f.id : ''; } });
        } else if (!e.shiftKey && d.single && s.sel.length > 1) s.sel = [d.single];
      }
      draw();
    };
    function path(pts) {
      var r = 'M' + pts[0][0] + ' ' + pts[0][1], i, a, b;
      for (i = 1; i < pts.length - 1; i += 1) { a = pts[i]; b = pts[i + 1]; r += 'Q' + a[0] + ' ' + a[1] + ' ' + (a[0] + b[0]) / 2 + ' ' + (a[1] + b[1]) / 2; }
      return r;
    }
    L.dbl = function (e) {
      var t = e.target;
      if (t.closest('.bi, .bx, .bfly, .bp, .bd-head, .bd-pill, .bd-heard, .bd-tray, .bo-edit')) return;
      var w = pt(e), idEl = t.closest('[data-id]'), id = idEl ? idEl.getAttribute('data-id') : null;
      if (id && !isFrame(id)) { var o = get(id); if (o.k !== 'label') { snap(); startEdit(id); draw(); } return; }
      var nn = addNote(w.x - 75, w.y - 75);
      startEdit(nn.id);
      draw();
    };
    L.kd = function (e) {
      if (e.target.tagName === 'TEXTAREA') return;
      var k = e.key.toLowerCase(), meta = e.metaKey || e.ctrlKey;
      if (k === ' ') { s.space = true; e.preventDefault(); return; }
      if (meta && k === 'z') { e.preventDefault(); L.act(e.shiftKey ? 'redo' : 'undo'); return; }
      if (meta && k === 'd') { e.preventDefault(); duplicate(); draw(); return; }
      if (meta && k === 'a') { e.preventDefault(); s.sel = s.items.map(function (o) { return o.id; }); draw(); return; }
      if (meta) return;
      if (k === 'escape') { stopFollow(); s.tool = 'select'; s.sel = []; s.fly = ''; s.pop = null; draw(); return; }
      if (k === 'backspace' || k === 'delete') { e.preventDefault(); remove(); draw(); return; }
      if (k === '!' || (e.shiftKey && k === '1')) { fitAll(); draw(); return; }
      if (k === '=' || k === '+') { L.act('zoomIn'); return; }
      if (k === '-') { L.act('zoomOut'); return; }
      var tool = { n: 'toolNote', t: 'toolText', s: 'toolShape', l: 'toolLine', p: 'toolPen', f: 'toolFrame' }[k];
      if (tool) { e.preventDefault(); L.act(tool); }
    };
    L.ku = function (e) { if (e.key === ' ') s.space = false; };
    L.wheel = function (e) {
      e.preventDefault();
      e.stopPropagation();
      var w = pt(e);
      stopFollow();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.004), w.sx, w.sy);
      else s.cam = { x: s.cam.x - e.deltaX, y: s.cam.y - e.deltaY, z: s.cam.z };
      s.glide = false;
      draw();
    };
    L.ref = function (el) {
      if (el && el !== L.el) { el.addEventListener('wheel', L.wheel, { passive: false }); el.addEventListener('keyup', L.ku); }
      if (el) L.el = el;
    };

    /* Everyone else */
    var step = function () {
      s.ticks += 1;
      var who = CREW[s.ticks % CREW.length], c = s.others.filter(function (o) { return o[0] === who; })[0];
      var patch = { priya: 'fix', theo: 'well', kofi: 'act', maya: 'act', lena: 'well' }[who];
      var notes = s.items.filter(function (o) { return o.k === 'note' && o.f === patch; });
      var o = notes[(s.ticks * 3 + CREW.indexOf(who)) % Math.max(1, notes.length)];
      if (c && o) { c[1] = o.x + 56 + (s.ticks % 3) * 16; c[2] = o.y + 100 + (s.ticks % 2) * 18; }
      if (s.ticks % 6 === 0 && s.arrivals < ARRIVALS.length) {
        var a = ARRIVALS[s.arrivals], m = s.others.filter(function (x) { return x[0] === a.who; })[0];
        s.arrivals += 1;
        if (m) { m[1] = a.x + 90; m[2] = a.y + 110; m[3] = 'type'; }
        later(function () {
          s.items.push({ id: uid(), k: 'note', c: a.c, t: a.t, by: a.who, x: a.x, y: a.y, w: 150, h: 150, f: a.f, sim: true });
          if (m) m[3] = '';
          draw();
        }, 2600);
      }
      if (s.ticks % 5 === 0) {
        var talk = CREW[(s.ticks / 5) % 4];
        s.others.forEach(function (x) { x[3] = x[3] === 'type' ? 'type' : x[0] === talk ? 'talk' : ''; });
        if (self.props.onLive) self.props.onLive({ speak: talk });
      }
      if (s.ticks === 14 && !s.tray) s.heard = 3;
      if (s.follow) {
        var f = s.others.filter(function (x) { return x[0] === s.follow; })[0];
        if (f) setCam(center(f[1], f[2], Math.max(s.cam.z, 1)), true);
      }
      draw();
    };

    L.mount = function () {
      var d = size();
      s.cam = AP.fit({ x: 0, y: 0, w: 1160, h: 530 }, d.W, d.H);
      timers.push(setInterval(step, 1500));
      timers.push(setInterval(function () { if (s.timer) { s.timer -= 1; draw(); } }, 1000));
    };
    L.unmount = function () { timers.forEach(function (t) { clearTimeout(t); clearInterval(t); }); };
    L.props = function (prev) {
      var w0 = Number(prev && prev.w) || 0, w1 = size().W;
      if (w0 && w0 !== w1 && s.cam) { s.cam = { x: s.cam.x + (w1 - w0) / 2, y: s.cam.y, z: s.cam.z }; draw(); }
      var f = self.props.follow || '', j = self.props.jump || '';
      if (f !== s.follow) { s.follow = f; if (f) { var c = s.others.filter(function (x) { return x[0] === f; })[0]; if (c) setCam(center(c[1], c[2], Math.max(s.cam.z, 1)), true); } draw(); }
      var sh = self.props.shot || '';
      if (sh && sh !== (prev && prev.shot)) {
        snap();
        var d3 = size(), x3 = (d3.W / 2 - s.cam.x) / s.cam.z - 160, y3 = (d3.H / 2 - s.cam.y) / s.cam.z - 114, o3 = { id: uid(), k: 'shot', t: 'Priya’s screen, 10:42', x: x3, y: y3, w: 320, h: 228, f: '' };
        s.items.push(o3); s.sel = [o3.id]; draw();
      }
      if (j && j !== (prev && prev.jump)) { var g = s.others.filter(function (x) { return x[0] === j.split(':')[0]; })[0]; if (g) { setCam(center(g[1], g[2], Math.max(s.cam.z, 1)), true); draw(); } }
    };
    L.model = function () {
      var editing = s.edit, drag = s.drag;
      var ink = s.ink.slice();
      if (drag && drag.k === 'ink' && drag.pts.length > 1) ink.push({ d: path(drag.pts), c: 'horizon' });
      return {
        board: 'retro', items: s.items, frames: s.frames, links: s.links, ink: ink, cam: s.cam, tool: s.tool, sel: s.sel, liveEdit: editing,
        ctx: drag || editing || s.present !== null ? false : undefined, swatch: s.swatch, fly: s.fly, cursors: s.present !== null ? [] : s.others, follow: s.follow, pill: pill(), map: s.map,
        canUndo: s.hist.length > 0, canRedo: s.fut.length > 0, draft: s.draft, glide: s.glide, pop: s.pop, heard: s.heard, tray: s.tray || [],
        dots: s.dots, votes: s.votes, top: s.top, muted: s.muted, chrome: s.present === null, only: s.present !== null ? s.frames[s.present].id : undefined, hover: s.hover, handles: !editing && s.sel.length === 1,
        extra: (s.space || (drag && drag.k === 'pan') ? 'is-pan ' : '')
      };
    };
    L.decorate = function (base, v) {
      var z = s.cam.z, m = s.marq;
      base.pd = L.pd; base.pm = L.pm; base.pu = L.pu; base.dbl = L.dbl; base.kd = L.kd;
      base.guides = s.guides; base.hasGuides = s.guides.length > 0;
      if (m) { base.hasMarquee = true; base.marquee = { x: Math.min(m.x0, m.x1) * z + s.cam.x, y: Math.min(m.y0, m.y1) * z + s.cam.y, w: Math.abs(m.x1 - m.x0) * z, h: Math.abs(m.y1 - m.y0) * z }; }
      v.swatches.forEach(function (w) {
        w.pick = function (e) {
          if (e && e.stopPropagation) e.stopPropagation();
          if (s.sel.length) { snap(); s.items.forEach(function (o) { if (s.sel.indexOf(o.id) >= 0 && (o.k === 'note' || o.k === 'shape')) o.c = w.k; }); s.swatch = false; } else { s.color = w.k; s.fly = ''; }
          draw();
        };
        if (!s.sel.length) w.on = s.color === w.k ? 'true' : 'false';
      });
      ['rect', 'ellipse', 'diamond', 'pill'].forEach(function (k) {
        base.shapeOn[k] = s.shape === k ? 'true' : 'false';
        base.pickShape[k] = function (e) { if (e && e.stopPropagation) e.stopPropagation(); s.shape = k; s.fly = ''; draw(); };
      });
      var eo = s.edit && get(s.edit);
      base.edit = {
        value: eo ? eo.t || '' : '',
        ref: L.tref || (L.tref = function (el) { if (el) { el.focus({ preventScroll: true }); var len = el.value.length; el.setSelectionRange(len, len); } }),
        change: function (e) { var o = get(s.edit); if (o) { o.t = e.target.value; draw(); } },
        blur: function () { if (s.edit) { finishEdit(); draw(); } },
        key: function (e) {
          e.stopPropagation();
          if (e.key === 'Escape') { finishEdit(); L.el.focus({ preventScroll: true }); draw(); }
          if (e.key === 'Tab') {
            e.preventDefault();
            var o = get(s.edit), x = o.x + o.w + 20, y = o.y, f = o.f && get(o.f);
            if (f && x + 150 > f.x + f.w) { x = f.x + 20; y = o.y + o.h + 20; }
            finishEdit();
            var nn = addNote(x, y, o.c);
            startEdit(nn.id);
            draw();
          }
        },
        stop: function (e) { e.stopPropagation(); }
      };
      return base;
    };
    return L;
  }
  return { make: make };
})();
