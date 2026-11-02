/* Web app building blocks (version 2): browser window, Notion-style sidebar, private chat, block editor, free credits. */
(function () {
  var AL = window.AL, U = AL.ui, I = AL.icon, M = AL.marks, esc = AL.esc;

  // ---------- browser window ----------
  U.win = function (o) {
    o = o || {};
    var lamp = o.lamp || 'on';
    var path = o.path || 'chat';
    var bar = '<div class="ap-bar ap-bar--web"><span class="ap-lights" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '<span class="ap-tab">' + M.mark(14, { lit: lamp !== 'off', glow: false }) + '<span>' + esc(o.title || 'Alcove') + '</span></span>' +
      '<span class="ap-url">' + I('lock') + 'alcove<span class="ap-url-path">/' + esc(path) + '</span></span>' +
      '<span class="ap-bar-r">' + (o.barRight != null ? o.barRight : U.lampline(lamp, o.closes)) + '</span></div>';
    var body;
    if (o.raw) body = o.raw;
    else {
      var cls = 'ap-body' + (o.aside ? ' has-aside' : '') + (o.side === false ? ' no-side' : '');
      var so = o.sideOpts || {};
      if (!so.lamp) so.lamp = lamp;
      body = '<div class="' + cls + '">' + (o.side === false ? '' : U.side(so)) + '<div class="ap-main ' + (o.mainCls || '') + '">' + (o.main || '') + '</div>' +
        (o.aside ? '<div class="ap-aside">' + o.aside + '</div>' : '') + '</div>';
    }
    return '<div class="ap ap--web ' + (o.cls || '') + '" role="img" aria-label="' + esc(o.label || 'Alcove web app') + '">' + bar + body +
      (o.overlay ? '<div class="ap-overlay">' + o.overlay + '</div>' : '') +
      (o.toasts ? '<div class="ap-toastzone">' + o.toasts + '</div>' : '') + (o.extra || '') + '</div>';
  };

  // ---------- sidebar: Chat is home, pages are a tree ----------
  U.CHATS = [['c1', 'Leaving the lease early'], ['c2', 'Draft a reply to Maya'], ['c3', 'Is this offer fair?'], ['c4', 'Summarise the board call']];
  U.TREE = [['memo', 'page', 'Q4 board memo', 0], ['plan', 'folder', 'Planning', 0, true], ['hiring', 'page', 'Hiring plan', 1], ['roadmap', 'page', 'Roadmap', 1],
    ['lease', 'pdf', 'Lease agreement v3.pdf', 0], ['board', 'wave', 'Board prep call', 0]];
  U.side = function (o) {
    o = o || {};
    var active = { shelf: 'pages', ask: 'chat' }[o.active] || o.active || 'chat', lamp = o.lamp || 'on';
    var nav = [['chat', 'ask', 'Chat', ''], ['pages', 'page', 'Pages', ''], ['meetings', 'meeting', 'Meetings', o.rec ? 'rec' : ''], ['credits', 'credits', 'Credits', o.credits || '9,209']];
    var n = nav.map(function (r) {
      var ct = r[3] === 'rec' ? '<span class="ct rec">Live</span>' : (r[3] ? '<span class="ct">' + esc(r[3]) + '</span>' : '');
      return '<div class="' + (r[0] === active ? 'is-on' : '') + '">' + I(r[1]) + esc(r[2]) + ct + '</div>';
    }).join('');
    var chats = U.CHATS.map(function (c) {
      return '<div class="' + (c[0] === o.chat ? 'is-on' : '') + '"><span class="ap-pdot"></span><span>' + esc(c[1]) + '</span></div>';
    }).join('');
    var tree = U.TREE.map(function (t) {
      return '<div class="' + (t[0] === o.open ? 'is-on' : '') + '" style="padding-left:' + (8 + t[3] * 16) + 'px">' +
        (t[4] ? I('chevdown', 'tw') : '<span class="tw"></span>') + I(t[1]) + '<span>' + esc(t[2]) + '</span></div>';
    }).join('');
    var lampEl = lamp === 'off' ? '<span class="al-lamp"></span>' : (lamp === 'rec' ? '<span class="al-lamp is-rec"></span>' : '<span class="al-lamp is-on"></span>');
    return '<div class="ap-side"><div class="ap-brand">' + M.mark(20, { lit: lamp !== 'off', glow: false }) + '<span class="al-wm">alcove</span>' + lampEl + '</div>' +
      '<span class="al-btn al-btn--primary al-btn--sm ap-newchat">' + I('plus') + 'New private chat</span>' +
      '<div class="ap-search">' + I('search') + 'Search<span class="al-kbd">⌘K</span></div>' +
      '<div class="ap-nav">' + n + '</div><div class="ap-group">Private chats</div><div class="ap-recent ap-chats">' + chats + '</div>' +
      '<div class="ap-group">Pages</div><div class="ap-recent ap-tree">' + tree + '</div>' +
      '<div class="ap-side-foot"><span>' + esc(o.storage || '37 items · 212 MB of 1 GiB') + '</span>' +
      '<div style="display:flex;align-items:center;gap:8px;color:var(--al-ink-2);font-size:13.5px">' + I('sliders') + 'Preferences</div></div></div>';
  };

  // ---------- private chat ----------
  var AV = function () { return '<span class="al-reply-av">' + M.mark(16, { fg: '#A9C4EC', glow: false }) + '</span>'; };
  U.privacyBar = function () {
    return '<div class="ap-privbar"><span class="ap-priv">' + I('shield') + 'Private chat</span><span>Only you can read it. The model runs in a verified private server and keeps nothing.</span>' +
      '<span class="ap-model">' + I('server') + 'Private model · verified</span></div>';
  };
  U.chatComposer = function (o) {
    o = o || {};
    var draft = o.draft || '';
    return '<div class="ap-chatbox"><div class="al-composer ap-bigcomposer"><div style="flex:1;display:flex;flex-direction:column;gap:8px">' +
      (o.sources ? '<div style="display:flex;gap:6px;flex-wrap:wrap">' + o.sources + '</div>' : '') +
      '<span class="al-composer-text ' + (draft ? '' : 'is-empty') + ' js-draft">' + esc(draft || 'Message Alcove privately…') + '</span>' +
      '<div class="ap-ctools"><span>' + I('plus') + 'Add files</span><span>' + I('mic') + 'Dictate</span><span class="ap-hold">Holds up to 132 credits</span></div></div>' +
      '<span class="al-send ' + (draft ? '' : 'is-idle') + '">' + I('arrowup') + '</span></div>' +
      '<p class="ap-note">' + I('lock') + ' Encrypted from your browser to the private model. Not used for training. Not seen by us.</p></div>';
  };
  U.chat = function (o) {
    o = o || {};
    var stage = o.stage || 'answer';
    var head = '<div class="ap-chathead"><b>' + esc(o.title || (stage === 'empty' ? 'New private chat' : 'Leaving the lease early')) + '</b>' +
      U.state('lit', 'Private', 'al-state--sm') + '<span class="sp"></span>' + U.btn('quiet', 'Sources', 'bookmark', 'al-btn--sm') + U.btn('quiet', '', 'more', 'al-btn--sm') + '</div>';
    var t = '';
    if (stage === 'empty') {
      t = '<div class="ap-hello">' + M.mark(56) + '<h3 data-beat style="--b:.5">What’s on your mind?</h3><p data-beat style="--b:1">Only you will see this conversation. Ask anything, or bring in a page, a file or a meeting.</p>' +
        '<div class="ap-suggest">' + [['ask', 'Talk through a hard decision'], ['edit', 'Draft a reply I can edit'], ['pdf', 'Explain this contract clause'], ['wave', 'What did we agree on Thursday?']].map(function (s, k) {
          return '<span data-beat style="--b:' + (1.5 + k * 0.3) + '">' + I(s[0]) + esc(s[1]) + '</span>';
        }).join('') + '</div></div>';
      return head + U.privacyBar() + '<div class="ap-thread ap-chatthread">' + t + '</div>' + U.chatComposer({ draft: o.draft });
    }
    t += '<div class="al-bubble" data-beat style="--b:0">I signed a 3 year lease last spring but we might need a bigger office next year. Can we leave early, and what would it cost?</div>';
    if (stage === 'thinking') {
      t += '<div class="al-reply" data-beat style="--b:1">' + AV() + '<div class="al-reply-body"><span class="al-thinking"><i></i><i></i><i></i><span class="js-think">Thinking privately…</span></span></div></div>';
    } else {
      t += '<div class="al-reply" data-beat style="--b:1">' + AV() + '<div class="al-reply-body"><div class="js-answer">' + (o.typing ? '' : U.CHAT_ANSWER_HTML) + '</div>' +
        '<div class="al-reply-foot ' + (o.typing ? 'js-after' : '') + '" style="' + (o.typing ? 'display:none' : '') + '"><span class="ok">' + I('shield') + 'Answered privately</span><span>38 credits</span>' +
        '<span>' + I('copy') + 'Copy</span><span>' + I('page') + 'Save as page</span></div></div></div>';
      if (stage === 'followup') {
        t += '<div class="al-bubble" data-beat style="--b:0">Can you check my actual lease?</div>' +
          '<div class="al-reply" data-beat style="--b:1">' + AV() + '<div class="al-reply-body"><p>Yes. Pick the lease and I’ll answer only from it, with bookmarks to the exact clauses.</p>' +
          '<span class="al-source-chip is-on">' + I('pdf') + 'Lease agreement v3.pdf</span></div></div>';
      }
    }
    return head + U.privacyBar() + '<div class="ap-thread ap-chatthread">' + t + '</div>' + U.chatComposer({ draft: o.draft });
  };
  U.CHAT_ANSWER_HTML = '<p>Usually, yes. Most commercial leases let you leave early with written notice, often after a minimum term, and charge a fee such as a few months’ rent.</p>' +
    '<p>Three things decide your cost:</p><ul><li>the notice period, often 60 to 90 days</li><li>the earliest date you’re allowed to give notice</li><li>any early-exit fee or lost deposit</li></ul>' +
    '<p>If you add the lease, I’ll find the exact clause.</p>';
  U.CHAT_ANSWER_TEXT = 'Usually, yes. Most commercial leases let you leave early with written notice, often after a minimum term, and charge a fee such as a few months’ rent. Three things decide your cost: the notice period, the earliest date you can give notice, and any exit fee.';
  U.chatInfo = function () {
    function row(icon, t, d) { return '<div class="ap-inforow">' + I(icon) + '<div><b>' + esc(t) + '</b><span>' + esc(d) + '</span></div></div>'; }
    return '<div class="ap-aside-h">' + I('shield') + '<b>This chat is private</b></div><div class="ap-info">' +
      row('user', 'Who can read it', 'Only you. It is encrypted with your key before it leaves the browser.') +
      row('server', 'Who answers', 'A model running inside a verified private server. Its operator can’t see your words.') +
      row('eyeoff', 'What is kept', 'Nothing by the model. Your copy is stored encrypted, so we can’t read it either.') +
      row('credits', 'What it costs', '38 credits for the last answer. Up to 132 are held while it works.') +
      '<div class="al-banner al-banner--done" style="margin-top:6px">' + I('checkcircle') + '<div><b>Server verified 10:02</b>Approved build, key bound, fresh proof.</div><span></span></div></div>';
  };

  // ---------- Notion-like block editor ----------
  U.slashMenu = function () {
    var items = [['type', 'Heading 1', 'Big section heading'], ['check', 'To-do list', 'Track tasks'], ['menu', 'Bulleted list', 'A simple list'],
      ['info', 'Callout', 'Make it stand out'], ['ask', 'Ask Alcove', 'Privately, about this page']];
    return '<div class="ap-slash" data-beat-pop style="--b:.6"><div class="ap-slash-h">Basic blocks</div>' + items.map(function (x, k) {
      return '<div class="' + (k === 1 ? 'is-hover' : '') + '"><span class="ic">' + I(x[0]) + '</span><span><b>' + esc(x[1]) + '</b><small>' + esc(x[2]) + '</small></span></div>';
    }).join('') + '</div>';
  };
  U.editor = function (o) {
    o = o || {};
    var chip = { draft: U.state('closed', 'Draft in this browser', 'al-state--sm'), saving: U.state('working', 'Saving…', 'al-state--sm'),
      saved: U.state('done', 'Saved', 'al-state--sm'), conflict: U.state('waiting', 'Changed since you opened it', 'al-state--sm') }[o.state || 'saved'];
    var banner = o.state === 'conflict' ? '<div class="al-banner al-banner--waiting" data-beat style="--b:1">' + I('info') + '<div><b>This page changed after you opened it.</b>We kept your edits as a draft, so nothing is lost.</div><span style="display:flex;gap:6px">' +
      U.btn('secondary', 'Compare', '', 'al-btn--sm') + U.btn('primary', 'Keep mine', '', 'al-btn--sm') + '</span></div>' : '';
    var title = o.title || 'Hiring plan';
    var body = o.body || ('<div class="nb nb-p">We will hire two engineers and one designer before June. The designer joins first, so the product has a direction before the team grows.</div>' +
      '<div class="nb nb-callout">' + I('lamp') + '<span>Budget is approved up to the end of Q2. Anything later waits for the round.</span></div>' +
      '<div class="nb nb-h">Roles</div>' +
      '<div class="nb nb-todo is-done"><span class="cb">' + I('check') + '</span><span>Senior engineer, platform</span></div>' +
      '<div class="nb nb-todo"><span class="cb"></span><span>Engineer, web app</span></div>' +
      '<div class="nb nb-todo"><span class="cb"></span><span>Product designer</span></div>' +
      '<div class="nb nb-p is-hover"><span class="nb-handle">' + I('plus') + '<b>⋮⋮</b></span><span class="js-typing">' + esc(o.typed != null ? o.typed : (o.slash ? '/to' : 'Offers go out within a week of the final interview.')) + '</span></div>');
    return '<div class="ap-notion">' +
      '<div class="ap-ntop">' + I('page') + '<span>Pages</span>' + I('chevright') + '<span>Planning</span>' + I('chevright') + '<b>' + esc(title) + '</b>' + chip +
      '<span class="sp"></span><span class="ap-priv">' + I('lock') + 'Private</span>' + U.btn('quiet', '', 'clock', 'al-btn--sm') + U.btn('quiet', '', 'more', 'al-btn--sm') + '</div>' + banner +
      '<div class="ap-ncover"></div><div class="ap-npage"><div class="ap-nicon">' + M.mark(40, { glow: false }) + '</div>' +
      '<h1 class="ap-ntitle">' + esc(title) + '</h1>' +
      '<div class="ap-nprops"><span>' + I('clock') + 'Edited just now</span><span>' + I('link') + 'Linked: Board prep call</span><span>' + I('lock') + 'Only you</span></div>' +
      '<div class="ap-nbody">' + body + '</div>' + (o.slash ? U.slashMenu() : '') + (o.select ? U.selectBar() : '') + '</div></div>';
  };
  U.selectBar = function () {
    return '<div class="ap-selbar" data-beat-pop style="--b:.5"><span class="ask">' + I('ask') + 'Ask privately</span><hr><b>B</b><i>I</i><u>U</u><span>' + I('link') + '</span><hr><span>Turn into</span></div>';
  };

  // ---------- credits with a free start ----------
  var baseCredits = U.credits;
  U.credits = function (o) {
    o = o || {};
    var st = o.state || 'normal';
    if (st === 'pending' || st === 'added' || st === 'failed') {
      return baseCredits(o).replace('<span>Credit pack</span><b>10,000 credits</b>', '<span>When the free credits run out</span><b>10,000 credits</b>');
    }
    var bal = { normal: '9,209', welcome: '10,000', low: '412', empty: '0' }[st];
    var banner = { welcome: '<div class="al-banner al-banner--done" data-beat style="--b:1">' + I('checkcircle') + '<div><b>10,000 free credits to start.</b>Enough for about 6 hours of call notes or 75 questions. No wallet needed until they run out.</div><span></span></div>',
      low: '<div class="al-banner al-banner--waiting" data-beat style="--b:1">' + I('hourglass') + '<div><b>Your free credits are running low.</b>412 left: enough for a few more minutes of notes. Buy a pack whenever you’re ready.</div>' + U.btn('primary', 'Buy credits', 'wallet', 'al-btn--sm') + '</div>',
      empty: '<div class="al-banner al-banner--waiting" data-beat style="--b:1">' + I('hourglass') + '<div><b>You’ve used your 10,000 free credits.</b>Pages and files still work. Calls stay free. Notes and questions need a pack.</div>' + U.btn('primary', 'Buy credits', 'wallet', 'al-btn--sm') + '</div>' }[st] || '';
    var pct = { normal: 92, welcome: 100, low: 4, empty: 0 }[st];
    var meter = '<div class="al-meter"><i class="avail" style="width:' + pct + '%"></i>' + (st === 'normal' ? '<i class="held" style="width:7.5%"></i><i class="used" style="width:.5%"></i>' : '') + '</div>' +
      '<div class="al-legend"><span><i style="background:var(--al-accent)"></i>Available ' + bal + '</span>' + (st === 'normal' ? '<span><i style="background:var(--al-lamp)"></i>Set aside 750</span><span><i style="background:var(--al-ink-3)"></i>Used 41</span>' : '') + '<span><i style="background:var(--al-positive)"></i>Free credits</span></div>';
    var rows = st === 'welcome' ? [['09:58', 'Welcome credits', '+10,000', U.state('done', 'Free', 'al-state--sm')]] :
      [['10:44', 'Ask · launch date', '−41', U.state('done', 'Paid', 'al-state--sm')],
        ['10:24', 'Notes · Launch planning (live)', '750 set aside', U.state('rec', 'Recording', 'al-state--sm')],
        ['09:58', 'Welcome credits', '+10,000', U.state('done', 'Free', 'al-state--sm')]];
    var ledger = '<table class="ap-ledger"><tbody class="al-stagger">' + rows.map(function (r) {
      return '<tr><td class="t">' + r[0] + '</td><td>' + esc(r[1]) + '</td><td class="a">' + esc(r[2]) + '</td><td class="s">' + r[3] + '</td></tr>';
    }).join('') + '</tbody></table>';
    var hot = st === 'low' || st === 'empty';
    return '<div class="ap-head"><h2>Credits</h2><span class="sp"></span>' + U.btn(hot ? 'primary' : 'secondary', 'Buy credits', 'plus', 'al-btn--sm') + '</div>' + banner +
      '<div class="ap-balance"><div class="al-card" style="padding:20px;display:flex;flex-direction:column;gap:14px"><span class="al-small">Credits left</span><div class="big"><span class="js-bal">' + bal + '</span><small>credits</small></div>' + meter +
      '<p class="al-small">Everyone starts with 10,000 free credits. Calls are free. Credits pay for notes and questions, aren’t money, and can’t be sent anywhere.</p></div>' +
      '<div class="ap-pack' + (hot ? ' is-hot' : '') + '"><span>' + (hot ? 'Keep going' : 'When the free credits run out') + '</span><b>10,000 credits</b><span>for 10.00 USDC, paid privately from your wallet</span>' +
      '<span class="al-btn al-btn--lamp al-btn--sm" style="align-self:flex-start;margin-top:auto">' + I('wallet') + 'Buy this pack</span></div></div>' +
      '<div class="al-card" style="padding:10px 16px"><div class="ap-group" style="padding:6px 0">Ledger</div>' + ledger + '</div>';
  };
})();
