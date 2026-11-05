/*
 * RecorderSun: the recorder on Record's night scene, standing on the horizon where the sun would be. A dark disc with the
 * last of the light around its rim (`idle`); its rim lit while the microphone's level is checked (`check`); full of
 * colour only while it records (`live`); dark again while paused (`paused`); sinking while the recording finishes
 * (`set`). Its reflection on the water is the voice: moonlight on calm water (`idle`, and `still` on the recorder's own
 * page), the check's shorter reflection (`level`), or the voice in the orb's colour (`live`). useVoice moves both with
 * the microphone by changing a few CSS variables. Record is night in both themes.
 */
import { Evening, RecorderSun, useVoice, type OrbState, type VoiceKind } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef, type ReactNode } from 'react';

const ORBS = ['idle', 'check', 'live', 'paused', 'set'] as const satisfies readonly OrbState[];
const VOICES = ['idle', 'level', 'live', 'still'] as const satisfies readonly VoiceKind[];

/**
 * Record's night: the evening at its record moment, with the horizon where Record puts it (record.css sets --hz). There
 * are no app bars around it here, so on a phone it neither tucks under the top bar nor stops short of the tab bar.
 */
function RecordNight({ children }: { children: ReactNode }) {
  return (
    <Evening moment="record" className="rec dark" style={{ marginTop: 0, minHeight: '100vh' }}>
      {children}
      {/* What stands for the page: Record's sky and water are as tall as what's on them. */}
      <div aria-hidden="true" style={{ height: 'calc(var(--hz) + var(--orb) + 160px)' }} />
    </Evening>
  );
}

/** A voice as a microphone gives it: syllables in bursts, phrases with a little quiet between, and some noise. */
function talking(): number {
  const t = performance.now() / 1000;
  const phrase = Math.max(0, Math.sin(t * 0.8) + 0.35);
  const syllable = Math.abs(Math.sin(t * 6.1)) * (0.55 + 0.45 * Math.sin(t * 1.7));
  return Math.min(1, 0.01 + phrase * syllable * 0.32 + Math.random() * 0.02);
}

const meta = {
  title: 'Components/Record/RecorderSun',
  component: RecorderSun,
  parameters: { layout: 'fullscreen' },
  args: { orb: 'idle', voice: 'idle' },
  argTypes: { orb: { control: 'inline-radio', options: ORBS }, voice: { control: 'inline-radio', options: VOICES } },
  render: (args) => <RecordNight><RecorderSun {...args} /></RecordNight>
} satisfies Meta<typeof RecorderSun>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Record as it opens: the recorder dark, and moonlight on calm water. */
export const Idle: Story = {};
/** Checking the microphone's level: the rim lights, and the reflection is the check's. */
export const CheckingTheLevel: Story = { name: 'Checking the level', args: { orb: 'check', voice: 'level' } };
/** Recording: colour rises inside it from the waterline, and the voice is in its colour. */
export const Recording: Story = { args: { orb: 'live', voice: 'live' } };
/** Paused: dark again, over still water. */
export const Paused: Story = { args: { orb: 'paused', voice: 'still' } };
/** Finishing: it sinks into the water while the recording is kept. */
export const Finishing: Story = { args: { orb: 'set', voice: 'still' } };
/** Recording, while the microphone isn't working: the water stays still. */
export const MicrophoneNotWorking: Story = { name: 'Microphone not working', args: { orb: 'live', voice: 'still' } };
/** Recording, moved by a voice: the newest level at the horizon, moving out across the water, and the orb rising and falling a little with it. */
export const MovingWithAVoice: Story = {
  name: 'Moving with a voice',
  args: { orb: 'live', voice: 'live' },
  render: function Render(args) {
    const sun = useRef<HTMLDivElement>(null);
    useVoice({ sun, level: talking, on: true });
    return <RecordNight><RecorderSun ref={sun} {...args} /></RecordNight>;
  }
};
/** Checking the level, moved by a voice: the reflection is shorter than while recording. */
export const CheckingWithAVoice: Story = {
  name: 'Checking, with a voice',
  args: { orb: 'check', voice: 'level' },
  render: function Render(args) {
    const sun = useRef<HTMLDivElement>(null);
    useVoice({ sun, level: talking, on: true, gain: 0.8 });
    return <RecordNight><RecorderSun ref={sun} {...args} /></RecordNight>;
  }
};
