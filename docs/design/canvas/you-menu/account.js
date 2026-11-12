/*
 * Your menu, at the top right of every page. Today your face is a link straight to Settings; here it opens a menu instead:
 * you, standing in the last of the light (Settings' own moment, in small), then what you reach for from any page: pause
 * what reaches you, the theme, Settings, the tour, and Sign out. Sign out asks in place when something on this device
 * would be lost, with the app's own words. On a phone the same menu is a sheet. Everything here is made up: you are Art
 * Vandelay at Vandelay Industries, on Wednesday 4 November at 16:12.
 */
(function () {
  var AH = window.AH, I = AH.I, assign = AH.assign;

  /* Lucide, as the app's Icon draws it. `sunMoon` is the one name the app's Icon map would gain. */
  Object.assign(I, {
    gear: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',
    compass: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0M16.24 7.76l-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z',
    out: 'M16 17l5-5-5-5M21 12H9M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4',
    bell: 'M10.268 21a2 2 0 0 0 3.464 0M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326',
    bellOff: 'M10.268 21a2 2 0 0 0 3.464 0M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742M2 2l20 20M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05',
    sunMoon: 'M12 8a2.83 2.83 0 0 0 4 4 4 4 0 1 1-4-4M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4',
    chev: 'M6 9l6 6 6-6',
    globe: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20',
    laptop: 'M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2zM20.054 15.987H3.946',
    bot: 'M12 8V4H8M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM2 14h2M20 14h2M15 13v2M9 13v2',
    external: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'
  });

  /* ------------------------------------------------------------------ the world */
  var ME = { id: 'art', name: 'Art Vandelay', email: 'art@vandelay.industries' };
  var LONG = { id: 'art', name: 'Art Vandelay-Featherstonehaugh', email: 'art.vandelay-featherstonehaugh@vandelay-import-export.industries' };
  /* Now is 16:12, as Home's side panel says (Design sync at 17:30, in 1 h 18 min). */
  var PAUSES = [
    { id: 'm30', t: 'For 30 minutes', end: '16:42', until: '16:42' },
    { id: 'h1', t: 'For 1 hour', end: '17:12', until: '17:12' },
    { id: 'tmrw', t: 'Until tomorrow', end: '9:00', until: 'tomorrow 9:00' }
  ];

  /* ------------------------------------------------------------------ the states, each a step */
  /*
   * amOpen: the menu is open. amPane: 'pause' while the pause choices are open in place. amPaused: which pause is on.
   * amTheme: system, light or dark (light and dark repaint the whole board at once). amKept: recordings on this device that
   * haven't uploaded; amWords: something written that hasn't reached Alcove. amOut: 'ask' while Sign out asks, 'busy' while
   * it signs out. amPage: home, settings or welcome. amFocus: the row the keyboard is on. amHot: what's about to be pressed.
   */
  var STEPS = {
    amRest: {},
    amHotMe: { amHot: 'me' },
    amOpen: { amOpen: true },
    amHotSettings: { amOpen: true, amHot: 'settings' },
    amSettings: { amPage: 'settings' },
    amHotTour: { amOpen: true, amHot: 'tour' },
    amHotLight: { amOpen: true, amHot: 'theme-light' },
    amLight: { amOpen: true, amTheme: 'light' },
    amLightShut: { amTheme: 'light' },
    amHotPause: { amOpen: true, amHot: 'pause' },
    amPausing: { amOpen: true, amPane: 'pause' },
    amPauseHot: { amOpen: true, amPane: 'pause', amHot: 'pause-h1' },
    amPaused: { amOpen: true, amPaused: 'h1' },
    amPausedShut: { amPaused: 'h1' },
    amPausedHot: { amPaused: 'h1', amHot: 'me' },
    amHotResume: { amOpen: true, amPaused: 'h1', amHot: 'resume' },
    amPausedNight: { amOpen: true, amPaused: 'tmrw' },
    amHotOut: { amOpen: true, amHot: 'out' },
    amWelcome: { amPage: 'welcome' },
    amHotOutKept: { amOpen: true, amKept: 2, amHot: 'out' },
    amAsk: { amOpen: true, amKept: 2, amOut: 'ask' },
    amAskHotStay: { amOpen: true, amKept: 2, amOut: 'ask', amHot: 'stay' },
    amAskHotGo: { amOpen: true, amKept: 2, amOut: 'ask', amHot: 'go' },
    amAskBusy: { amOpen: true, amKept: 2, amOut: 'busy' },
    amAskOne: { amOpen: true, amKept: 1, amOut: 'ask' },
    amAskWords: { amOpen: true, amWords: true, amOut: 'ask' },
    amAskBoth: { amOpen: true, amKept: 2, amWords: true, amOut: 'ask' },
    amKeyMe: { amFocus: 'me' },
    amKeyOpen: { amOpen: true, amFocus: 'pause' },
    amKeySettings: { amOpen: true, amFocus: 'settings' },
    amLong: { amOpen: true, amLong: true }
  };

  /* Journeys: one row each, from the click to what it leads to. */
  var JOURNEYS = [
    { name: 'Open your menu, then Settings', frames: [
      { step: 'amHotMe', t: 'Click your face, at the top right of any page.' },
      { step: 'amOpen', t: 'Your menu opens under it, with a caret: you, then what you reach for from anywhere.' },
      { step: 'amHotSettings', t: 'Click Settings.' },
      { step: 'amSettings', t: 'Settings opens as a page. Your face makes way at the top right: you’re on the horizon.' }
    ] },
    { name: 'Change the theme', frames: [
      { step: 'amHotLight', t: 'The three evenings are System, Light and Dark, as in Settings. Click Light.' },
      { step: 'amLight', t: 'The whole page turns at once, and the menu stays open on it.' },
      { step: 'amLightShut', t: 'Click anywhere else, or press Esc. It’s kept, as Settings › You › Theme.' }
    ] },
    { name: 'Pause notifications', frames: [
      { step: 'amHotPause', t: 'Click Pause notifications.' },
      { step: 'amPausing', t: 'How long opens in place, under it. No second menu.' },
      { step: 'amPauseHot', t: 'Click 1 hour.' },
      { step: 'amPaused', t: 'Paused until 17:12. Alerts and sounds wait until then.' },
      { step: 'amPausedShut', t: 'Closed: a small bell on your face says it’s paused, all the time it is.' },
      { step: 'amHotResume', t: 'Open the menu again and Resume, or it ends by itself at 17:12.' }
    ] },
    { name: 'Sign out', frames: [
      { step: 'amHotOut', t: 'Click Sign out. Nothing on this device is waiting, so nothing asks.' },
      { step: 'amWelcome', t: 'You’re signed out, on the welcome page.' }
    ] },
    { name: 'Sign out with recordings that haven’t uploaded', frames: [
      { step: 'amHotOutKept', t: 'Two recordings on this device haven’t uploaded yet. Click Sign out.' },
      { step: 'amAsk', t: 'The menu asks in place, in Settings’ own words. Stay signed in is the one that loses nothing.' },
      { step: 'amAskHotGo', t: 'Or Sign out and delete them.' },
      { step: 'amAskBusy', t: 'Signing out.' },
      { step: 'amWelcome', t: 'Signed out, on the welcome page.' }
    ] },
    { name: 'With the keyboard', frames: [
      { step: 'amKeyMe', t: 'Tab to your face.' },
      { step: 'amKeyOpen', t: 'Enter or ↓ opens the menu on its first row.' },
      { step: 'amKeySettings', t: '↓ to Settings, then Enter. Esc closes the menu and goes back to your face.' },
      { step: 'amSettings', t: 'Settings.' }
    ] }
  ];
  var PHONE_JOURNEYS = [
    { name: 'On a phone', phone: true, frames: [
      { step: 'amHotMe', t: 'Tap your face in the top bar.' },
      { step: 'amOpen', t: 'The menu rises as a sheet.' },
      { step: 'amPausing', t: 'Pause notifications opens in place.' },
      { step: 'amPausedShut', t: 'Paused: the bell is on your face.' },
      { step: 'amAsk', t: 'Sign out asks here too.' },
      { step: 'amWelcome', t: 'Signed out.' }
    ] }
  ];
  var STATES = [
    { name: 'The menu', frames: [
      { step: 'amRest', t: 'Closed: your face, at the top right.' },
      { step: 'amOpen', t: 'Open.' },
      { step: 'amOpen', mode: 'light', t: 'Open, in the light.' },
      { step: 'amKeyOpen', t: 'From the keyboard.' },
      { step: 'amLong', t: 'A long name and address end in …' }
    ] },
    { name: 'Pausing', frames: [
      { step: 'amPausing', t: 'How long.' },
      { step: 'amPaused', t: 'Paused for an hour.' },
      { step: 'amPausedNight', t: 'Paused until tomorrow.' },
      { step: 'amPausedShut', t: 'Paused, closed.' },
      { step: 'amPausedShut', mode: 'light', t: 'Paused, closed, in the light.' }
    ] },
    { name: 'Signing out', frames: [
      { step: 'amAskOne', t: 'One recording hasn’t uploaded.' },
      { step: 'amAsk', t: 'Two haven’t.' },
      { step: 'amAskWords', t: 'Something written hasn’t reached Alcove.' },
      { step: 'amAskBoth', t: 'Both.' },
      { step: 'amAskBusy', t: 'Signing out.' },
      { step: 'amAsk', mode: 'light', t: 'Asking, in the light.' }
    ] },
    { name: 'Where it leads', frames: [
      { step: 'amSettings', t: 'Settings.' },
      { step: 'amSettings', mode: 'light', t: 'Settings, in the light.' },
      { step: 'amWelcome', t: 'Signed out: the welcome page.' }
    ] }
  ];

  /* ------------------------------------------------------------------ the words Settings already says */
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  /* What signing out deletes here (SignOut.tsx's `deletes`). */
  function deletes(count, words) {
    var one = count === 1;
    var recordings = plural(count, 'recording') + ' on this device ' + (one ? 'hasn’t' : 'haven’t') + ' uploaded';
    if (count > 0 && words) return { says: recordings + ', and something you wrote hasn’t reached Alcove. Signing out deletes them.', them: 'them' };
    if (count > 0) return { says: recordings + '. Signing out deletes ' + (one ? 'it' : 'them') + '.', them: one ? 'it' : 'them' };
    return { says: 'Something you wrote hasn’t reached Alcove yet. Signing out deletes it from this browser.', them: 'it' };
  }
  /* What staying signed in does for them (SignOut.tsx's `staying`), when they can all upload. */
  function staying(count) {
    return 'Stay signed in and ' + (count === 1 ? 'it uploads by itself' : 'they upload by themselves') + ' once you’re online, then the notes are written.';
  }

  /* ------------------------------------------------------------------ the view */
  /*
   * `c` is the board. `home` holds the board's own helpers: `toast(msg)`. Returns the menu's model for the Menu part, the
   * trigger's classes, which page is showing, and the theme the board should be drawn in.
   */
  function view(c, home) {
    var p = c.props || {}, hs = AH.hash();
    var stepId = hs.step || p.step || 'amRest';
    var st = assign({ amOpen: false, amPane: '', amPaused: '', amTheme: 'system', amKept: 0, amWords: false, amOut: '', amPage: 'home', amFocus: '', amHot: '', amLong: false }, STEPS[stepId] || {}, c.state || {});
    var set = function (patch) { c.setState(assign({ amHot: '', amFocus: '' }, patch)); };
    var cls = function (k) { return (st.amHot === k ? ' is-hot' : '') + (st.amFocus === k ? ' is-key' : ''); };
    var asked = hs.mode || p.mode || 'dark';
    var mode = st.amTheme === 'light' || st.amTheme === 'dark' ? st.amTheme : asked;
    var who = st.amLong ? LONG : ME;
    var paused = PAUSES.filter(function (x) { return x.id === st.amPaused; })[0] || null;
    var close = function () { set({ amOpen: false, amPane: '', amOut: '' }); };

    /* Theme: three small evenings, as Settings › You draws them. */
    var eve = function (m) { return AH.scene('home', 'blue-hour', m).vars; };
    var themes = [
      { id: 'system', t: 'System', a: eve('light'), b: eve('dark'), hasB: true, stars: false, clouds: true },
      { id: 'light', t: 'Light', a: eve('light'), b: '', hasB: false, stars: false, clouds: true },
      { id: 'dark', t: 'Dark', a: eve('dark'), b: '', hasB: false, stars: true, clouds: false }
    ].map(function (t) {
      var on = st.amTheme === t.id;
      return assign(t, { cls: (on ? ' is-on' : '') + cls('theme-' + t.id), onA: on ? 'true' : 'false', label: t.t + (on ? ', chosen' : ''), go: function () { set({ amTheme: t.id }); } });
    });

    /* Sign out: straight out, unless something here would be lost. */
    var waiting = st.amKept > 0 || st.amWords;
    var signOut = function () {
      if (waiting) set({ amOut: 'ask' });
      else set({ amOpen: false, amPage: 'welcome' });
    };
    var d = deletes(st.amKept, st.amWords);
    var asking = st.amOut === 'ask' || st.amOut === 'busy';
    var busy = st.amOut === 'busy';
    var ask = {
      says: d.says,
      stay: st.amKept > 0 ? staying(st.amKept) : '',
      hasStay: st.amKept > 0,
      words: st.amWords,
      wordsLine: 'Stay signed in and it stays here until it can go, or copy it first: only your own words come with it.',
      busy: busy, busyA: busy ? 'true' : 'false',
      goText: busy ? 'Signing out' : 'Sign out and delete ' + d.them,
      stayCls: cls('stay'), goCls: cls('go'), copyCls: cls('copy'),
      onStay: function () { if (!busy) set({ amOut: '' }); },
      onCopy: function () { if (!busy) home.toast('Copied. Paste it wherever you like.'); },
      onGo: function () {
        if (busy) return;
        set({ amOut: 'busy' });
        clearTimeout(c.__amOut);
        c.__amOut = setTimeout(function () { c.setState({ amOut: '', amOpen: false, amPage: 'welcome', amKept: 0, amWords: false }); }, 1100);
      }
    };

    var menu = {
      I: I, mode: mode, who: who, headStyle: AH.scene('settings', 'blue-hour', mode).vars,
      list: !asking, asking: asking, ask: ask,
      pause: {
        off: !paused, on: !!paused,
        open: !paused && st.amPane === 'pause',
        openA: !paused && st.amPane === 'pause' ? 'true' : 'false',
        until: paused ? paused.until : '',
        cls: cls('pause') + (st.amPane === 'pause' ? ' is-open' : ''),
        go: function () { set({ amPane: st.amPane === 'pause' ? '' : 'pause' }); },
        opts: PAUSES.map(function (x) {
          return { t: x.t, end: x.end, cls: cls('pause-' + x.id), go: function () { set({ amPaused: x.id, amPane: '' }); } };
        }),
        resumeCls: cls('resume'),
        resume: function () { set({ amPaused: '' }); home.toast('Notifications are back on.'); }
      },
      theme: { cls: cls('theme'), list: themes },
      settings: { cls: cls('settings'), go: function () { set({ amOpen: false, amPage: 'settings' }); } },
      tour: { cls: cls('tour'), go: function () { close(); home.toast('The tour of Home starts here. It isn’t part of this canvas.'); } },
      out: { cls: cls('out'), go: signOut }
    };

    var open = st.amOpen && st.amPage === 'home';
    return {
      st: st, mode: mode, page: st.amPage,
      onHome: st.amPage === 'home', onSettings: st.amPage === 'settings', onWelcome: st.amPage === 'welcome',
      open: open, menu: menu, who: who,
      me: {
        cls: (open ? ' is-open' : '') + (paused ? ' is-paused' : '') + cls('me'),
        expanded: open ? 'true' : 'false',
        label: who.name + ', your menu' + (paused ? '. Notifications paused until ' + paused.until : ''),
        title: paused ? 'Notifications paused until ' + paused.until : '',
        paused: !!paused,
        toggle: function () { set({ amOpen: !st.amOpen, amPane: '', amOut: '' }); }
      },
      close: close,
      /* Esc closes what's open, one step at a time; ↓ and ↑ move between the menu's rows. */
      onKey: function (e) {
        if (e.key === 'Escape') {
          if (st.amOut === 'ask') set({ amOut: '' });
          else if (st.amPane) set({ amPane: '' });
          else if (st.amOpen) { set({ amOpen: false }); var me = e.currentTarget.querySelector('.am-me'); if (me) me.focus(); }
          return;
        }
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && st.amOpen) {
          var root = e.currentTarget;
          var rows = Array.prototype.slice.call(root.querySelectorAll('.am-menu [data-am-row]')).filter(function (el) { return el.offsetParent !== null; });
          if (!rows.length) return;
          e.preventDefault();
          var at = rows.indexOf(document.activeElement);
          var next = e.key === 'ArrowDown' ? (at + 1) % rows.length : (at <= 0 ? rows.length - 1 : at - 1);
          rows[next].focus();
        }
      },
      goHome: function () { set({ amPage: 'home', amOpen: false }); },
      signIn: function () { set({ amPage: 'home', amOpen: false }); }
    };
  }

  AH.AM = { STEPS: STEPS, JOURNEYS: JOURNEYS, PHONE_JOURNEYS: PHONE_JOURNEYS, STATES: STATES, view: view, ME: ME };
})();
