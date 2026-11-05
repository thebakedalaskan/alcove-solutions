/*
 * TimeChip: a moment as a chip. A position in a recording (4:05) by default, or the caller's `label`, such as a time of
 * day. With `onSeek` it's a button that goes there, and its title says where (Play from 4:05, unless `title` says
 * otherwise); without, it only says the time.
 */
import { TimeChip } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';

const meta = {
  title: 'Components/Starting a call/TimeChip',
  component: TimeChip,
  parameters: { layout: 'centered' },
  args: { seconds: 245 },
  argTypes: { seconds: { control: { type: 'number', min: 0, step: 1 } }, label: { control: 'text' }, title: { control: 'text' } }
} satisfies Meta<typeof TimeChip>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A position in the recording, as a button: pressing it plays from there. */
export const APosition: Story = { name: 'A position', args: { onSeek: did('onSeek') } };
/** Only the time: nothing to press. */
export const Plain: Story = {};
/** A time of day in place of the position, as an answer in the call points to what was said: pressing it opens the transcript there. */
export const ALabel: Story = { name: 'A label', args: { label: '16:04:05', title: 'Open the transcript at 16:04:05', onSeek: did('onSeek') } };
