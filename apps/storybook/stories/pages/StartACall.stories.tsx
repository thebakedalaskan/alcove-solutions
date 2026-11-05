/*
 * Starting and scheduling a call: one small modal from anywhere, a sheet on a phone. It asks one thing at a time: Start now
 * or Schedule for later, then Who, When and Details, and Documents steps out of Details and back (user-flows 4).
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { phone } from '../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import { noCalendar, troubled } from './changes';

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
/** When: three times when everyone's free, the best one picked. */
export const When = page('/home', 'busy', { play: playing(open, later, priyaAndKofi, findATime) });
export const WhenPhone = phone(When);
/** With no calendar connected, the times are open working hours. */
export const WhenWithoutACalendar = page('/home', 'busy', { beforeEach: changing(noCalendar), play: playing(open, later, priyaAndKofi, findATime) });
/** Reading the calendars takes a while. */
export const ReadingCalendars = page('/home', 'busy', { beforeEach: changing(troubled({ 'calendar.busy': 'hold' })), play: playing(open, later, priyaAndKofi, findATime) });
/** Pick another time: the modal widens around the week, with your own things by name and when anyone is busy. */
export const AnotherTime = page('/home', 'busy', { play: playing(open, later, priyaAndKofi, findATime, press('Pick another time', 'Pick another time. The week opens beside the times')) });
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
