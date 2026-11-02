/* 01 Brand / Overview: the cover, the idea, the promises and a map of the book. */
(function () {
  var AL = window.AL, I = AL.icon, M = AL.marks, U = AL.ui, esc = AL.esc;

  AL.page({
    id: 'overview', group: 'brand', order: 1, title: 'Overview', icon: 'book', bare: true, file: 'overview',
    keywords: 'cover brand idea promise personality start',
    render: function () {
      var cover = '<section class="cover" aria-label="Alcove"><div class="cover-switch"><button class="al-btn al-btn--secondary al-btn--sm" type="button" id="cover-lamp">' +
        I('lamp') + '<span>Turn the lamp off</span></button></div><div class="cover-txt"><h1 class="al-vh">Alcove brand book</h1><span class="al-wm" aria-hidden="true">alcove</span>' +
        '<p class="cover-tag">Lamp on. Door closed.</p><p class="al-lede">Private video calls with notes that write themselves, and private notes from any conversation in the room. Only the people in the room can hear it or read it.</p>' +
        '<div class="cover-meta"><span>' + I('book') + 'Brand book, version 3</span><span>' + I('blocks') + '29 pages</span><span>' + I('flow') + '8 journeys</span></div></div>' +
        '<div class="cover-art">' + AL.art.cover() + '</div></section>';

      var idea = '<section class="al-sec" id="idea"><div class="al-sec-h"><p class="al-eyebrow">The idea</p><h2>A room of your own, lit for you</h2></div>' +
        '<div class="al-grid al-g2"><div class="al-read"><p class="al-p">An alcove is the small, set-apart corner of a room where you can talk without being overheard. Alcove gives your calls and conversations that kind of space.</p>' +
        '<p class="al-p">Calls are encrypted in every browser, so the relay that routes them hears nothing. Notes are written by a private service that is checked before it can listen, and they go only to the people who were there.</p>' +
        '<p class="al-p">Privacy here should feel like calm. The product explains itself plainly, never hurries anyone, and never claims more than it can show.</p></div>' +
        '<div class="al-panel al-pad al-dusk" style="display:flex;flex-direction:column;gap:14px;justify-content:center"><span class="al-eyebrow" style="color:#F4C47E">Why “Alcove”</span>' +
        '<p style="margin:0;font:italic 400 24px/1.35 var(--al-font-read)">“A place you go to think, lit for you and closed to everyone else.”</p>' +
        '<p class="al-small">The name is plain English, friendly in a meeting’s participant list, and carries its own picture: an arch with a lamp inside. That picture is the mark, the app icon and the lock state in the browser tab.</p></div></div></section>';

      var promises = '<section class="al-sec" id="promises"><div class="al-sec-h"><p class="al-eyebrow">Three promises</p><h2>What the brand says, every time</h2>' +
        '<p>Each promise comes straight from the product’s engineering docs, so the brand can phrase it warmly and never overstate it.</p></div><div class="promise-band al-stagger">' +
        '<div>' + I('lock') + '<b>Encrypted end to end</b><p>Video and audio are encrypted in each browser. The relay in the middle, and we, hear nothing.</p></div>' +
        '<div>' + I('door') + '<b>Door closed</b><p>Everywhere else stores ciphertext. When you step away, the lamp goes out and the server forgets your key.</p></div>' +
        '<div>' + I('page') + '<b>Notes, out loud</b><p>Everyone sees Notes on before they join. Notes are written in a verified private server and go only to the people in the room.</p></div></div></section>';

      var traits = [['Calm', 'Unhurried, quiet, steady', 'Sleepy, vague, slow to say what happened'],
        ['Warm', 'Human, kind, first person when it helps', 'Cute, chatty, full of exclamation marks'],
        ['Honest', 'Specific, plain, clear about what it doesn’t know', 'Alarming, technical, or more certain than the facts']];
      var personality = '<section class="al-sec" id="personality"><div class="al-sec-h"><p class="al-eyebrow">Personality</p><h2>Calm, warm and honest</h2></div>' +
        '<div class="al-grid al-g3 al-stagger">' + traits.map(function (t) {
          return '<div class="al-panel al-pad"><h3 class="al-h3">' + t[0] + '</h3><p class="al-verdict do">' + I('check') + 'Sounds</p><p class="al-p" style="margin:0">' + esc(t[1]) +
            '</p><p class="al-verdict dont">' + I('x') + 'Never sounds</p><p class="al-p" style="margin:0">' + esc(t[2]) + '</p></div>';
        }).join('') + '</div></section>';

      var groups = [['01 Brand', 'book', ['Overview', 'Mark and logo', 'Voice and words', 'Illustration'], 'mark'],
        ['02 Design system', 'blocks', ['Colour', 'Typography', 'Iconography', 'Space and shape', 'Motion', 'Components', 'Tokens'], 'colour'],
        ['03 Screens', 'screen', ['Unlock', 'Home', 'Joining a call', 'In a call', 'Sharing a screen', 'Notes in the room', 'Call notes', 'Ask about a call', 'Credits', 'Preferences'], 'screen-call'],
        ['04 Flows', 'flow', ['First run', 'A private call', 'Joining from a link', 'Notes in the room', 'Notes from a shared screen', 'Ask about a call', 'Free credits, then a pack', 'When things go wrong'], 'flow-call']];
      var map = '<section class="al-sec" id="inside"><div class="al-sec-h"><p class="al-eyebrow">What’s inside</p><h2>Four folders, one room</h2>' +
        '<p>Brand explains the why. The design system is what you build with. Screens show every part of the web app, and Flows play each journey step by step.</p></div>' +
        '<div class="map al-stagger">' + groups.map(function (g) {
          return '<a class="al-panel" href="#' + g[3] + '"><span class="fold">' + I(g[1]) + esc(g[0]) + '</span><ul>' + g[2].map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') +
            '</ul><span class="al-small" style="margin-top:auto;display:inline-flex;align-items:center;gap:6px">Open ' + I('arrowright') + '</span></a>';
        }).join('') + '</div></section>';

      var glance = '<section class="al-sec" id="glance"><div class="al-sec-h"><p class="al-eyebrow">At a glance</p><h2>The whole brand on one card</h2></div>' +
        '<div class="al-grid al-g4 al-stagger">' +
        '<div class="al-panel al-pad al-dusk al-span2" style="display:flex;align-items:center;gap:26px;min-height:200px">' + M.mark(96, { fg: '#A9C4EC' }) +
        '<div><span class="al-wm" style="font-size:58px;color:#F7F3EA">alcove</span><p class="al-small" style="margin-top:8px">Arch and lamp · Alegreya Sans 800, lowercase</p></div></div>' +
        '<div class="al-panel" style="overflow:hidden;display:grid;grid-template-rows:2fr 1fr 1fr"><div style="background:#223047;color:#F1F4F8;padding:12px;font-weight:700">Dusk</div>' +
        '<div style="background:#EDF1F5;color:#1C2533;padding:8px 12px;font-weight:700">Mist</div><div style="background:#E8A33C;color:#3A2600;padding:8px 12px;font-weight:700">Lamp</div></div>' +
        '<div class="al-panel al-pad"><p style="margin:0;font:800 40px/1 var(--al-font-ui)">Aa</p><p style="margin:6px 0 0;font:italic 400 22px/1.2 var(--al-font-read)">Alegreya</p>' +
        '<p class="al-small" style="margin-top:8px">Sans for the room, serif for your writing</p></div>' +
        '<div class="al-panel al-pad al-span2" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">' + U.state('closed', 'Closed') + U.state('lit', 'Lamp on') + U.state('working', 'Working on it') +
        U.state('waiting', 'On its way') + U.state('unknown', 'Not sure yet') + U.state('problem', 'Couldn’t open') + U.state('done', 'Saved') +
        '<p class="al-small" style="width:100%;margin-top:6px">Every state the product can be in has a shape, a colour and words.</p></div>' +
        '<div class="al-panel al-pad al-span2" style="display:flex;align-items:center;gap:14px"><span class="al-btn al-btn--lamp">' + I('fingerprint') + 'Unlock with your passkey</span>' +
        '<span class="al-btn al-btn--primary">Ask</span><span class="al-btn al-btn--secondary">Add a file</span></div></div></section>';

      var how = '<section class="al-sec" id="using"><div class="al-sec-h"><p class="al-eyebrow">Using this book</p><h2>Built to keep growing</h2></div>' +
        '<div class="al-grid al-g3 al-stagger"><div class="al-panel al-pad"><h3 class="al-h3">Find anything</h3><p class="al-p" style="margin:0">Press ⌘K to search pages. The folders on the left mirror the files in this artifact: pages/brand, pages/system, pages/screens and pages/flows.</p></div>' +
        '<div class="al-panel al-pad"><h3 class="al-h3">See both themes</h3><p class="al-p" style="margin:0">Switch Auto, Light or Dark at the foot of the page list. Mockups and components follow, so every page can be checked in Mist and After hours.</p></div>' +
        '<div class="al-panel al-pad"><h3 class="al-h3">Truthful by design</h3><p class="al-p" style="margin:0">Mockups use sample data, but every state, limit and message follows the engineering docs. If the product can’t observe it, the brand doesn’t say it.</p></div></div></section>';
      return cover + idea + promises + personality + map + glance + how;
    },
    mount: function (view) {
      var b = view.querySelector('#cover-lamp'), cover = view.querySelector('.cover');
      if (!b) return;
      b.addEventListener('click', function () {
        var off = cover.classList.toggle('is-off');
        b.querySelector('span').textContent = off ? 'Turn the lamp on' : 'Turn the lamp off';
      });
    }
  });
})();
