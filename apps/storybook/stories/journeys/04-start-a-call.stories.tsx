/*
 * Starting and scheduling a call (docs/product/user-flows.md › 4. Start or schedule a call): the canvas's journey through
 * the modal (docs/design/canvas/home.js, AH.JOURNEYS), and the ones it never drew. With Google Calendar connected the
 * stand-in says the call is on it; Google's invitations are the hand-off.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { call, notConnected } from '../../src/world/build';
import { iso } from '../../src/world/clock';
import { ART, KOFI, PRIYA } from '../../src/world/people';
import { page, pages, type PageArgs, type PageStory } from '../../src/page';
import { before, LATER, SOON } from './play';

const meta = { title: 'Journeys/4 Start or schedule a call', ...pages } satisfies Meta<PageArgs>;
export default meta;

const modal = (name: string | RegExp) => screen.findByRole('dialog', { name }, SOON);
const scheduling = () => modal('Schedule a call');

export const StartNow: PageStory = {
  name: '4.1 Start now',
  ...page('/notes', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Press N, from any page. A small modal asks one thing: now, or later?', async () => {
      await screen.findByRole('heading', { name: 'Notes', level: 1 }, SOON);
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

export const ScheduleForLater: PageStory = {
  name: '4.2 Schedule for later',
  ...page('/home', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click Start a call, or press N', async () => {
      const side = await screen.findByRole('complementary', { name: 'Side panel' }, SOON);
      await userEvent.click(within(side).getByRole('button', { name: /^Start a call/ }));
    });
    await step('A modal asks one thing: now, or later?', async () => {
      await userEvent.click(within(await modal('Start a call')).getByRole('button', { name: /^Schedule for later/ }));
    });
    await step('Schedule for later. Same modal: who’s it with? A group counts everyone in it once', async () => {
      await userEvent.type(within(await scheduling()).getByRole('combobox', { name: 'Add people' }), 'Prod');
      await userEvent.click(await screen.findByRole('option', { name: /^Product Group/ }, SOON));
      await userEvent.click(screen.getByRole('button', { name: 'Find a time' }));
    });
    await step('When? Only times you’re free, the times that suit the most people first', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Use / }, SOON));
    });
    await step('Check the details, then Schedule. The name is ready to type over', async () => {
      const name = await screen.findByRole('textbox', { name: 'Name the call' }, SOON);
      await userEvent.clear(name);
      await userEvent.type(name, 'Launch review');
      await userEvent.click(screen.getByRole('button', { name: /^Schedule/ }));
    });
    await step('Back on Home. The call is on your day, and the toast says what happened, and only that', async () => {
      await screen.findByText(/On your Google Calendar/, {}, SOON);
      await within(await screen.findByRole('region', { name: 'Upcoming' })).findByRole('button', { name: /Launch review/ }, SOON);
    });
  }
};

export const PasteAList: PageStory = {
  name: '4.3 Paste a list of addresses',
  ...page('/home', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Schedule, and paste the list from an email into Who: it’s read at once, each address once', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Schedule' }, SOON));
      await userEvent.click(within(await scheduling()).getByRole('combobox', { name: 'Add people' }));
      await userEvent.paste('Priya Raman <priya@vandelay.industries>, Kofi Asante <kofi@vandelay.industries>; sam@vandelay.industries\nlena@vandelay, the design team');
    });
    await step('What can’t be read is flagged one at a time. The list gives this one’s fix away: Use it', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Use it' }, SOON));
    });
    await step('This one isn’t an address at all: Leave out', async () => {
      await screen.findByText(/can’t read the design team/, {}, SOON);
      await userEvent.click(screen.getByRole('button', { name: 'Leave out' }));
    });
    await step('The list stays one token however long it is. Find a time for all of them', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Find a time' }));
      await screen.findByRole('heading', { name: 'When works for everyone?' }, SOON);
    });
  }
};

export const AnotherTimeEveryWeek: PageStory = {
  name: '4.4 Another time, every week',
  ...page('/home', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Schedule a call with Kofi, and Find a time', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Schedule' }, SOON));
      await userEvent.type(within(await scheduling()).getByRole('combobox', { name: 'Add people' }), 'Kofi');
      await userEvent.click(await screen.findByRole('option', { name: /^Kofi Asante/ }, SOON));
      await userEvent.click(screen.getByRole('button', { name: 'Find a time' }));
    });
    await step('Pick another time. The modal widens around the week, Monday to Sunday and the whole day, with your own things by name and when anyone is busy', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Pick another time' }, SOON));
      await screen.findByRole('group', { name: 'Pick a time' }, SOON);
    });
    await step('Every half hour can be picked, the weekend too: Saturday at 10:00', async () => {
      await userEvent.click(within(screen.getByRole('group', { name: 'Pick a time' })).getByRole('button', { name: /^Sat 7 Nov, 10:00/ }));
    });
    await step('The line under the times reads Sat 7 Nov, 10:00 – 10:45. Type an end, 11:15: the call is 1 h 15 min, beside the three lengths', async () => {
      const end = await screen.findByLabelText('Ends', {}, SOON);
      await userEvent.clear(end);
      await userEvent.type(end, '11:15');
      await userEvent.tab();
      await screen.findByRole('button', { name: '1 h 15 min', pressed: true }, SOON);
    });
    await step('In the week, the bar on the call’s bottom edge drags its end, a quarter hour at a time; Shift and the down arrow on it do the same: 11:30', async () => {
      within(screen.getByRole('group', { name: 'Pick a time' })).getByRole('button', { name: /^Sat 7 Nov, 10:00 to 11:15, picked/ }).focus();
      await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}');
      await screen.findByRole('button', { name: '1 h 30 min', pressed: true }, SOON);
    });
    await step('Doesn’t repeat opens how it repeats: every Saturday', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Doesn’t repeat' }));
      await userEvent.click(within(await screen.findByRole('group', { name: 'How it repeats' }, SOON)).getByRole('button', { name: /^Every Saturday/ }));
      await userEvent.click(screen.getByRole('button', { name: /^Use / }));
    });
    await step('The button says what it will do, and the calls go on the calendar', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Schedule \d+ calls/ }, SOON));
      await screen.findByText(/On your Google Calendar/, {}, SOON);
    });
  }
};

export const LetAGuestPick: PageStory = {
  name: '4.5 Let a guest pick the time',
  ...page('/home', 'on-their-own'),
  play: async ({ userEvent, step }) => {
    await step('On your own, Schedule a call with someone you’ve met: Ana', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Schedule' }, SOON));
      await userEvent.type(within(await scheduling()).getByRole('combobox', { name: 'Add people' }), 'Ana');
      await userEvent.click(await screen.findByRole('option', { name: /^Ana Souza/ }, SOON));
      await userEvent.click(screen.getByRole('button', { name: 'Find a time' }));
    });
    await step('Ana’s calendar can’t be read, so these times are free on yours. Let Ana pick', async () => {
      await userEvent.click(await screen.findByRole('switch', { name: 'Let Ana pick' }, SOON));
    });
    await step('The times stay ticked, and the call has no time until Ana picks one from its link', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^(Offer|Use|Next)/ }, SOON));
    });
    await step('Details, then the button that says what it does. The link is copied to send Ana, and Upcoming says she’s picking a time', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^(Get the link|Schedule|Copy)/ }, SOON));
      await within(await screen.findByRole('region', { name: 'Upcoming' })).findByRole('button', { name: /Ana is picking a time/ }, SOON);
    });
  }
};

export const ShareALinkInstead: PageStory = {
  name: '4.6 Share a link instead',
  ...page('/home', 'busy'),
  beforeEach: before((w) => { w.calendar = notConnected; }),
  play: async ({ userEvent, step }) => {
    await step('Schedule, and Skip, I’ll share a link: nobody is invited', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Schedule' }, SOON));
      await userEvent.click(within(await scheduling()).getByRole('button', { name: 'Skip, I’ll share a link' }));
    });
    await step('When? Your own free times', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Use / }, SOON));
    });
    await step('Details offers Connect Google Calendar in a new tab. Leave it disconnected and schedule with a link', async () => {
      await screen.findByRole('link', { name: 'Connect Google Calendar' }, SOON);
      await screen.findByText('You get a link to share.', {}, SOON);
      await userEvent.click(screen.getByRole('button', { name: 'Schedule' }));
      await screen.findByText(/copied/i, {}, SOON);
    });
  }
};

export const ChangeAScheduledCall: PageStory = {
  name: '4.7 Change a scheduled call',
  ...page('/home', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('A scheduled call opens one card from its row in Upcoming', async () => {
      const coming = await screen.findByRole('region', { name: 'Upcoming' }, SOON);
      await userEvent.click(within(coming).getByRole('button', { name: /1:1 with Maya/ }));
    });
    await step('Change the time: the times you’re both free', async () => {
      await userEvent.click(within(await modal('1:1 with Maya')).getByRole('button', { name: /^Change the time/ }));
      await userEvent.click(await screen.findByRole('button', { name: /^Tomorrow 14:00/ }, SOON));
    });
    await step('Move and tell 1 person. Only what changed is sent, and everyone invited gets the update', async () => {
      await userEvent.click(screen.getByRole('button', { name: /^Move and tell/ }));
      await screen.findByRole('button', { name: 'Undo' }, SOON);
    });
    await step('The card settles away, and the row moves to its new time', async () => {
      await within(await screen.findByRole('region', { name: 'Upcoming' })).findByRole('button', { name: /^Thu 14:00 1:1 with Maya/ }, SOON);
    });
    await step('Open it again: the pen renames it, and Enter keeps the name', async () => {
      await userEvent.click(within(screen.getByRole('region', { name: 'Upcoming' })).getByRole('button', { name: /^Thu 14:00 1:1 with Maya/ }));
      await userEvent.click(within(await modal('1:1 with Maya')).getByRole('button', { name: 'Rename this call' }));
      const name = within(await modal('1:1 with Maya')).getByRole('textbox');
      await userEvent.clear(name);
      await userEvent.type(name, 'Maya and Art{Enter}');
      await screen.findByRole('heading', { name: 'Maya and Art' }, SOON);
    });
  }
};

export const CancelAScheduledCall: PageStory = {
  name: '4.8 Cancel a scheduled call',
  ...page('/home', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Open the design sync from Upcoming', async () => {
      const coming = await screen.findByRole('region', { name: 'Upcoming' }, SOON);
      await userEvent.click(within(coming).getByRole('button', { name: /Design sync/ }));
    });
    await step('Cancel this call asks once, in place', async () => {
      await userEvent.click(within(await modal('Design sync')).getByRole('button', { name: 'Cancel this call' }));
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
  name: '4.9 Answer an invitation',
  ...page('/home', 'busy'),
  beforeEach: before((w) => { w.meetings.push(structuredClone(ROADMAP)); }),
  play: async ({ userEvent, step }) => {
    await step('Someone else’s call you’re invited to opens the same card from its row', async () => {
      const coming = await screen.findByRole('region', { name: 'Upcoming' }, SOON);
      await userEvent.click(within(coming).getByRole('button', { name: /Roadmap review/ }));
      await modal('Roadmap review');
    });
    await step('Answer Yes, Maybe or No. It shows who’s coming, and what was brought', async () => {
      await userEvent.click(within(await modal('Roadmap review')).getByRole('button', { name: /^Yes/ }));
      await within(await modal('Roadmap review')).findByRole('button', { name: /^Yes/, pressed: true }, SOON);
    });
  }
};

