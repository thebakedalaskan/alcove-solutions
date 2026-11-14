/*
 * AgentWell: a value in a quiet well. Alcove's address or a command, in mono, to select whole; with a copy icon at its
 * end when there's something to copy straight from it; something to ask an agent, in the page's own face (`words`); or a
 * token, shown once, by its first and last four characters only (`hidden`).
 */
import { AgentWell } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { PREVIEW_AGENT_TOKEN, PREVIEW_MCP_ENDPOINT } from '../../../src/api/agents/agents';
import { did } from '../../../src/component';
import { inAPopover } from './frames';

const meta = {
  title: 'Components/Agents/AgentWell',
  component: AgentWell,
  decorators: [inAPopover],
  parameters: { layout: 'centered' },
  args: { value: PREVIEW_MCP_ENDPOINT, words: false, hidden: false },
  argTypes: { onCopy: { control: false } }
} satisfies Meta<typeof AgentWell>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Alcove's address, which the button under it copies. */
export const Address: Story = {};
/** A command for the terminal, wrapping where it must. */
export const ACommand: Story = { name: 'A command', args: { value: `codex mcp add alcove --url ${PREVIEW_MCP_ENDPOINT} && codex mcp login alcove` } };
/** The address with its own copy icon, as it shows beside a new token. */
export const WithCopy: Story = { name: 'With copy', args: { copyLabel: 'Copy Alcove’s address', onCopy: did('onCopy') } };
/** A token, shown once: only its ends. */
export const AToken: Story = { name: 'A token', args: { value: PREVIEW_AGENT_TOKEN, hidden: true, copyLabel: 'Copy the token', onCopy: did('onCopy') } };
/** Something to ask a newly connected agent. */
export const AQuestion: Story = { name: 'A question', args: { value: '“What did we decide about the launch?”', words: true, copyLabel: 'Copy the question', onCopy: did('onCopy') } };
