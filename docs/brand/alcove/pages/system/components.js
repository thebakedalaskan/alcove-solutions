/* 02 Design system / Components. Every component in both themes, with its classes and rules. */
(function () {
  var AL = window.AL, I = AL.icon, U = AL.ui, M = AL.marks, esc = AL.esc;

  function pair(inner) {
    return '<div class="show"><div class="show-cell t-light"><h4><span>Mist</span><span>Light</span></h4>' + inner + '</div>' +
      '<div class="show-cell t-dark"><h4><span>After hours</span><span>Dark</span></h4>' + inner + '</div></div>';
  }
  function comp(id, title, classes, sub, inner, rules) {
    return '<section class="al-sec" id="' + id + '"><div class="al-sec-h"><p class="al-eyebrow">' + esc(classes) + '</p><h2>' + esc(title) + '</h2>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>' +
      pair(inner) + (rules ? '<ul class="spec-list" style="margin-top:18px">' + rules.map(function (r) { return '<li>' + r + '</li>'; }).join('') + '</ul>' : '') + '</section>';
  }
  function row(x) { return '<div class="show-row">' + x + '</div>'; }

  AL.page({
    id: 'components', group: 'system', order: 6, title: 'Components', icon: 'blocks', file: 'components',
    keywords: 'component library buttons inputs chips bookmarks cards toast sheet progress states',
    lede: 'The pieces the app is built from, each shown in Mist and After hours. Every class here is the one the screens and flows in this book use, so a change here changes them everywhere.',
    meta: [['blocks', '13 component families']],
    render: function () {
      var out = '';
      out += comp('buttons', 'Buttons', '.al-btn', 'Pill-shaped, with a verb that says what happens. One primary per view.',
        row(U.btn('primary', 'Ask') + U.btn('secondary', 'Add a file', 'upload') + U.btn('quiet', 'History', 'clock') + U.btn('gentle', 'Stop and leave', 'stop')) +
        row('<span class="al-btn al-btn--lamp">' + I('fingerprint') + 'Unlock with your passkey</span>' + '<span class="al-btn al-btn--primary is-busy"><span class="al-spin"></span>Saving…</span>' + '<span class="al-btn al-btn--primary is-disabled">Ask</span>') +
        row(U.btn('primary', 'Small', '', 'al-btn--sm') + U.btn('primary', 'Default') + U.btn('primary', 'Large', '', 'al-btn--lg') +
          '<span class="al-icon-btn" aria-label="More">' + I('more') + '</span><span class="al-icon-btn is-on" aria-label="Ask panel">' + I('ask') + '</span>'),
        ['<b>Primary</b> is Dusk: the one main action on a screen.', '<b>Lamp</b> is reserved for unlocking and buying credits, the two moments that change what is lit.',
          '<b>Gentle</b> is for stopping and leaving. No button is ever bright red.', 'Busy buttons keep their width and say what is happening: “Saving…”.']);

      out += comp('fields', 'Fields and the composer', '.al-input · .al-composer', null,
        '<div class="show-col"><div class="al-field"><label>Your name</label><input class="al-input" value="Priya Nair" aria-label="Guest name example" readonly><p class="al-help">This is the name others in the call will see.</p></div>' +
        '<div class="al-field"><label>Call title</label><input class="al-input is-focus" value="Launch planning" aria-label="Call title example" readonly></div>' +
        '<div class="al-field"><label>Invite link</label><input class="al-input is-error" value="alcove/c/launch-planning" aria-label="Link without key example" readonly><p class="al-help is-error">This link is missing its key. Ask for the full link, including the part after #.</p></div>' +
        '<div class="al-inputwrap">' + I('search') + '<input class="al-input" placeholder="Find something" aria-label="Search example" readonly><span class="al-kbd">⌘K</span></div>' +
        '<div class="al-composer"><span class="al-composer-text">What did we decide about the launch?</span><span class="al-send">' + I('arrowup') + '</span></div></div>',
        ['Labels sit above fields and never disappear into placeholders.', 'Errors say what went wrong and what to do, in Brick, without shaking.', 'The composer grows a line at a time and its send button stays idle until there is text.']);

      out += comp('toggles', 'Switches, checks, segments and tabs', '.al-switch · .al-check · .al-seg · .al-tabs', null,
        row('<span class="al-switch is-on"><i></i>Close when the tab closes</span><span class="al-switch"><i></i>Show bookmarks</span>') +
        row('<span class="al-check is-on"><i>' + I('check') + '</i>Launch planning</span><span class="al-check"><i>' + I('check') + '</i>Lunch with Sam</span>') +
        row('<span class="al-seg"><span class="is-on">All</span><span>Pages</span><span>Files</span><span>Meetings</span></span>') +
        '<div class="al-tabs"><span class="is-on">Notes</span><span>Audio</span><span>Details</span></div>',
        ['A switch changes something at once; a checkbox is a choice confirmed by a button.', 'The selected tab gets a lamp underline that grows from its start in 220 ms.']);

      out += comp('states', 'State chips', '.al-state--{state}', 'Every state the product can be in, with a dot shape that reads without colour.',
        row(U.state('closed', 'Closed') + U.state('lit', 'Lamp on') + U.state('working', 'Working on it') + U.state('waiting', 'On its way')) +
        row(U.state('unknown', 'Not sure yet') + U.state('problem', 'Couldn’t open') + U.state('done', 'Saved') + U.state('rec', 'Recording')) +
        row('<span class="al-tag">Draft</span><span class="al-tag">' + I('pdf') + 'PDF</span><span class="al-kbd">⌘</span><span class="al-kbd">K</span><span class="al-avatar">BK</span>'),
        ['Closed and Not sure yet use hollow dots; Working spins; Waiting pulses; Recording breathes.', 'Never show a chip for a state the product didn’t observe.']);

      out += comp('bookmarks', 'Sources and bookmarks', '.al-source-chip · .al-mark · .al-cite · .al-hl', 'Chat answers only from the sources you choose, and every quote is a bookmark that opens its exact place.',
        row('<span class="al-source-chip is-on">' + I('wave') + 'Launch planning' + I('x', 'x') + '</span><span class="al-source-chip is-on">' + I('mic') + 'Lunch with Sam' + I('x', 'x') + '</span><span class="al-source-chip">' + I('plus') + 'Add</span>') +
        '<p class="al-read" style="margin:0;font-size:16.5px">12:40 · Priya: Then let’s decide: <mark class="al-hl">launch on the 18th, import comes in the next release</mark><span class="al-mark">S1</span>.</p>' + U.cites(),
        ['Bookmarks are lamp ribbons labelled S1 to S8, in the order the answer uses them.', 'A bookmark card names the file, the page or time, and the exact quote.', 'Opening a bookmark scrolls to the passage and lets its highlight glow for 1.6 s.']);

      out += comp('chat', 'Chat', '.al-bubble · .al-reply · .al-thinking', null,
        '<div style="display:flex;flex-direction:column;gap:12px"><div class="al-bubble">' + esc(U.QUESTION) + '</div>' +
        '<div class="al-reply"><span class="al-reply-av">' + M.mark(16, { fg: '#A9C4EC', glow: false }) + '</span><div class="al-reply-body"><span class="al-thinking"><i></i><i></i><i></i>Reading 2 sources…</span></div></div>' +
        '<div class="al-reply"><span class="al-reply-av">' + M.mark(16, { fg: '#A9C4EC', glow: false }) + '</span><div class="al-reply-body">' + U.ANSWER_HTML +
        '<div class="al-reply-foot"><span class="ok">' + I('checkcircle') + 'Every quote matches your files</span><span>41 credits</span></div></div></div></div>',
        ['Your messages are Dusk bubbles on the right; Alcove’s replies are plain text on the left beside the small mark.', 'The foot says what was checked and what it cost, once the charge settles.']);

      out += comp('cards', 'Cards, rows and empty states', '.al-filecard · .al-row · .al-empty', null,
        '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">' + U.filecard(U.item('lease')) + U.filecard(U.item('notes')) + U.filecard(U.item('investor')) + '</div>' +
        '<div class="al-card" style="padding:4px"><div class="al-row">' + I('wave') + '<span class="n">Board prep call<small>31 Oct · 28 min</small></span>' + U.state('done', 'Notes ready', 'al-state--sm') + I('chevright') + '</div>' +
        '<div class="al-row">' + I('wave') + '<span class="n">Candidate interview<small>24 Oct · 41 min</small></span>' + U.state('waiting', 'Partial · 3 gaps', 'al-state--sm') + I('chevright') + '</div></div>' +
        '<div class="al-card"><div class="al-empty"><div style="width:150px">' + AL.art.spot('search') + '</div><h4>Nothing matches “parking”</h4><p>Search looks through titles and the text of files that are ready.</p></div></div>',
        ['File thumbnails use the arch; rows stay flat.', 'Empty states pair a spot illustration with one sentence and one action.']);

      out += comp('feedback', 'Banners, toasts, tooltips and menus', '.al-banner · .al-toast · .al-tip · .al-menu', null,
        '<div class="al-banner al-banner--waiting">' + I('hourglass') + '<div><b>Your payment is on its way.</b>Credits arrive once it settles.</div><span></span></div>' +
        '<div class="al-banner al-banner--unknown">' + I('help') + '<div><b>Not sure yet.</b>We won’t send it again, so you can’t be charged twice.</div><span></span></div>' +
        '<div class="al-banner al-banner--problem">' + I('alert') + '<div><b>We couldn’t open this file.</b>It changed while it was stored. Restore it from a backup.</div>' + U.btn('secondary', 'Restore', '', 'al-btn--sm') + '</div>' +
        U.toast('lamp', 'Saved just now', 'Hiring plan, revision 14', 'Undo') +
        '<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap"><span class="al-tip">Holds up to 132 credits</span>' +
        '<div class="al-menu"><div class="is-hover">' + I('ask') + 'Ask about this<kbd class="al-kbd">⌘J</kbd></div><div>' + I('edit') + 'Edit as page</div><div>' + I('upload') + 'Replace</div><hr><div class="is-gentle">' + I('trash') + 'Remove from shelf</div></div></div>',
        ['Banners stay until the state changes; toasts leave after six seconds unless they hold an action.', 'Removing is gentle and always asks first.']);

      out += comp('sheets', 'The arch sheet', '.al-sheet', 'Moments that ask for a decision open in an arched dialog with the mark at the top.',
        U.sheet({ title: 'Turn on notes?', text: 'Everyone in the call will see Notes on. A verified private service will transcribe the call for the people in it.',
          body: '<dl class="al-dl"><dt>Who gets them</dt><dd>Everyone in the call</dd><dt>Credits</dt><dd>Up to 750 per 30 minutes</dd><dt>Shared screens</dt><dd>Read too</dd></dl>',
          actions: '<span class="al-btn al-btn--primary al-btn--block">' + I('page') + 'Turn on notes</span><span class="al-btn al-btn--quiet al-btn--block">Not now</span>' }),
        ['One decision per sheet. The primary action restates the verb from the title.', 'Terms come first, in a definition list, before anything starts.']);

      out += comp('progress', 'Progress and loading', '.al-progress · .al-arch-progress · .al-meter · .al-skel · .al-steps', null,
        '<div class="al-progress" style="--p:62%"><i></i></div><div class="al-progress is-run"><i></i></div><div class="al-progress is-lamp" style="--p:35%"><i></i></div>' +
        '<div style="display:flex;gap:18px;align-items:center">' + AL.archProgress(2 / 3, 90) + '<ul class="al-steps" style="flex:1"><li class="is-done"><span class="dot">' + I('check') + '</span><span class="lbl">Make your key</span></li>' +
        '<li class="is-done"><span class="dot">' + I('check') + '</span><span class="lbl">Check the private server</span></li><li class="is-now"><span class="dot"></span><span class="lbl">Add your first file<small>PDF, text or Markdown</small></span></li></ul></div>' +
        '<div class="al-meter"><i class="avail" style="width:80%"></i><i class="held" style="width:15%"></i><i class="used" style="width:5%"></i></div>' +
        '<div style="display:flex;flex-direction:column;gap:8px"><i class="al-skel" style="width:70%"></i><i class="al-skel"></i><i class="al-skel" style="width:85%"></i></div>',
        ['Known progress fills; unknown waits run. Never fake a percentage.', 'First-run progress fills along the arch toward the lamp.', 'Skeletons shimmer with lamp light, once every 1.8 s.']);

      out += comp('lamp', 'The lamp indicator', '.al-lamp', 'The smallest piece of the brand, and the most important: it is the lock state.',
        row('<span class="al-lampline"><span class="al-lamp"></span>Closed</span><span class="al-lampline"><span class="al-lamp is-on"></span>Lamp on · closes in 14 min</span><span class="al-lampline"><span class="al-lamp is-rec"></span>Recording · 18:42</span>'),
        ['Lit only while the vault is unlocked. It warms over 600 ms and goes out the same way.']);

      out += comp('wave', 'Waveform', '.al-wave', null,
        U.wave({ n: 56, live: true }) + U.wave({ n: 56, gap: [30, 34] }) + U.wave({ n: 56, live: true, quiet: true }),
        ['Live waves move only while real audio arrives. Gaps are hatched in lamp amber and labelled with their time.']);
      return out;
    }
  });
})();
