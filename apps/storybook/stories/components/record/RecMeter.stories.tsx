/*
 * RecMeter: five bars that show how loud the microphone is, in Record's Check the level. At rest they keep the shape of
 * a level; while the level is checked, useVoice moves them with the microphone (with reduced motion too: the meter is
 * how the level is read). A microphone that gives nothing lays them flat. Record is night in both themes.
 */
import { RecMeter, cn, useVoice } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef, useState } from 'react';
import { did, onStage } from '../../../src/component';

/** A voice as a microphone gives it: syllables in bursts, phrases with a little quiet between, and some noise. */
function talking(): number {
  const t = performance.now() / 1000;
  const phrase = Math.max(0, Math.sin(t * 0.8) + 0.35);
  const syllable = Math.abs(Math.sin(t * 6.1)) * (0.55 + 0.45 * Math.sin(t * 1.7));
  return Math.min(1, 0.01 + phrase * syllable * 0.32 + Math.random() * 0.02);
}
const pressed = did('check the level');

/** Record's Check the level, as the page has it: press it to check, and Stop to let go of the microphone. */
function CheckTheLevel({ checking: first = false, dead = false }: { checking?: boolean | undefined; dead?: boolean | undefined }) {
  const [checking, setChecking] = useState(first);
  const chip = useRef<HTMLButtonElement>(null);
  const meter = useRef<HTMLSpanElement>(null);
  useVoice({ sun: chip, meter, level: talking, on: checking && !dead, gain: 0.8 });
  return (
    <button ref={chip} type="button" className={cn('rec-chip rec-lv', checking && 'is-on', checking && dead && 'is-dead')} aria-pressed={checking}
      onClick={() => { pressed(); setChecking(!checking); }}>
      <RecMeter ref={meter} />
      <span className={cn(checking && 'sr-only')}>Check the level</span>
      {checking && <span aria-hidden="true">Stop</span>}
    </button>
  );
}

const meta = {
  title: 'Components/Record/RecMeter',
  component: RecMeter,
  ...onStage
} satisfies Meta<typeof RecMeter>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Before checking: the shape of a level, still. Press Check the level to see it move. */
export const AtRest: Story = { name: 'At rest', render: () => <CheckTheLevel /> };
/** Checking: the bars move with the voice. Stop lets it rest. */
export const Checking: Story = { render: () => <CheckTheLevel checking /> };
/** The microphone gives nothing: the bars lie flat. */
export const NothingHeard: Story = { name: 'Nothing heard', render: () => <CheckTheLevel checking dead /> };
