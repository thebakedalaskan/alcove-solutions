/*
 * The boards in the demo world, from the whiteboards design canvas: Art's Product group in a launch retro on Wednesday
 * 4 November, the ideas it sorted, an onboarding flow from the workspace, and what three breakout rooms brought back. Each
 * is written by the board package's own writes, as people's browsers write them, so the surface reads them exactly as it
 * would in a call. Positions, colours and words are the canvas's. The board stories make each on an in-memory Y.Doc of their
 * own; the stand-in's workspaces draw the retro and the flow into the documents it keeps (`RETRO`, `FLOW`).
 */
import type { Person, ScreenMoment } from '@alcove/api';
import { addObject, addReply, addThread, applyThemes, fillTemplate, readBoard, type BoardAuthor, type BoardTheme, type NewObject, type StickyColour, type TemplateName } from '@alcove/board';
import * as Y from 'yjs';
import { colourOf } from '~/features/board/people';
import type { BoardSpec } from './index';
import { LAUNCH_CHECKLIST } from './notes';
import { AIKO, ART, KOFI, LENA, MAYA, PRIYA, SAM, THEO } from './people';

/** Someone on a board: who they are, their first name, the colour of their pointer, and the one browser they're on. */
export interface OnTheBoard {
  /** Their call identity, as following and talking name them. */
  id: FolkId;
  person: Person;
  name: string;
  colour: string;
  /** Their browser's client on the board's awareness. */
  client: number;
}

export type FolkId = 'art' | 'priya' | 'theo' | 'kofi' | 'maya' | 'lena' | 'sam' | 'aiko';

/** Someone's pointer is in the colour the app gives them, from what they're known by, as it would be on their board's page. */
const folk = (id: FolkId, person: Person, client: number): OnTheBoard => ({ id, person, name: person.name.split(' ')[0] ?? person.name, colour: colourOf(person.id), client });

/** The canvas's people. */
export const FOLK: Readonly<Record<FolkId, OnTheBoard>> = {
  art: folk('art', ART, 4100),
  priya: folk('priya', PRIYA, 4101),
  theo: folk('theo', THEO, 4102),
  kofi: folk('kofi', KOFI, 4103),
  maya: folk('maya', MAYA, 4104),
  lena: folk('lena', LENA, 4105),
  sam: folk('sam', SAM, 4106),
  aiko: folk('aiko', AIKO, 4107)
};

/** Writes that came with the board: nobody's undo takes them back. */
const SEED = 'seed';
/** A sticky's side, and the gap the canvas keeps between them and round a frame's edge. */
const S = 150, G = 20;

interface Spot { x: number; y: number }
/** Where the canvas puts a frame's `i`th sticky: two to a row, or `cols`. */
const slot = (frame: Spot, i: number, cols = 2): Spot => ({ x: frame.x + G + (i % cols) * (S + G), y: frame.y + G + Math.floor(i / cols) * (S + G) });
const note = ({ x, y }: Spot, c: StickyColour, t: string): NewObject => ({ k: 'note', x, y, w: S, h: S, c, size: 'm', t });
const frame = (title: string, x: number, y: number, w: number, h: number, hint = '', sub = '', c: StickyColour | '' = ''): NewObject =>
  ({ k: 'frame', x, y, w, h, title, hint, sub, sorted: false, c, role: '' });

/** Adds each and keeps the id each one got, by the canvas's name for it. */
function adding(doc: Y.Doc): { put: (key: string, o: NewObject) => void; ids: Map<string, string> } {
  const ids = new Map<string, string>();
  return {
    ids,
    put: (key, o) => {
      const id = addObject(doc, o, SEED);
      if (id) ids.set(key, id);
    }
  };
}

/** A line from one thing to another, attached at both ends, as dragging from a dot draws it. */
function link(doc: Y.Doc, ids: ReadonlyMap<string, string>, from: string, to: string, style: 'elbow' | 'straight' | 'curve' = 'elbow'): void {
  const a = ids.get(from), b = ids.get(to);
  if (a && b) addObject(doc, { k: 'line', style, from: { on: a, side: 'r' }, to: { on: b, side: 'l' } }, SEED);
}

/** A template, filled as the server fills a new board. */
export function templateBoard(name: TemplateName): Y.Doc {
  const doc = new Y.Doc();
  fillTemplate(doc, name, SEED, `story-${name}`);
  return doc;
}

const WELL: Spot = { x: 0, y: 0 }, FIX: Spot = { x: 400, y: 0 }, ACT: Spot = { x: 800, y: 0 };

interface RetroOptions { links?: boolean | undefined; only?: readonly string[] | undefined }

/**
 * The launch retro a few minutes in: what went well, what could improve, and the actions, three of them linked to what they
 * fix. `only` keeps the stickies named, as the canvas does while it fills up. The ids come back by the canvas's names for them.
 */
export function launchRetro(options: RetroOptions = {}): { doc: Y.Doc; ids: ReadonlyMap<string, string> } {
  const doc = new Y.Doc();
  return { doc, ids: writeRetro(doc, options) };
}

/** Writes the launch retro onto `doc`, which has nothing on it yet. */
function writeRetro(doc: Y.Doc, { links = true, only }: RetroOptions = {}): ReadonlyMap<string, string> {
  fillTemplate(doc, 'retro', SEED, 'story-launch-retro');
  const { put, ids } = adding(doc);
  // The template's frames, by their titles.
  for (const f of readBoard(doc).frames) ids.set(f.title, f.id);
  const stickies: readonly (readonly [string, Spot, number, StickyColour, string])[] = [
    ['w1', WELL, 0, 'butter', 'Beta sign-ups beat the plan'],
    ['w2', WELL, 1, 'butter', 'Support ran launch day with no queue'],
    ['w3', WELL, 2, 'butter', 'Design and engineering paired on the importer'],
    ['w4', WELL, 3, 'butter', 'Pricing page shipped a week early'],
    ['w5', WELL, 4, 'butter', 'No rollbacks'],
    ['f3', FIX, 0, 'rose', 'Nobody owned the status page'],
    ['f1', FIX, 1, 'rose', 'Changelog went out after the launch post'],
    ['f5', FIX, 2, 'rose', 'QA found the billing bug on launch day'],
    ['f2', FIX, 3, 'rose', 'Staging data was two days stale'],
    ['f4', FIX, 5, 'rose', 'One checklist lived in three tools'],
    ['a1', ACT, 0, 'sky', 'One owner for launch comms'],
    ['a2', ACT, 2, 'sky', 'Refresh staging every night'],
    ['a3', ACT, 4, 'sky', 'Write the launch runbook']
  ];
  for (const [key, f, i, c, t] of stickies) if (!only || only.includes(key)) put(key, note(slot(f, i), c, t));
  if (links) {
    link(doc, ids, 'f1', 'a1');
    link(doc, ids, 'f2', 'a2');
    link(doc, ids, 'f4', 'a3');
  }
  return ids;
}

/** Who wrote a comment, as the board stories' people know them: who they are in the call, and their first name. */
const author = (who: FolkId): BoardAuthor => ({ by: FOLK[who].id, name: FOLK[who].name });
/** Comments are nobody's change to the board, as the surface writes them: no undo takes these back. */
const SAID = { comments: true };

/**
 * The retro with a conversation on it: Maya asks about the changelog on Priya's sticky and Art answers, and Kofi has a note on
 * refreshing staging. Each is a thread pinned to its sticky, as the people in the call wrote them.
 */
export function retroWithComments(): { doc: Y.Doc; ids: ReadonlyMap<string, string> } {
  const retro = launchRetro();
  const { doc, ids } = retro;
  const changelog = ids.get('f1'), staging = ids.get('a2');
  if (changelog) {
    const thread = addThread(doc, changelog, 'Kofi did last time. Worth writing down?', author('maya'), SAID);
    addReply(doc, thread, 'Yes. I’ll put it in the runbook.', author('art'), SAID);
  }
  if (staging) addThread(doc, staging, 'The nightly job is already there, just switched off.', author('kofi'), SAID);
  return retro;
}

/** Priya's screen as a picture of it on the board keeps it: launch day's timeline, with the changelog going out after the post. */
export const PRIYAS_SCREEN: ScreenMoment = {
  ...LAUNCH_CHECKLIST,
  id: 'board-shot', presenter: { name: PRIYA.name, person: PRIYA }, title: 'Launch day',
  text: 'Launch day\n09:00 Launch post goes out\n11:30 Changelog goes out\n14:00 Status page updated',
  description: 'Priya’s timeline for launch day: the changelog went out two and a half hours after the launch post.',
  regions: []
};

/** The canvas's nine ideas for launching better, where people dropped them, before anyone sorted them. */
const IDEAS: readonly (readonly [string, string, StickyColour, number, number])[] = [
  ['i1', 'Write the changelog first', 'butter', 40, 30],
  ['i2', 'One launch calendar', 'peach', 250, 90],
  ['i3', 'Tell support a week ahead', 'rose', 470, 26],
  ['i4', 'Refresh staging every night', 'sky', 690, 120],
  ['i5', 'Test billing with real cards', 'lilac', 900, 40],
  ['i6', 'Dry run the day before', 'butter', 130, 300],
  ['i7', 'Name an owner for every launch', 'rose', 370, 280],
  ['i8', 'The status page gets an owner', 'sky', 620, 330],
  ['i9', 'Keep the runbook in the workspace', 'peach', 860, 300]
];

/** The canvas's three themes for the ideas, by what each sticky says. */
const THEMES: readonly { name: string; ideas: readonly string[] }[] = [
  { name: 'Comms', ideas: ['i1', 'i2', 'i3'] },
  { name: 'Testing', ideas: ['i4', 'i5', 'i6'] },
  { name: 'Ownership', ideas: ['i7', 'i8', 'i9'] }
];
/** The canvas's theme for one of its ideas, by what the sticky says, or null for anything else. */
export const canvasTheme = (text: string): string | null => THEMES.find((t) => t.ideas.some((key) => IDEAS.find(([k]) => k === key)?.[1] === text))?.name ?? null;
const themeOf = (text: string): string => canvasTheme(text) ?? 'Other';

/**
 * Sort into themes as confidential compute answers it, for the stickies picked: the canvas's three themes, by what each sticky says,
 * and anything else under Other. It stands in for the server, which a story can't reach.
 */
export function themesFor(doc: Y.Doc, stickies: readonly string[]): BoardTheme[] {
  const view = readBoard(doc);
  const groups = new Map<string, string[]>();
  for (const id of stickies) {
    const o = view.byId.get(id);
    if (o?.k !== 'note') continue;
    const name = themeOf(o.t);
    groups.set(name, [...(groups.get(name) ?? []), id]);
  }
  return [...groups].map(([name, ids]) => ({ name, ids }));
}

/** Puts the canvas's pile of ideas on a board, in one frame, as people dropped them: the ids of what's on it, by the canvas's names. */
export function drawIdeas(doc: Y.Doc): ReadonlyMap<string, string> {
  const { put, ids } = adding(doc);
  put('ideas', frame('How do we launch better?', 0, 0, 1160, 530));
  for (const [key, t, c, x, y] of IDEAS) put(key, note({ x, y }, c, t));
  return ids;
}

/** A pile of ideas in one frame. `sorted` runs the board's own Sort into themes on them, into the canvas's three themes. */
export function launchIdeas({ sorted = false }: { sorted?: boolean | undefined } = {}): { doc: Y.Doc; ids: ReadonlyMap<string, string> } {
  const doc = new Y.Doc();
  const ids = drawIdeas(doc);
  if (sorted) applyThemes(doc, themesFor(doc, IDEAS.flatMap(([key]) => ids.get(key) ?? [])), SEED);
  return { doc, ids };
}

/** Onboarding as a flow, brought in from the workspace, with Aiko's question on the step people stop at. */
export function onboardingFlow(): Y.Doc {
  const doc = new Y.Doc();
  writeOnboarding(doc);
  return doc;
}

function writeOnboarding(doc: Y.Doc): void {
  const { put, ids } = adding(doc);
  const shape = (key: string, s: 'rect' | 'ellipse' | 'diamond' | 'pill', t: string, x: number, y: number, w: number, h: number, c: StickyColour | '' = ''): void => put(key, { k: 'shape', s, t, x, y, w, h, c });
  shape('s1', 'pill', 'Sign up', 0, 130, 170, 76, 'sky');
  shape('s2', 'rect', 'Verify email', 240, 130, 170, 76);
  shape('s3', 'diamond', 'Invited by a team?', 480, 88, 180, 160, 'butter');
  shape('s4', 'rect', 'Join their workspace', 740, 20, 190, 76);
  shape('s5', 'rect', 'Create a workspace', 740, 240, 190, 76);
  shape('s6', 'pill', 'Invite people', 1000, 240, 170, 76, 'sky');
  put('n1', note({ x: 250, y: 260 }, 'rose', 'Most people stop here. Can we skip it for invited people?'));
  put('yes', { k: 'text', size: 'heading', t: 'Yes', x: 672, y: 96, w: 40, h: 24 });
  put('no', { k: 'text', size: 'heading', t: 'No', x: 672, y: 226, w: 40, h: 24 });
  link(doc, ids, 's1', 's2');
  link(doc, ids, 's2', 's3');
  link(doc, ids, 's3', 's4');
  link(doc, ids, 's3', 's5');
  link(doc, ids, 's5', 's6');
}

/**
 * The launch retro in the stand-in's Product workspace, with Priya and Kofi on it, as the canvas's page has them, and Maya's
 * question on the sticky nobody owned. Comments here keep who wrote them by who they are in the workspace.
 */
export const RETRO: BoardSpec = {
  draw: (doc) => {
    const owned = writeRetro(doc).get('f3');
    if (owned) addThread(doc, owned, 'Who looks after it once we’ve launched?', { by: MAYA.id, name: MAYA.name }, SAID);
  },
  here: [{ who: PRIYA, x: 560, y: 300 }, { who: KOFI, x: 1010, y: 520 }]
};
/** The onboarding flow in the stand-in's Design workspace, with Aiko looking at it. */
export const FLOW: BoardSpec = { draw: writeOnboarding, here: [{ who: AIKO, x: 600, y: 200 }] };
/** A board nobody has added to yet. */
export const BLANK: BoardSpec = {};

/** The canvas's three breakout rooms: who was in each, and what they said happened, why, and what next. */
export const ROOMS: readonly { name: string; who: readonly FolkId[]; rows: readonly (readonly [string, string])[] }[] = [
  { name: 'Comms', who: ['priya', 'theo'], rows: [['Changelog went out after the launch post', 'Two people wrote the same email'], ['Nobody owned the date', 'The plan moved on Monday'], ['One owner for launch comms', 'One shared launch calendar']] },
  { name: 'Staging', who: ['kofi', 'maya'], rows: [['Data was two days stale', 'A billing bug reached launch day'], ['The nightly job was off', 'Nobody watches it'], ['Refresh staging every night', 'Alert when the job fails']] },
  { name: 'Support', who: ['lena', 'sam'], rows: [['Replies were out of date', 'Tickets went to the wrong queue'], ['Support saw the docs late', 'New plans had no tag'], ['Support joins the launch review', 'Tag plans before launch']] }
];
const COLUMNS: readonly StickyColour[] = ['rose', 'peach', 'sky'];

/**
 * A breakout room's own board, as the room left it: what happened, why, and what next, on the template's three frames, two
 * stickies to each. What next is its Actions frame, where the notes take follow-ups from.
 */
export function roomBoard(name: string): BoardSpec {
  return {
    draw: (doc) => {
      const room = ROOMS.find((r) => r.name === name);
      if (!room) return;
      fillTemplate(doc, 'what-why-next', SEED, `story-room-${name}`);
      const { put } = adding(doc);
      room.rows.forEach(([first, second], k) => {
        const at: Spot = { x: k * 220, y: 0 };
        put(`${name}${k}a`, note(slot(at, 0, 1), COLUMNS[k] ?? 'butter', first));
        put(`${name}${k}b`, note(slot(at, 1, 1), COLUMNS[k] ?? 'butter', second));
      });
    }
  };
}

/**
 * When rooms close: each room's board lands on the main one as a frame, named, with who was there. Each frame's id comes back under
 * the room's name. `leaveOut` keeps stickies off, by room, row and side (`Support2b`), as the canvas does before one is added.
 */
export function roomsBack({ leaveOut = [] }: { leaveOut?: readonly string[] | undefined } = {}): { doc: Y.Doc; ids: ReadonlyMap<string, string> } {
  const doc = new Y.Doc();
  const { put, ids } = adding(doc);
  ROOMS.forEach((room, n) => {
    const at: Spot = { x: n * 400, y: 0 };
    put(room.name, frame(room.name, at.x, at.y, 360, 530, '', room.who.map((w) => FOLK[w].name).join(', ')));
    room.rows.forEach(([first, second], k) => {
      if (!leaveOut.includes(`${room.name}${k}a`)) put(`${room.name}${k}a`, note(slot(at, k * 2), COLUMNS[k] ?? 'butter', first));
      if (!leaveOut.includes(`${room.name}${k}b`)) put(`${room.name}${k}b`, note(slot(at, k * 2 + 1), COLUMNS[k] ?? 'butter', second));
    });
  });
  return { doc, ids };
}

/** Where someone is on a board, as their browser says on its awareness. */
export interface Presence {
  who: FolkId;
  /** Their pointer, in board units, or null while it's off the board. */
  at: Spot | null;
  /** Typing in this, by the canvas's name for it, which `ids` turns into the board's. */
  typing?: string | undefined;
  /** The board point in the middle of their sheet, and their zoom, for following them. */
  view?: { x: number; y: number; z: number } | undefined;
}

/** The canvas's call a few minutes in: Priya talking near Could improve, and four more pointers round the board. */
export const AROUND: readonly Presence[] = [
  { who: 'priya', at: { x: 575, y: 214 }, view: { x: 580, y: 300, z: 1 } },
  { who: 'theo', at: { x: 118, y: 332 } },
  { who: 'kofi', at: { x: 590, y: 416 } },
  { who: 'maya', at: { x: 950, y: 90 } },
  { who: 'lena', at: { x: 300, y: 470 } }
];

/** Everyone writing at once: Priya and Theo typing, Maya and Kofi looking on. */
export const WRITING: readonly Presence[] = [
  { who: 'priya', at: { x: 610, y: 214 }, typing: 'f1' },
  { who: 'theo', at: { x: 118, y: 332 }, typing: 'w3' },
  { who: 'maya', at: { x: 950, y: 90 } },
  { who: 'kofi', at: { x: 590, y: 416 } }
];
