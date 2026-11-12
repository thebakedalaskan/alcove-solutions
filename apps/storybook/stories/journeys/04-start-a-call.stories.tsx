/*
 * Starting and scheduling a call (docs/product/user-flows.md › 4. Start or schedule a call): Start now from the small modal,
 * and scheduling on the Calls page beside the week, as the design canvas "Calls and Drive" draws it (its journeys Schedule a
 * call, Pick a time on the week, Start from the week, Repeat a call, Let a guest pick, Move a call, Answer a request to move
 * and Meet again), and the ones it never drew. With Google Calendar connected the stand-in says the call is on it; Google's
 * invitations are the hand-off.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { call } from '../../src/world/build';
import { iso } from '../../src/world/clock';
import { ART, KOFI, PRIYA } from '../../src/world/people';
import { HIRING_SYNC, withDesignCrit, withHiringSync } from '../../src/world/scheduling';
import { page, pages, type PageArgs, type PageStory } from '../../src/page';
import { noCalendar } from '../pages/changes';
import { before, LATER, SOON } from './play';

const meta = { title: 'Journeys/4 Start or schedule a call', ...pages } satisfies Meta<PageArgs>;
export default meta;

type Play = NonNullable<PageStory['play']>;
type Ctx = Parameters<Play>[0];
const modal = (name: string | RegExp) => screen.findByRole('dialog', { name }, SOON);
const scheduler = (name = 'Schedule a call') => screen.findByRole('complementary', { name }, SOON);
/** Someone from the people under Who: Often with you, then Add someone else. */
async function pick({ userEvent }: Ctx, who: RegExp): Promise<void> {
  await userEvent.click(await screen.findByRole('combobox', { name: 'Add people' }, SOON));
  await userEvent.click(await screen.findByRole('option', { name: who }, SOON));
}
/** The calendars are read, and three times suit everyone. */
const read = (line: string) => screen.findByText(line, {}, LATER);
/** Thursday 5 November at 15:30 on the week, a free half hour. */
const thursdayAt = async (time: string) => within(await screen.findByRole('group', { name: 'Pick a time' }, SOON)).getByRole('button', { name: new RegExp(`^Thursday 5 November, ${time}`) });

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
    await step('Start a call, and Schedule for later. The Calls page opens on the scheduler, with the week beside it', async () => {
      const side = await screen.findByRole('complementary', { name: 'Side panel' }, SOON);
      await userEvent.click(within(side).getByRole('button', { name: /^Start a call/ }));
      await userEvent.click(within(await modal('Start a call')).getByRole('button', { name: /^Schedule for later/ }));
      await scheduler();
    });
    await step('Pick who it’s with from Often with you: Priya. Her busy times shade the week', async () => { await pick(ctx, /^Priya Raman/); });
    await step('Add Kofi, from Add someone else. Their busy times shade the week, never what’s in them', async () => {
      await pick(ctx, /^Kofi Asante/);
      await userEvent.keyboard('{Escape}');
      await read('All 3 of you are free at these times.');
    });
    await step('The best time is picked; the others glow on the week. Name it, ready to type over', async () => {
      const name = await screen.findByRole('textbox', { name: 'The call’s name' }, SOON);
      await userEvent.clear(name);
      await userEvent.type(name, 'Launch checklist review');
    });
    await step('Bring the launch checklist, so it opens in the call', async () => {
      await userEvent.click(screen.getByRole('button', { name: /^An agenda or a document/ }));
      await userEvent.click(await screen.findByRole('button', { name: /Launch checklist/ }, SOON));
      await userEvent.keyboard('{Escape}');
    });
    await step('Notes are on. Schedule: Google Calendar invites Priya and Kofi, and Undo is there for a moment', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Schedule' }));
      await screen.findByText(/Google Calendar invites Priya and Kofi/, {}, SOON);
    });
  }
};

export const PickATimeOnTheWeek: PageStory = {
  name: '4.3 Pick a time on the week',
  ...page('/calls?schedule=new', 'busy'),
  play: async (ctx) => {
    const { userEvent, step } = ctx;
    await step('Scheduling a call with Priya', async () => {
      await pick(ctx, /^Priya Raman/);
      await userEvent.keyboard('{Escape}');
      await read('You and Priya are free at these times.');
    });
    await step('Point at a free time on the week: it says who’s free then', async () => { await userEvent.hover(await thursdayAt('15:30')); });
    await step('Press it. The call moves there, and the times on the left follow', async () => { await userEvent.click(await thursdayAt('15:30')); });
    await step('Shift and the down arrow on it, or its grip dragged, make it end later, a quarter hour at a time', async () => {
      (await screen.findByRole('button', { name: /this call/ }, SOON)).focus();
      await userEvent.keyboard('{Shift>}{ArrowDown}{ArrowDown}{/Shift}');
      await screen.findByRole('button', { name: '1 h 15 min', pressed: true }, SOON);
    });
  }
};

export const StartFromTheWeek: PageStory = {
  name: '4.4 Start from the week',
  ...page(`/calls?schedule=new&slot=${encodeURIComponent(iso(1, 15, 30))}&minutes=45`, 'busy'),
  play: async (ctx) => {
    await ctx.step('Dragged across Thursday 15:30 on the Calls page’s week: scheduling opens with that time. Add who it’s with', async () => {
      await scheduler();
      await pick(ctx, /^Priya Raman/);
    });
  }
};

export const RepeatACall: PageStory = {
  name: '4.5 Repeat a call',
  ...page('/calls?schedule=new', 'busy'),
  play: async (ctx) => {
    const { userEvent, step } = ctx;
    await step('Scheduling a call with Kofi', async () => {
      await pick(ctx, /^Kofi Asante/);
      await userEvent.keyboard('{Escape}');
      await read('You and Kofi are free at these times.');
    });
    await step('Open Doesn’t repeat, and pick how often, in place: every week on the same day', async () => {
      await userEvent.click(screen.getByRole('button', { name: /^Doesn’t repeat/ }));
      await userEvent.click(await screen.findByRole('radio', { name: /^Every (Monday|Tuesday|Wednesday|Thursday|Friday)$/ }, SOON));
    });
    await step('It ends after 6 calls', async () => {
      const calls = await screen.findByRole('textbox', { name: 'How many calls' }, SOON);
      await userEvent.clear(calls);
      await userEvent.type(calls, '6{Enter}');
    });
    await step('The button says what it will do. Google Calendar invites Kofi once, to all of them', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Schedule 6 calls' }, SOON));
      await screen.findByText(/Google Calendar invites Kofi/, {}, SOON);
    });
  }
};

export const LetAGuestPick: PageStory = {
  name: '4.6 Let a guest pick',
  ...page('/calls?schedule=new', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Type Jonas’s address. He’s outside Vandelay, so his calendar can’t be read', async () => {
      await userEvent.type(await screen.findByRole('combobox', { name: 'Add people' }, SOON), 'jonas@weber.design');
      await userEvent.click(await screen.findByRole('option', { name: /jonas@weber\.design/ }, SOON));
    });
    await step('Say where he is: Berlin. Each time says what his clock reads then', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /Where Jonas is/ }, SOON));
      await userEvent.click(await screen.findByRole('option', { name: 'Berlin' }, SOON));
    });
    await step('Let Jonas pick is on, and the three times are ticked. Untick the last', async () => {
      const last = within(await screen.findByRole('group', { name: 'Times to offer' }, SOON)).getAllByRole('button', { pressed: true }).at(-1);
      if (last) await userEvent.click(last);
    });
    await step('Send Jonas the times. They’re held on Art’s calendar until he picks; the link is copied to send him', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Send Jonas the times' }));
      await screen.findByText(/The call waits until they pick a time|Send Jonas the link/, {}, SOON);
    });
  }
};

export const MoveACall: PageStory = {
  name: '4.7 Move a call',
  ...page(`/calls?schedule=move&meeting=${HIRING_SYNC.id}`, 'busy'),
  beforeEach: before(withHiringSync),
  play: async ({ userEvent, step }) => {
    await step('Change the time on Hiring sync: where it is now is dashed, and struck through above. Ines is going; Aiko hasn’t answered', async () => {
      await scheduler('Move Hiring sync');
      await read('All 3 of you are free at these times.');
    });
    await step('Pick where it goes: Friday, on the week', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Fri 6 Nov/ }, SOON));
    });
    await step('Move. Google Calendar tells Ines and Aiko, and Undo is there for a moment', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Move to Fri/ }, SOON));
      await screen.findByText(/Google Calendar tells Ines and Aiko/, {}, SOON);
    });
  }
};

export const AnswerARequestToMove: PageStory = {
  name: '4.8 Answer a request to move',
  ...page('/calls?view=soon', 'busy'),
  beforeEach: before(withHiringSync),
  play: async ({ userEvent, step }) => {
    await step('Aiko asks to move Hiring sync to 11:00. It waits on you, in rose, in Coming up. Move it', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Move it' }, LATER));
    });
    await step('Moved, and Google Calendar tells Ines and Aiko', async () => {
      await screen.findByText(/Moved to/, {}, SOON);
    });
  }
};

export const ProposeAnotherTime: PageStory = {
  name: '4.9 Propose another time',
  ...page('/calls?schedule=move&meeting=m-design-crit', 'busy'),
  beforeEach: before(withDesignCrit),
  play: async ({ userEvent, step }) => {
    await step('Kofi invited Art to Design crit. Propose another time opens the same scheduler, for asking: the times that suit Kofi, Priya and Art', async () => {
      await scheduler('Propose another time for Design crit');
      await read('All 3 of you are free at these times.');
    });
    await step('Pick a time that works, and ask. Kofi sees it, and can move the call there', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Ask to move it/ }, SOON));
      await screen.findByText(/Kofi sees your proposed time/, {}, SOON);
    });
  }
};

export const MeetAgain: PageStory = {
  name: '4.10 Meet again',
  ...page('/calls?schedule=again&note=n3', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Meet again, from the pricing sync: scheduling opens with the same people and name, and their busy times on the week', async () => {
      await scheduler();
      await read('All 3 of you are free at these times.');
    });
    await step('Schedule', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Schedule' }));
      await screen.findByText(/Google Calendar invites Maya and Lena/, {}, SOON);
    });
  }
};

export const ShareALinkInstead: PageStory = {
  name: '4.11 Share a link instead',
  ...page('/calls?schedule=new', 'busy'),
  beforeEach: before(noCalendar),
  play: async ({ userEvent, step }) => {
    await step('Nobody yet: press a time on the week', async () => { await userEvent.click(await thursdayAt('15:30')); });
    await step('Nobody’s invited, and there’s no calendar: Schedule gets a link to share, and copies it', async () => {
      await screen.findByText('Nobody’s invited: you get a link to share.', {}, SOON);
      await userEvent.click(screen.getByRole('button', { name: 'Schedule' }));
      await screen.findByText(/Link copied|Scheduled for/, {}, SOON);
    });
  }
};

export const PasteAList: PageStory = {
  name: '4.12 Paste a list of addresses',
  ...page('/calls?schedule=new', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Paste the list from an email into Who: it’s read at once, each address once', async () => {
      await userEvent.click(await screen.findByRole('combobox', { name: 'Add people' }, SOON));
      await userEvent.paste('Priya Raman <priya@vandelay.industries>, Kofi Asante <kofi@vandelay.industries>; sam@vandelay.industries\nlena@vandelay, the design team');
    });
    await step('What can’t be read is flagged one at a time. The list gives this one’s fix away: Use it', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Use it' }, SOON));
    });
    await step('This one isn’t an address at all: Leave out. The list stays one token however long it is', async () => {
      await screen.findByText(/can’t read the design team/, {}, SOON);
      await userEvent.click(screen.getByRole('button', { name: 'Leave out' }));
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
    await step('Change, at its top, opens the scheduler on the Calls page, to move it', async () => {
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
      await userEvent.click(await screen.findByRole('button', { name: 'Cancel the call' }, SOON));
    });
    await step('It comes off the calendar and everyone invited is told. Undo schedules it again, as a new call with a new link', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Undo' }, SOON));
      await screen.findByText(/new link/i, {}, SOON);
    });
  }
};

/** Priya's roadmap review tomorrow: Art is invited, and hasn't said whether he's coming. */
const ROADMAP = { ...call({ id: 'm-roadmap-review', title: 'Roadmap review', startsAt: iso(1, 10, 0), minutes: 45, code: 'rdm-revw-pry', organizer: PRIYA, guests: [ART, KOFI], rsvps: { yes: 1 } }), rsvp: null };

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
