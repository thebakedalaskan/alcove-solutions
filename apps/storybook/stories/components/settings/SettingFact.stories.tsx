/*
 * SettingFact: what a control's place holds on Settings when there's nothing to change: a plain fact, or one with an
 * icon. `tone` is yes when it's in order (the icon in sun) and no when it's a problem (in caution). `title` says more on
 * hover. It stands on the axis like any control.
 */
import { ICON_NAMES, SettingFact, SettingRow } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';

/** Settings' sheet, as the page lays it out: one column of parts, every control on the same axis. */
const sheet: Decorator = (Story) => (
  <div className="set" style={{ position: 'relative', isolation: 'isolate', marginTop: 0 }}>
    <div className="set-parts" style={{ maxWidth: 820 }}><Story /></div>
  </div>
);

const meta = {
  title: 'Components/Settings/SettingFact',
  component: SettingFact,
  decorators: [sheet],
  args: { children: 'Free' },
  argTypes: {
    children: { control: 'text' },
    icon: { control: 'select', options: ICON_NAMES },
    tone: { control: 'inline-radio', options: ['none', 'yes', 'no'], mapping: { none: undefined } },
    title: { control: 'text' }
  },
  render: (args) => <SettingRow label="Calls without notes" control={<SettingFact {...args} />} />
} satisfies Meta<typeof SettingFact>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Just the fact. */
export const Plain: Story = {};
/** With an icon that says what kind of fact it is. */
export const WithAnIcon: Story = {
  name: 'With an icon',
  args: { icon: 'lock', children: 'Everyone invited, always' },
  render: (args) => <SettingRow label="Who gets them" control={<SettingFact {...args} />} />
};
/** In order: the icon in sun. */
export const Yes: Story = {
  args: { icon: 'check', tone: 'yes', children: 'Allowed' },
  render: (args) => <SettingRow label="Browser notifications" help="On this device, while Alcove is open in a tab." control={<SettingFact {...args} />} />
};
/** A problem: in caution, with the help saying what to do about it. */
export const No: Story = {
  args: { icon: 'bellOff', tone: 'no', children: 'Blocked' },
  render: (args) => <SettingRow label="Browser notifications" help="Allow notifications for this site in your browser’s settings." control={<SettingFact {...args} />} />
};
/** More on hover (`title`): when this month began counting. */
export const WithATitle: Story = {
  name: 'With a title',
  args: { title: 'Since 00:00 UTC on the 1st', children: '3 h 12 min' },
  render: (args) => <SettingRow label="Used this month" control={<SettingFact {...args} />} />
};
