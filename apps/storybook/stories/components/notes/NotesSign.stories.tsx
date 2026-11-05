/*
 * NotesSign: the one sign that notes are being taken, in the same place for everyone. On, it's the rec colour with a
 * pulsing dot. `requested`: someone asked for notes and nothing is recording yet, so it's an outline with a still dot.
 * `stage`: on the call stage, in the night's colours.
 */
import { NotesSign } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { onStage } from '../../../src/component';

const meta = {
  title: 'Components/Notes and transcript/NotesSign',
  component: NotesSign,
  parameters: { layout: 'centered' },
  args: { children: 'Notes on', requested: false, stage: false },
  argTypes: { children: { control: 'text' } }
} satisfies Meta<typeof NotesSign>;
export default meta;
type Story = StoryObj<typeof meta>;

export const On: Story = {};
/** Someone in the call asked for notes; nothing is recorded until the organizer turns them on. */
export const Requested: Story = { args: { requested: true, children: 'Notes requested' } };
/** In the call, at the top of the stage. */
export const OnTheStage: Story = { name: 'On the stage', ...onStage, args: { stage: true } };
export const RequestedOnTheStage: Story = { name: 'Requested on the stage', ...onStage, args: { stage: true, requested: true, children: 'Notes requested' } };
