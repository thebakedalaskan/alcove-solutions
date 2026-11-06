/*
 * The call behind the welcome page's note: a design review on Thursday. What it decided and who's doing what, each at the
 * moment it was said, the chapters it ran through, what was said around those moments, and where people spoke.
 */
import type { CastId } from '~/features/notes/cast';

/** How long the recording runs, in seconds (45:10). */
export const LENGTH = 2710;
/** Where the recording is when the note is first seen, and in the still: the first decision. */
export const START = 372;

export const HEAD = {
  title: 'Design review',
  when: 'Thu 5 Nov, 11:00 · 45 min',
  people: ['priya', 'kofi', 'aiko', 'art'],
  sealed: 'Written in confidential compute · hardware verified 11:58'
} as const satisfies { title: string; when: string; people: readonly CastId[]; sealed: string };

export const SUMMARY = 'The sidebar stays dark in both themes, and every page keeps one filled button. Kofi sends the new button styles on Thursday, once Aiko has checked the contrast on the dark sidebar.';

interface Chapter { at: number; title: string }
export const CHAPTERS: readonly Chapter[] = [{ at: 0, title: 'The sidebar' }, { at: 930, title: 'Buttons' }, { at: 1850, title: 'Rollout' }];

/** A decision, at the moment it was made: who proposed it, and who has confirmed it so far (nobody yet: null). */
interface Decided { at: number; text: string; proposer: string; confirmedBy: string | null }
export const DECIDED: readonly Decided[] = [
  { at: 372, text: 'The sidebar stays dark in both themes', proposer: 'Priya', confirmedBy: 'Kofi and Aiko' },
  { at: 1600, text: 'One filled button per view, on every page', proposer: 'Priya', confirmedBy: null }
];

/** Something to do, at the moment someone said they would: whose it is and the day it's due. */
interface FollowUp { at: number; text: string; who: CastId; due: string; done: boolean }
export const FOLLOW_UPS: readonly FollowUp[] = [
  { at: 1085, text: 'Send the new button styles', who: 'kofi', due: 'Thu', done: false },
  { at: 2091, text: 'Check the contrast on the dark sidebar', who: 'aiko', due: 'Wed', done: false },
  { at: 2370, text: 'Update the design notes', who: 'art', due: 'Today', done: true }
];

/** A line of the transcript. `unsure` is a word in it the transcript couldn't vouch for. */
export interface Said { at: number; who: CastId; text: string; unsure?: string | undefined }
export const SAID: readonly Said[] = [
  { at: 341, who: 'aiko', text: 'On the light theme the sidebar loses the logo against the page.' },
  { at: 372, who: 'priya', text: 'Then the sidebar stays dark in both themes. It frames the page either way.' },
  { at: 401, who: 'kofi', text: 'Agreed. And Start a call in it can be tinted instead of filled.' },
  { at: 1061, who: 'art', text: 'So the only filled button is the thing you came to the page to do.' },
  { at: 1085, who: 'kofi', text: 'I’ll send the new button styles on Thursday.' },
  { at: 1600, who: 'priya', text: 'One filled button per view, then. Let’s hold every page to it.' },
  { at: 2091, who: 'aiko', text: 'I’ll check the contrast on the dark sidebar by Wednesday, before the styles land.', unsure: 'Wednesday' },
  { at: 2370, who: 'art', text: 'And I’ll update the design notes today.' },
  { at: 2466, who: 'priya', text: 'Then it all ships with the Harbourline release.', unsure: 'Harbourline' }
];

/** The moments the sun visits in turn: every decision and follow-up, in the order they were said. */
export const STOPS: readonly number[] = [...DECIDED, ...FOLLOW_UPS].map((m) => m.at).sort((a, b) => a - b);

/** A short stroke of light under the line where someone spoke: where (% of the call), how far below it, how long and how bright. */
interface Glint { x: number; row: number; width: number; o: number }
/** The same strokes every time: a seeded sequence, so the light under the line never changes between visits. */
function seeded(seed: number) {
  let n = seed;
  return () => { n = (n * 16807) % 2147483647; return (n - 1) / 2147483646; };
}
export const GLINTS: readonly Glint[] = (() => {
  const r = seeded(19);
  return Array.from({ length: 64 }, () => {
    const x = r() * 100, row = Math.floor(r() * 4), width = 10 + r() * 34;
    return { x, row, width, o: 0.18 + r() * 0.3 };
  });
})();
