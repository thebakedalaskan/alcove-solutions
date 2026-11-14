/*
 * Ringing (user-flows 4 and 5): the people you ring wait on the stage in arches that ripple until they answer, and being
 * rung drops a card in on whatever page is open, over a call too. The people rung answer as the script says.
 */
import type { Meta } from '@storybook/react-vite';
import { at, ringFrom, run } from '../../src/api/call/script';
import { ringYou } from '../../src/api/calls/rings';
import { inCall, phone, rung, type StoryCall } from '../../src/call';
import { pages, type PageArgs } from '../../src/page';
import { iso } from '../../src/world/clock';
import { AIKO, ART, CHECK_IN_TALK, INES, KOFI, MAYA, PRIYA, REVIEW, REVIEW_SUMMARY, REVIEW_TALK, STARTED } from './talk';

const meta = { title: 'Calls/Ringing', ...pages } satisfies Meta<PageArgs>;
export default meta;

/**
 * You started a call and rang three people as you joined: Priya can't yet (in five minutes), Kofi's on his way and comes
 * in, and Aiko can't this time, so her arch offers Ring again.
 */
export const RingingYourTeam = inCall({
  scenario: 'busy', call: STARTED, ring: [PRIYA, KOFI, AIKO],
  script: {
    answers: { [PRIYA.email]: { after: 5, reply: 'in-5' }, [KOFI.email]: { after: 8, reply: 'join' }, [AIKO.email]: { after: 11, reply: 'no' } },
    talk: { from: 13, lines: REVIEW_TALK.filter((l) => l.who === KOFI || l.who === 'me') }
  }
});
export const RingingYourTeamPhone = phone(RingingYourTeam);

/** Nobody answers: each ring runs out after 45 seconds and offers Ring again. Never "offline": Alcove can't know. */
export const NobodyAnswers = inCall({
  scenario: 'busy', call: { ...STARTED, code: 'art-call-two' }, ring: [MAYA, AIKO],
  script: { answers: { [MAYA.email]: { after: 45, reply: 'missed' }, [AIKO.email]: { after: 45, reply: 'missed' } } }
});

/** Priya's design sync: she rings you from it, a card on Home. Join goes through the pre-join and into her call. */
const SYNC: StoryCall = { id: 'm-sync-now', title: 'Design sync', startsAt: iso(0, 16, 10), minutes: 30, code: 'dsn-sync-now', organizer: PRIYA, guests: [ART, KOFI] };
export const BeingRung = rung({
  scenario: 'busy', path: '/home', call: SYNC, from: PRIYA,
  script: { here: [{ who: PRIYA, organizer: true }, { who: KOFI }], talk: { lines: CHECK_IN_TALK.filter((l) => l.who === PRIYA || l.who === KOFI || l.who === 'me') } }
}, { globals: { theme: 'dark' } });
export const BeingRungPhone = phone(BeingRung);
export const BeingRungByDay = rung({ scenario: 'busy', path: '/home', call: { ...SYNC, code: 'dsn-sync-day' }, from: PRIYA }, { globals: { theme: 'light' } });

/** In the design review, Ines rings you into the board prep: the card comes in over the call, at night. */
const BOARD: StoryCall = { id: 'm-board', title: 'Board prep', startsAt: iso(0, 10, 15), minutes: 45, code: 'brd-prep-ins', organizer: INES, guests: [ART, PRIYA], status: 'live' };
export const RungDuringACall = inCall({
  scenario: 'call-soon', call: REVIEW, also: [BOARD],
  script: {
    here: [{ who: PRIYA }, { who: KOFI }, { who: AIKO }], talk: { lines: REVIEW_TALK }, summary: REVIEW_SUMMARY,
    cues: at(5, run(() => ringYou(ringFrom(INES, BOARD.code, BOARD.title))))
  }
});
export const RungDuringACallPhone = phone(RungDuringACall);
