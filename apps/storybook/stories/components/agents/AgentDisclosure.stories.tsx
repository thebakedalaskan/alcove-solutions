/*
 * AgentDisclosure: what an agent receives, in one line: when an agent asks to use your Alcove (`who` is its name), and at
 * the foot of making a token, whose script is your own (`maker={false}`).
 */
import { AgentDisclosure } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box } from '../../../src/component';

const meta = {
  title: 'Components/Agents/AgentDisclosure', component: AgentDisclosure,
  args: { who: 'Claude', maker: true },
  argTypes: { who: { control: 'text' }, maker: { control: 'boolean' }, className: { control: false } },
  render: (args) => <Box width={640} height="auto"><AgentDisclosure {...args} /></Box>
} satisfies Meta<typeof AgentDisclosure>;
export default meta;
type Story = StoryObj<typeof meta>;
/** When an agent asks: it gets readable information, under its maker's own policies. */
export const WhenAnAgentAsks: Story = { name: 'When an agent asks' };
/** Making a token: the script is your own, so there's no maker to name. */
export const MakingAToken: Story = { name: 'Making a token', args: { who: 'It', maker: false } };
