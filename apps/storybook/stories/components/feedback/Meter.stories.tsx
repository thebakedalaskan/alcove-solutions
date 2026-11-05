/*
 * Meter: how much of something there is, as a thin sun bar on a sunk track that grows in from the left when it
 * appears. `value` runs from 0 to 1; it fills whatever width it's given. The side panel's says how many minutes of
 * notes are left.
 */
import { Meter } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box } from '../../../src/component';
import { CREDITS } from '../../../src/world';

const meta = {
  title: 'Components/Feedback/Meter',
  component: Meter,
  parameters: { layout: 'centered' },
  args: { value: CREDITS.balance / CREDITS.granted },
  argTypes: { value: { control: { type: 'range', min: 0, max: 1, step: 0.01 } } },
  render: (args) => <Box width={240} height="auto"><Meter {...args} /></Box>
} satisfies Meta<typeof Meter>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing left. */
export const Empty: Story = { args: { value: 0 } };
/** The side panel's, in the busy afternoon: 6 h 26 min of notes left, of 10 h. */
export const Partly: Story = {};
export const Full: Story = { args: { value: 1 } };
