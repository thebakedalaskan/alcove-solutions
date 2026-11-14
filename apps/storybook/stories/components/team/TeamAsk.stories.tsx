/*
 * TeamAsk: something that can't be undone, asked in place on the Team page: taking someone off the team (under their row),
 * leaving it, or deleting it (in place of the foot). What it means is said once (and read with it), the answer that loses
 * nothing is the filled one and takes the focus, and Escape answers it too. It comes into view as it opens, clear of a
 * phone's tab bar, where its answers stand one over the other, the one that loses nothing first.
 */
import { TeamAsk } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { onTheWater } from './parts';

const meta = {
  title: 'Components/Team/TeamAsk',
  component: TeamAsk,
  decorators: [onTheWater()],
  parameters: { layout: 'fullscreen' },
  args: {
    title: 'Remove Maya?', text: 'They leave the team, and its invite link changes, so share the new one with anyone still to join. Their license isn’t refunded.',
    confirm: 'Remove Maya', keep: 'Keep Maya', onConfirm: did('onConfirm'), onKeep: did('onKeep')
  },
  argTypes: { title: { control: 'text' }, text: { control: 'text' }, confirm: { control: 'text' }, keep: { control: 'text' }, busy: { control: 'boolean' }, onConfirm: { control: false }, onKeep: { control: false }, className: { control: false } }
} satisfies Meta<typeof TeamAsk>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Taking someone off the team, as its admin: its invite link changes. */
export const TakeSomeoneOff: Story = { name: 'Take someone off' };
/** On a phone: the answers one over the other, the full width, the one that loses nothing first. */
export const TakeSomeoneOffPhone: Story = { ...TakeSomeoneOff, name: 'Take someone off, phone', globals: { viewport: { value: 'phone' } } };
/** Leaving the team, as a member. */
export const Leave: Story = {
  args: { title: 'Leave Vandelay Industries?', text: 'Your license isn’t refunded. You go back to Free, and notes you made visible to the team stay visible.', confirm: 'Leave the team', keep: 'Stay' }
};
/** Deleting the team, once nobody else is on it. */
export const Delete: Story = {
  args: { title: 'Delete Vandelay Industries?', text: 'The licenses nobody took go back to your balance: $120. Its workspaces stop being the team’s.', confirm: 'Delete team', keep: 'Keep it' }
};
/** On its way: the answer that confirms waits, and the other can't be pressed. */
export const Busy: Story = { args: { busy: true } };
