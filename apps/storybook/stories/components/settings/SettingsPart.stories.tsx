/*
 * SettingsPart: one part of Settings, which is one long page with no cards: a heading, what the part is limited to when
 * that isn't the whole account (`tag`, such as This browser only), then its rows, each a label and a control on one
 * axis. `id` is where the page's index jumps to. Parts follow one another with space between them.
 */
import type { NotesLanguage, NotesSetting, SummaryLength } from '@alcove/api';
import { Icon, Segmented, Select, SettingFact, SettingRow, SettingsPart, SunLine, ThemePreview, type SelectOption, type ThemeChoice } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

/** Settings' sheet, as the page lays it out: one column of parts, every control on the same axis. */
const sheet: Decorator = (Story) => (
  <div className="set" style={{ position: 'relative', isolation: 'isolate', marginTop: 0 }}>
    <div className="set-parts" style={{ maxWidth: 820 }}><Story /></div>
  </div>
);

const LANGUAGES: SelectOption<NotesLanguage>[] = [
  { value: 'call', label: 'Same as the call' }, { value: 'en', label: 'English' }, { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' }, { value: 'de', label: 'German' }, { value: 'pt', label: 'Portuguese' }
];

/** The Notes part's rows, each saved as it changes. */
function NotesRows() {
  const [notes, setNotes] = useState<NotesSetting>('on');
  const [language, setLanguage] = useState<NotesLanguage>('call');
  const [summary, setSummary] = useState<SummaryLength>('short');
  return (
    <>
      <SettingRow wide label="Notes for new calls" help="You can still choose for each call when you schedule it."
        control={<Segmented<NotesSetting> label="Notes for new calls" value={notes} onChange={setNotes} options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />} />
      <SettingRow label="Who gets them" control={<SettingFact icon="lock">Everyone invited, always</SettingFact>} />
      <SettingRow wide label="Language" control={<Select<NotesLanguage> label="Notes language" value={language} options={LANGUAGES} onChange={setLanguage} />} />
      <SettingRow wide label="Summary"
        control={<Segmented<SummaryLength> label="Summary length" value={summary} onChange={setSummary} options={[{ value: 'short', label: 'Short' }, { value: 'detailed', label: 'Detailed' }]} />} />
    </>
  );
}

const THEMES: readonly ThemeChoice[] = ['system', 'light', 'dark'];
/** Appearance's one row: three small evenings, the one in use ringed. */
function AppearanceRows() {
  const [theme, setTheme] = useState<ThemeChoice>('system');
  return (
    <SettingRow wide label="Theme"
      control={<div className="set-eves" role="group" aria-label="Appearance">{THEMES.map((t) => <ThemePreview key={t} theme={t} pressed={theme === t} onClick={() => setTheme(t)} />)}</div>} />
  );
}

const meta = {
  title: 'Components/Settings/SettingsPart',
  component: SettingsPart,
  decorators: [sheet],
  args: { id: 'notes', title: 'Notes', children: <NotesRows /> },
  argTypes: { title: { control: 'text' }, tag: { control: 'text' }, id: { control: 'text' }, children: { control: false }, className: { control: false } }
} satisfies Meta<typeof SettingsPart>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A heading over its rows. */
export const Part: Story = {};
/** Limited to this browser, which the heading says on its right. */
export const WithATag: Story = { name: 'With a tag', args: { id: 'appearance', title: 'Appearance', tag: 'This browser only', children: <AppearanceRows /> } };
/** Parts one after another down the page, with space between them. */
export const OneAfterAnother: Story = {
  name: 'One after another',
  render: (args) => (
    <>
      <SettingsPart id="profile" title="Profile">
        <SettingRow label="Company" control={<a href="#team" className="set-go" onClick={(e) => e.preventDefault()}><span className="ac-clamp-1">Vandelay Industries</span><Icon name="right" size={14} /></a>} />
        <SettingRow label="Time zone" help="From this computer." control={<SettingFact icon="globe">London · GMT</SettingFact>} />
      </SettingsPart>
      <SettingsPart {...args} />
      <SettingsPart id="plan" title="Plan and credits">
        <SettingRow className="is-left" label="Notes left" control={<span className="set-left">2 h 40 min</span>}><SunLine share={0.4} /></SettingRow>
        <SettingRow label="Calls without notes" control={<SettingFact>Free</SettingFact>} />
      </SettingsPart>
    </>
  )
};
