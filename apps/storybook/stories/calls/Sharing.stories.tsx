/*
 * Shared screens (user-flows 6): someone else's share, drawn (a deck or a document, a page at a time, their pointer drifting over
 * it), on your stage in its frame; a second, which comes in as a tile with the people while you watch the first, and Show beside,
 * which puts them side by side; a third, another tile, with a toast that says who started; and your own, from the browser's
 * made-up screen, through Share in the dock.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { at, says, shares, stopsSharing } from '../../src/api/script';
import { inCall, phone, type InCall } from '../../src/call';
import { pages, type PageArgs } from '../../src/page';
import { SOON, frameOf, settle, shareATab, tileOf } from './plays';
import { AIKO, CHECKLIST, EMPTY_STATES, KOFI, PRIYA, RELEASE, REVIEW, REVIEW_SUMMARY, REVIEW_TALK } from './talk';

const meta = { title: 'Calls/Sharing', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** Priya shares the launch checklist two seconds in, and talks it through: it takes your stage, in its frame. */
export const SomeoneSharing = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: { here: [{ who: PRIYA }, { who: KOFI }, { who: AIKO }], cues: at(2, shares(PRIYA, CHECKLIST)), talk: { from: 4, lines: REVIEW_TALK }, summary: REVIEW_SUMMARY }
});
export const SomeoneSharingPhone = phone(SomeoneSharing);

/** Priya's deck is on your stage as you come in; Kofi puts his document up beside it, and it comes in as a tile with the people. */
const twoSharing: InCall = {
  scenario: 'call-soon', call: REVIEW,
  script: {
    here: [{ who: PRIYA, sharing: CHECKLIST }, { who: KOFI }, { who: AIKO }],
    cues: [...at(3, shares(KOFI, EMPTY_STATES)), ...at(5, says(KOFI, 'I’ve put the empty states up beside Priya’s checklist, so we can tick them off.'))]
  }
};
export const TwoSharing = inCall(twoSharing);
export const TwoSharingPhone = phone(TwoSharing);
/** Show beside, from the options on Kofi's tile: the two side by side, each in its frame. */
export const TwoSharingSideBySide = inCall(twoSharing, {
  play: async ({ userEvent, step }) => {
    await step('Hover Kofi’s tile, press its options, then Show beside', async () => {
      const kofis = 'Kofi’s screen';
      await userEvent.hover(await tileOf(kofis));
      await userEvent.click(await screen.findByRole('button', { name: `Options for ${kofis}` }, SOON));
      const menu = await screen.findByRole('dialog', { name: `Options for ${kofis}` }, SOON);
      await settle();
      await userEvent.click(within(menu).getByRole('button', { name: 'Show beside' }));
      await frameOf(kofis);
    });
  }
});

/** Priya's on your stage and Kofi's a tile as you come in; Aiko starts a third: another tile, and a toast says who, with Show it. Aiko stops after a while. */
export const ThreeSharing = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: { here: [{ who: PRIYA, sharing: CHECKLIST }, { who: KOFI, sharing: EMPTY_STATES }, { who: AIKO }], cues: [...at(6, shares(AIKO, RELEASE)), ...at(30, stopsSharing(AIKO))] }
}, {
  play: async (c) => {
    await c.step('Aiko shares a third: another tile, and the toast has Show it', async () => {
      await screen.findByText('Aiko is presenting their screen. It’s with the people.', {}, { timeout: 20000 });
    });
  }
});

/**
 * You share a tab: Share in the dock, Your screen, then the browser's own question (here, a drawn slide). Your screen is on your
 * stage, its bar saying how it goes out, with Stop sharing, and Share in the dock says Presenting meanwhile.
 */
export const YouShare = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: [{ who: PRIYA }, { who: KOFI }, { who: AIKO }] } }, {
  play: async (c) => {
    await c.step('Press Share in the dock, Your screen, A tab, then Share. The browser asks which one, and the call shows it a moment later', async () => {
      await shareATab(c);
      await frameOf('Your screen');
    });
  }
});
