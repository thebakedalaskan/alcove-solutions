/*
 * The room's questions, a tab in Chat: the most voted first, by name or anonymously, with Most votes and Newest as a quiet
 * choice. The order chosen holds whenever the pointer is away from the list: rows glide to their places as votes come in, and
 * hold still while someone points at them, or on a phone touches them and a moment after, the bar offering to sort. Each vote says Vote or Voted; whoever hosts pins one, marks
 * it answered, dismisses it or reopens it from its ⋯, and whoever asked takes theirs back. An anonymous question never says who
 * asked, to anyone, whoever hosts included.
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { asks, at, votesFor, type CallScript } from '../../../src/api/call/script';
import { inCall, light, phone, reach } from '../../../src/call';
import { pages, type PageArgs, type PageStory } from '../../../src/page';
import { SOON, openQuestions } from '../plays';
import { AIKO, CHECK_IN, KOFI, LAUNCH_REVIEW, PRIYA } from '../talk';

const meta = { title: 'Calls/Chat/Questions', ...pages } satisfies Meta<PageArgs>;
export default meta;
type Context = Parameters<NonNullable<PageStory['play']>>[0];
const TEAMS = 'Which teams are included in the first launch?';
const STATUS = 'Can the status page go out before the announcement?';
const SUPPORT = 'Who answers support tickets in the first week?';
const script: CallScript = {
  here: [{ who: PRIYA }, { who: KOFI }, { who: AIKO }],
  cues: at(.2,
    asks(PRIYA, TEAMS, { votes: 4 }),
    asks(KOFI, STATUS, { votes: 2, anonymous: true }),
    asks(AIKO, SUPPORT, { votes: 1 }))
};
const questions = async (c: Context) => { await reach('Chat')(c); await openQuestions(c); await screen.findByText(TEAMS, {}, SOON); };
/** The ⋯ of the question with these words. */
const moreFor = async (c: Context, text: string) => {
  const question = (await screen.findByText(text, {}, SOON)).closest('article');
  const more = question?.querySelector<HTMLButtonElement>('button[aria-label="More for this question"]');
  if (more) await c.userEvent.click(more);
};
const choose = async (c: Context, item: string) => { await c.userEvent.click(await screen.findByRole('button', { name: item }, SOON)); };

/** Whoever hosts: each question with its votes, and a ⋯ beside who asked. */
export const ForWhoeverHosts = inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script }, { play: questions });
export const ForWhoeverHostsLight = light(ForWhoeverHosts);
export const ForWhoeverHostsPhone = phone(ForWhoeverHosts);
/** Whoever hosts, a question's ⋯ open: Pin to the top, Mark answered and Dismiss, in words. */
export const HostMenu = inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script }, { name: 'For whoever hosts, a question’s ⋯ open', play: async (c) => { await questions(c); await moreFor(c, STATUS); } });
export const HostMenuLight = light(HostMenu);
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
  await moreFor(c, SUPPORT);
  await choose(c, 'Pin to the top');
} });
/** Answered and dismissed questions leave the list, the toast offering Undo, and Show answered brings them back, marked. */
export const ShowAnswered = inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script }, { play: async (c) => {
  await questions(c);
  await moreFor(c, TEAMS);
  await choose(c, 'Mark answered');
  await c.userEvent.click(await screen.findByRole('button', { name: /^Show answered/ }, SOON));
} });
/** Marked answered by mistake: whoever hosts reopens it from its ⋯ under Show answered, as from the toast's Undo. */
export const Reopening = inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script }, { name: 'Reopening an answered question', play: async (c) => {
  await questions(c);
  await moreFor(c, TEAMS);
  await choose(c, 'Mark answered');
  await c.userEvent.click(await screen.findByRole('button', { name: /^Show answered/ }, SOON));
  await moreFor(c, TEAMS);
} });
/** Asking anonymously: nobody is told it's yours, and only you see that it is, with Take back in its ⋯. */
export const AskAnonymously = inCall({ scenario: 'busy', call: CHECK_IN, script }, { play: async (c) => {
  await questions(c);
  await c.userEvent.type(await screen.findByRole('textbox', { name: 'Ask everyone in this room a question' }, SOON), 'Is the launch date fixed yet?');
  await c.userEvent.click(await screen.findByRole('switch', { name: 'Ask anonymously' }));
  await c.userEvent.click(await screen.findByRole('button', { name: 'Ask anonymously' }));
  await screen.findByText('Is the launch date fixed yet?', {}, SOON);
} });
export const AskAnonymouslyLight = light(AskAnonymously);
export const AskAnonymouslyPhone = phone(AskAnonymously);

/*
 * The order: Aiko's question gathers votes three and five seconds in. Away from the list, it glides up past Kofi's, then
 * Priya's; pointed at, nothing moves, Most votes no longer looks chosen, and Sort by votes says what pressing it does.
 */
const voting: CallScript = { ...script, cues: [...(script.cues ?? []), ...at(3, votesFor(SUPPORT, 2)), ...at(5, votesFor(SUPPORT, 2))] };
export const VotesArriving = inCall({ scenario: 'busy', call: CHECK_IN, script: voting }, { name: 'Votes arriving, sorted as they come', play: async (c) => {
  await questions(c);
  await screen.findByRole('button', { name: 'Vote for this question, 5 votes' }, { timeout: 12000 });
} });
export const VotesArrivingWhilePointing = inCall({ scenario: 'busy', call: CHECK_IN, script: voting }, { name: 'Votes arriving while pointing at the list', play: async (c) => {
  await questions(c);
  await c.userEvent.hover((await screen.findByText(TEAMS, {}, SOON)).closest('article') ?? document.body);
  await screen.findByRole('button', { name: 'Sort by votes' }, { timeout: 12000 });
} });
/** Your vote moves the question you voted for once you move on, here to ask one of your own: Kofi's climbs past Aiko's. */
const close: CallScript = { here: script.here, cues: at(.2, asks(PRIYA, TEAMS, { votes: 3 }), asks(KOFI, STATUS, { votes: 2 }), asks(AIKO, SUPPORT, { votes: 2 })) };
export const YourVote = inCall({ scenario: 'busy', call: CHECK_IN, script: close }, { name: 'Your vote, sorted once you move on', play: async (c) => {
  await questions(c);
  const twos = await screen.findAllByRole('button', { name: 'Vote for this question, 2 votes' }, SOON);
  const last = twos.at(-1);
  if (last) await c.userEvent.click(last);
  await c.userEvent.click(await screen.findByRole('textbox', { name: 'Ask everyone in this room a question' }, SOON));
} });
/**
 * On a phone a tap leaves nothing pointing at the list, so the order holds while a finger is on it and for a couple of seconds
 * after the last touch or scroll: the question you voted for doesn't move from under a second tap. Here your thumb is back on
 * the list as your vote lands, so it stays where it was, and the bar offers Sort by votes.
 */
export const YourVoteOnAPhone = phone(inCall({ scenario: 'busy', call: CHECK_IN, script: close }, { play: async (c) => {
  await questions(c);
  const twos = await screen.findAllByRole('button', { name: 'Vote for this question, 2 votes' }, SOON);
  const last = twos.at(-1);
  if (!last) return;
  await c.userEvent.pointer({ keys: '[TouchA]', target: last });
  await screen.findByRole('button', { name: 'Take back your vote, 3 votes' }, SOON);
  await c.userEvent.pointer({ keys: '[TouchA>]', target: last.closest('article') ?? last });
  await screen.findByRole('button', { name: 'Sort by votes' }, SOON);
} }), 'Your vote on a phone, held while you touch the list');
/** Newest: a question asked while you read comes in at the top, once you've moved on from the list (here, to ask one). */
export const NewestFirst = inCall({ scenario: 'busy', call: CHECK_IN, script: { ...script, cues: [...(script.cues ?? []), ...at(4, asks(PRIYA, 'Do we need a second rollout window?'))] } }, { name: 'Newest, with a question just asked', play: async (c) => {
  await questions(c);
  await c.userEvent.click(await screen.findByRole('button', { name: 'Newest' }, SOON));
  await c.userEvent.click(await screen.findByRole('textbox', { name: 'Ask everyone in this room a question' }, SOON));
  await screen.findByText('Do we need a second rollout window?', {}, { timeout: 12000 });
} });
/** Nothing asked yet. */
export const NoQuestions = inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script: { here: [{ who: PRIYA }, { who: KOFI }] } }, { play: async (c) => { await reach('Chat')(c); await openQuestions(c); } });
