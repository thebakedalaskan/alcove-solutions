/*
 * WsTrashRow: Trash at the foot of the list, with how many things are in it. It's the page beside the list once it's open,
 * and where a row dragged onto it goes to Trash.
 */
import { WsTrashRow } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, did } from '../../src/component';

const meta = {
  title: 'Components/WsTrashRow',
  component: WsTrashRow,
  args: { count: 2, current: false, into: false, onOpen: did('open trash') },
  argTypes: { onOpen: { control: false } },
  render: (args) => <Box width={260} height="auto"><WsTrashRow {...args} /></Box>
} satisfies Meta<typeof WsTrashRow>;
export default meta;
type Story = StoryObj<typeof meta>;

export const TwoThings: Story = {};
export const Empty: Story = { args: { count: 0 } };
/** Open: Trash is the page beside the list. */
export const Open: Story = { args: { current: true } };
/** A row dragged over it, about to go to Trash. */
export const DropHere: Story = { args: { into: true } };
