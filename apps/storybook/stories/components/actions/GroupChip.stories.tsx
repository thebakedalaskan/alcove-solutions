/*
 * GroupChip: one of your groups, as a fact: its name after a hash, and how many people are in it. `onRemove` adds an ×
 * to take it back out, as a group chosen in the people picker. A long name ends in an ellipsis rather than widening
 * what it's in.
 */
import { GroupChip } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';

const meta = {
  title: 'Components/Actions/GroupChip',
  component: GroupChip,
  parameters: { layout: 'centered' },
  args: { name: 'Product', count: 4 },
  argTypes: { name: { control: 'text' }, count: { control: { type: 'number', min: 0, step: 1 } }, onRemove: { control: false }, className: { control: false } }
} satisfies Meta<typeof GroupChip>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A group and how many people are in it. */
export const Group: Story = {};
/** Chosen in a picker: the × takes it back out. */
export const Removable: Story = { args: { name: 'Leads', count: 3, onRemove: did('onRemove') } };
/** A long name in a narrow place ends in an ellipsis; the whole name is in its tooltip. */
export const LongName: Story = {
  name: 'A long name',
  args: { name: 'Everyone in the London office', count: 14, onRemove: did('onRemove') },
  render: (args) => <div style={{ width: 200 }}><GroupChip {...args} /></div>
};
