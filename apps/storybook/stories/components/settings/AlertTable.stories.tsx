/*
 * AlertTable: what reaches you, each thing once, with its two ways side by side: Alert (on screen in Alcove, and from the
 * browser when Alcove is in another tab) and Sound. A cell is empty where that way doesn't apply. `soundOff` dims the
 * Sound column and holds its ticks as they are; `disabled` holds every tick while the choices aren't known yet. Each tick
 * is a checkbox named for its row and way (Mentions: alert). Saving…, Saved or Couldn't confirm takes the row's note line
 * for a moment (under the label when it has no note), so the label never gives up room for it. It sits in a panel of its
 * own, What reaches you.
 */
import { AlertTable, SettingsPanel, type AlertTableGroup, type AlertTableRow, type AlertWay } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { did } from '../../../src/component';

/** The panel it sits in, in Settings' column. */
const inPanel: Decorator = (Story) => <div className="set-groups" style={{ maxWidth: 940, margin: '0 auto' }}><SettingsPanel title="What reaches you"><Story /></SettingsPanel></div>;

const GROUPS: readonly AlertTableGroup[] = [
  {
    title: 'In a call',
    rows: [
      { id: 'privateMessages', label: 'Private messages', icon: 'privateChat', alert: true, sound: true },
      { id: 'mentions', label: 'Mentions', icon: 'at', alert: true, sound: true },
      { id: 'replies', label: 'Replies to you', icon: 'reply', alert: true, sound: true },
      { id: 'admissions', label: 'Requests to join', note: 'When you host', icon: 'door', alert: true, sound: true },
      { id: 'hands', label: 'Raised hands', note: 'When you host or present', icon: 'hand', alert: true, sound: true },
      { id: 'questions', label: 'New questions', note: 'When you host or present', icon: 'ask', alert: false, sound: true },
      { id: 'timers', label: 'The timer running out', icon: 'timer', alert: true, sound: true },
      { id: 'people', label: 'People joining and leaving', icon: 'people', alert: null, sound: true },
      { id: 'mic', label: 'Your microphone on and off', icon: 'mic', alert: null, sound: true }
    ]
  },
  {
    title: 'Outside a call',
    rows: [
      { id: 'ringing', label: 'Someone rings you', icon: 'ringIn', alert: true, sound: true },
      { id: 'notesReady', label: 'Your notes are ready', icon: 'fileCheck', alert: true, sound: null },
      { id: 'sharedWithYou', label: 'Notes shared with you', icon: 'shareNodes', alert: true, sound: null },
      { id: 'notesRequested', label: 'Someone asks for notes', note: 'Calls you organize', icon: 'handHelping', alert: true, sound: null },
      { id: 'followUpDue', label: 'A follow-up is due', note: 'At 9:00 that day', icon: 'todo', alert: false, sound: null },
      { id: 'tagged', label: 'Mentions in documents', icon: 'filePen', alert: true, sound: null }
    ]
  }
];

/** Each tick flips at once, says Saving… and then Saved, as the page saves it. */
function Live({ start, soundOff, disabled }: { start: readonly AlertTableGroup[]; soundOff: boolean; disabled: boolean }) {
  const [groups, setGroups] = useState(start);
  const [press, setPress] = useState<{ id: string; n: number } | null>(null);
  useEffect(() => {
    if (!press) return undefined;
    const say = (saveState: AlertTableRow['saveState']) => setGroups((gs) => gs.map((g) => ({ ...g, rows: g.rows.map((r) => (r.id === press.id ? { ...r, saveState } : r)) })));
    const done = setTimeout(() => say('saved'), 500);
    const gone = setTimeout(() => say(undefined), 2700);
    return () => { clearTimeout(done); clearTimeout(gone); };
  }, [press]);
  const change = (id: string, way: AlertWay, on: boolean) => {
    did('onChange')(id, way, on);
    setGroups((gs) => gs.map((g) => ({
      ...g,
      rows: g.rows.map((r) => (r.id !== id ? { ...r, saveState: undefined } : way === 'alert' ? { ...r, alert: on, saveState: 'saving' } : { ...r, sound: on, saveState: 'saving' }))
    })));
    setPress((p) => ({ id, n: (p?.n ?? 0) + 1 }));
  };
  return <AlertTable groups={groups} soundOff={soundOff} disabled={disabled} label="What reaches you" onChange={change} />;
}

const meta = {
  title: 'Components/Settings/AlertTable',
  component: AlertTable,
  decorators: [inPanel],
  args: { groups: GROUPS, soundOff: false, disabled: false, label: 'What reaches you', onChange: did('onChange') },
  argTypes: { groups: { control: false }, soundOff: { control: 'boolean' }, disabled: { control: 'boolean' }, label: { control: 'text' }, onChange: { control: false } },
  render: (args) => <Live start={args.groups} soundOff={args.soundOff ?? false} disabled={args.disabled ?? false} />
} satisfies Meta<typeof AlertTable>;
export default meta;
type Story = StoryObj<typeof meta>;

/** In a call, then outside one. Press a tick: Saving…, then Saved, at the end of its row's label. */
export const Default: Story = {};
export const DefaultNight: Story = { ...Default, name: 'Default, night', globals: { theme: 'dark' } };
/** Sounds are off: the Sound column steps back and keeps its ticks. */
export const SoundsOff: Story = { name: 'Sounds off', args: { soundOff: true } };
export const SoundsOffNight: Story = { ...SoundsOff, name: 'Sounds off, night', globals: { theme: 'dark' } };
/** The choices aren't known yet (a call's own Settings, while they load): every tick waits, stepped back. */
export const NotReady: Story = { name: 'Not ready', args: { disabled: true } };
/** A tick on its way, one kept, one the answer never came for: on the note's line, or under a label that has none. */
export const SavingAndSaved: Story = {
  name: 'Saving and saved',
  args: {
    groups: GROUPS.map((g) => ({
      ...g,
      rows: g.rows.map((r) => (r.id === 'mentions' ? { ...r, saveState: 'saving' } : r.id === 'hands' ? { ...r, saveState: 'saved' } : r.id === 'ringing' ? { ...r, saveState: 'failed' } : r))
    }))
  },
  render: (args) => <AlertTable {...args} />
};
/** On a phone the columns close up. */
export const Phone: Story = { globals: { viewport: { value: 'phone' } } };
export const SavingAndSavedPhone: Story = { ...SavingAndSaved, name: 'Saving and saved, phone', globals: { viewport: { value: 'phone' } } };
export const PhoneNight: Story = { ...Phone, name: 'Phone, night', globals: { viewport: { value: 'phone' }, theme: 'dark' } };
