/*
 * Private conversations in Chat: a tab each, with a lock and a dot when something's new, and "Only you and Priya can read
 * this." at the top. + starts one with someone here; so do Message privately on their tile, their row in People and a
 * message of theirs.
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { at, leaves, reactsPrivately } from '../../src/api/script';
import { inCall, light, phone, reach } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { CHECK_IN, KOFI, LAUNCH_REVIEW, PRIYA } from './talk';
import { SOON, talkPrivately } from './plays';

const meta = { title: 'Calls/Private messages', ...pages } satisfies Meta<PageArgs>;
export default meta;
type Context = Parameters<NonNullable<PageStory['play']>>[0];
const privateChat = async (c: Context) => { await reach('Chat')(c); await talkPrivately(c, PRIYA); };
const review = (more: Omit<PageStory, 'args'> = {}, fails = false) => inCall({ scenario: 'busy', call: LAUNCH_REVIEW,
  script: { here: [{ who: PRIYA }, { who: KOFI }], privateSendFails: fails,
    privateMessages: [{ from: PRIYA, text: 'Could you keep an eye on the time?', after: 2 }] }
}, { play: privateChat, ...more });

export const Conversation = review();
export const ConversationLight = light(Conversation);
export const ConversationPhone = phone(Conversation);
/** + beside the tabs: find someone in the call, and their conversation opens as its own tab. */
export const ChoosingSomeone = review({ play: async (c) => { await reach('Chat')(c); await c.userEvent.click(await screen.findByRole('button', { name: 'Message someone privately' }, SOON)); } });
export const ChoosingSomeonePhone = phone(ChoosingSomeone);
/** Something new in Priya's conversation while you read Everyone: a dot on her tab. */
export const NewInAnotherTab = review({ play: async (c) => { await reach('Chat')(c); await screen.findByRole('tab', { name: /^Priya Raman, private, 1 new/ }, SOON); } });
export const UnreadWithoutOpening = review({ play: async () => { await screen.findByRole('button', { name: /^Chat, 1 new$/ }, { timeout: 10000 }); } });
/** Reactions on private messages: only the two of you see them. */
export const Reactions = inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script: {
  here: [{ who: PRIYA }, { who: KOFI }], privateMessages: [{ from: PRIYA, text: 'Could you keep an eye on the time?', after: 1 }],
  cues: at(2.5, reactsPrivately(PRIYA, 'Could you keep an eye on the time?', 'heart'))
} }, { play: async (c) => {
  await privateChat(c);
  // The bar over a message comes with the pointer or with the keyboard: here, from the keyboard.
  const [react] = await screen.findAllByRole('button', { name: 'React with thumbs up' }, SOON);
  react?.focus();
  await c.userEvent.keyboard('{Enter}');
} });
export const ReactionsLight = light(Reactions);
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
