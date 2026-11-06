/*
 * A board in the call, as the call stories put one there: the launch retro the whiteboards canvas fills. Whoever opens a
 * board in the design review, you or someone in the script, Priya, Kofi and Aiko fill it as they talk (`RETRO`, a script's
 * `board`), and vote on it as `RETRO.votes` says. Any call story can put it on its call's stage the same way and add to it
 * (the call's help, breakout rooms): `opensBoard(PRIYA, 'retro')` in its cues, and `RETRO` as its script's `board`. With notes
 * on, `HEARD` in its cues is what the call hears worth a sticky.
 * Everything on it is made up, by the demo world's people.
 */
import { hears, type BoardWork, type CallScript } from '../../src/api/script';
import { AIKO, KOFI, PRIYA } from './talk';

/** What the design review puts on the launch retro, frame by frame, as the canvas has it, and who puts each. */
export const RETRO_WORK: readonly BoardWork[] = [
  { who: PRIYA, frame: 'Went well', text: 'Beta sign-ups beat the plan' },
  { who: KOFI, frame: 'Could improve', text: 'Nobody owned the status page' },
  { who: AIKO, frame: 'Went well', text: 'Support ran launch day with no queue' },
  { who: PRIYA, frame: 'Could improve', text: 'Changelog went out after the launch post' },
  { who: KOFI, frame: 'Actions', text: 'One owner for launch comms' },
  { who: AIKO, frame: 'Could improve', text: 'Staging data was two days stale' },
  { who: PRIYA, frame: 'Actions', text: 'Refresh staging every night' }
];

/** The launch retro as the design review works on it: every sticky, and how Priya, Kofi and Aiko vote on Could improve. */
export const RETRO: NonNullable<CallScript['board']> = {
  work: RETRO_WORK,
  votes: { 'Nobody owned the status page': 3, 'Changelog went out after the launch post': 2, 'Staging data was two days stale': 1 },
  voters: 3
};
/** The launch retro with only its first `n` stickies. */
export const retroWith = (n: number): NonNullable<CallScript['board']> => ({ ...RETRO, work: RETRO_WORK.slice(0, n) });
/** How long after a board opens the last of its `n` stickies lands, in seconds. */
export const filledAfter = (n: number = RETRO_WORK.length): number => 1 + (n - 1) * 1.2;

/** What the call hears in the design review worth a sticky, in the canvas's words: who said it, when, and the frame each fits. */
export const HEARD = hears(
  { who: PRIYA, said: 'The changelog should go out before the post, not after.', text: 'Changelog goes out before the post', frame: 'Could improve', ago: 120 },
  { who: KOFI, said: 'Let’s check staging the day before every launch.', text: 'Check staging the day before', frame: 'Actions', ago: 60 },
  { who: AIKO, said: 'Someone has to own the status page on the day.', text: 'Name a status page owner', frame: 'Actions', ago: 5 }
);
