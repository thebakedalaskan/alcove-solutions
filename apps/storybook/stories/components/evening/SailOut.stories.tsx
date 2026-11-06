/*
 * SailOut: signing in from the welcome page, out of its cove to Home. Home renders it over itself (features/home/SailOut.tsx)
 * when a way in on the welcome page was pressed on the way there: it starts where the welcome page's cove stood, the headlands
 * go by on either side, nearest first, the horizon comes up to Home's and the sun eases to Home's size, only ever rising;
 * then the frame forms round the sea, Home's parts rise in, and the sea clears. A press, a key or the wheel clears it at
 * once. Here it sails out over a stand-in for Home, and again a moment after it's done; the real one plays in
 * Journeys › 1 Sign in › 1.3 and 1.5.
 */
import { Horizon, SailOut, type SailFrom, type SailHome } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useLayoutEffect, useRef, useState } from 'react';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Home's sky, as its stylesheet sets it. */
const HOME_SKY = 'clamp(352px, 45vh, 540px)';

/** Sails out over a stand-in for Home: the evening at Home's horizon, with its title rising in. `framed`: inside an 8px frame. */
function SailingOut({ framed }: { framed: boolean }) {
  const page = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const [round, setRound] = useState(0);
  const [sail, setSail] = useState<{ from: SailFrom; home: SailHome } | null>(null);
  useLayoutEffect(() => {
    const el = page.current, sun = el?.querySelector(':scope > .hz > .hz-up > .hz-light');
    if (!el || !sun) return;
    const width = document.documentElement.clientWidth, tall = document.documentElement.clientHeight;
    const at = sun.getBoundingClientRect();
    const line = Math.round(tall * 0.7);
    setSail({
      from: { width, line, sky: line, foot: Math.round(Math.max(line + 110, line + (tall - line) * 0.94)), sun: 0, r: clamp(width * 0.041, 44, 60), words: [], seed: 5 },
      home: { line: at.top, x: at.left, r: 48, frame: framed ? { top: 8, right: 8, bottom: 8, left: 8, radius: 24 } : null, side: null, rise: title.current ? [title.current] : [] }
    });
  }, [round, framed]);
  const again = () => { setSail(null); setTimeout(() => setRound((n) => n + 1), 1600); };
  return (
    <div ref={page} className="relative isolate h-dvh overflow-hidden text-ink" style={{ '--hz': HOME_SKY }}>
      <Horizon moment="home" />
      <h1 ref={title} className="relative pt-[18vh] text-center font-display text-[clamp(36px,3.8vw,56px)] leading-[1.1]">Start a call</h1>
      {sail && <SailOut key={round} from={sail.from} home={sail.home} onDone={again} />}
    </div>
  );
}

const meta = {
  title: 'Components/The evening/SailOut',
  component: SailingOut,
  parameters: { layout: 'fullscreen' },
  args: { framed: true }
} satisfies Meta<typeof SailingOut>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Out of the cove to Home's sea, and the page takes its rounded edge as the frame forms. */
export const Framed: Story = {};
/** At night. */
export const FramedDark: Story = { name: 'Framed, dark', globals: { theme: 'dark' } };
/** On a phone there's no frame: the sea clears straight into Home. */
export const Phone: Story = { args: { framed: false }, globals: { viewport: { value: 'phone', isRotated: false } } };
