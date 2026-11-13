/*
 * AgentPermissions: what an agent can do, chosen explicitly: a chip for each, ticked when it's allowed, with what it lets
 * the agent do when the pointer rests on it. The app's own permission copy, as Agents uses it: in a connected agent's
 * popover, where each press changes it at once and `aside` says Saved beside the heading, and in making a token, where
 * each chip says its short name.
 */
import { AgentPermissions, AgentSaved } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { CHIPS, READ_SCOPES } from '~/features/agents/permissions';
import { did } from '../../../src/component';
import { inAPopover } from './frames';

const meta = {
  title: 'Components/Agents/AgentPermissions', component: AgentPermissions,
  decorators: [inAPopover],
  parameters: { layout: 'centered' },
  args: { permissions: CHIPS, selected: READ_SCOPES, disabled: false, onChange: did('onChange') },
  argTypes: { permissions: { control: false }, selected: { control: 'check', options: CHIPS.map((permission) => permission.id) }, disabled: { control: 'boolean' }, aside: { control: false }, onChange: { control: false } },
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

/** Making a token: reading starts chosen. */
export const ReadPermissions: Story = {};
export const ReadPermissionsNight: Story = { name: 'Read permissions, night', globals: { theme: 'dark' } };
export const NothingSelected: Story = { args: { selected: [] } };
export const AllPermissions: Story = { args: { selected: CHIPS.map((permission) => permission.id) } };
/** On Agents, in Claude's popover: Saved shows beside the heading once a change is kept. */
export const OnAgents: Story = {
  name: 'On Agents, saved',
  args: { selected: ['notes:read', 'notes:write', 'meetings:read', 'calendar:read'], aside: <AgentSaved saved /> }
};
export const OnAgentsNight: Story = { ...OnAgents, name: 'On Agents, saved, night', globals: { theme: 'dark' } };
export const Saving: Story = { args: { disabled: true } };
export const ReadPermissionsPhone: Story = { name: 'Read permissions, phone', globals: { viewport: { value: 'phone' } } };
