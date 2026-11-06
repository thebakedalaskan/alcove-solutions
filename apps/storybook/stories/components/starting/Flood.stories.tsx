/*
 * Flood: night flooding out from what was pressed, over everything, on the way to a call's lobby: Start now in the call
 * modal, or Join on a call's card. `at` is where it starts, in pixels in the window: the middle of what was pressed.
 * `back` draws it away again when the lobby didn't open. It's drawn over the modal, so it goes straight into the page.
 * Nothing floods until you press Start now.
 */
import { Button, Flood, FlowHead, FlowView, WayCard } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ModalFrame, did } from '../../../src/component';

/** How long night takes to flood out, and to draw back. */
const FLOOD_MS = 560;
const BACK_MS = 240;

interface Night { at: { x: number; y: number }; back: boolean; full: boolean }

/**
 * The modal's first view. Start now floods night out from the middle of the card. With `fails`, the lobby doesn't open
 * and the night draws back by itself; otherwise it stays, with a way back over it.
 */
function StartACall({ fails }: { fails: boolean }) {
  const [night, setNight] = useState<Night | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => { for (const t of timers.current) window.clearTimeout(t); }, []);
  const later = (ms: number, then: () => void) => { timers.current.push(window.setTimeout(then, ms)); };
  const drawBack = () => {
    setNight((n) => n && { ...n, back: true });
    later(BACK_MS, () => setNight(null));
  };
  const start = (from: Element) => {
    if (night) return;
    const box = from.getBoundingClientRect();
    setNight({ at: { x: box.left + box.width / 2, y: box.top + box.height / 2 }, back: false, full: false });
    later(FLOOD_MS, () => setNight((n) => n && { ...n, full: true }));
    if (fails) later(FLOOD_MS + 500, drawBack);
  };
  return (
    <>
      <ModalFrame>
        <FlowView>
          <FlowHead title="Start a call" onClose={did('onClose')} />
          <div className="cf-ways">
            <WayCard art="now" title="Start now" kbd="↵" onClick={(e) => start(e.currentTarget)}>Ring your team in, or share a link.</WayCard>
            <WayCard art="later" title="Schedule for later" kbd="S" onClick={did('onLater')}>Find a time that works for everyone.</WayCard>
          </div>
        </FlowView>
      </ModalFrame>
      {night && <Flood at={night.at} back={night.back} />}
      {night?.full && !night.back && !fails && createPortal(
        <div className="dark" style={{ position: 'fixed', inset: 0, zIndex: 61, display: 'grid', placeItems: 'center', alignContent: 'center', gap: 14, pointerEvents: 'none' }}>
          <p style={{ font: '400 15px/1.5 var(--font-sans)', color: 'var(--stage-ink-2)' }}>The lobby takes over from here.</p>
          <span style={{ pointerEvents: 'auto' }}><Button onClick={drawBack}>Draw it back</Button></span>
        </div>,
        document.body
      )}
    </>
  );
}

const meta = {
  title: 'Components/Starting a call/Flood',
  component: Flood,
  parameters: { controls: { disable: true } },
  args: { at: { x: 0, y: 0 }, back: false }
} satisfies Meta<typeof Flood>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Press Start now: night floods out from the middle of the card, over the modal and the page. Draw it back to start again. */
export const FromWhatWasPressed: Story = { name: 'From what was pressed', render: () => <StartACall fails={false} /> };
/** The lobby didn't open: a moment after it fills, the night draws back (`back`), and the modal is there as it was. */
export const DrawnBack: Story = { name: 'Drawn back', render: () => <StartACall fails /> };
