/* The shell: folder tree, one page at a time on a #hash, the page's header, contents rail and pager. */
(function () {
  var AL = window.AL, I = AL.icon, M = AL.marks, esc = AL.esc;
  var GROUPS = [
    { id: 'brand', num: '01', title: 'Brand', path: 'pages/brand' },
    { id: 'system', num: '02', title: 'Design system', path: 'pages/system' },
    { id: 'screens', num: '03', title: 'Screens', path: 'pages/screens' },
    { id: 'flows', num: '04', title: 'Flows', path: 'pages/flows' }
  ];
  var UPDATED = '2 November 2026';

  function pagesIn(g) {
    return AL.pages.filter(function (p) { return p.group === g; }).sort(function (a, b) { return a.order - b.order; });
  }
  function ordered() {
    var out = [];
    GROUPS.forEach(function (g) { out = out.concat(pagesIn(g.id)); });
    return out;
  }
  function find(id) {
    var all = AL.pages;
    for (var k = 0; k < all.length; k++) if (all[k].id === id) return all[k];
    return null;
  }

  function tree() {
    var open = {};
    try { open = JSON.parse(AL.store.get('open') || '{}'); } catch (e) { open = {}; }
    return GROUPS.map(function (g) {
      var ps = pagesIn(g.id);
      var items = ps.map(function (p) {
        return '<li data-title="' + esc((p.title + ' ' + (p.keywords || '')).toLowerCase()) + '"><a href="#' + p.id + '" data-id="' + p.id + '">' + I(p.icon || 'page') + '<span>' + esc(p.nav || p.title) + '</span></a></li>';
      }).join('');
      var isOpen = open[g.id] !== false;
      return '<li class="al-folder" data-group="' + g.id + '" data-open="' + isOpen + '"><button type="button" aria-expanded="' + isOpen + '" id="fold-' + g.id + '">' +
        '<svg class="al-i al-chev" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-chevright"/></svg>' + I(isOpen ? 'folderopen' : 'folder') +
        '<span class="al-num">' + g.num + '</span>' + esc(g.title) + '<span class="al-count">' + ps.length + '</span></button><ul>' + items + '</ul></li>';
    }).join('');
  }

  function shell() {
    var themes = [['auto', 'auto', 'Auto'], ['light', 'sun', 'Light'], ['dark', 'moon', 'Dark']].map(function (t) {
      return '<button type="button" id="theme-' + t[0] + '" data-theme-mode="' + t[0] + '" aria-pressed="false">' + I(t[1]) + t[2] + '</button>';
    }).join('');
    document.body.insertAdjacentHTML('afterbegin', AL.sprite() + '<pre id="al-err"></pre>' +
      '<div class="al-shell" data-drawer="closed"><nav class="al-nav" aria-label="Brand book">' +
      '<a class="al-nav-head" href="#overview">' + M.mark(30, { glow: false }) + '<span><span class="al-wm">alcove</span><small>Brand book and journeys</small></span></a>' +
      '<div class="al-nav-search">' + I('search') + '<input id="nav-find" type="search" placeholder="Find a page" aria-label="Find a page" autocomplete="off"><kbd class="al-kbd">⌘K</kbd></div>' +
      '<ul class="al-tree">' + tree() + '</ul><p class="al-tree-empty" hidden>No page matches that.</p>' +
      '<div class="al-nav-foot"><div class="al-themes" role="group" aria-label="Appearance">' + themes + '</div>' +
      '<p>Version 3, private calls · updated ' + UPDATED + '. Built from the Privacy Suite docs.</p></div></nav>' +
      '<div class="al-scrim" id="al-scrim"></div><div class="al-main"><div class="al-topbar"><button class="al-icon-btn" type="button" id="nav-open" aria-label="Open the page list">' +
      I('menu') + '</button>' + M.mark(22, { glow: false }) + '<span class="al-wm">alcove</span><span id="top-where"></span></div>' +
      '<div class="al-view" id="al-view"></div></div></div>');
  }

  function header(p, g) {
    if (p.bare) return '';
    var meta = '<span>' + I('calendar') + 'Updated ' + UPDATED + '</span><span>' + I('code') + esc(g.path + '/' + (p.file || p.id) + '.js') + '</span>' +
      (p.meta || []).map(function (m) { return '<span>' + I(m[0]) + esc(m[1]) + '</span>'; }).join('');
    return '<header class="al-head" data-rise style="--i:0"><p class="al-crumbs">' + I('folder') + 'alcove ' + I('chevright') + esc(g.num + ' ' + g.title) +
      I('chevright') + '<b>' + esc(p.title) + '</b></p><h1>' + esc(p.title) + '</h1><p class="al-lede">' + esc(p.lede || '') + '</p><div class="al-meta">' + meta + '</div></header>';
  }
  function pager(p) {
    var list = ordered(), k = list.indexOf(p), prev = list[k - 1], next = list[k + 1];
    return '<nav class="al-pager" aria-label="Previous and next page">' +
      (prev ? '<a href="#' + prev.id + '"><span>Previous</span><b>' + esc(prev.title) + '</b></a>' : '<span></span>') +
      (next ? '<a class="next" href="#' + next.id + '"><span>Next</span><b>' + esc(next.title) + '</b></a>' : '') + '</nav>' +
      '<p class="al-source">' + I('info') + 'Sample data in every mockup. Version 3 describes private calls with built-in notes; the engineering docs in the repository still describe the earlier product and are next to update.</p>';
  }

  function toc(view) {
    var secs = Array.prototype.filter.call(view.querySelectorAll('.al-sec[id]'), function (s) { return s.querySelector('.al-sec-h h2'); });
    var rail = view.querySelector('.al-toc');
    if (!rail) return;
    if (secs.length < 2) { rail.innerHTML = ''; return; }
    rail.innerHTML = '<p>On this page</p><ol>' + Array.prototype.map.call(secs, function (s) {
      var h = s.querySelector('h2');
      return '<li><a href="#" data-sec="' + s.id + '">' + esc(h ? h.textContent : s.id) + '</a></li>';
    }).join('') + '</ol>';
    rail.addEventListener('click', function (e) {
      var a = e.target.closest('a[data-sec]');
      if (!a) return;
      e.preventDefault();
      var t = document.getElementById(a.getAttribute('data-sec'));
      if (t) t.scrollIntoView({ behavior: AL.reduce ? 'auto' : 'smooth', block: 'start' });
    });
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          AL.each(rail, 'a', function (a) { a.setAttribute('aria-current', String(a.getAttribute('data-sec') === en.target.id)); });
        });
      }, { rootMargin: '-20% 0px -70% 0px' });
      Array.prototype.forEach.call(secs, function (s) { io.observe(s); });
      AL.onLeave(function () { io.disconnect(); });
    }
  }

  function route() {
    var id = (location.hash || '').slice(1) || 'overview';
    var p = find(id) || find('overview');
    var g = GROUPS.filter(function (x) { return x.id === p.group; })[0];
    AL.cleanups.splice(0).forEach(function (fn) { try { fn(); } catch (e) { /* keep going */ } });
    var view = document.getElementById('al-view');
    var html = '';
    try { html = p.render(); } catch (e) { html = '<p class="al-banner al-banner--problem">This page couldn’t draw: ' + esc(e.message) + '</p>'; setTimeout(function () { throw e; }); }
    view.className = 'al-view' + (p.bare || p.group === 'screens' || p.group === 'flows' ? ' is-wide' : '');
    view.innerHTML = '<article class="al-page">' + header(p, g) + html + pager(p) + '</article><aside class="al-toc" aria-label="On this page"></aside>';
    AL.each(view, '.al-page > .al-sec, .al-page > .cover, .al-page > .al-pager', function (s, k) { s.setAttribute('data-rise', ''); s.style.setProperty('--i', k + 1); });
    AL.fitAll(view);
    if (p.mount) { try { p.mount(view); } catch (e) { setTimeout(function () { throw e; }); } }
    toc(view);
    AL.each(document, '.al-tree a', function (a) { a.setAttribute('aria-current', a.getAttribute('data-id') === p.id ? 'page' : 'false'); });
    var fold = document.querySelector('.al-folder[data-group="' + p.group + '"]');
    if (fold && fold.getAttribute('data-open') !== 'true') toggleFolder(fold, true);
    var where = document.getElementById('top-where');
    if (where) where.textContent = g.title + ' · ' + p.title;
    document.querySelector('.al-shell').setAttribute('data-drawer', 'closed');
    window.scrollTo(0, 0);
  }

  function toggleFolder(li, force) {
    var open = force != null ? force : li.getAttribute('data-open') !== 'true';
    li.setAttribute('data-open', String(open));
    var b = li.querySelector('button');
    b.setAttribute('aria-expanded', String(open));
    var use = b.querySelectorAll('use')[1];
    if (use) use.setAttribute('href', '#i-' + (open ? 'folderopen' : 'folder'));
    var state = {};
    AL.each(document, '.al-folder', function (f) { state[f.getAttribute('data-group')] = f.getAttribute('data-open') === 'true'; });
    AL.store.set('open', JSON.stringify(state));
  }

  function setTheme(mode) {
    document.body.classList.remove('t-light', 't-dark');
    if (mode === 'light' || mode === 'dark') document.body.classList.add('t-' + mode);
    AL.each(document, '[data-theme-mode]', function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-theme-mode') === mode)); });
    AL.store.set('theme', mode);
  }

  function wire() {
    document.querySelector('.al-tree').addEventListener('click', function (e) {
      var b = e.target.closest('.al-folder > button');
      if (b) toggleFolder(b.parentNode);
    });
    AL.each(document, '[data-theme-mode]', function (b) { b.addEventListener('click', function () { setTheme(b.getAttribute('data-theme-mode')); }); });
    var find = document.getElementById('nav-find');
    find.addEventListener('input', function () {
      var q = find.value.trim().toLowerCase(), any = false;
      AL.each(document, '.al-folder', function (f) {
        var shown = 0;
        AL.each(f, 'li', function (li) { var hit = !q || li.getAttribute('data-title').indexOf(q) >= 0; li.hidden = !hit; if (hit) shown += 1; });
        f.hidden = shown === 0;
        if (q && shown) f.setAttribute('data-open', 'true');
        if (shown) any = true;
      });
      document.querySelector('.al-tree-empty').hidden = any;
    });
    find.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var first = document.querySelector('.al-folder:not([hidden]) li:not([hidden]) a');
        if (first) { location.hash = first.getAttribute('href'); find.blur(); }
      }
      if (e.key === 'Escape') { find.value = ''; find.dispatchEvent(new Event('input')); }
    });
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); document.querySelector('.al-shell').setAttribute('data-drawer', 'open'); find.focus(); }
    });
    document.getElementById('nav-open').addEventListener('click', function () { document.querySelector('.al-shell').setAttribute('data-drawer', 'open'); });
    document.getElementById('al-scrim').addEventListener('click', function () { document.querySelector('.al-shell').setAttribute('data-drawer', 'closed'); });
    window.addEventListener('hashchange', route);
  }

  function start() {
    shell();
    wire();
    setTheme(AL.store.get('theme') || 'auto');
    route();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
