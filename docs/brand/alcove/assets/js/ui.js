/* App building blocks, part one: window, sidebar, shelf, document, editor and Ask. Each returns HTML. */
(function () {
  var AL = window.AL, U = AL.ui, I = AL.icon, M = AL.marks, esc = AL.esc;

  U.ITEMS = [
    { id: 'memo', icon: 'page', title: 'Q4 board memo', meta: 'Page · edited 2 Nov' },
    { id: 'hiring', icon: 'page', title: 'Hiring plan', meta: 'Page', tag: 'Draft' },
    { id: 'lease', icon: 'pdf', title: 'Lease agreement v3.pdf', meta: 'PDF · 14 pages' },
    { id: 'terms', icon: 'md', title: 'Term sheet.md', meta: 'Markdown · 9 KB' },
    { id: 'notes', icon: 'txt', title: 'Diligence notes.txt', meta: 'Text · 31 KB', state: 'reading' },
    { id: 'board', icon: 'wave', title: 'Board prep call', meta: 'Notes · 31 Oct · 28 min' },
    { id: 'investor', icon: 'record', title: 'Investor call', meta: 'Recording now', state: 'rec' },
    { id: 'offer', icon: 'pdf', title: 'Offer letter, M. Chen.pdf', meta: 'PDF · 3 pages' }
  ];
  U.item = function (id) { for (var i = 0; i < U.ITEMS.length; i++) if (U.ITEMS[i].id === id) return U.ITEMS[i]; return null; };

  U.state = function (kind, text, extra) {
    return '<span class="al-state al-state--' + kind + ' ' + (extra || '') + '">' + esc(text) + '</span>';
  };
  U.btn = function (kind, text, icon, extra) {
    return '<span class="al-btn al-btn--' + kind + ' ' + (extra || '') + '">' + (icon ? I(icon) : '') + esc(text) + '</span>';
  };

  U.lampline = function (lamp, closes) {
    if (lamp === 'off') return '<span class="al-lampline"><span class="al-lamp"></span>Closed</span>';
    if (lamp === 'rec') return '<span class="al-lampline"><span class="al-lamp is-rec"></span>Recording · 18:42</span>' + U.btn('secondary', 'Close', 'lock', 'al-btn--sm');
    if (lamp === 'warming') return '<span class="al-lampline"><span class="al-lamp is-on is-warming"></span>Lamp on · closes in 15 min</span>' + U.btn('secondary', 'Close', 'lock', 'al-btn--sm');
    return '<span class="al-lampline"><span class="al-lamp is-on"></span>Lamp on · closes in ' + esc(closes || '14 min') + '</span>' + U.btn('secondary', 'Close', 'lock', 'al-btn--sm');
  };

  U.win = function (o) {
    o = o || {};
    var lamp = o.lamp || 'on';
    var bar = '<div class="ap-bar"><span class="ap-lights" aria-hidden="true"><i></i><i></i><i></i></span><span class="ap-title">' +
      esc(o.title || 'Alcove') + '</span><span class="ap-bar-r">' + (o.barRight != null ? o.barRight : U.lampline(lamp, o.closes)) + '</span></div>';
    var body;
    if (o.raw) body = o.raw;
    else {
      var cls = 'ap-body' + (o.aside ? ' has-aside' : '') + (o.side === false ? ' no-side' : '');
      var so = o.sideOpts || {};
      if (!so.lamp) so.lamp = lamp;
      body = '<div class="' + cls + '">' + (o.side === false ? '' : U.side(so)) + '<div class="ap-main">' + (o.main || '') + '</div>' +
        (o.aside ? '<div class="ap-aside">' + o.aside + '</div>' : '') + '</div>';
    }
    return '<div class="ap ' + (o.cls || '') + '" role="img" aria-label="' + esc(o.label || 'Alcove app') + '">' + bar + body +
      (o.overlay ? '<div class="ap-overlay">' + o.overlay + '</div>' : '') +
      (o.toasts ? '<div class="ap-toastzone">' + o.toasts + '</div>' : '') + (o.extra || '') + '</div>';
  };

  U.side = function (o) {
    o = o || {};
    var active = o.active || 'shelf', lamp = o.lamp || 'on';
    var nav = [['shelf', 'arch', 'Shelf', '37'], ['ask', 'ask', 'Ask', ''], ['meetings', 'meeting', 'Meetings', o.rec ? 'rec' : '3'], ['credits', 'credits', 'Credits', o.credits || '9,209']];
    var n = nav.map(function (r) {
      var ct = r[3] === 'rec' ? '<span class="ct rec">Live</span>' : (r[3] ? '<span class="ct">' + esc(r[3]) + '</span>' : '');
      return '<div class="' + (r[0] === active ? 'is-on' : '') + '">' + I(r[1]) + esc(r[2]) + ct + '</div>';
    }).join('');
    var recent = (o.recent || ['lease', 'memo', 'board', 'terms']).map(function (id) {
      var it = U.item(id);
      return '<div class="' + (id === o.open ? 'is-on' : '') + '">' + I(it.icon) + '<span>' + esc(it.title) + '</span></div>';
    }).join('');
    var lampEl = lamp === 'off' ? '<span class="al-lamp"></span>' : (lamp === 'rec' ? '<span class="al-lamp is-rec"></span>' : '<span class="al-lamp is-on"></span>');
    return '<div class="ap-side"><div class="ap-brand">' + M.mark(20, { lit: lamp !== 'off', glow: false }) + '<span class="al-wm">alcove</span>' + lampEl + '</div>' +
      '<div class="ap-search">' + I('search') + 'Find something<span class="al-kbd">⌘K</span></div>' +
      '<div class="ap-nav">' + n + '</div><div class="ap-group">Recent</div><div class="ap-recent">' + recent + '</div>' +
      '<div class="ap-side-foot"><div class="al-progress" style="--p:21%"><i></i></div><span>' + esc(o.storage || '37 of 500 items · 212 MB of 1 GiB') + '</span>' +
      '<div style="display:flex;align-items:center;gap:8px;color:var(--al-ink-2);font-size:13.5px">' + I('sliders') + 'Preferences</div></div></div>';
  };

  function stateFor(it) {
    if (it.state === 'reading') return U.state('working', 'Reading it…', 'al-state--sm');
    if (it.state === 'rec') return U.state('rec', 'Recording', 'al-state--sm');
    if (it.state === 'ready') return U.state('done', 'Ready to ask', 'al-state--sm');
    if (it.state === 'unsupported') return U.state('unknown', 'Can’t read this', 'al-state--sm');
    if (it.tag) return '<span class="al-tag">' + esc(it.tag) + '</span>';
    return '';
  }
  U.filecard = function (it, extra) {
    return '<div class="al-filecard ' + (extra || '') + '"><div class="thumb"><i></i><i></i><i></i><i></i><i></i></div>' +
      '<div class="t">' + I(it.icon) + '<span>' + esc(it.title) + '</span></div><div class="m"><span>' + esc(it.meta) + '</span>' + stateFor(it) + '</div></div>';
  };

  U.shelf = function (o) {
    o = o || {};
    var items = (o.ids || ['lease', 'memo', 'board', 'terms', 'notes', 'hiring', 'investor', 'offer']).map(function (id) {
      var it = Object.assign({}, U.item(id));
      if (o.states && o.states[id]) it.state = o.states[id];
      return it;
    });
    var head = '<div class="ap-head"><h2>Shelf</h2><span class="al-seg"><span class="is-on">All</span><span>Pages</span><span>Files</span><span>Meetings</span></span><span class="sp"></span>' +
      U.btn('secondary', 'New page', 'plus', 'al-btn--sm') + U.btn('primary', 'Add a file', 'upload', 'al-btn--sm') + '</div>';
    if (o.empty) {
      return head + '<div class="al-card" style="flex:1;display:flex;align-items:center;justify-content:center"><div class="al-empty">' +
        '<div style="width:200px">' + AL.art.spot('shelf') + '</div><h4>Your shelf is empty</h4><p>Add a PDF, a text file or Markdown, or start a page. Everything stays readable only on this device and verified private servers.</p>' +
        '<div style="display:flex;gap:8px">' + U.btn('primary', 'Add a file', 'upload') + U.btn('secondary', 'New page', 'plus') + '</div></div></div>';
    }
    var cards = '';
    if (o.adding) cards += o.adding;
    cards += items.map(function (it, i) { return U.filecard(it, '" style="--i:' + i); }).join('');
    return head + '<p class="ap-sub">' + esc(o.sub || '37 items, sealed on this device. Newest first.') + '</p><div class="ap-grid al-stagger">' + cards + '</div>';
  };

  U.uploadCard = function (pct, label, state) {
    return '<div class="al-filecard" style="border-color:var(--al-lamp);box-shadow:0 0 0 3px var(--al-lamp-soft)"><div class="thumb" style="justify-content:center;align-items:center">' +
      I('upload') + '</div><div class="t">' + I('pdf') + '<span>Lease agreement v4.pdf</span></div>' +
      '<div class="al-progress is-lamp" style="--p:' + pct + '%"><i class="js-bar"></i></div><div class="m"><span class="js-lbl">' + esc(label) + '</span>' + (state || '') + '</div></div>';
  };

  U.LEASE = [
    ['h', '12. Early termination'],
    ['p', '12.1 The Tenant may {S1}terminate this Lease by giving the Landlord not less than ninety (90) days’ written notice{/S1}, provided the notice expires no earlier than the last day of the twenty-fourth (24th) month of the Term.'],
    ['p', '12.2 On termination under clause 12.1 the Tenant shall pay the Landlord {S3}an amount equal to two (2) months’ Base Rent{/S3} as compensation.'],
    ['p', '12.3 Any notice under this clause must be delivered in accordance with clause 19 (Notices).'],
    ['h', '13. Assignment and subletting'],
    ['p', '13.1 The Tenant shall not assign this Lease or sublet the whole or any part of the Premises without the prior written consent of the Landlord, which shall not be unreasonably withheld.']
  ];
  function leaseText(hl) {
    hl = hl || [];
    return U.LEASE.map(function (b) {
      if (b[0] === 'h') return '<h4>' + esc(b[1]) + '</h4>';
      var t = esc(b[1]).replace(/\{(S\d)\}(.*?)\{\/S\d\}/g, function (m, k, inner) {
        return hl.indexOf(k) >= 0 ? '<mark class="al-hl is-glow">' + inner + '</mark><span class="al-mark">' + k + '</span>' : inner;
      });
      return '<p>' + t + '</p>';
    }).join('');
  }

  U.doc = function (o) {
    o = o || {};
    var st = o.state || U.state('done', 'Ready to ask', 'al-state--sm');
    var inner = o.altered ? '<div class="al-empty" style="padding-top:6px"><div style="width:190px">' + AL.art.spot('altered') + '</div><h4>We didn’t open this file</h4>' +
      '<p>It was changed while it was stored, so its seal no longer matches. Your other files are checked the same way every time they open.</p><div style="display:flex;gap:8px">' +
      U.btn('primary', 'Restore from backup', 'refresh') + U.btn('secondary', 'Remove from shelf', 'trash') + '</div></div>' :
      '<div class="ttl"><h3>Lease agreement v3</h3><p>PDF · page 4 of 14 · added 2 Nov</p></div><div class="ap-text ' + (o.frost ? 'ap-frosted' : '') + '" ' + (o.clear ? 'data-beat-frost style="--b:.4"' : '') + '>' + leaseText(o.hl) + '</div>';
    return '<div class="ap-doc"><div class="ap-doc-bar">' + I('arch') + '<span>Shelf</span>' + I('chevright') + '<b style="color:var(--al-ink)">Lease agreement v3.pdf</b>' + st +
      '<span class="sp"></span>' + U.btn('quiet', 'Ask about this', 'ask', 'al-btn--sm') + U.btn('quiet', 'Replace', 'upload', 'al-btn--sm') + '</div>' + (o.banner || '') +
      '<div class="ap-page">' + inner + '</div></div>';
  };

  U.editor = function (o) {
    o = o || {};
    var chip = { draft: U.state('closed', 'Draft on this device', 'al-state--sm'), saving: U.state('working', 'Saving…', 'al-state--sm'),
      saved: U.state('done', 'Saved just now', 'al-state--sm'), conflict: U.state('waiting', 'Changed since you opened it', 'al-state--sm') }[o.state || 'saved'];
    var banner = o.state === 'conflict' ? '<div class="al-banner al-banner--waiting" data-beat style="--b:1">' + I('info') + '<div><b>This page changed after you opened it.</b>We kept your edits as a draft, so nothing is lost.</div><span style="display:flex;gap:6px">' +
      U.btn('secondary', 'Compare', '', 'al-btn--sm') + U.btn('primary', 'Keep mine', '', 'al-btn--sm') + '</span></div>' : '';
    var tools = '<div class="ap-toolbar"><span class="is-on">H1</span><span>H2</span><span>B</span><span><i>I</i></span><hr>' +
      '<span>' + I('menu') + '</span><span>' + I('quote') + '</span><span>' + I('link') + '</span></div>';
    var body = o.body || ('<h4>Hiring plan, first half</h4><p>We will hire two engineers and one designer before June. The designer joins first, so the product work has a direction before the engineering team grows.</p>' +
      '<ul><li>Senior engineer, platform</li><li>Engineer, desktop app</li><li>Product designer</li></ul>' +
      '<p class="js-typing">' + esc(o.typed || 'Offers go out within a week of the final interview.') + '</p>');
    return '<div class="ap-doc"><div class="ap-doc-bar">' + I('arch') + '<span>Shelf</span>' + I('chevright') + '<b style="color:var(--al-ink)">Hiring plan</b>' + chip +
      '<span class="sp"></span>' + U.btn('quiet', 'History', 'clock', 'al-btn--sm') + '</div>' + banner + tools +
      '<div class="ap-page" style="padding-top:44px"><div class="ap-text">' + body + '</div></div></div>';
  };

  U.SOURCES = { lease: ['pdf', 'Lease agreement v3.pdf'], board: ['wave', 'Board prep call · 31 Oct'], memo: ['page', 'Q4 board memo'], investor: ['wave', 'Investor call · 2 Nov'] };
  U.QUESTION = 'Can we leave the lease early, and did it come up on the board prep call?';
  U.ANSWER_HTML = '<p>Yes. After the first 24 months you can end the lease with at least 90 days’ written notice <span class="al-mark">S1</span>, and you’d owe two months’ base rent <span class="al-mark">S3</span>.</p>' +
    '<p>The board prep call mentions it too: “the exit window opens next March” <span class="al-mark">S2</span>.</p>';
  U.ANSWER_TEXT = 'Yes. After the first 24 months you can end the lease with at least 90 days’ written notice, and you’d owe two months’ base rent. The board prep call mentions it too: “the exit window opens next March”.';
  U.cites = function () {
    return '<div class="al-stagger" style="display:flex;flex-direction:column;gap:7px;margin-top:4px">' +
      '<div class="al-cite"><span class="al-mark">S1</span><b>Lease agreement v3.pdf <span>· p. 4 · 12.1</span></b><q>terminate this Lease by giving the Landlord not less than ninety (90) days’ written notice</q></div>' +
      '<div class="al-cite"><span class="al-mark">S2</span><b>Board prep call <span>· 14:32–14:51</span></b><q>the exit window opens next March</q></div>' +
      '<div class="al-cite"><span class="al-mark">S3</span><b>Lease agreement v3.pdf <span>· p. 4 · 12.2</span></b><q>an amount equal to two (2) months’ Base Rent</q></div></div>';
  };

  U.ask = function (o) {
    o = o || {};
    var srcs = (o.sources || ['lease', 'board']).map(function (k) {
      var s = U.SOURCES[k];
      return '<span class="al-source-chip is-on">' + I(s[0]) + esc(s[1]) + '<svg class="al-i x" viewBox="0 0 24 24"><use href="#i-x"/></svg></span>';
    }).join('') + '<span class="al-source-chip" style="color:var(--al-ink-3)">' + I('plus') + 'Add</span>';
    var n = (o.sources || ['lease', 'board']).length;
    var t = '';
    var stage = o.stage || 'answer';
    if (stage === 'empty') {
      t = '<div class="al-empty" style="padding:18px 6px">' + M.mark(44) + '<h4>Ask about your files</h4><p>Answers use only the sources above, and every quote opens the exact place it came from.</p>' +
        '<div style="display:flex;flex-direction:column;gap:6px;width:100%">' +
        ['What does the lease say about leaving early?', 'Summarise the board prep call', 'What changed between v2 and v3?'].map(function (q, i) {
          return '<span class="al-btn al-btn--secondary al-btn--sm" style="justify-content:flex-start;--b:' + (i + 1) + '" data-beat>' + esc(q) + '</span>';
        }).join('') + '</div></div>';
    } else {
      t += '<div class="al-bubble" data-beat style="--b:0">' + esc(o.question || U.QUESTION) + '</div>';
      if (stage === 'custom') {
        t += '<div class="al-reply" data-beat style="--b:1"><span class="al-reply-av">' + M.mark(16, { fg: '#A9C4EC', glow: false }) + '</span><div class="al-reply-body">' + o.reply + '</div></div>';
      } else if (stage === 'thinking') {
        t += '<div class="al-reply" data-beat style="--b:1"><span class="al-reply-av">' + M.mark(16, { fg: '#A9C4EC', glow: false }) + '</span><div class="al-reply-body">' +
          '<span class="al-thinking"><i></i><i></i><i></i><span class="js-think">' + esc(o.thinking || 'Reading 2 sources…') + '</span></span>' +
          '<div class="al-reply-foot">' + I('clock') + 'Holding up to 132 credits while it works</div></div></div>';
      } else if (stage === 'insufficient') {
        t += '<div class="al-reply" data-beat style="--b:1"><span class="al-reply-av">' + M.mark(16, { fg: '#A9C4EC', glow: false }) + '</span><div class="al-reply-body">' +
          '<p>I couldn’t find anything about parking in the files you chose. Want to add another one?</p><div style="display:flex;gap:6px">' + U.btn('secondary', 'Add a source', 'plus', 'al-btn--sm') + '</div>' +
          '<div class="al-reply-foot"><span>No quotes, so nothing to open</span><span>12 credits</span></div></div></div>';
      } else {
        t += '<div class="al-reply" data-beat style="--b:1"><span class="al-reply-av">' + M.mark(16, { fg: '#A9C4EC', glow: false }) + '</span><div class="al-reply-body"><div class="js-answer">' +
          (o.typing ? '' : U.ANSWER_HTML) + '</div>' + (o.typing ? '<div class="js-after" style="display:none">' + U.cites() + '</div>' : U.cites()) +
          '<div class="al-reply-foot ' + (o.typing ? 'js-after' : '') + '" style="' + (o.typing ? 'display:none' : '') + '"><span class="ok">' + I('checkcircle') + 'Every quote matches your files</span><span>41 credits</span></div></div></div>';
      }
    }
    var draft = o.draft != null ? o.draft : '';
    var composer = '<div class="ap-composer"><div class="al-composer"><span class="al-composer-text ' + (draft ? '' : 'is-empty') + ' js-draft">' +
      esc(draft || (n ? 'Ask about these ' + n + ' sources…' : 'Choose files to ask about…')) + '</span><span class="al-send ' + (draft ? '' : 'is-idle') + '">' + I('arrowup') + '</span></div>' +
      '<div class="ap-note">Answers use only these sources. A question holds up to 132 credits.</div></div>';
    return '<div class="ap-aside-h">' + I('ask') + '<b>Ask</b><span class="sp"></span>' + U.btn('quiet', 'New', 'plus', 'al-btn--sm') + '</div>' +
      '<div class="ap-srcs">' + srcs + '</div><div class="ap-thread">' + t + '</div>' + composer;
  };
})();
