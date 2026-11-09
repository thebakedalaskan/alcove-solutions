/*
 * The room's questions, a tab in Chat: the most voted first, by name or anonymously, with Most votes and Newest as a quiet
 * choice. Whoever hosts pins one, marks it answered or dismisses it; whoever asked can take theirs back. An anonymous
 * question never says who asked, to anyone, whoever hosts included.
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { asks, at, type CallScript } from '../../src/api/script';
import { inCall, light, phone, reach } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { SOON, openQuestions } from './plays';
import { AIKO, CHECK_IN, KOFI, LAUNCH_REVIEW, PRIYA } from './talk';

const meta = { title: 'Calls/Chat questions', ...pages } satisfies Meta<PageArgs>;
export default meta;
type Context = Parameters<NonNullable<PageStory['play']>>[0];
const script: CallScript = {
  here: [{ who: PRIYA }, { who: KOFI }, { who: AIKO }],
  cues: at(.2,
    asks(PRIYA, 'Which teams are included in the first launch?', { votes: 4 }),
    asks(KOFI, 'Can the status page go out before the announcement?', { votes: 2, anonymous: true }),
    asks(AIKO, 'Who answers support tickets in the first week?', { votes: 1 }))
};
const questions = async (c: Context) => { await reach('Chat')(c); await openQuestions(c); await screen.findByText('Which teams are included in the first launch?', {}, SOON); };

/** Whoever hosts: each question with its votes, and pin, mark answered and dismiss beside who asked. */
export const ForWhoeverHosts = inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script }, { play: questions });
export const ForWhoeverHostsLight = light(ForWhoeverHosts);
export const ForWhoeverHostsPhone = phone(ForWhoeverHosts);
/** Someone else in the call: they vote, and only whoever hosts moderates. */
export const ForEveryoneElse = inCall({ scenario: 'busy', call: CHECK_IN, script }, { play: async (c) => {
  await questions(c);
  const [vote] = await screen.findAllByRole('button', { name: /^Vote for this question/ }, SOON);
  if (vote) await c.userEvent.click(vote);
} });
export const ForEveryoneElsePhone = phone(ForEveryoneElse);
/** Pinned, it leads the list for everyone in the room. */
export const Pinned = inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script }, { play: async (c) => {
  await questions(c);
  const pins = await screen.findAllByRole('button', { name: 'Pin question' }, SOON);
  const last = pins.at(-1);
  if (last) await c.userEvent.click(last);
} });
/** Answered and dismissed questions leave the list, and Show answered brings them back, marked. */
export const ShowAnswered = inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script }, { play: async (c) => {
  await questions(c);
  const [answer] = await screen.findAllByRole('button', { name: 'Mark question answered' }, SOON);
  if (answer) await c.userEvent.click(answer);
  await c.userEvent.click(await screen.findByRole('button', { name: /^Show answered/ }, SOON));
} });
/** Asking anonymously: nobody is told it's yours, and only you see that it is, with Take back. */
export const AskAnonymously = inCall({ scenario: 'busy', call: CHECK_IN, script }, { play: async (c) => {
  await questions(c);
  await c.userEvent.type(await screen.findByRole('textbox', { name: 'Ask everyone in this room a question' }, SOON), 'Is the launch date fixed yet?');
  await c.userEvent.click(await screen.findByRole('switch', { name: 'Ask anonymously' }));
  await c.userEvent.click(await screen.findByRole('button', { name: 'Ask anonymously' }));
  await screen.findByText('Is the launch date fixed yet?', {}, SOON);
} });
export const AskAnonymouslyLight = light(AskAnonymously);
export const AskAnonymouslyPhone = phone(AskAnonymously);
/** Nothing asked yet. */
export const NoQuestions = inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script: { here: [{ who: PRIYA }, { who: KOFI }] } }, { play: async (c) => { await reach('Chat')(c); await openQuestions(c); } });
