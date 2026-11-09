import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { light, phone } from '../../src/call';
import { pages, type PageArgs } from '../../src/page';
import { NotEnabled, Blocked, Unsupported } from '../calls/BrowserNotifications.stories';

const meta = { title: 'Journeys/6g Browser notifications', ...pages } satisfies Meta<PageArgs>;
export default meta;
export const ChoosePrivateAlerts = { ...NotEnabled, name: '6.33 Choose browser alerts explicitly', play: async (c: Parameters<NonNullable<typeof NotEnabled.play>>[0]) => {
  await NotEnabled.play?.(c);
  await c.step('Enable browser notifications, the only action that asks permission', async () => {
    await c.userEvent.click(await screen.findByRole('button', { name: 'Enable browser notifications' }));
  });
  await c.step('Keep private messages and choose fewer interruptions', async () => {
    await c.userEvent.click(await screen.findByRole('switch', { name: 'Raised hands' }));
    await c.userEvent.click(await screen.findByRole('switch', { name: 'New questions' }));
  });
  await c.step('Turn browser notifications off; local unread state and sound choices remain available', async () => {
    await c.userEvent.click(await screen.findByRole('switch', { name: 'Browser notifications' }));
  });
} };
export const ChoosePrivateAlertsLight = light(ChoosePrivateAlerts);
export const ChoosePrivateAlertsPhone = phone(ChoosePrivateAlerts);
export const ChoosePrivateAlertsPhoneLight = light(ChoosePrivateAlertsPhone);
export const PermissionBlocked = { ...Blocked, name: '6.33 Keep in-app activity when the browser blocks alerts' };
export const BrowserUnsupported = { ...Unsupported, name: '6.33 Keep in-app activity without OS support' };
