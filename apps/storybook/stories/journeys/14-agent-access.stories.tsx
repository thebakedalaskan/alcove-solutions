/*
 * Agent access (docs/product/user-flows.md › 14), from the canvas's Agents boards (docs/design/canvas/StepsAgents.dc.html,
 * its captions in data-agents.js): Agents from the side panel, connecting each kind of agent, allowing one on Agents with
 * less than it asks for, changing and disconnecting one, what your agents did, a token for a script, keeping one longer,
 * a request that ended, Settings' way there, and a phone. The agents are outside Storybook: a journey plays up to handing
 * over to them and opens no tab or app (`keepTabs`), and the stand-in plays their side, connecting as one would.
 */
import type { AgentScope } from '@alcove/api';
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { AGENT_CONNECT_PATH, agentsFor, connectionAllowed, EXPIRED_AGENT_REQUEST } from '../../src/api/agents';
import { current } from '../../src/api/state';
import { page, pages, type PageArgs, type PageStory } from '../../src/page';
import { away, holding, keepTabs, LAPTOP, LATER, SOON } from './play';

const meta = { title: 'Journeys/14 Agent access', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
export default meta;

/** The agents on the horizon. */
const line = () => screen.findByRole('list', { name: 'Your agents' }, LATER);
/** A window on the horizon, by what it says to a screen reader: "Connect Claude", or "Claude, Used 4 min ago". */
const place = async (name: string | RegExp) => within(await line()).findByRole('button', { name }, SOON);
/** The popover a window opens. */
const popover = (name: string | RegExp) => screen.findByRole('dialog', { name }, SOON);
/** A row of Settings, by its label. */
const row = (name: string) => screen.findByRole('group', { name }, LATER);
/** Copying works, or the browser says it can't: either way the page says what happened. */
const copied = (to: string) => new RegExp(`^(Copied\\. ${to}|Copy wasn’t available)`);

/** What an agent gets once it's allowed in the question (14.2): everything but sharing and deleting. */
const ALLOWED: AgentScope[] = ['notes:read', 'notes:write', 'meetings:read', 'meetings:write', 'calendar:read'];
/** The agent, outside Storybook, signs in and is allowed: a new connection comes, as it would from another tab. */
const connects = (name: string) => {
  const held = agentsFor(current());
  held.save([...held.connections, connectionAllowed(name, ALLOWED)]);
};

export const ConnectClaude: PageStory = {
  name: '14.1 Connect Claude',
  ...page('/home', 'first-day'),
  beforeEach: keepTabs,
  play: async ({ userEvent, step }) => {
    await step('Agents is a place in the side panel, after Team. Click it, from any page', async () => {
      await userEvent.click(within(await screen.findByRole('navigation', { name: 'Main' }, LATER)).getByRole('link', { name: /^Agents/ }));
    });
    await step('The agents people use stand on the horizon, dashed until they’re connected, and under it, things to ask them. Click Claude', async () => {
      await screen.findByRole('heading', { name: 'Connect your agent' }, LATER);
      await userEvent.click(await place('Connect Claude'));
    });
    await step('One line says what to do, and one button does it. Click Copy and open Claude', async () => {
      await userEvent.click(await within(await popover('Connect Claude')).findByRole('link', { name: 'Copy and open Claude' }, SOON));
    });
    await step('Claude opens in a new tab, with Alcove’s address copied to paste into its connectors. The popover waits for it', async () => {
      await within(await popover('Connect Claude')).findByText('Waiting for Claude', {}, SOON);
    });
    await step('Claude opens Alcove to ask what it can do (14.2). Once it’s allowed, this tab knows too: Claude stands on the horizon, and its popover offers a first question', async () => {
      connects('Claude');
      await within(await popover('Claude')).findByText('Claude is connected', {}, LATER);
    });
    await step('Close it. Under the horizon, What your agents did joins the water: Nothing yet, until Claude does something', async () => {
      await userEvent.keyboard('{Escape}');
      await screen.findByRole('heading', { name: 'What your agents did' }, LATER);
      await screen.findByText('Nothing yet', {}, SOON);
    });
  }
};

export const AllowLessThanItAsks: PageStory = {
  name: '14.2 Allow it, with less than it asks for',
  ...page(AGENT_CONNECT_PATH, 'first-day'),
  play: async ({ userEvent, step }) => {
    await step('Claude opens Alcove, and Agents asks: Claude and you on the horizon, and a row for each part of Alcove it asked for', async () => {
      await screen.findByRole('heading', { name: 'Claude wants to use your Alcove' }, LATER);
    });
    await step('Each row is how far it can go. Press See and book, beside Calls', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Calls: See and book' }, SOON));
    });
    await step('The levels open under it, each saying what it allows. Choose See', async () => {
      await userEvent.click(within(await screen.findByRole('listbox', { name: 'Calls' }, SOON)).getByRole('option', { name: /^See(?! and)/ }));
      await screen.findByRole('button', { name: 'Calls: See' }, SOON);
    });
    await step('Sharing and deleting are their own row, off until you turn them on', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Share or delete notes: Off' }));
      await within(await screen.findByRole('group', { name: 'Share or delete notes' }, SOON)).findByRole('switch', { name: /^Share notes/, checked: false }, SOON);
      await userEvent.keyboard('{Escape}');
    });
    await step('Allow gives Claude only what’s chosen. The line between you closes, and the browser goes back to Claude', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
      await screen.findByRole('heading', { name: 'Claude is connected' }, SOON);
      await screen.findByText('Taking you back to Claude…', {}, SOON);
    });
  }
};

export const OneButton: PageStory = {
  name: '14.3 One button: Cursor or VS Code',
  ...page('/agents', 'first-day'),
  beforeEach: keepTabs,
  play: async ({ userEvent, step }) => {
    await step('Click Cursor. One line says what happens, and one button: Add to Cursor', async () => {
      await userEvent.click(await place('Connect Cursor'));
      await userEvent.click(await within(await popover('Connect Cursor')).findByRole('link', { name: 'Add to Cursor' }, SOON));
    });
    await step('Cursor opens and asks to add Alcove. The popover waits for it', async () => {
      await within(await popover('Connect Cursor')).findByText('Waiting for Cursor', {}, SOON);
    });
    await step('Cursor opens Alcove to ask, as Claude did. Once it’s allowed, it’s connected', async () => {
      connects('Cursor');
      await within(await popover('Cursor')).findByText('Cursor is connected', {}, LATER);
    });
  }
};

export const OneLine: PageStory = {
  name: '14.4 One line: Claude Code or Codex',
  ...page('/agents', 'first-day'),
  play: async ({ userEvent, step }) => {
    await step('Click Claude Code. One line to run in your terminal, and Copy command', async () => {
      await userEvent.click(await place('Connect Claude Code'));
      await userEvent.click(await within(await popover('Connect Claude Code')).findByRole('button', { name: 'Copy command' }, SOON));
    });
    await step('Run it, then /mcp in Claude Code opens Alcove to sign in. The popover waits', async () => {
      await within(await popover('Connect Claude Code')).findByText('Waiting for Claude Code', {}, SOON);
    });
    await step('Agents asks, as it did for Claude. Once it’s allowed, it’s connected', async () => {
      connects('Claude Code');
      await within(await popover('Claude Code')).findByText('Claude Code is connected', {}, LATER);
    });
  }
};

export const ChangeWhatItCanDo: PageStory = {
  name: '14.5 Change what an agent can do',
  ...page('/agents', 'agents-connected'),
  play: async ({ userEvent, step }) => {
    await step('Click Claude on the horizon', async () => {
      await userEvent.click(await place(/^Claude, /));
    });
    await step('Its popover: when it was last used, what it can do, and until when', async () => {
      await within(await popover('Claude')).findByText(/^Until /, {}, SOON);
    });
    await step('Press Book calls to take it away. Saved: Claude can’t book calls from its next request', async () => {
      await userEvent.click(within(await popover('Claude')).getByRole('button', { name: 'Book calls', pressed: true }));
      await within(await popover('Claude')).findByText('Saved', {}, SOON);
    });
  }
};

export const DisconnectAnAgent: PageStory = {
  name: '14.6 Disconnect an agent',
  ...page('/agents', 'agents-connected'),
  play: async ({ userEvent, step }) => {
    await step('Click Claude, then Disconnect in its popover', async () => {
      await userEvent.click(await place(/^Claude, /));
      await userEvent.click(within(await popover('Claude')).getByRole('button', { name: 'Disconnect' }));
    });
    await step('It asks first, in the same popover. Keep Claude is the answer that loses nothing', async () => {
      const asked = await within(await popover('Claude')).findByRole('group', { name: 'Disconnect Claude?' }, SOON);
      await userEvent.click(within(asked).getByRole('button', { name: 'Disconnect' }));
    });
    await step('It leaves the horizon, and can’t reach Alcove any more', async () => {
      await screen.findByText('Claude is disconnected. It can’t reach Alcove any more.', {}, SOON);
      await place('Connect Claude');
    });
  }
};

export const WhatYourAgentsDid: PageStory = {
  name: '14.7 See what your agents did',
  ...page('/agents', 'agents-connected'),
  play: async ({ userEvent, step }) => {
    await step('Under the horizon, everything your agents read and changed, newest first. Only you see it', async () => {
      await screen.findByRole('heading', { name: 'What your agents did' }, LATER);
    });
    await step('Beside it, things to ask, each saying which of your agents can do it. Copy one', async () => {
      await userEvent.click(within(await holding('listitem', 'Book 45 minutes')).getByRole('button', { name: 'Copy the question' }));
      await screen.findByText(copied('Paste it into Claude\\.'), {}, SOON);
    });
    await step('Click what it was about to open it: the call Claude booked opens', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Onboarding review' }, SOON));
      await screen.findByRole('dialog', { name: /Onboarding review/ }, SOON);
    });
  }
};

export const ATokenForAScript: PageStory = {
  name: '14.8 A token for a script',
  ...page('/agents', 'agents-connected'),
  play: async ({ userEvent, step }) => {
    await step('Click Another agent: Alcove’s address, for any agent that works with MCP', async () => {
      await userEvent.click(await place('Connect another agent'));
      await within(await popover('Connect another agent')).findByRole('button', { name: 'Copy address' }, SOON);
    });
    await step('A script that can’t sign in? Click Create a token', async () => {
      await userEvent.click(within(await popover('Connect another agent')).getByRole('button', { name: /Create a token/ }));
    });
    await step('Name it, choose how long it lasts and what it can do. Reading starts chosen; take the calendar off', async () => {
      const token = await popover('Connect another agent');
      await userEvent.type(await within(token).findByRole('textbox', { name: 'Name' }, SOON), 'Morning summary');
      await userEvent.click(within(token).getByRole('button', { name: '7 days' }));
      await userEvent.click(within(token).getByRole('button', { name: 'Read calendar', pressed: true }));
    });
    await step('Create token. It shows once: copy it into your script, with Alcove’s address', async () => {
      await userEvent.click(within(await popover('Connect another agent')).getByRole('button', { name: 'Create token' }));
      await userEvent.click(await within(await popover('Connect another agent')).findByRole('button', { name: 'Copy the token' }, SOON));
    });
    await step('Done. The token is gone from the page, and the script stands on the horizon with a key', async () => {
      await userEvent.click(within(await popover('Connect another agent')).getByRole('button', { name: 'Done' }));
      await place(/^Morning summary, /);
    });
  }
};

export const KeepItLonger: PageStory = {
  name: '14.9 Keep one longer',
  ...page('/agents', 'agents-ending'),
  play: async ({ userEvent, step }) => {
    await step('Cursor’s access ends tomorrow: its line says so, in caution. Click it', async () => {
      await userEvent.click(await place(/^Cursor, Its access ends tomorrow/));
    });
    await step('Its popover offers 30 more days', async () => {
      await userEvent.click(within(await popover('Cursor')).getByRole('button', { name: 'Keep it 30 more days' }));
    });
    await step('Kept: Cursor can use Alcove for 30 days from now', async () => {
      await screen.findByText(/^Cursor can use Alcove until /, {}, SOON);
    });
  }
};

export const ARequestThatEnded: PageStory = {
  name: '14.10 A request that ended',
  ...page(`/connect?request=${EXPIRED_AGENT_REQUEST}`, 'agents-connected'),
  beforeEach: keepTabs,
  play: async ({ userEvent, step }) => {
    await step('A request that waited too long, or was answered in another tab, has ended', async () => {
      await screen.findByRole('heading', { name: 'This request ended' }, LATER);
    });
    await step('Show me how opens the way to connect it again, here Another agent’s, since the request can’t say whose it was', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Show me how' }));
      await within(await popover('Connect another agent')).findByRole('button', { name: 'Copy address' }, SOON);
    });
  }
};

export const SettingsPointsToAgents: PageStory = {
  name: '14.11 Settings points to Agents',
  ...page('/settings#connections', 'agents-connected'),
  play: async ({ userEvent, step }) => {
    await step('Settings › Connections keeps one row for agents: who’s connected, and Open Agents', async () => {
      await userEvent.click(within(await row('Agents')).getByRole('link', { name: 'Open Agents' }));
    });
    await step('It opens Agents', async () => {
      await line();
      await away('group', 'Agents');
    });
  }
};

export const OnAPhone: PageStory = {
  name: '14.12 On a phone',
  ...page('/settings#connections', 'agents-connected'),
  globals: { viewport: { value: 'phone', isRotated: false } },
  play: async ({ userEvent, step }) => {
    await step('On a phone the tab bar keeps its five. Agents opens from Settings › Connections', async () => {
      await userEvent.click(within(await row('Agents')).getByRole('link', { name: 'Open Agents' }));
    });
    await step('The line scrolls sideways under the sky, and what your agents did follows. An agent opens as a sheet', async () => {
      await userEvent.click(await place(/^Claude, /));
      await within(await popover('Claude')).findByText(/^Until /, {}, SOON);
    });
    await step('Close it. The page’s head has the way back to Settings', async () => {
      await userEvent.keyboard('{Escape}');
      await userEvent.click(await screen.findByRole('link', { name: 'Settings' }, SOON));
      await row('Agents');
    });
  }
};
