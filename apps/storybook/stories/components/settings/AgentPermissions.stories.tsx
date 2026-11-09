/*
 * AgentPermissions: what an agent can do, chosen explicitly: a chip for each, ticked when it's allowed, with what it lets
 * the agent do when the pointer rests on it. The app's own permission copy, on the consent page and in Settings, where
 * it sits in the form for a token, under What it can do. On the consent page (`details`) what each one lets the agent do
 * is said in full under the chips.
 */
import { AgentConsentFrame, AgentPermissions, SettingsPanel, SettingStep } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { PERMISSIONS, READ_SCOPES } from '~/features/agents/permissions';
import { did } from '../../../src/component';

/** The token form's place for it, in the Agents panel; or, for consent (`parameters.consent`), the consent page's sheet. */
const inPanel: Decorator = (Story, ctx) => (ctx.parameters['consent'] === true ? <AgentConsentFrame title="Connect your agent"><Story /></AgentConsentFrame> : (
  <div className="set-groups" style={{ maxWidth: 940, margin: '0 auto' }}>
    <SettingsPanel title="Agents"><SettingStep title="Create a token" help="A token lets a script use Alcove without signing in. It shows once."><div className="set-form"><Story /></div></SettingStep></SettingsPanel>
  </div>
));

const meta = {
  title: 'Components/Settings/AgentPermissions', component: AgentPermissions,
  decorators: [inPanel],
  args: { permissions: PERMISSIONS, selected: READ_SCOPES, disabled: false, details: false, onChange: did('onChange') },
  argTypes: { permissions: { control: false }, selected: { control: 'check', options: PERMISSIONS.map((permission) => permission.id) }, disabled: { control: 'boolean' }, details: { control: 'boolean' }, onChange: { control: false } },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <AgentPermissions {...args} onChange={(id, on) => {
      args.onChange(id, on);
      update({ selected: on ? [...args.selected.filter((selected) => selected !== id), id] : args.selected.filter((selected) => selected !== id) });
    }} />;
  }
} satisfies Meta<typeof AgentPermissions>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ReadPermissions: Story = {};
export const ReadPermissionsNight: Story = { name: 'Read permissions, night', globals: { theme: 'dark' } };
export const NothingSelected: Story = { args: { selected: [] } };
export const AllPermissions: Story = { args: { selected: PERMISSIONS.map((permission) => permission.id) } };
/** Only the permissions the requesting client asked for appear in consent, each said in full under the chips; one unticked steps back. */
export const RequestedPermissions: Story = {
  args: { permissions: PERMISSIONS.filter((permission) => READ_SCOPES.includes(permission.id)), selected: ['notes:read', 'meetings:read'], details: true },
  parameters: { consent: true, layout: 'fullscreen' }
};
export const RequestedPermissionsNight: Story = { ...RequestedPermissions, name: 'Requested permissions, night', globals: { theme: 'dark' } };
export const Saving: Story = { args: { disabled: true } };
export const ReadPermissionsPhone: Story = { name: 'Read permissions, phone', globals: { viewport: { value: 'phone' } } };
