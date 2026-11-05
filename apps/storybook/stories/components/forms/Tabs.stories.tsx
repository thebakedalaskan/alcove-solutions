/*
 * Tabs: views of the same thing, such as which notes the list shows. The selected tab is in ink with a sun underline,
 * on a line that runs under them all. Use Segmented for a setting.
 */
import { Tabs } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { Box, did } from '../../../src/component';

const meta = {
  title: 'Components/Forms/Tabs',
  component: Tabs,
  args: {
    label: 'Show', value: 'all', onChange: did('onChange'),
    options: [{ value: 'all', label: 'All' }, { value: 'call', label: 'Calls' }, { value: 'room', label: 'In the room' }, { value: 'shared', label: 'Shared with you' }]
  },
  argTypes: { options: { control: 'object' } },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <Box width="min(560px, 100%)" height="auto"><Tabs {...args} onChange={(value) => { args.onChange(value); update({ value }); }} /></Box>;
  }
} satisfies Meta<typeof Tabs>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Which notes the list shows. Press a tab. */
export const Default: Story = {};
