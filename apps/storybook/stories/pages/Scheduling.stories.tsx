/*
 * Scheduling, on the Calls page (user-flows 4): the scheduler where the rail was, and the week on the sheet. Who it's with,
 * three times that work, the time as it will read, how long and how it repeats, notes and what it brings, and the one
 * button. The same scheduler lets a guest from outside pick, moves a call, asks to move one you're invited to, and starts
 * from a call that happened. On a phone it's one column, with no week, and its foot above the tabs.
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { phone } from '../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import { iso } from '../../src/world/clock';
import { withDesignCrit, withHiringSync } from '../../src/world/scheduling';
import { noCalendar, troubled } from './changes';

const meta = { title: 'Pages/Scheduling', ...pages } satisfies Meta<PageArgs>;
export default meta;

type Play = NonNullable<PageStory['play']>;
type Ctx = Parameters<Play>[0];
type Step = (ctx: Ctx) => Promise<void>;
const playing = (...steps: Step[]): Play => async (ctx) => { for (const s of steps) await s(ctx); };
const SOON = { timeout: 8000 };
const press = (name: string | RegExp, said: string): Step => async ({ userEvent, step }) => {
  await step(said, async () => { await userEvent.click(await screen.findByRole('button', { name }, SOON)); });
};
/** Picks someone from the people under the field: Often with you, and Add someone else once someone's in. */
const picking = (who: RegExp, said: string): Step => async ({ userEvent, step }) => {
  await step(said, async () => {
    await userEvent.click(await screen.findByRole('combobox', { name: 'Add people' }, SOON));
    await userEvent.click(await screen.findByRole('option', { name: who }, SOON));
  });
};
/** Types someone in, to find them or add their address. */
const adding = (typed: string, who: RegExp, said: string): Step => async ({ userEvent, step }) => {
  await step(said, async () => {
    await userEvent.type(await screen.findByRole('combobox', { name: 'Add people' }, SOON), typed);
    await userEvent.click(await screen.findByRole('option', { name: who }, SOON));
  });
};
const priyaAndKofi: Step = async (ctx) => {
  await picking(/^Priya Raman/, 'Pick Priya, from Often with you. Her busy times shade the week')(ctx);
  await picking(/^Kofi Asante/, 'Then Kofi, from Add someone else')(ctx);
  await ctx.step('That’s everyone: Escape puts the list away', async () => { await ctx.userEvent.keyboard('{Escape}'); });
};
const readCalendars: Step = async ({ step }) => {
  await step('The calendars are read: three times when all three are free, the best one picked', async () => {
    await screen.findByText('All 3 of you are free at these times.', {}, SOON);
  });
};

/** Schedule a call, with nobody in it yet: the people you're often with, under the field. Press a time, or drag across the week. */
export const New = page('/calls?schedule=new', 'busy');
export const NewPhone = phone(New);
/** Priya and Kofi are in: their busy times are hatched on the week, never what they are; the times that suit all three glow. */
export const WithPriyaAndKofi = page('/calls?schedule=new', 'busy', { play: playing(priyaAndKofi, readCalendars) });
export const WithPriyaAndKofiDark = { ...WithPriyaAndKofi, globals: { theme: 'dark' } } satisfies PageStory;
export const WithPriyaAndKofiPhone = phone(WithPriyaAndKofi);
/** Started from the week: dragged across Thursday 15:30, scheduling opens with that time picked. */
export const FromTheWeek = page(`/calls?schedule=new&slot=${encodeURIComponent(iso(1, 15, 30))}&minutes=45`, 'busy');
/** How it repeats, opened in place: every Thursday, every two weeks, every month, or days you pick, and how many calls. */
export const Repeats = page('/calls?schedule=new', 'busy', { play: playing(priyaAndKofi, readCalendars, press(/^Doesn’t repeat/, 'Open Doesn’t repeat')) });
/** What the notes keep, opened under Notes, and where they go. */
export const NotesKept = page('/calls?schedule=new', 'busy', { play: playing(priyaAndKofi, readCalendars, press('What the notes keep', 'Open What the notes keep')) });
/** Bring: the library, to pick an agenda or a document from. */
export const Bringing = page('/calls?schedule=new', 'busy', { play: playing(priyaAndKofi, readCalendars, press(/^An agenda or a document/, 'Open An agenda or a document')) });
/**
 * Letting a guest pick: Jonas is outside Vandelay, so his calendar can't be read. The three times become ticks, held on
 * Art's calendar until he picks; said where he is, each says what his clock reads then.
 */
export const LettingAGuestPick = page('/calls?schedule=new', 'busy', {
  play: playing(adding('jonas@weber.design', /jonas@weber\.design/, 'Type Jonas’s address'), async ({ userEvent, step }) => {
    await step('Say he’s in Berlin', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /Where Jonas is/ }, SOON));
      await userEvent.click(await screen.findByRole('option', { name: 'Berlin' }, SOON));
    });
  })
});
export const LettingAGuestPickPhone = phone(LettingAGuestPick);
/** With no calendar connected: open working hours, Connect Google Calendar, and nobody is told. */
export const WithoutACalendar = page('/calls?schedule=new', 'busy', { beforeEach: changing(noCalendar), play: playing(priyaAndKofi) });
/** Reading the calendars takes a while. */
export const ReadingCalendars = page('/calls?schedule=new', 'busy', { beforeEach: changing(troubled({ 'calendar.busy': 'hold' })), play: playing(priyaAndKofi) });
/** Meet again: the same people and name as the pricing sync, and their busy times on the week. */
export const MeetAgain = page('/calls?schedule=again&note=n3', 'busy');
/**
 * Move a call: Hiring sync, where it is now dashed on the week and struck through above; who's on it, with their answers,
 * read only; the times that work; Move to …, and Cancel this call.
 */
export const MoveACall = page('/calls?schedule=move&meeting=m-hiring-sync', 'busy', { beforeEach: changing(withHiringSync) });
export const MoveACallDark = { ...MoveACall, globals: { theme: 'dark' } } satisfies PageStory;
export const MoveACallPhone = phone(MoveACall);
/** Cancel this call asks once, in place. */
export const CancelThisCall = page('/calls?schedule=move&meeting=m-hiring-sync', 'busy', { beforeEach: changing(withHiringSync), play: playing(press('Cancel this call', 'Press Cancel this call')) });
/** Propose another time, on Kofi's Design crit: Kofi sees it, and can move the call there. */
export const ProposeAnotherTime = page('/calls?schedule=move&meeting=m-design-crit', 'busy', { beforeEach: changing(withDesignCrit) });
/** It couldn't be scheduled: the error stays above the foot, and nothing chosen is lost. */
export const ScheduleFailed = page('/calls?schedule=new', 'busy', {
  beforeEach: changing(troubled({ 'meetings.create': 'failed' })), play: playing(priyaAndKofi, readCalendars, press('Schedule', 'Press Schedule'))
});
/*
 * No notes left this period (docs/product/user-flows.md 16.10): a call scheduled before the period renews says so under its
 * Notes row, in caution, until when, with Get Pro, which opens checkout over the page. A time after the period renews has
 * notes again, so nothing is said there.
 */
export const NoNotesLeft = page('/calls?schedule=new', 'plan-stopped', { play: playing(priyaAndKofi) });
export const NoNotesLeftNight = { ...NoNotesLeft, globals: { theme: 'dark' } } satisfies PageStory;
export const NoNotesLeftPhone = phone(NoNotesLeft);
/** A call that's gone can't be moved: the way back to Calls. */
export const CallGone = page('/calls?schedule=move&meeting=m-nowhere', 'busy');
