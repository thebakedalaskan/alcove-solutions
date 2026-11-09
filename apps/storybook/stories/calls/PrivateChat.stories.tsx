import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { at, leaves } from '../../src/api/script';
import { inCall, light, phone, reach } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { CHECK_IN, KOFI, LAUNCH_REVIEW, PRIYA } from './talk';
import { choosePrivateAudience } from './plays';

const meta = { title: 'Calls/Private messages', ...pages } satisfies Meta<PageArgs>;
export default meta;
type Context = Parameters<NonNullable<PageStory['play']>>[0];
const privateChat = async (c: Context) => {
  await reach('Chat')(c);
  await choosePrivateAudience(c, new RegExp(`^${PRIYA.name} · Private`));
};
const review = (more: Omit<PageStory, 'args'> = {}, fails = false) => inCall({ scenario: 'busy', call: LAUNCH_REVIEW,
  script: { here: [{ who: PRIYA }, { who: KOFI }], privateSendFails: fails,
    privateMessages: [{ from: PRIYA, text: 'Could you keep an eye on the time?', after: 2 }] }
}, { play: privateChat, ...more });

export const Conversation = review();
export const ConversationLight = light(Conversation);
export const ConversationPhone = phone(Conversation);
export const ChoosingSomeone = review({ play: async (c) => { await reach('Chat')(c); await c.userEvent.click(await screen.findByRole('button', { name: /^Chat audience:/ })); } });
export const ChoosingSomeonePhone = phone(ChoosingSomeone);
export const UnreadWithoutOpening = review({ play: async () => { await screen.findByRole('button', { name: /^Chat, 1 new$/ }, { timeout: 10000 }); } });
export const FailedAndRetry = review({ play: async (c) => {
  await privateChat(c);
  await c.userEvent.type(await screen.findByRole('combobox', { name: `Message only ${PRIYA.name}` }), 'Two minutes left for your section.');
  await c.userEvent.click(await screen.findByRole('button', { name: `Send only to ${PRIYA.name}` }));
  await screen.findByRole('button', { name: 'Retry privately' });
} }, true);
export const FailedAndRetryLight = light(FailedAndRetry);
export const FailedAndRetryPhone = phone(FailedAndRetry);
export const RecipientLeaves = inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script: {
  here: [{ who: PRIYA }, { who: KOFI }], privateMessages: [{ from: PRIYA, text: 'I need to step away for a moment.', after: 1 }], cues: at(8, leaves(PRIYA))
} }, { play: async (c) => { await privateChat(c); await c.userEvent.type(await screen.findByRole('combobox', { name: `Message only ${PRIYA.name}` }), 'Kept only for this conversation.'); await screen.findByText('Unavailable in this room. Your draft stays here.', {}, { timeout: 15000 }); } });
export const RecipientLeavesPhone = phone(RecipientLeaves);
export const Guest = inCall({ scenario: 'signed-out', call: CHECK_IN, script: {
  here: [{ who: PRIYA, organizer: true }, { who: KOFI }], cues: at(.1, { do: 'let-in' }),
  privateMessages: [{ from: PRIYA, text: 'Welcome. You can ask me privately here.', after: 2 }]
} }, { play: privateChat });
export const GuestPhone = phone(Guest);
