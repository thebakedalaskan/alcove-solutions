/*
 * SoundLevel: how loud Alcove's sounds are: turn them all off or on (with a tooltip that says which), how loud (`volume`,
 * 0 to 1, a 4px track filled in ink to the level), and Play a sound. Muted, the level steps back and keeps where it was,
 * and Play waits. It fills the Sounds row's control column.
 */
import { Segmented, SettingRow, SettingsPanel, SoundLevel, Switch } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { did } from '../../../src/component';

/** Notifications' first panel, in Settings' column. */
const inPanel: Decorator = (Story) => <div className="set-groups" style={{ maxWidth: 940, margin: '0 auto' }}><SettingsPanel><Story /></SettingsPanel></div>;

/** The Sounds row and the rows it governs, each changing as it's pressed. */
function Sounds({ start, muted: mutedAtFirst, playing: playingAtFirst }: { start: number; muted: boolean; playing: boolean }) {
  const [volume, setVolume] = useState(start);
  const [muted, setMuted] = useState(mutedAtFirst);
  const [playing, setPlaying] = useState(playingAtFirst);
  const [quiet, setQuiet] = useState(false);
  const [before, setBefore] = useState<'1' | '5' | 'off'>('5');
  useEffect(() => {
    if (!playing) return undefined;
    const t = setTimeout(() => setPlaying(false), 1300);
    return () => clearTimeout(t);
  }, [playing]);
  return (
    <>
      <SettingRow label="Sounds" help={muted ? 'Off. What each one plays is kept for when you turn them on.' : undefined}
        control={<SoundLevel volume={volume} muted={muted} playing={playing}
          onVolume={(v) => { did('onVolume')(v); setVolume(v); }} onMute={(m) => { did('onMute')(m); setMuted(m); }} onPlay={() => { did('onPlay')(); setPlaying(true); }} />} />
      <SettingRow label="Quiet mode" help="Only your microphone and requests to join make a sound." off={muted} onLabel={() => setQuiet(!quiet)}
        control={<Switch label="Quiet mode" checked={quiet} disabled={muted} onChange={setQuiet} />} />
      <SettingRow label="Before a call starts" help="A reminder for calls you organize."
        control={<Segmented<'1' | '5' | 'off'> label="Before a call starts" value={before} onChange={setBefore} options={[{ value: '1', label: '1 min' }, { value: '5', label: '5 min' }, { value: 'off', label: 'Off' }]} />} />
    </>
  );
}

const meta = {
  title: 'Components/Settings/SoundLevel',
  component: SoundLevel,
  decorators: [inPanel],
  args: { volume: 0.7, muted: false, playing: false, disabled: false, onVolume: did('onVolume'), onMute: did('onMute'), onPlay: did('onPlay') },
  argTypes: {
    volume: { control: { type: 'range', min: 0, max: 1, step: 0.05 } }, muted: { control: 'boolean' }, playing: { control: 'boolean' }, disabled: { control: 'boolean' },
    onVolume: { control: false }, onMute: { control: false }, onPlay: { control: false }
  },
  render: (args) => <Sounds start={args.volume} muted={args.muted} playing={args.playing ?? false} />
} satisfies Meta<typeof SoundLevel>;
export default meta;
type Story = StoryObj<typeof meta>;

/** On: move the level, press play to hear it. */
export const On: Story = {};
export const OnNight: Story = { ...On, name: 'On, night', globals: { theme: 'dark' } };
/** Muted: the level steps back and keeps where it was; Play waits. */
export const Muted: Story = { args: { muted: true } };
export const MutedNight: Story = { ...Muted, name: 'Muted, night', globals: { theme: 'dark' } };
/** A sound playing: Play in the sun's colour. */
export const Playing: Story = { args: { playing: true }, render: (args) => <SettingRow label="Sounds" control={<SoundLevel {...args} />} /> };
/** Waiting on the preferences: nothing can be pressed yet. */
export const Disabled: Story = { render: (args) => <SettingRow label="Sounds" control={<SoundLevel {...args} disabled />} /> };
export const OnPhone: Story = { ...On, name: 'On, phone', globals: { viewport: { value: 'phone' } } };
