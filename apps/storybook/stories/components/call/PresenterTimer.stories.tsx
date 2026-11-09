import { CallTimerButton, CallTimerReadout } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, Stack, did, onStage } from '../../../src/component';

const meta = {
  title: 'Components/In a call/Presenter timer', component: CallTimerReadout,
  args: { time: '3:42', label: 'Walk through the proposal', status: 'Running', tone: 'running', presenter: 'Priya Raman', next: 'Questions and next steps', planned: '10:00', position: 'Segment 2 of 3' },
  render: (args) => <Box width="min(360px, 100%)" height="auto"><CallTimerReadout {...args} /></Box>
} satisfies Meta<typeof CallTimerReadout>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Running: Story = {};
export const Ready: Story = { args: { time: '5:00', status: 'Ready', tone: 'ready' } };
export const Paused: Story = { args: { status: 'Paused', tone: 'paused' } };
export const Warning: Story = { args: { time: '0:24', status: '30 seconds or less left', tone: 'warning' } };
export const TimeIsUp: Story = { args: { time: '+0:00', status: 'Time is up · over time', tone: 'overtime' } };
export const OverTime: Story = { args: { time: '+1:08', status: 'Time is up · over time', tone: 'overtime' } };
export const Finished: Story = { args: { time: 'Done', status: 'Sequence finished', tone: 'finished', position: '3 segments complete', next: null } };
export const LongNames: Story = { args: { label: 'A longer walkthrough of the plan for launching the first group and preparing the rest of the team', presenter: 'Someone with a particularly long name', next: 'Questions, discussion, and agreement on the next steps for every team' } };
export const Compact: Story = { ...onStage, render: () => <Stack><CallTimerButton time="3:42" label="Proposal" status="Running" tone="running" on={false} onClick={did('timer')} /><CallTimerButton time="0:24" label="Proposal" status="30 seconds or less left" tone="warning" on={false} compact onClick={did('timer')} /><CallTimerButton time="+1:08" label="Proposal" status="Over time" tone="overtime" on={false} onClick={did('timer')} /></Stack> };
