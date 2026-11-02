/*
 * The flow player. A flow is a list of steps; each step draws one picture of the app and may script it
 * (typing, counting, a state changing). The player plays while it is on screen, holds when the reader
 * takes over, and stops at the last step. Reduced motion starts paused and cuts between steps.
 */
(function () {
  var AL = window.AL, I = AL.icon, esc = AL.esc;

  // Timers and scripted moments for one step, cancelled together when the step leaves.
  AL.seq = function (el) {
    var timers = [], cancels = [], depth = 0;
    var api = {
      q: function (sel) { return el.querySelector(sel); },
      at: function (ms, fn) {
        if (!AL.reduce) { timers.push(setTimeout(fn, ms)); return api; }
        if (depth < 60) { depth += 1; fn(); depth -= 1; }
        return api;
      },
      type: function (sel, text, o) { cancels.push(AL.type(el.querySelector(sel), text, o)); return api; },
      count: function (sel, from, to, ms, fmt) { cancels.push(AL.count(el.querySelector(sel), from, to, ms, fmt)); return api; },
      add: function (sel, cls) { var t = el.querySelector(sel); if (t) t.classList.add(cls); return api; },
      show: function (sel) { AL.each(el, sel, function (t) { t.style.display = ''; t.style.animation = 'al-rise var(--al-t-rise) var(--al-ease-out) both'; }); return api; },
      html: function (sel, h) { var t = el.querySelector(sel); if (t) t.innerHTML = h; return api; },
      stop: function () { timers.forEach(clearTimeout); cancels.forEach(function (c) { if (c) c(); }); }
    };
    return api;
  };

  AL.player = function (root, flow) {
    var steps = flow.steps, n = steps.length, i = -1, playing = !AL.reduce, visible = false;
    var elapsed = 0, last = 0, raf = 0, cleanup = null, ended = false;
    var id = 'fl-' + flow.id;
    var list = steps.map(function (s, k) {
      return '<li class="fl-step"><button type="button" data-k="' + k + '" id="' + id + '-s' + k + '"><span class="n"><em>' + (k + 1) + '</em>' + I('check') + '</span>' +
        '<b>' + esc(s.title) + '</b><span class="l">' + esc(s.line) + '</span><span class="bar"><i></i></span></button></li>';
    }).join('');
    root.innerHTML = '<div class="fl"><ol class="fl-steps" aria-label="Steps">' + list + '</ol><div class="fl-stage">' +
      '<div class="fl-backdrop"><div class="al-frame"><div class="fl-shots"></div></div></div><div class="fl-capbox" aria-live="polite"></div></div></div>';
    var frame = root.querySelector('.al-frame'), shots = root.querySelector('.fl-shots'), capbox = root.querySelector('.fl-capbox');
    AL.fit(frame, 1100, 690);

    function controls() {
      var label = ended ? 'Play again' : (playing ? 'Pause' : 'Play');
      var icon = ended ? 'refresh' : (playing ? 'pause' : 'play');
      return '<div class="fl-ctrl"><button class="al-icon-btn" type="button" id="' + id + '-prev" aria-label="Previous step">' + I('chevleft') + '</button>' +
        '<button class="al-icon-btn play" type="button" id="' + id + '-play" aria-label="' + label + '">' + I(icon) + label + '</button>' +
        '<button class="al-icon-btn" type="button" id="' + id + '-next" aria-label="Next step">' + I('chevright') + '</button>' +
        '<span class="fl-count">' + (i + 1) + ' of ' + n + '</span></div>';
    }
    function caption() {
      var s = steps[i];
      var truth = (s.truth || []).map(function (t) { return '<code>' + esc(t) + '</code>'; }).join('');
      capbox.innerHTML = '<div class="fl-cap fl-cap-wrap"><div><p class="al-eyebrow">' + esc(flow.kicker || 'Step') + ' · step ' + (i + 1) + ' of ' + n + '</p>' +
        '<h3>' + esc(s.title) + '</h3><p>' + esc(s.body) + '</p>' + (truth ? '<div class="fl-truth">' + truth + '</div>' : '') + '</div>' + controls() + '</div>';
    }
    function refreshControls() {
      var c = capbox.querySelector('.fl-ctrl');
      if (c) c.outerHTML = controls();
    }
    function marks() {
      AL.each(root, '.fl-step', function (li, k) {
        li.classList.toggle('is-now', k === i);
        li.classList.toggle('is-done', k < i);
        li.querySelector('button').setAttribute('aria-current', k === i ? 'step' : 'false');
      });
    }
    function show(k) {
      if (cleanup) { cleanup(); cleanup = null; }
      i = (k + n) % n;
      ended = false;
      AL.each(shots, '.fl-shot', function (old) {
        old.classList.remove('is-in');
        old.classList.add('is-out');
        setTimeout(function () { if (old.parentNode) old.parentNode.removeChild(old); }, AL.reduce ? 0 : 280);
      });
      var el = document.createElement('div');
      el.className = 'fl-shot is-in';
      el.innerHTML = '<div class="al-scale">' + steps[i].screen() + '</div>';
      shots.appendChild(el);
      if (steps[i].enter) cleanup = steps[i].enter(el) || null;
      elapsed = 0;
      caption();
      marks();
      setProgress(0);
      if (raf !== undefined) loop();
    }
    function setProgress(p) {
      var li = root.querySelectorAll('.fl-step')[i];
      if (li) li.style.setProperty('--p', Math.min(1, p).toFixed(3));
    }
    function loop() { if (!raf) { last = 0; raf = requestAnimationFrame(tick); } }
    function tick(now) {
      raf = 0;
      var dt = last ? now - last : 0;
      last = now;
      if (playing && visible && !ended) {
        elapsed += dt;
        var dur = steps[i].dur || 5600;
        setProgress(elapsed / dur);
        if (elapsed >= dur) {
          if (i < n - 1) show(i + 1);
          else { ended = true; playing = false; refreshControls(); }
        }
      }
      if (playing && visible && !ended) raf = requestAnimationFrame(tick);
    }

    root.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || !root.contains(b)) return;
      if (b.hasAttribute('data-k')) { show(+b.getAttribute('data-k')); loop(); return; }
      if (b.id === id + '-prev') show(i - 1);
      else if (b.id === id + '-next') show(i + 1);
      else if (b.id === id + '-play') {
        if (ended) { playing = true; show(0); }
        else { playing = !playing; refreshControls(); }
      }
      loop();
    });
    root.addEventListener('keydown', function (e) {
      if (e.target.closest('input, textarea')) return;
      if (e.key === 'ArrowRight') { show(i + 1); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { show(i - 1); e.preventDefault(); }
    });
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) { visible = entries[0].isIntersecting; if (visible) loop(); }, { threshold: 0.3 });
      io.observe(frame);
      AL.onLeave(function () { io.disconnect(); });
    } else visible = true;

    show(window.AL_TEST_STEP || 0);
    loop();
    AL.onLeave(function () { cancelAnimationFrame(raf); if (cleanup) cleanup(); });
  };

  // A still screen framed on the dusk stage, used by the Screens pages and the component library.
  AL.stage = function (inner, cls) {
    return '<div class="sc-stage ' + (cls || '') + '">' + AL.frame(inner) + '</div>';
  };
})();

/* A flow page: the journey's player, then what the product guarantees behind it. */
(function () {
  var AL = window.AL, esc = AL.esc;
  AL.flowPage = function (def) {
    AL.page({
      id: def.id, group: 'flows', order: def.order, title: def.title, nav: def.nav, icon: def.icon || 'flow', file: def.file, keywords: def.keywords || '',
      lede: def.lede, meta: [['flow', def.steps.length + ' steps'], ['clock', def.time || 'About a minute to watch']],
      render: function () {
        var notes = (def.notes || []).map(function (n) {
          return '<div class="al-panel"><h3 class="al-h3">' + esc(n[0]) + '</h3><ul>' + n[1].map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
        }).join('');
        return '<section class="al-sec" id="journey"><div class="al-sec-h"><p class="al-eyebrow">The journey</p><h2>' + esc(def.headline) + '</h2><p>' + esc(def.summary) +
          ' It plays while it is on screen; select a step, use the arrow keys, or pause at any time.</p></div><div class="js-player"></div></section>' +
          (notes ? '<section class="al-sec" id="guarantees"><div class="al-sec-h"><p class="al-eyebrow">Behind it</p><h2>What the product guarantees</h2></div><div class="fl-notes al-stagger">' + notes + '</div></section>' : '');
      },
      mount: function (view) { AL.player(view.querySelector('.js-player'), { id: def.id, kicker: def.kicker || def.title, steps: def.steps }); }
    });
  };
})();
