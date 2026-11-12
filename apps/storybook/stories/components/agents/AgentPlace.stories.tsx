/*
 * AgentPlace: a place on the line. The agent's window is the button, with its name and a quiet line under it on the
 * water; it opens a popover under the window, with a caret, that slides to stay in the window and is a sheet on a phone.
 * What the popover holds is built from the kit's parts: AgentPopHead (its mark, what it's about, Close, and a way back
 * when there is one), AgentPopLine, AgentWell, one full-width action (AgentAction, or AgentLink to another app or page)
 * that waits in its place once pressed (AgentWaiting), AgentPopMore at the foot, AgentPermissions with AgentSaved,
 * AgentPopFoot, and AgentAsked for a question asked in place.
 */
import { AgentAction, AgentAsked, AgentLink, AgentPermissions, AgentPlace, AgentPopFoot, AgentPopHead, AgentPopLine, AgentPopMore, AgentSaved, AgentWaiting, AgentWell, AgentLine, Button } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CHIPS } from '~/features/agents/permissions';
import { PREVIEW_AGENT_TOKEN, PREVIEW_MCP_ENDPOINT } from '../../../src/api/agents';
import { did } from '../../../src/component';
import { OnTheHorizon } from './frames';

const CLAUDE = { place: 'claude', icon: 'sparkle', name: 'Claude', line: '4 min ago', label: 'Claude, Used 4 min ago', popLabel: 'Claude' } as const;
const meta = {
  title: 'Components/Agents/AgentPlace',
  component: AgentPlace,
  parameters: { layout: 'fullscreen' },
  args: { ...CLAUDE, open: true, onOpenChange: did('onOpenChange'), children: null },
  argTypes: { look: { control: 'inline-radio', options: ['solid', 'dashed', 'asking', 'allowed'] }, children: { control: false }, onOpenChange: { control: false } },
  render: (args) => <OnTheHorizon hz={200} below={420} places={1}><AgentLine label="Your agents"><AgentPlace {...args} /></AgentLine></OnTheHorizon>
} satisfies Meta<typeof AgentPlace>;
export default meta;
type Story = StoryObj<typeof meta>;

const GIVEN = ['notes:read', 'notes:write', 'meetings:read', 'meetings:write', 'calendar:read'];

/** Closed: the window, its name, and when it was last used. */
export const Closed: Story = { args: { open: false } };
/** Claude's popover: when it was last used, what it can do, and until when. */
export const Connected: Story = {
  args: {
    children: (
      <>
        <AgentPopHead icon="sparkle" title="Claude" sub="Used 4 min ago" />
        <AgentPermissions permissions={CHIPS} selected={GIVEN} onChange={did('onChange')} aside={<AgentSaved saved={false} />} />
        <AgentPopFoot aside="Until 20 Nov"><Button variant="quiet" size="sm" icon="unplug" onClick={did('onDisconnect')}>Disconnect</Button></AgentPopFoot>
      </>
    )
  }
};
/** A change kept: Saved, beside what it can do. */
export const Saved: Story = {
  args: {
    children: (
      <>
        <AgentPopHead icon="sparkle" title="Claude" sub="Used 4 min ago" />
        <AgentPermissions permissions={CHIPS} selected={GIVEN.filter((s) => s !== 'meetings:write')} onChange={did('onChange')} aside={<AgentSaved saved />} />
        <AgentPopFoot aside="Until 20 Nov"><Button variant="quiet" size="sm" icon="unplug" onClick={did('onDisconnect')}>Disconnect</Button></AgentPopFoot>
      </>
    )
  }
};
/** Its access ends tomorrow: said in caution, with 30 more days. */
export const Ending: Story = {
  args: {
    icon: 'pointer', name: 'Cursor', line: 'Ends tomorrow', caution: true, label: 'Cursor, Its access ends tomorrow', popLabel: 'Cursor',
    children: (
      <>
        <AgentPopHead icon="pointer" title="Cursor" sub="Its access ends tomorrow" caution />
        <AgentAction variant="secondary" onClick={did('onKeep')}>Keep it 30 more days</AgentAction>
        <AgentPermissions permissions={CHIPS} selected={['notes:read', 'meetings:read']} onChange={did('onChange')} aside={<AgentSaved saved={false} />} />
        <AgentPopFoot><Button variant="quiet" size="sm" icon="unplug" onClick={did('onDisconnect')}>Disconnect</Button></AgentPopFoot>
      </>
    )
  }
};
/** Disconnect asks first, in place: keeping it is the filled answer. */
export const AskingToDisconnect: Story = {
  name: 'Asking to disconnect',
  args: {
    children: (
      <>
        <AgentPopHead icon="sparkle" title="Claude" sub="Used 4 min ago" />
        <AgentAsked title="Disconnect Claude?" actions={<><Button variant="primary" size="sm" onClick={did('onKeep')}>Keep Claude</Button><Button size="sm" onClick={did('onDisconnect')}>Disconnect</Button></>}>
          It stops working at once. To use it again, connect it again.
        </AgentAsked>
      </>
    )
  }
};
/** Not connected yet: one line of what to do, the address, and one button that copies it and opens Claude. */
export const Connect: Story = {
  args: {
    look: 'dashed', line: undefined, label: 'Connect Claude', popLabel: 'Connect Claude',
    children: (
      <>
        <AgentPopHead icon="sparkle" title="Connect Claude" />
        <AgentPopLine>Paste this address into Claude’s connectors.</AgentPopLine>
        <AgentWell value={PREVIEW_MCP_ENDPOINT} />
        <AgentLink href="#claude-connectors" onClick={did('onCopyAndOpen')}>Copy and open Claude</AgentLink>
      </>
    )
  }
};
/** Pressed, it waits for Claude in the button's place. */
export const Waiting: Story = {
  args: {
    look: 'dashed', line: undefined, label: 'Connect Claude', popLabel: 'Connect Claude',
    children: (
      <>
        <AgentPopHead icon="sparkle" title="Connect Claude" />
        <AgentPopLine>Paste this address into Claude’s connectors.</AgentPopLine>
        <AgentWell value={PREVIEW_MCP_ENDPOINT} />
        <AgentWaiting>Waiting for Claude</AgentWaiting>
      </>
    )
  }
};
/** One line for the terminal, and Copy command. */
export const ACommand: Story = {
  name: 'A command',
  args: {
    icon: 'squareTerminal', name: 'Claude Code', look: 'dashed', line: undefined, label: 'Connect Claude Code', popLabel: 'Connect Claude Code',
    children: (
      <>
        <AgentPopHead icon="squareTerminal" title="Connect Claude Code" />
        <AgentPopLine>Run this in your terminal, then /mcp in Claude Code to sign in.</AgentPopLine>
        <AgentWell value={`claude mcp add --transport http alcove ${PREVIEW_MCP_ENDPOINT}`} />
        <AgentAction onClick={did('onCopy')}>Copy command</AgentAction>
      </>
    )
  }
};
/** Another agent: the address, and at the foot the way to a token for a script. */
export const AnotherAgent: Story = {
  name: 'Another agent',
  args: {
    icon: 'plug', name: 'Another agent', look: 'dashed', line: undefined, label: 'Connect another agent', popLabel: 'Connect another agent',
    children: (
      <>
        <AgentPopHead icon="plug" title="Connect another agent" />
        <AgentPopLine>Any agent that works with MCP connects with this address.</AgentPopLine>
        <AgentWell value={PREVIEW_MCP_ENDPOINT} />
        <AgentAction onClick={did('onCopy')}>Copy address</AgentAction>
        <AgentPopMore ask="A script that can’t sign in?" go="Create a token" onClick={did('onToken')} />
      </>
    )
  }
};
/** A token, made: shown once, masked, with Alcove's address, until Done. */
export const TokenMade: Story = {
  name: 'Token made',
  args: {
    icon: 'plug', name: 'Another agent', look: 'dashed', line: undefined, label: 'Connect another agent', popLabel: 'Connect another agent',
    children: (
      <>
        <AgentPopHead icon="key" title="Weekly digest" sub="Until 4 Dec" />
        <AgentPopLine>Copy it into your script now, with Alcove’s address. It won’t show again.</AgentPopLine>
        <AgentWell value={PREVIEW_AGENT_TOKEN} hidden copyLabel="Copy the token" onCopy={did('onCopyToken')} />
        <AgentWell value={PREVIEW_MCP_ENDPOINT} copyLabel="Copy Alcove’s address" onCopy={did('onCopyAddress')} />
        <AgentAction onClick={did('onDone')}>Done</AgentAction>
      </>
    )
  }
};
/** Just connected, while its popover waited: a tick, and something to ask it first. */
export const JustConnected: Story = {
  name: 'Just connected',
  args: {
    tick: true, line: 'Just connected',
    children: (
      <>
        <AgentPopHead icon="sparkle" title="Claude is connected" tick />
        <AgentPopLine>Ask it something in Claude, like:</AgentPopLine>
        <AgentWell words value="“What did we decide about the launch?”" copyLabel="Copy the question" onCopy={did('onCopy')} />
      </>
    )
  }
};
export const ConnectedPhone: Story = { ...Connected, name: 'Connected, phone', globals: { viewport: { value: 'phone', isRotated: false } } };
