/* Settings: change one thing and leave. One long sheet with an index beside it (user-flows 11). */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { phone } from '../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import { keptHere, noCalendar, sharedDemo, troubled, unencryptedDefault } from './changes';

const meta = { title: 'Pages/Settings', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** Presses a button on the page, as a person would. */
const pressing = (name: string | RegExp, said: string): NonNullable<PageStory['play']> => async ({ canvas, userEvent, step }) => {
  await step(said, async () => {
    await userEvent.click(await canvas.findByRole('button', { name }, { timeout: 8000 }));
  });
};

export const Busy = page('/settings', 'busy');
/** On a phone the index is a strip that stays at the top. */
export const BusyPhone = phone(Busy);
export const FirstDay = page('/settings', 'first-day');
export const OnTheirOwn = page('/settings', 'on-their-own');
/** An AI model that isn't in a secure enclave is the default: Unencrypted shows beside it, and in the list. */
export const UnencryptedModel = page('/settings#notes', 'busy', { beforeEach: changing(unencryptedDefault) });
export const Lots = page('/settings', 'lots');
/** Opened at the minutes, from the side panel. */
export const Minutes = page('/settings#plan', 'busy');
/** Opened at notifications: being tagged in a document you can open, while you're somewhere else, is one of them. */
export const Notifications = page('/settings#notifications', 'busy');
export const NotificationsNight = page('/settings#notifications', 'busy', { globals: { theme: 'dark' } });

/** Signed in with Google without sharing the calendar: Connect. */
export const NoCalendar = page('/settings#calendar', 'busy', { beforeEach: changing(noCalendar) });
/** The shared demo account: a sample calendar in place of Google's. */
export const DemoAccount = page('/settings#calendar', 'busy', { beforeEach: changing(sharedDemo) });
/** Notifications the browser hasn't been asked about: greyed out until Turn on. */
export const NotificationsNotAsked = page('/settings#notifications', 'busy');
/** Notifications allowed: each one can be chosen. */
export const NotificationsOn = page('/settings#notifications', 'busy', { parameters: { opening: { browser: { notifications: 'granted' } } } });
/** Notifications the browser blocks: allow them for the site in the browser's settings. */
export const NotificationsBlocked = page('/settings#notifications', 'busy', { parameters: { opening: { browser: { notifications: 'denied' } } } });
/** Devices not allowed yet: the browser names them only once they are, so there's no list. */
export const DevicesNotAllowedYet = page('/settings#devices', 'busy', { parameters: { opening: { browser: { devices: 'prompt' } } } });
/** Devices the browser blocks. */
export const DevicesBlocked = page('/settings#devices', 'busy', { parameters: { opening: { browser: { devices: 'denied' } } } });
/** Check the level: the microphone opens for eight seconds and its level moves; nothing is recorded. */
export const CheckingTheLevel = page('/settings#devices', 'busy', { play: pressing(/Check the level/, 'Press Check the level') });

/** Turns a setting off, which saves at once. */
const turningOff: NonNullable<PageStory['play']> = async ({ canvas, userEvent, step }) => {
  await step('Turn off Show my other meetings on Home. It saves at once', async () => {
    await userEvent.click(await canvas.findByRole('switch', { name: 'Show my other meetings on Home' }, { timeout: 8000 }));
  });
};
/** Every control saves as it changes: Saved shows for a moment, just left of the control. */
export const Saved = page('/settings#calendar', 'busy', { play: turningOff });
/** A change Alcove refuses goes back, and a toast says why. */
export const SaveRefused = page('/settings#calendar', 'busy', { beforeEach: changing(troubled({ 'account.updatePreferences': 'failed' })), play: turningOff });
/** Sign out, with recordings on this device that haven't uploaded: the sky grows to ask first, and Stay signed in is the answer it offers. */
export const SignOutAsks = page('/settings', 'busy', { beforeEach: changing(keptHere), play: pressing('Sign out', 'Press Sign out. Recordings here haven’t uploaded, so it asks first') });
export const SignOutAsksPhone = phone(SignOutAsks);
/** Delete account opens in place: what goes beside what stays, and Keep my account has the focus. */
export const DeleteOpened = page('/settings#privacy', 'busy', { play: pressing('Delete account', 'Press Delete account') });
/** The shared demo account can't be deleted, and says so as soon as Delete account is pressed. */
export const DemoCantBeDeleted = page('/settings#privacy', 'busy', { beforeEach: changing(sharedDemo), play: pressing('Delete account', 'Press Delete account') });

/** Alcove is slow to answer: the calendar and the hardware check are still on their way, and the rest of the page works. */
export const StillLoading = page('/settings', 'busy', { beforeEach: changing(troubled({ 'calendar.get': 'hold', 'trust.attestation': 'hold' })) });
/** Parts that didn't load say so, with Try again, and the rest of the page still works. */
export const PartsDidntLoad = page('/settings', 'busy', { beforeEach: changing(troubled({ 'account.preferences': 'failed', 'credits.balance': 'failed' })) });
/** The calendar didn't answer: why, and Try again. */
export const CalendarDidntAnswer = page('/settings#calendar', 'busy', { beforeEach: changing(troubled({ 'calendar.get': 'failed' })) });
/** Opened without a connection: Settings needs one, and Record still works. */
export const Offline = page('/settings', 'offline');

/** The Agents part keeps credentials in its mounted view only; listing shows no token. */
export const AgentsEmpty = page('/settings#agents', 'busy');
export const AgentsConnected = page('/settings#agents', 'agents-connected');
export const AgentsConnectedNight = page('/settings#agents', 'agents-connected', { globals: { theme: 'dark' } });
export const AgentsConnectedPhone = phone(AgentsConnected);
export const AgentsLoading = page('/settings#agents', 'busy', { beforeEach: changing(troubled({ 'agents.list': 'hold' })) });
export const AgentsUnavailable = page('/settings#agents', 'busy', { beforeEach: changing(troubled({ 'agents.list': 'failed' })) });
export const CreatingAgentToken = page('/settings#agents', 'busy', { play: pressing('Create a token', 'Open the token form and choose its permissions and expiry') });


const issueAgentToken: NonNullable<PageStory['play']> = async ({ userEvent, step }) => {
  await step('Name a connection and create a token with the default read permissions', async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Create a token' }, { timeout: 8000 }));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Connection name' }, { timeout: 8000 }), 'Planning assistant');
    await userEvent.click(screen.getByRole('button', { name: 'Create token' }));
  });
};
export const AgentTokenIssued = page('/settings#agents', 'busy', { play: issueAgentToken });
export const AgentTokenRefused = page('/settings#agents', 'busy', { beforeEach: changing(troubled({ 'agents.createToken': 'failed' })), play: issueAgentToken });
export const AgentDisconnectRefused = page('/settings#agents', 'agents-connected', {
  beforeEach: changing(troubled({ 'agents.revoke': 'failed' })),
  play: async ({ userEvent, step }) => {
    await step('Disconnect fails, so the connection stays in the list and a toast explains why', async () => {
      await userEvent.click(within(await screen.findByRole('group', { name: 'Workspace assistant' }, { timeout: 8000 })).getByRole('button', { name: 'Disconnect' }));
    });
  }
});
