/*
 * 6.30 Private messages: each conversation is a tab of its own in Chat, with its own draft. + starts one with someone in the
 * call; their tile, their row in People and their messages can too.
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { at, chats } from '../../../src/api/call/script';
import { inCall, phone, reach } from '../../../src/call';
import { pages, type PageArgs } from '../../../src/page';
import { SOON, talkPrivately, talkToEveryone } from '../../calls/plays';
import { KOFI, LAUNCH_REVIEW, PRIYA } from '../../calls/talk';

const meta = { title: 'Journeys/6 In the call/Private messages', ...pages } satisfies Meta<PageArgs>;
export default meta;
export const KeepEveryAudienceSeparate = inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script: { here: [{ who: PRIYA }, { who: KOFI }] } }, { play: async (c) => {
  await reach('Chat')(c);
  await c.step('Keep a draft for everyone', async () => { await c.userEvent.type(await screen.findByRole('combobox', { name: 'Message everyone' }), 'The agenda is ready.'); });
  await c.step('Press + and choose Priya: her conversation opens as its own tab, only to her', async () => {
    await talkPrivately(c, PRIYA);
    await screen.findByText(`Only you and ${PRIYA.name} can read this.`, {}, SOON);
    await c.userEvent.type(await screen.findByRole('combobox', { name: `Message only ${PRIYA.name}` }), 'Two minutes left.');
  });
  await c.step('Kofi has a tab, a draft and a recipient of his own', async () => {
    await talkPrivately(c, KOFI);
    await c.userEvent.type(await screen.findByRole('combobox', { name: `Message only ${KOFI.name}` }), 'Could you take the next question?');
  });
  await c.step('Back to Priya’s tab: her draft is still there, and Send says it goes only to her', async () => {
    await talkPrivately(c, PRIYA);
    await c.userEvent.click(await screen.findByRole('button', { name: `Send only to ${PRIYA.name}` }));
    await screen.findByText('Delivered', {}, SOON);
  });
  await c.step('Back to Everyone, with its own draft, without sending anything private there', async () => { await talkToEveryone(c); await screen.findByDisplayValue('The agenda is ready.'); });
} });
export const KeepEveryAudienceSeparatePhone = phone(KeepEveryAudienceSeparate);
/** From their row in People: the lock beside them opens Chat on your conversation with them. */
export const FromTheirRowInPeople = inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script: { here: [{ who: PRIYA }, { who: KOFI }] } }, { play: async (c) => {
  await c.step('Open People, from the faces at the top right', async () => { await reach('People')(c); });
  await c.step('Press the lock on Priya’s row: Chat opens on a conversation only she can read', async () => {
    await c.userEvent.click(await screen.findByRole('button', { name: 'Message Priya privately' }, SOON));
    await screen.findByText(`Only you and ${PRIYA.name} can read this.`, {}, SOON);
  });
} });
export const FromTheirRowInPeoplePhone = phone(FromTheirRowInPeople);
/** From a message of theirs: the lock on the bar over it. */
export const FromTheirMessage = inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script: { here: [{ who: PRIYA }, { who: KOFI }], cues: at(.5, chats(PRIYA, 'I can take the pricing question.')) } }, { play: async (c) => {
  await reach('Chat')(c);
  await c.step('The bar over Priya’s message: the lock opens a conversation with her alone', async () => {
    const [lock] = await screen.findAllByRole('button', { name: 'Message Priya privately' }, SOON);
    lock?.focus();
    await c.userEvent.keyboard('{Enter}');
    await screen.findByText(`Only you and ${PRIYA.name} can read this.`, {}, SOON);
  });
} });
