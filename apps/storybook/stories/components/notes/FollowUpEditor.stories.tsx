import { FollowUpEditor } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { Box, did } from '../../../src/component';
import { ART, KOFI, PRIYA } from '../../../src/world/people';

const meta = {
  title: 'Components/Notes and transcript/FollowUpEditor', component: FollowUpEditor,
  args: {
    value: { text: 'Send the launch checklist', owner: KOFI.email, due: 'Friday' }, people: [ART, KOFI, PRIYA],
    onChange: did('onChange'), onSave: did('onSave'), onCancel: did('onCancel'), busy: false, saveLabel: 'Save'
  },
  argTypes: { value: { control: 'object' }, people: { control: false }, busy: { control: 'boolean' }, saveLabel: { control: 'text' } },
  render: function Editor(args) {
    const [, update] = useArgs<typeof args>();
    return <Box width={560} height="auto"><FollowUpEditor {...args} onChange={(value) => { args.onChange(value); update({ value }); }} /></Box>;
  }
} satisfies Meta<typeof FollowUpEditor>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Edit: Story = {};
export const NobodyYet: Story = { args: { value: { text: '', owner: null, due: null }, saveLabel: 'Add' } };
export const Saving: Story = { args: { busy: true } };
export const OnAPhone: Story = { globals: { viewport: { value: 'phone', isRotated: false } } };
