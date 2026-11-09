/*
 * CallTile: one person on the stage, always at night. Their video when it's on; otherwise their illustrated figure on
 * their own colour, or their arch. Whoever speaks gets the speak ring and a level meter, a muted mic shows its mark, a
 * raised hand a gold ring, someone whose media hasn't reached this browser yet says Connecting, and a status shows at the
 * top left for everyone: stepping away dims them, and a status with a time counts down along the foot.
 */
import { CallTile } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, onStage } from '../../../src/component';
import { INES, KOFI, PRIYA } from '../../../src/world/people';

const meta = {
  title: 'Components/In a call/CallTile',
  component: CallTile,
  ...onStage,
  args: { person: PRIYA, name: 'Priya Raman', speaking: false, muted: false, hand: false, connecting: false },
  argTypes: { person: { control: false }, name: { control: 'text' }, children: { control: false }, chrome: { control: false } },
  render: (args) => <Box width="min(560px, 100%)" height={340}><CallTile {...args} /></Box>
} satisfies Meta<typeof CallTile>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Their figure on their own colour, as room light on the night stage. */
export const Figure: Story = {};
export const Speaking: Story = { args: { speaking: true } };
export const Muted: Story = { args: { person: KOFI, name: 'Kofi Asante', muted: true } };
export const HandRaised: Story = { name: 'Hand raised', args: { person: KOFI, name: 'Kofi Asante', hand: true } };
/** In the call, but their keys are still on the way: not the same as a camera that's off. */
export const Connecting: Story = { args: { connecting: true } };
/** Someone without a portrait: their arch, with their initial. */
export const Arch: Story = { args: { person: INES, name: 'Ines Moreau' } };
/** Be right back for five minutes, two of them gone: the tile dims, and the line along its foot has three minutes left. */
export const BeRightBack: Story = {
  name: 'Be right back',
  args: { status: { icon: 'away', text: 'Be right back · 14:37', short: '14:37', away: true, time: { since: Date.now() - 2 * 60_000, until: Date.now() + 3 * 60_000 } } }
};
/** A status with no time stays until they clear it or talk, and they don't dim. */
export const ListeningOnly: Story = { name: 'Listening only', args: { person: KOFI, name: 'Kofi Asante', muted: true, status: { icon: 'listening', text: 'Listening only', short: 'Listening only', away: false, time: null } } };
/** A status beside a raised hand and a muted microphone, each in its own corner. */
export const StatusWithHand: Story = { name: 'Status with a hand', args: { hand: true, status: { icon: 'phone', text: 'On my phone · 14:40', short: '14:40', away: false, time: { since: Date.now(), until: Date.now() + 10 * 60_000 } } } };
