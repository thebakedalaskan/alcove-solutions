import type { SoundPreferences } from '@alcove/api';
import type { Meta } from '@storybook/react-vite';
import { at, chats, knocks, raisesHand, type CallScript } from '../../src/api/call/script';
import { current } from '../../src/api/state';
import { inCall, light, phone, settings } from '../../src/call';
import { App } from '../../src/app';
import { NotificationReport } from '../../src/notification-report';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { pressable } from '../journeys/play';
import { AIKO, CHECK_IN, DIEGO, KOFI, LAUNCH_REVIEW, PRIYA } from './talk';

const meta = { title: 'Calls/Browser notifications', ...pages } satisfies Meta<PageArgs>;
export default meta;
const controls = settings('Notifications');
const script: CallScript = { notes: 'off', here: [{ who: PRIYA }, { who: KOFI }, { who: AIKO }],
  privateMessages: [
    { from: PRIYA, text: 'Could you review the release checklist?', after: 20 },
    { from: PRIYA, text: 'There is one more detail in the checklist.', after: 40, replyTo: 'Could you review the release checklist?' },
    { from: PRIYA, text: 'The final draft is ready for your review.', after: 65 }
  ], cues: [
    ...at(25, chats(KOFI, '@Art Vandelay, could you check the launch plan?', ['me'])),
    ...at(30, { do: 'question', who: AIKO, text: 'Which teams join the first release?' }),
    ...at(35, raisesHand(KOFI)), ...at(45, knocks(DIEGO)),
    ...at(55, { do: 'ask-for-notes', who: PRIYA })
  ] };
/**
 * The launch review, with browser notifications off for the account and every alert in a call on; `sounds` changes those,
 * and `pausedFor` pauses notifications for that many seconds from when you join, as your menu would.
 */
const preview = (more: Omit<PageStory, 'args'> = {}, o: { sounds?: Partial<SoundPreferences>; pausedFor?: number } = {}) => inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script,
  then: () => {
    const world = current();
    world.prefs.notifications = { ...world.prefs.notifications, enabled: false, privateMessages: true, replies: true, chatMentions: true, hands: true, questions: true, admissions: true, timers: true };
    world.prefs.sounds = { ...world.prefs.sounds, ...o.sounds };
    if (o.pausedFor !== undefined) world.prefs.notificationsPausedUntil = new Date(Date.now() + o.pausedFor * 1000).toISOString();
  }
}, more);
/**
 * Settings' Notifications in the call: the browser's notifications, sounds, quiet mode and what reaches you in a call. Only Turn
 * on asks the browser. All media remains synthetic, including native OS stories.
 */
export const NotEnabled = preview({ play: controls });
export const NotEnabledLight = light(NotEnabled);
export const NotEnabledPhone = phone(NotEnabled);
export const NotEnabledPhoneLight = light(NotEnabledPhone);
/** The browser allowed them before, so they're a switch: turned on here, for when this tab is out of sight. */
export const Enabled = preview({ parameters: { opening: { browser: { notifications: 'granted' } } }, play: async (c) => {
  await controls(c);
  await c.step('Turn on browser notifications, once the choices have been read', async () => {
    await c.userEvent.click(await pressable('switch', 'Browser notifications'));
  });
} });
export const EnabledLight = light(Enabled);
export const EnabledPhone = phone(Enabled);
export const EnabledPhoneLight = light(EnabledPhone);
export const Blocked = preview({ parameters: { opening: { browser: { notifications: 'denied' } } }, play: controls });
export const BlockedLight = light(Blocked);
export const BlockedPhone = phone(Blocked);
export const Unsupported = preview({ parameters: { opening: { browser: { notificationTransport: 'unsupported' } } }, play: controls });
export const UnsupportedLight = light(Unsupported);
export const UnsupportedPhone = phone(Unsupported);
/** Sounds off: the Sound column steps back and keeps each choice for when they're on again. */
export const SoundsOff = preview({ play: controls }, { sounds: { enabled: false } });
export const SoundsOffPhone = phone(SoundsOff);
/** A guest's: the same choices, kept in this browser rather than in an account. */
export const Guest = inCall({ scenario: 'signed-out', call: CHECK_IN, script: { here: [{ who: PRIYA, organizer: true }, { who: KOFI }], cues: at(.1, { do: 'let-in' }) } }, { play: controls });
export const GuestPhone = phone(Guest);
/** Switch to another tab before 20 seconds; current unread items stay in Chat when delivery fails. */
export const DeliveryRefused = preview({ parameters: { opening: { browser: { notifications: 'granted', notificationTransport: 'failed' } } }, play: async (c) => { await Enabled.play?.(c); } });
/** The app with its delivery report beside it, on the browser's own notifications. */
const native: Omit<PageStory, 'args'> = { render: ({ path }) => <><App key={path} path={path} /><NotificationReport /></>, parameters: { opening: { browser: { notificationTransport: 'native' } } } };
/** Real browser permission and OS delivery. Enable explicitly, then switch tabs before the scripted activity starts. */
export const NativeBrowser = preview({ ...native, play: controls });
/**
 * The same, with notifications paused, as your menu pauses them, until 50 seconds in: enable and switch tabs as there.
 * While the pause holds, the private messages (20 and 40 seconds), the mention (25), the question (30) and the raised
 * hand (35) raise no alert and no sound; Diego asking to join (45) still does both, since you host the call. As the pause
 * ends, what it held that's still timely shows, and what comes after it (55 and 65) reaches you as ever.
 */
export const NativeBrowserPaused = preview({ ...native, play: controls }, { pausedFor: 50 });

/** Open this same scene in two tabs. It shares only opaque browser state and stable scripted event IDs, never real media. */
export const NativeTwoTabs = inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script: { ...script, notificationId: 'storybook-notification-two-tabs-v2' },
  then: () => { const world = current(); world.prefs.notifications = { ...world.prefs.notifications, enabled: false, privateMessages: true, replies: true, chatMentions: true, hands: true, questions: true, admissions: true, timers: true }; }
}, { render: ({ path }) => <><App key={path} path={path} /><NotificationReport /></>, parameters: { opening: { browser: { notificationTransport: 'native', sharedNotificationBrowser: true } } }, play: controls });
