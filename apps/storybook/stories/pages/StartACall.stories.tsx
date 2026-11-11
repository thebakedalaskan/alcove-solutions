/*
 * Starting and scheduling a call: one small modal from anywhere, a sheet on a phone. It asks one thing at a time: Start now
 * or Schedule for later, then Who, When and Details, and Documents steps out of Details and back (user-flows 4).
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { phone } from '../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import { noCalendar, standupTwice, troubled } from './changes';

const meta = { title: 'Pages/Start a call', ...pages } satisfies Meta<PageArgs>;
export default meta;

type Play = NonNullable<PageStory['play']>;
type Ctx = Parameters<Play>[0];
/** One step of the way through the modal, as a person takes it. */
type Step = (ctx: Ctx) => Promise<void>;
const playing = (...steps: Step[]): Play => async (ctx) => { for (const s of steps) await s(ctx); };
const press = (name: string | RegExp, said: string): Step => async ({ userEvent, step }) => {
  await step(said, async () => {
    await userEvent.click(await screen.findByRole('button', { name }, { timeout: 8000 }));
  });
};

const open: Step = async ({ canvas, userEvent, step }) => {
  await step('Press N, from anywhere: Start a call opens, and asks one thing', async () => {
    await canvas.findByRole('button', { name: /^Start now/ }, { timeout: 8000 });
    await userEvent.keyboard('n');
    await screen.findByRole('dialog', {}, { timeout: 8000 });
  });
};
const later = press(/Schedule for later/, 'Choose Schedule for later. It asks Who first');
const adding = (typed: string, who: RegExp, said: string): Step => async ({ userEvent, step }) => {
  await step(said, async () => {
    await userEvent.type(await screen.findByRole('combobox', { name: 'Add people' }), typed);
    await userEvent.click(await screen.findByRole('option', { name: who }));
  });
};
const priyaAndKofi: Step = async (ctx) => {
  await adding('Pri', /^Priya Raman/, 'Type “Pri” and pick Priya')(ctx);
  await adding('Kof', /^Kofi Asante/, 'Then Kofi')(ctx);
};
const findATime = press('Find a time', 'Find a time. Three times that work, the best already picked');
/** Types a time into the line under the cards, and leaves the field, which is when it counts. */
const typing = (label: 'Starts' | 'Ends', time: string, said: string): Step => async ({ userEvent, step }) => {
  await step(said, async () => {
    const field = await screen.findByLabelText(label, {}, { timeout: 8000 });
    await userEvent.clear(field);
    await userEvent.type(field, time);
    await userEvent.tab();
  });
};
const useIt = press(/^Use /, 'Use the time picked. Details reads like the finished call');

export const Choice = page('/home', 'busy', { play: playing(open) });
export const ChoicePhone = phone(Choice);
/** On your own: Start now gets a link to send to anyone. */
export const ChoiceOnTheirOwn = page('/home', 'on-their-own', { play: playing(open) });
/** Who: one field for people, groups and the whole company, with the people you're often with. */
export const Who = page('/home', 'busy', { play: playing(open, later) });
export const WhoPicked = page('/home', 'busy', { play: playing(open, later, priyaAndKofi) });
/** On a first day: the company's directory, people not on Alcove yet among them. */
export const WhoOnAFirstDay = page('/home', 'first-day', { play: playing(open, later) });
/** When: three times when everyone's free, soonest first, the best one picked. */
export const When = page('/home', 'busy', { play: playing(open, later, priyaAndKofi, findATime) });
export const WhenPhone = phone(When);
/**
 * The time picked, typed: a start at 10:15 moves the call on its day and keeps its length, and an end at 11:30 makes it
 * 1 h 15 min, which shows beside the three lengths. The card for 10:15 takes the place of the last suggestion.
 */
export const TypedTimes = page('/home', 'busy', {
  play: playing(open, later, priyaAndKofi, findATime, typing('Starts', '10:15', 'Type a start, 10:15, and leave the field'), typing('Ends', '11:30', 'Type an end, 11:30, and leave the field'))
});
export const TypedTimesPhone = phone(TypedTimes);
/** An end before the start can't be used: it says why under the line, and the time picked stays as it was. */
export const TypedTimeRefused = page('/home', 'busy', {
  play: playing(open, later, priyaAndKofi, findATime, typing('Ends', '08:00', 'Type an end before the start, 08:00, and leave the field'))
});
/** With no calendar connected, the times are open working hours: a different easy hour on each of the next working days, soonest first. */
export const WhenWithoutACalendar = page('/home', 'busy', { beforeEach: changing(noCalendar), play: playing(open, later, priyaAndKofi, findATime) });
/** Reading the calendars takes a while. */
export const ReadingCalendars = page('/home', 'busy', { beforeEach: changing(troubled({ 'calendar.busy': 'hold' })), play: playing(open, later, priyaAndKofi, findATime) });
/** Pick another time: the modal widens around the week, Monday to Sunday and the whole day, with your own things by name and when anyone is busy. */
export const AnotherTime = page('/home', 'busy', { play: playing(open, later, priyaAndKofi, findATime, press('Pick another time', 'Pick another time. The week opens beside the times')) });
/** On a phone the week sits under the times, all seven days of it. */
export const AnotherTimePhone = phone(AnotherTime);
/**
 * Ending later, in the week: the bar on the picked time's bottom edge drags its end a quarter hour at a time, and Shift with
 * the down arrow on its half hour does the same. Twice makes the 45 minutes 1 h 15 min, which shows beside the three.
 */
export const EndingLater = page('/home', 'busy', {
  play: playing(open, later, priyaAndKofi, findATime, press('Pick another time', 'Pick another time'), async ({ userEvent, step }) => {
    await step('Once the calendars are read, go to the picked half hour, and press Shift and the down arrow twice', async () => {
      await screen.findByText('All 3 of you are free at these times.', {}, { timeout: 8000 });
      (await screen.findByRole('button', { name: /, picked/ }, { timeout: 8000 })).focus();
      await userEvent.keyboard('{Shift>}{ArrowDown}{ArrowDown}{/Shift}');
    });
  })
});
/** A time picked from the week takes the place of the last suggestion, and the cards stay soonest first. */
export const PickedFromTheWeek = page('/home', 'busy', {
  play: playing(open, later, priyaAndKofi, findATime, press('Pick another time', 'Pick another time'), press(/^Fri 6 Nov, 16:30/, 'Pick Friday at 16:30 in the week'))
});
/** How it repeats: every week, every two weeks, every month, or days you pick, with an end date. */
export const Repeats = page('/home', 'busy', { play: playing(open, later, priyaAndKofi, findATime, press(/Doesn’t repeat/, 'Open Doesn’t repeat'), press(/^Every (Mon|Tues|Wednes|Thurs|Fri)day$/, 'Every week, on the same day')) });
/** On your own with one guest whose calendar can't be read: Let Ana pick, from times offered. */
export const LetThemPick = page('/home', 'on-their-own', {
  play: playing(open, later, adding('Ana', /^Ana Souza/, 'Type “Ana” and pick Ana, from a past call'), findATime, async ({ userEvent, step }) => {
    await step('Let Ana pick: the times on the cards are offered instead', async () => {
      await userEvent.click(await screen.findByRole('switch', { name: 'Let Ana pick' }, { timeout: 8000 }));
    });
  })
});
/** Details: the name ready to type over, When and Who to step back to, notes, and Documents. */
export const Details = page('/home', 'busy', { play: playing(open, later, priyaAndKofi, findATime, useIt) });
export const DetailsPhone = phone(Details);
/** Where its notes go, with the standup's two homes from today: they share a name, so each says when its call started. */
export const ChoosingAHome = page('/home', 'busy', {
  beforeEach: changing(standupTwice),
  play: playing(open, later, priyaAndKofi, findATime, useIt, press(/^New workspace for this call/, 'Open New workspace for this call'),
    press(/^Where its notes go/, 'Open Where its notes go. The standup’s two homes say when each call started'))
});
/** Documents steps out of Details, to the workspace, and back. */
export const Documents = page('/home', 'busy', { play: playing(open, later, priyaAndKofi, findATime, useIt, press(/^Documents/, 'Open Documents')) });
/** From someone's popover on Team: Schedule opens at When, with them picked. */
export const FromTheTeamPage = page('/team', 'busy', {
  play: playing(async ({ canvas, userEvent, step }) => {
    await step('Press Priya’s arch', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: /^Priya Raman$/ }));
    });
  }, press('Schedule', 'Press Schedule. It opens at When, with Priya picked'))
});

/** Scheduled: the modal settles away, the row rises on Home, and a toast says who's been told. */
export const Scheduled = page('/home', 'busy', { play: playing(open, later, priyaAndKofi, findATime, useIt, press('Schedule', 'Schedule')) });
/** While it saves, Back and the steps wait, so it can't be sent twice. */
export const Scheduling = page('/home', 'busy', { beforeEach: changing(troubled({ 'meetings.create': 'hold' })), play: playing(open, later, priyaAndKofi, findATime, useIt, press('Schedule', 'Schedule')) });
/** It couldn't be saved: the error stays in the modal, and nothing chosen is lost. */
export const ScheduleFailed = page('/home', 'busy', { beforeEach: changing(troubled({ 'meetings.create': 'failed' })), play: playing(open, later, priyaAndKofi, findATime, useIt, press('Schedule', 'Schedule')) });
/** The call couldn't be made: the modal stays, and says why. */
export const StartFailed = page('/home', 'busy', { beforeEach: changing(troubled({ 'calls.startNow': 'failed' })), play: playing(open, press(/^Start now/, 'Start now')) });
