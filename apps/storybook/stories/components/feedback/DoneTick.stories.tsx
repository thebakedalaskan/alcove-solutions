/*
 * DoneTick: done, on a card. A soft tile whose tick draws in as it appears: it heads the card that says a time was
 * picked. Remount the story to see the tick draw again.
 */
import { DoneTick } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Components/Feedback/DoneTick',
  component: DoneTick,
  parameters: { layout: 'centered' }
} satisfies Meta<typeof DoneTick>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Done: Story = {};
