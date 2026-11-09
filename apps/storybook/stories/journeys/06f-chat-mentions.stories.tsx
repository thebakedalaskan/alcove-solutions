import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { light, phone } from '../../src/call';
import { pages, type PageArgs } from '../../src/page';
import { PrivateMentionAlert, SelectedPrivateMention } from '../calls/ChatMentions.stories';
import { choosePrivateAudience } from '../calls/plays';
import { PRIYA } from '../calls/talk';

const meta = { title: 'Journeys/6f Chat mentions', ...pages } satisfies Meta<PageArgs>;
export default meta;
export const SelectWithoutMovingTheAudience = { ...SelectedPrivateMention, name: '6.32 Keep a selected mention in its original private draft', play: async (c: Parameters<NonNullable<typeof SelectedPrivateMention.play>>[0]) => {
  await SelectedPrivateMention.play?.(c);
  await c.step('Keep the room draft separate from the tagged private draft', async () => {
    await choosePrivateAudience(c, 'Room chat'); await c.userEvent.type(await screen.findByRole('combobox', { name: 'Message everyone' }), 'The agenda is ready.');
  });
  await c.step('Return to the original selected recipient and send only that draft', async () => {
    await choosePrivateAudience(c, new RegExp(`^${PRIYA.name} · Private`)); await c.userEvent.click(await screen.findByRole('button', { name: `Send only to ${PRIYA.name}` })); await screen.findByText('Delivered');
  });
} };
export const SelectWithoutMovingTheAudienceLight = light(SelectWithoutMovingTheAudience);
export const SelectWithoutMovingTheAudiencePhone = phone(SelectWithoutMovingTheAudience);
export const OpenTheExactPrivateThread = { ...PrivateMentionAlert, name: '6.32 Open a private mention at its exact thread and addressed words', play: async (c: Parameters<NonNullable<typeof PrivateMentionAlert.play>>[0]) => {
  await PrivateMentionAlert.play?.(c);
  await c.step('Open the generic alert without revealing a private preview', async () => { await c.userEvent.click(await screen.findByRole('button', { name: 'Open mention' })); await screen.findByText('@Art Vandelay', { selector: 'mark' }); });
} };
export const OpenTheExactPrivateThreadPhone = phone(OpenTheExactPrivateThread);
