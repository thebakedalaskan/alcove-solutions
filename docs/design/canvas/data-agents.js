/*
 * Agents, a place of its own: what the page knows. The agents people use stand on the horizon, solid once they're
 * connected and dashed until then, as people not on Alcove yet are on Team. Each kind says how it connects: one button
 * that opens the app (Cursor, VS Code), the address to paste as a connector (Claude, ChatGPT), a line for the terminal
 * (Claude Code, Codex), or, for anything else, the address or a token. Keyed to AH.D, so it tells the same story.
 */
(function () {
  var AH = window.AH, assign = AH.assign;

  /* Lucide, written as one path each. Agents' marks are plain icons, not their makers' logos. */
  var I = {
    bot: 'M12 8V4H8M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM2 14h2M20 14h2M15 13v2M9 13v2',
    sparkle: 'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z',
    chat: 'M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2zM18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1',
    pointer: 'M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z',
    code: 'M18 16l4-4-4-4M6 8l-4 4 4 4M14.5 4l-5 16',
    term2: 'M7 11l2-2-2-2M11 13h4M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
    term: 'M4 17l6-6-6-6M12 19h8',
    plug: 'M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z',
    key: 'M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4zM16 7.5a.5.5 0 1 0 1 0a.5.5 0 1 0 -1 0',
    ext: 'M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
    book: 'M12 7v14M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z',
    booked: 'M8 2v4M16 2v4M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 10h18M9 16l2 2 4-4',
    clock: 'M12 6v6l4 2M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0',
    list: 'M3 5h.01M3 12h.01M3 19h.01M8 5h13M8 12h13M8 19h13',
    pen: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
    trash: 'M10 11v6M14 11v6M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
    alert: 'M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
    wifiOff: 'M12 20h.01M8.5 16.429a5 5 0 0 1 7 0M5 12.859a10 10 0 0 1 5.17-2.69M19 12.859a10 10 0 0 0-2.007-1.523M2 8.82a15 15 0 0 1 4.177-2.643M22 8.82a15 15 0 0 0-11.288-3.764M2 2l20 20',
    retry: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5',
    unplug: 'M19 5l3-3M2 22l3-3M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4zM7.5 13.5L10 11M10.5 16.5L13 14M12 6l6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0z',
    up: 'M7 7h10v10M7 17L17 7',
    back: 'M15 18l-6-6 6-6',
    more: 'M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M18 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M4 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0',
    hourglass: 'M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2',
    folder: 'M6 14l1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2'
  };

  var ADDRESS = 'https://api.alcove.solutions/mcp';

  /*
   * The agents people use, in the order they stand on the line. `how`: `one` (a button opens the app, which asks to add
   * Alcove), `paste` (copy the address, add it as a connector there), `cmd` (one line for the terminal), `other`.
   */
  var KINDS = [
    { id: 'claude', name: 'Claude', icon: 'sparkle', how: 'paste' },
    { id: 'chatgpt', name: 'ChatGPT', icon: 'chat', how: 'paste' },
    { id: 'cursor', name: 'Cursor', icon: 'pointer', how: 'one' },
    { id: 'vscode', name: 'VS Code', icon: 'code', how: 'one' },
    { id: 'claudecode', name: 'Claude Code', icon: 'term2', how: 'cmd', cmd: 'claude mcp add --transport http alcove ' + ADDRESS, say: 'Run this in your terminal, then /mcp in Claude Code to sign in.' },
    { id: 'codex', name: 'Codex', icon: 'term', how: 'cmd', cmd: 'codex mcp add alcove --url ' + ADDRESS + ' && codex mcp login alcove', say: 'Run this in your terminal. Codex opens Alcove to sign in.' }
  ];
  var OTHER = { id: 'other', name: 'Another agent', icon: 'plug', how: 'other' };

  /* Each permission, by what it's about. Share and delete are separate choices, off unless someone turns them on. */
  var PERMS = [
    { id: 'notes:read', area: 'notes', label: 'Read notes', short: 'Read notes', detail: 'Find notes, read transcripts, ask questions' },
    { id: 'notes:write', area: 'notes', label: 'Edit notes and follow-ups', short: 'Edit notes', detail: 'Propose decisions, add follow-ups, fix a transcript' },
    { id: 'notes:share', area: 'notes', label: 'Share notes', short: 'Share notes', detail: 'Give people notes you’re allowed to share', separate: true },
    { id: 'notes:delete', area: 'notes', label: 'Delete notes', short: 'Delete notes', detail: 'Delete notes, or take shared ones out of yours', separate: true },
    { id: 'meetings:read', area: 'calls', label: 'Read calls and find people', short: 'Read calls', detail: 'See past and coming calls, find people to invite' },
    { id: 'meetings:write', area: 'calls', label: 'Book and change calls', short: 'Book calls', detail: 'Your calendar sends the invitations' },
    { id: 'calendar:read', area: 'calendar', label: 'Read your calendar', short: 'Read calendar', detail: 'See your meetings and when people are free' }
  ];
  var AREAS = [{ id: 'notes', name: 'Notes', icon: 'notes' }, { id: 'calls', name: 'Calls', icon: 'video' }, { id: 'calendar', name: 'Calendar', icon: 'cal' }];
  /*
   * When an agent asks, each area is one level you can lower, not a list of boxes to tick. Sharing and deleting are their
   * own row, off unless you turn them on.
   */
  var LEVELS = {
    notes: [
      { id: 'off', t: 'Off', d: 'It can’t see your notes', scopes: [] },
      { id: 'read', t: 'Read', d: 'Find notes, read transcripts, ask questions', scopes: ['notes:read'] },
      { id: 'edit', t: 'Read and edit', d: 'Also propose decisions, add follow-ups, fix a transcript', scopes: ['notes:read', 'notes:write'] }
    ],
    calls: [
      { id: 'off', t: 'Off', d: 'It can’t see your calls', scopes: [] },
      { id: 'see', t: 'See', d: 'Past and coming calls, and people to invite', scopes: ['meetings:read'] },
      { id: 'book', t: 'See and book', d: 'Also book, move and cancel calls. Your calendar sends the invitations.', scopes: ['meetings:read', 'meetings:write'] }
    ],
    calendar: [
      { id: 'off', t: 'Off', d: 'It can’t see your calendar', scopes: [] },
      { id: 'see', t: 'See', d: 'Your meetings, and when people are free', scopes: ['calendar:read'] }
    ]
  };
  var EXTRA = [
    { id: 'notes:share', key: 'share', t: 'Share notes', d: 'Give people notes you’re allowed to share' },
    { id: 'notes:delete', key: 'del', t: 'Delete notes', d: 'Delete notes, or take shared ones out of yours' }
  ];
  var READS = ['notes:read', 'meetings:read', 'calendar:read'];
  var ASKED = ['notes:read', 'notes:write', 'notes:share', 'notes:delete', 'meetings:read', 'meetings:write', 'calendar:read'];
  var GIVEN = ['notes:read', 'notes:write', 'meetings:read', 'meetings:write', 'calendar:read'];

  /* What's connected on the demo day, Wednesday 4 November. Signing in lasts 30 days; a token as long as it was made for. */
  var CONNS = [
    { id: 'c1', kind: 'claude', name: 'Claude', icon: 'sparkle', via: 'Signed in', since: '21 Oct', until: '20 Nov', used: '4 min ago', fresh: true, scopes: GIVEN },
    { id: 'c2', kind: 'cursor', name: 'Cursor', icon: 'pointer', via: 'Signed in', since: '2 Nov', until: '2 Dec', used: 'Yesterday', scopes: ['notes:read', 'meetings:read'] },
    { id: 'c3', kind: 'token', name: 'Weekly digest', icon: 'key', via: 'Token', since: '26 Oct', until: '25 Nov', used: 'Mon', scopes: ['notes:read'] }
  ];
  /* What each new connection looks like the moment it's allowed. */
  var NEW = {
    claude: { id: 'n-claude', kind: 'claude', name: 'Claude', icon: 'sparkle', via: 'Signed in', since: 'today', until: '4 Dec', used: 'Just connected', isNew: true, scopes: GIVEN },
    cursor: { id: 'n-cursor', kind: 'cursor', name: 'Cursor', icon: 'pointer', via: 'Signed in', since: 'today', until: '4 Dec', used: 'Just connected', isNew: true, scopes: GIVEN },
    claudecode: { id: 'n-code', kind: 'claudecode', name: 'Claude Code', icon: 'term2', via: 'Signed in', since: 'today', until: '4 Dec', used: 'Just connected', isNew: true, scopes: GIVEN },
    token: { id: 'n-token', kind: 'token', name: 'Weekly digest', icon: 'key', via: 'Token', since: 'today', until: '4 Dec', used: 'Just made', isNew: true, scopes: ['notes:read'] }
  };

  /* What they did, newest first. `kind` sets the mark: reading is quiet; a booked call is time, a follow-up horizon, a decision rose. */
  var LOG = [
    { day: 'Today', rows: [
      { id: 'a1', who: 'c1', t: '16:08', kind: 'book', verb: 'booked', obj: 'Onboarding review', sub: 'Tue 10 Nov, 11:00 · with Priya and Kofi · notes on' },
      { id: 'a2', who: 'c1', t: '16:07', kind: 'free', verb: 'checked when Priya, Kofi and you are free', sub: '9 – 13 Nov' },
      { id: 'a3', who: 'c1', t: '16:07', kind: 'read', verb: 'read', obj: 'Launch planning', sub: 'Tue 27 Oct' },
      { id: 'a4', who: 'c1', t: '16:06', kind: 'find', verb: 'searched your notes for “onboarding launch”', sub: '3 notes' },
      { id: 'a5', who: 'c1', t: '11:40', kind: 'todo', verb: 'added a follow-up to', obj: 'Art’s call', sub: '“Book the movers for the 14th”' },
      { id: 'a6', who: 'c1', t: '10:02', kind: 'decide', verb: 'proposed a decision in', obj: 'Team standup', sub: '“Support gets the help article first” · for you to confirm' }
    ] },
    { day: 'Yesterday', rows: [
      { id: 'a7', who: 'c2', t: '17:30', kind: 'read', verb: 'read', obj: 'Design review', sub: 'Tue 3 Nov' },
      { id: 'a8', who: 'c2', t: '15:20', kind: 'list', verb: 'listed your calls this week', sub: '5 calls' }
    ] },
    { day: 'Mon 2 Nov', rows: [
      { id: 'a9', who: 'c3', t: '09:00', kind: 'read', verb: 'read 6 notes', sub: 'From the week before' }
    ] }
  ];
  var MARKS = {
    read: { icon: 'book', tint: 'ink' }, find: { icon: 'search', tint: 'ink' }, list: { icon: 'list', tint: 'ink' }, free: { icon: 'clock', tint: 'ink' },
    book: { icon: 'booked', tint: 'now' }, todo: { icon: 'todo', tint: 'focus' }, decide: { icon: 'decide', tint: 'notes' }
  };

  /* Things to ask, each with the permission it needs. */
  var PROMPTS = [
    { id: 'p1', q: 'What did we decide about the launch?', needs: 'notes:read' },
    { id: 'p2', q: 'What’s on my plate this week?', needs: 'notes:read' },
    { id: 'p3', q: 'Book 45 minutes with Priya and Kofi next week.', needs: 'meetings:write' },
    { id: 'p4', q: 'Add a follow-up for Kofi from today’s standup.', needs: 'notes:write' }
  ];

  function only(ids) { return CONNS.filter(function (c) { return ids.indexOf(c.id) >= 0; }); }

  /*
   * Every state is a step. `scene`: first (nothing connected) or today. `pop`: whose popover is open, a kind or a
   * connection. `view`: what that popover shows. `ask`: the agent asking on the sky, and `stage` how that went.
   */
  var STEPS = {
    agToday: {},
    agFirst: { scene: 'first' },
    /* Connecting Claude: copy the address, paste it in Claude, allow it here. */
    agPickHot: { scene: 'first', hot: 'tile-claude' },
    agClaude: { scene: 'first', pop: 'claude' },
    agClaudeGoHot: { scene: 'first', pop: 'claude', hot: 'go' },
    agClaudeWaiting: { scene: 'first', pop: 'claude', waiting: true, toast: 'Copied. Claude opens in a new tab.' },
    agClaudeAsk: { scene: 'first', ask: 'claude' },
    agClaudeAllowHot: { scene: 'first', ask: 'claude', hot: 'allow' },
    /* Lowering a level before allowing. */
    agAskLevelHot: { scene: 'first', ask: 'claude', hot: 'lv-calls' },
    agAskLevel: { scene: 'first', ask: 'claude', askMenu: 'calls', hot: 'lvo-see' },
    agAskLevelPicked: { scene: 'first', ask: 'claude', askLv: { calls: 'see' }, hot: 'allow' },
    agAskExtra: { scene: 'first', ask: 'claude', askMenu: 'extra' },
    agClaudeAllowed: { scene: 'first', ask: 'claude', stage: 'allowed', conns: [NEW.claude] },
    agClaudeBack: { scene: 'first', pop: 'n-claude', view: 'joined', conns: [NEW.claude] },
    /* One button: Cursor opens and asks. */
    agCursor: { scene: 'first', pop: 'cursor' },
    agCursorHot: { scene: 'first', pop: 'cursor', hot: 'go' },
    agCursorWaiting: { scene: 'first', pop: 'cursor', waiting: true },
    agCursorAsk: { scene: 'first', ask: 'cursor' },
    agCursorAllowed: { scene: 'first', ask: 'cursor', stage: 'allowed', conns: [NEW.cursor] },
    /* One line in the terminal. */
    agCode: { scene: 'first', pop: 'claudecode' },
    agCodeWaiting: { scene: 'first', pop: 'claudecode', waiting: true, toast: 'Copied. Run it in your terminal.' },
    agCodeAsk: { scene: 'first', ask: 'claudecode' },
    agCodeAllowed: { scene: 'first', ask: 'claudecode', stage: 'allowed', conns: [NEW.claudecode] },
    /* What an agent can do, changed in place. */
    agConnHot: { hot: 'tile-c1' },
    agConn: { pop: 'c1' },
    agPermHot: { pop: 'c1', hot: 'perm-meetings:write' },
    agPermOff: { pop: 'c1', perms: { c1: ['notes:read', 'notes:write', 'meetings:read', 'calendar:read'] }, saved: 'c1' },
    /* Disconnecting. */
    agOffHot: { pop: 'c1', hot: 'off' },
    agOffAsk: { pop: 'c1', view: 'off', hot: 'off-yes' },
    agOffDone: { conns: only(['c2', 'c3']), toast: 'Claude is disconnected. It can’t reach Alcove any more.' },
    /* What they did. */
    agLogHot: { hot: 'obj-a1' },
    agPromptHot: { hot: 'prompt-p3' },
    agPromptCopied: { toast: 'Copied. Paste it into Claude.' },
    /* A token for a script. */
    agOtherHot: { conns: only(['c1', 'c2']), hot: 'tile-other' },
    agOther: { conns: only(['c1', 'c2']), pop: 'other' },
    agTokenHot: { conns: only(['c1', 'c2']), pop: 'other', hot: 'token' },
    agToken: { conns: only(['c1', 'c2']), pop: 'other', view: 'token' },
    agTokenMade: { conns: only(['c1', 'c2']), pop: 'other', view: 'made' },
    agTokenListed: { conns: only(['c1', 'c2']).concat([NEW.token]) },
    /* When access runs out. */
    agEnding: { ending: 'c2' },
    agEndingPop: { ending: 'c2', pop: 'c2' },
    agEndingKept: { pop: 'c2', kept: 'c2', toast: 'Cursor can use Alcove until 4 Dec.' },
    /* When something's wrong. */
    agEnded: { scene: 'first', ask: 'claude', stage: 'ended' },
    agLoadFail: { fail: 'load' },
    agOffline: { fail: 'offline' },
    /* On a phone. */
    agPhone: {},
    agPhoneConn: { pop: 'c1' },
    agPhoneAsk: { scene: 'first', ask: 'claude' }
  };

  /* For the journeys: which board draws a frame (Agents unless it says), and whether it's a phone. */
  var J = function (step, t, board) { return { step: step, t: t, board: board || 'Agents' }; };
  var JOURNEYS = [
    { name: 'Connect Claude', frames: [
      J('agNavHot', 'Agents is a place in the side panel now, under Team. Click it from any page.', 'Settings'),
      J('agFirst', 'The agents people use stand on the horizon, dashed until they’re connected.'),
      J('agClaudeGoHot', 'Click Claude. One line says what to do, and one button does it: Copy and open Claude.'),
      J('agClaudeWaiting', 'Claude opens in a new tab with the address copied, to paste into its connectors. The popover waits.'),
      J('agClaudeAsk', 'Claude opens Alcove in a new tab, on Agents. You and Claude stand on the horizon; above, one line of what it could do in each part of Alcove.'),
      J('agClaudeAllowed', 'Allow. The line between you closes. Go back to Claude and ask it something.'),
      J('agClaudeBack', 'The first tab knows too: Claude stands on the horizon, and its popover offers a first question.')
    ] },
    { name: 'Allow less than it asks for', frames: [
      J('agAskLevelHot', 'Each row is how far it can go. Press See and book.'),
      J('agAskLevel', 'The levels open under it, each saying what it allows.'),
      J('agAskLevelPicked', 'See. Allow gives Claude only that.'),
      J('agAskExtra', 'Sharing and deleting are their own row, off until you turn them on.')
    ] },
    { name: 'One button: Cursor or VS Code', frames: [
      J('agCursorHot', 'Click Cursor. One button: Add to Cursor.'),
      J('agCursorWaiting', 'Cursor opens and asks to add Alcove. The popover waits for it.'),
      J('agCursorAsk', 'Cursor opens Alcove to ask what it can do.'),
      J('agCursorAllowed', 'Allow, and it’s connected.')
    ] },
    { name: 'One line: Claude Code or Codex', frames: [
      J('agCode', 'Click Claude Code. One command, and Copy command.'),
      J('agCodeWaiting', 'Run it in your terminal. /mcp in Claude Code opens Alcove. The popover waits.'),
      J('agCodeAsk', 'The same question on the sky.'),
      J('agCodeAllowed', 'Allowed.')
    ] },
    { name: 'Change what an agent can do', frames: [
      J('agConnHot', 'Click an agent on the horizon.'),
      J('agConn', 'Its popover: when it was last used, what it can do, and until when.'),
      J('agPermHot', 'Press Book and change calls to take it away.'),
      J('agPermOff', 'Saved. Claude can’t book calls from its next request.')
    ] },
    { name: 'Disconnect an agent', frames: [
      J('agOffHot', 'Click Disconnect in its popover.'),
      J('agOffAsk', 'It asks first, in the same popover.'),
      J('agOffDone', 'It leaves the horizon, and can’t reach Alcove any more.')
    ] },
    { name: 'See what your agents did', frames: [
      J('agToday', 'Under the horizon: everything your agents read and changed, newest first. Only you see it.'),
      J('agLogHot', 'Click what it’s about to open it.'),
      J('agPromptHot', 'Beside it, things to ask, each saying which agents can do it. Copy one.'),
      J('agPromptCopied', 'Paste it into your agent.')
    ] },
    { name: 'A token for a script', frames: [
      J('agOtherHot', 'Click Another agent.'),
      J('agOther', 'Any agent that works with MCP: the address, and Copy address. A script that can’t sign in: Create a token.'),
      J('agToken', 'Name it, choose how long it lasts and what it can do.'),
      J('agTokenMade', 'The token shows once. Copy it with Alcove’s address.'),
      J('agTokenListed', 'Done. It stands on the horizon with a key.')
    ] },
    { name: 'When access runs out', frames: [
      J('agEnding', 'An agent’s access ends tomorrow: its line says so, in caution.'),
      J('agEndingPop', 'Its popover offers 30 more days.'),
      J('agEndingKept', 'Kept.')
    ] },
    { name: 'When something’s wrong', frames: [
      J('agEnded', 'A request that waited too long, or was answered in another tab.'),
      J('agLoadFail', 'Your agents didn’t load.'),
      J('agOffline', 'Offline. Your agents keep working; this page catches up.')
    ] },
    { name: 'Settings points here', frames: [
      J('agSettingsHot', 'Settings › Connections keeps one row for agents: who’s connected, and Open Agents.', 'Settings'),
      J('agToday', 'It opens Agents.')
    ] }
  ];
  var JOURNEYS_PHONE = [
    J('agSettingsPhone', 'On a phone the tab bar keeps its five. Agents opens from Settings › Connections.', 'Settings'),
    J('agPhone', 'The line scrolls sideways under the sky. What they did follows.'),
    J('agPhoneConn', 'An agent opens as a sheet.'),
    J('agPhoneAsk', 'Allowing works the same on a phone.')
  ];

  /* Steps the Settings board reads. AH.STEPS reaches the side panel; AH.ST3.STEPS is Settings' own. */
  Object.assign(AH.STEPS, { agNavHot: { hot: 'nav-agents' } });
  if (AH.ST3) Object.assign(AH.ST3.STEPS, {
    agNavHot: { to: 'you' },
    agSettingsHot: { to: 'apps', hot: 'agents-open' },
    agSettingsPhone: { to: 'apps', hot: 'agents-open' }
  });

  AH.AG = {
    I: I, ADDRESS: ADDRESS, KINDS: KINDS, OTHER: OTHER, PERMS: PERMS, AREAS: AREAS, LEVELS: LEVELS, EXTRA: EXTRA, READS: READS, ASKED: ASKED, GIVEN: GIVEN,
    CONNS: CONNS, NEW: NEW, LOG: LOG, MARKS: MARKS, PROMPTS: PROMPTS, STEPS: STEPS, JOURNEYS: JOURNEYS, JOURNEYS_PHONE: JOURNEYS_PHONE
  };
})();
