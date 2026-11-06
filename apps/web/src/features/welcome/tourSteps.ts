/*
 * The call tour's script. Everything on the stage is one state (`Stage`). Each step is a list of beats: change the
 * stage, wait, or move the pointer to something and press it. A step's still is its beats folded together with no waits
 * and no pointer, so the picture it ends on and the picture reduced motion shows are the same one.
 */
import type { IconName } from '@alcove/ui';
import type { CastId } from '~/features/notes/cast';

/** The stage's design size: everything on it is placed in these pixels. */
export const STAGE_W = 1120;
export const STAGE_H = 700;

/** Who's in the call, in the grid's order. You are Art. */
export const ORDER = ['priya', 'kofi', 'aiko', 'maya', 'diego', 'art'] as const satisfies readonly CastId[];
export type Who = (typeof ORDER)[number];

export type StepId = 'notes' | 'layout' | 'status' | 'translate' | 'chat' | 'nudge' | 'rooms' | 'work';
export interface Step {
  id: StepId;
  icon: IconName;
  title: string;
  line: string;
  /** What the stage shows by the end of the step, for people who can't see it. */
  shows: string;
}

export const STEPS: readonly Step[] = [
  {
    id: 'notes', icon: 'notes', title: 'Notes as you talk',
    line: 'Decisions and follow-ups fill in while people speak, and everyone sees the sign while notes are on. No bot joins the call.',
    shows: 'A call with six people. The notes panel fills in as they talk: one decision and two follow-ups, then a summary so far.'
  },
  {
    id: 'layout', icon: 'layout', title: 'Arrange it your way',
    line: 'Make someone the speaker, give a shared screen the room, or fold everyone into arches on the horizon. Only your screen changes.',
    shows: 'The View menu turns the call to speaker view, then a shared screen takes the stage and everyone folds into arches on the horizon.'
  },
  {
    id: 'status', icon: 'away', title: 'Be right back',
    line: 'Step away without leaving. Your tile says when you’ll be back, and the call carries on.',
    shows: 'You set Be right back for five minutes, and your tile dims with the time you’ll be back. Maya is listening only.'
  },
  {
    id: 'translate', icon: 'translate', title: 'Captions in your language',
    line: 'Read what people say in your own language, with their words underneath. It’s translated in confidential compute, for you alone.',
    shows: 'Captions show Aiko’s Japanese and Diego’s Spanish in English, with their own words underneath.'
  },
  {
    id: 'chat', icon: 'chat', title: 'Private messages and threads',
    line: 'Write to everyone, reply in a thread, or message one person. Only the people in a conversation can read it.',
    shows: 'The chat panel: a message to everyone with a thread of replies, then a private message to Priya and your reply.'
  },
  {
    id: 'nudge', icon: 'nudge', title: 'A quiet nudge',
    line: 'Let someone know they’re muted, hard to hear or going fast, without interrupting. Only they see it, and Alcove tells you when you’re talking on mute.',
    shows: 'Alcove tells you you’re talking on mute. Then you send Kofi a nudge: Can’t hear you.'
  },
  {
    id: 'rooms', icon: 'rooms', title: 'Breakout rooms',
    line: 'Split into rooms in two clicks. Everyone moves at once, the rooms share one timer, and each room’s notes join the call’s notes.',
    shows: 'Three breakout rooms open, everyone moves into them at once, and a message goes to every room.'
  },
  {
    id: 'work', icon: 'pen', title: 'Documents and boards',
    line: 'Write and draw together without leaving the call. Everyone edits at once, and the notes keep what changed.',
    shows: 'A shared document and a board inside the call, with three people editing at once.'
  }
];

/** The step a `data-step` names, if it names one. */
export const stepOf = (v: string | null): StepId | null => STEPS.find((x) => x.id === v)?.id ?? null;

/* ---- where everyone stands ---- */

type Layout = 'grid' | 'panel' | 'speaker' | 'share' | 'arches' | 'rooms' | 'work';
/** A place on the stage in design pixels. An arch is someone folded down to their face. */
export interface Box { x: number; y: number; w: number; h: number; arch: boolean }

const tile = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h, arch: false });
const arch = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h, arch: true });
const NOWHERE = tile(0, 0, 0, 0);

function grid(n: number, x: number, y: number, w: number, h: number, cols: number, gap = 12): Box[] {
  const rows = Math.ceil(n / cols), tw = (w - (cols - 1) * gap) / cols, th = (h - (rows - 1) * gap) / rows;
  return Array.from({ length: n }, (_, i) => tile(x + (i % cols) * (tw + gap), y + Math.floor(i / cols) * (th + gap), tw, th));
}
const inOrder = (b: readonly Box[]): Record<Who, Box> => ({
  priya: b[0] ?? NOWHERE, kofi: b[1] ?? NOWHERE, aiko: b[2] ?? NOWHERE, maya: b[3] ?? NOWHERE, diego: b[4] ?? NOWHERE, art: b[5] ?? NOWHERE
});

/** The tiles' area, under the top bar and over the dock. */
const AREA = { x: 16, y: 60, w: 1088, h: 552 };

export const ROOMS = [
  { name: 'Pricing', who: ['maya', 'diego'] },
  { name: 'Onboarding', who: ['priya', 'kofi'] },
  { name: 'Support', who: ['aiko', 'art'] }
] as const satisfies readonly { name: string; who: readonly [Who, Who] }[];
/** How far across the stage a room's alcove stands. */
export const alcoveX = (room: number) => 70 + room * 340;
/** Everyone in their room, standing small on its horizon. */
function inRooms(): Record<Who, Box> {
  const at = inOrder([]);
  ROOMS.forEach((r, i) => r.who.forEach((id, seat) => { at[id] = arch(alcoveX(i) + 150 + (seat ? 8 : -80), 386, 72, 78); }));
  return at;
}

export const LAYOUTS: Record<Layout, Record<Who, Box>> = {
  grid: inOrder(grid(6, AREA.x, AREA.y, AREA.w, AREA.h, 3)),
  panel: inOrder(grid(6, AREA.x, AREA.y, 748, AREA.h, 2)),
  speaker: inOrder([tile(AREA.x, AREA.y, AREA.w, 404), ...grid(5, AREA.x, AREA.y + 416, AREA.w, 136, 5)]),
  share: inOrder(grid(6, AREA.x + 730, AREA.y, AREA.w - 730, AREA.h, 2)),
  /* On the horizon either side of the dock. */
  arches: inOrder([108, 156, 204, 876, 924, 972].map((x) => arch(x, 612, 40, 43))),
  rooms: inRooms(),
  work: inOrder(grid(6, 928, AREA.y, 176, AREA.h, 1, 8))
};

/** Where Kofi's shared screen is: beside everyone, or over the horizon they stand on. */
export const shareAt = (l: Layout): Box => (l === 'share' ? tile(16, 60, 718, 552) : l === 'arches' ? tile(16, 60, 1088, 512) : tile(16, 60, 700, 552));

/* ---- what's said and written ---- */

export const SUMMARY = 'The launch moves a week to give support time. Kofi finishes the onboarding screens and Aiko writes the help article.';
export const LINES = [
  { who: 'aiko', from: 'From Japanese', en: 'The Japanese help centre can go live on the same day.', or: '日本語のヘルプセンターも同じ日に公開できます。' },
  { who: 'diego', from: 'From Spanish', en: 'Then sales can announce it that same week.', or: 'Entonces ventas puede anunciarlo esa misma semana.' }
] as const satisfies readonly { who: Who; from: string; en: string; or: string }[];
const REPLY = 'Yes, I’ll stay on.';
export const DOC_LINE = 'Help article ready for support by Friday';
/** The rooms' timer starts here, in seconds: 9:12. */
const ROOM_TIME = 552;
/** The board's connectors, in the order they're drawn. */
export const LINKS = ['M196 87H262', 'M394 87H470', 'M328 122V214', 'M394 248C450 248 520 200 540 116', 'M640 87H706'] as const;

const words = (text: string) => text.split(' ').length;
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/* ---- the stage ---- */

type Panel = 'notes' | 'chat' | 'rooms';
type Tool = 'captions' | 'rooms' | 'work' | 'notes' | 'chat';
export type PopId = 'view' | 'status' | 'lang' | 'tile' | 'nudge';
export interface Point { x: number; y: number }

export interface Stage {
  layout: Layout;
  speaking: Who | null;
  muted: readonly Who[];
  /** The tile the pointer is over, showing its ⋯. */
  hover: Who | null;
  /** Who shows their status on their tile. */
  status: readonly Who[];
  /** You've stepped away: your tile dims, with the time left along its edge. */
  away: boolean;
  /** "You're talking on mute", over your tile. */
  onMute: boolean;
  panel: Panel | null;
  /** The dock's tool that's open. */
  tool: Tool | null;
  micOff: boolean;
  unread: number;
  /** The menus that are open, and where each one opened. */
  pops: readonly PopId[];
  at: Readonly<Partial<Record<PopId, Point>>>;
  /** What the pointer is over: a button, a menu's row. */
  hi: readonly string[];
  /** What's chosen in the menus. */
  picked: readonly string[];
  toast: { on: boolean; say: 'share' | 'nudge' };
  caption: { on: boolean; line: 0 | 1; words: number };
  /** "Only your screen changes". */
  chip: boolean;
  horizon: boolean;
  share: boolean;
  /** The notes panel: how many items are in, and how many words of the summary. */
  noted: number;
  summed: number;
  chat: { seen: number; dm: boolean; typed: string; typing: boolean; sent: boolean };
  rooms: { open: boolean; left: number; told: number };
  work: { on: boolean; board: boolean; typed: number; comment: boolean; drawn: number; sticky: boolean; held: boolean; kofi: Point; maya: Point; aiko: Point };
  /** The pointer that shows each click: `shows` counts its appearances, `taps` its presses since it appeared. */
  cur: { shows: number; on: boolean; x: number; y: number; taps: number };
}

const BASE: Stage = {
  layout: 'grid', speaking: null, muted: ['diego'], hover: null, status: [], away: false, onMute: false,
  panel: null, tool: null, micOff: false, unread: 0, pops: [], at: {}, hi: [], picked: [],
  toast: { on: false, say: 'share' }, caption: { on: false, line: 0, words: 0 }, chip: false, horizon: false, share: false,
  noted: 0, summed: 0,
  chat: { seen: 0, dm: false, typed: '', typing: false, sent: false },
  rooms: { open: false, left: ROOM_TIME, told: 0 },
  work: { on: false, board: false, typed: 0, comment: false, drawn: 0, sticky: false, held: false, kofi: { x: 600, y: 150 }, maya: { x: 690, y: 330 }, aiko: { x: 800, y: 120 } },
  cur: { shows: 0, on: false, x: 0, y: 0, taps: 0 }
};

/* ---- beats ---- */

type Patch = Partial<Stage> | ((s: Stage) => Partial<Stage>);
/** Where a menu opens from what opened it: under it (right edges lined up), above it, or beside it. */
export type Where = 'below' | 'above' | 'above-right' | 'right';
export type Beat =
  | { t: 'wait'; ms: number }
  | { t: 'set'; patch: Patch }
  /** The pointer glides to what's marked `data-at`. */
  | { t: 'point'; at: string }
  | { t: 'tap' }
  | { t: 'leave' }
  /** A menu opens at what's marked `data-at`. `keep` leaves the menu it came from open. */
  | { t: 'pop'; pop: PopId; at: string; where: Where; keep: boolean }
  /** From here to the end of the step, every `ms`. */
  | { t: 'tick'; ms: number; patch: Patch };

export const apply = (s: Stage, patch: Patch): Stage => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) });
export const opened = (s: Stage, pop: PopId, at: Point | null, keep: boolean): Stage => ({
  ...s,
  pops: keep ? [...s.pops.filter((p) => p !== pop), pop] : [pop],
  hi: s.hi.filter((h) => !h.startsWith(`${pop}:`)),
  at: at ? { ...s.at, [pop]: at } : s.at
});
export const pointed = (s: Stage, p: Point): Stage => ({
  ...s, cur: s.cur.on ? { ...s.cur, x: p.x, y: p.y } : { shows: s.cur.shows + 1, on: true, x: p.x, y: p.y, taps: 0 }
});

const wait = (ms: number): Beat => ({ t: 'wait', ms });
const set = (patch: Patch): Beat => ({ t: 'set', patch });
const point = (at: string): Beat => ({ t: 'point', at });
const tap: Beat = { t: 'tap' };
const leave: Beat = { t: 'leave' };
const pop = (p: PopId, at: string, where: Where = 'below', keep = false): Beat => ({ t: 'pop', pop: p, at, where, keep });
const chat = (p: Partial<Stage['chat']>): Beat => set((s) => ({ chat: { ...s.chat, ...p } }));
const rooms = (p: Partial<Stage['rooms']>): Beat => set((s) => ({ rooms: { ...s.rooms, ...p } }));
const work = (p: Partial<Stage['work']>): Beat => set((s) => ({ work: { ...s.work, ...p } }));
/** `n` changes `ms` apart, the k-th made by `f(k)`: words appearing, letters typed. */
const each = (n: number, ms: number, f: (k: number) => Patch): Beat[] => Array.from({ length: n }, (_, i) => [set(f(i + 1)), wait(ms)]).flat();
/** Every step starts from the same call: everyone in a grid, nothing open. What's on its way out keeps its words. */
const reset = (p: Partial<Stage> = {}): Beat => set((s) => ({
  ...BASE, at: s.at, toast: { ...s.toast, on: false }, caption: { ...s.caption, on: false }, cur: { ...s.cur, on: false }, ...p
}));
const say = (line: 0 | 1): Beat[] => [
  set({ speaking: LINES[line].who, caption: { on: true, line, words: 0 } }),
  ...each(words(LINES[line].en), 95, (k) => (s) => ({ caption: { ...s.caption, words: k } }))
];

export const SCRIPT: Record<StepId, readonly Beat[]> = {
  notes: [
    reset(), wait(600),
    point('tool:notes'), wait(850), tap, set({ tool: 'notes', panel: 'notes', layout: 'panel' }), wait(700), leave,
    set({ speaking: 'priya' }), wait(1300), set({ noted: 1 }), wait(1500),
    set({ speaking: 'kofi' }), wait(1100), set({ noted: 2 }), wait(1400),
    set({ speaking: 'aiko' }), wait(1100), set({ noted: 3 }), wait(900),
    set({ speaking: null }),
    ...each(words(SUMMARY), 55, (k) => ({ summed: k }))
  ],
  layout: [
    reset({ speaking: 'priya', picked: ['view:auto', 'view:tiles'] }), wait(700),
    point('view'), wait(850), tap, set({ hi: ['viewBtn'] }), pop('view', 'view'),
    wait(600), point('view:speaker'), wait(800), set({ hi: ['viewBtn', 'view:speaker'] }), tap, set({ picked: ['view:speaker', 'view:tiles'] }),
    wait(350), set({ pops: [], hi: [], layout: 'speaker' }), wait(700), leave, wait(1500),
    set({ toast: { on: true, say: 'share' }, share: true, layout: 'share', speaking: 'kofi' }), wait(2300), set((s) => ({ toast: { ...s.toast, on: false } })),
    point('view'), wait(850), tap, set({ hi: ['viewBtn'] }), pop('view', 'view'),
    wait(500), point('view:arches'), wait(800), tap, set({ picked: ['view:speaker', 'view:arches'] }),
    wait(380), set({ pops: [], hi: [], layout: 'arches', horizon: true }), wait(500), leave, set({ chip: true })
  ],
  status: [
    reset({ status: ['maya'], speaking: 'kofi' }), wait(800),
    set({ hover: 'art' }), point('more:art'), wait(900), tap, pop('status', 'more:art', 'above-right'),
    wait(700), point('status:brb'), wait(800), set({ hi: ['status:brb'], picked: ['status:brb'] }), tap,
    wait(500), point('status:5'), wait(700), tap, set({ picked: ['status:brb', 'status:5'] }),
    wait(450), set({ pops: [], hi: [], hover: null }), wait(150), leave,
    set({ status: ['maya', 'art'], away: true }),
    wait(1200), set({ speaking: 'priya' }), wait(2400), set({ speaking: 'aiko' })
  ],
  translate: [
    reset({ muted: [] }), wait(600),
    point('tool:captions'), wait(900), tap, set({ tool: 'captions' }), pop('lang', 'tool:captions', 'above'),
    wait(700), point('lang:en'), wait(800), set({ hi: ['lang:en'], picked: ['lang:en'] }), tap,
    wait(400), set({ pops: [], hi: [] }), wait(200), leave,
    ...say(0), wait(2600), ...say(1)
  ],
  chat: [
    reset({ unread: 2 }), wait(700),
    point('tool:chat'), wait(900), tap, set({ unread: 0, tool: 'chat', panel: 'chat', layout: 'panel' }), wait(600), leave,
    chat({ seen: 1 }), wait(1300), chat({ seen: 2 }), wait(1500), chat({ seen: 3 }), wait(1300),
    point('tab:dm'), wait(900), tap, set({ hi: ['tab:dm'] }), wait(250), set({ hi: [] }), chat({ dm: true }), wait(700),
    point('compose'), wait(800), tap, chat({ typing: true }), wait(300), leave,
    ...each([...REPLY].length, 60, (k) => (s) => ({ chat: { ...s.chat, typed: [...REPLY].slice(0, k).join('') } })),
    wait(450), chat({ typed: '', typing: false, sent: true })
  ],
  nudge: [
    reset({ muted: ['diego', 'art'], micOff: true, speaking: 'priya' }), wait(1100), set({ speaking: null, onMute: true }), wait(1100),
    point('unmute'), wait(900), tap, wait(200),
    set({ onMute: false, muted: ['diego'], micOff: false, speaking: 'art' }), wait(1500), set({ speaking: 'kofi' }), leave, wait(900),
    set({ hover: 'kofi' }), point('more:kofi'), wait(900), tap, pop('tile', 'more:kofi'),
    wait(700), point('tile:nudge'), wait(750), set({ hi: ['tile:nudge'] }), pop('nudge', 'tile:nudge', 'right', true),
    wait(700), point('nudge:hear'), wait(750), set({ hi: ['tile:nudge', 'nudge:hear'] }), tap,
    wait(400), set({ pops: [], hi: [], hover: null }), leave,
    set({ toast: { on: true, say: 'nudge' } })
  ],
  rooms: [
    reset(), wait(600),
    point('tool:rooms'), wait(900), tap, set({ tool: 'rooms', panel: 'rooms', layout: 'panel' }),
    wait(1300), point('open-rooms'), wait(850), tap, set({ hi: ['open-rooms'] }), wait(250), set({ hi: [] }),
    set({ panel: null, layout: 'rooms' }), rooms({ open: true, left: ROOM_TIME }), leave,
    { t: 'tick', ms: 1000, patch: (s) => ({ rooms: { ...s.rooms, left: Math.max(0, s.rooms.left - 1) } }) },
    set({ speaking: 'maya' }), wait(2400),
    point('msg-all'), wait(900), tap, set({ hi: ['msg-all'] }), wait(300), set({ hi: [] }), leave,
    rooms({ told: 1 }), wait(160), rooms({ told: 2 }), wait(160), rooms({ told: 3 }),
    wait(1600), set({ speaking: 'priya' }), wait(2200), set({ speaking: 'aiko' })
  ],
  work: [
    reset(), wait(600),
    point('tool:work'), wait(900), tap, set({ tool: 'work', layout: 'work' }), work({ on: true }), wait(800), leave,
    set({ speaking: 'priya' }),
    ...each(DOC_LINE.length, 48, (k) => (s) => ({ work: { ...s.work, typed: k } })),
    wait(500), set({ speaking: 'kofi' }), work({ comment: true }), wait(2200),
    point('ws:board'), wait(900), tap, set({ hi: ['ws:board'] }), wait(200), set({ hi: [] }), work({ board: true }), wait(400), leave,
    work({ drawn: 1 }), wait(520), work({ drawn: 2 }), wait(520), work({ drawn: 3 }), wait(520), work({ drawn: 4 }), wait(520),
    work({ kofi: { x: 660, y: 96 }, drawn: 5 }), wait(520),
    work({ maya: { x: 640, y: 268 } }), wait(900),
    work({ sticky: true }), wait(700),
    work({ aiko: { x: 808, y: 98 }, held: true }), wait(1000), work({ held: false })
  ]
};

/** A step's last picture: its beats with no waits, no pointer and every menu closed. */
function settle(beats: readonly Beat[]): Stage {
  let s = BASE;
  for (const b of beats) {
    if (b.t === 'set') s = apply(s, b.patch);
    else if (b.t === 'pop') s = opened(s, b.pop, null, b.keep);
  }
  return { ...s, pops: [], hi: [], hover: null, cur: { ...s.cur, on: false } };
}

export const STILL: Record<StepId, Stage> = {
  notes: settle(SCRIPT.notes), layout: settle(SCRIPT.layout), status: settle(SCRIPT.status), translate: settle(SCRIPT.translate),
  chat: settle(SCRIPT.chat), nudge: settle(SCRIPT.nudge), rooms: settle(SCRIPT.rooms), work: settle(SCRIPT.work)
};
