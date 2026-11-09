/* Home: the sunset with Start a call in the middle, and what's yours on the water (docs/design/pages.md, user-flows 3). */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { standIn } from '../../src/api/standin';
import { setOnline } from '../../src/browser';
import { phone } from '../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import { on } from '../../src/world/clock';
import { STATES, withNotes } from '../../src/world/states';
import { swap } from '../journeys/play';
import { invited, noCalendar, takenOn, troubled } from './changes';

const meta = { title: 'Pages/Home', ...pages } satisfies Meta<PageArgs>;
export default meta;

export const Busy = page('/home', 'busy');
export const BusyPhone = phone(Busy);
/** On the public beta, the server reports that it does not run in a TEE. */
export const HostingNotAttestedPhone = phone(page('/home', 'busy', {
  beforeEach: () => swap(standIn.trust, 'attestation', async (nonce) => ({ tee: 'none', nonce, build: { commit: 'storybook' } }))
}));
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
export const CallSoon = page('/home', 'call-soon');
/** The design review started six minutes ago: Happening now, and Join takes the filled button. */
export const HappeningNow = page('/home', 'call-soon', { parameters: { opening: { now: on(0, 10, 36) } } });
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
