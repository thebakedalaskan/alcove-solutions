import { AgentTokenReveal } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { PREVIEW_AGENT_TOKEN, PREVIEW_MCP_ENDPOINT } from '../../../src/api/agents';
import { Box, did } from '../../../src/component';

const meta = {
  title: 'Components/Settings/AgentTokenReveal', component: AgentTokenReveal,
  args: { token: PREVIEW_AGENT_TOKEN, endpoint: PREVIEW_MCP_ENDPOINT, onCopy: did('onCopy'), onDone: did('onDone') },
  argTypes: { token: { control: 'text' }, endpoint: { control: 'text' }, problem: { control: 'text' }, onCopy: { control: false }, onDone: { control: false } },
  render: args => <Box width={640} height="auto"><AgentTokenReveal {...args} /></Box>
} satisfies Meta<typeof AgentTokenReveal>;
export default meta;
type Story = StoryObj<typeof meta>;
/** A deliberately invalid preview token, hidden as the real one is. */
export const IssuedOnce: Story = {};
export const CopyUnavailable: Story = { args: { problem: 'Copy wasn’t available. Select the token and copy it, or try again.' } };
