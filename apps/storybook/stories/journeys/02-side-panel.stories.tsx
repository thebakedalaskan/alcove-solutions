/*
 * Journeys from the side panel and Search or ask (docs/product/user-flows.md › 2. The side panel). The first four are the
 * search canvas's (docs/design/canvas/StepsSearch.dc.html): find what someone said, search a word and open the moment,
 * see all in Calls, and ask a question and open a cited moment. Then the panel's own, and last your menu's, which your
 * face at the top right opens (2.9 to 2.13; the design: docs/design/canvas/you-menu).
 */
import type { Meta } from '@storybook/react-vite';
import { screen, waitFor, within } from 'storybook/test';
import { setOnline } from '../../src/browser';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import { keptHere } from '../pages/changes';
import { away, first, LAPTOP, LATER, SOON } from './play';

const meta = { title: 'Journeys/2 The side panel', ...pages } satisfies Meta<PageArgs>;
export default meta;

const palette = () => screen.findByRole('dialog', { name: 'Search or ask' }, SOON);
const line = async () => within(await palette()).getByRole('combobox', { name: /Search or ask your notes/ });
/** Waits until the lit row, the one the line points at, says `text`. */
const lit = (text: RegExp) => waitFor(async () => {
  const id = (await line()).getAttribute('aria-activedescendant');
  const row = id ? document.getElementById(id) : null;
  if (!row || !text.test(row.textContent ?? '')) throw new Error(`The lit row doesn’t say ${String(text)} yet.`);
}, SOON);

export const FindWhatSomeoneSaid: PageStory = {
  name: '2.1 Find what someone said',
  ...page('/home', 'busy', { globals: LAPTOP }),
  play: async ({ userEvent, step }) => {
    await step('Click Search or ask, or press ⌘K. The people you meet most come first, then your recent notes', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Search or ask' }, SOON));
      await within(await palette()).findByRole('button', { name: 'What Maya said' }, SOON);
    });
    await step('Type a name. They come first, lit, then every moment they spoke, call by call', async () => {
      await userEvent.type(await line(), 'maya');
      await lit(/Maya Chen/);
    });
    await step('Press Enter. Only what Maya said, newest call first, with her name in the line', async () => {
      await userEvent.keyboard('{Enter}');
      await within(await palette()).findByRole('listbox', { name: 'What Maya said' }, SOON);
    });
    await step('Type “flag” to narrow it. The lit moment shows beside the list, in its transcript', async () => {
      await userEvent.type(await line(), 'flag');
      await lit(/Does the flag change anything/);
    });
    await step('Press Enter. The note opens at that moment', async () => {
      await userEvent.keyboard('{Enter}');
      await screen.findByRole('heading', { name: 'Team standup', level: 1 }, SOON);
    });
  }
};

export const SearchAWord: PageStory = {
  name: '2.2 Search a word and open the moment',
  ...page('/home', 'busy', { globals: LAPTOP }),
  play: async ({ userEvent, step }) => {
    await step('Open Search or ask, and type a word. Each match is a moment: who said it, their words, and when', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Search or ask' }, SOON));
      await userEvent.type(await line(), 'flag');
      await lit(/Agreed\. Put it behind a flag/);
    });
    await step('Press ↓ twice. A moment that became a decision says so, and can be confirmed right here', async () => {
      await userEvent.keyboard('{ArrowDown}{ArrowDown}');
      await lit(/new onboarding ships behind a flag/);
      await userEvent.click(await within(await palette()).findByRole('button', { name: 'Confirm' }, SOON));
      await within(await palette()).findByText('Confirmed by you', {}, SOON);
    });
    await step('Press Enter. The note opens at 3:15', async () => {
      await userEvent.keyboard('{Enter}');
      await screen.findByRole('heading', { name: 'Team standup', level: 1 }, SOON);
    });
  }
};

export const SeeAllInCalls: PageStory = {
  name: '2.3 See all in Calls',
  ...page('/home', 'busy', { globals: LAPTOP }),
  play: async ({ userEvent, step }) => {
    await step('Open Search or ask, and type a word. More than fits? See all, at the foot of the list', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Search or ask' }, SOON));
      await userEvent.type(await line(), 'flag');
      await userEvent.click(await within(await palette()).findByRole('option', { name: /^See all .* in Calls/ }, SOON));
    });
    await step('Calls opens with the same words in its line: every call that has them, each with its moments', async () => {
      await screen.findByRole('heading', { name: 'Calls', level: 1 }, SOON);
      await screen.findByDisplayValue('flag', {}, SOON);
    });
  }
};

export const AskAQuestion: PageStory = {
  name: '2.4 Ask a question and open a cited moment',
  ...page('/home', 'busy', { globals: LAPTOP }),
  play: async ({ userEvent, step }) => {
    await step('Open Search or ask, and type a question. Ask comes first and is lit, so Enter asks', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Search or ask' }, SOON));
      await userEvent.type(await line(), 'Who writes the help article for support?');
      await lit(/^Ask/);
    });
    await step('Press Enter. The answer is written in confidential compute, from your notes only, with the moments it comes from', async () => {
      await userEvent.keyboard('{Enter}');
      await within(await palette()).findByRole('listbox', { name: 'From your notes' }, SOON);
    });
    await step('Click a moment it comes from. The note opens there, not playing', async () => {
      await userEvent.click(await within(await palette()).findByRole('option', { name: /help article before the flag goes on/ }, SOON));
      await screen.findByRole('heading', { name: 'Team standup', level: 1 }, SOON);
    });
  }
};

export const PinANote: PageStory = {
  name: '2.5 Pin a note',
  ...page('/home', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Point at Pinned and click the pin at the end of its heading. The palette opens to pick notes', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Pin a note' }, SOON));
    });
    await step('Pin this morning’s standup', async () => {
      const picker = await screen.findByRole('dialog', { name: 'Pin a note' }, SOON);
      await userEvent.click(within(picker).getByRole('option', { name: /^Team standup .* Pin$/ }));
      await within(picker).findByRole('option', { name: /^Team standup .* Unpin$/ }, SOON);
      await userEvent.click(within(picker).getByRole('button', { name: 'Done' }));
    });
    await step('It stays in the side panel, after the notes pinned before it', async () => {
      await within(await screen.findByRole('complementary', { name: 'Side panel' })).findByRole('link', { name: 'Team standup' }, SOON);
    });
  }
};

export const HideTheSidePanel: PageStory = {
  name: '2.6 Hide the side panel',
  ...page('/calls', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Hide the side panel. The page has the room', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Hide the side panel' }, SOON));
    });
    await step('The button left in the corner brings it back. This browser remembers which', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Show the side panel' }, SOON));
      await screen.findByRole('button', { name: 'Hide the side panel' }, SOON);
    });
  }
};

export const TheFoot: PageStory = {
  name: '2.7 The foot: a call about to start, Team, and the notes left',
  ...page('/calls', 'call-soon'),
  play: async ({ userEvent, step }) => {
    const panel = async () => within(await screen.findByRole('complementary', { name: 'Side panel' }, SOON));
    await step('Four minutes before the design review, the foot of the panel offers it, with Join. Further off it says nothing', async () => {
      await (await panel()).findByRole('link', { name: 'Join Design review' }, SOON);
    });
    await step('Click Team, at the foot. Your groups are on the Team page', async () => {
      await userEvent.click(within((await panel()).getByRole('navigation', { name: 'Team and agents' })).getByRole('link', { name: 'Team' }));
      await screen.findByRole('heading', { name: 'Team', level: 1 }, SOON);
    });
    await step('The time of notes left opens Settings at your minutes', async () => {
      await userEvent.click((await panel()).getByRole('link', { name: /of notes left$/ }));
      await screen.findByRole('region', { name: 'Plan and credits' }, SOON);
    });
  }
};

export const TheConnectionDrops: PageStory = {
  name: '2.8 The connection drops',
  ...page('/home', 'busy'),
  play: async ({ step }) => {
    await step('The connection goes. A notice says recording still works, and the rest catches up when you’re back', async () => {
      await screen.findByRole('heading', { name: 'Wednesday 4 November', level: 1 }, SOON);
      setOnline(false);
      await screen.findAllByText(/Recording still works/, {}, SOON);
    });
    await step('It comes back, and so does everything else', async () => {
      setOnline(true);
      await screen.findByRole('button', { name: 'Start now' }, SOON);
    });
  }
};

/* ------------------------------------------------------------------ your menu, at the top right */

const PHONE = { viewport: { value: 'phone', isRotated: false } };
/** Your face, at the top right of every page (in a phone's top bar): your name, your menu, and while paused, until when. */
const face = () => screen.findByRole('button', { name: /^Art Vandelay, your menu/ }, SOON);
const yourMenu = () => screen.findByRole('dialog', { name: 'Your menu' }, SOON);
/** Something in your menu, by its name: a button, or Settings, which is a link. */
const inMenu = async (name: string | RegExp, role: 'button' | 'link' = 'button') => within(await yourMenu()).findByRole(role, { name }, SOON);
/** The welcome page, signed out: it offers every way in, at the top and again at the bottom. */
const welcome = () => first(screen.findAllByRole('button', { name: 'Continue with Microsoft' }, LATER));

export const OpenYourMenu: PageStory = {
  name: '2.9 Open your menu, then Settings',
  ...page('/home', 'busy', { globals: LAPTOP }),
  play: async ({ userEvent, step }) => {
    await step('Click your face, at the top right of any page. Your menu opens under it, with a caret: you, then what you reach for from anywhere', async () => {
      await userEvent.click(await face());
      await yourMenu();
    });
    await step('Click Settings. Settings opens as a page, and your face makes way at the top right: you’re on the horizon', async () => {
      await userEvent.click(await inMenu('Settings', 'link'));
      await screen.findByRole('heading', { name: 'Art Vandelay', level: 1 }, SOON);
    });
  }
};

export const PauseForAnHour: PageStory = {
  name: '2.10 Pause notifications for an hour',
  ...page('/home', 'busy', { globals: LAPTOP }),
  play: async ({ userEvent, step }) => {
    await step('Open your menu and click Pause notifications. How long opens in place, under it: no second menu', async () => {
      await userEvent.click(await face());
      await userEvent.click(await inMenu('Pause notifications'));
      await inMenu(/^For 1 hour/);
    });
    await step('Click For 1 hour. Paused until 17:12: alerts and sounds wait until then, on every device you’re signed in on', async () => {
      await userEvent.click(await inMenu(/^For 1 hour/));
      await inMenu('Resume notifications');
    });
    await step('Press Esc. A small bell on your face says it’s paused, all the time it is', async () => {
      await userEvent.keyboard('{Escape}');
      await away('dialog', 'Your menu');
      await screen.findByRole('button', { name: /^Art Vandelay, your menu\. Notifications paused until/ }, SOON);
    });
    await step('Open the menu again and Resume, or it ends by itself at 17:12', async () => {
      await userEvent.click(await face());
      await userEvent.click(await inMenu('Resume notifications'));
      await inMenu('Pause notifications');
    });
  }
};

export const ChangeTheTheme: PageStory = {
  name: '2.11 Change the theme from your menu',
  ...page('/home', 'busy', { globals: { ...LAPTOP, theme: 'light' } }),
  play: async ({ userEvent, step }) => {
    await step('Open your menu. The three evenings are System, Light and Dark, as in Settings', async () => {
      await userEvent.click(await face());
      await within(await yourMenu()).findByRole('group', { name: 'Theme' }, SOON);
    });
    await step('Click Dark. The whole page turns at once, and the menu stays open on it', async () => {
      await userEvent.click(await inMenu('Dark'));
      await within(await yourMenu()).findByRole('button', { name: 'Dark', pressed: true }, SOON);
    });
    await step('Press Esc. It’s kept in this browser, as Settings › You › Appearance keeps it', async () => {
      await userEvent.keyboard('{Escape}');
      await away('dialog', 'Your menu');
    });
  }
};

export const SignOutWithRecordings: PageStory = {
  name: '2.12 Sign out with recordings on this device',
  ...page('/home', 'busy', { globals: LAPTOP, beforeEach: changing(keptHere) }),
  play: async ({ userEvent, step }) => {
    await step('Recordings on this device haven’t uploaded yet. Open your menu and click Sign out', async () => {
      await userEvent.click(await face());
      await userEvent.click(await inMenu('Sign out'));
    });
    await step('The menu asks in place, in Settings’ own words, under your name. Stay signed in loses nothing, and has the focus', async () => {
      await inMenu('Stay signed in');
    });
    await step('Press Esc: back to the menu’s rows, on Sign out. Press Enter, and it asks again', async () => {
      await userEvent.keyboard('{Escape}');
      await inMenu('Sign out');
      await userEvent.keyboard('{Enter}');
      await inMenu('Stay signed in');
    });
    await step('Sign out and delete them. Only this account’s recordings go', async () => {
      await userEvent.click(await inMenu('Sign out and delete them'));
    });
    await step('Signed out, on the welcome page', async () => {
      await welcome();
    });
  }
};

export const YourMenuOnAPhone: PageStory = {
  name: '2.13 Your menu on a phone',
  ...page('/home', 'busy', { globals: PHONE, beforeEach: changing(keptHere) }),
  play: async ({ userEvent, step }) => {
    await step('Tap your face in the top bar. The menu rises as a sheet', async () => {
      await userEvent.click(await face());
      await yourMenu();
    });
    await step('Tap Pause notifications. How long opens in place', async () => {
      await userEvent.click(await inMenu('Pause notifications'));
      await inMenu(/^For 1 hour/);
    });
    await step('Tap For 1 hour, and close the sheet. Paused: the bell is on your face', async () => {
      await userEvent.click(await inMenu(/^For 1 hour/));
      await inMenu('Resume notifications');
      await userEvent.keyboard('{Escape}');
      await screen.findByRole('button', { name: /Notifications paused until/ }, SOON);
    });
    await step('Tap your face again, then Sign out. It asks here too: recordings on this phone haven’t uploaded', async () => {
      await userEvent.click(await face());
      await userEvent.click(await inMenu('Sign out'));
      await inMenu('Stay signed in');
    });
    await step('Sign out and delete them. Signed out, on the welcome page', async () => {
      await userEvent.click(await inMenu('Sign out and delete them'));
      await welcome();
    });
  }
};
