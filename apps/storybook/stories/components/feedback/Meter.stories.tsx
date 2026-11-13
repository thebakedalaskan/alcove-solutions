/*
 * Meter: how much of something there is, as a thin sun bar on a sunk track that grows in from the left when it
 * appears. `value` runs from 0 to 1; it fills whatever width it's given. The side panel's says how much of the period's
 * notes is left.
 */
import { Meter } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box } from '../../../src/component';
import { freePlan } from '../../../src/world/plans';

const { notes } = freePlan();

const meta = {
  title: 'Components/Feedback/Meter',
  component: Meter,
  parameters: { layout: 'centered' },
  args: { value: notes.minutesLeft / notes.minutesPerPeriod },
  argTypes: { value: { control: { type: 'range', min: 0, max: 1, step: 0.01 } } },
  render: (args) => <Box width={240} height="auto"><Meter {...args} /></Box>
} satisfies Meta<typeof Meter>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing left. */
export const Empty: Story = { args: { value: 0 } };
/** The side panel's, in the busy afternoon on Free: 3 h 20 min of notes left, of 5 h. */
export const Partly: Story = {};
export const Full: Story = { args: { value: 1 } };
