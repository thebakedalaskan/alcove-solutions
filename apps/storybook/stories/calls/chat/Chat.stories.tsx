/*
 * Chat in a call, as Slack shows a channel: Everyone, with a run from one person under one name, reactions as pills, a
 * thread's line with the faces of who replied, a mention, and the bar that comes over a message. On a phone a ⋯ (or
 * pressing and holding a message) opens the same as a sheet.
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { at, chats, reacts, replies, type CallScript } from '../../../src/api/call/script';
import { inCall, light, phone, reach } from '../../../src/call';
import { pages, type PageArgs, type PageStory } from '../../../src/page';
import { SOON } from '../plays';
import { AIKO, DIEGO, KOFI, LAUNCH_REVIEW, MAYA, PRIYA } from '../talk';

const meta = { title: 'Calls/Chat/Messages', ...pages } satisfies Meta<PageArgs>;
export default meta;
type Context = Parameters<NonNullable<PageStory['play']>>[0];
const ASK = 'Can someone drop last month’s sign-ups here?';
const SALES = 'Sales can announce it the week of the 18th.';
const script: CallScript = {
  here: [{ who: MAYA }, { who: KOFI }, { who: PRIYA }, { who: DIEGO }, { who: AIKO }], notes: 'off',
  cues: [
    ...at(.2, chats(MAYA, ASK)),
    ...at(.4, replies(KOFI, ASK, 'Sign-ups by week, from the dashboard.'), replies(PRIYA, ASK, 'Up 18% since the pricing change.')),
    ...at(.6, chats(DIEGO, SALES), chats(DIEGO, 'And support gets the FAQ on the 16th.')),
    ...at(.8, reacts(KOFI, SALES, 'thumbs-up'), reacts(PRIYA, SALES, 'thumbs-up'), reacts(AIKO, SALES, 'party')),
    ...at(1, chats(AIKO, `Works for me @${DIEGO.name}, I’ll tell finance.`, [DIEGO]))
  ]
};
const everyone = async (c: Context) => { await reach('Chat')(c); await screen.findByText('Works for me', { exact: false }, SOON); };

/** Everyone: Diego's two messages sit under one name, with their reactions; Maya's has a thread of two replies. */
export const Everyone = inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script }, { play: everyone });
export const EveryoneLight = light(Everyone);
export const EveryonePhone = phone(Everyone);
/** The bar over a message, reached with the keyboard: three reactions, the rest, Reply in thread and Message privately. */
export const TheBarOverAMessage = inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script }, { play: async (c) => {
  await everyone(c);
  const [react] = await screen.findAllByRole('button', { name: 'React with heart' }, SOON);
  react?.focus();
} });
export const TheBarOverAMessageLight = light(TheBarOverAMessage);
/** On a phone, a message's ⋯ opens all eight reactions, Reply in thread and Message privately as a sheet. */
export const OnAPhone = phone(inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script }, { play: async (c) => {
  await everyone(c);
  const [more] = await screen.findAllByRole('button', { name: /^More for Diego/ }, SOON);
  if (more) await c.userEvent.click(more);
} }));
