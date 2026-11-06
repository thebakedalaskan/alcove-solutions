/*
 * WsUnavailable: a document that can't be opened right now (someone restored a version of it, or it's too much to open),
 * in place of its page until it first opens. It opens again by itself, a little later each time.
 */
import { WsUnavailable } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box } from '../../src/component';

const meta = {
  title: 'Components/WsUnavailable',
  component: WsUnavailable,
  render: () => <Box width="min(760px, 100%)" height={480}><WsUnavailable /></Box>
} satisfies Meta<typeof WsUnavailable>;
export default meta;
type Story = StoryObj<typeof meta>;

export const OpensByItself: Story = {};
