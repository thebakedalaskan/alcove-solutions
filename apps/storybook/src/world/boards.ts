/*
 * What the world's boards hold, as the whiteboards canvas draws them (its content.js): the launch retro, three frames of
 * stickies with lines from what could improve to what's being done about it, and a comment on one of them; and the
 * onboarding flow, from the canvas's workspace. Each is written with @alcove/board's own writers, as a browser would, so
 * the board opens it as it opens any other.
 */
import { addObject, addThread, type NewObject, type StickyColour } from '@alcove/board';
import type * as Y from 'yjs';
import type { BoardSpec } from './index';
import { AIKO, KOFI, MAYA, PRIYA } from './people';

/** Whoever wrote what's here, as far as the board's undo knows: nobody on the page. */
const WORLD = { world: true };

/** A sticky's side, and the gap between them in a frame, as the canvas has them. */
const S = 150, G = 20;

function put(doc: Y.Doc, input: NewObject): string {
  const id = addObject(doc, input, WORLD);
  if (!id) throw new Error(`The world’s board wouldn’t take a ${input.k}.`);
  return id;
}

interface Frame { x: number; y: number }
/** The `i`th place for a sticky in a frame, two to a row. */
const slot = (f: Frame, i: number) => ({ x: f.x + G + (i % 2) * (S + G), y: f.y + G + Math.floor(i / 2) * (S + G) });

function retro(doc: Y.Doc): void {
  const frame = (title: string, x: number, hint: string, c: StickyColour, role: '' | 'actions' = ''): Frame => {
    put(doc, { k: 'frame', x, y: 0, w: 360, h: 530, c, role, hint, sub: '', title });
    return { x, y: 0 };
  };
  const well = frame('Went well', 0, 'What should we keep doing?', 'butter');
  const fix = frame('Could improve', 400, 'What got in the way?', 'rose');
  const act = frame('Actions', 800, 'Who does what next?', 'sky', 'actions');
  const note = (f: Frame, i: number, c: StickyColour, t: string) => put(doc, { k: 'note', ...slot(f, i), w: S, h: S, c, size: 'm', t });
  note(well, 0, 'butter', 'Beta sign-ups beat the plan');
  note(well, 1, 'butter', 'Support ran launch day with no queue');
  note(well, 2, 'butter', 'Design and engineering paired on the importer');
  note(well, 3, 'butter', 'Pricing page shipped a week early');
  note(well, 4, 'butter', 'No rollbacks');
  const owned = note(fix, 0, 'rose', 'Nobody owned the status page');
  const changelog = note(fix, 1, 'rose', 'Changelog went out after the launch post');
  note(fix, 2, 'rose', 'QA found the billing bug on launch day');
  const staging = note(fix, 3, 'rose', 'Staging data was two days stale');
  const checklist = note(fix, 5, 'rose', 'One checklist lived in three tools');
  const comms = note(act, 0, 'sky', 'One owner for launch comms');
  const nightly = note(act, 2, 'sky', 'Refresh staging every night');
  const runbook = note(act, 4, 'sky', 'Write the launch runbook');
  const line = (from: string, to: string) => put(doc, { k: 'line', style: 'elbow', from: { on: from, side: 'r' }, to: { on: to, side: 'l' } });
  line(changelog, comms);
  line(staging, nightly);
  line(checklist, runbook);
  addThread(doc, owned, 'Who looks after it once we’ve launched?', { by: MAYA.id, name: MAYA.name }, WORLD);
}

function flow(doc: Y.Doc): void {
  const shape = (s: 'pill' | 'rect' | 'diamond', t: string, x: number, y: number, w: number, h: number, c: StickyColour | '' = '') => put(doc, { k: 'shape', s, t, x, y, w, h, c });
  const up = shape('pill', 'Sign up', 0, 130, 170, 76, 'sky');
  const verify = shape('rect', 'Verify email', 240, 130, 170, 76);
  const invited = shape('diamond', 'Invited by a team?', 480, 88, 180, 160, 'butter');
  const join = shape('rect', 'Join their workspace', 740, 20, 190, 76);
  const make = shape('rect', 'Make a workspace', 740, 240, 190, 76);
  const line = (from: string, to: string, a: 'r' | 't' | 'b' = 'r', b: 'l' | 't' | 'b' = 'l') => put(doc, { k: 'line', style: 'elbow', from: { on: from, side: a }, to: { on: to, side: b } });
  line(up, verify);
  line(verify, invited);
  line(invited, join, 't');
  line(invited, make, 'b');
}

/** The launch retro, with Priya and Kofi on it, as the canvas's page has them. */
export const RETRO: BoardSpec = { draw: retro, here: [{ who: PRIYA, x: 560, y: 300 }, { who: KOFI, x: 1010, y: 520 }] };
/** The onboarding flow, with Aiko looking at it. */
export const FLOW: BoardSpec = { draw: flow, here: [{ who: AIKO, x: 600, y: 200 }] };
/** A board nobody has added to yet. */
export const BLANK: BoardSpec = {};
