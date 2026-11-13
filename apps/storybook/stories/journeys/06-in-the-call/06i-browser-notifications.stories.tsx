import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { light, phone } from '../../../src/call';
import { pages, type PageArgs } from '../../../src/page';
import { pressable } from '../play';
import { NotEnabled, Blocked, Unsupported } from '../../calls/BrowserNotifications.stories';

const meta = { title: 'Journeys/6 In the call/Browser notifications', ...pages } satisfies Meta<PageArgs>;
export default meta;
export const ChoosePrivateAlerts = { ...NotEnabled, name: '6.33 Choose browser alerts explicitly', play: async (c: Parameters<NonNullable<typeof NotEnabled.play>>[0]) => {
  await NotEnabled.play?.(c);
  await c.step('Turn on browser notifications, the only action that asks permission', async () => {
    await c.userEvent.click(await pressable('button', 'Turn on'));
  });
  await c.step('Keep private messages and choose fewer interruptions: untick the alerts for raised hands and new questions', async () => {
    await c.userEvent.click(await screen.findByRole('checkbox', { name: 'Raised hands: alert' }));
    await c.userEvent.click(await screen.findByRole('checkbox', { name: 'New questions: alert' }));
  });
  await c.step('Turn browser notifications off; alerts in Alcove, unread state and sounds stay as they are', async () => {
    await c.userEvent.click(await screen.findByRole('switch', { name: 'Browser notifications' }));
  });
} };
export const ChoosePrivateAlertsLight = light(ChoosePrivateAlerts);
export const ChoosePrivateAlertsPhone = phone(ChoosePrivateAlerts);
export const ChoosePrivateAlertsPhoneLight = light(ChoosePrivateAlertsPhone);
export const PermissionBlocked = { ...Blocked, name: '6.33 Keep in-app activity when the browser blocks alerts' };
export const BrowserUnsupported = { ...Unsupported, name: '6.33 Keep in-app activity without OS support' };
