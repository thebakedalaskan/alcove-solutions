/*
 * A question for the room, in Chat's Questions: votes in their own column, the words, and who asked or that nobody's told.
 * Whoever hosts pins it, marks it answered or dismisses it; whoever asked takes it back.
 */
import { CallQuestion } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, did } from '../../../src/component';
import { KOFI, PRIYA } from '../../../src/world/people';

const host = { onPin: did('pin'), onAnswer: did('mark answered'), onDismiss: did('dismiss') };
const meta = {
  title: 'Components/In a call/CallQuestion', component: CallQuestion,
  args: { id: 'question-demo', text: 'Which teams are included in the first launch?', author: PRIYA, own: false, time: '14:22', votes: 4, voted: false, status: 'open', pinned: false, busy: false, onVote: did('vote') },
  render: (args) => <Box width="min(360px, 100%)" height="auto"><div className="ch-qs"><CallQuestion {...args} /></div></Box>
} satisfies Meta<typeof CallQuestion>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Asked: Story = {};
export const Voted: Story = { args: { voted: true, votes: 5 } };
/** Nobody is told who asked, whoever hosts included. */
export const Anonymous: Story = { args: { author: null, text: 'Can the status page go out before the announcement?', votes: 2, time: '14:25' } };
/** Yours, asked anonymously: only you are told, and you can take it back. */
export const YoursAnonymously: Story = { args: { author: null, own: true, text: 'Can the status page go out before the announcement?', votes: 2, onWithdraw: did('take back') } };
export const ForWhoeverHosts: Story = { args: { host } };
export const PinnedByWhoeverHosts: Story = { args: { host, pinned: true } };
export const Answered: Story = { args: { status: 'answered', author: KOFI } };
export const Dismissed: Story = { args: { status: 'dismissed' } };
export const Saving: Story = { args: { busy: true, host } };
export const LongQuestion: Story = { args: { host, text: 'Could we walk through how the rollout reaches each team, who follows up on their questions, and what happens if the first group needs more time before we expand?' } };
