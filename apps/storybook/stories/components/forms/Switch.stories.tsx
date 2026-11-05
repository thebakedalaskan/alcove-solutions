/*
 * Switch: on or off, for something that takes effect as it's pressed. The sun fills it when it's on. Its `label` names
 * what it switches for screen readers; the words beside it are the page's (SwitchLine, SettingRow).
 */
import { Switch } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did } from '../../../src/component';

const meta = {
  title: 'Components/Forms/Switch',
  component: Switch,
  parameters: { layout: 'centered' },
  args: { checked: true, label: 'Write notes', disabled: false, onChange: did('onChange') },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <Switch {...args} onChange={(checked) => { args.onChange(checked); update({ checked }); }} />;
  }
} satisfies Meta<typeof Switch>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Press it to switch it off. */
export const On: Story = {};
export const Off: Story = { args: { checked: false } };
/** While this browser doesn't allow notifications, each kind keeps its setting and can't be switched. */
export const Disabled: Story = { args: { label: 'When notes are ready', disabled: true } };
