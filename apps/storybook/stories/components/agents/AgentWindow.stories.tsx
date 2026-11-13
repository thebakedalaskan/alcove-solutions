/*
 * AgentWindow: an agent, as a window, a square with a rounded top, as people are arches. Its mark is a plain icon for its
 * kind, never its maker's logo. Solid once it's connected, dashed until then, outlined in rose while it asks to connect
 * (a decision waiting on you), and ringed just after you've allowed it. A caution dot says its access is ending; a tick,
 * that it's just connected. Small, it's the mark at the head of its popover.
 */
import { AgentWindow, ICON_NAMES } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { onTheHorizon } from './frames';

const meta = {
  title: 'Components/Agents/AgentWindow',
  component: AgentWindow,
  decorators: [onTheHorizon],
  parameters: { layout: 'fullscreen' },
  args: { icon: 'sparkle', look: 'solid', dot: false, tick: false, small: false },
  argTypes: {
    icon: { control: 'select', options: ICON_NAMES },
    look: { control: 'inline-radio', options: ['solid', 'dashed', 'asking', 'allowed'] },
    className: { control: false }
  },
  render: (args) => <div style={{ width: 110, margin: '0 auto' }}><AgentWindow {...args} /></div>
} satisfies Meta<typeof AgentWindow>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Claude, connected. */
export const Connected: Story = {};
/** ChatGPT, not connected yet. */
export const NotConnectedYet: Story = { name: 'Not connected yet', args: { icon: 'thread', look: 'dashed' } };
/** Asking to connect: outlined in rose. */
export const Asking: Story = { args: { look: 'asking' } };
/** Just allowed, ringed. */
export const Allowed: Story = { args: { look: 'allowed' } };
/** Cursor's access ends tomorrow: a caution dot. */
export const Ending: Story = { args: { icon: 'pointer', dot: true } };
/** Just connected, with a tick. */
export const JustConnected: Story = { name: 'Just connected', args: { tick: true } };
/** The mark at the head of its popover, with the tick it has once it's connected. */
export const Small: Story = { args: { small: true, tick: true } };
/** Every kind people use, then other agents, tokens and Another agent. */
export const EveryKind: Story = {
  name: 'Every kind',
  render: (args) => (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 14 }}>
      {(['sparkle', 'thread', 'pointer', 'code', 'squareTerminal', 'terminal', 'agent', 'key'] as const).map((icon) => (
        <div key={icon} style={{ width: 64 }}><AgentWindow {...args} icon={icon} /></div>
      ))}
      <div style={{ width: 64 }}><AgentWindow {...args} icon="plug" look="dashed" /></div>
    </div>
  )
};
