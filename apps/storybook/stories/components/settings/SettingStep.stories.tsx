/*
 * SettingStep: something opened in place inside a panel, such as connecting an agent or making a token: its `title` and
 * what it is (`help`), then what to do. A SettingFoot after it closes it. A form inside takes `set-form`, and each of its
 * controls a label over it (`Field`, or `set-field` with a span).
 */
import { AgentAddress, AgentDisclosure, AgentPermissions, Button, Field, Segmented, SettingFoot, SettingsPanel, SettingStep } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { PERMISSIONS, READ_SCOPES } from '~/features/agents/permissions';
import { PREVIEW_MCP_ENDPOINT } from '../../../src/api/agents';
import { did } from '../../../src/component';

/** The Agents panel, in Settings' column. */
const inPanel: Decorator = (Story) => <div className="set-groups" style={{ maxWidth: 940, margin: '0 auto' }}><SettingsPanel title="Agents"><Story /></SettingsPanel></div>;

/** Making a token: a name, how long it lasts, and what it can do. */
function TokenForm() {
  const [name, setName] = useState('Weekly digest script');
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const [scopes, setScopes] = useState<string[]>(READ_SCOPES);
  return (
    <>
      <SettingStep title="Create a token" help="A token lets a script use Alcove without signing in. It shows once.">
        <div className="set-form">
          <Field label="Name" value={name} maxLength={80} autoComplete="off" onChange={(e) => setName(e.target.value)} />
          <div className="set-field"><span>Expires after</span>
            <Segmented<'7' | '30' | '90'> label="Expires after" value={days} onChange={setDays} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
          </div>
          <AgentPermissions permissions={PERMISSIONS} selected={scopes} onChange={(id, on) => setScopes((s) => on ? [...s.filter((x) => x !== id), id] : s.filter((x) => x !== id))} />
        </div>
      </SettingStep>
      <SettingFoot actions={<><Button variant="quiet" onClick={did('onCancel')}>Cancel</Button><Button variant="primary" onClick={did('onCreate')}>Create token</Button></>}><AgentDisclosure /></SettingFoot>
    </>
  );
}

const meta = {
  title: 'Components/Settings/SettingStep',
  component: SettingStep,
  decorators: [inPanel],
  args: { title: 'Add Alcove to your agent', help: 'Paste this address into its connections. It opens Alcove to sign in, and you choose what it can do.' },
  argTypes: { title: { control: 'text' }, help: { control: 'text' }, children: { control: false }, className: { control: false } },
  render: (args) => (
    <>
      <SettingStep {...args}><AgentAddress address={PREVIEW_MCP_ENDPOINT} onCopy={did('onCopy')} /></SettingStep>
      <SettingFoot actions={<><Button variant="quiet" onClick={did('onToken')}>Create a token</Button><Button onClick={did('onDone')}>Done</Button></>}>For a script that can’t sign in, use a token instead.</SettingFoot>
    </>
  )
} satisfies Meta<typeof SettingStep>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Connecting an agent: the address to paste, with Copy. */
export const ConnectAnAgent: Story = { name: 'Connect an agent' };
export const ConnectAnAgentNight: Story = { ...ConnectAnAgent, name: 'Connect an agent, night', globals: { theme: 'dark' } };
/** A form opened in place. */
export const AForm: Story = { name: 'A form', render: () => <TokenForm /> };
export const AFormNight: Story = { ...AForm, name: 'A form, night', globals: { theme: 'dark' } };
export const AFormPhone: Story = { ...AForm, name: 'A form, phone', globals: { viewport: { value: 'phone' } } };
