import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { at, chats, knocks, raisesHand, type CallScript } from '../../src/api/script';
import { current } from '../../src/api/state';
import { inCall, light, phone, settings } from '../../src/call';
import { App } from '../../src/app';
import { NotificationReport } from '../../src/notificationReport';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { AIKO, DIEGO, KOFI, LAUNCH_REVIEW, PRIYA } from './talk';

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
const preview = (more: Omit<PageStory, 'args'> = {}) => inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script,
  then: () => { const world = current(); world.prefs.notifications = { ...world.prefs.notifications, enabled: false, privateMessages: true, replies: true, chatMentions: true, hands: true, questions: true, admissions: true, timers: true }; }
}, more);
/** Permission is requested only by the explicit action. All media remains synthetic, including native OS stories. */
export const NotEnabled = preview({ play: controls });
export const NotEnabledLight = light(NotEnabled);
export const NotEnabledPhone = phone(NotEnabled);
export const NotEnabledPhoneLight = light(NotEnabledPhone);
export const Enabled = preview({ parameters: { opening: { browser: { notifications: 'granted' } } }, play: async (c) => {
  await controls(c);
  await c.userEvent.click(await screen.findByRole('button', { name: 'Enable browser notifications' }));
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
/** Switch to another tab before 20 seconds; current unread items stay in Chat when delivery fails. */
export const DeliveryRefused = preview({ parameters: { opening: { browser: { notifications: 'granted', notificationTransport: 'failed' } } }, play: async (c) => { await Enabled.play?.(c); } });
/** Real browser permission and OS delivery. Enable explicitly, then switch tabs before the scripted activity starts. */
export const NativeBrowser = preview({ render: ({ path }) => <><App key={path} path={path} /><NotificationReport /></>, parameters: { opening: { browser: { notificationTransport: 'native' } } }, play: controls });

/** Open this same scene in two tabs. It shares only opaque browser state and stable scripted event IDs, never real media. */
export const NativeTwoTabs = inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script: { ...script, notificationId: 'storybook-notification-two-tabs-v2' },
  then: () => { const world = current(); world.prefs.notifications = { ...world.prefs.notifications, enabled: false, privateMessages: true, replies: true, chatMentions: true, hands: true, questions: true, admissions: true, timers: true }; }
}, { render: ({ path }) => <><App key={path} path={path} /><NotificationReport /></>, parameters: { opening: { browser: { notificationTransport: 'native', sharedNotificationBrowser: true } } }, play: controls });
