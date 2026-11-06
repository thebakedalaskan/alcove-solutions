/* The app's own permission copy and shared switch list, in consent and Settings. */
import { AgentPermissions } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { PERMISSIONS, READ_SCOPES } from '~/features/agents/permissions';
import { Box, did } from '../../../src/component';

const meta = {
  title: 'Components/Settings/AgentPermissions', component: AgentPermissions,
  args: { permissions: PERMISSIONS, selected: READ_SCOPES, disabled: false, onChange: did('onChange') },
  argTypes: { permissions: { control: false }, selected: { control: 'check', options: PERMISSIONS.map(permission => permission.id) }, disabled: { control: 'boolean' }, onChange: { control: false } },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <Box width={640} height="auto"><AgentPermissions {...args} onChange={(id, on) => {
      args.onChange(id, on);
      update({ selected: on ? [...args.selected.filter(selected => selected !== id), id] : args.selected.filter(selected => selected !== id) });
    }} /></Box>;
  }
} satisfies Meta<typeof AgentPermissions>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ReadPermissions: Story = {};
export const NothingSelected: Story = { args: { selected: [] } };
export const AllPermissions: Story = { args: { selected: PERMISSIONS.map(permission => permission.id) } };
/** Only the permissions the requesting client asked for appear in consent. */
export const RequestedPermissions: Story = { args: { permissions: PERMISSIONS.filter(permission => READ_SCOPES.includes(permission.id)) } };
export const Saving: Story = { args: { disabled: true } };
