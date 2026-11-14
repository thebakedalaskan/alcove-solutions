/*
 * TeamRename: renaming the team, inside the popover the admin's pen opens beside its name in the sky. The name in its box,
 * why it was refused if it was, and Rename (filled) with Cancel.
 */
import { TeamRename } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { PopSurface, did } from '../../../src/component';

const meta = {
  title: 'Components/Team/TeamRename',
  component: TeamRename,
  decorators: [(Story) => <PopSurface><Story /></PopSurface>],
  parameters: { layout: 'centered' },
  args: { value: 'Vandelay Industries', onChange: did('onChange'), onSave: did('onSave'), onCancel: did('onCancel') },
  argTypes: { value: { control: 'text' }, busy: { control: 'boolean' }, error: { control: 'text' }, className: { control: false } },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <TeamRename {...args} onChange={(name) => { args.onChange(name); update({ value: name }); }} />;
  }
} satisfies Meta<typeof TeamRename>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Renaming: Story = {};
export const RenamingNight: Story = { ...Renaming, globals: { theme: 'dark' } };
/** Being saved. */
export const Saving: Story = { args: { value: 'Vandelay', busy: true } };
/** A name it won't take, in the server's words. */
export const Refused: Story = { args: { value: '', error: 'Give the team a name.' } };
