/*
 * When connections drop (user-flows 6): yours reconnecting and coming back, yours dropping for good, and the
 * organizer's dropping, so someone invited hosts in their place until they're back. The host muting your microphone
 * is here too: it arrives through the room, as LiveKit's does.
 */
import type { Meta } from '@storybook/react-vite';
import { at, joins } from '../../src/api/call/script';
import { setOnline } from '../../src/browser';
import { inCall, phone } from '../../src/call';
import { pages, type PageArgs } from '../../src/page';
import { AIKO, CHECK_IN, CHECK_IN_SUMMARY, CHECK_IN_TALK, KOFI, MAYA, PRIYA, REVIEW, REVIEW_SUMMARY, REVIEW_TALK } from './talk';

const meta = { title: 'Calls/Connection', ...pages } satisfies Meta<PageArgs>;
export default meta;

const REVIEWERS = [{ who: PRIYA }, { who: KOFI }, { who: AIKO }];

/** Your connection drops three seconds in: the top of the call says Reconnecting, and fifteen seconds later you're back, as the same person, with Back online. */
export const Reconnecting = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: { here: REVIEWERS, talk: { lines: REVIEW_TALK }, summary: REVIEW_SUMMARY, cues: at(3, { do: 'reconnect', seconds: 15 }) }
});
export const ReconnectingPhone = phone(Reconnecting);

const wait = (ms: number) => new Promise<void>((done) => { setTimeout(done, ms); });
/** This browser goes offline three seconds in: the top of the call says Reconnecting until it's back eight seconds later, with Back online. */
export const OfflineAndBack = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, talk: { lines: REVIEW_TALK }, summary: REVIEW_SUMMARY } }, {
  play: async ({ step }) => {
    await step('Three seconds in, the browser loses its connection', async () => { await wait(3000); setOnline(false); });
    await step('Eight seconds later it’s back', async () => { await wait(8000); setOnline(true); });
  }
});
export const OfflineAndBackPhone = phone(OfflineAndBack);

/** Your connection drops for good: the call says so, with Reload to join again. */
export const ConnectionDropped = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, cues: at(4, { do: 'drop' }) } });

/**
 * Priya's connection drops six seconds in: notes are unavailable for everyone, and ten seconds later you host in her
 * place (you came in first), from your browser. She's back at 45 seconds, and hosts again at once.
 */
export const TheHostDropsOut = inCall({
  scenario: 'busy', call: CHECK_IN,
  script: {
    cues: [...at(1, joins(KOFI)), ...at(1.6, joins(MAYA)), ...at(6, { do: 'host-drops' }), ...at(45, { do: 'host-back' })],
    talk: { lines: CHECK_IN_TALK }, summary: CHECK_IN_SUMMARY
  }
});
export const TheHostDropsOutPhone = phone(TheHostDropsOut);

/** The same, with Kofi there before you: he hosts while Priya is away, and everyone sees that it's him. */
export const SomeoneElseHosts = inCall({
  scenario: 'busy', call: { ...CHECK_IN, code: 'lch-chck-kfo' },
  script: { here: [{ who: KOFI }, { who: MAYA }], cues: at(5, { do: 'host-drops' }), talk: { lines: CHECK_IN_TALK }, summary: CHECK_IN_SUMMARY }
});

/** Priya mutes your microphone four seconds in: the dock shows it off, and you unmute when you're ready. */
export const MutedByTheHost = inCall({ scenario: 'busy', call: { ...CHECK_IN, code: 'lch-chck-mte' }, script: { here: [{ who: KOFI }, { who: AIKO }], cues: at(4, { do: 'mute-you' }) } });
