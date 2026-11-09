/*
 * Journeys in Settings (docs/product/user-flows.md › 11. Settings), from the canvas's Settings board
 * (docs/design/canvas/data-settings.js). Google's pages can't open in Storybook, so connecting the calendar plays up to
 * the hand-off; signing in another way is the welcome page's Microsoft or single sign-on, which the stand-in signs in.
 */
import { AlcoveApiError } from '@alcove/api';
import type { Meta } from '@storybook/react-vite';
import { screen, waitFor, within } from 'storybook/test';
import { standIn } from '../../src/api/standin';
import { openBrowser, setOnline } from '../../src/browser';
import { session } from '../../src/world';
import { notConnected } from '../../src/world/build';
import { busyEvents } from '../../src/world/calls';
import { page, pages, type PageArgs, type PageStory } from '../../src/page';
import { before, first, LATER, outage, pause, pressable, SOON, swap, unreachable } from './play';

const meta = { title: 'Journeys/11 Settings', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** A row of the sheet, by its label. */
const row = (name: string | RegExp) => screen.findByRole('group', { name }, LATER);
/** A part of the sheet, by its title. */
const part = (name: string) => screen.findByRole('region', { name }, LATER);
/** Waits until `where` doesn't say `text` any more. */
const goneFrom = (where: HTMLElement, text: string) =>
  waitFor(() => { if (within(where).queryByText(text)) throw new Error(`“${text}” is still there.`); }, SOON);
/** The welcome page, signed out: it offers every way in, at the top and again at the bottom. */
const welcome = () => first(screen.findAllByRole('button', { name: 'Continue with Microsoft' }, LATER));
/** From any page, you at the top right open Settings. */
const toSettings = async (click: (el: Element) => Promise<void>) => {
  await click(await screen.findByRole('link', { name: 'Art Vandelay, settings' }, LATER));
  await screen.findByRole('heading', { name: 'Art Vandelay', level: 1 }, LATER);
};

/** A failure on the server's side: the database connection dropping, Google not answering, the hardware check. */
const failing = (message: string) => new AlcoveApiError('unavailable', message, { requestId: 'sb-journey' });
const DATABASE = 'Alcove lost its connection to the database. Try again.';

/** The shared demo account: in with Microsoft, a sample calendar instead of Google's. */
const demoAccount = before((w) => {
  w.session = session({ provider: 'microsoft', sample: true, sharedDemo: true });
  w.calendar = { source: 'sample', needsAccess: false, events: busyEvents() };
});

/** A change to preferences that takes a moment and doesn't get through. */
const saving = outage(() => swap(standIn.account, 'updatePreferences', () => pause(1500).then(() => Promise.reject(unreachable()))));
/** Google taking a moment to let go of the calendar. */
const slowGoogle = () => { const was = standIn.calendar.disconnect; return swap(standIn.calendar, 'disconnect', () => pause(1500).then(was)); };
/** Deleting an account takes a moment: long enough to leave Settings meanwhile. */
const slowDelete = () => { const was = standIn.account.delete; return swap(standIn.account, 'delete', () => pause(2500).then(was)); };
/** Alcove can't take uploads just now, so what's recorded here waits here. */
const uploadsDown = outage(() => swap(standIn.recordings, 'start', () => Promise.reject(failing(DATABASE))));
const prefsDown = outage(() => swap(standIn.account, 'preferences', () => Promise.reject(failing(DATABASE))));
const minutesDown = outage(() => swap(standIn.credits, 'balance', () => Promise.reject(failing(DATABASE))));
const calendarDown = outage(() => swap(standIn.calendar, 'get', () => Promise.reject(failing('Google can’t be reached right now.'))));
const noHardware = outage(() => swap(standIn.trust, 'attestation', () => Promise.reject(failing('This server can’t attest to itself right now.'))));

export const ChangeASetting: PageStory = {
  name: '11.1 Change a setting',
  ...page('/settings', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click Detailed. There’s nothing to save and nothing else to press', async () => {
      await userEvent.click(within(await row('Summary')).getByRole('button', { name: 'Detailed' }));
    });
    await step('It’s kept. Saved shows in the row, and says it’s for new notes', async () => {
      await within(await row('Summary')).findByText('Saved for new notes', {}, SOON);
    });
    await step('Two seconds later Saved has gone, and the row just says Detailed', async () => {
      await goneFrom(await row('Summary'), 'Saved for new notes');
    });
  }
};

export const PickFromAList: PageStory = {
  name: '11.2 Pick from a list',
  ...page('/settings', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click the language', async () => {
      await userEvent.click(within(await row('Language')).getByRole('button', { name: /^Notes language/ }));
    });
    await step('The list opens under it, on the page. The current one has a tick', async () => {
      await screen.findByRole('option', { name: 'Same as the call', selected: true }, SOON);
    });
    await step('Click French. The list closes and the row says Saved for new notes', async () => {
      await userEvent.click(screen.getByRole('option', { name: 'French' }));
      await within(await row('Language')).findByText('Saved for new notes', {}, SOON);
    });
  }
};

export const ServerRefuses: PageStory = {
  name: '11.3 The server refuses',
  ...page('/settings#calendar', 'busy'),
  beforeEach: saving.begin,
  play: async ({ userEvent, step }) => {
    await step('Turn off Show my other meetings on Home', async () => {
      await userEvent.click(within(await row('Show my other meetings on Home')).getByRole('switch'));
    });
    await step('The switch moves straight away, while it’s being kept', async () => {
      await screen.findByRole('switch', { name: 'Show my other meetings on Home', checked: false }, SOON);
    });
    await step('Refused: it goes back, and a toast says why. No Saved', async () => {
      await screen.findByText('Couldn’t reach Alcove, so Show my other meetings on Home is back as it was.', {}, SOON);
      await screen.findByRole('switch', { name: 'Show my other meetings on Home', checked: true }, SOON);
    });
  }
};

export const DisconnectGoogleCalendar: PageStory = {
  name: '11.4 Disconnect Google Calendar',
  ...page('/settings#calendar', 'busy'),
  beforeEach: slowGoogle,
  play: async ({ userEvent, step }) => {
    await step('Click Disconnect', async () => {
      await userEvent.click(within(await row('Google Calendar')).getByRole('button', { name: 'Disconnect' }));
    });
    await step('It forgets the connection and withdraws Alcove’s access at Google', async () => {
      await within(await row('Google Calendar')).findByRole('button', { name: 'Disconnecting' }, SOON);
    });
    await step('Done. Connect takes its place, and a toast says so', async () => {
      await screen.findByText('Google Calendar is disconnected.', {}, SOON);
      await within(await row('Google Calendar')).findByRole('button', { name: 'Connect' }, SOON);
    });
  }
};

export const ConnectGoogleCalendar: PageStory = {
  name: '11.5 Connect Google Calendar',
  ...page('/settings#calendar', 'busy'),
  beforeEach: before((w) => { w.calendar = notConnected; }),
  play: async ({ userEvent, step }) => {
    await step('Click Connect', async () => {
      await userEvent.click(within(await row('Google Calendar')).getByRole('button', { name: 'Connect' }));
    });
    await step('The page goes to Google, which asks about the calendar, then sends you back to Home with your meetings on it', async () => {
      await within(await row('Google Calendar')).findByRole('button', { name: 'Opening Google' }, SOON);
    });
  }
};

export const CalendarThatIsntGoogles: PageStory = {
  name: '11.6 A calendar that isn’t Google’s to connect',
  ...page('/settings#calendar', 'busy'),
  beforeEach: demoAccount,
  play: async ({ step }) => {
    await step('A demo account has a sample calendar instead. There’s nothing to connect', async () => {
      await within(await row('Sample calendar')).findByText('Demo account', {}, SOON);
    });
  }
};

export const CheckTheLevel: PageStory = {
  name: '11.7 Check the level',
  ...page('/settings#devices', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click Check the level. Nothing opens until you do', async () => {
      await userEvent.click(within(await row('Microphone')).getByRole('button', { name: 'Check the level' }));
    });
    await step('The microphone is open for eight seconds. The level moves as you speak', async () => {
      await within(await row('Microphone')).findByText('Speak, and watch it move. Nothing is recorded.', {}, SOON);
    });
    await step('Click Stop, or scroll this part away, and it closes sooner', async () => {
      await userEvent.click(within(await row('Microphone')).getByRole('button', { name: /^Stop · \d+ s$/ }));
    });
    await step('Closed. Nothing was recorded', async () => {
      await within(await row('Microphone')).findByRole('button', { name: 'Check the level' }, SOON);
    });
  }
};

export const MicrophoneNotAllowedYet: PageStory = {
  name: '11.8 The browser hasn’t allowed the microphone',
  ...page('/settings#devices', 'busy', { parameters: { opening: { browser: { devices: 'prompt' } } } }),
  play: async ({ userEvent, step }) => {
    await step('First time: click Check the level', async () => {
      const mic = await row('Microphone');
      await within(mic).findByText('Your browser asks first.', {}, SOON);
      await userEvent.click(within(mic).getByRole('button', { name: 'Check the level' }));
    });
    await step('The browser asks first. Allow, and the level starts', async () => {
      await within(await row('Microphone')).findByRole('button', { name: /^Stop · \d+ s$/ }, SOON);
    });
  }
};

export const PlayTestSound: PageStory = {
  name: '11.9 Play test sound',
  ...page('/settings#devices', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click Play test sound', async () => {
      await userEvent.click(within(await row('Speaker')).getByRole('button', { name: 'Play test sound' }));
    });
    await step('A short sound plays through the chosen speaker', async () => {
      await within(await row('Speaker')).findByRole('button', { name: 'Playing' }, SOON);
      await within(await row('Speaker')).findByRole('button', { name: 'Play test sound' }, SOON);
    });
  }
};

export const CameraIsAList: PageStory = {
  name: '11.10 The camera is a list',
  ...page('/settings#devices', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Pick a camera. It never opens here, so there’s no picture', async () => {
      // The browser lists the cameras a moment after the page opens, and the row becomes the list.
      await userEvent.click(await screen.findByRole('button', { name: /^Camera: / }, SOON));
      await userEvent.click(await screen.findByRole('option', { name: 'Desk camera' }, SOON));
    });
    await step('Saved. You see yourself when you join a call', async () => {
      await within(await row('Camera')).findByText('Saved', {}, SOON);
    });
  }
};

export const TurnOnNotifications: PageStory = {
  name: '11.11 Turn on browser notifications',
  ...page('/settings#notifications', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('The choices wait, greyed out. Click Enable browser notifications', async () => {
      await userEvent.click(within(await row('Browser notifications')).getByRole('button', { name: 'Enable browser notifications' }));
    });
    await step('The browser asks, only now. Allow', async () => {
      await within(await row('Browser notifications')).findByRole('switch', { name: 'Browser notifications', checked: true }, SOON);
    });
    await step('Allowed. Focus stays on the row and the choices wake up', async () => {
      await pressable('button', '5 min');
    });
    await step('Pick how long before a call', async () => {
      await userEvent.click(await pressable('button', '5 min'));
    });
    await step('Saved, like everything else', async () => {
      await within(await row('Before a call starts')).findByText('Saved', {}, SOON);
    });
  }
};

export const NotificationsBlocked: PageStory = {
  name: '11.12 Notifications are blocked',
  ...page('/settings#notifications', 'busy'),
  // The browser's answer when Alcove asks: Block.
  beforeEach: () => { openBrowser({ answer: 'denied' }); },
  play: async ({ userEvent, step }) => {
    await step('At the same question, Block', async () => {
      await userEvent.click(within(await row('Browser notifications')).getByRole('button', { name: 'Enable browser notifications' }));
    });
    await step('The row says where to allow them, and the choices stay as they are', async () => {
      const notifications = await row('Browser notifications');
      await within(notifications).findByText('Blocked', {}, SOON);
      await within(notifications).findByText(/Blocked or revoked in this browser/);
    });
  }
};

export const SignOutWithRecordings: PageStory = {
  name: '11.13 Sign out with recordings waiting',
  ...page('/record', 'offline'),
  beforeEach: uploadsDown.begin,
  play: async ({ userEvent, step }) => {
    await step('With a recording made offline still waiting on this device, click Sign out', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Start recording/ }, LATER));
      await screen.findByText('00:06', {}, LATER);
      await userEvent.click(screen.getByRole('button', { name: 'Finish and save' }));
      await screen.findByText('Saved on this device. It uploads when you’re back online.', {}, LATER);
      // Back online, Alcove isn't taking uploads just now: the recording waits here.
      setOnline(true);
      await toSettings((el) => userEvent.click(el));
      await within(await row('On this device')).findByText(/^1 recording, .* waiting to upload\.$/, {}, LATER);
      await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    });
    await step('The sky opens under it and asks. Stay signed in has focus, and Escape is the same', async () => {
      const asking = '1 recording on this device hasn’t uploaded. Signing out deletes it.';
      await screen.findByText(asking, {}, SOON);
      await screen.findByRole('button', { name: 'Stay signed in' }, SOON);
      await userEvent.keyboard('{Escape}');
      await waitFor(() => { if (screen.queryByText(asking)) throw new Error('It’s still asking.'); }, SOON);
      await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
      await screen.findByText(asking, {}, SOON);
    });
    await step('Sign out and delete it: only this account’s recordings go', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Sign out and delete it' }));
    });
    await step('The welcome page, signed out', async () => {
      await welcome();
    });
  }
};

export const SignOutWithNothingWaiting: PageStory = {
  name: '11.14 Sign out with nothing waiting',
  ...page('/settings', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Nothing on this device, so Sign out asks nothing', async () => {
      await within(await row('On this device')).findByText('Nothing waiting', {}, SOON);
      await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    });
    await step('The welcome page, signed out', async () => {
      await welcome();
    });
    await step('Signed in again, with no connection Sign out says so. You stay signed in, and nothing happens later by itself', async () => {
      await userEvent.click(await welcome());
      await toSettings((el) => userEvent.click(el));
      setOnline(false);
      await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
      await screen.findByText('Can’t reach Alcove. Check your connection.', {}, SOON);
      setOnline(true);
      await screen.findByRole('heading', { name: 'Art Vandelay', level: 1 }, SOON);
    });
  }
};

export const DeleteAccount: PageStory = {
  name: '11.15 Delete account',
  ...page('/settings#privacy', 'busy'),
  beforeEach: slowDelete,
  play: async ({ userEvent, step }) => {
    await step('At the end of Privacy, click Delete account', async () => {
      await userEvent.click(within(await part('Privacy')).getByRole('button', { name: 'Delete account' }));
    });
    await step('The row opens in place: what goes beside what stays. Keep my account has focus', async () => {
      await screen.findByText('What goes', {}, SOON);
      await screen.findByText('What stays');
      await screen.findByRole('button', { name: 'Keep my account' });
    });
    await step('With no connection, or if it fails, it says so here. Delete my account tries again, and nothing happens later by itself', async () => {
      setOnline(false);
      await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
      await screen.findByText(/^That didn’t work\. Can’t reach Alcove/, {}, SOON);
      setOnline(true);
    });
    await step('Delete my account. It says Deleting until it’s done', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
      await screen.findByRole('button', { name: 'Deleting' }, SOON);
    });
    await step('The welcome page, signed out, even if you’d left Settings meanwhile', async () => {
      await userEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: /^Home/ }));
      await screen.findByText('Your account is deleted.', {}, LATER);
      await welcome();
    });
  }
};

export const WhenItCantBeDeleted: PageStory = {
  name: '11.16 When it can’t be deleted',
  ...page('/settings#privacy', 'busy'),
  beforeEach: demoAccount,
  play: async ({ userEvent, step }) => {
    await step('On the shared demo account, click Delete account', async () => {
      await userEvent.click(within(await part('Privacy')).getByRole('button', { name: 'Delete account' }));
    });
    await step('The row says it can’t be deleted, and offers only Close', async () => {
      await screen.findByText('This is the shared demo account, so it can’t be deleted.', {}, SOON);
      await userEvent.click(screen.getByRole('button', { name: 'Close' }));
      await within(await part('Privacy')).findByRole('button', { name: 'Delete account' }, SOON);
    });
  }
};

export const GetAround: PageStory = {
  name: '11.17 Get around',
  ...page('/settings', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('The index marks the part in view. Click Calendar', async () => {
      const index = await screen.findByRole('navigation', { name: 'Settings' }, LATER);
      await within(index).findByRole('link', { name: 'Profile', current: true }, SOON);
      await userEvent.click(within(index).getByRole('link', { name: 'Calendar' }));
    });
    await step('The page moves there, and the small sun goes with it', async () => {
      await within(screen.getByRole('navigation', { name: 'Settings' })).findByRole('link', { name: 'Calendar', current: true }, SOON);
    });
    await step('Take the tour, at the top', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Take the tour' }));
    });
    await step('Home opens and the tour plays again, one slide at a time', async () => {
      await screen.findByRole('dialog', { name: 'Start or schedule a call' }, LATER);
    });
  }
};

export const Appearance: PageStory = {
  name: '11.18 Appearance',
  ...page('/settings#appearance', 'busy'),
  globals: { theme: 'dark' },
  play: async ({ userEvent, step }) => {
    await step('Each choice is a small evening in its own colours. Click Light', async () => {
      await userEvent.click(within(await row('Theme')).getByRole('button', { name: 'Light' }));
    });
    await step('The whole page changes at once, and it’s kept in this browser', async () => {
      const theme = await row('Theme');
      await within(theme).findByText('Saved', {}, SOON);
      await within(theme).findByRole('button', { name: 'Light', pressed: true }, SOON);
    });
  }
};

export const TimeOfNotesLeft: PageStory = {
  name: '11.19 The time of notes left',
  ...page('/settings#plan', 'busy'),
  // Twelve minutes of notes left this month.
  beforeEach: before((w) => { w.credits = { balance: 300, granted: 10000, usedThisMonth: 9700, perMinute: 25 }; }),
  play: async ({ step }) => {
    await step('Nearly out, the sun is at the start of the line', async () => {
      await within(await row('Notes left')).findByText('12 min', {}, SOON);
    });
  }
};

export const HowYouSignedIn: PageStory = {
  name: '11.20 How you signed in',
  ...page('/settings', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('With Google: your name, address and photo come from there, and the link changes them', async () => {
      await within(await row('Name and photo')).findByRole('link', { name: 'Google account' }, SOON);
    });
    await step('Signed in with Microsoft, the same', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
      await userEvent.click(await welcome());
      await toSettings((el) => userEvent.click(el));
      await within(await row('Name and photo')).findByRole('link', { name: 'Microsoft account' }, SOON);
    });
    await step('With single sign-on there’s nowhere to link to', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
      await welcome();
      await userEvent.click(await first(screen.findAllByRole('button', { name: 'Use single sign-on' }, SOON)));
      await userEvent.type(await screen.findByRole('textbox', { name: 'Work email' }, SOON), 'art@vandelay.industries');
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await toSettings((el) => userEvent.click(el));
      await within(await row('Name and photo')).findByText('Single sign-on', {}, SOON);
    });
  }
};

export const WhenAPartDoesntLoad: PageStory = {
  name: '11.21 When a part doesn’t load',
  ...page('/settings', 'busy'),
  beforeEach: [prefsDown.begin, minutesDown.begin, calendarDown.begin, noHardware.begin],
  play: async ({ userEvent, step }) => {
    await step('Your preferences didn’t load. The rest of the page, and Sign out, still work', async () => {
      await within(await part('Notes, recording, calendar and notifications')).findByText('These didn’t load', {}, SOON);
      await screen.findByRole('button', { name: 'Sign out' });
      // Try again brings them back, the calendar with them.
      prefsDown.end();
      await userEvent.click(within(await part('Notes, recording, calendar and notifications')).getByRole('button', { name: 'Try again' }));
      await part('Notes');
    });
    await step('Your minutes didn’t load. The part stays, and says so', async () => {
      await within(await part('Plan and credits')).findByText('These didn’t load', {}, SOON);
    });
    await step('The calendar didn’t answer. Try again, in the row', async () => {
      const calendar = await row('Your calendar');
      await within(calendar).findByText('Google can’t be reached right now.', {}, SOON);
      calendarDown.end();
      await userEvent.click(within(calendar).getByRole('button', { name: 'Try again' }));
      await within(await row('Google Calendar')).findByText('Connected', {}, SOON);
    });
    await step('With no hardware answer to show, the row just says what it is', async () => {
      await within(await row('Confidential compute')).findByText('Where your audio is opened and your notes are written.', {}, LATER);
    });
  }
};

export const FirstDay: PageStory = {
  name: '11.22 First day',
  ...page('/settings', 'first-day', { parameters: { opening: { browser: { devices: 'prompt' } } } }),
  play: async ({ userEvent, step }) => {
    const jump = async (to: string) => userEvent.click(within(await screen.findByRole('navigation', { name: 'Settings' }, LATER)).getByRole('link', { name: to }));
    await step('The same page. Nothing’s waiting and nothing’s used', async () => {
      await within(await row('On this device')).findByText('Nothing waiting', {}, SOON);
      await within(await row('Used this month')).findByText('None yet', {}, SOON);
    });
    await step('Connect is there when you want it', async () => {
      await jump('Calendar');
      await within(await row('Google Calendar')).findByRole('button', { name: 'Connect' }, SOON);
    });
    await step('The browser doesn’t name your devices until they’re allowed, so there’s no list yet', async () => {
      await jump('Devices');
      await within(await row('Microphone')).findByText('Your browser asks first.', {}, SOON);
    });
    await step('Nothing asks the browser for anything until you press', async () => {
      await jump('Notifications');
      await within(await row('Browser notifications')).findByRole('button', { name: 'Enable browser notifications' }, SOON);
    });
    await step('All of your minutes, with the sun at the end of the line', async () => {
      await jump('Plan and credits');
      await within(await row('Notes left')).findByText('6 h 40 min', {}, SOON);
    });
  }
};

/** Sound preferences save independently of notification permissions. */
export const ChooseSounds: PageStory = {
  name: '11.20 Choose call sounds',
  ...page('/settings#sounds', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Choose quiet mode and preview the microphone confirmation', async () => {
      await userEvent.click(await screen.findByRole('switch', { name: 'Quiet mode' }, LATER));
      await userEvent.click(await screen.findByRole('button', { name: 'Preview sound' }, LATER));
    });
  }
};
