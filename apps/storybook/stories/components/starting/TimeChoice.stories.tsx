/*
 * TimeChoice: one time to pick from, on the page a call's link shows while it offers times: the time, and its day in the
 * visitor's own zone, named. Picking fills it with the sun's soft colour, and its tick pops. Without `onPick` it's
 * read-only: the organizer's own view of the times they offered.
 */
import { TimeChoice } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { useArgs } from 'storybook/preview-api';
import { Box, did } from '../../../src/component';

const picked = did('onPick');

const meta = {
  title: 'Components/Starting a call/TimeChoice',
  component: TimeChoice,
  args: { time: '10:30', day: 'Thu 5 Nov · London time', picked: false },
  argTypes: { time: { control: 'text' }, day: { control: 'text' } },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <Box width="min(412px, 100%)" height="auto"><TimeChoice {...args} onPick={() => { picked(); update({ picked: true }); }} /></Box>;
  }
} satisfies Meta<typeof TimeChoice>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Press it to pick it. */
export const NotPicked: Story = { name: 'Not picked' };
export const Picked: Story = { args: { picked: true } };
/** Without `onPick`: the organizer's view of a time they offered. */
export const ReadOnly: Story = { name: 'Read-only', render: (args) => <Box width="min(412px, 100%)" height="auto"><TimeChoice {...args} /></Box> };

const TIMES = [
  { time: '10:30', day: 'Thu 5 Nov · London time' },
  { time: '14:00', day: 'Thu 5 Nov · London time' },
  { time: '11:00', day: 'Fri 6 Nov · London time' }
] as const;
/** The three times offered, as the card lists them: picking one takes the pick from another. */
export const ThreeTimes: Story = {
  name: 'Three times',
  render: function Render() {
    const [chosen, setChosen] = useState(-1);
    return (
      <Box width="min(412px, 100%)" height="auto">
        <div className="rg-times">
          {TIMES.map((t, i) => <TimeChoice key={`${t.day}-${t.time}`} time={t.time} day={t.day} picked={chosen === i} onPick={() => { picked(t.time); setChosen(i); }} />)}
        </div>
      </Box>
    );
  }
};
