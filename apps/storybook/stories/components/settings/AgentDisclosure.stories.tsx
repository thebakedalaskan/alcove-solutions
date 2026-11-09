/*
 * AgentDisclosure: what an agent receives, in one line: on the consent page, and in the foot of making a token in
 * Settings, where a SettingFoot says it.
 */
import { AgentDisclosure, Button, SettingFoot, SettingsPanel } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, did } from '../../../src/component';

const meta = { title: 'Components/Settings/AgentDisclosure', component: AgentDisclosure, render: () => <Box width={640} height="auto"><AgentDisclosure /></Box> } satisfies Meta<typeof AgentDisclosure>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ReadableInformation: Story = {};
/** In the foot of making a token. */
export const InAFoot: Story = {
  name: 'In a foot',
  render: () => (
    <div className="set-groups" style={{ maxWidth: 940, margin: '0 auto' }}>
      <SettingsPanel title="Agents"><SettingFoot actions={<><Button variant="quiet" onClick={did('onCancel')}>Cancel</Button><Button variant="primary" onClick={did('onCreate')}>Create token</Button></>}><AgentDisclosure /></SettingFoot></SettingsPanel>
    </div>
  )
};
