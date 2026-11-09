/*
 * SettingRow: one setting: what it is and what it does, then its `control` on the axis every row shares, so the eye
 * runs straight down the page. `mark` goes before the label (a provider's mark, an icon); `help` says what it does, or
 * what's wrong (`problem`). Once a change is kept, `saved` shows just left of the axis for a moment. `wide` gives the
 * control the width under the label on a phone; `stack` keeps the label level with the control when something sits under
 * it; `off` greys out a row waiting on something else. With `onLabel`, pressing the setting's name does what the control
 * does.
 */
import type { NotesLanguage } from '@alcove/api';
import { Button, Icon, ProviderMark, Segmented, Select, SettingFact, SettingRow, Switch, type SelectOption } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { did } from '../../../src/component';

/** Settings' sheet, as the page lays it out: one column of parts, every control on the same axis. */
const sheet: Decorator = (Story) => (
  <div className="set" style={{ position: 'relative', isolation: 'isolate', marginTop: 0 }}>
    <div className="set-parts" style={{ maxWidth: 820 }}><Story /></div>
  </div>
);

/** Saved, for a moment after each change, as the page says it. */
const SAVED_MS = 2200;
function useSaved(): [boolean, () => void] {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!n) return undefined;
    const t = setTimeout(() => setN(0), SAVED_MS);
    return () => clearTimeout(t);
  }, [n]);
  return [n > 0, () => setN((x) => x + 1)];
}

/** A switch that turns when pressed. */
function Toggle({ label, start = true }: { label: string; start?: boolean | undefined }) {
  const [on, setOn] = useState(start);
  return <Switch label={label} checked={on} onChange={setOn} />;
}

const LANGUAGES: SelectOption<NotesLanguage>[] = [
  { value: 'call', label: 'Same as the call' }, { value: 'en', label: 'English' }, { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' }, { value: 'de', label: 'German' }, { value: 'pt', label: 'Portuguese' }
];
const MICS: SelectOption<string>[] = [{ value: 'default', label: 'Same as system (MacBook Pro Microphone)' }, { value: 'usb', label: 'Studio USB Microphone' }];

const meta = {
  title: 'Components/Settings/SettingRow',
  component: SettingRow,
  decorators: [sheet],
  args: { label: 'Record without a connection', problem: false, wide: false, stack: false, off: false },
  argTypes: {
    label: { control: 'text' }, help: { control: 'text' }, problem: { control: 'boolean' }, saved: { control: 'text' },
    wide: { control: 'boolean' }, stack: { control: 'boolean' }, off: { control: 'boolean' },
    mark: { control: false }, control: { control: false }, onLabel: { control: false }, children: { control: false }
  }
} satisfies Meta<typeof SettingRow>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The real row's reversible save lifecycle, with no icon claiming success while a request is pending. */
export const Saving: Story = { args: { saveState: 'saving', control: <Toggle label="Record without a connection" /> } };
export const CouldntConfirm: Story = { args: { saveState: 'failed', control: <Toggle label="Record without a connection" /> } };
export const SavingNight: Story = { ...Saving, globals: { theme: 'dark' } };
export const CouldntConfirmPhone: Story = { ...CouldntConfirm, globals: { viewport: { value: 'phone' } } };

/** A switch on the axis. Pressing the setting's name turns it too (`onLabel`); the help is there to read. Once it's kept, Saved shows for a moment. */
export const WithASwitch: Story = {
  name: 'With a switch',
  args: { help: 'Saved on this device, encrypted, until you’re back online.' },
  render: function Render(args) {
    const [on, setOn] = useState(true);
    const [saved, say] = useSaved();
    const turn = (next: boolean) => { setOn(next); say(); };
    return <SettingRow {...args} saved={saved ? 'Saved' : args.saved} onLabel={() => turn(!on)} control={<Switch label="Record without a connection" checked={on} onChange={turn} />} />;
  }
};
/** Two or three choices. `wide`: on a phone the control takes the width, under the label. */
export const WithSegmented: Story = {
  name: 'With Segmented',
  args: { label: 'Notes for new calls', help: 'You can still choose for each call when you schedule it.', wide: true },
  render: function Render(args) {
    const [notes, setNotes] = useState<'on' | 'off'>('on');
    const [saved, say] = useSaved();
    return (
      <SettingRow {...args} saved={saved ? 'Saved' : args.saved}
        control={<Segmented label="Notes for new calls" value={notes} onChange={(v) => { setNotes(v); say(); }} options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />} />
    );
  }
};
/** A list. A change that's kept for what comes next says so: Saved for new notes. */
export const WithASelect: Story = {
  name: 'With a Select',
  args: { label: 'Language', wide: true },
  render: function Render(args) {
    const [language, setLanguage] = useState<NotesLanguage>('call');
    const [saved, say] = useSaved();
    return (
      <SettingRow {...args} saved={saved ? 'Saved for new notes' : args.saved}
        control={<Select<NotesLanguage> label="Notes language" value={language} options={LANGUAGES} onChange={(v) => { setLanguage(v); say(); }} />} />
    );
  }
};
/** Nothing to change: a fact holds the control's place. */
export const AFact: Story = { name: 'A fact', args: { label: 'Time zone', help: 'From this computer.', control: <SettingFact icon="globe">London · GMT</SettingFact> } };
/** A mark before the label: the provider the row is about. */
export const WithAMark: Story = {
  name: 'With a mark',
  args: {
    label: 'Google Calendar',
    mark: <ProviderMark provider="google" />,
    control: <div className="set-line"><SettingFact icon="check" tone="yes">Connected</SettingFact><Button variant="quiet" size="sm" onClick={did('onDisconnect')}>Disconnect</Button></div>
  }
};
/** The help says what's wrong (`problem`), and the control is the way on. */
export const AProblem: Story = {
  name: 'A problem',
  args: {
    label: 'Your calendar',
    mark: <Icon name="cal" />,
    help: 'Can’t reach Alcove. Check your connection.',
    problem: true,
    control: <Button variant="secondary" size="sm" icon="retry" onClick={did('onRetry')}>Try again</Button>
  }
};
/** Saved, just left of the axis, beside what was pressed. */
export const Saved: Story = { args: { label: 'Show my other meetings on Home', saved: 'Saved', control: <Toggle label="Show my other meetings on Home" /> } };
/** Something sits under the control (`stack`): the label stays level with the list, not with the pair. */
export const Stacked: Story = {
  args: { label: 'Microphone', stack: true },
  render: function Render(args) {
    const [mic, setMic] = useState('default');
    return (
      <SettingRow {...args}
        control={(
          <>
            <Select label="Microphone" value={mic} options={MICS} onChange={setMic} />
            <div className="set-lvl">
              <button type="button" className="set-test" onClick={did('onCheck')}><span className="set-bars" aria-hidden="true"><i /><i /><i /><i /></span>Check the level</button>
            </div>
          </>
        )} />
    );
  }
};
/** Waiting on something else (`off`): its choice stays as it is, greyed out, until the browser shows notifications. */
export const Off: Story = {
  args: {
    label: 'Before a call starts',
    help: 'For calls you organize.',
    wide: true,
    off: true,
    control: <Segmented label="Remind me before a call" value="5" disabled onChange={did('onChange')} options={[{ value: '1', label: '1 min' }, { value: '5', label: '5 min' }, { value: 'off', label: 'Off' }]} />
  }
};
