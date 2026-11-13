/*
 * Calls: every call, ahead and past. The places on a rail beside a sheet, the search and Schedule a call on a short sky
 * (docs/design/pages.md › Calls, user-flows 8). The busy afternoon with Calls' own additions (src/world/calls-page.ts): Priya's
 * roadmap review waiting for Art's answer, a call waiting for Jonas to pick a time, Diego asking to move the Harbourline
 * proposal, and more of the calendar.
 */
import type { Meta } from '@storybook/react-vite';
import { phone } from '../../../src/call';
import { searched } from '../../../src/api/trouble';
import { changing, page, pages, type PageArgs, type PageStory } from '../../../src/page';
import { browsing, pressing, scrollHours } from '../../../src/scheduling';
import { callsDay } from '../../../src/world/calls-page';
import { SERIES, inEveryState } from '../../../src/world/states';
import { noCalendar, noRoomNotes, troubled } from '../changes';

const meta = { title: 'Pages/Calls/Calls', ...pages } satisfies Meta<PageArgs>;
export default meta;

const day = { beforeEach: changing(callsDay) };
const night = { globals: { theme: 'dark' } };
/** Types into the line on the sky, as a person would; `{Enter}` at the end asks. */
const typing = (text: string, said: string): NonNullable<PageStory['play']> => async ({ canvas, userEvent, step }) => {
  await step(said, async () => {
    await userEvent.type(await canvas.findByRole('textbox', { name: 'Search every call, or ask' }), text);
  });
};

/** All calls: later today and tomorrow, Show more coming up, then what happened, by day. */
export const All = page('/calls', 'busy', day);
export const AllNight = page('/calls', 'busy', { ...day, ...night });
export const AllPhone = phone(All);
/** Four minutes before the design review: the foot of the side panel offers it with Join, as it does on every page but Home. */
export const ACallAboutToStart = page('/calls', 'call-soon');
export const ACallAboutToStartNight = page('/calls', 'call-soon', night);
/** Coming up: the call waiting for Jonas, then each day, Alcove calls and the calendar's meetings. */
export const ComingUp = page('/calls?view=soon', 'busy', day);
export const ComingUpNight = page('/calls?view=soon', 'busy', { ...day, ...night });
export const ComingUpPhone = phone(ComingUp);
/**
 * The week, hour by hour, Monday to Sunday, every day as wide as the others: what happened with what waits on you, what's
 * ahead, the calendar's meetings and the times held for Jonas, each block its time first. Its head names the days it shows,
 * 2 – 8 Nov, with no Today while it's this week; the hours open on 08:00 to 18:00 and scroll.
 */
export const Week = page('/calls?view=week', 'busy', day);
export const WeekNight = page('/calls?view=week', 'busy', { ...day, ...night });
/** On a phone: today and the next two days. */
export const WeekPhone = phone(Week);
/** The week after: 9 – 15 Nov, and Today beside the arrows, to come back. */
export const WeekAfter = page('/calls?view=week', 'busy', { ...day, play: pressing('The week after', 'Press the week after') });
export const WeekAfterNight = page('/calls?view=week', 'busy', { ...day, ...night, play: pressing('The week after', 'Press the week after') });
/** The hours scrolled down to midnight: the Harbourline weekly at 18:00, and Art's focus time on Thursday evening. The week never grows. */
export const WeekEvening = page('/calls?view=week', 'busy', {
  ...day,
  play: async ({ step }) => {
    await step('Scroll the week down as far as it goes', async () => { await scrollHours('bottom', await browsing('2 – 8 Nov')); });
  }
});
export const Past = page('/calls?view=past', 'busy', day);
export const InTheRoom = page('/calls?view=room', 'busy', day);
export const NothingInTheRoom = page('/calls?view=room', 'busy', { beforeEach: changing(callsDay, noRoomNotes) });
export const SharedWithYou = page('/calls?view=shared', 'busy', day);
export const NothingShared = page('/calls?view=shared', 'on-their-own');
/** Every series with a call ahead, each with its next one: what the phone's Series chip opens. */
export const EverySeries = page('/calls?view=series', 'busy', { beforeEach: changing(callsDay, inEveryState) });
export const EverySeriesPhone = phone(EverySeries);

/** Art's weekly standup: its next call, the standups so far led by their dates, and what carries over, settled in place. */
export const ASeries = page(`/calls?series=${SERIES.standup}`, 'busy', { beforeEach: changing(callsDay, inEveryState) });
export const ASeriesNight = page(`/calls?series=${SERIES.standup}`, 'busy', { beforeEach: changing(callsDay, inEveryState), ...night });
export const ASeriesPhone = phone(ASeries);
/** Maya's pricing sync, which Art is invited to: only the calls he has notes from, and nothing of the series to change. */
export const TheirSeries = page(`/calls?series=${SERIES.pricing}`, 'busy', { beforeEach: changing(callsDay, inEveryState) });
/** Art's design reviews with nothing scheduled next: Schedule next week's call. */
export const SeriesWithNothingNext = page(`/calls?series=${SERIES.design}`, 'busy', { beforeEach: changing(callsDay, inEveryState) });
/** A series whose only call is being written: nothing carries over yet. */
export const SeriesBeingWritten = page(`/calls?series=${SERIES.panel}`, 'busy', { beforeEach: changing(callsDay, inEveryState) });
/** A series that isn't there: its calls' notes were deleted, or none of them were given to Art. */
export const SeriesNotThere = page('/calls?series=s-gone', 'busy', day);

/** A call's menu, open: Change the time, Copy link, Cancel this call. */
export const ARowsMenu = page('/calls?view=soon', 'busy', {
  ...day,
  play: async ({ canvas, userEvent, step }) => {
    await step('Open the Design sync’s menu', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'More for Design sync' }));
    });
  }
});
/** Priya's roadmap review waits on Art's answer: Yes, Maybe and No as equal buttons. */
export const AnInvitation = page('/calls?view=soon', 'busy', day);
/** After Yes: You're going, with Change, and Priya sees it. */
export const AfterYes = page('/calls?view=soon', 'busy', {
  ...day,
  play: async ({ canvas, userEvent, step }) => {
    await step('Say Yes to the roadmap review', async () => {
      const answer = await canvas.findByRole('group', { name: 'Are you going to Roadmap review?' });
      const yes = Array.from(answer.querySelectorAll('button')).find((b) => b.textContent === 'Yes');
      if (yes) await userEvent.click(yes);
    });
  }
});
/** Diego asks to move the Harbourline proposal: Move it, or Keep 11:00. */
export const ARequestToMove = page('/calls?view=soon', 'busy', day);
/** No calendar connected: only Alcove calls, and one line offers to connect it. */
export const NoCalendar = page('/calls', 'busy', { beforeEach: changing(callsDay, noCalendar) });
/** The first day: No calls yet, with Connect Google Calendar and Start a call now. */
export const FirstDay = page('/calls', 'first-day');
export const FirstDayNight = page('/calls', 'first-day', night);
export const FirstDayPhone = phone(FirstDay);

/** Search finds the words: each call quotes the line that has them and who said it, with a chip for each moment. */
export const Search = page('/calls', 'busy', { ...day, play: typing('flag', 'Search for “flag”. Every call that says it, quoting where') });
export const SearchPhone = phone(Search);
/** A name lists the calls with that person, coming up first. */
export const AName = page('/calls', 'busy', { ...day, play: typing('Priya', 'Type a name') });
/** Nothing has the words: Clear search. */
export const NothingMatches = page('/calls', 'busy', { ...day, play: typing('zebra crossing', 'Search for words no call has') });
/** The search couldn't get an answer: Try again. */
export const SearchFailed = page('/calls', 'busy', {
  beforeEach: changing(callsDay, troubled({ 'notes.list': (query) => (searched(query) ? 'failed' : null) })),
  play: typing('pricing', 'Search, and Alcove can’t answer')
});
/** Asking every call: read in confidential compute, the answer lands on the sheet with the calls it read. */
export const Ask = page('/calls', 'busy', { ...day, play: typing('What did we decide about the launch?{Enter}', 'Ask what was decided about the launch') });
export const AskNight = page('/calls', 'busy', { ...day, ...night, play: typing('What did we decide about the launch?{Enter}', 'Ask what was decided about the launch') });
/**
 * Asked with none of this period's notes left: the server refuses the question, and the answer's place on the sheet says until
 * when there are none, with Get Pro (user-flows 16.10). Typing again puts it away.
 */
export const AskWithNoNotesLeft = page('/calls', 'plan-stopped', { ...day, play: typing('What did we decide about the launch?{Enter}', 'Ask what was decided about the launch, with no notes left this period') });
export const AskWithNoNotesLeftNight = page('/calls', 'plan-stopped', { ...day, ...night, play: typing('What did we decide about the launch?{Enter}', 'Ask what was decided about the launch, with no notes left this period') });
export const AskWithNoNotesLeftPhone = phone(AskWithNoNotesLeft);
/** The answer is still being written. */
export const StillAsking = page('/calls', 'busy', {
  beforeEach: changing(callsDay, troubled({ 'notes.askAll': 'hold' })),
  play: typing('What did we decide about the launch?{Enter}', 'Ask, and every call is read')
});
/** The calls Art has with Priya, from the Team page or the palette: her token in the line. */
export const WithSomeone = page('/calls#with=priya%40vandelay.industries', 'busy', day);
/** Nobody's calls with Sam yet: Show every call. */
export const NobodyWithThem = page('/calls#with=sam%40vandelay.industries', 'busy', day);

export const Writing = page('/calls', 'writing');
export const OnTheirOwn = page('/calls', 'on-their-own');
export const Offline = page('/calls', 'offline');
export const Lots = page('/calls', 'lots');
