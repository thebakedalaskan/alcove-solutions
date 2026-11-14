/*
 * WsOfflineEmpty: the workspace, or a page in it, with no connection to Alcove before it has ever loaded, so there's nothing
 * yet to show. It opens by itself once there's a connection; anything written offline is kept in this browser. With the browser
 * online it's Alcove that can't be reached, which it says, with Try now.
 */
import { WsOfflineEmpty } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, did } from '../../../../src/component';

const meta = {
  title: 'Components/Workspace/No document/WsOfflineEmpty',
  component: WsOfflineEmpty,
  render: (args) => <Box width="min(760px, 100%)" height={480}><WsOfflineEmpty {...args} /></Box>
} satisfies Meta<typeof WsOfflineEmpty>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The browser has no connection: it opens when it's back. */
export const Offline: Story = {};
/** The browser's online, and Alcove can't be reached: Try now tries again at once. */
export const Unreachable: Story = { name: 'Alcove can’t be reached', args: { online: true, onTry: did('Try now') } };
export const UnreachablePhone: Story = { ...Unreachable, name: 'Alcove can’t be reached, phone', globals: { viewport: { value: 'phone', isRotated: false } } };
export const UnreachableNight: Story = { ...Unreachable, name: 'Alcove can’t be reached, night', globals: { theme: 'dark' } };
