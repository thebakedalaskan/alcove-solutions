/*
 * ReplayScrub: the scrub bar for a note's recording, along the foot of a full screen replay. Click or drag to move
 * through it; arrow keys move 5 seconds, Page keys 30, Home and End go to the ends. Faint spans on the track mark
 * when something was shared. It sits on the call stage, so it is night in both themes.
 */
import { ReplayScrub } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Box, onStage } from '../../../src/component';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const meta = {
  title: 'Components/In a call/ReplayScrub',
  component: ReplayScrub,
  ...onStage,
  args: { pos: 372, total: 1160, format: clock, onSeek: () => undefined },
  argTypes: { pos: { control: { type: 'range', min: 0, max: 1160 } }, format: { control: false }, onSeek: { control: false }, marks: { control: false }, className: { control: false } },
  render: (args) => {
    const [pos, setPos] = useState(args.pos);
    return <Box width="min(560px, 100%)" height="auto"><ReplayScrub {...args} pos={pos} onSeek={setPos} /></Box>;
  }
} satisfies Meta<typeof ReplayScrub>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Just the track: no share to mark. */
export const Plain: Story = {};
/** Spans where a screen was shared: two shares, the second starting before the first ends. */
export const WithMarks: Story = { name: 'With marks', args: { pos: 560, marks: [{ at: 532, until: 640 }, { at: 600, until: 760 }] } };
/** At the very start. */
export const AtTheStart: Story = { name: 'At the start', args: { pos: 0, marks: [{ at: 532, until: 640 }] } };
