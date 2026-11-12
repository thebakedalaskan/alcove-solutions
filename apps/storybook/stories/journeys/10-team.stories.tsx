/* Journeys on the Team page (docs/product/user-flows.md › 10. Team), from the canvas's Team board (docs/design/canvas/data-team.js). */
import { AlcoveApiError } from '@alcove/api';
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { standIn } from '../../src/api/standin';
import { isOnline, setOnline } from '../../src/browser';
import { withTeamInvite } from '../../src/api/scenarios';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import { away, holding, keepMail, LATER, outage, pressable, SOON, swap, unreachable } from './play';

const meta = { title: 'Journeys/10 Team', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** Someone standing on the horizon, by the name their arch is known by. */
const arch = async (name: string) => within(await screen.findByRole('list', { name: /^People at / }, LATER)).getByRole('button', { name });
/** Someone's popover, open under their arch. */
const popover = (name: string) => screen.findByRole('dialog', { name }, SOON);
/** The Groups section under the water. */
const groups = () => screen.findByRole('region', { name: 'Groups' }, SOON);
/** A group open across the column. */
const openGroup = (name: string) => screen.findByRole('article', { name }, SOON);

/** Alcove failing for a moment on the server's side, as a request does when the database connection drops. */
const dropped = () => new AlcoveApiError('unavailable', 'Alcove lost its connection to the database. Try again.', { requestId: 'sb-journey' });
const teamDown = outage(() => swap(standIn.people, 'team', () => Promise.reject(dropped())));
/** The team's request not getting through: the connection is going. */
const teamUnreachable = outage(() => swap(standIn.people, 'team', () => Promise.reject(unreachable())));
/** Your groups live in your preferences: they fail on their own, once there's a connection to fail on. */
const groupsDown = outage(() => swap(standIn.account, 'preferences', () => Promise.reject(isOnline() ? dropped() : unreachable())));

export const RingSomeone: PageStory = {
  name: '10.1 Ring someone',
  ...page('/team', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click someone on the horizon', async () => {
      await userEvent.click(await arch('Priya Raman'));
    });
    await step('A popover opens under their arch. Everything about them is here, not under every arch', async () => {
      await within(await popover('Priya Raman')).findByText('Next call · 17:30');
    });
    await step('Ring goes straight to the join screen, and they hear a ring when you join', async () => {
      await userEvent.click(within(await popover('Priya Raman')).getByRole('button', { name: 'Ring' }));
      await screen.findByText('Priya hears a ring when you join.', {}, LATER);
    });
  }
};

export const ScheduleWithSomeone: PageStory = {
  name: '10.2 Schedule a call with someone',
  ...page('/team', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click Schedule in their popover', async () => {
      await userEvent.click(await arch('Priya Raman'));
      await userEvent.click(within(await popover('Priya Raman')).getByRole('button', { name: 'Schedule' }));
    });
    await step('The scheduler opens on the Calls page with Priya in it: only times you’re both free, the best one picked', async () => {
      const scheduler = await screen.findByRole('complementary', { name: 'Schedule a call' }, SOON);
      await within(scheduler).findByText('You and Priya are free at these times.', {}, LATER);
    });
    await step('Schedule. It’s on your calendar, and Google Calendar invites Priya', async () => {
      await userEvent.click(within(await screen.findByRole('complementary', { name: 'Schedule a call' }, SOON)).getByRole('button', { name: 'Schedule' }));
      await screen.findByText(/Google Calendar invites Priya/, {}, SOON);
    });
  }
};

export const NotesYouBothHave: PageStory = {
  name: '10.3 The notes you both have',
  ...page('/team', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click Notes you both have', async () => {
      await userEvent.click(await arch('Priya Raman'));
      await userEvent.click(within(await popover('Priya Raman')).getByRole('button', { name: /^Notes you both have/ }));
    });
    await step('The same popover lists them, and the last line opens them all in Calls. Each one opens its note', async () => {
      const notes = await popover('Priya Raman');
      await within(notes).findByRole('link', { name: 'Open in Calls' }, SOON);
      await userEvent.click(within(notes).getByRole('link', { name: /^Team standup/ }));
      await screen.findByRole('heading', { name: 'Team standup', level: 1 }, LATER);
    });
  }
};

export const SomeoneNotOnAlcove: PageStory = {
  name: '10.4 Someone not on Alcove yet',
  ...page('/team', 'busy'),
  beforeEach: keepMail,
  play: async ({ userEvent, step }) => {
    await step('An empty arch is someone not on Alcove yet. Click it', async () => {
      await userEvent.click(await arch('Sam Ortiz, not on Alcove yet'));
    });
    await step('The same popover, with Invite in place of Ring', async () => {
      await within(await popover('Sam Ortiz')).findByRole('link', { name: 'Invite' }, SOON);
    });
    await step('Invite opens your own email. Now it offers Remind', async () => {
      await userEvent.click(within(await popover('Sam Ortiz')).getByRole('link', { name: 'Invite' }));
      await screen.findByText('Your email opens with an invitation to Sam.', {}, SOON);
      await within(await popover('Sam Ortiz')).findByRole('link', { name: 'Remind' }, SOON);
    });
  }
};

export const YourOwnArch: PageStory = {
  name: '10.5 Your own arch',
  ...page('/team', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('You stand in the middle. Your popover has your address and Settings', async () => {
      await userEvent.click(await arch('You, Art Vandelay'));
      const you = await popover('Art Vandelay');
      await within(you).findByText('art@vandelay.industries');
      await within(you).findByRole('link', { name: 'Settings' });
    });
  }
};

export const InvitePeople: PageStory = {
  name: '10.6 Invite people',
  ...page('/team', 'busy'),
  beforeEach: keepMail,
  play: async ({ userEvent, step }) => {
    await step('Click Invite people, the one filled button', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Invite people' }, LATER));
    });
    await step('A popover opens under it and takes the filled button. Pick people, or type a whole address', async () => {
      const invite = await screen.findByRole('dialog', { name: 'Invite people' }, SOON);
      await userEvent.click(await within(invite).findByRole('option', { name: /^Sam Ortiz/ }, SOON));
      await userEvent.type(within(invite).getByRole('combobox', { name: 'Name or email' }), 'lena@vandelay.industries');
    });
    await step('Invite 2 opens your own email to both of them', async () => {
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Invite people' })).getByRole('button', { name: 'Invite 2' }));
      await screen.findByText(/^Your email opens with an invitation to (Sam and Lena|Lena and Sam)\./, {}, SOON);
    });
    await step('They move to Invited, with Remind', async () => {
      await within(await holding('listitem', 'Sam Ortiz')).findByRole('link', { name: 'Remind' }, SOON);
      await within(await holding('listitem', 'Lena Fischer')).findByRole('link', { name: 'Remind' }, SOON);
    });
  }
};

export const CopyTheInviteLink: PageStory = {
  name: '10.7 Or copy the invite link',
  ...page('/team', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click Copy link in the same popover', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Invite people' }, LATER));
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Invite people' }, SOON)).getByRole('button', { name: 'Copy link' }));
    });
    await step('The popover closes, and the link to sign in is on your clipboard', async () => {
      // A browser that won't copy for the page shows the link to copy instead.
      await screen.findByText(/^(Invite link copied\. It opens the page to sign in\.|Copy this link:)/, {}, SOON);
      await away('dialog', 'Invite people');
    });
  }
};

export const InviteAndRemindOnARow: PageStory = {
  name: '10.8 Invite and Remind on a row',
  ...page('/team', 'busy'),
  beforeEach: keepMail,
  play: async ({ userEvent, step }) => {
    await step('Invite sits in the same column on every row', async () => {
      await userEvent.click(within(await holding('listitem', 'Sam Ortiz', LATER)).getByRole('link', { name: 'Invite' }));
    });
    await step('Your email opens. The row says Invited, and the button says Remind', async () => {
      await screen.findByText('Your email opens with an invitation to Sam.', {}, SOON);
      const sam = await holding('listitem', /Sam Ortiz.*Invited/);
      await within(sam).findByRole('link', { name: 'Remind' }, SOON);
    });
    await step('Remind, for someone you’ve asked already', async () => {
      await userEvent.click(within(await holding('listitem', 'Diego Ruiz')).getByRole('link', { name: 'Remind' }));
    });
    await step('Your email opens with a reminder', async () => {
      await screen.findByText('Your email opens with a reminder to Diego.', {}, SOON);
    });
  }
};

export const InviteEveryoneLeft: PageStory = {
  name: '10.9 Invite everyone left',
  ...page('/team', 'busy'),
  beforeEach: keepMail,
  play: async ({ userEvent, step }) => {
    await step('Invite all asks everyone who hasn’t been asked', async () => {
      await userEvent.click(await screen.findByRole('link', { name: 'Invite all 2' }, LATER));
    });
    await step('One email to all of them. Every row moves to Remind', async () => {
      await screen.findByText(/^Your email opens with an invitation to (Lena and Sam|Sam and Lena)\./, {}, SOON);
      await within(await holding('listitem', 'Lena Fischer')).findByRole('link', { name: 'Remind' }, SOON);
      await within(await holding('listitem', 'Sam Ortiz')).findByRole('link', { name: 'Remind' }, SOON);
    });
  }
};

export const NewGroup: PageStory = {
  name: '10.10 New group: name it, then fill it',
  ...page('/team', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click New group', async () => {
      await userEvent.click(within(await groups()).getByRole('button', { name: 'New group' }));
    });
    await step('The tile opens in place, ready for a name', async () => {
      await userEvent.type(await screen.findByRole('textbox', { name: 'New group’s name' }, SOON), 'Design');
    });
    await step('Enter opens the people picker. So does Add people', async () => {
      await userEvent.keyboard('{Enter}');
      await screen.findByRole('dialog', { name: 'Add people to Design' }, SOON);
    });
    await step('Pick people, or type a whole address, then Add. Enter ticks and clears the line, and Enter again adds them', async () => {
      const line = within(await screen.findByRole('dialog', { name: 'Add people to Design' })).getByRole('combobox', { name: 'Name or email' });
      await userEvent.type(line, 'Kofi');
      await within(await screen.findByRole('dialog', { name: 'Add people to Design' })).findByRole('option', { name: /^Kofi Asante/ }, SOON);
      await userEvent.keyboard('{Enter}');
      await userEvent.type(line, 'aiko@vandelay.industries{Enter}');
      await within(await screen.findByRole('dialog', { name: 'Add people to Design' })).findByRole('button', { name: 'Add 2' }, SOON);
      await userEvent.keyboard('{Enter}');
    });
    await step('They’re in. Create group takes the filled button: click it', async () => {
      const making = await openGroup('New group');
      await within(making).findByRole('list', { name: 'People in Design' }, SOON);
      await userEvent.click(within(making).getByRole('button', { name: 'Create group' }));
    });
    await step('The group stays open, with everything you can do to it', async () => {
      const made = await openGroup('Design');
      await within(made).findByRole('button', { name: 'Rename Design' }, SOON);
    });
  }
};

export const NameTakenAndHalfMade: PageStory = {
  name: '10.11 A name that’s taken, and a group half made',
  ...page('/team', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('A name has to be new. It says so on the line', async () => {
      await userEvent.click(within(await groups()).getByRole('button', { name: 'New group' }));
      await userEvent.type(await screen.findByRole('textbox', { name: 'New group’s name' }, SOON), 'Leads{Enter}');
      await screen.findByText('You already have a group called Leads.', {}, SOON);
    });
    await step('Leave a group half made and it waits on its tile. ✕ throws it away', async () => {
      const name = screen.getByRole('textbox', { name: 'New group’s name' });
      await userEvent.clear(name);
      await userEvent.type(name, 'Design{Escape}');
      const waiting = await holding('article', 'Design');
      await within(waiting).findByRole('button', { name: 'Keep making Design' }, SOON);
      await userEvent.click(within(waiting).getByRole('button', { name: 'Discard this group' }));
      await within(await groups()).findByRole('button', { name: 'New group' }, SOON);
    });
  }
};

export const OpenAGroup: PageStory = {
  name: '10.12 Open a group in place',
  ...page('/team', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click a group’s tile. It says how many calls had all of them', async () => {
      await within(await groups()).findByText('3 people · 1 call', {}, SOON);
      await userEvent.click(within(await groups()).getByRole('button', { name: 'Open Leads' }));
    });
    await step('It opens right there, across the column, with everything you can do to it', async () => {
      const leads = await openGroup('Leads');
      await within(leads).findByRole('list', { name: 'People in Leads' }, SOON);
      await within(leads).findByRole('button', { name: 'Delete Leads' }, SOON);
    });
  }
};

export const AddAndRemovePeople: PageStory = {
  name: '10.13 Add and remove people',
  ...page('/team?group=g-leads', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click Add people', async () => {
      await userEvent.click(within(await openGroup('Leads')).getByRole('button', { name: 'Add people' }));
    });
    await step('The people picker opens under it. Pick someone, then Add', async () => {
      const picker = await screen.findByRole('dialog', { name: 'Add people to Leads' }, SOON);
      await userEvent.click(await within(picker).findByRole('option', { name: /^Aiko Tanaka/ }, SOON));
      await userEvent.click(within(picker).getByRole('button', { name: 'Add 1' }));
    });
    await step('They’re in the group. ✕ takes someone out', async () => {
      const people = within(await openGroup('Leads')).getByRole('list', { name: 'People in Leads' });
      await within(people).findByRole('button', { name: 'Take Aiko Tanaka out of Leads' }, SOON);
      await userEvent.click(within(people).getByRole('button', { name: 'Take Kofi Asante out of Leads' }));
    });
    await step('Gone from the group, at once. A group always keeps one person', async () => {
      await away('button', 'Take Kofi Asante out of Leads');
    });
  }
};

export const CallAllOfThem: PageStory = {
  name: '10.14 Start a call with all of them',
  ...page('/team', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Every tile has a call button, so you don’t have to open it first', async () => {
      await userEvent.click(within(await groups()).getByRole('button', { name: 'Start a call with Leads' }));
    });
    await step('Start a call opens with the whole group picked', async () => {
      const start = await screen.findByRole('dialog', { name: 'Start a call' }, SOON);
      await within(start).findByRole('heading', { name: 'Start a call with Leads' }, SOON);
    });
    await step('Start now rings them all when you join', async () => {
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Start a call' })).getByRole('button', { name: /^Start now/ }));
      await screen.findByText('Priya, Kofi and Ines hear a ring when you join.', {}, LATER);
    });
  }
};

export const RenameAGroup: PageStory = {
  name: '10.15 Rename a group',
  ...page('/team?group=g-leads', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click the pen', async () => {
      await userEvent.click(within(await openGroup('Leads')).getByRole('button', { name: 'Rename Leads' }));
    });
    await step('The name becomes a field where it is. Enter keeps it, Escape leaves it', async () => {
      await screen.findByRole('textbox', { name: 'Group name' }, SOON);
    });
    await step('A name has to be new, here too', async () => {
      const name = screen.getByRole('textbox', { name: 'Group name' });
      await userEvent.clear(name);
      await userEvent.type(name, 'Product{Enter}');
      await screen.findByText('You already have a group called Product.', {}, SOON);
    });
    await step('Renamed, where it is', async () => {
      const name = screen.getByRole('textbox', { name: 'Group name' });
      await userEvent.clear(name);
      await userEvent.type(name, 'Leadership{Enter}');
      await screen.findByRole('heading', { name: 'Leadership', level: 3 }, SOON);
    });
  }
};

export const DeleteAGroup: PageStory = {
  name: '10.16 Delete a group',
  ...page('/team?group=g-leads', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click the bin', async () => {
      await userEvent.click(within(await openGroup('Leads')).getByRole('button', { name: 'Delete Leads' }));
    });
    await step('It asks once, in a popover, and says what happens to shared notes', async () => {
      const ask = await screen.findByRole('dialog', { name: 'Delete Leads' }, SOON);
      await userEvent.click(within(ask).getByRole('button', { name: /Notes you shared with it stay with the people who have them/ }));
    });
    await step('Gone, with Undo for a few seconds', async () => {
      await screen.findByText('Deleted Leads.', {}, SOON);
      await screen.findByRole('button', { name: 'Undo' }, SOON);
    });
  }
};

export const ThreeAndThirty: PageStory = {
  name: '10.17 Three people, and thirty',
  ...page('/team', 'lots'),
  play: async ({ userEvent, step }) => {
    await step('Thirty-three: the people you see most stay close and named. Everyone else recedes into the haze, on the same line', async () => {
      await screen.findByRole('button', { name: 'All 33 people' }, LATER);
    });
    await step('Hover anyone far away and they step forward with their name. Clicking opens the same popover', async () => {
      const tess = await arch('Tess Ward');
      await userEvent.hover(tess);
      await userEvent.click(tess);
      await popover('Tess Ward');
    });
  }
};

export const FindOneOfThirty: PageStory = {
  name: '10.18 Find one person out of thirty',
  ...page('/team', 'lots'),
  play: async ({ userEvent, step }) => {
    await step('Once the line recedes, this button appears', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'All 33 people' }, LATER));
    });
    await step('Everyone, in one list you can search', async () => {
      const all = await screen.findByRole('dialog', { name: 'Everyone at your company' }, SOON);
      await userEvent.type(within(all).getByRole('combobox', { name: 'Find someone' }), 'Tess');
      await userEvent.click(await within(all).findByRole('option', { name: /Tess Ward/ }, SOON));
    });
    await step('Pick someone. They step forward on the line, and the popover opens from their arch', async () => {
      await popover('Tess Ward');
    });
  }
};

export const NobodyElseYet: PageStory = {
  name: '10.19 Nobody else here yet',
  ...page('/team', 'first-day'),
  play: async ({ userEvent, step }) => {
    await step('You stand beside empty arches for the people you meet most, with the sun in one of them', async () => {
      await screen.findByRole('heading', { name: 'Bring your team to Alcove', level: 1 }, LATER);
      await screen.findByRole('region', { name: 'People you meet most' }, SOON);
    });
    await step('A group opens in its own column here: the name and the tools on one line, the two buttons on the next', async () => {
      await userEvent.click(within(await groups()).getByRole('button', { name: 'New group' }));
      await userEvent.type(await screen.findByRole('textbox', { name: 'New group’s name' }, SOON), 'Design{Enter}');
      const picker = await screen.findByRole('dialog', { name: 'Add people to Design' }, SOON);
      await userEvent.click(await within(picker).findByRole('option', { name: /^Kofi Asante/ }, SOON));
      await userEvent.click(within(picker).getByRole('option', { name: /^Sam Ortiz/ }));
      await userEvent.click(within(picker).getByRole('button', { name: 'Add 2' }));
      await userEvent.click(within(await openGroup('New group')).getByRole('button', { name: 'Create group' }));
      await within(await openGroup('Design')).findByRole('list', { name: 'People in Design' }, SOON);
    });
  }
};

export const TeamDoesNotLoad: PageStory = {
  name: '10.20 The team doesn’t load',
  ...page('/team', 'busy'),
  beforeEach: teamDown.begin,
  play: async ({ userEvent, step }) => {
    await step('It says why, with Try again. Groups and notes load on their own, so they still work', async () => {
      await screen.findByRole('heading', { name: 'Your team didn’t load', level: 1 }, LATER);
      await within(await groups()).findByRole('button', { name: 'Open Leads' }, SOON);
    });
    await step('Trying again. Empty arches wait on the line', async () => {
      teamDown.end();
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
    await step('Everyone comes up over the horizon', async () => {
      await screen.findByRole('list', { name: 'People at Vandelay Industries' }, LATER);
    });
  }
};

export const OfflineAndGroups: PageStory = {
  name: '10.21 Offline, and groups that don’t load',
  ...page('/team', 'busy'),
  beforeEach: [teamUnreachable.begin, groupsDown.begin],
  play: async ({ step }) => {
    await step('Offline, it says so, and comes back by itself', async () => {
      // The connection goes while the team is on its way, and comes back.
      await screen.findByRole('heading', { name: 'Your team', level: 1 }, LATER);
      setOnline(false);
      await screen.findByRole('heading', { name: 'You’re offline', level: 1 }, SOON);
      teamUnreachable.end();
      setOnline(true);
      await screen.findByRole('list', { name: 'People at Vandelay Industries' }, LATER);
    });
    await step('If only your groups fail, their section says so. The rest of the page works', async () => {
      await within(await groups()).findByText('Your groups didn’t load.', {}, LATER);
      await screen.findByRole('region', { name: 'Not on Alcove yet' }, SOON);
    });
  }
};

export const StartATeamAndInvite: PageStory = {
  name: '10.22 Start a team, buy licenses, invite',
  ...page('/team', 'no-team'),
  play: async ({ userEvent, step }) => {
    await step('Start a team, and name it', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Start a team' }, LATER));
      await userEvent.type(await screen.findByRole('textbox', { name: 'Name the team' }, SOON), 'Vandelay Industries');
      await userEvent.click(screen.getByRole('button', { name: 'Make it' }));
    });
    await step('You’re its admin. Licenses are bought in Settings › Plan', async () => {
      await userEvent.click(await screen.findByRole('link', { name: 'Buy licenses in Settings' }, LATER));
    });
    await step('Pick how many on Team’s card, and buy them from the balance', async () => {
      const count = await screen.findByRole('spinbutton', { name: 'Licenses' }, LATER);
      await userEvent.clear(count);
      await userEvent.type(count, '2');
      await userEvent.click(await pressable('button', 'Buy 2 licenses'));
      await screen.findByText(/Bought 2 licenses/, {}, SOON);
    });
    await step('Back on Team, Invite makes a link for one person, shown once to copy', async () => {
      await userEvent.click((await screen.findAllByRole('link', { name: 'Team' }, SOON))[0] ?? screen.getByRole('link', { name: 'Team' }));
      await userEvent.click(await screen.findByRole('button', { name: /^Invite$/ }, LATER));
      await screen.findByRole('group', { name: 'Link to join the team' }, SOON);
    });
  }
};

export const JoinATeam: PageStory = {
  name: '10.23 Join a team by its link',
  ...page('/team/join', 'team-join'),
  beforeEach: changing(withTeamInvite()),
  play: async ({ userEvent, step }) => {
    await step('The link asks first: whose team, and Join or Not now', async () => {
      await screen.findByRole('heading', { name: /^Join Vandelay Industries, Priya’s team\?$/ }, LATER);
    });
    await step('Join takes one of the team’s licenses, and the Team page opens on it', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Join' }));
      await screen.findByRole('region', { name: 'People on Vandelay Industries' }, LATER);
    });
  }
};
