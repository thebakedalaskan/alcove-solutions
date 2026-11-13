/*
 * Starting and scheduling a call (docs/product/user-flows.md › 4. Start or schedule a call): Start now from the small modal,
 * and scheduling on the Calls page, one sheet with the week beside the call's editor, as the design canvas "Scheduling a call"
 * draws it (docs/design/canvas/scheduling/; its journeys: it opens ready on the soonest time, drag it to any day or any week,
 * add people and the time follows them, pressing a time keeps the call's length, the day scrolls and the week never grows,
 * the week says which days it shows, letting Jonas pick a time, and schedule), with the ones it never drew: moving, answering
 * a request to move, proposing, meeting again, a link with nobody invited, a pasted list, and a call's own page. With Google
 * Calendar connected the stand-in says the call is on it; Google's invitations are the hand-off.
 *
 * The busy afternoon, Wednesday 4 November at 16:12, so the scheduling week runs 4 – 10 Nov. Art is free from 09:00 tomorrow;
 * with Priya, from 10:00; with Priya and Kofi, not until 14:00, and at 12:00 only Priya is busy (src/world/scheduling.ts). The
 * week finds a time from where the pointer is, so its presses, drags and the hold at its edge are made with the pointer where a
 * person's would be (src/scheduling.ts).
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { call } from '../../src/world/build';
import { iso } from '../../src/world/clock';
import { ART, KOFI, PRIYA } from '../../src/world/people';
import {
  DESIGN_CRIT, FRIDAY, HIRING_SYNC, MONDAY, NEXT_THURSDAY, THURSDAY, TUESDAY, withDesignCrit, withHiringSync
} from '../../src/world/scheduling';
import {
  adding, browsing, button, choice, dragOnto, grabbing, halfHour, oneOf, picking, pointAt, pressOn, scheduler, says, scrollHours, switchFor, typingIn, whoField, type Ctx,
  type Drag
} from '../../src/scheduling';
import { page, pages, type PageArgs, type PageStory } from '../../src/page';
import { noCalendar } from '../pages/changes';
import { before, LAPTOP, LATER, SOON } from './play';

const meta = { title: 'Journeys/4 Start or schedule a call', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
export default meta;

const modal = (name: string | RegExp) => screen.findByRole('dialog', { name }, SOON);
/** The toast that says a call was scheduled, moved or offered. */
const toast = (text: RegExp) => screen.findAllByText(text, {}, SOON);
/** Someone from the people under Who (Often with you, then Add someone else), as a step's insides. */
const pick = (ctx: Ctx, who: RegExp, said: string) => adding(who, said)(ctx);
const escape = async ({ userEvent }: Ctx) => { await userEvent.keyboard('{Escape}'); };
/** Priya and Kofi in, and their calendars read: the call on the soonest time the three of them are free. */
async function priyaAndKofi(ctx: Ctx): Promise<void> {
  await pick(ctx, /^Priya Raman/, 'Add Priya, from Often with you. Her busy times are hatched on the week, never what they are, and the call moves to the soonest you’re both free');
  await pick(ctx, /^Kofi Asante/, 'Add Kofi, from Add someone else. It moves again, to the soonest the three of you are free: it follows who’s in until you pick a time yourself');
  await ctx.step('That’s everyone: Escape puts the people away, and the time says it’s the soonest you’re all free', async () => {
    await escape(ctx);
    await says(/soonest time you.re all free/i);
  });
}
/** Jonas, typed in by his address: he's from outside, so his calendar can't be read. Then where he is: Berlin. */
async function jonasInBerlin(ctx: Ctx): Promise<void> {
  await typingIn('jonas@weber.design', 'Type Jonas’s address. He’s outside Vandelay, so his calendar can’t be read: Let Jonas pick the time is there, and off. One time, like anyone else’s call')(ctx);
  await ctx.step('Say where he is: Where? on his token, then Berlin. His token says it', async () => {
    await escape(ctx);
    await ctx.userEvent.click(await oneOf(['button', 'combobox'], /^Where Jonas is/));
    await ctx.userEvent.click(await choice('Berlin'));
  });
}
/** Presses the week at `time` on `day`, as a person points and presses. */
const pressAt = async ({ userEvent }: Ctx, day: number, time: string) => { await pressOn(userEvent, await halfHour(day, time)); };

export const StartNow: PageStory = {
  name: '4.1 Start now',
  ...page('/home', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Press N, from any page. A small modal asks one thing: now, or later?', async () => {
      await screen.findByRole('button', { name: /^Start now/ }, SOON);
      await userEvent.keyboard('n');
      await modal('Start a call');
    });
    await step('Start now. The call is made, and its lobby opens with your team to ring', async () => {
      await userEvent.click(within(await modal('Start a call')).getByRole('button', { name: /^Start now/ }));
      await screen.findByRole('button', { name: 'Join' }, LATER);
    });
    await step('Pick who to ring: Priya and Kofi', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Ring Priya' }, SOON));
      await userEvent.click(screen.getByRole('button', { name: 'Ring Kofi' }));
    });
    await step('Join and ring 2. Their arches wait on the stage while it rings, and they come in', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Join and ring 2' }, SOON));
      await screen.findByRole('toolbar', { name: 'Call controls' }, LATER);
    });
  }
};

export const ScheduleACall: PageStory = {
  name: '4.2 Schedule a call',
  ...page('/home', 'busy'),
  play: async (ctx) => {
    const { userEvent, step } = ctx;
    await step('Start a call, and Schedule for later. Calls opens on one sheet: the week, and the call’s editor beside it, already on the soonest time you’re free', async () => {
      const side = await screen.findByRole('complementary', { name: 'Side panel' }, SOON);
      await userEvent.click(within(side).getByRole('button', { name: /^Start a call/ }));
      await userEvent.click(within(await modal('Start a call')).getByRole('button', { name: /^Schedule for later/ }));
      await scheduler();
    });
    await priyaAndKofi(ctx);
    await step('It’s called Call with Priya and Kofi until you name it: Launch checklist review', async () => {
      const name = await screen.findByRole('textbox', { name: 'The call’s name' }, SOON);
      await userEvent.clear(name);
      await userEvent.type(name, 'Launch checklist review');
    });
    await step('Add an agenda: the launch checklist, so it opens in the call', async () => {
      await userEvent.click(await button('Add an agenda'));
      await userEvent.click(await button(/Launch checklist/));
      await escape(ctx);
    });
    await step('Notes are on. Schedule: Google Calendar invites Priya and Kofi, and Undo is there for a moment', async () => {
      await userEvent.click(await button('Schedule'));
      await toast(/^Scheduled for/);
    });
  }
};

export const PickATimeOnTheWeek: PageStory = {
  name: '4.3 Pick a time on the week',
  ...page('/calls', 'busy'),
  play: async (ctx) => {
    const { userEvent, step } = ctx;
    await step('On Calls, press Schedule a call. The week fills the sheet with the call’s editor beside it, and a time is picked already: the soonest you’re free, tomorrow at 09:00', async () => {
      await userEvent.click(await button('Schedule a call'));
      await scheduler();
    });
    await step('The week works straight away, with nobody added. Point at Friday 10:30: the call’s outline follows the pointer, at its length, and says who’s free', async () => {
      await pointAt(userEvent, await halfHour(FRIDAY, '10:30'));
    });
    await step('Press it. The call moves there and keeps its 45 minutes', async () => { await pressAt(ctx, FRIDAY, '10:30'); });
    await step('Or drag across free time: the call takes that stretch, Friday 11:30 to 13:00, a quarter hour at a time', async () => {
      await dragOnto(userEvent, await halfHour(FRIDAY, '11:30'), await halfHour(FRIDAY, '13:00'), 0.1);
    });
    await step('Shift and the down arrow on its first half hour end it a quarter hour later each time, as its grip does', async () => {
      (await halfHour(FRIDAY, '11:30')).focus();
      await userEvent.keyboard('{Shift>}{ArrowDown}{ArrowDown}{/Shift}');
    });
  }
};

export const StartFromTheWeek: PageStory = {
  name: '4.4 Start from the week',
  ...page('/calls?view=week', 'busy'),
  play: async (ctx) => {
    const { userEvent, step } = ctx;
    await step('On Calls’ week, 2 – 8 Nov, drag across free time: tomorrow, from 13:00 to 14:00', async () => {
      const week = await browsing('2 – 8 Nov');
      await dragOnto(userEvent, await halfHour(THURSDAY, '13:00', week), await halfHour(THURSDAY, '14:00', week), 0.1);
    });
    await step('Scheduling opens on that time, on the week it’s in, beside the call’s editor', async () => { await scheduler(); });
    await pick(ctx, /^Priya Raman/, 'Add who it’s with: Priya');
  }
};

export const RepeatACall: PageStory = {
  name: '4.5 Repeat a call',
  ...page('/calls?schedule=new', 'busy'),
  play: async (ctx) => {
    const { userEvent, step } = ctx;
    await pick(ctx, /^Kofi Asante/, 'Scheduling a call with Kofi: it’s tomorrow at 09:00, the soonest you’re both free');
    await step('Open Doesn’t repeat, and pick how often: every week on the same day', async () => {
      await escape(ctx);
      await userEvent.click(await button(/^Doesn’t repeat/));
      await userEvent.click(await choice(/^Every (Monday|Tuesday|Wednesday|Thursday|Friday)$/));
    });
    await step('It ends after 6 calls', async () => {
      const calls = await screen.findByRole('textbox', { name: 'How many calls' }, SOON);
      await userEvent.clear(calls);
      await userEvent.type(calls, '6{Enter}');
    });
    await step('The button says what it will do. Google Calendar invites Kofi once, to all of them', async () => {
      await userEvent.click(await button('Schedule 6 calls'));
      await toast(/^Scheduled for/);
    });
  }
};

export const LetAGuestPick: PageStory = {
  name: '4.6 Let a guest pick',
  ...page('/calls?schedule=new', 'busy'),
  play: async (ctx) => {
    const { userEvent, step } = ctx;
    await jonasInBerlin(ctx);
    await step('Turn on Let Jonas pick the time: three times to offer, yours, then the same time on the next two days you’re free, each with what Jonas’s clock says then', async () => {
      await userEvent.click(await switchFor(/^Let Jonas pick the time/));
    });
    await step('Send Jonas the times. Your calendar holds them until he picks, and the link is copied to send him', async () => {
      await userEvent.click(await button('Send Jonas the times'));
      await toast(/Link copied for Jonas|Send Jonas the link/);
    });
  }
};

export const MoveACall: PageStory = {
  name: '4.7 Move a call',
  ...page(`/calls?schedule=move&meeting=${HIRING_SYNC.id}`, 'busy'),
  beforeEach: before(withHiringSync),
  play: async (ctx) => {
    const { userEvent, step } = ctx;
    await step('Change the time on Hiring sync. It opens where the call is: who’s on it, with their answers, and Cancel this call at the foot', async () => {
      await scheduler('Move Hiring sync');
    });
    await step('Press Friday at 14:00 on the week: the call goes there, where it was stays dashed, and Was Thu 5 Nov is struck through under its name', async () => {
      await pressAt(ctx, FRIDAY, '14:00');
    });
    await step('Move. Google Calendar tells Ines and Aiko, and Undo is there for a moment', async () => {
      await userEvent.click(await button(/^Move to /));
      await toast(/^Moved to/);
    });
  }
};

export const AnswerARequestToMove: PageStory = {
  name: '4.8 Answer a request to move',
  ...page(`/calls?schedule=move&meeting=${HIRING_SYNC.id}`, 'busy'),
  beforeEach: before(withHiringSync),
  play: async ({ userEvent, step }) => {
    await step('Aiko asked to move Hiring sync. Change the time says so under the time: Aiko asked for Friday at 11:00, with Move it there', async () => {
      await scheduler('Move Hiring sync');
      await says(/Aiko asked for/);
    });
    await step('Move it there: the call goes to Friday 11:00, when everyone’s free', async () => {
      await userEvent.click(await button('Move it there'));
    });
    await step('Move. Google Calendar tells Ines and Aiko', async () => {
      await userEvent.click(await button(/^Move to /));
      await toast(/^Moved to/);
    });
  }
};

export const ProposeAnotherTime: PageStory = {
  name: '4.9 Propose another time',
  ...page(`/calls?schedule=move&meeting=${DESIGN_CRIT.id}`, 'busy'),
  beforeEach: before(withDesignCrit),
  play: async (ctx) => {
    const { userEvent, step } = ctx;
    await step('Kofi invited Art to Design crit. Propose another time opens the same editor, for asking, on the call where it is', async () => {
      await scheduler('Propose another time for Design crit');
    });
    await step('Press Friday at 11:00 on the week, when Kofi and Priya are free too', async () => { await pressAt(ctx, FRIDAY, '11:00'); });
    await step('Ask to move it. Kofi sees it, and can move the call there', async () => {
      await userEvent.click(await button(/^Ask to move it/));
      await toast(/Kofi sees your proposed time/);
    });
  }
};

export const MeetAgain: PageStory = {
  name: '4.10 Meet again',
  ...page('/calls?schedule=again&note=n3', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Meet again, from the pricing sync: the same people and name, on the soonest time you’re all free', async () => {
      await scheduler();
    });
    await step('Schedule. Google Calendar invites Maya and Lena', async () => {
      await userEvent.click(await button('Schedule'));
      await toast(/^Scheduled for/);
    });
  }
};

export const ShareALinkInstead: PageStory = {
  name: '4.11 Share a link instead',
  ...page('/calls?schedule=new', 'busy'),
  beforeEach: before(noCalendar),
  play: async (ctx) => {
    const { userEvent, step } = ctx;
    await step('No calendar, and nobody yet: only your Alcove calls are known. Press tomorrow at 13:00 on the week', async () => {
      await scheduler();
      await pressAt(ctx, THURSDAY, '13:00');
    });
    await step('Nobody’s invited: you get a link to share. Schedule, and the link is copied', async () => {
      await says(/link to share/);
      await userEvent.click(await button('Schedule'));
      await toast(/^Scheduled for/);
    });
  }
};

export const PasteAList: PageStory = {
  name: '4.12 Paste a list of addresses',
  ...page('/calls?schedule=new', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Paste the list from an email into Who: it’s read at once, each address once', async () => {
      await userEvent.click(await whoField());
      await userEvent.paste('Priya Raman <priya@vandelay.industries>, Kofi Asante <kofi@vandelay.industries>; sam@vandelay.industries\nlena@vandelay, the design team');
    });
    await step('What can’t be read is flagged one at a time. The list gives this one’s fix away: Use it', async () => {
      await userEvent.click(await button('Use it'));
    });
    await step('This one isn’t an address at all: Leave out. The list stays one token however long it is', async () => {
      await screen.findByText(/can’t read the design team/, {}, SOON);
      await userEvent.click(await button('Leave out'));
    });
  }
};

export const ChangeAScheduledCall: PageStory = {
  name: '4.13 Change a scheduled call',
  ...page('/home', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('A scheduled call opens its page from its row in Upcoming', async () => {
      const coming = await screen.findByRole('region', { name: 'Upcoming' }, SOON);
      await userEvent.click(within(coming).getByRole('link', { name: /1:1 with Maya/ }));
    });
    await step('Change, at its top, opens the editor on the Calls page beside the week, to move it', async () => {
      const [change] = await screen.findAllByRole('button', { name: 'Change' }, LATER);
      if (change) await userEvent.click(change);
      await scheduler('Move 1:1 with Maya');
    });
  }
};

export const CancelAScheduledCall: PageStory = {
  name: '4.14 Cancel a scheduled call',
  ...page('/home', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Open the design sync’s page from Upcoming, then its More', async () => {
      const coming = await screen.findByRole('region', { name: 'Upcoming' }, SOON);
      await userEvent.click(within(coming).getByRole('link', { name: /Design sync/ }));
      await userEvent.click(await screen.findByRole('button', { name: 'More for Design sync' }, LATER));
    });
    await step('Cancel this call asks once, in place', async () => {
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Cancel this call' }, SOON));
      await userEvent.click(await button('Cancel the call'));
    });
    await step('It comes off the calendar and everyone invited is told. Undo schedules it again, as a new call with a new link', async () => {
      await userEvent.click(await button('Undo'));
      await screen.findByText(/new link/i, {}, SOON);
    });
  }
};

/** Priya's roadmap review tomorrow: Art is invited, and hasn't said whether he's coming. */
const ROADMAP = { ...call({ id: 'm-roadmap-review', title: 'Roadmap review', startsAt: iso(THURSDAY, 10, 0), minutes: 45, code: 'rdm-revw-pry', organizer: PRIYA, guests: [ART, KOFI], rsvps: { yes: 1 } }), rsvp: null };

export const AnswerAnInvitation: PageStory = {
  name: '4.15 Answer an invitation',
  ...page('/home', 'busy'),
  beforeEach: before((w) => { w.meetings.push(structuredClone(ROADMAP)); }),
  play: async ({ userEvent, step }) => {
    await step('Someone else’s call you’re invited to opens its page from its row: who’s invited, and what was brought', async () => {
      const coming = await screen.findByRole('region', { name: 'Upcoming' }, SOON);
      await userEvent.click(within(coming).getByRole('link', { name: /Roadmap review/ }));
    });
    await step('Answer Yes, Maybe or No. Priya sees it, and the answer stays, with Change', async () => {
      await userEvent.click(within(await screen.findByRole('group', { name: 'Are you going to Roadmap review?' }, LATER)).getByRole('button', { name: 'Yes' }));
      await screen.findByText('You’re going', {}, SOON);
      await screen.findByRole('button', { name: 'Change your answer to Roadmap review' }, SOON);
    });
  }
};

/* ---------- the week, as the canvas's journeys play it ---------- */

export const PressATimeKeepTheLength: PageStory = {
  name: '4.16 Press a time, keep the length',
  ...page('/calls?schedule=new', 'busy'),
  play: async (ctx) => {
    const { userEvent, step } = ctx;
    await step('Press Friday at 14:00: the call moves there, still 45 minutes', async () => { await pressAt(ctx, FRIDAY, '14:00'); });
    await picking('Ends', '16:00', 'Press the end, and pick 16:00 from its list, which says the length each end makes: a 2-hour call')(ctx);
    await step('Press 15:00, inside the call: it starts there and keeps its 2 hours, 15:00 to 17:00', async () => { await pressAt(ctx, FRIDAY, '15:00'); });
    await step('Only the end, the lengths and the grip at its foot change how long it is: Shift and the down arrow on its first half hour, a quarter hour later', async () => {
      (await halfHour(FRIDAY, '15:00')).focus();
      await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}');
    });
  }
};

export const StopAtMidnight: PageStory = {
  name: '4.17 Stop at midnight',
  ...page('/calls?schedule=new', 'busy'),
  play: async (ctx) => {
    const { step } = ctx;
    await step('A 2-hour call on Friday: press 14:00', async () => { await pressAt(ctx, FRIDAY, '14:00'); });
    await picking('Ends', '16:00', 'Then 16:00 from the end’s list: 14:00 to 16:00')(ctx);
    await step('Scroll down and press 23:00. It stops at midnight instead of running into Saturday, and says so', async () => {
      await pressAt(ctx, FRIDAY, '23:00');
      await says(/stops at midnight/i);
    });
    await step('Press 14:00 again: it’s 2 hours again. Moving never changes the length', async () => { await pressAt(ctx, FRIDAY, '14:00'); });
  }
};

export const DragItToAnotherDay: PageStory = {
  name: '4.18 Drag it to another day',
  ...page('/calls?schedule=new', 'busy'),
  play: async (ctx) => {
    const { userEvent, step } = ctx;
    let drag: Drag | null = null;
    await step('The call is on the week from the start. Press tomorrow at 13:00 to put it there', async () => { await pressAt(ctx, THURSDAY, '13:00'); });
    await step('Grab it and drag it to Friday at 10:30: it follows the pointer a quarter hour at a time, and lifts while it moves', async () => {
      drag = await grabbing(userEvent, await halfHour(THURSDAY, '13:00'));
      await drag.over(await halfHour(FRIDAY, '10:30'));
    });
    await step('Let go. It’s there, still 45 minutes', async () => { await drag?.drop(); });
  }
};

export const CarryItIntoNextWeek: PageStory = {
  name: '4.19 Carry it into next week',
  ...page('/calls?schedule=new', 'busy'),
  /*
   * The hold is played with the pointer held still at the week's edge, as a hand holds it: the week turns after a moment and
   * the call goes with it. › (The week after) turns the week the same way, a week at a time.
   */
  play: async (ctx) => {
    const { userEvent, step } = ctx;
    let drag: Drag | null = null;
    await step('Press Tuesday at 15:30, the last day of the week, to put the call there', async () => { await pressAt(ctx, TUESDAY, '15:30'); });
    await step('Grab it, drag it to the week’s right edge, and hold it there…', async () => {
      drag = await grabbing(userEvent, await halfHour(TUESDAY, '15:30'));
      await drag.toEdge();
    });
    await step('…and the next week slides in under it: 11 – 17 Nov. Drag it on to Thursday 12 November at 15:30', async () => {
      await drag?.over(await halfHour(NEXT_THURSDAY, '15:30'));
    });
    await step('Let go. It’s there, still 45 minutes, and Today beside the arrows comes back to this week', async () => {
      await drag?.drop();
      await button('Today');
    });
  }
};

export const ScrollTheDay: PageStory = {
  name: '4.20 Scroll the day, pick a start',
  ...page('/calls?schedule=new', 'busy'),
  play: async (ctx) => {
    const { step } = ctx;
    await step('The week opens on 08:00 to 18:00. Scroll down as far as it goes: to midnight, with room to press 23:30', async () => {
      await scheduler();
      await scrollHours('bottom');
    });
    await step('Scroll up as far as it goes: to 00:00. The hours shown never change, whatever the call', async () => { await scrollHours('top'); });
    await picking('Starts', '06:30', 'Or press the start: every quarter hour of the day, in a list, the ones gone greyed. Pick 06:30, and the week scrolls to it')(ctx);
  }
};

export const GoToAnotherWeekOrDay: PageStory = {
  name: '4.21 Go to another week, or day',
  ...page('/calls?schedule=new', 'busy'),
  play: async (ctx) => {
    const { userEvent, step } = ctx;
    await step('The heading names the days the week shows, from today, so every one can take the call: 4 – 10 Nov. Press the week after', async () => {
      await userEvent.click(await button('The week after'));
    });
    await step('11 – 17 Nov. Today shows beside the arrows, to come back', async () => { await button('Today'); });
    await step('Press Monday at 10:00 there: the call moves to it', async () => { await pressAt(ctx, MONDAY + 7, '10:00'); });
    await step('Or press the day: a month opens, today marked and the call’s day filled', async () => {
      await userEvent.click(await button(/^Day, /));
      await screen.findByRole('dialog', { name: 'Pick a day' }, SOON);
    });
    await step('Go on to December and pick Tuesday the 1st: the call and the week go there, keeping the time. Across a month, the heading names both', async () => {
      const month = await screen.findByRole('dialog', { name: 'Pick a day' }, SOON);
      await userEvent.click(await within(month).findByRole('button', { name: /^(Next month|The month after)$/ }, SOON));
      await userEvent.click(await within(month).findByRole('button', { name: /^Tuesday 1 December/ }, SOON));
    });
  }
};

export const FindTheNextFreeTime: PageStory = {
  name: '4.22 Find the next free time',
  ...page('/calls?schedule=new', 'busy'),
  play: async (ctx) => {
    const { userEvent, step } = ctx;
    await priyaAndKofi(ctx);
    await step('Press 12:00 tomorrow, when Priya is busy. It says so, in caution, and offers the next time you’re all free', async () => {
      await pressAt(ctx, THURSDAY, '12:00');
      await says(/busy then/);
    });
    await step('Press Next free: the call is at 14:00, and you’re all free', async () => {
      await userEvent.click(await button(/^Next free/));
      await says(/all free/i);
    });
  }
};

export const ChooseTheTimesToOffer: PageStory = {
  name: '4.23 Choose the times to offer',
  ...page('/calls?schedule=new', 'busy'),
  play: async (ctx) => {
    const { userEvent, step } = ctx;
    await jonasInBerlin(ctx);
    await step('Turn on Let Jonas pick the time: three numbered times, the first lit, here and on the week', async () => {
      await userEvent.click(await switchFor(/^Let Jonas pick the time/));
    });
    await step('Press the second time: it’s lit, here and on the week. Its tick stays as it was', async () => {
      await userEvent.click(await button(/^Time 2:/));
    });
    await step('Press Friday at 15:00 on the week: the second time moves there, and stays second and lit', async () => { await pressAt(ctx, FRIDAY, '15:00'); });
    await step('Press 45 min each, and pick 1 h: every time offered is an hour long', async () => {
      await userEvent.click(await button(/^45 min each/));
      await userEvent.click(await choice('1 h'));
    });
    await step('Untick the third: it’s left out, and dashed on the week. Jonas picks from two', async () => {
      await userEvent.click(await oneOf(['checkbox', 'switch'], 'Offer time 3'));
    });
    await step('Send Jonas the times', async () => {
      await userEvent.click(await button('Send Jonas the times'));
      await toast(/Link copied for Jonas|Send Jonas the link/);
    });
  }
};
