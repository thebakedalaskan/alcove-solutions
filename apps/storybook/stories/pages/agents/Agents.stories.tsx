/*
 * Agents: the AI assistants Art has let into Alcove, standing on the horizon as windows, and what they did on the water
 * (user-flows 14). Each window opens a popover under it: how to connect an agent people use, a connected one's
 * permissions, Another agent's address and a token. An agent asking to connect grows the sky, with the agent and Art on
 * the horizon. The other side (the agent itself) is outside Storybook: its address here is a place in this frame.
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { AGENT_ASK_PATH, CODE_AGENT_REQUEST, EXPIRED_AGENT_REQUEST, agentsFor, connectionAllowed } from '../../../src/api/agents/agents';
import { current } from '../../../src/api/state';
import { setOnline } from '../../../src/browser';
import { phone } from '../../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../../src/page';
import { SOON } from '../../journeys/play';
import { troubled } from '../changes';

const meta = { title: 'Pages/Agents/Agents', ...pages } satisfies Meta<PageArgs>;
export default meta;

type Play = NonNullable<PageStory['play']>;
/** Plays one after another. */
const then = (...plays: Play[]): Play => async (c) => { for (const p of plays) await p(c); };
/** Presses an agent's window on the horizon: its popover opens under it, or a sheet on a phone. */
const opening = (name: string | RegExp, said: string): Play => async ({ userEvent, step }) => {
  await step(said, async () => {
    await userEvent.click(await screen.findByRole('button', { name }, SOON));
  });
};
/** Presses a button in what's open. */
const pressing = (name: string | RegExp, said: string): Play => async ({ userEvent, step }) => {
  await step(said, async () => {
    await userEvent.click(await screen.findByRole('button', { name }, SOON));
  });
};
/** Presses a popover's link to another app or page, without leaving Storybook: the agent is outside it. */
const following = (name: string | RegExp, said: string): Play => async ({ userEvent, step }) => {
  await step(said, async () => {
    const link = await screen.findByRole('link', { name }, SOON);
    link.addEventListener('click', (e) => e.preventDefault(), { once: true, capture: true });
    await userEvent.click(link);
  });
};
/** Claude connects, as if Art had added Alcove in Claude and allowed it in another tab. */
const claudeConnects: Play = async ({ step }) => {
  await step('In another tab, Art adds Alcove to Claude and allows it', async () => {
    await screen.findByRole('link', { name: /^Copy and open Claude/ }, SOON);
    const held = agentsFor(current());
    held.save([...held.connections, connectionAllowed('Claude', ['notes:read', 'notes:write', 'meetings:read', 'meetings:write', 'calendar:read'])]);
  });
};

/* ---------- the page */
/** Claude, Cursor and the Weekly digest on the horizon; what they did, and things to ask. */
export const Today = page('/agents', 'agents-connected');
export const TodayPhone = phone(Today);
/**
 * Nothing connected yet: the agents people use stand dashed, and the sky's a little taller. Nothing could have been done
 * yet, so the water is only what you can ask, two across.
 */
export const FirstDay = page('/agents', 'busy');
export const FirstDayPhone = phone(FirstDay);
/** Claude just connected and not asked anything: what your agents did is one row, where the first thing it does will be. */
export const JustConnected = page('/agents', 'agents-just-connected');
export const JustConnectedPhone = phone(JustConnected);
/** Cursor's access ends tomorrow: its line says so, in caution, with a dot on its window. */
export const Ending = page('/agents', 'agents-ending');

/* ---------- connecting an agent */
/** Claude: add Alcove as a custom connector, with its address. One button copies it and opens Claude's connectors. */
export const ConnectClaude = page('/agents', 'busy', { play: opening('Connect Claude', 'Press Claude, dashed: it isn’t connected yet') });
/** Pressed, it copies the address and opens Claude in a new tab, and stays as it was, to press again: nothing waits here. */
export const CopiedAndOpened = page('/agents', 'busy', {
  play: then(opening('Connect Claude', 'Press Claude'), following(/^Copy and open Claude/, 'Press Copy and open Claude'))
});
/** Claude connected in another tab: the popover moves to it, now solid, and offers a first question. */
export const ClaudeIsConnected = page('/agents', 'busy', {
  play: then(opening('Connect Claude', 'Press Claude'), following(/^Copy and open Claude/, 'Press Copy and open Claude'), claudeConnects)
});
/** Cursor: one button opens Cursor, which asks to add Alcove. */
export const ConnectCursor = page('/agents', 'busy', { play: opening('Connect Cursor', 'Press Cursor') });
/** Claude Code: one line for the terminal, and Copy command. */
export const ConnectClaudeCode = page('/agents', 'busy', { play: opening('Connect Claude Code', 'Press Claude Code') });
/** Another agent: Alcove's address, and a way to a token for a script that can't sign in. */
export const ConnectAnotherAgent = page('/agents', 'agents-connected', { play: opening('Connect another agent', 'Press Another agent, at the end of the line') });
/** A token: its name, how long it lasts and what it can do, reading chosen. */
export const CreateAToken = page('/agents', 'agents-connected', {
  play: then(opening('Connect another agent', 'Press Another agent'), pressing(/^A script that can’t sign in\?/, 'Press Create a token'))
});
/** Made, it shows once, masked, with Alcove's address, until Done. */
export const TokenMade = page('/agents', 'agents-connected', {
  play: then(opening('Connect another agent', 'Press Another agent'), pressing(/^A script that can’t sign in\?/, 'Press Create a token'), async ({ userEvent, step }) => {
    await step('Name it and press Create token', async () => {
      await userEvent.type(await screen.findByRole('textbox', { name: 'Name' }, SOON), 'Weekly digest');
      await userEvent.click(screen.getByRole('button', { name: 'Create token' }));
    });
  })
});

/* ---------- a connected agent */
/** Claude's popover: when it was last used, what it can do, and until when. */
export const AConnectedAgent = page('/agents', 'agents-connected', { play: opening(/^Claude, Used/, 'Press Claude') });
export const AConnectedAgentPhone = phone(AConnectedAgent);
/** Taking Book calls away changes it at once, from Claude's next request, and says Saved. */
export const PermissionChanged = page('/agents', 'agents-connected', {
  play: then(opening(/^Claude, Used/, 'Press Claude'), pressing('Book calls', 'Press Book calls to take it away'))
});
/** The last thing an agent can do can't go: a toast says to disconnect it instead. */
export const TheLastPermission = page('/agents', 'agents-connected', {
  play: then(opening(/^Weekly digest, /, 'Press the Weekly digest, which can only read notes'), pressing('Read notes', 'Press Read notes'))
});
/** Disconnect asks first, in the same popover. */
export const DisconnectAsks = page('/agents', 'agents-connected', {
  play: then(opening(/^Claude, Used/, 'Press Claude'), pressing('Disconnect', 'Press Disconnect'))
});
/** Disconnected: it leaves the horizon, and what it did goes with it. */
export const Disconnected = page('/agents', 'agents-connected', {
  play: then(opening(/^Claude, Used/, 'Press Claude'), pressing('Disconnect', 'Press Disconnect'), async ({ userEvent, step }) => {
    await step('Press Disconnect again, to say yes', async () => {
      const asked = await screen.findByRole('group', { name: 'Disconnect Claude?' }, SOON);
      const yes = [...asked.querySelectorAll('button')].find((b) => b.textContent === 'Disconnect');
      if (yes) await userEvent.click(yes);
    });
  })
});
/** Cursor's access ends tomorrow: its popover offers 30 more days. */
export const EndingPopover = page('/agents', 'agents-ending', { play: opening(/^Cursor, /, 'Press Cursor') });
/** Kept for 30 more days: until 4 Dec. */
export const Kept = page('/agents', 'agents-ending', {
  play: then(opening(/^Cursor, /, 'Press Cursor'), pressing('Keep it 30 more days', 'Press Keep it 30 more days'))
});

/* ---------- an agent asking to connect */
/** Claude asks for everything: each part of Alcove at its level, sharing and deleting off. */
export const Asking = page(AGENT_ASK_PATH, 'busy');
export const AskingPhone = phone(Asking);
/** Calls' levels, each saying what it allows. */
export const LowerALevel = page(AGENT_ASK_PATH, 'busy', { play: pressing('Calls: See and book', 'Press See and book, beside Calls') });
/** Sharing and deleting are their own row, two switches, off until you turn them on. */
export const ShareOrDelete = page(AGENT_ASK_PATH, 'busy', { play: pressing('Share or delete notes: Off', 'Press Off, beside Share or delete notes') });
/** Claude Code asks for less: only the parts it asked for are there, and only up to what it asked. */
export const AsksForLess = page(`/agents?request=${CODE_AGENT_REQUEST}`, 'busy');
/** Allowed: the line closes, and the browser goes back to Claude. Here it stays, and then the page is as it was, Claude on it. */
export const Allowed = page(AGENT_ASK_PATH, 'busy', { play: pressing('Allow', 'Press Allow') });
/** Cancel tells Claude no, and the page is as it was. */
export const Cancelled = page(AGENT_ASK_PATH, 'busy', { play: pressing('Cancel', 'Press Cancel') });
/** A request that waited too long, or was answered in another tab. */
export const RequestEnded = page(`/agents?request=${EXPIRED_AGENT_REQUEST}`, 'busy');
/** Show me how opens the way to connect. */
export const ShowMeHow = page(`/agents?request=${EXPIRED_AGENT_REQUEST}`, 'busy', { play: pressing('Show me how', 'Press Show me how') });
export const ReadingTheRequest = page(AGENT_ASK_PATH, 'busy', { beforeEach: changing(troubled({ 'agents.authorization': 'hold' })) });
export const RequestDidntLoad = page(AGENT_ASK_PATH, 'busy', { beforeEach: changing(troubled({ 'agents.authorization': 'failed' })) });
/** Allow didn't go through: it says why, and asks again. */
export const AllowRefused = page(AGENT_ASK_PATH, 'busy', { beforeEach: changing(troubled({ 'agents.decide': 'failed' })), play: pressing('Allow', 'Press Allow') });

/* ---------- when something's wrong */
/** The agents are on their way: empty windows breathe on the line. */
export const Loading = page('/agents', 'agents-connected', { beforeEach: changing(troubled({ 'agents.list': 'hold', 'agents.activity': 'hold' })) });
/** They didn't load: why, and Try again. */
export const DidntLoad = page('/agents', 'agents-connected', { beforeEach: changing(troubled({ 'agents.list': 'failed', 'agents.activity': 'failed' })) });
/** What they did didn't load: the agents did, and the rest of the page works. */
export const ActivityDidntLoad = page('/agents', 'agents-connected', { beforeEach: changing(troubled({ 'agents.activity': 'failed' })) });
/** The connection went: the agents keep working, and the page catches up when it's back. */
export const WentOffline = page('/agents', 'agents-connected', {
  play: async ({ step }) => {
    await step('The connection drops', async () => {
      await screen.findByRole('heading', { name: 'Your agents' }, SOON);
      setOnline(false);
    });
  }
});
/** Opened without a connection: Agents needs one, and Record still works. */
export const Offline = page('/agents', 'offline');
