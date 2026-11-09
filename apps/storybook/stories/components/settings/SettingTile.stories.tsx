/*
 * SettingTile: a connection's own mark beside its name, as a SettingRow's `mark`: a 32px tile holding an icon, an agent's
 * or a token's. The row's help lines up under the label, past the tile (not on a phone).
 */
import { Button, SettingFact, SettingRow, SettingsPanel, SettingTile, type IconName } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';

/** A panel in Settings' column, as the page lays it out. */
const column: Decorator = (Story) => <div className="set-groups" style={{ maxWidth: 940, margin: '0 auto' }}><SettingsPanel title="Agents"><Story /></SettingsPanel></div>;

const TILES: IconName[] = ['agent', 'key', 'cal'];

const meta = {
  title: 'Components/Settings/SettingTile',
  component: SettingTile,
  decorators: [column],
  args: { icon: 'agent' },
  argTypes: { icon: { control: 'inline-radio', options: TILES } },
  render: (args) => (
    <SettingRow label="Workspace assistant" mark={<SettingTile {...args} />} help="Read notes · Read calls · Read calendar · Signed in with Alcove"
      control={<><SettingFact>Used today</SettingFact><Button variant="quiet" size="sm" onClick={did('onDisconnect')}>Disconnect</Button></>} />
  )
} satisfies Meta<typeof SettingTile>;
export default meta;
type Story = StoryObj<typeof meta>;

/** An agent that signed in with Alcove. */
export const Agent: Story = {};
/** A script with a token. */
export const Token: Story = {
  args: { icon: 'key' },
  render: (args) => (
    <SettingRow label="Weekly digest script" mark={<SettingTile {...args} />} help="Read notes · Token"
      control={<><SettingFact>Expires 2 Dec</SettingFact><Button variant="quiet" size="sm" onClick={did('onDisconnect')}>Disconnect</Button></>} />
  )
};
/** One after another, as the Agents panel lists them. */
export const Connections: Story = {
  render: () => (
    <>
      <SettingRow label="Workspace assistant" mark={<SettingTile icon="agent" />} help="Read notes · Read calls · Read calendar · Signed in with Alcove"
        control={<><SettingFact>Used today</SettingFact><Button variant="quiet" size="sm" onClick={did('onDisconnect')}>Disconnect</Button></>} />
      <SettingRow label="Weekly digest script" mark={<SettingTile icon="key" />} help="Read notes · Token"
        control={<><SettingFact>Expires 2 Dec</SettingFact><Button variant="quiet" size="sm" onClick={did('onDisconnect')}>Disconnect</Button></>} />
    </>
  )
};
export const ConnectionsNight: Story = { ...Connections, name: 'Connections, night', globals: { theme: 'dark' } };
export const ConnectionsPhone: Story = { ...Connections, name: 'Connections, phone', globals: { viewport: { value: 'phone' } } };
