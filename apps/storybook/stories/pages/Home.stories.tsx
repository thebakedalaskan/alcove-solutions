/*
 * Home: the sunset with Start a call in the middle, and on the water three widgets: For you (To answer and Follow-ups),
 * Upcoming and Recent notes (docs/design/pages.md, user-flows 3; the design: docs/design/canvas/home).
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { setOnline } from '../../src/browser';
import { phone } from '../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import { on } from '../../src/world/clock';
import { STATES, withNotes } from '../../src/world/states';
import { calendarJustConnected, caughtUp, firstNotesWriting, givenByMaya, invited, noCalendar, notAttested, nothingToAnswer, otherMeetingsOff, takenOn, troubled, yourMeeting } from './changes';

const meta = { title: 'Pages/Home', ...pages } satisfies Meta<PageArgs>;
export default meta;

type Play = NonNullable<PageStory['play']>;
const NIGHT = { theme: 'dark' } as const;
const TABLET = { viewport: { value: 'tablet', isRotated: false } } as const;
const LAPTOP = { viewport: { value: 'laptop', isRotated: false } } as const;
const WIDE = { viewport: { value: 'wide', isRotated: false } } as const;
const SOON = { timeout: 8000 };

/** Opens For you's other tab. */
const toFollowUps: Play = async ({ canvas, userEvent, step }) => {
  await step('Open Follow-ups', async () => {
    await userEvent.click(await canvas.findByRole('tab', { name: /^Follow-ups/ }, SOON));
  });
};
/** Opens For you's To answer. */
const toAnswer: Play = async ({ canvas, userEvent, step }) => {
  await step('Open To answer', async () => {
    await userEvent.click(await canvas.findByRole('tab', { name: /^To answer/ }, SOON));
  });
};

/** Wednesday afternoon: eight things to answer in For you, the week ahead in Upcoming, and today's notes first in Recent notes. */
export const Busy = page('/home', 'busy');
export const BusyNight = page('/home', 'busy', { globals: NIGHT });
export const BusyPhone = phone(Busy);
export const BusyPhoneNight = { ...phone(Busy), globals: { viewport: { value: 'phone' }, ...NIGHT } };
/** Narrower than 1320px the widgets stack: For you, then Upcoming, then Recent notes. */
export const BusyTablet = page('/home', 'busy', { globals: TABLET });
/**
 * Eight minutes before the design review, on a wide screen: the foot of the side panel offers it with Join, under Team and
 * Agents, until Home's own line takes it at five minutes. Further off, the panel says nothing of the day: that's Upcoming.
 */
export const AboutToStartOnHome = page('/home', 'call-soon', { globals: WIDE, parameters: { opening: { now: on(0, 10, 22) } } });
export const AboutToStartOnHomeNight = page('/home', 'call-soon', { globals: { ...WIDE, ...NIGHT }, parameters: { opening: { now: on(0, 10, 22) } } });

/** Follow-ups: what Art took on, soonest first, each with the call it came from and the day it's due. */
export const FollowUpsTab = page('/home', 'busy', { beforeEach: changing(takenOn), play: toFollowUps });
export const FollowUpsTabNight = { ...FollowUpsTab, globals: NIGHT };
export const FollowUpsTabPhone = phone(FollowUpsTab);
/** Ticking a follow-up while its write is on its way: the day's place says Saving. */
const tickFollowUp: Play = async (ctx) => {
  await toFollowUps(ctx);
  await ctx.step('3.6 Tick a follow-up while the write is syncing', async () => {
    const [box] = await screen.findAllByRole('checkbox', { name: /^Mark done:/ }, SOON);
    if (box) await ctx.userEvent.click(box);
  });
};
const readyFollowUps = changing(takenOn, troubled({ 'notes.updateAction': 'hold' }));
export const FollowUpSaving = page('/home', 'busy', { beforeEach: readyFollowUps, play: tickFollowUp });
export const FollowUpSavingNight = { ...FollowUpSaving, globals: NIGHT };
export const FollowUpSavingPhone = phone(FollowUpSaving);
/** Nothing waiting on Art: Home's small sunset, and You're all caught up. */
export const AllCaughtUp = page('/home', 'busy', { beforeEach: changing(caughtUp) });
export const AllCaughtUpNight = { ...AllCaughtUp, globals: NIGHT };
/** Nothing to answer, with follow-ups open: For you opens on Follow-ups, and To answer says where they are. */
export const NothingToAnswer = page('/home', 'busy', { beforeEach: changing(nothingToAnswer), play: toAnswer });
/** Things to answer and no follow-ups taken on: Follow-ups says what shows up there. */
export const NoFollowUps = page('/home', 'busy', { play: toFollowUps });

/** Maya gave Art a follow-up: her face alone where the call's people were, From Maya in its tooltip, and the day it's for. */
export const GivenByMaya = page('/home', 'busy', {
  beforeEach: changing(givenByMaya),
  globals: LAPTOP,
  play: async ({ canvas, userEvent, step }) => {
    await step('Show 3 more: the pricing draft is further down', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Show 3 more' }, SOON));
    });
  }
});
/** Kofi says the launch date wasn't decided, on Art's own notes: Keep it confirmed, and the mark after the words says who says so. */
export const Disputed = page('/home', 'busy', { beforeEach: changing(withNotes(STATES.disputed)) });
/** Confirming a decision from its row: it says Confirmed, with Undo, until Home is left. */
export const Confirmed = page('/home', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Confirm the first decision. Everyone with the notes sees it confirmed', async () => {
      const [first] = await canvas.findAllByRole('button', { name: 'Confirm' }, SOON);
      if (first) await userEvent.click(first);
    });
  }
});
export const ConfirmedNight = { ...Confirmed, globals: NIGHT };
/** What backs a decision, from the mark after its words: what was said, each moment a way into the note. */
export const WhatWasSaid = page('/home', 'busy', {
  globals: LAPTOP,
  play: async ({ canvas, userEvent, step }) => {
    await step('Press the mark after the first decision’s words', async () => {
      const [mark] = await canvas.findAllByRole('button', { name: 'What was said' }, SOON);
      if (mark) await userEvent.click(mark);
      await screen.findByRole('dialog', { name: 'What was said' }, SOON);
    });
  }
});

/** Calls other people asked Art to: one to answer, one waiting for Jonas to pick a time, one where a time is being picked. */
export const Invitations = page('/home', 'busy', { beforeEach: changing(invited) });
/** A meeting Art organized on Google Calendar has Use Alcove; pressing a calendar meeting opens its menu. */
export const CalendarMeeting = page('/home', 'busy', {
  beforeEach: changing(yourMeeting),
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Ines’s product sync: its menu opens it in Google Calendar', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: /Product sync/ }, SOON));
      await screen.findByRole('link', { name: /Open in Google Calendar/ }, SOON);
    });
  }
});
/** Signed in with Google without sharing the calendar, with calls ahead: they show, and the way to connect is at Upcoming's foot. */
export const NoCalendar = page('/home', 'busy', { beforeEach: changing(noCalendar) });
export const NoCalendarNight = { ...NoCalendar, globals: NIGHT };
/** Back from Google without the calendar, with calls ahead: Upcoming's foot says so, with Try again. */
export const NoCalendarNotAllowed = page('/home?calendar=denied', 'busy', { beforeEach: changing(noCalendar) });
/** The calendar didn't load: the calls still show, and Upcoming's foot says so, with Try again. */
export const CalendarDidntLoad = page('/home', 'busy', { beforeEach: changing(troubled({ 'calendar.get': 'failed' })) });
/** The calendar didn't load with no calls ahead: Upcoming says so in its place, with Try again. */
export const CalendarDidntLoadNothingAhead = page('/home', 'first-day', { beforeEach: changing(troubled({ 'calendar.get': 'failed' })) });
/** Show my other meetings on Home off, with calls ahead and no calendar: the way to connect says what it does for your calls. */
export const OtherMeetingsOff = page('/home', 'busy', { beforeEach: changing(noCalendar, otherMeetingsOff) });
/** Other meetings off and the calendar doesn't load: Upcoming wasn't showing it, so it lists the calls and says nothing. */
export const OtherMeetingsOffDidntLoad = page('/home', 'busy', { beforeEach: changing(otherMeetingsOff, troubled({ 'calendar.get': 'failed' })) });

/** The first day: For you says what will show up, Upcoming is the way to connect the calendar, and Recent notes has the example. */
export const FirstDay = page('/home', 'first-day');
export const FirstDayNight = page('/home', 'first-day', { globals: NIGHT });
export const FirstDayPhone = phone(FirstDay);
export const FirstDayPhoneNight = { ...phone(FirstDay), globals: { viewport: { value: 'phone' }, ...NIGHT } };
/** The first day's Follow-ups: boxes to tick, not filled in yet. */
export const FirstDayFollowUps = page('/home', 'first-day', { play: toFollowUps });
/** The first day with other meetings off: connecting the calendar is for the calls you schedule. */
export const FirstDayOtherMeetingsOff = page('/home', 'first-day', { beforeEach: changing(otherMeetingsOff) });
/** Back from Google, the calendar connected: a toast says so, and the week's meetings rise into Upcoming. */
export const BackFromGoogle = page('/home?calendar=connected', 'first-day', { beforeEach: changing(calendarJustConnected) });
export const BackFromGoogleNight = { ...BackFromGoogle, globals: NIGHT };
export const BackFromGooglePhone = phone(BackFromGoogle);
/** Back from Google without the calendar: Upcoming says so, with Try again. Calls still work without it. */
export const GoogleDidntAllow = page('/home?calendar=denied', 'first-day');
export const GoogleDidntAllowNight = { ...GoogleDidntAllow, globals: NIGHT };
/** Back from Google, signed in there as someone else. */
export const WrongGoogleAccount = page('/home?calendar=account', 'first-day');
/** Back from Google, which couldn't connect the calendar. */
export const GoogleCouldntConnect = page('/home?calendar=failed', 'first-day');
/** The first call has ended: For you says its notes are being written, and its card breathes beside the example's until they are. */
export const FirstNotesWriting = page('/home', 'first-day', { beforeEach: changing(firstNotesWriting) });
/** Someone on their own: no team, notes from the room. */
export const OnTheirOwn = page('/home', 'on-their-own');
/** A note being written, first in Recent notes, and a walkthrough still recording on another device. */
export const Writing = page('/home', 'writing');
/** Lots of everything: Show more under For you and Upcoming, and Recent notes scrolls sideways. */
export const Lots = page('/home', 'lots');

/** The design review in four minutes: Home's own line offers it with Join, and its row in Upcoming counts down. */
export const CallSoon = page('/home', 'call-soon');
export const CallSoonNight = { ...CallSoon, globals: NIGHT };
/** Six minutes after the design review's time: Join still takes the filled button, and its row in Upcoming says Now. */
export const HappeningNow = page('/home', 'call-soon', { parameters: { opening: { now: on(0, 10, 36) } } });
/** Four minutes before the design review on a wide screen: Home's line is the one Join on screen, and the side panel's has made way. */
export const AboutToStartMakesWay = page('/home', 'call-soon', { globals: WIDE });
export const AboutToStartMakesWayNight = page('/home', 'call-soon', { globals: { ...WIDE, ...NIGHT } });

/** Opened without a connection: Home says it's offline, and Record still works. */
export const Offline = page('/home', 'offline');
/** The connection drops while Home is open: the side panel says recording still works, and the rest catches up later. */
export const ConnectionDrops = page('/home', 'busy', {
  play: async ({ canvas, step }) => {
    await step('The connection drops once Home is open', async () => {
      await canvas.findByRole('button', { name: /^Start now/ }, SOON);
      setOnline(false);
    });
  }
});
/**
 * Alcove is slow to answer: the calls ahead show in Upcoming, with the calendar on its way at its foot (and no Show more
 * until it comes), and the hardware check waits.
 */
export const StillLoading = page('/home', 'busy', { beforeEach: changing(troubled({ 'calendar.get': 'hold', 'trust.attestation': 'hold' })) });
export const StillLoadingPhone = phone(StillLoading);
/** The calendar on its way with no calls ahead: Upcoming waits, with a few faint bars. */
export const StillLoadingNothingAhead = page('/home', 'first-day', { beforeEach: changing(troubled({ 'calendar.get': 'hold' })) });
/** What's waiting on Art didn't load: For you says so, with Try again, and the rest of Home works. */
export const DidntLoad = page('/home', 'busy', { beforeEach: changing(troubled({ 'notes.inbox': 'failed' })) });
export const DidntLoadNight = { ...DidntLoad, globals: NIGHT };

/**
 * On the public beta the server says it doesn't run in a TEE: Home still says Confidential compute, and that audio,
 * transcripts and notes are sealed, with no time it was verified and no caveat (docs/design/principles.md › Copy).
 */
export const HostingNotAttestedPhone = phone(page('/home', 'busy', { beforeEach: notAttested }));
/** The same on a laptop: the side panel's check, at its foot, says Confidential compute without · verified. */
export const HostingNotAttested = page('/home', 'busy', { beforeEach: notAttested, globals: LAPTOP });
export const HostingNotAttestedNight = { ...HostingNotAttested, globals: { ...LAPTOP, ...NIGHT } };
/** The side panel hidden: the page has the room, and Home shows the confidential-compute check itself. A wide screen's: a phone has no side panel. */
export const PanelHidden = page('/home', 'busy', {
  globals: LAPTOP,
  play: async ({ canvas, userEvent, step }) => {
    await step('Hide the side panel', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Hide the side panel' }));
    });
  }
});
