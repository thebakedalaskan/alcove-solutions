/*
 * CallTile: one person on the stage, always at night. Their video when it's on; otherwise their illustrated figure on
 * their own colour, or their arch. Whoever speaks gets the speak ring and a level meter, a muted mic shows its mark, a
 * raised hand a gold ring, and someone whose media hasn't reached this browser yet says Connecting.
 */
import { CallSignal, CallTile } from '@alcove/ui';
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
/** Quiet feedback shares the tile without replacing its hand or microphone state. */
export const QuietSignal: Story = { args: { signal: <CallSignal className="ac-tile-signal" icon="pace" label="Slow down" /> } };
