/*
 * Scheduling, on the Calls page (user-flows 4; docs/superpowers/specs/2026-11-13-scheduling-rethought-design.md): one sheet,
 * the week on the left and the call's editor on the right. It opens on the soonest half hour you're free, follows the people
 * you add until you pick a time yourself, and goes wherever the week is pressed or the call dragged, keeping its length. A clash
 * says who's busy and offers Next free. The same editor lets a guest from outside pick from times you offer, moves a call, asks
 * to move one you're invited to, and starts from a call that happened. On a phone there's no week: the editor is the page.
 *
 * The busy afternoon, Wednesday 4 November at 16:12, so the week runs 4 – 10 Nov. Art is free from 09:00 tomorrow; with Priya,
 * from 10:00; and with Priya and Kofi, not until 14:00. At 12:00 only Priya is busy (src/world/scheduling.ts).
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { phone } from '../../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../../src/page';
import {
  adding, choice, halfHour, oneOf, picking, playing, pointAt, pressing, pressingAt, saying, says, scrollHours, SOON, switchFor, thatsEveryone, timeField, typingIn,
  typingTime, whoField, type Step
} from '../../../src/scheduling';
import type { World } from '../../../src/world/world';
import { call } from '../../../src/world/build';
import { iso } from '../../../src/world/clock';
import { FRIDAY, HIRING_SYNC, DESIGN_CRIT, THURSDAY, withDesignCrit, withHiringSync } from '../../../src/world/scheduling';
import { noCalendar, troubled } from '../changes';

const meta = { title: 'Pages/Calls/Scheduling', ...pages } satisfies Meta<PageArgs>;
export default meta;

const NEW = '/calls?schedule=new';
const night = { theme: 'dark' } as const;
const at = (value: 'tablet' | 'wide') => ({ viewport: { value, isRotated: false } });

/** Priya and Kofi, from the people under Who, and their calendars read. */
const priyaAndKofi: Step[] = [
  adding(/^Priya Raman/, 'Add Priya, from Often with you. Her busy times are hatched on the week, and the call moves to the soonest you’re both free'),
  adding(/^Kofi Asante/, 'Then Kofi, from Add someone else. It moves again, to the soonest the three of you are free'),
  thatsEveryone,
  saying(/soonest time you.re all free/i, 'Their calendars are read: the soonest time you’re all free, said under the time')
];
/** Jonas, from outside, typed in by his address, and said to be in Berlin. */
const jonasInBerlin: Step[] = [
  typingIn('jonas@weber.design', 'Type Jonas’s address. He’s outside Vandelay, so his calendar can’t be read: Let Jonas pick the time is there, and off'),
  thatsEveryone,
  async ({ userEvent, step }) => {
    await step('Press Where? on his token, and say he’s in Berlin', async () => {
      await userEvent.click(await oneOf(['button', 'combobox'], /^Where Jonas is/));
      await userEvent.click(await choice('Berlin'));
    });
  }
];
const lettingJonasPick: Step = async ({ userEvent, step }) => {
  await step('Turn on Let Jonas pick the time: three times to offer, the first lit, here and on the week', async () => {
    await userEvent.click(await switchFor(/^Let Jonas pick the time/));
  });
};
const timeTwo = pressing(/^Time 2:/, 'Press the second time: it’s the one the week moves now, and its tick stays as it was');

/** A demo account's calendar: it holds the call and sends the invitations itself. */
const onASampleCalendar = (w: World): void => { w.calendar = { ...w.calendar, source: 'sample' }; };
/** Friday at 13:00, a call of Art's with nobody else on it. */
const PLANNING = call({ id: 'm-planning', title: 'Planning', startsAt: iso(FRIDAY, 13, 0), minutes: 60, code: 'pln-ning-art', guests: [] });
const withPlanning = (w: World): void => { w.meetings = [...w.meetings.filter((m) => m.id !== PLANNING.id), structuredClone(PLANNING)]; };

/** Schedule a call with nobody in yet: the soonest half hour Art is free is picked already, tomorrow at 09:00, and the week works. */
export const New = page(NEW, 'busy');
export const NewNight = { ...New, globals: night } satisfies PageStory;
export const NewTabletNight = { ...New, globals: { ...night, ...at('tablet') } } satisfies PageStory;
export const NewPhone = phone(New);
/** Pointing at a free half hour: the call's outline there, at its length, with who's free then. */
export const Pointing = page(NEW, 'busy', {
  play: playing(async ({ userEvent, step }) => {
    await step('Point at Friday 10:30: the call’s outline follows the pointer', async () => { await pointAt(userEvent, await halfHour(FRIDAY, '10:30')); });
  })
});
/** Priya and Kofi are in: their busy times hatched, never what they are, and the call on the soonest time all three are free. */
export const WithPriyaAndKofi = page(NEW, 'busy', { play: playing(...priyaAndKofi) });
export const WithPriyaAndKofiNight = { ...WithPriyaAndKofi, globals: night } satisfies PageStory;
export const WithPriyaAndKofiWide = { ...WithPriyaAndKofi, globals: at('wide') } satisfies PageStory;
export const WithPriyaAndKofiPhone = phone(WithPriyaAndKofi);
/** A time when Priya is busy, pressed: it says so in caution, the call wears a caution ring, and Next free offers 14:00. */
export const Clash = page(NEW, 'busy', {
  play: playing(...priyaAndKofi, pressingAt(THURSDAY, '12:00', 'Press 12:00 tomorrow, when Priya is busy'), saying(/busy then/, 'Priya is busy then, with Next free'))
});
export const ClashNight = { ...Clash, globals: night } satisfies PageStory;
/** A time Art has a call of his own at: "You have Harbourline proposal then", and Next free. */
export const ClashWithYours = page(NEW, 'busy', {
  play: playing(pressingAt(THURSDAY, '11:00', 'Press 11:00 tomorrow, when Art has the Harbourline proposal'), saying(/^You have .+ then/, 'It says so, with Next free'))
});
/** Next free, pressed: the call is on the soonest time from there that all three are free, and they're all free. */
export const NextFree = page(NEW, 'busy', {
  play: playing(...priyaAndKofi, pressingAt(THURSDAY, '12:00', 'Press 12:00 tomorrow, when Priya is busy'), pressing(/^Next free/, 'Press Next free'),
    saying(/all free/i, 'The call is at 14:00, and you’re all free'))
});
/** A clash in the evening, with nothing free after it that day: Next free is on another day, "Next free: Fri 09:00". */
export const NextFreeOnAnotherDay = page(NEW, 'busy', {
  play: playing(pressingAt(THURSDAY, '18:30', 'Press 18:30 tomorrow, in Art’s focus time'), saying(/^Next free: Fri/, 'You have Focus time then, and Next free is Friday morning'))
});
/** Priya and Kofi in, and a time after the working day pressed: "You’re all free, outside working hours". */
export const OutsideWorkingHours = page(NEW, 'busy', {
  play: playing(...priyaAndKofi, pressingAt(FRIDAY, '17:30', 'Press Friday at 17:30, after the working day, when all three are free'),
    saying(/outside working hours/, 'You’re all free, outside working hours'))
});
/** A 2-hour call pressed at 23:00 stops at midnight, and says so: a call ends on the day it starts. */
export const StoppedAtMidnight = page(NEW, 'busy', {
  play: playing(
    pressingAt(FRIDAY, '14:00', 'Press Friday at 14:00'),
    picking('Ends', '16:00', 'Pick 16:00 from the end’s list, which says the length each end makes: a 2-hour call'),
    pressingAt(FRIDAY, '23:00', 'Scroll down and press 23:00: it keeps its length as far as midnight'),
    saying(/stops at midnight/i, 'It stops at midnight instead of running into Saturday, and says so')
  )
});
/** The hours scrolled down to midnight, with room to press 23:30, and a pill at the top saying where the call is. */
export const ScrolledLate = page(NEW, 'busy', {
  play: playing(async ({ step }) => {
    await step('Scroll the week down as far as it goes', async () => { await scrollHours('bottom'); });
  })
});
/** The week after: 11 – 17 Nov, with Today beside the arrows to come back. */
export const TheWeekAfter = page(NEW, 'busy', { play: playing(pressing('The week after', 'Press the week after')) });
/** The day, pressed: a month to pick a day from, Monday first, days gone greyed, today marked and the call's day filled. */
export const PickADay = page(NEW, 'busy', {
  play: playing(pressing(/^Day, /, 'Press the day'), async ({ step }) => {
    await step('A month opens', async () => { await screen.findByRole('dialog', { name: 'Pick a day' }, SOON); });
  })
});
/** A day picked across the year: the week turns to it, and its heading names both years, "30 Dec 2026 – 5 Jan 2027". */
export const AcrossTheYear = page(NEW, 'busy', {
  play: playing(pressing(/^Day, /, 'Press the day'), async ({ userEvent, step }) => {
    await step('Go on to December and pick Thursday the 31st: the call and the week go there, keeping the time', async () => {
      const month = await screen.findByRole('dialog', { name: 'Pick a day' }, SOON);
      await userEvent.click(await within(month).findByRole('button', { name: 'Next month' }, SOON));
      await userEvent.click(await within(month).findByRole('button', { name: /^Thursday 31 December/ }, SOON));
      await says(/30 Dec 2026 – 5 Jan 2027/);
    });
  })
});
/** The start, pressed: every quarter hour of the day in a list, scrolled to the one picked, the ones gone greyed. */
export const StartList = page(NEW, 'busy', {
  play: playing(async ({ userEvent, step }) => {
    await step('Press the start: its list opens', async () => {
      await userEvent.click(await timeField('Starts'));
      await screen.findByRole('listbox', { name: 'Starts' }, SOON);
    });
  })
});
/** The end, pressed: from a quarter hour after the start to 24:00, each with the length it makes. */
export const EndList = page(NEW, 'busy', {
  play: playing(async ({ userEvent, step }) => {
    await step('Press the end: its list opens', async () => {
      await userEvent.click(await timeField('Ends'));
      await screen.findByRole('listbox', { name: 'Ends' }, SOON);
    });
  })
});
/** An end typed before the start: "It has to end after it starts." in caution under the time, and the time stays as it was. */
export const EndBeforeStart = page(NEW, 'busy', {
  play: playing(typingTime('Ends', '08:30', 'Type 08:30 over the end, and Enter: before the call starts at 09:00'),
    saying(/has to end after it starts/, 'It has to end after it starts, and the call stays 09:00 – 09:45'))
});
/** How it repeats, as a menu: Doesn't repeat, Every Thursday, Every 2 weeks on Thursday, Every month on the first Thursday, Days you pick. */
export const Repeats = page(NEW, 'busy', { play: playing(pressing(/^Doesn’t repeat/, 'Open Doesn’t repeat')) });
/** What the notes keep, opened in place under Notes, and where they go. */
export const NotesKept = page(NEW, 'busy', { play: playing(pressing('What the notes keep', 'Open What the notes keep')) });
/**
 * The notes go to Design, which Aiko pays for: what the call adds there wouldn't be Art's to pay for, so it opens only for its
 * own people, its boards and files too, and that's said once, under where they go.
 */
export const NotesInSomeoneElses = page(NEW, 'busy', {
  play: playing(...priyaAndKofi, pressing('What the notes keep', 'Open What the notes keep'), async ({ userEvent, step }) => {
    await step('Choose Design, which Aiko pays for, for where they go', async () => {
      await userEvent.click(await oneOf(['button', 'combobox'], /^Where the notes go/));
      await userEvent.click(await choice('Design'));
    });
  })
});
export const NotesInSomeoneElsesNight = { ...NotesInSomeoneElses, globals: night } satisfies PageStory;
export const NotesInSomeoneElsesPhone = phone(NotesInSomeoneElses);
/** Add an agenda: the library of documents and boards, as a popover, to pick from. */
export const Bringing = page(NEW, 'busy', { play: playing(pressing('Add an agenda', 'Press Add an agenda')) });
/** Priya, and Jonas from outside: a line under Who says whose calendar can't be seen. */
export const SomeoneFromOutside = page(NEW, 'busy', {
  play: playing(
    adding(/^Priya Raman/, 'Add Priya'),
    typingIn('jonas@weber.design', 'Type Jonas’s address'),
    thatsEveryone,
    saying(/see Jonas.s calendar/, 'You can’t see Jonas’s calendar, under the field')
  )
});
/** Two guests from outside, Jonas and Ana: neither calendar can be read, said once under the field, and nobody is offered a pick. */
export const TwoFromOutside = page(NEW, 'busy', {
  play: playing(
    typingIn('jonas@weber.design', 'Type Jonas’s address'),
    typingIn('ana@souza.law', 'Then Ana’s: she’s outside Vandelay too'),
    thatsEveryone,
    saying(/see the calendars of /, 'You can’t see the calendars of Jonas and Ana, under the field')
  )
});
/** A name nobody has, typed under Who: the people say so, and how to add someone by their address. */
export const NobodyByThatName = page(NEW, 'busy', {
  play: playing(async ({ userEvent, step }) => {
    await step('Type Odile: nobody by that name yet, so type their full address', async () => {
      await userEvent.type(await whoField(), 'Odile');
      await says(/Nobody by that name yet/);
    });
  })
});
/** On your own, with no team: the people under Who are People you've met, from your calls. */
export const OnYourOwn = page(NEW, 'on-their-own', {
  play: playing(async ({ userEvent, step }) => {
    await step('Press Who: the people you’ve met', async () => {
      await userEvent.click(await whoField());
      await says(/People you.ve met/);
    });
  })
});
/** Letting a guest pick: Jonas is the only guest and his calendar can't be read, so the switch is there, off. Said where he is, in Berlin. */
export const LettingAGuestPick = page(NEW, 'busy', { play: playing(...jonasInBerlin) });
export const LettingAGuestPickPhone = phone(LettingAGuestPick);
/** Picking on: three numbered times, each with what Jonas's clock says then; the second pressed, so it's the one the week moves. */
export const PickingTime2 = page(NEW, 'busy', { play: playing(...jonasInBerlin, lettingJonasPick, timeTwo) });
export const PickingTime2Night = { ...PickingTime2, globals: night } satisfies PageStory;
/**
 * On a phone there's no week, so time 2's own day and time sit under the times: its start picked from its list, then its day
 * from the month, and it goes there, still second and lit.
 */
export const PickingTime2Phone = phone(page(NEW, 'busy', {
  play: playing(...jonasInBerlin, lettingJonasPick, timeTwo,
    picking('Starts', '15:00', 'Pick 15:00 from time 2’s start list, under the times: there’s no week to press'),
    pressing(/^Day, /, 'Press time 2’s day: a month opens'),
    async ({ userEvent, step }) => {
      await step('Pick Tuesday 10 November: time 2 goes there, at 15:00', async () => {
        const month = await screen.findByRole('dialog', { name: 'Pick a day' }, SOON);
        await userEvent.click(await within(month).findByRole('button', { name: /^Tuesday 10 November/ }, SOON));
        await screen.findByRole('button', { name: /^Time 2: Tue 10 Nov, 15:00/ }, SOON);
      });
    })
}));
/** The length of every time offered: 45 min each, open. */
export const LengthEach = page(NEW, 'busy', { play: playing(...jonasInBerlin, lettingJonasPick, timeTwo, pressing(/^45 min each/, 'Press 45 min each')) });
/** The third time unticked: struck through and faded, dashed on the week. Two stay offered at least. */
export const LeftOut = page(NEW, 'busy', {
  play: playing(...jonasInBerlin, lettingJonasPick, async ({ userEvent, step }) => {
    await step('Untick the third time: Jonas picks from two', async () => { await userEvent.click(await oneOf(['checkbox', 'switch'], 'Offer time 3')); });
  })
});
/** Letting Jonas pick with no calendar connected: nothing holds the times, so the foot says you get a link to send him. */
export const OfferingWithoutACalendar = page(NEW, 'busy', {
  beforeEach: changing(noCalendar),
  play: playing(...jonasInBerlin, lettingJonasPick, saying(/You get a link to send to Jonas/, 'You get a link to send to Jonas, in the foot'))
});
/** Everyone at Vandelay, thirty people: past 25, Everyone joins muted is on. */
export const ABigCall = page(NEW, 'lots', {
  play: playing(typingIn('Everyone', 'Type Everyone, and pick everyone at Vandelay', /^Everyone at Vandelay/), thatsEveryone, async ({ step }) => {
    await step('Everyone joins muted, on', async () => { await switchFor(/^Everyone joins muted/); });
  })
});
/** Started from the week: dragged across tomorrow from 13:30 for an hour on the Calls page's week, scheduling opens on that time. */
export const FromTheWeek = page(`${NEW}&slot=${encodeURIComponent(iso(THURSDAY, 13, 30))}&minutes=60`, 'busy');
/** With no calendar connected: only Art's Alcove calls are known, with Connect Google Calendar, and nobody is told. */
export const WithoutACalendar = page(NEW, 'busy', {
  beforeEach: changing(noCalendar),
  play: playing(...priyaAndKofi.slice(0, 3), saying(/Only your Alcove calls/, 'Only your Alcove calls are known without a calendar'))
});
/** Reading the calendars takes a while. */
export const ReadingCalendars = page(NEW, 'busy', {
  beforeEach: changing(troubled({ 'calendar.busy': 'hold' })),
  play: playing(...priyaAndKofi.slice(0, 3), saying(/Reading calendars/, 'Reading calendars…'))
});
/**
 * The calendars can't be read just now: only Art's own calls and meetings count, said quietly under When, nobody's busy time
 * is hatched on the week, and the call is on the soonest time Art alone is free.
 */
export const CalendarsUnreadable = page(NEW, 'busy', {
  beforeEach: changing(troubled({ 'calendar.busy': 'failed' })),
  play: playing(...priyaAndKofi.slice(0, 3), saying(/can.t be read just now/, 'Calendars can’t be read just now, so only your Alcove calls are known'))
});
/** A demo account's sample calendar: it sends the invitations, so the foot says Priya and Kofi get one. */
export const OnASampleCalendar = page(NEW, 'busy', {
  beforeEach: changing(onASampleCalendar),
  play: playing(...priyaAndKofi, saying(/Priya and Kofi get an invitation/, 'Priya and Kofi get an invitation, in the foot'))
});
/** It couldn't be scheduled: the error stays above the foot with its reference, and nothing chosen is lost. */
export const ScheduleFailed = page(NEW, 'busy', {
  beforeEach: changing(troubled({ 'meetings.create': 'failed' })),
  play: playing(...priyaAndKofi, pressing('Schedule', 'Press Schedule'))
});
/** Meet again: the same people and name as the pricing sync, on the soonest time they're all free. */
export const MeetAgain = page('/calls?schedule=again&note=n3', 'busy');
/**
 * Move a call: Hiring sync, where it is now dashed on the week; who's on it, with their answers, fixed; and Aiko's ask under
 * the time, "Aiko asked for Fri 11:00", with Move it there. Cancel this call waits in the foot.
 */
export const MoveACall = page(`/calls?schedule=move&meeting=${HIRING_SYNC.id}`, 'busy', {
  beforeEach: changing(withHiringSync),
  play: playing(saying(/Aiko asked for/, 'Aiko asked for Friday at 11:00, under the time'))
});
export const MoveACallNight = { ...MoveACall, globals: night } satisfies PageStory;
export const MoveACallPhone = phone(MoveACall);
/** Move it there, pressed: the call goes to the time Aiko asked for, "Was Thu 5 Nov, 10:00 – 10:45" struck through under its name. */
export const MoveItThere = page(`/calls?schedule=move&meeting=${HIRING_SYNC.id}`, 'busy', {
  beforeEach: changing(withHiringSync),
  play: playing(pressing('Move it there', 'Press Move it there'), async ({ step }) => {
    await step('The button says where it goes', async () => { await screen.findAllByRole('button', { name: /^Move to / }, SOON); });
  })
});
/** Moving a call with nobody else on it: Who says so, and so does the foot, "Nobody else is invited." */
export const MoveACallNobodyElse = page(`/calls?schedule=move&meeting=${PLANNING.id}`, 'busy', {
  beforeEach: changing(withPlanning),
  play: playing(pressingAt(FRIDAY, '14:00', 'Press Friday at 14:00: the call goes there, where it was stays dashed'))
});
/** Moving a call in a series: This call or This and later calls, at the top of When; for the later calls, how they repeat, which stays. */
export const MoveASeriesCall = page('/calls?schedule=move&meeting=m-standup', 'busy', { play: playing(pressing('This and later calls', 'Press This and later calls')) });
/** Cancel this call asks once, in place. */
export const CancelThisCall = page(`/calls?schedule=move&meeting=${HIRING_SYNC.id}`, 'busy', { beforeEach: changing(withHiringSync), play: playing(pressing('Cancel this call', 'Press Cancel this call')) });
/** Propose another time, on Kofi's Design crit: the kicker says Ask to move a call, and Kofi sees it, and can move the call there. */
export const ProposeAnotherTime = page(`/calls?schedule=move&meeting=${DESIGN_CRIT.id}`, 'busy', { beforeEach: changing(withDesignCrit) });
/*
 * No notes left this period (docs/product/user-flows.md 16.10): a call scheduled before the period renews says so under its
 * Notes row, in caution, until when, with Get Pro, which opens checkout over the page. A time after the period renews has
 * notes again, so nothing is said there.
 */
export const NoNotesLeft = page(NEW, 'plan-stopped', { play: playing(...priyaAndKofi) });
export const NoNotesLeftNight = { ...NoNotesLeft, globals: night } satisfies PageStory;
export const NoNotesLeftPhone = phone(NoNotesLeft);
/** A call that's gone can't be moved: the way back to Calls. */
export const CallGone = page('/calls?schedule=move&meeting=m-nowhere', 'busy');
