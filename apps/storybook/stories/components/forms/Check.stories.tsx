/*
 * Check: a follow-up's tick box. Pressing it marks the follow-up done, and the sun fills it as the tick draws; pressing
 * again takes it back. Its `label` says what it does to which follow-up. `disabled` when this reader can't change it:
 * a follow-up someone else has taken on, in a call they didn't organize.
 */
import { Check } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did } from '../../../src/component';

const meta = {
  title: 'Components/Forms/Check',
  component: Check,
  parameters: { layout: 'centered' },
  args: { checked: false, label: 'Mark done: Review the launch checklist', disabled: false, onChange: did('onChange') },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <Check {...args} onChange={(checked) => { args.onChange(checked); update({ checked }); }} />;
  }
} satisfies Meta<typeof Check>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Not done yet. Press it. */
export const Off: Story = {};
/** Done. Press it to take it back. */
export const On: Story = { args: { checked: true } };
/** Someone else took it on, in a call you didn't organize: it shows that it's done, and can't be changed. */
export const Disabled: Story = { args: { checked: true, disabled: true, label: 'Mark done: Add the flag to the rollout plan' } };
