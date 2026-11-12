/*
 * SettingNote: something said inside a panel, on no hairline of its own: what just happened (back from Google, in the
 * horizon's tint), or what's in the way (`caution`). The icon says which unless `icon` says otherwise. With `onDismiss` it stays
 * until its × is pressed.
 */
import { Button, ICON_NAMES, ProviderMark, SettingFact, SettingNote, SettingRow, SettingsPanel } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';

/** Google Drive's row, with the note under it, as the panel shows it back from Google. */
const inPanel: Decorator = (Story) => (
  <div className="set-groups" style={{ maxWidth: 940, margin: '0 auto' }}>
    <SettingsPanel>
      <SettingRow label="Google Drive" mark={<ProviderMark provider="google" />} help="Connected as art@vandelay.industries."
        control={<><SettingFact>Setting up</SettingFact><Button size="sm" iconRight="up" aria-expanded onClick={did('onDone')}>Done</Button></>} />
      <Story />
    </SettingsPanel>
  </div>
);

const meta = {
  title: 'Components/Settings/SettingNote',
  component: SettingNote,
  decorators: [inPanel],
  args: { icon: 'check', children: 'Google Drive is connected. Choose a folder, and what to send to it.' },
  argTypes: { icon: { control: 'select', options: ICON_NAMES }, tone: { control: 'inline-radio', options: ['info', 'caution'] }, children: { control: 'text' }, className: { control: false } }
} satisfies Meta<typeof SettingNote>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Back from Google, connected. */
export const Connected: Story = {};
export const ConnectedNight: Story = { ...Connected, name: 'Connected, night', globals: { theme: 'dark' } };
/** Back from Google with nothing changed. */
export const Cancelled: Story = { args: { icon: undefined, children: 'Google Drive access wasn’t changed. Connect again when you’re ready.' } };
/** Back from Google, refused. */
export const Failed: Story = { args: { icon: undefined, tone: 'caution', children: 'Google Drive couldn’t be connected. Try again; your settings haven’t changed.' } };
export const FailedNight: Story = { ...Failed, name: 'Failed, night', globals: { theme: 'dark' } };
export const ConnectedPhone: Story = { ...Connected, name: 'Connected, phone', globals: { viewport: { value: 'phone' } } };
/** Said until it's dismissed: Pro renewed, at the top of Settings › Plan, with its × (`onDismiss`). */
export const Dismissable: Story = { args: { icon: 'repeat', children: 'Pro renewed from your balance, for another month.', onDismiss: did('onDismiss'), dismissLabel: 'Dismiss this notice' } };
export const DismissableNight: Story = { ...Dismissable, name: 'Dismissable, night', globals: { theme: 'dark' } };
