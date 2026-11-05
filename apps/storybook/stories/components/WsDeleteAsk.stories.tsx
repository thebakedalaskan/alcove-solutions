/*
 * WsDeleteAsk: Delete forever, from Trash, asked once on a workspace popover. It goes for everyone, with everything in it.
 * The keyboard starts on Keep it.
 */
import { WsDeleteAsk } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { PopSurface, did } from '../../src/component';

const meta = {
  title: 'Components/WsDeleteAsk',
  component: WsDeleteAsk,
  args: { name: 'Old roadmap', onDelete: did('delete forever'), onKeep: did('keep it') },
  argTypes: { onDelete: { control: false }, onKeep: { control: false } },
  render: (args) => <PopSurface ws><WsDeleteAsk {...args} /></PopSurface>
} satisfies Meta<typeof WsDeleteAsk>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ADocument: Story = {};
export const LongName: Story = { args: { name: 'Quarterly planning: what goes into the first quarter of next year, and what waits until the summer' } };
