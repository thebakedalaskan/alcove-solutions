/*
 * AgentPair: the agent and you, together on the horizon in place of the line, while it asks to use your Alcove: its window
 * and your arch, joined by a line with a mark in the middle. While it asks, the line is dashed rose with a plug (a
 * decision waiting on you) and its window is outlined in rose; allowed, the line closes, solid, with a tick; a request
 * that ended leaves it dashed and grey, with an hourglass.
 */
import { AgentPair } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ART } from '../../../src/world/people';
import { onTheHorizon } from './frames';

const meta = {
  title: 'Components/Agents/AgentPair',
  component: AgentPair,
  decorators: [onTheHorizon],
  parameters: { layout: 'fullscreen' },
  args: { icon: 'sparkle', name: 'Claude', line: 'Asking', me: ART, email: ART.email, state: 'asking' },
  argTypes: { state: { control: 'inline-radio', options: ['asking', 'joined', 'ended'] }, me: { control: false } },
  render: (args) => <div className="ag-row is-pair"><AgentPair {...args} /></div>
} satisfies Meta<typeof AgentPair>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Claude asks to connect. */
export const Asking: Story = {};
/** Allowed: the line closes. */
export const Joined: Story = { args: { line: 'Just connected', state: 'joined' } };
/** The request ended, from an agent that didn't say who it is. */
export const Ended: Story = { args: { icon: 'agent', name: 'Your agent', line: 'Not connected', state: 'ended' } };
export const AskingPhone: Story = { ...Asking, name: 'Asking, phone', globals: { viewport: { value: 'phone', isRotated: false } } };
