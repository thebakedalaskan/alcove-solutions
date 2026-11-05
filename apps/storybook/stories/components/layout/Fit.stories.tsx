/*
 * Fit, with useSceneLoop: a small picture of the product, drawn at a fixed design size (here 640 × 360) and scaled to the
 * width of its column, so everything inside is placed in design pixels. It's a picture by default: `label` describes it
 * and nothing inside can be focused. `interactive` is for one people can use. useSceneLoop plays the scene's loop on its
 * beats (`sleep`, and `wait` for an animation), only while the scene is on screen; it pauses when it scrolls away and
 * ends when it unmounts. Under reduced motion the scene holds still on its first line.
 */
import type { Person } from '@alcove/api';
import { CallDock, CallTile, Caption, DURATION, DockButton, EASE, Fit, useSceneLoop, type Thenable } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef, useState } from 'react';
import { KOFI, PRIYA } from '../../../src/world/people';

/** What's said in the scene, in turn: Design review, as the demo world has it. */
interface Line { who: Person; name: string; text: string }
const FIRST: Line = { who: KOFI, name: 'Kofi', text: 'The sidebar reads better dark, in both themes.' };
const LINES: readonly Line[] = [
  FIRST,
  { who: PRIYA, name: 'Priya', text: 'One filled button per view from now on.' },
  { who: KOFI, name: 'Kofi', text: 'The new empty states can ride the same flag.' }
];

const curve = (c: readonly number[]) => `cubic-bezier(${c.join(', ')})`;
/** The caption rises in, or fades out: an animation the loop waits for. */
function fade(el: HTMLElement | null, show: boolean): Thenable {
  if (!el) return Promise.resolve();
  const frames = show ? [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }] : [{ opacity: 1 }, { opacity: 0 }];
  return el.animate(frames, { duration: (show ? DURATION[3] : DURATION[2]) * 1000, easing: curve(show ? EASE.out : EASE.in), fill: 'both' }).finished;
}
const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Priya and Kofi in a call: whoever speaks has the ring, and their words come up as a caption. */
function CallScene({ width, height, label, interactive = false, column }: { width: number; height: number; label: string; interactive?: boolean | undefined; column: string }) {
  const stage = useRef<HTMLDivElement>(null);
  const caption = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const [mic, setMic] = useState(true);
  const [camera, setCamera] = useState(true);
  const line = LINES[at] ?? FIRST;

  useSceneLoop(stage, async (c) => {
    for (let i = 0; ; i = (i + 1) % LINES.length) {
      setAt(i);
      await c.sleep(160);
      await c.wait(fade(caption.current, true));
      await c.sleep(2600);
      await c.wait(fade(caption.current, false));
    }
  }, !still());

  return (
    <div style={{ width: column, maxWidth: '100%' }}>
      <Fit width={width} height={height} label={label} interactive={interactive} stageRef={stage} className="rounded-[var(--radius-lg)]">
        <div className="ac-stage absolute inset-0">
          <div className="absolute grid" style={{ left: 16, top: 16, width: 298, height: 190 }}><CallTile person={PRIYA} name="Priya Raman" speaking={line.who === PRIYA} /></div>
          <div className="absolute grid" style={{ left: 326, top: 16, width: 298, height: 190 }}><CallTile person={KOFI} name="Kofi Asante" speaking={line.who === KOFI} /></div>
          <div ref={caption} className="absolute" style={{ left: 16, top: 218, width: 608 }}><Caption who={line.name}>{line.text}</Caption></div>
          <div className="absolute flex justify-center" style={{ left: 0, right: 0, top: 296 }}>
            <CallDock>
              <DockButton icon={mic ? 'mic' : 'micOff'} label={mic ? 'Mute' : 'Unmute'} off={!mic} onClick={() => setMic(!mic)} />
              <DockButton icon={camera ? 'video' : 'videoOff'} label={camera ? 'Turn camera off' : 'Turn camera on'} off={!camera} onClick={() => setCamera(!camera)} />
            </CallDock>
          </div>
        </div>
      </Fit>
    </div>
  );
}

const meta = {
  title: 'Components/Layout/Fit',
  component: Fit,
  args: { width: 640, height: 360, label: 'Priya and Kofi in a call: whoever speaks has the ring, and their words come up as a caption', interactive: false, children: null },
  argTypes: { label: { control: 'text' }, width: { control: false }, height: { control: false }, children: { control: false }, stageRef: { control: false }, className: { control: false } },
  render: (args) => <CallScene {...args} column="760px" />
} satisfies Meta<typeof Fit>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A picture: the loop plays on its beats, and nothing in it can be focused or pressed. */
export const APicture: Story = { name: 'A picture' };
/** `interactive`: the same scene, and its dock works. Press the microphone or the camera. */
export const Interactive: Story = { args: { interactive: true } };
/** In a narrow column the whole scene scales down, every piece where it was drawn. */
export const InANarrowColumn: Story = { name: 'In a narrow column', render: (args) => <CallScene {...args} column="320px" /> };
