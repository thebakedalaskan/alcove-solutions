/*
 * SealedBadge: where something was written and what was checked, as product state, not something to press. As a block
 * it's the sealed mark in the sun's tint with a title and a line of detail, as Home says where notes are written.
 * `inline` is one quiet line, as in a note's footer. When it opens what was checked, it's a SealedButton.
 */
import { SealedBadge } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Components/Feedback/SealedBadge',
  component: SealedBadge,
  parameters: { layout: 'centered' },
  args: { title: 'Confidential compute', detail: 'Hardware verified 16:02', inline: false },
  argTypes: { title: { control: 'text' }, detail: { control: 'text' } }
} satisfies Meta<typeof SealedBadge>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Home's: where notes are written, and when this browser last checked the hardware they're written on. */
export const Block: Story = {};
/** One line in a note's footer. The detail isn't shown inline. */
export const Inline: Story = { args: { inline: true, title: 'Written in confidential compute' } };
