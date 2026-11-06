/*
 * The call tour's scenes. Everything on the stage is one state (`Stage`), and each feature is a scene of beats: change the
 * stage, wait, or move the pointer to something and press it. A scene's `enter` carries the call from whatever is on it
 * into the scene's first picture. Its `loop` plays the feature and ends where it started, so it plays again for as long
 * as its step is the one being read. A `still` beat marks the loop's key moment: a step's still is its scene up to there,
 * folded together with no waits, no pointer and every menu shut, and it's what reduced motion shows.
 */
import type { IconName } from '@alcove/ui';
import type { CastId } from '~/features/notes/cast';

/** The stage's design size: everything on it is placed in these pixels. */
export const STAGE_W = 1120;
export const STAGE_H = 700;

/** Who's in the call, in the grid's order. You are Art. */
export const ORDER = ['priya', 'kofi', 'aiko', 'maya', 'diego', 'art'] as const satisfies readonly CastId[];
export type Who = (typeof ORDER)[number];

export type StepId = 'work' | 'translate' | 'status' | 'rooms' | 'nudge' | 'chat' | 'layout';
interface Step {
  id: StepId;
  icon: IconName;
  title: string;
  line: string;
  /** What the stage shows while the step's scene plays, for people who can't see it. */
  shows: string;
}

export const STEPS: readonly [Step, ...Step[]] = [
  {
    id: 'work', icon: 'pen', title: 'Documents and boards',
    line: 'Write and draw together without leaving the call. Everyone edits at once, and the notes keep what changed.',
    shows: 'A shared document and a board inside the call, with three people editing at once.'
  },
  {
    id: 'translate', icon: 'translate', title: 'Captions in your language',
    line: 'Read what people say in your own language, with their words underneath. It’s translated in confidential compute, for you alone.',
    shows: 'Captions show Aiko’s Japanese and Diego’s Spanish in English, with their own words underneath.'
  },
  {
    id: 'status', icon: 'away', title: 'Set your status',
    line: 'Tell people you’ll be right back, you’re only listening, or you’re on your phone. Your tile says so, and the call carries on.',
    shows: 'You set your status to Be right back for five minutes, and your tile dims with the time you’ll be back while the call carries on.'
  },
  {
    id: 'rooms', icon: 'rooms', title: 'Breakout rooms',
    line: 'Split into rooms in two clicks. Everyone moves at once, the rooms share one timer, and each room’s notes join the call’s notes.',
    shows: 'Three breakout rooms open, everyone moves into them at once, a message goes to every room, then everyone comes back.'
  },
  {
    id: 'nudge', icon: 'nudge', title: 'A quiet nudge',
    line: 'Let someone know they’re muted, hard to hear or going fast, without interrupting. Only they see it, and Alcove tells you when you’re talking on mute.',
    shows: 'Alcove tells you you’re talking on mute, then you nudge Kofi that you can’t hear them.'
  },
  {
    id: 'chat', icon: 'chat', title: 'Private messages and threads',
    line: 'Write to everyone, reply in a thread, or message one person. Only the people in a conversation can read it.',
    shows: 'The chat panel: a message to everyone with a thread of replies, then a private message from Priya and your reply.'
  },
  {
    id: 'layout', icon: 'layout', title: 'Arrange it your way',
    line: 'Make someone the speaker, give a shared screen the room, or fold everyone into arches on the horizon. Only your screen changes.',
    shows: 'The View menu turns the call to speaker view, Kofi shares a screen, everyone folds into arches on the horizon, then the call goes back to a grid.'
  }
];

/** The step the call shows before the tour is reached. */
export const FIRST = STEPS[0].id;

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

export const LINES = [
  { who: 'aiko', from: 'From Japanese', en: 'The Japanese help centre can go live on the same day.', or: '日本語のヘルプセンターも同じ日に公開できます。' },
  { who: 'diego', from: 'From Spanish', en: 'Then sales can announce it that same week.', or: 'Entonces ventas puede anunciarlo esa misma semana.' }
] as const satisfies readonly { who: Who; from: string; en: string; or: string }[];
/** Your answer to Priya's private message. */
export const REPLY = 'Yes, I’ll stay on.';
export const DOC_LINE = 'Help article ready for support by Friday';
/** The rooms' timer starts here, in seconds: 9:12. */
const ROOM_TIME = 552;
/** The board's connectors, in the order they're drawn. */
export const LINKS = ['M196 87H262', 'M394 87H470', 'M328 122V214', 'M394 248C450 248 520 200 540 116', 'M640 87H706'] as const;

const words = (text: string) => text.split(' ').length;
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/* ---- the stage ---- */

type Panel = 'chat' | 'rooms';
type Tool = 'captions' | 'rooms' | 'work' | 'chat';
export type PopId = 'view' | 'status' | 'lang' | 'tile' | 'nudge';
export interface Point { x: number; y: number }

export interface Stage {
  layout: Layout;
  speaking: Who | null;
  muted: readonly Who[];
  /** Someone who's hard to hear: their level and the ring round their tile are faint. */
  faint: Who | null;
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
  /** Your microphone, in the dock. */
  micOff: boolean;
  /** The menus that are open, and where each one opened. */
  pops: readonly PopId[];
  at: Readonly<Partial<Record<PopId, Point>>>;
  /** What the pointer is over: a button, a menu's row. */
  hi: readonly string[];
  /** What's chosen in the menus. */
  picked: readonly string[];
  toast: { on: boolean; say: 'share' | 'unshare' | 'nudge' };
  caption: { on: boolean; line: 0 | 1; words: number };
  /** "Only your screen changes". */
  chip: boolean;
  horizon: boolean;
  share: boolean;
  /** The chat: how much of the conversation is in, the dot on Priya's tab, her tab open, your reply typed and sent. */
  chat: { seen: number; dot: boolean; dm: boolean; typed: string; typing: boolean; sent: boolean };
  rooms: { open: boolean; left: number; told: number };
  work: { on: boolean; board: boolean; typed: number; comment: boolean; drawn: number; sticky: boolean; held: boolean; kofi: Point; maya: Point; aiko: Point };
  /** The pointer that shows each click: `shows` counts its appearances, `taps` its presses since it appeared. */
  cur: { shows: number; on: boolean; x: number; y: number; taps: number };
}

const BASE: Stage = {
  layout: 'grid', speaking: null, muted: ['diego'], faint: null, hover: null, status: [], away: false, onMute: false,
  panel: null, tool: null, micOff: false, pops: [], at: {}, hi: [], picked: [],
  toast: { on: false, say: 'share' }, caption: { on: false, line: 0, words: 0 }, chip: false, horizon: false, share: false,
  chat: { seen: 0, dot: false, dm: false, typed: '', typing: false, sent: false },
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
  /** Every `ms` from here, until `untick` or the end of the beats it's in: so a timer never runs on into the next pass. */
  | { t: 'tick'; ms: number; patch: Patch }
  | { t: 'untick' }
  /** The scene's key moment: the step's still is its scene up to here. */
  | { t: 'still' };

export interface Scene {
  /** From whatever is on the stage to the scene's first picture. */
  enter: readonly Beat[];
  /** The feature, ending where it started so that it can play again, with one `still` at its key moment. */
  loop: readonly Beat[];
}

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
const still: Beat = { t: 'still' };
const untick: Beat = { t: 'untick' };
const tick = (ms: number, patch: Patch): Beat => ({ t: 'tick', ms, patch });
const pop = (p: PopId, at: string, where: Where = 'below', keep = false): Beat => ({ t: 'pop', pop: p, at, where, keep });
const chat = (p: Partial<Stage['chat']>): Beat => set((s) => ({ chat: { ...s.chat, ...p } }));
const rooms = (p: Partial<Stage['rooms']>): Beat => set((s) => ({ rooms: { ...s.rooms, ...p } }));
const work = (p: Partial<Stage['work']>): Beat => set((s) => ({ work: { ...s.work, ...p } }));
const toastOff = set((s) => ({ toast: { ...s.toast, on: false } }));
/** `n` changes `ms` apart, the k-th made by `f(k)`: words appearing, letters typed. */
const each = (n: number, ms: number, f: (k: number) => Patch): Beat[] => Array.from({ length: n }, (_, i) => [set(f(i + 1)), wait(ms)]).flat();
/** The pointer goes to something and presses it. A button that `lights` stays lit that many ms. */
const press = (at: string, lights = 0): Beat[] => [point(at), wait(700), tap, ...(lights ? [set({ hi: [at] }), wait(lights), set({ hi: [] })] : [])];
/** The pointer goes to a menu's row: it lights, and is pressed. */
const choose = (at: string): Beat[] => [point(at), wait(600), set((s) => ({ hi: [...s.hi, at] })), tap];
/** View opens, one of its choices is pressed, and it shuts with what's picked; `then` is what changes as it shuts. */
const viewTo = (choice: string, picked: readonly string[], then: Partial<Stage>): Beat[] => [
  ...press('view'), set({ hi: ['viewBtn'] }), pop('view', 'view'),
  wait(420), ...choose(`view:${choice}`), set({ picked }),
  wait(320), set({ pops: [], hi: [], ...then }), leave
];
/**
 * Every scene starts from the same call: everyone in a grid, nothing open, no pointer. What's on its way out keeps its
 * words as it goes: a toast, a caption, the chat, the rooms and the workspace fade as they were.
 */
const reset = (p: Partial<Stage> = {}): Beat => set((s) => ({
  ...BASE, at: s.at, toast: { ...s.toast, on: false }, caption: { ...s.caption, on: false }, chat: s.chat,
  rooms: { ...s.rooms, open: false }, work: { ...s.work, on: false }, cur: { ...s.cur, on: false }, ...p
}));
/** Someone speaks, and their caption writes itself in English a word at a time. */
const say = (line: 0 | 1): Beat[] => [
  set({ speaking: LINES[line].who, caption: { on: true, line, words: 0 } }),
  ...each(words(LINES[line].en), 95, (k) => (s) => ({ caption: { ...s.caption, words: k } }))
];

export const SCENES: Record<StepId, Scene> = {
  /* Priya writes in the document and Kofi comments, then the board fills in with three people on it. */
  work: {
    enter: [reset({ tool: 'work', layout: 'work', work: { ...BASE.work, on: true } }), wait(700)],
    loop: [
      set({ speaking: 'priya' }),
      ...each(DOC_LINE.length, 44, (k) => (s) => ({ work: { ...s.work, typed: k } })),
      wait(450), set({ speaking: 'kofi' }), work({ comment: true }), wait(2000),
      ...press('ws:board', 200), work({ board: true }), wait(350), leave,
      work({ drawn: 1 }), wait(480), work({ drawn: 2 }), wait(480), work({ drawn: 3 }), wait(480), work({ drawn: 4 }), wait(480),
      work({ kofi: { x: 660, y: 96 }, drawn: 5 }), wait(480),
      work({ maya: { x: 640, y: 268 } }), wait(850),
      work({ sticky: true }), wait(650),
      work({ aiko: { x: 808, y: 98 }, held: true }),
      still, wait(1100), work({ held: false }), wait(1800),
      ...press('ws:doc', 200), work({ board: false }), leave, wait(900),
      set({ work: { ...BASE.work, on: true }, speaking: null }), wait(700)
    ]
  },
  /* Captions on in English, once; then Aiko and Diego speak in their own languages. */
  translate: {
    enter: [
      reset({ muted: [] }), wait(450),
      ...press('tool:captions'), set({ tool: 'captions' }), pop('lang', 'tool:captions', 'above'),
      wait(460), ...choose('lang:en'), set({ picked: ['lang:en'] }),
      wait(380), set({ pops: [], hi: [] }), leave, wait(300)
    ],
    loop: [
      ...say(0), still, wait(2400), ...say(1), wait(2400),
      set((s) => ({ caption: { ...s.caption, on: false }, speaking: null })), wait(900)
    ]
  },
  /* You step away for five minutes, the call carries on, and you come back. Maya is listening only. */
  status: {
    enter: [reset({ status: ['maya'], speaking: 'kofi' }), wait(500)],
    loop: [
      set({ hover: 'art' }), ...press('more:art'), pop('status', 'more:art', 'above-right'),
      wait(460), ...choose('status:brb'), set({ picked: ['status:brb'] }),
      wait(400), point('status:5'), wait(560), tap, set({ picked: ['status:brb', 'status:5'] }),
      wait(380), set({ pops: [], hi: [], hover: null, status: ['maya', 'art'], away: true }), leave,
      still, wait(1300), set({ speaking: 'priya' }), wait(2200), set({ speaking: 'aiko' }), wait(2400),
      set({ status: ['maya'], away: false, picked: [], speaking: 'art' }), wait(2000), set({ speaking: 'kofi' }), wait(900)
    ]
  },
  /* Two clicks open three rooms and everyone moves, a message reaches every room, and everyone comes back. */
  rooms: {
    enter: [reset(), wait(500)],
    loop: [
      ...press('tool:rooms'), set({ tool: 'rooms', panel: 'rooms', layout: 'panel' }), wait(1000),
      ...press('open-rooms', 220), set({ panel: null, layout: 'rooms' }), rooms({ open: true, left: ROOM_TIME, told: 0 }), leave,
      tick(1000, (s) => ({ rooms: { ...s.rooms, left: Math.max(0, s.rooms.left - 1) } })),
      set({ speaking: 'maya' }), wait(1900),
      ...press('msg-all', 260), leave,
      rooms({ told: 1 }), wait(150), rooms({ told: 2 }), wait(150), rooms({ told: 3 }), wait(150),
      still, wait(1500), set({ speaking: 'priya' }), wait(1800), set({ speaking: 'aiko' }), wait(1300),
      ...press('rooms:back', 260), leave, untick,
      rooms({ open: false }), set({ tool: null, layout: 'grid', speaking: null }), wait(1700)
    ]
  },
  /* You talk on mute and Alcove says so; then Kofi is hard to hear, and only Kofi gets your nudge. */
  nudge: {
    enter: [reset({ muted: ['diego', 'art'], micOff: true }), wait(500)],
    loop: [
      set({ speaking: 'priya' }), wait(1100), set({ speaking: null, onMute: true }), wait(900),
      ...press('unmute'), wait(180), set({ onMute: false, muted: ['diego'], micOff: false, speaking: 'art' }), leave,
      wait(1500), set({ speaking: 'kofi', faint: 'kofi' }), wait(1000),
      set({ hover: 'kofi' }), ...press('more:kofi'), pop('tile', 'more:kofi'),
      wait(460), ...choose('tile:nudge'), pop('nudge', 'tile:nudge', 'right', true),
      wait(460), ...choose('nudge:hear'),
      wait(320), set({ pops: [], hi: [], hover: null, toast: { on: true, say: 'nudge' } }), leave,
      still, wait(1500), set({ faint: null }), wait(1300), toastOff,
      wait(700), ...press('tool:mic'), set({ muted: ['diego', 'art'], micOff: true, speaking: null }), leave, wait(900)
    ]
  },
  /* The conversation and its thread, then Priya writes to you alone and you answer; then it clears for the next pass. */
  chat: {
    enter: [reset({ tool: 'chat', panel: 'chat', layout: 'panel', chat: BASE.chat }), wait(600)],
    loop: [
      chat({ seen: 1 }), wait(1100), chat({ seen: 2 }), wait(1400), chat({ seen: 3 }), wait(1100),
      chat({ dot: true }), wait(800),
      ...press('tab:dm'), chat({ dot: false, dm: true }),
      wait(700), ...press('compose'), chat({ typing: true }), wait(250), leave,
      ...each([...REPLY].length, 55, (k) => (s) => ({ chat: { ...s.chat, typed: [...REPLY].slice(0, k).join('') } })),
      wait(400), chat({ typed: '', typing: false, sent: true }),
      still, wait(2400), ...press('tab:all'), chat({ dm: false }), leave,
      wait(1300), chat({ seen: 0, sent: false }), wait(900)
    ]
  },
  /* Speaker view, then a shared screen takes the room, everyone folds onto the horizon, and back to the grid. */
  layout: {
    enter: [reset({ speaking: 'priya', picked: ['view:grid', 'view:tiles'] }), wait(500)],
    loop: [
      ...viewTo('speaker', ['view:speaker', 'view:tiles'], { layout: 'speaker' }), wait(1700),
      set({ toast: { on: true, say: 'share' }, share: true, layout: 'share', speaking: 'kofi' }), wait(2100), toastOff,
      ...viewTo('arches', ['view:speaker', 'view:arches'], { layout: 'arches', horizon: true, chip: true }),
      still, wait(2800), set({ chip: false }),
      ...viewTo('grid', ['view:grid', 'view:tiles'], { layout: 'share', horizon: false }), wait(1500),
      set({ toast: { on: true, say: 'unshare' }, share: false, layout: 'grid', speaking: 'priya' }), wait(2000), toastOff, wait(700)
    ]
  }
};

/** The stage once `beats` have played, up to a `still`: with no waits, no pointer and every menu shut. */
function settle(beats: readonly Beat[]): Stage {
  let s = BASE;
  for (const b of beats) {
    if (b.t === 'still') break;
    if (b.t === 'set') s = apply(s, b.patch);
    else if (b.t === 'pop') s = opened(s, b.pop, null, b.keep);
  }
  return { ...s, pops: [], hi: [], hover: null, cur: { ...s.cur, on: false } };
}
const stillOf = (sc: Scene) => settle([...sc.enter, ...sc.loop]);

/** What the call shows before the tour is reached: the first step's first picture. */
export const START = settle(SCENES[FIRST].enter);
/** Each step's still: its scene's key moment. */
export const STILL: Record<StepId, Stage> = {
  work: stillOf(SCENES.work), translate: stillOf(SCENES.translate), status: stillOf(SCENES.status), rooms: stillOf(SCENES.rooms),
  nudge: stillOf(SCENES.nudge), chat: stillOf(SCENES.chat), layout: stillOf(SCENES.layout)
};
