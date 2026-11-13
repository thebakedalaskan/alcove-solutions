/*
 * Your menu (user-flows 2; the design: docs/design/canvas/you-menu): your face at the top right of every page opens it,
 * under it with a caret. You, standing on the horizon in the last of the light, then Pause notifications, the theme,
 * Settings, the tour and Sign out, which asks in place when something on this device would be lost. While notifications are
 * paused your face carries a small bell. On a phone your face is in the top bar, and the menu rises as a sheet.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import type { World } from '../../src/world';
import { iso } from '../../src/world/clock';
import { keptHere } from './changes';

const meta = { title: 'Pages/Your menu', ...pages } satisfies Meta<PageArgs>;
export default meta;

type Play = NonNullable<PageStory['play']>;
type Context = Parameters<Play>[0];
const SOON = { timeout: 8000 };
const NIGHT = { theme: 'dark' } as const;
const PHONE = { viewport: { value: 'phone', isRotated: false } } as const;
const WIDE = { viewport: { value: 'wide', isRotated: false } } as const;

/** Notifications paused for an hour, from the demo clock's 16:12: until 17:12. */
const pausedForAnHour = (w: World): void => { w.prefs = { ...w.prefs, notificationsPausedUntil: iso(0, 17, 12) }; };

const menu = () => screen.findByRole('dialog', { name: 'Your menu' }, SOON);
/** Your face opens your menu: at the top right, or in a phone's top bar. */
const open = async ({ userEvent, step }: Context, said = 'Click your face, at the top right. Your menu opens under it'): Promise<void> => {
  await step(said, async () => {
    await userEvent.click(await screen.findByRole('button', { name: /^Art Vandelay, your menu/ }, SOON));
    await menu();
  });
};
/** Opens your menu, then presses `name` in it. */
const pressing = (name: string, said: string): Play => async (c) => {
  await open(c);
  await c.step(said, async () => {
    await c.userEvent.click(await within(await menu()).findByRole('button', { name }, SOON));
  });
};

/** Open on Home: you on a small evening, then Pause notifications, the theme, Settings, Take the tour and Sign out. */
export const Open = page('/home', 'busy', { play: (c) => open(c) });
export const OpenNight = { ...Open, globals: NIGHT };
/** On a wide screen, it still opens under your face, at the page's right edge. */
export const OpenWide = { ...Open, globals: WIDE };
/** Pause notifications opens its three choices in place under it, each with the time it ends. */
export const ChoosingAPause = page('/home', 'busy', { play: pressing('Pause notifications', 'Press Pause notifications. How long opens in place') });
export const ChoosingAPauseNight = { ...ChoosingAPause, globals: NIGHT };
/** Paused until 17:12: a small bell on your face, on every page, and the menu says until when, with Resume. */
export const Paused = page('/home', 'busy', { beforeEach: changing(pausedForAnHour), play: (c) => open(c, 'Your face carries a small bell. Click it: the menu says until when') });
export const PausedNight = { ...Paused, globals: NIGHT };
/** Paused, the menu closed: only the bell on your face says so, and its tooltip, until when. */
export const PausedClosed = page('/home', 'busy', { beforeEach: changing(pausedForAnHour) });
/** Sign out, with recordings on this device that haven't uploaded: the menu asks in place, in Settings' own words. */
export const SignOutAsks = page('/home', 'busy', { beforeEach: changing(keptHere), play: pressing('Sign out', 'Press Sign out. Recordings here haven’t uploaded, so it asks first') });
export const SignOutAsksNight = { ...SignOutAsks, globals: NIGHT };
/** On a phone, your face is in the top bar, and the menu rises from the bottom as a sheet. */
export const OnAPhone = page('/home', 'busy', { globals: PHONE, play: (c) => open(c, 'Tap your face in the top bar. Your menu rises as a sheet') });
export const OnAPhoneNight = { ...OnAPhone, globals: { ...PHONE, ...NIGHT } };
/** Paused, on a phone: the bell on your face in the top bar, and the sheet says until when. */
export const PausedOnAPhone = { ...Paused, globals: PHONE, play: (c: Context) => open(c, 'Tap your face in the top bar: the sheet says until when') };
/** Sign out asks on a phone too, in the sheet. */
export const SignOutAsksOnAPhone = { ...SignOutAsks, globals: PHONE };
