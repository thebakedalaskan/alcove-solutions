/*
 * SettingsGroup: one of Settings' seven groups: its heading (20px, Hanken Grotesk), what it's limited to when that isn't
 * the whole account (`tag`: a laptop and This browser), then one or two panels. `id` is where the index and the address
 * jump to. Groups follow one another 64px apart (48px on a phone).
 */
import { Icon, ProviderMark, Select, SettingFact, SettingRow, SettingsGroup, SettingsPanel, Switch, ThemePreview, type SelectOption, type ThemeChoice } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { did } from '../../../src/component';

/** Settings' column, as the page lays it out. */
const column: Decorator = (Story) => <div className="set-groups" style={{ maxWidth: 940, margin: '0 auto' }}><Story /></div>;

const browserOnly = <><Icon name="laptop" />This browser</>;
const THEMES: readonly ThemeChoice[] = ['system', 'light', 'dark'];
const MICS: SelectOption<string>[] = [{ value: 'default', label: 'Same as system (MacBook Pro Microphone)' }, { value: 'usb', label: 'Studio USB Microphone' }];

/** You: who you are, then how Alcove looks in this browser. */
function You() {
  const [theme, setTheme] = useState<ThemeChoice>('system');
  return (
    <>
      <SettingsPanel>
        <SettingRow label="Name and photo" help="From your Google sign-in."
          control={<a href="#account" className="set-go is-ext" onClick={(e) => { e.preventDefault(); did('onAccount')(); }}><ProviderMark provider="google" />Google account<Icon name="external" size={14} /></a>} />
        <SettingRow label="Company" control={<a href="#team" className="set-go" onClick={(e) => e.preventDefault()}><span className="ac-clamp-1">Vandelay Industries</span><Icon name="right" size={14} /></a>} />
        <SettingRow label="Time zone" help="From this computer." control={<SettingFact icon="globe">London · GMT</SettingFact>} />
      </SettingsPanel>
      <SettingsPanel title="Appearance" tag={browserOnly}>
        <SettingRow wide label="Theme"
          control={<div className="set-eves" role="group" aria-label="Appearance">{THEMES.map((t) => <ThemePreview key={t} theme={t} pressed={theme === t} onClick={() => setTheme(t)} />)}</div>} />
      </SettingsPanel>
    </>
  );
}

/** Audio and video: the whole group is this browser's. */
function AudioAndVideo() {
  const [mic, setMic] = useState('default');
  const [noise, setNoise] = useState(true);
  return (
    <SettingsPanel>
      <SettingRow stack label="Microphone"
        control={<><Select label="Microphone" value={mic} options={MICS} onChange={setMic} /><div className="set-lvl"><button type="button" className="set-test" onClick={did('onCheck')}><span className="set-bars" aria-hidden="true"><i /><i /><i /><i /></span>Check the level</button></div></>} />
      <SettingRow label="Reduce background noise" onLabel={() => setNoise(!noise)} control={<Switch label="Reduce background noise" checked={noise} onChange={setNoise} />} />
    </SettingsPanel>
  );
}

const meta = {
  title: 'Components/Settings/SettingsGroup',
  component: SettingsGroup,
  decorators: [column],
  args: { id: 'you', title: 'You', children: <You /> },
  argTypes: { id: { control: 'text' }, title: { control: 'text' }, tag: { control: false }, children: { control: false }, className: { control: false } }
} satisfies Meta<typeof SettingsGroup>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A heading over two panels; the second has its own heading and says it's only this browser's. */
export const Group: Story = {};
export const GroupNight: Story = { globals: { theme: 'dark' } };
export const GroupPhone: Story = { globals: { viewport: { value: 'phone' } } };
/** Limited to this browser as a whole: the tag sits at the heading's right. */
export const WithATag: Story = { name: 'With a tag', args: { id: 'audio', title: 'Audio and video', tag: browserOnly, children: <AudioAndVideo /> } };
/** Groups one after another, 64px apart. */
export const OneAfterAnother: Story = {
  name: 'One after another',
  render: (args) => (
    <>
      <SettingsGroup {...args} />
      <SettingsGroup id="audio" title="Audio and video" tag={browserOnly}><AudioAndVideo /></SettingsGroup>
    </>
  )
};
