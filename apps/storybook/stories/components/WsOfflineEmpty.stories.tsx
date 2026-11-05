/*
 * WsOfflineEmpty: the workspace with no connection before it has ever loaded, so there's nothing yet to show. It opens by
 * itself once there's a connection; anything written offline is kept in this browser.
 */
import { WsOfflineEmpty } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box } from '../../src/component';

const meta = {
  title: 'Components/WsOfflineEmpty',
  component: WsOfflineEmpty,
  render: () => <Box width="min(760px, 100%)" height={480}><WsOfflineEmpty /></Box>
} satisfies Meta<typeof WsOfflineEmpty>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Offline: Story = {};
