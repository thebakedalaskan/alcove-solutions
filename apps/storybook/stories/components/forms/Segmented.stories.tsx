/*
 * Segmented: a choice of two to four modes, for a setting. The chosen one sits on a surface pill that slides to the one
 * pressed. Options can lead with an icon. `disabled` greys the whole choice out, as Settings does while what it belongs
 * to is off. Use Tabs for views of the same thing.
 */
import { Segmented } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did } from '../../../src/component';

const meta = {
  title: 'Components/Forms/Segmented',
  component: Segmented,
  parameters: { layout: 'centered' },
  args: {
    label: 'Notes for new calls', value: 'on', disabled: false, onChange: did('onChange'),
    options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]
  },
  argTypes: { options: { control: 'object' } },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <Segmented {...args} onChange={(value) => { args.onChange(value); update({ value }); }} />;
  }
} satisfies Meta<typeof Segmented>;
export default meta;
type Story = StoryObj<typeof meta>;

export const TwoOptions: Story = { name: 'Two options' };
export const ThreeOptions: Story = {
  name: 'Three options',
  args: { label: 'People', value: 'tiles', options: [{ value: 'tiles', label: 'Tiles' }, { value: 'arches', label: 'Arches' }, { value: 'hidden', label: 'Hidden' }] }
};
/** A call's length: a call of 15 minutes gets its own length beside the usual three. */
export const FourOptions: Story = {
  name: 'Four options',
  args: {
    label: 'How long', value: '15',
    options: [{ value: '15', label: '15 min' }, { value: '30', label: '30 min' }, { value: '45', label: '45 min' }, { value: '60', label: '1 h' }]
  }
};
export const WithIcons: Story = {
  name: 'With icons',
  args: {
    label: 'Layout', value: 'speaker',
    options: [{ value: 'side', label: 'Side by side', icon: 'layout' }, { value: 'speaker', label: 'Speaker', icon: 'people' }, { value: 'grid', label: 'Grid', icon: 'grid' }]
  }
};
/** While this browser doesn't allow notifications, the reminder keeps its choice and can't be changed. */
export const Disabled: Story = {
  args: { label: 'Remind me before a call', value: '5', disabled: true, options: [{ value: '1', label: '1 min' }, { value: '5', label: '5 min' }, { value: 'off', label: 'Off' }] }
};
/** One choice that can't be made now: a board in each room needs the call's workspace, which it hasn't got yet. */
export const OneDisabled: Story = {
  name: 'One choice disabled',
  args: { label: 'Board', value: 'none', options: [{ value: 'none', label: 'None' }, { value: 'each', label: 'In each room', disabled: true }, { value: 'shared', label: 'Shared' }] }
};
