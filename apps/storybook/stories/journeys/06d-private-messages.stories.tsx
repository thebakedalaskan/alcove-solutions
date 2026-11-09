import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { inCall, phone, reach } from '../../src/call';
import { pages, type PageArgs } from '../../src/page';
import { choosePrivateAudience as chooseAudience } from '../calls/plays';
import { KOFI, LAUNCH_REVIEW, PRIYA } from '../calls/talk';

const meta = { title: 'Journeys/6d Private messages', ...pages } satisfies Meta<PageArgs>;
export default meta;
export const KeepEveryAudienceSeparate = inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script: { here: [{ who: PRIYA }, { who: KOFI }] } }, { play: async (c) => {
  await reach('Chat')(c);
  await c.step('Keep a draft for the room', async () => { await c.userEvent.type(await screen.findByRole('combobox', { name: 'Message everyone' }), 'The agenda is ready.'); });
  await c.step('Choose Priya explicitly and write only to her', async () => {
    await chooseAudience(c, new RegExp(`^${PRIYA.name} · Private`));
    await c.userEvent.type(await screen.findByRole('textbox', { name: `Message only ${PRIYA.name}` }), 'Two minutes left.');
  });
  await c.step('Kofi has a different draft and recipient', async () => {
    await chooseAudience(c, new RegExp(`^${KOFI.name} · Private`));
    await c.userEvent.type(await screen.findByRole('textbox', { name: `Message only ${KOFI.name}` }), 'Could you take the next question?');
  });
  await c.step('Return to Priya’s draft, with its private audience still beside Send', async () => {
    await chooseAudience(c, new RegExp(`^${PRIYA.name} · Private`));
    await c.userEvent.click(await screen.findByRole('button', { name: `Send only to ${PRIYA.name}` }));
    await screen.findByText('Delivered');
  });
  await c.step('Return to the room draft without sending a private message publicly', async () => { await chooseAudience(c, 'Room chat'); });
} });
export const KeepEveryAudienceSeparatePhone = phone(KeepEveryAudienceSeparate);
