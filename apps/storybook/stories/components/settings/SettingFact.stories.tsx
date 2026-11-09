/*
 * SettingFact: what a control's place holds on Settings when there's nothing to change: a plain fact, or one with an
 * icon. `tone` is yes when it's in order (the icon in sun) and no when it's a problem (in caution). `title` says more on
 * hover. It stands at the panel's right edge like any control.
 */
import { ICON_NAMES, SettingFact, SettingRow, SettingsPanel } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';

/** A panel in Settings' column, as the page lays it out. */
const sheet: Decorator = (Story) => <div className="set-groups" style={{ maxWidth: 940, margin: '0 auto' }}><SettingsPanel><Story /></SettingsPanel></div>;

const meta = {
  title: 'Components/Settings/SettingFact',
  component: SettingFact,
  decorators: [sheet],
  args: { children: 'Same as system' },
  argTypes: {
    children: { control: 'text' },
    icon: { control: 'select', options: ICON_NAMES },
    tone: { control: 'inline-radio', options: ['none', 'yes', 'no'], mapping: { none: undefined } },
    title: { control: 'text' }
  },
  render: (args) => <SettingRow label="Speaker" control={<SettingFact {...args} />} />
} satisfies Meta<typeof SettingFact>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Just the fact. */
export const Plain: Story = {};
/** With an icon that says what kind of fact it is. */
export const WithAnIcon: Story = {
  name: 'With an icon',
  args: { icon: 'lock', children: 'Single sign-on' },
  render: (args) => <SettingRow label="Name and photo" help="From your company’s sign-in." control={<SettingFact {...args} />} />
};
/** In order: the icon in sun. */
export const Yes: Story = {
  args: { icon: 'sealed', tone: 'yes', children: 'Hardware verified 16:04' },
  render: (args) => <SettingRow label="Confidential compute" help="Where your audio is opened and your notes are written." control={<SettingFact {...args} />} />
};
/** A problem: in caution, with the help saying what to do about it. */
export const No: Story = {
  args: { icon: 'bellOff', tone: 'no', children: 'Blocked' },
  render: (args) => <SettingRow label="Browser notifications" problem help="Blocked in this browser. Allow them for this site in its site settings." control={<SettingFact {...args} />} />
};
/** More on hover (`title`): when this month began counting. */
export const WithATitle: Story = {
  name: 'With a title',
  args: { title: 'Since 00:00 UTC on the 1st', children: '3 h 34 min' },
  render: (args) => <SettingRow label="Used this month" control={<SettingFact {...args} />} />
};
export const YesNight: Story = { ...Yes, name: 'Yes, night', globals: { theme: 'dark' } };
export const NoNight: Story = { ...No, name: 'No, night', globals: { theme: 'dark' } };
