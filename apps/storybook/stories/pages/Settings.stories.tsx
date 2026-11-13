/*
 * Settings: change one thing and leave. Seven groups of panels with an index beside them, which on a narrow screen is a
 * strip at the top (user-flows 11). An address names a group (#you, #calls, #audio, #notifications, #connections, #plan,
 * #privacy) or a place inside one that other pages link to (#recording, #calendar, #google-drive, #agents).
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { phone } from '../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import { withTopUp } from '../../src/world/payments';
import { withDriveJustConnected, withDriveReconnect } from '../../src/world/drive-exports';
import type { World } from '../../src/world';
import { checkFails, keptHere, noCalendar, notAttested, sharedDemo, troubled, unencryptedDefault } from './changes';

const meta = { title: 'Pages/Settings', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** The same story at night. */
const night = (story: PageStory): PageStory => ({ ...story, globals: { ...story.globals, theme: 'dark' } });
/** The same story on a phone at night. */
const phoneNight = (story: PageStory): PageStory => night(phone(story));

/** Presses a button on the page, as a person would. */
const pressing = (name: string | RegExp, said: string): NonNullable<PageStory['play']> => async ({ canvas, userEvent, step }) => {
  await step(said, async () => {
    await userEvent.click(await canvas.findByRole('button', { name }, { timeout: 8000 }));
  });
};

/* ------------------------------------------------------------------ the page, as it opens */
export const Busy = page('/settings', 'busy');
export const BusyNight = night(Busy);
/** On a phone the index is a strip that stays at the top. */
export const BusyPhone = phone(Busy);
export const BusyPhoneNight = phoneNight(Busy);
/** The first day: nothing waits on this device, nothing's used, no calendar yet, and the browser hasn't been asked for anything. */
export const FirstDay = page('/settings', 'first-day', { parameters: { opening: { browser: { devices: 'prompt' } } } });
export const FirstDayNight = night(FirstDay);
export const FirstDayPhone = phone(FirstDay);
/** At a personal address: no team, so no company to open. */
export const OnTheirOwn = page('/settings', 'on-their-own');
export const Lots = page('/settings', 'lots');

/* ------------------------------------------------------------------ each group, as a link lands on it */
export const You = page('/settings#you', 'busy');
export const YouNight = night(You);
export const CallsAndNotes = page('/settings#calls', 'busy');
export const CallsAndNotesNight = night(CallsAndNotes);
export const CallsAndNotesPhone = phone(CallsAndNotes);
/** From Record: recording in the room, with what waits on this device to upload and See them. */
export const RecordingInTheRoom = page('/settings#recording', 'busy', { beforeEach: changing(keptHere) });
export const RecordingInTheRoomNight = night(RecordingInTheRoom);
export const AudioAndVideo = page('/settings#audio', 'busy');
export const AudioAndVideoNight = night(AudioAndVideo);
export const AudioAndVideoPhone = phone(AudioAndVideo);
export const Notifications = page('/settings#notifications', 'busy');
export const NotificationsNight = night(Notifications);
export const Connections = page('/settings#connections', 'busy');
export const ConnectionsNight = night(Connections);
/** From the minutes in the side panel. */
export const PlanAndCredits = page('/settings#plan', 'busy');
export const PlanAndCreditsNight = night(PlanAndCredits);
/** Confidential compute, with the time this browser checked the server: its token and its release in the public log. */
export const Privacy = page('/settings#privacy', 'busy');
export const PrivacyNight = night(Privacy);
export const PrivacyPhone = phone(Privacy);
/** The server says it doesn't run in a TEE: Confidential compute just says what it is, with no caveat. */
export const PrivacyNotAttested = page('/settings#privacy', 'busy', { beforeEach: notAttested });
export const PrivacyNotAttestedNight = night(PrivacyNotAttested);
/**
 * The server is in confidential compute, but this browser's check of it didn't pass: the row says why, beside a shield
 * without its tick, and nothing is blocked. One story for each kind of reason (`checkFails` in changes.ts).
 */
export const PrivacyCheckFailedRoot = page('/settings#privacy', 'busy', { name: 'Privacy, check failed: not Google’s root', beforeEach: checkFails('another-root') });
export const PrivacyCheckFailedOld = page('/settings#privacy', 'busy', { name: 'Privacy, check failed: an old token', beforeEach: checkFails('too-old') });
export const PrivacyCheckFailedDebug = page('/settings#privacy', 'busy', { name: 'Privacy, check failed: could be debugged', beforeEach: checkFails('debuggable') });
export const PrivacyCheckFailedBuild = page('/settings#privacy', 'busy', { name: 'Privacy, check failed: another build', beforeEach: checkFails('another-build') });
export const PrivacyCheckFailedLog = page('/settings#privacy', 'busy', { name: 'Privacy, check failed: not in the public log', beforeEach: checkFails('unreleased') });
export const PrivacyCheckFailedLogNight = { ...night(PrivacyCheckFailedLog), name: 'Privacy, check failed: not in the public log, at night' };
export const PrivacyCheckFailedLogPhone = phone(PrivacyCheckFailedLog);

/* ------------------------------------------------------------------ calls and notes */
/** An AI model that isn't in a secure enclave is the default: Unencrypted shows on the choice and in the list, and the row says what that means. */
export const UnencryptedModel = page('/settings#calls', 'busy', { beforeEach: changing(unencryptedDefault) });
export const UnencryptedModelNight = night(UnencryptedModel);
/** The AI model list: which models are outside a secure enclave, said on each. */
export const AiModelList = page('/settings#calls', 'busy', { play: pressing(/^AI model/, 'Open the AI model list') });
export const AiModelListNight = night(AiModelList);
export const AiModelListPhone = phone(AiModelList);

/* ------------------------------------------------------------------ audio and video */
/** Devices not allowed yet: the browser names them only once they are, so there's no list. */
export const AudioNotAllowedYet = page('/settings#audio', 'busy', { parameters: { opening: { browser: { devices: 'prompt' } } } });
/** Devices the browser blocks. */
export const AudioBlocked = page('/settings#audio', 'busy', { parameters: { opening: { browser: { devices: 'denied' } } } });
export const AudioBlockedNight = night(AudioBlocked);
/** Check the level: the microphone opens for eight seconds and its level moves; nothing is recorded. */
export const CheckingTheLevel = page('/settings#audio', 'busy', { play: pressing(/Check the level/, 'Press Check the level') });
export const CheckingTheLevelNight = night(CheckingTheLevel);

/* ------------------------------------------------------------------ saving */
/** Turns a setting off, which saves at once. */
const turningOff: NonNullable<PageStory['play']> = async ({ canvas, userEvent, step }) => {
  await step('Turn off Record without a connection. It saves at once', async () => {
    await userEvent.click(await canvas.findByRole('switch', { name: 'Record without a connection' }, { timeout: 8000 }));
  });
};
/** Every control saves as it changes: Saved shows for a moment, just left of the control. */
export const Saved = page('/settings#recording', 'busy', { play: turningOff });
/** A change Alcove refuses goes back, and a toast says why. */
export const SaveRefused = page('/settings#recording', 'busy', { beforeEach: changing(troubled({ 'account.updatePreferences': 'failed' })), play: turningOff });
/** The selected setting changes while its own write is still pending. Later choices stay usable. */
export const Saving = page('/settings#recording', 'busy', { beforeEach: changing(troubled({ 'account.updatePreferences': 'hold' })), play: turningOff });
export const SavingNight = night(Saving);
export const SavingPhone = phone(Saving);
export const SavingPhoneNight = phoneNight(Saving);
export const SaveRefusedNight = night(SaveRefused);
export const SaveRefusedPhone = phone(SaveRefused);
export const SaveRefusedPhoneNight = phoneNight(SaveRefused);

/* ------------------------------------------------------------------ the way out */
/** Sign out, with recordings on this device that haven't uploaded: the sky grows to ask first, and Stay signed in is the answer it offers. */
export const SignOutAsks = page('/settings', 'busy', { beforeEach: changing(keptHere), play: pressing('Sign out', 'Press Sign out. Recordings here haven’t uploaded, so it asks first') });
export const SignOutAsksNight = night(SignOutAsks);
export const SignOutAsksPhone = phone(SignOutAsks);
/** Delete account opens in place, in its own panel: what goes beside what stays, and Keep my account has the focus. */
export const DeleteOpened = page('/settings#privacy', 'busy', { play: pressing('Delete account', 'Press Delete account') });
export const DeleteOpenedNight = night(DeleteOpened);
export const DeleteOpenedPhone = phone(DeleteOpened);
/** The shared demo account can't be deleted, and says so as soon as Delete account is pressed. */
export const DemoCantBeDeleted = page('/settings#privacy', 'busy', { beforeEach: changing(sharedDemo), play: pressing('Delete account', 'Press Delete account') });

/* ------------------------------------------------------------------ loading and failures */
/** Alcove is slow to answer: the calendar and the hardware check are still on their way, and the rest of the page works. */
export const StillLoading = page('/settings', 'busy', { beforeEach: changing(troubled({ 'calendar.get': 'hold', 'trust.attestation': 'hold' })) });
/** Panels that didn't load say so in their groups, with Try again, and the rest of the page still works. */
export const PanelsDidntLoad = page('/settings', 'busy', { beforeEach: changing(troubled({ 'account.preferences': 'failed', 'credits.balance': 'failed' })) });
export const PanelsDidntLoadNight = night(PanelsDidntLoad);
export const PanelsDidntLoadPhone = phone(PanelsDidntLoad);
/** Opened without a connection: Settings needs one, and Record still works. */
export const Offline = page('/settings', 'offline');

/* ------------------------------------------------------------------ connections */
/** Signed in with Google without sharing the calendar: Connect. */
export const NoCalendar = page('/settings#calendar', 'busy', { beforeEach: changing(noCalendar) });
/** Back from Google's consent, connected: the calendar says so under its row. */
export const CalendarConnected = page('/settings?calendar=connected#calendar', 'busy');
/** Back without granting access: you can still schedule and share the link, and Connect is still there. */
export const CalendarAccessDenied = page('/settings?calendar=denied#calendar', 'busy', { beforeEach: changing(noCalendar) });
/** Back with another Google account than the one you sign in with. */
export const CalendarWrongAccount = page('/settings?calendar=account#calendar', 'busy', { beforeEach: changing(noCalendar) });
export const CalendarConnectionFailed = page('/settings?calendar=failed#calendar', 'busy', { beforeEach: changing(noCalendar) });
/** The shared demo account: a sample calendar in place of Google's, its switches nested under it. */
export const DemoAccount = page('/settings#calendar', 'busy', { beforeEach: changing(sharedDemo) });
/** The calendar didn't answer: why, and Try again. */
export const CalendarDidntAnswer = page('/settings#calendar', 'busy', { beforeEach: changing(troubled({ 'calendar.get': 'failed' })) });

/** Opens Google Drive in place. */
const managingDrive: NonNullable<PageStory['play']> = async ({ userEvent, step }) => {
  await step('Press Manage beside Google Drive', async () => {
    // Drive's row says Looking… until Google answers, then becomes the line with Manage.
    await userEvent.click(await screen.findByRole('button', { name: 'Manage' }, { timeout: 8000 }));
  });
};
/** Opens Google Drive, then its folder. */
const pickingFolder: NonNullable<PageStory['play']> = async (context) => {
  await managingDrive(context);
  await context.step('Press the folder: Drive’s folders open', async () => {
    await context.userEvent.click(await within(await screen.findByRole('group', { name: 'Folder' }, { timeout: 8000 })).findByRole('button', {}, { timeout: 8000 }));
  });
};
/** Drive connects on its own, apart from signing in, and never shows a provider credential. */
export const GoogleDriveDisconnected = page('/settings#google-drive', 'busy');
/** Set up: one line that says where notes go after each call. */
export const GoogleDriveExports = page('/settings#google-drive', 'drive-connected');
export const GoogleDriveExportsNight = night(GoogleDriveExports);
/** Manage opens the folder, the files, exporting after each call, what went lately and Disconnect, in place. */
export const GoogleDriveOpen = page('/settings#google-drive', 'drive-connected', { play: managingDrive });
export const GoogleDriveOpenNight = night(GoogleDriveOpen);
export const GoogleDriveOpenPhone = phone(GoogleDriveOpen);
/** Back from Google, just connected: the page lands on Drive, open, and says so inside it, with no folder chosen yet. */
export const GoogleDriveJustConnected = page('/settings?drive=connected', 'busy', { beforeEach: changing(withDriveJustConnected) });
export const GoogleDriveJustConnectedNight = night(GoogleDriveJustConnected);
export const GoogleDriveJustConnectedPhone = phone(GoogleDriveJustConnected);
/** Exports off: the line says nothing goes until they're on again. */
const paused = (w: World): void => { w.drive = { ...w.drive, settings: { ...w.drive.settings, enabled: false } }; };
export const GoogleDrivePaused = page('/settings#google-drive', 'drive-connected', { beforeEach: changing(paused) });
/** Opens Drive and turns Export after each call on. */
const exportingAgain: NonNullable<PageStory['play']> = async (context) => {
  await managingDrive(context);
  await context.step('Turn on Export after each call', async () => {
    await context.userEvent.click(await screen.findByRole('switch', { name: 'Export after each call' }, { timeout: 8000 }));
  });
};
/** The change waits on Alcove: the switch has moved, and the row says Saving…. */
export const GoogleDriveSaving = page('/settings#google-drive', 'drive-connected', { beforeEach: changing(paused, troubled({ 'drive.update': 'hold' })), play: exportingAgain });
/** Alcove refuses it: the switch goes back, the row says Couldn’t confirm, and a toast says why. */
export const GoogleDriveSaveRefused = page('/settings#google-drive', 'drive-connected', { beforeEach: changing(paused, troubled({ 'drive.update': 'failed' })), play: exportingAgain });
export const GoogleDriveReconnect = page('/settings#google-drive', 'busy', { beforeEach: changing(withDriveReconnect) });
export const GoogleDriveUnavailable = page('/settings#google-drive', 'busy', { beforeEach: changing(troubled({ 'drive.get': 'failed' })) });
export const GoogleDriveLoading = page('/settings#google-drive', 'busy', { beforeEach: changing(troubled({ 'drive.get': 'hold' })) });
export const GoogleDriveFolderPicker = page('/settings#google-drive', 'drive-connected', { play: pickingFolder });
/** The folder list can't be loaded; the folder stays as it was. */
export const GoogleDriveFolderUnavailable = page('/settings#google-drive', 'drive-connected', { beforeEach: changing(troubled({ 'drive.folders': 'failed' })), play: pickingFolder });
/** Presses Drive's own button on its line: Connect, or Reconnect. */
const askingDrive = (name: string, said: string): NonNullable<PageStory['play']> => async ({ userEvent, step }) => {
  await step(said, async () => {
    // Drive's row says Looking… until Google answers, then becomes the line with its button.
    await userEvent.click(await within(await screen.findByRole('group', { name: 'Google Drive' }, { timeout: 8000 })).findByRole('button', { name }, { timeout: 8000 }));
  });
};
/** Connect first says what Google shares and what Alcove sends, before anything goes to Google. */
export const GoogleDrivePermission = page('/settings#google-drive', 'busy', { play: askingDrive('Connect', 'Open the Drive permission disclosure') });
export const GoogleDrivePermissionPhone = phone(GoogleDrivePermission);
export const GoogleDriveReconnectPermission = page('/settings#google-drive', 'busy', {
  beforeEach: changing(withDriveReconnect),
  play: askingDrive('Reconnect', 'Open the Drive permission disclosure before reconnecting')
});
/** Google's way back lands on Drive, and says how it went. */
export const GoogleDriveConsentCancelled = page('/settings?drive=cancelled', 'busy');
export const GoogleDriveConsentFailed = page('/settings?drive=failed', 'drive-connected');
/** A way back that says connected says so only while the connection still is. */
export const GoogleDriveDisconnectedAfterReturn = page('/settings?drive=connected', 'busy');
export const GoogleDriveDisconnectAfterReturn = page('/settings?drive=connected', 'drive-connected', {
  play: async ({ userEvent, step }) => {
    await step('Back from Google, Drive is open and says it’s connected', async () => {
      await screen.findByText(/^Google Drive is connected/, {}, { timeout: 8000 });
    });
    await step('Disconnect Google Drive. What Google’s way back said goes with the connection, though the address still says it', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Disconnect Google Drive' }, { timeout: 8000 }));
      await screen.findByRole('button', { name: 'Connect' }, { timeout: 8000 });
    });
  }
});

/** No agents yet: the row says what they're for, and Connect an agent opens Agents. */
export const AgentsNone = page('/settings#agents', 'busy');
export const AgentsNoneNight = night(AgentsNone);
/** Agents is one row: who's connected, and Open Agents, where they're connected and changed. */
export const AgentsConnected = page('/settings#agents', 'agents-connected');
export const AgentsConnectedNight = night(AgentsConnected);
/** On a phone the row is the way to Agents, since the tab bar keeps its five. */
export const AgentsConnectedPhone = phone(AgentsConnected);
export const AgentsConnectedPhoneNight = phoneNight(AgentsConnected);
/** Until the connections are in, or when they don't come, the row says what agents are for, and opens Agents all the same. */
export const AgentsLoading = page('/settings#agents', 'busy', { beforeEach: changing(troubled({ 'agents.list': 'hold' })) });
export const AgentsUnavailable = page('/settings#agents', 'busy', { beforeEach: changing(troubled({ 'agents.list': 'failed' })) });

/* ------------------------------------------------------------------ notifications */
/** The browser hasn't been asked: alerts still show inside Alcove, and Turn on is the only thing that asks it. */
export const NotificationsNotAsked = page('/settings#notifications', 'busy');
export const NotificationsNotAskedNight = night(NotificationsNotAsked);
/** Allowed: browser notifications are a switch, and alerts reach you when Alcove is in another tab. */
export const NotificationsAllowed = page('/settings#notifications', 'busy', { parameters: { opening: { browser: { notifications: 'granted' } } } });
export const NotificationsAllowedNight = night(NotificationsAllowed);
export const NotificationsAllowedPhone = phone(NotificationsAllowed);
export const NotificationsAllowedPhoneNight = phoneNight(NotificationsAllowed);
/** The browser blocks them: the row says where to allow them, and every tick still works inside Alcove. */
export const NotificationsBlocked = page('/settings#notifications', 'busy', { parameters: { opening: { browser: { notifications: 'denied' } } } });
export const NotificationsBlockedNight = night(NotificationsBlocked);
/** A browser that can't show them. */
export const NotificationsUnsupported = page('/settings#notifications', 'busy', { parameters: { opening: { browser: { notificationTransport: 'unsupported' } } } });
/** The browser's own question, as a real browser asks it, on the first day. */
export const NativeBrowserPermission = page('/settings#notifications', 'first-day', { parameters: { opening: { browser: { notificationTransport: 'native' } } } });
/** Sounds off: the Sound column steps back and keeps its ticks for when they're on again. */
export const SoundsOff = page('/settings#notifications', 'busy', { beforeEach: changing((w) => { w.prefs = { ...w.prefs, sounds: { ...w.prefs.sounds, enabled: false } }; }) });
export const SoundsOffNight = night(SoundsOff);
export const SoundsOffPhone = phone(SoundsOff);
/** Quiet mode: only your microphone and requests to join make a sound. */
export const QuietMode = page('/settings#notifications', 'busy', { beforeEach: changing((w) => { w.prefs = { ...w.prefs, sounds: { ...w.prefs.sounds, quiet: true } }; }) });
/** Mentions alert you no more, and still make a sound: each way is its own tick. */
export const MentionAlertsOff = page('/settings#notifications', 'busy', { beforeEach: changing((w) => { w.prefs = { ...w.prefs, notifications: { ...w.prefs.notifications, chatMentions: false } }; }) });
/** A tick saves at once, and Saved shows on its row. */
export const TickSaved = page('/settings#notifications', 'busy', {
  play: async ({ userEvent, step }) => {
    await step('Untick Sound for People joining and leaving', async () => {
      await userEvent.click(await screen.findByRole('checkbox', { name: 'People joining and leaving: sound' }, { timeout: 8000 }));
    });
  }
});
export const TickSavedNight = night(TickSaved);

/** Change two different ticks while the first write waits; only the first is refused. */
export const NotificationLeafRefused = page('/settings#notifications', 'busy', {
  parameters: { opening: { latency: 2500, browser: { notifications: 'granted', sharedNotificationBrowser: true } } },
  beforeEach: changing((world) => {
    let first = true;
    world.prefs.notifications = { ...world.prefs.notifications, enabled: true, privateMessages: true, questions: false };
    world.trouble = { ...world.trouble, 'account.updatePreferences': () => { if (!first) return null; first = false; return 'failed'; } };
  })
});

/* ------------------------------------------------------------------ plan and credits */
/** Payments are separate from the default server-without-a-treasury scenario. Every address is an invalid preview. */
export const Payments = page('/settings#plan', 'payments');
export const PaymentsNight = night(Payments);
export const PaymentsUnavailable = page('/settings#plan', 'busy');
/** Nearly out: twelve minutes of notes left, and the sun at the start of the line. */
export const NotesNearlyOut = page('/settings#plan', 'busy', { beforeEach: changing((w) => { w.credits = { balance: 300, granted: 10000, usedThisMonth: 9700, perMinute: 25 }; }) });
/** None left: the sun has set, and a little of its light is left at the start of the line. */
export const NoNotesLeft = page('/settings#plan', 'busy', { beforeEach: changing((w) => { w.credits = { balance: 0, granted: 10000, usedThisMonth: 10000, perMinute: 25 }; }) });
export const NoNotesLeftNight = night(NoNotesLeft);
export const AddCreditsPicker = page('/settings#plan', 'payments', { play: pressing('Add credits', 'Choose how many credits, then a token and network') });
export const AddCreditsPickerNight = night(AddCreditsPicker);
export const AddCreditsPickerPhone = phone(AddCreditsPicker);
export const AddCreditsPickerPhoneNight = phoneNight(AddCreditsPicker);

const openTopUp: NonNullable<PageStory['play']> = async ({ userEvent, step }) => {
  await step('Reopen the payment from Plan and credits', async () => {
    const plan = await screen.findByRole('region', { name: 'Plan and credits' }, { timeout: 8000 });
    await userEvent.click(await within(plan).findByRole('button', { name: 'Open' }, { timeout: 8000 }));
  });
};
/** A top-up on its way, under Add credits, with Open and cancel. */
export const TopUpOnItsWay = page('/settings#plan', 'payments', { beforeEach: changing(withTopUp('waiting')) });
export const TopUpOnItsWayPhone = phone(TopUpOnItsWay);
export const PaymentWaiting = page('/settings#plan', 'payments', { beforeEach: changing(withTopUp('waiting')), play: openTopUp });
export const PaymentWaitingNight = night(PaymentWaiting);
export const PaymentWaitingPhone = phone(PaymentWaiting);
export const PaymentWaitingPhoneNight = phoneNight(PaymentWaiting);
export const PaymentArriving = page('/settings#plan', 'payments', { beforeEach: changing(withTopUp('arriving')), play: openTopUp });
export const PaymentShort = page('/settings#plan', 'payments', { beforeEach: changing(withTopUp('short')), play: openTopUp });
/** The address has expired while 1Click is still reporting the short payment: no instruction to send more. */
export const PaymentShortExpired = page('/settings#plan', 'payments', { beforeEach: changing(withTopUp('short', true)), play: openTopUp });
export const PaymentShortExpiredPhoneNight = phoneNight(PaymentShortExpired);
export const PaymentCredited = page('/settings#plan', 'payments', { beforeEach: changing(withTopUp('credited')), play: openTopUp });
/** Finished payments stay reachable so their support reference can be opened after closing the sheet. */
export const PaymentFailed = page('/settings#plan', 'payments', { beforeEach: changing(withTopUp('failed')), play: openTopUp });
export const PaymentHeld = page('/settings#plan', 'payments', { beforeEach: changing(withTopUp('held')), play: openTopUp });
export const PaymentCancelled = page('/settings#plan', 'payments', { beforeEach: changing(withTopUp('cancelled')), play: openTopUp });
export const PaymentExpired = page('/settings#plan', 'payments', { beforeEach: changing(withTopUp('expired', true)), play: openTopUp });
export const DeleteWithPaymentOnItsWay = page('/settings#privacy', 'payments', {
  beforeEach: changing(withTopUp('arriving')), play: pressing('Delete account', 'Deletion warns that an arriving payment cannot be credited after the account is gone')
});
export const DeleteWithCancelledAddress = page('/settings#privacy', 'payments', {
  beforeEach: changing(withTopUp('cancelled')), play: pressing('Delete account', 'A cancelled address can still receive money until it expires')
});

/* ------------------------------------------------------------------ privacy */
/** Privacy opens the same policy anyone can read from the welcome page. */
export const PrivacyPolicy = page('/settings#privacy', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Open Privacy policy from Settings', async () => {
      await userEvent.click(await canvas.findByRole('link', { name: 'Privacy policy' }));
    });
  }
});
