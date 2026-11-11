/* Home: the sunset with Start a call in the middle, and what's yours on the water (docs/design/pages.md, user-flows 3). */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { setOnline } from '../../src/browser';
import { phone } from '../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import { on } from '../../src/world/clock';
import { STATES, withNotes } from '../../src/world/states';
import { invited, noCalendar, notAttested, takenOn, troubled } from './changes';

const meta = { title: 'Pages/Home', ...pages } satisfies Meta<PageArgs>;
export default meta;

export const Busy = page('/home', 'busy');
export const BusyPhone = phone(Busy);
/**
 * On the public beta the server says it doesn't run in a TEE: Home still says Confidential compute, and that audio,
 * transcripts and notes are sealed, with no time it was verified and no caveat (docs/design/principles.md › Copy).
 */
export const HostingNotAttestedPhone = phone(page('/home', 'busy', { beforeEach: notAttested }));
/** The same on a laptop: the side panel's check, at its foot, says Confidential compute without · verified. */
export const HostingNotAttested = page('/home', 'busy', { beforeEach: notAttested, globals: { viewport: { value: 'laptop', isRotated: false } } });
export const HostingNotAttestedNight = { ...HostingNotAttested, globals: { viewport: { value: 'laptop', isRotated: false }, theme: 'dark' } };
const tickFollowUp: NonNullable<PageStory['play']> = async ({ userEvent, step }) => {
  await step('3.7 Tick a follow-up while the write is syncing', async () => {
    const [box] = await screen.findAllByRole('checkbox', { name: /^Mark done:/ });
    if (box) await userEvent.click(box);
  });
};
const readyFollowUps = changing(takenOn, troubled({ 'notes.updateAction': 'hold' }));
export const FollowUpSaving = page('/home', 'busy', { beforeEach: readyFollowUps, play: tickFollowUp });
export const FollowUpSavingNight = { ...FollowUpSaving, globals: { theme: 'dark' } };
export const FollowUpSavingPhone = phone(FollowUpSaving);
export const FollowUpSavingPhoneNight = { ...phone(FollowUpSaving), globals: { viewport: { value: 'phone' }, theme: 'dark' } };
export const FirstDay = page('/home', 'first-day');
export const FirstDayPhone = phone(FirstDay);
/** The design review in four minutes: Home's own line offers it with Join, and the side panel's Up next makes way for it. */
export const CallSoon = page('/home', 'call-soon');
/** The design review started six minutes ago: Happening now, and Join takes the filled button. */
export const HappeningNow = page('/home', 'call-soon', { parameters: { opening: { now: on(0, 10, 36) } } });

/** On a wide screen, the side panel's Up next on Home too: the design sync at 17:30, its countdown and Join. */
const WIDE = { viewport: { value: 'wide', isRotated: false } } as const;
export const UpNextOnHome = page('/home', 'busy', { globals: WIDE });
export const UpNextOnHomeNight = page('/home', 'busy', { globals: { ...WIDE, theme: 'dark' } });
/** Four minutes before the design review: Home's line is the one Join on screen, and Up next has made way. */
export const UpNextMakesWay = page('/home', 'call-soon', { globals: WIDE });
export const UpNextMakesWayNight = page('/home', 'call-soon', { globals: { ...WIDE, theme: 'dark' } });
export const OnTheirOwn = page('/home', 'on-their-own');
export const Writing = page('/home', 'writing');
export const Offline = page('/home', 'offline');
export const Lots = page('/home', 'lots');

/** Signed in with Google without sharing the calendar: a card offers to connect it. */
export const NoCalendar = page('/home', 'busy', { beforeEach: changing(noCalendar) });
/** Calls other people asked Art to: one to answer, one waiting for Jonas to pick a time, one where a time is being picked. */
export const Invitations = page('/home', 'busy', { beforeEach: changing(invited) });
/** Kofi says the launch date wasn't decided, on Art's own notes: Disputed, with Keep it confirmed. */
export const Disputed = page('/home', 'busy', { beforeEach: changing(withNotes(STATES.disputed)) });

/** Confirming a decision from its tile: it says what was done, with Undo, until Home is left. */
export const Confirmed = page('/home', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Confirm the first decision. Everyone with the notes sees it confirmed', async () => {
      const [first] = await canvas.findAllByRole('button', { name: 'Confirm' });
      if (first) await userEvent.click(first);
    });
  }
});
/** A meeting on the calendar, not an Alcove call: its menu opens it in Google Calendar. */
export const CalendarMeeting = page('/home', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Open the menu of Ines’s product sync: it opens in Google Calendar', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'More for Product sync' }));
      await screen.findByRole('link', { name: /Open in Google Calendar/ });
    });
  }
});
/** The side panel hidden: the page has the room, and Home shows the confidential-compute check itself. A wide screen's: a phone has no side panel. */
export const PanelHidden = page('/home', 'busy', {
  globals: { viewport: { value: 'laptop', isRotated: false } },
  play: async ({ canvas, userEvent, step }) => {
    await step('Hide the side panel', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Hide the side panel' }));
    });
  }
});
/** The connection drops while Home is open: the side panel says recording still works, and the rest catches up later. */
export const ConnectionDrops = page('/home', 'busy', {
  play: async ({ canvas, step }) => {
    await step('The connection drops once Home is open', async () => {
      await canvas.findByRole('button', { name: /^Start now/ }, { timeout: 8000 });
      setOnline(false);
    });
  }
});

/** Alcove is slow to answer: the calendar and the hardware check are still on their way. */
export const StillLoading = page('/home', 'busy', { beforeEach: changing(troubled({ 'calendar.get': 'hold', 'trust.attestation': 'hold' })) });
export const StillLoadingPhone = phone(StillLoading);
/** Alcove couldn't answer: the page didn't load, with Try again. */
export const DidntLoad = page('/home', 'busy', { beforeEach: changing(troubled({ 'notes.inbox': 'failed' })) });
