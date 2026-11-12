/*
 * SettingTile: a connection's own mark beside its name, as a SettingRow's `mark`: a 32px tile holding an icon, as the agent
 * on Agents' row in Connections. The row's help lines up under the label, past the tile (not on a phone).
 */
import { Icon, SettingRow, SettingsPanel, SettingTile, type IconName } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';

/** A panel in Settings' column, as the page lays it out. */
const column: Decorator = (Story) => <div className="set-groups" style={{ maxWidth: 940, margin: '0 auto' }}><SettingsPanel><Story /></SettingsPanel></div>;

const TILES: IconName[] = ['agent', 'key', 'cal'];
/** Agents' way there, as Settings' row has it. */
const open = (words: string) => <a href="#agents" className="set-go" onClick={(e) => e.preventDefault()}>{words}<Icon name="right" size={14} /></a>;

const meta = {
  title: 'Components/Settings/SettingTile',
  component: SettingTile,
  decorators: [column],
  args: { icon: 'agent' },
  argTypes: { icon: { control: 'inline-radio', options: TILES } },
  render: (args) => (
    <SettingRow label="Agents" mark={<SettingTile {...args} />} help="Claude, Cursor and Weekly digest are connected." control={open('Open Agents')} />
  )
} satisfies Meta<typeof SettingTile>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Agents, in Connections: who's connected, and the way to Agents. */
export const Agents: Story = {};
export const AgentsNight: Story = { ...Agents, name: 'Agents, night', globals: { theme: 'dark' } };
export const AgentsPhone: Story = { ...Agents, name: 'Agents, phone', globals: { viewport: { value: 'phone' } } };
/** No agents yet: what they're for, and Connect an agent. */
export const NoAgentsYet: Story = {
  name: 'No agents yet',
  render: (args) => (
    <SettingRow label="Agents" mark={<SettingTile {...args} />} help="Use Alcove from your AI assistant, with only what you allow." control={open('Connect an agent')} />
  )
};
