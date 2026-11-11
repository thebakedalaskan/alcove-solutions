/*
 * The call tour's scenes. Everything on the stage is one state (`Stage`), and each feature is a scene of beats: change the
 * stage, wait, or move the pointer to something and press it. A scene's `enter` carries the call from whatever is on it
 * into the scene's first picture. Its `loop` plays the feature and ends where it started, so it plays again for as long
 * as its step is the one being read. A `still` beat marks the loop's key moment: a step's still is its scene up to there,
 * folded together with no waits, no pointer and every menu shut, and it's what reduced motion shows.
 *
 * The call is the app's call: its top bar, dock, tiles and menus say what the real ones say (TourStage.tsx draws them), and
 * the people stand where the stage's own layout puts them (call/layout/stageLayout.ts and panels.ts), at this size.
 */
import type { IconName } from '@alcove/ui';
import type { CastId } from '~/features/notes/cast';

/** The stage's design size: everything on it is placed in these pixels. */
export const STAGE_W = 1120;
export const STAGE_H = 700;

/** Who's in the call, in the grid's order. You are Art, and you host. */
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
    shows: 'You turn on captions from More and pick English, then captions show Aiko’s Japanese and Diego’s Spanish in English, with their own words underneath.'
  },
  {
    id: 'status', icon: 'away', title: 'Set your status',
    line: 'Tell people you’ll be right back, you’re only listening, or you’re on your phone. Your tile says so, and the call carries on.',
    shows: 'From your tile’s menu you set your status to Be right back for five minutes, and your tile dims with the time you’ll be back while the call carries on.'
  },
  {
    id: 'rooms', icon: 'rooms', title: 'Breakout rooms',
    line: 'Split into rooms from More. Everyone moves at once, the rooms share one timer, and each room’s notes join the call’s notes.',
    shows: 'Three breakout rooms open from More, everyone moves into them at once, a message goes to every room, then everyone comes back.'
  },
  {
    id: 'nudge', icon: 'nudge', title: 'A quiet nudge',
    line: 'Let someone know they’re muted, hard to hear or going fast, without interrupting. Only they see it, and Alcove tells you when you’re talking on mute.',
    shows: 'Alcove tells you you’re talking on mute, then you nudge Kofi from their tile’s menu that you can’t hear them.'
  },
  {
    id: 'chat', icon: 'chat', title: 'Private messages and threads',
    line: 'Write to everyone, reply in a thread, or message one person. Only the people in a conversation can read it.',
    shows: 'The chat panel: a message to everyone with a thread of replies, then a private message from Priya and your reply.'
  },
  {
    id: 'layout', icon: 'layout', title: 'Arrange it your way',
    line: 'Drag a tile to move someone, or pull its corner to make them bigger. A shared screen takes the room, with everyone at its right. Only your view changes.',
    shows: 'You drag Maya’s tile to the front and pull its corner to make her bigger. Kofi presents their screen and everyone moves to its right, then Focus fills the window with it and everyone stands in a rail of arches at its edge. When Kofi stops, Reset layout in More puts the call back.'
  }
];

/** The step the call shows before the tour is reached. */
export const FIRST = STEPS[0].id;

/** The step a `data-step` names, if it names one. */
export const stepOf = (v: string | null): StepId | null => STEPS.find((x) => x.id === v)?.id ?? null;

/* ---- where everyone stands ---- */

type Layout = 'grid' | 'panel' | 'rooms' | 'work' | 'moved' | 'bigger' | 'beside' | 'focus';
/** A place on the stage in design pixels. An arch is someone folded down to their face. */
export interface Box { x: number; y: number; w: number; h: number; arch: boolean }

const tile = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h, arch: false });
const arch = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h, arch: true });
const NOWHERE = tile(0, 0, 0, 0);

function grid(n: number, x: number, y: number, w: number, h: number, cols: number, gap = 12): Box[] {
  const rows = Math.ceil(n / cols), tw = (w - (cols - 1) * gap) / cols, th = (h - (rows - 1) * gap) / rows;
  return Array.from({ length: n }, (_, i) => tile(x + (i % cols) * (tw + gap), y + Math.floor(i / cols) * (th + gap), tw, th));
}
/** Everyone in `order`, each in the place at their position. */
function seat(order: readonly Who[], b: readonly Box[]): Record<Who, Box> {
  const at = { priya: NOWHERE, kofi: NOWHERE, aiko: NOWHERE, maya: NOWHERE, diego: NOWHERE, art: NOWHERE };
  order.forEach((id, i) => { at[id] = b[i] ?? NOWHERE; });
  return at;
}
const inOrder = (b: readonly Box[]): Record<Who, Box> => seat(ORDER, b);

/** The tiles' area, under the top bar and over the dock. */
const AREA = { x: 16, y: 60, w: 1088, h: 552 };
/** Your order once you've dragged Maya to the front: everyone else keeps theirs. */
const ARRANGED = ['maya', 'priya', 'kofi', 'aiko', 'diego', 'art'] as const satisfies readonly Who[];

/**
 * Six people with the first at twice the size, as the stage packs them: three columns and three rows of tiles of the call's
 * shape, the first over two of each, the grid centred in the area.
 */
function firstBigger(): Box[] {
  const gap = 12, th = (AREA.h - 2 * gap) / 3, tw = Math.min((AREA.w - 2 * gap) / 3, th * 1.45 * 1.06);
  const x = AREA.x + (AREA.w - (3 * tw + 2 * gap)) / 2;
  const at = (c: number, r: number, span = 1) => tile(x + c * (tw + gap), AREA.y + r * (th + gap), span * tw + (span - 1) * gap, span * th + (span - 1) * gap);
  return [at(0, 0, 2), at(2, 0), at(2, 1), at(0, 2), at(1, 2), at(2, 2)];
}
/** Beside something on your stage: a column of tiles at the right, as tall as six can be. */
function column(n: number, x: number, y: number, w: number, h: number, gap = 10): Box[] {
  const th = Math.min(w * 0.74, (h - gap * (n - 1)) / n);
  return Array.from({ length: n }, (_, i) => tile(x, y + i * (th + gap), w, th));
}
/** The column beside what's open, at this stage's width. */
const COLUMN_W = 216;
/** Focus: the window's room under the strip the host's timer keeps, and the people's rail of arches at its right. */
const FOCUS = { x: 16, y: 68, w: STAGE_W - 32, h: 548 };
const RAIL = { w: 74, h: 82, pitch: 92 };

/** Kofi's screen on your stage: beside the people, or filling the window in focus, left of their rail. */
export const SCREEN = {
  beside: tile(AREA.x, AREA.y, AREA.w - COLUMN_W - 12, AREA.h),
  focus: tile(FOCUS.x, FOCUS.y, FOCUS.w - RAIL.w - 12, FOCUS.h)
};
/** The rail stands in the middle of its edge, as the call's does. */
const railAt = (i: number, n: number): Box =>
  arch(FOCUS.x + FOCUS.w - RAIL.w, FOCUS.y + (FOCUS.h - ((n - 1) * RAIL.pitch + RAIL.h)) / 2 + i * RAIL.pitch, RAIL.w, RAIL.h);

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
  ROOMS.forEach((r, i) => r.who.forEach((id, seated) => { at[id] = arch(alcoveX(i) + 150 + (seated ? 8 : -80), 386, 72, 78); }));
  return at;
}

export const LAYOUTS: Record<Layout, Record<Who, Box>> = {
  grid: inOrder(grid(6, AREA.x, AREA.y, AREA.w, AREA.h, 3)),
  panel: inOrder(grid(6, AREA.x, AREA.y, 748, AREA.h, 2)),
  rooms: inRooms(),
  work: inOrder(grid(6, 928, AREA.y, 176, AREA.h, 1, 8)),
  moved: seat(ARRANGED, grid(6, AREA.x, AREA.y, AREA.w, AREA.h, 3)),
  bigger: seat(ARRANGED, firstBigger()),
  beside: seat(ARRANGED, column(6, AREA.x + AREA.w - COLUMN_W, AREA.y, COLUMN_W, AREA.h)),
  focus: seat(ARRANGED, ARRANGED.map((_, i) => railAt(i, ARRANGED.length)))
};

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
/** What's open from the top right, lit while it is: the workspace or the chat. */
type Tool = 'work' | 'chat';
/** More, the caption language, your own tile's ⋯ and Kofi's. */
export type PopId = 'more' | 'lang' | 'self' | 'tile';
export interface Point { x: number; y: number }

export interface Stage {
  layout: Layout;
  speaking: Who | null;
  muted: readonly Who[];
  /** Someone who's hard to hear: their level and the ring round their tile are faint. */
  faint: Who | null;
  /** The tile the pointer is over, showing its ⋯ and the corner that resizes it. */
  hover: Who | null;
  /** The tile being dragged, lifted, and where its top left is held while it's carried. */
  lift: Who | null;
  held: Point | null;
  /** The tile whose corner is being pulled, and the size it's pulled to. */
  pull: { who: Who; w: number; h: number } | null;
  /** You've changed the layout from the one the stage gives itself: More offers Reset layout. */
  custom: boolean;
  /** Who shows their status on their tile. */
  status: readonly Who[];
  /** You've stepped away: your tile dims, with the time left along its edge. */
  away: boolean;
  /** "You're talking on mute", at the top of the call. */
  onMute: boolean;
  panel: Panel | null;
  tool: Tool | null;
  /** Your microphone, in the dock. */
  micOff: boolean;
  /** Kofi's screen on your stage, and focus: it fills your window and the people stand in a rail of arches at its right. */
  screen: boolean;
  focus: boolean;
  /** The menus that are open, and where each one opened. */
  pops: readonly PopId[];
  at: Readonly<Partial<Record<PopId, Point>>>;
  /** Kofi's menu, or its nudge step in its place: "Only Kofi sees it". */
  step: 'menu' | 'nudge';
  /** What the pointer is over: a button, a menu's row. */
  hi: readonly string[];
  /** What's chosen in the menus. */
  picked: readonly string[];
  toast: { on: boolean; say: 'view' | 'share' | 'unshare' | 'nudge' };
  /** Captions: on (their box shows), in English or as spoken, and the line being said, if any, a word at a time. */
  caption: { cc: boolean; en: boolean; line: 0 | 1 | null; words: number };
  /** The chat: how much of the conversation is in, the dot on Priya's tab, her tab open, your reply typed and sent. */
  chat: { seen: number; dot: boolean; dm: boolean; typed: string; typing: boolean; sent: boolean };
  rooms: { open: boolean; left: number; told: number };
  work: { on: boolean; board: boolean; typed: number; comment: boolean; drawn: number; sticky: boolean; held: boolean; kofi: Point; maya: Point; aiko: Point };
  /** The pointer that shows each click: `shows` counts its appearances, `taps` its presses since it appeared. */
  cur: { shows: number; on: boolean; x: number; y: number; taps: number };
}

const BASE: Stage = {
  layout: 'grid', speaking: null, muted: ['diego'], faint: null, hover: null, lift: null, held: null, pull: null, custom: false,
  status: [], away: false, onMute: false, panel: null, tool: null, micOff: false, screen: false, focus: false,
  pops: [], at: {}, step: 'menu', hi: [], picked: [],
  toast: { on: false, say: 'view' }, caption: { cc: false, en: false, line: null, words: 0 },
  chat: { seen: 0, dot: false, dm: false, typed: '', typing: false, sent: false },
  rooms: { open: false, left: ROOM_TIME, told: 0 },
  work: { on: false, board: false, typed: 0, comment: false, drawn: 0, sticky: false, held: false, kofi: { x: 600, y: 150 }, maya: { x: 690, y: 330 }, aiko: { x: 800, y: 120 } },
  cur: { shows: 0, on: false, x: 0, y: 0, taps: 0 }
};

/* ---- beats ---- */

type Patch = Partial<Stage> | ((s: Stage) => Partial<Stage>);
/** Where a menu opens from what opened it: under it (right edges lined up), above it, or to its left. */
export type Where = 'below' | 'above' | 'left';
export type Beat =
  | { t: 'wait'; ms: number }
  | { t: 'set'; patch: Patch }
  /** The pointer glides to what's marked `data-at`. */
  | { t: 'point'; at: string }
  | { t: 'tap' }
  | { t: 'leave' }
  /** A menu opens at what's marked `data-at`, in place of any other. */
  | { t: 'pop'; pop: PopId; at: string; where: Where }
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
export const opened = (s: Stage, pop: PopId, at: Point | null): Stage => ({
  ...s, pops: [pop], hi: s.hi.filter((h) => !h.startsWith(`${pop}:`)), at: at ? { ...s.at, [pop]: at } : s.at
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
const pop = (p: PopId, at: string, where: Where = 'below'): Beat => ({ t: 'pop', pop: p, at, where });
const chat = (p: Partial<Stage['chat']>): Beat => set((s) => ({ chat: { ...s.chat, ...p } }));
const rooms = (p: Partial<Stage['rooms']>): Beat => set((s) => ({ rooms: { ...s.rooms, ...p } }));
const work = (p: Partial<Stage['work']>): Beat => set((s) => ({ work: { ...s.work, ...p } }));
const caption = (p: Partial<Stage['caption']>): Beat => set((s) => ({ caption: { ...s.caption, ...p } }));
const toastOff = set((s) => ({ toast: { ...s.toast, on: false } }));
/** `n` changes `ms` apart, the k-th made by `f(k)`: words appearing, letters typed. */
const each = (n: number, ms: number, f: (k: number) => Patch): Beat[] => Array.from({ length: n }, (_, i) => [set(f(i + 1)), wait(ms)]).flat();
/** The pointer goes to something and presses it. A button that `lights` stays lit that many ms. */
const press = (at: string, lights = 0): Beat[] => [point(at), wait(700), tap, ...(lights ? [set({ hi: [at] }), wait(lights), set({ hi: [] })] : [])];
/** The pointer goes to a menu's row: it lights, and is pressed. */
const choose = (at: string): Beat[] => [point(at), wait(600), set((s) => ({ hi: [...s.hi, at] })), tap];
/** More opens over the dock, and one of its rows is pressed; it shuts with what `then` changes. */
const fromMore = (row: string, then: Partial<Stage>): Beat[] => [
  ...press('more'), pop('more', 'more', 'above'), wait(460), ...choose(`more:${row}`), wait(300), set({ pops: [], hi: [], ...then })
];
/**
 * Every scene starts from the same call: everyone in a grid, nothing open, no pointer. What's on its way out keeps its
 * words as it goes: a toast, the captions, the chat, the rooms and the workspace fade as they were.
 */
const reset = (p: Partial<Stage> = {}): Beat => set((s) => ({
  ...BASE, at: s.at, toast: { ...s.toast, on: false }, caption: { ...s.caption, cc: false }, chat: s.chat,
  rooms: { ...s.rooms, open: false }, work: { ...s.work, on: false }, cur: { ...s.cur, on: false }, ...p
}));
/** Someone speaks, and their caption writes itself in English a word at a time. */
const say = (line: 0 | 1): Beat[] => [
  set((s) => ({ speaking: LINES[line].who, caption: { ...s.caption, line, words: 0 } })),
  ...each(words(LINES[line].en), 95, (k) => (s) => ({ caption: { ...s.caption, words: k } }))
];

/* The layout step: Maya's tile carried to the front, then pulled from its corner to the size it settles at as the bigger one. */
const MAYA = { from: LAYOUTS.grid.maya, to: LAYOUTS.moved.maya };
const PULLED = { w: MAYA.to.w * 1.42, h: MAYA.to.h * 1.42 };
const mid = (b: Box): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const topLeft = (b: Box): Point => ({ x: b.x, y: b.y });
/** The middle of the corner a tile is resized by, on a tile of this size at `b`'s top left (TourStage: `.lp-st-rs`). */
const cornerOf = (b: Box, w: number, h: number): Point => ({ x: b.x + w - 19, y: b.y + h - 19 });

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
  /* Captions on from More, in English from the captions' own button, once; then Aiko and Diego speak in their own languages. */
  translate: {
    enter: [
      reset({ muted: [] }), wait(450),
      ...fromMore('captions', { caption: { cc: true, en: false, line: null, words: 0 } }), wait(650),
      set({ picked: ['lang:spoken'] }), ...press('cap:lang'), pop('lang', 'cap:lang', 'above'),
      wait(460), ...choose('lang:en'), set({ picked: ['lang:en'] }),
      wait(380), set({ pops: [], hi: [] }), caption({ en: true }), leave, wait(600)
    ],
    loop: [
      ...say(0), still, wait(2400), ...say(1), wait(2400),
      set((s) => ({ caption: { ...s.caption, line: null, words: 0 }, speaking: null })), wait(1400)
    ]
  },
  /* From your tile's ⋯ you step away for five minutes, the call carries on, and you come back. Maya is listening only. */
  status: {
    enter: [reset({ status: ['maya'], speaking: 'kofi' }), wait(500)],
    loop: [
      set({ hover: 'art' }), ...press('more:art'), pop('self', 'more:art', 'left'),
      wait(460), ...choose('self:away'), set({ picked: ['self:away'] }),
      wait(400), point('self:5'), wait(560), tap, set({ picked: ['self:away', 'self:5'] }),
      wait(380), set({ pops: [], hi: [], hover: null, status: ['maya', 'art'], away: true }), leave,
      still, wait(1300), set({ speaking: 'priya' }), wait(2200), set({ speaking: 'aiko' }), wait(2400),
      set({ status: ['maya'], away: false, picked: [], speaking: 'art' }), wait(2000), set({ speaking: 'kofi' }), wait(900)
    ]
  },
  /* Breakout rooms from More, and Open rooms moves everyone into three; a message reaches every room, and everyone comes back. */
  rooms: {
    enter: [reset(), wait(500)],
    loop: [
      ...fromMore('rooms', { panel: 'rooms', layout: 'panel' }), wait(1000),
      ...press('open-rooms', 220), set({ panel: null, layout: 'rooms' }), rooms({ open: true, left: ROOM_TIME, told: 0 }), leave,
      tick(1000, (s) => ({ rooms: { ...s.rooms, left: Math.max(0, s.rooms.left - 1) } })),
      set({ speaking: 'maya' }), wait(1900),
      ...press('msg-all', 260), leave,
      rooms({ told: 1 }), wait(150), rooms({ told: 2 }), wait(150), rooms({ told: 3 }), wait(150),
      still, wait(1500), set({ speaking: 'priya' }), wait(1800), set({ speaking: 'aiko' }), wait(1300),
      ...press('rooms:back', 260), leave, untick,
      rooms({ open: false }), set({ layout: 'grid', speaking: null }), wait(1700)
    ]
  },
  /* You talk on mute and Alcove says so; then Kofi is hard to hear, and only Kofi gets your nudge, from their tile's ⋯. */
  nudge: {
    enter: [reset({ muted: ['diego', 'art'], micOff: true }), wait(500)],
    loop: [
      set({ speaking: 'priya' }), wait(1100), set({ speaking: null, onMute: true }), wait(900),
      ...press('unmute'), wait(180), set({ onMute: false, muted: ['diego'], micOff: false, speaking: 'art' }), leave,
      wait(1500), set({ speaking: 'kofi', faint: 'kofi' }), wait(1000),
      set({ hover: 'kofi' }), ...press('more:kofi'), pop('tile', 'more:kofi'),
      wait(460), ...choose('tile:nudge'), wait(180), set({ step: 'nudge', hi: [] }),
      wait(520), ...choose('nudge:cant-hear'),
      wait(320), set({ pops: [], hi: [], hover: null, toast: { on: true, say: 'nudge' } }), leave,
      still, wait(1500), set({ faint: null }), wait(1300), toastOff, set({ step: 'menu' }),
      wait(700), ...press('mic'), set({ muted: ['diego', 'art'], micOff: true, speaking: null }), leave, wait(900)
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
  /*
   * Maya's tile is carried to the front, the others making room as it nears, and pulled by its corner until she's the bigger
   * one. Kofi's screen takes the room with everyone at its right, and Focus fills the window with it, everyone in a rail.
   * Kofi stops, everyone comes back as you arranged them, and Reset layout puts the call back as the stage lays it out.
   */
  layout: {
    enter: [reset({ speaking: 'priya' }), wait(500)],
    loop: [
      set({ hover: 'maya' }), point('tile:maya'), wait(700), tap, set({ lift: 'maya', held: topLeft(MAYA.from) }), wait(260),
      set((s) => ({ ...pointed(s, mid(MAYA.to)), held: topLeft(MAYA.to) })), wait(380),
      set({ layout: 'moved' }), wait(620),
      set({ lift: null, held: null, custom: true, toast: { on: true, say: 'view' } }), wait(500),
      point('rs:maya'), wait(650), tap, set({ pull: { who: 'maya', w: MAYA.to.w, h: MAYA.to.h } }), wait(200),
      set((s) => ({ ...pointed(s, cornerOf(MAYA.to, PULLED.w, PULLED.h)), pull: { who: 'maya', ...PULLED } })), wait(420),
      set({ layout: 'bigger' }), wait(580),
      set({ pull: null, hover: null }), leave, wait(900), toastOff,
      still, wait(1600),
      set({ screen: true, layout: 'beside', speaking: 'kofi', toast: { on: true, say: 'share' } }), wait(2400), toastOff,
      ...press('focus'), set({ focus: true, layout: 'focus' }), leave, wait(3000),
      set({ screen: false, focus: false, layout: 'bigger', toast: { on: true, say: 'unshare' } }), wait(500), set({ speaking: 'priya' }), wait(1700), toastOff, wait(400),
      ...fromMore('reset', { layout: 'grid' }), leave, wait(400), set({ custom: false }), wait(1400)
    ]
  }
};

/** The stage once `beats` have played, up to a `still`: with no waits, no pointer and every menu shut. */
function settle(beats: readonly Beat[]): Stage {
  let s = BASE;
  for (const b of beats) {
    if (b.t === 'still') break;
    if (b.t === 'set') s = apply(s, b.patch);
    else if (b.t === 'pop') s = opened(s, b.pop, null);
  }
  return { ...s, pops: [], hi: [], hover: null, lift: null, held: null, pull: null, cur: { ...s.cur, on: false } };
}
const stillOf = (sc: Scene) => settle([...sc.enter, ...sc.loop]);

/** What the call shows before the tour is reached: the first step's first picture. */
export const START = settle(SCENES[FIRST].enter);
/** Each step's still: its scene's key moment. */
export const STILL: Record<StepId, Stage> = {
  work: stillOf(SCENES.work), translate: stillOf(SCENES.translate), status: stillOf(SCENES.status), rooms: stillOf(SCENES.rooms),
  nudge: stillOf(SCENES.nudge), chat: stillOf(SCENES.chat), layout: stillOf(SCENES.layout)
};
