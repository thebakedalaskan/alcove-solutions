/*
 * AgentAddress: Alcove's address for agents (MCP), whole, in a box with Copy: what someone pastes into their agent's
 * connections. In Settings it shows when Connect an agent opens in place, in the Agents panel.
 */
import { AgentAddress, Button, SettingFact, SettingFoot, SettingRow, SettingsPanel, SettingStep, SettingTile } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { PREVIEW_MCP_ENDPOINT } from '../../../src/api/agents';
import { did } from '../../../src/component';

/** The Agents panel, with a connection above, and Connect an agent opened in place. */
const inPanel: Decorator = (Story) => (
  <div className="set-groups" style={{ maxWidth: 940, margin: '0 auto' }}>
    <SettingsPanel title="Agents">
      <SettingRow label="Workspace assistant" mark={<SettingTile icon="agent" />} help="Read notes · Read calls · Read calendar · Signed in with Alcove"
        control={<><SettingFact>Used today</SettingFact><Button variant="quiet" size="sm" onClick={did('onDisconnect')}>Disconnect</Button></>} />
      <SettingStep title="Add Alcove to your agent" help="Paste this address into its connections. It opens Alcove to sign in, and you choose what it can do."><Story /></SettingStep>
      <SettingFoot actions={<><Button variant="quiet" onClick={did('onToken')}>Create a token</Button><Button onClick={did('onDone')}>Done</Button></>}>For a script that can’t sign in, use a token instead.</SettingFoot>
    </SettingsPanel>
  </div>
);

const meta = {
  title: 'Components/Settings/AgentAddress', component: AgentAddress,
  decorators: [inPanel],
  args: { address: PREVIEW_MCP_ENDPOINT, onCopy: did('onCopy') },
  argTypes: { address: { control: 'text' }, onCopy: { control: false } }
} satisfies Meta<typeof AgentAddress>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Address: Story = {};
export const AddressNight: Story = { name: 'Address, night', globals: { theme: 'dark' } };
export const AddressPhone: Story = { name: 'Address, phone', globals: { viewport: { value: 'phone' } } };
/** A long address runs out under Copy rather than pushing it off. */
export const LongAddress: Story = { name: 'A long address', args: { address: 'https://alcove.vandelay-industries.example/api/agents/mcp/connections/workspace' } };
