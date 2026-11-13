/*
 * Cove: the land the welcome page looks out of, drawn into a Horizon as its `land`. Three headlands a side, their tops
 * rolling hills with stands of pines and cypresses, each a cliff face down to the water with the light catching one side;
 * sea stacks by the mouth of the bay; every one mirrored in the water and broken by ripples, with foam at the nearest
 * cliffs' feet. It's drawn from plain numbers, so a seed always draws the same cove: the welcome page's hero is 5 and its
 * last ask 11. Nothing rises within 24px of the words on the sky, which these stories measure as the welcome page does;
 * where the words reach across a narrow window, the whole land lies lower instead of being cut flat under them. What sails
 * or leaps passes behind it and gulls fly in front. Signing in sails out of it to Home: The evening › SailOut, and
 * Journeys › 1 Sign in.
 */
import { Cove, Horizon, VISITORS, type CoveWords, type Showing, type Visitor } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useLayoutEffect, useRef, useState } from 'react';

/** Boats and ships take minutes to cross a page; shown for themselves, they cross five times as fast. */
const SHIPS: ReadonlySet<Visitor> = new Set<Visitor>(['sail', 'steamer', 'trawler', 'tall', 'freighter', 'tug']);
/** The choices for `only` in Controls: as on a page, nothing, or one kind of visitor. */
const ONLY: Record<string, Showing | undefined> = {
  'As on a page': undefined,
  Nothing: { kind: null },
  ...Object.fromEntries(VISITORS.map((v): [string, Showing] => [v.kind, { kind: v.kind, pace: SHIPS.has(v.kind) ? 5 : undefined }]))
};

interface Land { width: number; line: number; foot: number; words: CoveWords[] }

/**
 * A cove under a sky as the welcome page's hero has one: the horizon three quarters of the way down, the nearest cliffs'
 * feet near the bottom, and (with `words`) the headline and a sentence on the sky, which the land keeps clear of.
 */
function CoveOnASky({ seed, words, only }: { seed: number; words: boolean; only?: Showing | undefined }) {
  const box = useRef<HTMLDivElement>(null);
  const sky = useRef<HTMLDivElement>(null);
  const [land, setLand] = useState<Land | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const draw = () => {
      const at = el.getBoundingClientRect();
      const line = Math.round(el.clientHeight * 0.74);
      const boxes = Array.from(sky.current?.children ?? []).map((w) => { const r = w.getBoundingClientRect(); return { l: r.left - at.left, r: r.right - at.left, b: r.bottom - at.top }; });
      setLand({ width: el.clientWidth, line, foot: Math.round(Math.max(line + 110, line + (el.clientHeight - line) * 0.94)), words: boxes });
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    if (sky.current) ro.observe(sky.current);
    return () => ro.disconnect();
  }, [words]);
  return (
    <div ref={box} className="relative isolate h-dvh min-h-[560px] overflow-hidden text-ink" style={{ '--hz': `${land?.line ?? 0}px` }}>
      <Horizon moment="home" only={only} land={land && <Cove width={land.width} line={land.line} foot={land.foot} words={land.words} seed={seed} />} />
      {words && (
        <div ref={sky} className="flex flex-col items-center gap-5 px-4 pt-[16dvh] text-center">
          <h1 className="max-w-[11.8em] font-display text-[clamp(36px,6vw,86px)] leading-none tracking-[-0.032em]">Your meeting superapp. Powered by confidential AI.</h1>
          <p className="max-w-[35em] text-[clamp(17px,1.3vw,19px)] leading-[1.58] text-ink-2">Video calls with the note taker built in. Get a transcript, a summary and follow-ups, with recordings and notes encrypted in storage.</p>
        </div>
      )}
    </div>
  );
}

const meta = {
  title: 'Components/The evening/Cove',
  component: CoveOnASky,
  parameters: { layout: 'fullscreen' },
  args: { seed: 5, words: true },
  argTypes: {
    seed: { control: { type: 'number', min: 1, step: 1 } },
    only: { control: 'select', options: Object.keys(ONLY), mapping: ONLY }
  }
} satisfies Meta<typeof CoveOnASky>;
export default meta;
type Story = StoryObj<typeof meta>;

const PHONE = { viewport: { value: 'phone', isRotated: false } };

/** The welcome page's hero cove, wide: the land stands its full height beside the words. */
export const Wide: Story = {};
/** The same cove at night. */
export const WideDark: Story = { name: 'Wide, dark', globals: { theme: 'dark' } };
/** On a phone the words reach across the window, so the whole land lies lower under them, its hills and trees whole. */
export const Phone: Story = { globals: PHONE };
export const PhoneDark: Story = { name: 'Phone, dark', globals: { ...PHONE, theme: 'dark' } };
/** With nothing on the sky the land stands its full height, whatever the width. */
export const NoWords: Story = { name: 'No words', args: { words: false } };
/** Another seed draws another cove: the welcome page's last ask. */
export const TheLastAsk: Story = { name: 'The last ask', args: { seed: 11 } };
/** Gulls fly in front of the cliffs, over and over. */
export const GullsInFront: Story = { name: 'Gulls in front', args: { only: { kind: 'gulls' } } };
/** A tall ship crosses behind the headlands, five times as fast as on the page. */
export const AShipBehind: Story = { name: 'A ship behind', args: { only: { kind: 'tall', pace: 5 } } };
