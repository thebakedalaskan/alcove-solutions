import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { light, phone } from '../../src/call';
import { pages, type PageArgs } from '../../src/page';
import { OpenThread, FailedReply } from '../calls/ChatThreads.stories';
import { choosePrivateAudience } from '../calls/plays';
import { PRIYA } from '../calls/talk';

const meta = { title: 'Journeys/6e Chat threads', ...pages } satisfies Meta<PageArgs>;
export default meta;
export const KeepDiscussionTogether = { ...OpenThread, name: '6.31 Keep a discussion and its drafts together', play: async (c: Parameters<NonNullable<typeof OpenThread.play>>[0]) => {
  await OpenThread.play?.(c);
  await c.step('Keep a draft in the thread', async () => {
    await c.userEvent.type(await screen.findByRole('combobox', { name: 'Message this thread in the main room' }), 'The status page can ship with the release.');
  });
  await c.step('Keep a separate draft in room chat', async () => {
    await c.userEvent.click(await screen.findByRole('button', { name: 'Back to chat' }));
    await c.userEvent.type(await screen.findByRole('combobox', { name: 'Message everyone' }), 'The agenda is ready.');
  });
  await c.step('Return to the thread and send only its draft', async () => {
    await c.userEvent.click(await screen.findByRole('button', { name: /^2 replies/ }));
    await c.userEvent.click(await screen.findByRole('button', { name: 'Send to this thread in the main room' }));
    await screen.findByText('The status page can ship with the release.');
  });
  await c.step('Choose a private audience with its own draft', async () => {
    await choosePrivateAudience(c, new RegExp(`^${PRIYA.name} · Private`));
    await c.userEvent.type(await screen.findByRole('combobox', { name: `Message only ${PRIYA.name}` }), 'Could you introduce the next section?');
  });
  await c.step('Return to room chat without moving a private draft', async () => {
    await choosePrivateAudience(c, 'Room chat');
    await c.userEvent.click(await screen.findByRole('button', { name: 'Back to chat' }));
    await screen.findByRole('combobox', { name: 'Message everyone' });
  });
} };
export const KeepDiscussionTogetherLight = light(KeepDiscussionTogether);
export const KeepDiscussionTogetherPhone = phone(KeepDiscussionTogether);
export const RetryInTheSameThread = { ...FailedReply, name: '6.31 Retry a reply in its original thread', play: async (c: Parameters<NonNullable<typeof FailedReply.play>>[0]) => {
  await FailedReply.play?.(c);
  await c.step('Retry the original reply without posting to room chat', async () => {
    await c.userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  });
} };
