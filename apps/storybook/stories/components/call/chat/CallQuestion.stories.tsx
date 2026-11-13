/*
 * A question for the room, in Chat's Questions: votes in their own column, named Vote or Voted, the words, and who asked or
 * that nobody's told. Its ⋯ says in words what else can be done: whoever hosts pins it, marks it answered, dismisses it, or
 * reopens one answered or dismissed; whoever asked takes it back.
 */
import { CallQuestion } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { Box, did } from '../../../../src/component';
import { KOFI, PRIYA } from '../../../../src/world/people';

const host = { onPin: did('pin'), onAnswer: did('mark answered'), onDismiss: did('dismiss'), onReopen: did('reopen') };
const meta = {
  title: 'Components/In a call/Chat/CallQuestion', component: CallQuestion,
  args: { id: 'question-demo', text: 'Which teams are included in the first launch?', author: PRIYA, own: false, time: '14:22', votes: 4, voted: false, status: 'open', pinned: false, busy: false, onVote: did('vote') },
  render: (args) => <Box width="min(360px, 100%)" height="auto"><div className="ch-qs"><CallQuestion {...args} /></div></Box>
} satisfies Meta<typeof CallQuestion>;
export default meta;
type Story = StoryObj<typeof meta>;
/** Its ⋯, open: what can be done to it, in words. */
const more: Story['play'] = async ({ userEvent }) => { await userEvent.click(await screen.findByRole('button', { name: 'More for this question' })); };

/** For everyone: the vote, and nothing else. */
export const Asked: Story = {};
export const Voted: Story = { args: { voted: true, votes: 5 } };
/** Nobody is told who asked, whoever hosts included. */
export const Anonymous: Story = { args: { author: null, text: 'Can the status page go out before the announcement?', votes: 2, time: '14:25' } };
/** Yours, asked anonymously: only you are told, and you can take it back, from its ⋯. */
export const YoursAnonymously: Story = { args: { author: null, own: true, text: 'Can the status page go out before the announcement?', votes: 2, onWithdraw: did('take back') } };
export const YoursAnonymouslyMenu: Story = { ...YoursAnonymously, name: 'Yours anonymously, its ⋯ open', play: more };
/** Whoever hosts: the vote and a ⋯, with Pin to the top, Mark answered and Dismiss in words. */
export const ForWhoeverHosts: Story = { args: { host } };
export const ForWhoeverHostsMenu: Story = { ...ForWhoeverHosts, name: 'For whoever hosts, its ⋯ open', play: more };
/** Whoever hosts asked it too: taking it back, which deletes it for everyone, stands apart from what hosting does. */
export const ForAHostWhoAskedIt: Story = { args: { host, own: true, author: KOFI, onWithdraw: did('take back') }, play: more };
export const PinnedByWhoeverHosts: Story = { args: { host, pinned: true } };
export const Answered: Story = { args: { status: 'answered', author: KOFI } };
/** Answered or dismissed by mistake: whoever hosts reopens it, from its ⋯ under Show answered. */
export const AnsweredForWhoeverHosts: Story = { args: { status: 'answered', author: KOFI, host }, play: more };
export const Dismissed: Story = { args: { status: 'dismissed' } };
export const Saving: Story = { args: { busy: true, host } };
export const LongQuestion: Story = { args: { host, text: 'Could we walk through how the rollout reaches each team, who follows up on their questions, and what happens if the first group needs more time before we expand?' } };
