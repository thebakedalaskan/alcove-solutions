/*
 * Shared screens (user-flows 6): someone else's share, drawn (a deck or a document, a page at a time, their pointer
 * drifting over it), two side by side, a third waiting as a tile, and your own, from the browser's made-up screen.
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { at, says, shares, stopsSharing } from '../../src/api/script';
import { inCall, phone } from '../../src/call';
import { pages, type PageArgs } from '../../src/page';
import { AIKO, CHECKLIST, EMPTY_STATES, KOFI, PRIYA, RELEASE, REVIEW, REVIEW_SUMMARY, REVIEW_TALK } from './talk';

const meta = { title: 'Calls/Sharing', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** Priya shares the launch checklist two seconds in, and talks it through. */
export const SomeoneSharing = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: { here: [{ who: PRIYA }, { who: KOFI }, { who: AIKO }], cues: at(2, shares(PRIYA, CHECKLIST)), talk: { from: 4, lines: REVIEW_TALK }, summary: REVIEW_SUMMARY }
});
export const SomeoneSharingPhone = phone(SomeoneSharing);

/** Priya's deck and Kofi's document, side by side, with a line between them to drag. */
export const TwoSharing = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: {
    here: [{ who: PRIYA, sharing: CHECKLIST }, { who: KOFI }, { who: AIKO }],
    cues: [...at(3, shares(KOFI, EMPTY_STATES)), ...at(5, says(KOFI, 'I’ve put the empty states up beside Priya’s checklist, so we can tick them off.'))]
  }
});
export const TwoSharingPhone = phone(TwoSharing);

/** A third share waits as a tile: a toast says who started, with Show it. Aiko stops after a while. */
export const ThreeSharing = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: { here: [{ who: PRIYA, sharing: CHECKLIST }, { who: KOFI, sharing: EMPTY_STATES }, { who: AIKO }], cues: [...at(6, shares(AIKO, RELEASE)), ...at(30, stopsSharing(AIKO))] }
});

/** You share a tab: the picker, then the browser's (here, a drawn slide), and the bar that says what you're sharing. */
export const YouShare = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: [{ who: PRIYA }, { who: KOFI }, { who: AIKO }] } }, {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Share in the dock: the picker asks what to share', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Share a tab, window or screen' }, { timeout: 10000 }));
    });
    await step('Choose a tab. The browser asks which one, and the call shows it a moment later', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Choose a tab' }, { timeout: 5000 }));
    });
  }
});
