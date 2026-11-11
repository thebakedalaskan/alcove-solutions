/*
 * SettingsPanel: one panel of a group: `surface` with a hairline edge and 18px corners, rows inside on hairlines, never a
 * card per row. An optional small heading sits over it (`title`, with its own `tag`). Anything that shouldn't stand on a
 * hairline takes `is-flush`. A panel with an open list rises over the panels after it. With `id` the address can jump to
 * it (Recording in the room, Agents).
 */
import type { NotesLanguage, NotesSetting } from '@alcove/api';
import { Icon, Segmented, Select, SettingRow, SettingsGroup, SettingsPanel, Switch, type SelectOption } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

/** Settings' column, as the page lays it out. */
const column: Decorator = (Story) => <div className="set-groups" style={{ maxWidth: 940, margin: '0 auto' }}><Story /></div>;

const LANGUAGES: SelectOption<NotesLanguage>[] = [
  { value: 'call', label: 'Same as the call' }, { value: 'en', label: 'English' }, { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' }, { value: 'de', label: 'German' }, { value: 'pt', label: 'Portuguese' }
];

/** The Notes panel's rows, each changing as it's pressed. */
function NotesRows() {
  const [notes, setNotes] = useState<NotesSetting>('on');
  const [language, setLanguage] = useState<NotesLanguage>('call');
  return (
    <>
      <SettingRow label="Notes for new calls" help="Everyone invited gets them. You can change it for each call."
        control={<Segmented<NotesSetting> label="Notes for new calls" value={notes} onChange={setNotes} options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />} />
      <SettingRow label="Language" control={<Select<NotesLanguage> label="Notes language" value={language} options={LANGUAGES} onChange={setLanguage} />} />
    </>
  );
}

/** Recording in the room: one switch. */
function RecordingRows() {
  const [on, setOn] = useState(true);
  return <SettingRow label="Record without a connection" help="Kept on this device, encrypted, until you’re back online." onLabel={() => setOn(!on)} control={<Switch label="Record without a connection" checked={on} onChange={setOn} />} />;
}

const meta = {
  title: 'Components/Settings/SettingsPanel',
  component: SettingsPanel,
  decorators: [column],
  args: { title: 'Notes', children: <NotesRows /> },
  argTypes: { id: { control: 'text' }, title: { control: 'text' }, tag: { control: false }, children: { control: false }, className: { control: false } }
} satisfies Meta<typeof SettingsPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A small heading over the panel, then its rows on hairlines. */
export const Panel: Story = {};
export const PanelNight: Story = { globals: { theme: 'dark' } };
export const PanelPhone: Story = { globals: { viewport: { value: 'phone' } } };
/** No heading: the group's heading says what it is. */
export const Untitled: Story = { args: { title: undefined, children: <RecordingRows /> } };
/** Limited to this browser: its tag at the heading's right. */
export const WithATag: Story = { name: 'With a tag', args: { title: 'Appearance', tag: <><Icon name="laptop" />This browser</>, children: <RecordingRows /> } };
/** Two panels in a group, 26px apart: the second is somewhere the address can jump to. */
export const InAGroup: Story = {
  name: 'In a group',
  render: (args) => (
    <SettingsGroup id="calls" title="Calls and notes">
      <SettingsPanel {...args} />
      <SettingsPanel id="recording" title="Recording in the room"><RecordingRows /></SettingsPanel>
    </SettingsGroup>
  )
};
