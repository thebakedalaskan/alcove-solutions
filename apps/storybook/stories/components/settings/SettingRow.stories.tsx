/*
 * SettingRow: one setting in a panel: what it is and what it does on the left, its `control` at the panel's right edge.
 * A switch, a fact or a button hugs the edge; a list or a choice fills its column; `wide` gives three evenings, a folder
 * or files a wider one, and on a phone a list, a choice or something wide goes under the label. `mark` goes before the
 * label (a provider's mark, a SettingTile) and the help lines up under the label. Once a change is kept, Saved shows just
 * left of the control for a moment (`saved`, `saveState`). `stack` keeps the label level with the control when something
 * sits under it; `off` greys out a row waiting on something else; `sub` nests a row under the connection above it. With
 * `onLabel`, pressing the setting's name does what the control does.
 */
import type { NotesLanguage } from '@alcove/api';
import { Button, Icon, ProviderMark, Segmented, Select, SettingFact, SettingRow, SettingsPanel, SettingTile, Switch, THEMES, ThemePreview, type SelectOption, type ThemeChoice } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { did } from '../../../src/component';

/** A panel in Settings' column, as the page lays it out. */
const inPanel: Decorator = (Story) => <div className="set-groups" style={{ maxWidth: 940, margin: '0 auto' }}><SettingsPanel><Story /></SettingsPanel></div>;

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
/** Each microphone once, by the name people know it by, the system's saying so, as the app lists them. */
const MICS: SelectOption<string>[] = [{ value: 'built-in', label: 'MacBook Pro Microphone', note: 'Your system’s choice' }, { value: 'usb', label: 'Studio USB Microphone' }];

const meta = {
  title: 'Components/Settings/SettingRow',
  component: SettingRow,
  decorators: [inPanel],
  args: { label: 'Record without a connection', problem: false, wide: false, stack: false, off: false, sub: false },
  argTypes: {
    label: { control: 'text' }, help: { control: 'text' }, problem: { control: 'boolean' }, saved: { control: 'text' },
    saveState: { control: 'inline-radio', options: ['none', 'saving', 'saved', 'failed'], mapping: { none: undefined } },
    wide: { control: 'boolean' }, stack: { control: 'boolean' }, off: { control: 'boolean' }, sub: { control: 'boolean' },
    mark: { control: false }, control: { control: false }, onLabel: { control: false }, children: { control: false }
  }
} satisfies Meta<typeof SettingRow>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A switch at the edge. Pressing the setting's name turns it too (`onLabel`); the help is there to read. Once it's kept, Saved shows for a moment. */
export const WithASwitch: Story = {
  name: 'With a switch',
  args: { help: 'Kept on this device, encrypted, until you’re back online.' },
  render: function Render(args) {
    const [on, setOn] = useState(true);
    const [saved, say] = useSaved();
    const turn = (next: boolean) => { setOn(next); say(); };
    return <SettingRow {...args} saved={saved ? 'Saved' : args.saved} onLabel={() => turn(!on)} control={<Switch label="Record without a connection" checked={on} onChange={turn} />} />;
  }
};
export const WithASwitchNight: Story = { ...WithASwitch, name: 'With a switch, night', globals: { theme: 'dark' } };
/** Two or three choices, filling the control column. On a phone they go under the label. */
export const WithSegmented: Story = {
  name: 'With Segmented',
  args: { label: 'Notes for new calls', help: 'Everyone invited gets them. You can change it for each call.' },
  render: function Render(args) {
    const [notes, setNotes] = useState<'on' | 'off'>('on');
    const [saved, say] = useSaved();
    return (
      <SettingRow {...args} saved={saved ? 'Saved' : args.saved}
        control={<Segmented label="Notes for new calls" value={notes} onChange={(v) => { setNotes(v); say(); }} options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />} />
    );
  }
};
export const WithSegmentedPhone: Story = { ...WithSegmented, name: 'With Segmented, phone', globals: { viewport: { value: 'phone' } } };
/** A list. A change that's kept for what comes next says so: Saved for new notes. */
export const WithASelect: Story = {
  name: 'With a Select',
  args: { label: 'Language' },
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
/** Somewhere else to change it: a link at the edge. */
export const ALink: Story = {
  name: 'A link',
  args: { label: 'Company', control: <a href="#team" className="set-go" onClick={(e) => e.preventDefault()}><span className="ac-clamp-1">Vandelay Industries</span><Icon name="right" size={14} /></a> }
};
/** A connection: its provider's mark before the label, the help under the label, then what it is and Disconnect. */
export const WithAMark: Story = {
  name: 'With a mark',
  args: {
    label: 'Google Calendar',
    mark: <ProviderMark provider="google" />,
    help: 'art@vandelay.industries',
    control: <><SettingFact icon="check" tone="yes">Connected</SettingFact><Button variant="quiet" size="sm" onClick={did('onDisconnect')}>Disconnect</Button></>
  }
};
/** What belongs to a connection nests under it (`sub`), its hairline starting there too. Not on a phone. */
export const SubRows: Story = {
  name: 'Sub rows',
  render: (args) => (
    <>
      <SettingRow {...args} label="Google Calendar" mark={<ProviderMark provider="google" />} help="art@vandelay.industries"
        control={<><SettingFact icon="check" tone="yes">Connected</SettingFact><Button variant="quiet" size="sm" onClick={did('onDisconnect')}>Disconnect</Button></>} />
      <SettingRow sub label="Put calls I schedule on my calendar" help="Google sends everyone invited an invitation." control={<Toggle label="Put calls I schedule on my calendar" />} />
      <SettingRow sub label="Show my other meetings on Home" control={<Toggle label="Show my other meetings on Home" />} />
    </>
  )
};
export const SubRowsPhone: Story = { ...SubRows, name: 'Sub rows, phone', globals: { viewport: { value: 'phone' } } };
/** Agents, in Connections: a tile as its mark, who's connected, and the way to Agents. */
export const WithATile: Story = {
  name: 'With a tile',
  args: { label: 'Agents', mark: <SettingTile icon="agent" />, help: 'Claude, Cursor and Weekly digest are connected.', control: <a href="#agents" className="set-go" onClick={(e) => e.preventDefault()}>Open Agents<Icon name="right" size={14} /></a> }
};
/** Something sits under the control (`stack`): the label stays level with the list, not with the pair. */
export const Stacked: Story = {
  args: { label: 'Microphone', stack: true },
  render: function Render(args) {
    const [mic, setMic] = useState('built-in');
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
/** A wider column (`wide`): three small evenings. */
export const Wide: Story = {
  args: { label: 'Theme', wide: true },
  render: function Render(args) {
    const [theme, setTheme] = useState<ThemeChoice>('system');
    return <SettingRow {...args} control={<div className="set-eves" role="group" aria-label="Appearance">{THEMES.map((t) => <ThemePreview key={t} theme={t} pressed={theme === t} onClick={() => setTheme(t)} />)}</div>} />;
  }
};
export const WidePhone: Story = { ...Wide, name: 'Wide, phone', globals: { viewport: { value: 'phone' } } };
/** Time is short (`warm`): the help says so in the sun's warmth, as Pro about to end does. */
export const Warm: Story = {
  args: {
    label: 'Pro',
    help: 'Ends in 3 days, on Saturday 7 November. Then you’re back on Free, and nothing is deleted.',
    warm: true,
    control: <Button variant="primary" size="sm">Extend</Button>
  }
};
/** Two controls (`under`): on a phone they go under the label, so a long help keeps its measure. */
export const Under: Story = {
  args: {
    label: 'Free',
    help: 'Every feature, with about 5 hours of notes and 10 GB of storage.',
    under: true,
    control: <><Button variant="quiet" size="sm">See plans</Button><Button variant="secondary" size="sm">Get Pro</Button></>
  }
};
export const UnderPhone: Story = { ...Under, name: 'Under, phone', globals: { viewport: { value: 'phone' } } };
/** Waiting on something else (`off`): its choice stays as it is, greyed out. */
export const Off: Story = {
  args: {
    label: 'Quiet mode',
    help: 'Only your microphone and requests to join make a sound.',
    off: true,
    control: <Switch label="Quiet mode" checked={false} disabled onChange={did('onChange')} />
  }
};
/** On its way: the row says so beside the switch, with no tick claiming it's kept. */
export const Saving: Story = { args: { saveState: 'saving', control: <Toggle label="Record without a connection" /> } };
/** Kept, just left of what was pressed. */
export const Saved: Story = { args: { label: 'Show my other meetings on Home', saveState: 'saved', control: <Toggle label="Show my other meetings on Home" /> } };
/** Saved beside a list, just left of the list itself. */
export const SavedBesideAList: Story = { name: 'Saved beside a list', args: { label: 'Language', saveState: 'saved', saved: 'Saved for new notes', control: <Select<NotesLanguage> label="Notes language" value="call" options={LANGUAGES} onChange={did('onChange')} /> } };
/** The answer never came. */
export const CouldntConfirm: Story = { args: { saveState: 'failed', control: <Toggle label="Record without a connection" /> } };
export const SavingNight: Story = { ...Saving, name: 'Saving, night', globals: { theme: 'dark' } };
export const SavedPhone: Story = { ...Saved, name: 'Saved, phone', globals: { viewport: { value: 'phone' } } };
/** The help says what's wrong (`problem`), and the control is the way on. */
export const AProblem: Story = {
  name: 'A problem',
  args: {
    label: 'Microphone',
    help: 'Turn the microphone on for this site in the address bar, then try again.',
    problem: true,
    control: <><SettingFact icon="micOff" tone="no">Blocked</SettingFact><Button variant="quiet" size="sm" icon="retry" onClick={did('onRetry')}>Try again</Button></>
  }
};
