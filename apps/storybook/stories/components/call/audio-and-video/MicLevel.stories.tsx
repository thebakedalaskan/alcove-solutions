/*
 * MicLevel: how loud the microphone is, from `level` (0 to 1), as `bars` that fill with horizon, beside a microphone
 * choice. It doesn't open the microphone: it's given the level that's measured, as often as that comes. Settings draws
 * it in fine ticks under the microphone while Check the level runs.
 */
import { MicLevel, Select, SettingRow, cn, type SelectOption } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { Row } from '../../../../src/component';

/** How long Check the level keeps the microphone open. */
const CHECK_SECONDS = 8;
/** Each microphone once, by the name people know it by, the system's saying so, as the app lists them. */
const MICS: SelectOption<string>[] = [
  { value: 'built-in', label: 'MacBook Pro Microphone', note: 'Your system’s choice' },
  { value: 'usb', label: 'Studio USB Microphone' }
];

/** Someone talking, ten times a second as the app measures it: syllables, with pauses between phrases. */
function useTalking(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 110);
    return () => clearInterval(t);
  }, []);
  const phrase = Math.max(0, Math.sin(tick * 0.09));
  const syllable = 0.55 + 0.45 * Math.abs(Math.sin(tick * 1.7) * Math.cos(tick * 0.6));
  return Math.min(1, phrase * syllable * 1.15);
}

const meta = {
  title: 'Components/In a call/Audio and video/MicLevel',
  component: MicLevel,
  parameters: { layout: 'centered' },
  args: { level: 0.5, bars: 8, label: 'Microphone level' },
  argTypes: {
    level: { control: { type: 'range', min: 0, max: 1, step: 0.01 } },
    bars: { control: { type: 'number', min: 1, max: 40, step: 1 } },
    label: { control: 'text' },
    className: { control: false }
  }
} satisfies Meta<typeof MicLevel>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing heard. */
export const Silent: Story = { args: { level: 0 } };
/** Someone speaking at an ordinary level. */
export const Speaking: Story = { args: { level: 0.55 } };
/** As loud as it measures. */
export const Loud: Story = { args: { level: 1 } };
/** Beside the microphone it measures, moving as someone talks. */
export const Live: Story = {
  render: function Render(args) {
    const level = useTalking();
    const [mic, setMic] = useState('built-in');
    return (
      <Row>
        <Select label="Microphone" icon="mic" value={mic} options={MICS} onChange={setMic} />
        <MicLevel {...args} level={level} />
      </Row>
    );
  }
};
/**
 * On Settings, while Check the level runs: fine ticks across the axis, under the microphone, for eight seconds or until
 * Stop. Nothing is recorded. Press Check the level to run it again.
 */
export const InSettings: Story = {
  name: 'In Settings',
  parameters: { layout: 'padded' },
  args: { bars: 26, className: 'set-ticks' },
  render: function Render(args) {
    const level = useTalking();
    const [mic, setMic] = useState('built-in');
    const [checking, setChecking] = useState(true);
    const [left, setLeft] = useState(CHECK_SECONDS);
    useEffect(() => {
      if (!checking) return undefined;
      setLeft(CHECK_SECONDS);
      const t = setInterval(() => setLeft((s) => s - 1), 1000);
      return () => clearInterval(t);
    }, [checking]);
    useEffect(() => { if (left <= 0) setChecking(false); }, [left]);
    return (
      <div className="set" style={{ position: 'relative', isolation: 'isolate', marginTop: 0 }}>
        <div className="set-groups" style={{ maxWidth: 820 }}>
          <SettingRow stack label="Microphone" help={checking ? 'Speak, and watch it move. Nothing is recorded.' : undefined}
            control={(
              <>
                <Select label="Microphone" value={mic} options={MICS} onChange={setMic} />
                <div className={cn('set-lvl', checking && 'is-on')}>
                  {checking && <MicLevel {...args} level={level} />}
                  <button type="button" className="set-test" aria-pressed={checking} onClick={() => setChecking((c) => !c)}>
                    {checking ? `Stop · ${Math.max(1, left)} s` : <><span className="set-bars" aria-hidden="true"><i /><i /><i /><i /></span>Check the level</>}
                  </button>
                </div>
              </>
            )} />
        </div>
      </div>
    );
  }
};
