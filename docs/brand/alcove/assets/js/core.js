/* Alcove brand book: shared namespace, helpers and the icon set. Pages register themselves with AL.page. */
(function () {
  var AL = window.AL = { pages: [], ui: {}, marks: {}, art: {}, cleanups: [] };

  // Errors are kept in a hidden element so a broken page can be found in testing.
  window.addEventListener('error', function (e) {
    var el = document.getElementById('al-err');
    if (el) el.textContent += (e.message || 'error') + ' @ ' + (e.filename || '') + ':' + (e.lineno || '') + '\n';
  });

  try { AL.reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { AL.reduce = false; }
  AL.esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  AL.page = function (def) { AL.pages.push(def); };
  var n = 0;
  AL.uid = function (p) { n += 1; return (p || 'u') + n; };
  AL.each = function (root, sel, fn) { Array.prototype.forEach.call((root || document).querySelectorAll(sel), fn); };
  AL.store = {
    get: function (k) { try { return window.localStorage.getItem('alcove:' + k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem('alcove:' + k, v); } catch (e) { /* storage may be unavailable */ } }
  };
  AL.onLeave = function (fn) { AL.cleanups.push(fn); };
  AL.fmt = function (v) { return Number(v).toLocaleString('en-US'); };

  // Count a figure from one value to another; reduced motion shows the end at once.
  AL.count = function (el, from, to, ms, fmt) {
    var f = fmt || AL.fmt;
    if (AL.reduce || !el) { if (el) el.textContent = f(to); return function () {}; }
    var t0 = null, raf = 0;
    function step(t) {
      if (t0 === null) t0 = t;
      var k = Math.min(1, (t - t0) / (ms || 900)), e = 1 - Math.pow(1 - k, 3);
      el.textContent = f(Math.round(from + (to - from) * e));
      if (k < 1) raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    return function () { cancelAnimationFrame(raf); };
  };

  // Reveal text word by word, as an answer streams in. Returns a cancel function.
  AL.type = function (el, text, opts) {
    var o = opts || {}, words = text.split(/(\s+)/), i = 0, timer = 0;
    if (!el) return function () {};
    if (AL.reduce) { el.innerHTML = o.html || AL.esc(text); if (o.done) o.done(); return function () {}; }
    el.textContent = '';
    el.classList.add('al-caret');
    function next() {
      i += 1;
      el.textContent = words.slice(0, i).join('');
      if (i < words.length) timer = setTimeout(next, o.ms || 55);
      else { el.classList.remove('al-caret'); if (o.html) el.innerHTML = o.html; if (o.done) o.done(); }
    }
    timer = setTimeout(next, o.delay || 0);
    return function () { clearTimeout(timer); };
  };

  // Fit a fixed-size picture of the app into its frame, scaling it to the frame's width.
  AL.fit = function (frame, w, h) {
    var W = w || 1100, H = h || 690;
    function apply() {
      var s = Math.min(1.25, frame.clientWidth / W);
      frame.style.height = Math.round(H * s) + 'px';
      AL.each(frame, ':scope > .al-scale, :scope .fl-shot > .al-scale', function (el) { el.style.setProperty('--s', s); });
      frame.style.setProperty('--s', s);
    }
    apply();
    if ('ResizeObserver' in window) {
      var ro = new ResizeObserver(apply);
      ro.observe(frame);
      AL.onLeave(function () { ro.disconnect(); });
    } else {
      window.addEventListener('resize', apply);
      AL.onLeave(function () { window.removeEventListener('resize', apply); });
    }
    return apply;
  };
  AL.frame = function (inner, w, h) {
    return '<div class="al-frame" data-fit="' + (w || 1100) + 'x' + (h || 690) + '"><div class="al-scale">' + inner + '</div></div>';
  };
  AL.fitAll = function (root) {
    AL.each(root, '.al-frame[data-fit]', function (f) {
      var p = f.getAttribute('data-fit').split('x');
      AL.fit(f, +p[0], +p[1]);
    });
  };

  // ---------- icons: 24 grid, 1.7 stroke, round caps and joins ----------
  var D = 'fill="currentColor" stroke="none"';
  AL.ICONS = {
    lamp: '<path d="M8.5 3.5h7L19 11H5z"/><path d="M12 11v9.5M8 20.5h8"/>',
    arch: '<path d="M5.5 20.5V11a6.5 6.5 0 0 1 13 0v9.5"/><path d="M3.5 20.5h17"/><circle cx="12" cy="14.5" r="1.7" ' + D + '/>',
    door: '<path d="M6.5 20.5V5a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 17.5 5v15.5"/><path d="M4 20.5h16"/><circle cx="14.6" cy="12.5" r="1" ' + D + '/>',
    shelf: '<path d="M3.5 20.5h17"/><path d="M6 20.5V6h3.2v14.5M10.7 20.5V4h3.2v16.5"/><path d="M15.3 20.5l-1.4-11.7 3-.4 1.6 12.1"/>',
    page: '<rect x="4.5" y="3.5" width="15" height="17" rx="2"/><path d="M8 8.5h8M8 12h8M8 15.5h5"/>',
    file: '<path d="M6.5 3.5H14l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M14 3.5V8h4.5"/>',
    pdf: '<path d="M6.5 3.5H14l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M14 3.5V8h4.5"/><rect x="8" y="12" width="8" height="4.5" rx="1"/>',
    md: '<path d="M6.5 3.5H14l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M14 3.5V8h4.5"/><path d="M10.2 11.5l-.8 5.5M13.4 11.5l-.8 5.5M8.3 13.3h5.9M7.9 15.3h5.9"/>',
    txt: '<path d="M6.5 3.5H14l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M14 3.5V8h4.5"/><path d="M8 12h8M8 15h8M8 18h4.5"/>',
    wave: '<path d="M3 12h1.5M7 8.5v7M10.5 5v14M14 8v8M17.5 10v4M21 12h-.5"/>',
    meeting: '<rect x="2.5" y="6.5" width="13" height="11" rx="2"/><path d="M15.5 10.5l6-3.5v10l-6-3.5"/>',
    mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3"/>',
    micoff: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3M4 4l16 16"/>',
    record: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.6" ' + D + '/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
    ask: '<path d="M5.5 4.5h13A2.5 2.5 0 0 1 21 7v7.5a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3.5V17h-1A2.5 2.5 0 0 1 3 14.5V7a2.5 2.5 0 0 1 2.5-2.5z"/><path d="M8 9.5h8M8 12.5h5"/>',
    bookmark: '<path d="M7 3.5h10a1 1 0 0 1 1 1v16l-6-4-6 4v-16a1 1 0 0 1 1-1z"/>',
    quote: '<path d="M10 7.5H5.5v5H10v1a3.5 3.5 0 0 1-3.5 3.5M19.5 7.5H15v5h4.5v1A3.5 3.5 0 0 1 16 17"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    upload: '<path d="M12 15V4.5M7.5 9L12 4.5 16.5 9"/><path d="M5 15.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2.5"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    unlock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 7.6-1.8"/>',
    key: '<circle cx="8" cy="15.5" r="4"/><path d="M11 12.5l8.5-8.5M16.5 7l2.2 2.2M14.3 9.2l1.6 1.6"/>',
    fingerprint: '<path d="M6 18.5a12.5 12.5 0 0 1-1.5-6A7.5 7.5 0 0 1 17 7"/><path d="M19 10.5c.3.8.5 1.6.5 2.5v1"/><path d="M9 20a11 11 0 0 1-1.5-5.5V13a4.5 4.5 0 0 1 9 0v1.5"/><path d="M12 13v1.5a12 12 0 0 0 2 6.5"/><path d="M16.5 18a14 14 0 0 1-.4-1.6"/>',
    shield: '<path d="M12 3.5l7 2.5v5.5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z"/><path d="M9 12l2.2 2.2L15.2 10"/>',
    server: '<rect x="4" y="4.5" width="16" height="6" rx="1.5"/><rect x="4" y="13.5" width="16" height="6" rx="1.5"/><circle cx="7.5" cy="7.5" r="1" ' + D + '/><circle cx="7.5" cy="16.5" r="1" ' + D + '/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    eyeoff: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/><path d="M4 4l16 16"/>',
    credits: '<path d="M5 7c0-1.4 3.1-2.5 7-2.5S19 5.6 19 7s-3.1 2.5-7 2.5S5 8.4 5 7z"/><path d="M5 7v5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V7"/><path d="M5 12v5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-5"/>',
    receipt: '<path d="M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>',
    wallet: '<path d="M16 4.5H5.5A1.5 1.5 0 0 0 4 6v12a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 18V9a1.5 1.5 0 0 0-1.5-1.5H4.5"/><path d="M20 11h-3.5a2 2 0 0 0 0 4H20"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    hourglass: '<path d="M7 3.5h10M7 20.5h10"/><path d="M8 3.5v3l4 5.5 4-5.5v-3M8 20.5v-3l4-5.5 4 5.5v3"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    checkcircle: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.3l2.4 2.4 4.6-4.9"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.8v5"/><circle cx="12" cy="16.2" r="1" ' + D + '/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.2"/><circle cx="12" cy="7.9" r="1" ' + D + '/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.5"/><circle cx="12" cy="16.6" r="1" ' + D + '/>',
    chevright: '<path d="M9.5 6l6 6-6 6"/>',
    chevleft: '<path d="M14.5 6l-6 6 6 6"/>',
    chevdown: '<path d="M6 9.5l6 6 6-6"/>',
    arrowup: '<path d="M12 19V5.5M6.5 11L12 5.5 17.5 11"/>',
    arrowright: '<path d="M5 12h13.5M13 6.5l5.5 5.5-5.5 5.5"/>',
    more: '<circle cx="6" cy="12" r="1.4" ' + D + '/><circle cx="12" cy="12" r="1.4" ' + D + '/><circle cx="18" cy="12" r="1.4" ' + D + '/>',
    edit: '<path d="M15.5 4.5l4 4L9 19H5v-4z"/><path d="M13.5 6.5l4 4"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7"/><path d="M6.5 7l1 12.5a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1L17.5 7"/>',
    folder: '<path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4.5l2 2.5H19a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
    folderopen: '<path d="M3.5 17.5V6.5A1.5 1.5 0 0 1 5 5h4.5l2 2.5H17a1.5 1.5 0 0 1 1.5 1.5v1.5"/><path d="M3.5 17.5l2.4-6a1.5 1.5 0 0 1 1.4-1h13.2l-2.6 7.1a1.5 1.5 0 0 1-1.4 1H4.5"/>',
    sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4"/>',
    moon: '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"/>',
    auto: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" ' + D + '/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9"/><path d="M19.5 4.5V9H15"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z"/>',
    pause: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
    calendar: '<rect x="4" y="5" width="16" height="15.5" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
    user: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
    users: '<circle cx="9" cy="8.5" r="3.3"/><path d="M3 19.5a6 6 0 0 1 12 0"/><path d="M15.5 5.6a3.3 3.3 0 0 1 0 6M17.5 14.2a6 6 0 0 1 3.5 5.3"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5s1.1-6.1 3.4-8.5z"/>',
    external: '<path d="M14 4.5h5.5V10M19.5 4.5L11 13"/><path d="M17 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7H10"/>',
    menu: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
    book: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 16l4.5-4.5 4 4 2.5-2.5 6 6"/><circle cx="15.5" cy="9" r="1.6"/>',
    palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-1 2-2 0-1.5-1.5-1.8-1.5-3 0-1 .8-1.5 2-1.5h2.5a3.5 3.5 0 0 0 3.5-3.5c0-4-3.8-7-8.5-7z"/><circle cx="7.6" cy="11" r="1.1" ' + D + '/><circle cx="9.8" cy="7.4" r="1.1" ' + D + '/><circle cx="14.4" cy="7.2" r="1.1" ' + D + '/>',
    type: '<path d="M4.5 6.5V5h11v1.5M10 5v14M7.5 19h5"/><path d="M14.5 12.5V11h6v1.5M17.5 11v8M16 19h3"/>',
    shapes: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><circle cx="17" cy="7.5" r="3.5"/><path d="M4 20.5v-3.5a3.5 3.5 0 0 1 7 0v3.5z"/><path d="M14 13.5l6 7h-6z"/>',
    layout: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 9h17M9 9v11.5"/>',
    motion: '<path d="M3 8h6M2 12h5M3 16h6"/><circle cx="15.5" cy="12" r="5.5"/>',
    blocks: '<rect x="4" y="4" width="7" height="7" rx="1.8"/><rect x="13" y="4" width="7" height="7" rx="1.8"/><rect x="4" y="13" width="7" height="7" rx="1.8"/><rect x="13" y="13" width="7" height="7" rx="3.5"/>',
    code: '<path d="M8.5 7l-5 5 5 5M15.5 7l5 5-5 5"/>',
    screen: '<rect x="2.5" y="4.5" width="19" height="12.5" rx="1.8"/><path d="M9 21h6M12 17v4"/>',
    flow: '<circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="M6 8.2V12a3 3 0 0 0 3 3h6.8"/>',
    sparkdot: '<circle cx="12" cy="12" r="3" ' + D + '/><circle cx="12" cy="12" r="7" />'
  };
  AL.icon = function (name, cls) {
    return '<svg class="al-i ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#i-' + name + '"/></svg>';
  };
  AL.sprite = function () {
    var s = '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>';
    Object.keys(AL.ICONS).forEach(function (k) { s += '<symbol id="i-' + k + '" viewBox="0 0 24 24">' + AL.ICONS[k] + '</symbol>'; });
    return s + '</defs></svg>';
  };
})();
