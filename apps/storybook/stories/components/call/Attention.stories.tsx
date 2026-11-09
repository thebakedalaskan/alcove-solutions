import { AttentionButton, AttentionHand, AttentionQuestion, AttentionSection, CallSignal, CallSignalChoices } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Box, Stack, did, onStage } from '../../../src/component';
import { AIKO, KOFI, PRIYA } from '../../../src/world/people';

const meta = {
  title: 'Components/In a call/Attention', component: AttentionQuestion,
  args: { author: PRIYA, text: 'Which teams are included in the first launch?', votes: 4, voted: false, status: 'open', pinned: false, busy: false, onVote: did('vote'), actions: { pin: did('pin'), answer: did('answer'), dismiss: did('dismiss') } },
  render: (args) => <Box width="min(360px, 100%)" height="auto"><AttentionQuestion {...args} /></Box>
} satisfies Meta<typeof AttentionQuestion>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Question: Story = {};
export const Voted: Story = { args: { voted: true } };
export const Pinned: Story = { args: { pinned: true } };
export const Answered: Story = { args: { status: 'answered' } };
export const Dismissed: Story = { args: { status: 'dismissed' } };
export const Saving: Story = { args: { busy: true } };
export const LongQuestion: Story = { args: { text: 'Could we walk through how the rollout reaches each team, who follows up on their questions, and what happens if the first group needs more time before we expand?' } };
export const Hands: Story = { render: () => <Box width="min(360px, 100%)" height="auto"><AttentionSection title="In order raised"><ol className="ic-attention-hands">{[PRIYA, KOFI, AIKO].map((person, i) => <AttentionHand key={person.email} person={person} number={i + 1} detail="Waiting for a turn" lower={{ label: 'Lower', onClick: did('lower hand') }} busy={false} />)}</ol></AttentionSection></Box> };
export const PersistentCounts: Story = { ...onStage, render: () => <Stack><AttentionButton hands={3} questions={5} waiting={2} on={false} onClick={did('attention')} /><AttentionButton hands={3} questions={5} waiting={2} on={false} onClick={did('attention')} compact /></Stack> };
function SignalsDemo() {
  const [selected, setSelected] = useState<string | null>(null);
  return <Box width="min(340px, 100%)" height="auto"><CallSignalChoices choices={[{ value: 'cant-hear', label: 'Can’t hear you', icon: 'hear' }, { value: 'slow-down', label: 'Slow down', icon: 'pace' }, { value: 'yes', label: 'Yes', icon: 'check' }, { value: 'no', label: 'No', icon: 'x' }, { value: 'need-break', label: 'Need a break', icon: 'away' }]} selected={selected} busy={false} onChange={setSelected} /><CallSignal label="Slow down" icon="pace" count={3} /></Box>;
}
export const Signals: Story = { render: () => <SignalsDemo /> };
