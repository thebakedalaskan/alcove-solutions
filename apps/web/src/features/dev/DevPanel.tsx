import type { MockControls, Scenario } from '@alcove/api-mock';
import { Icon, Segmented, cn } from '@alcove/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';

/** Mock-only: switch the fake account's state and jump around. Not rendered against the real API. */
export function DevPanel({ controls }: { controls: MockControls }) {
  const [open, setOpen] = useState(false);
  const [scenario, setScenario] = useState<Scenario>(() => controls.scenario());
  const qc = useQueryClient();
  const navigate = useNavigate();
  const apply = async (s: Scenario) => {
    controls.setScenario(s); setScenario(s); qc.clear();
    await navigate({ to: s === 'signed-out' ? '/welcome' : '/home' });
  };
  const links: [string, () => void][] = [
    ['Welcome', () => void navigate({ to: '/welcome' })],
    ['Home', () => void navigate({ to: '/home' })],
    ['Meetings', () => void navigate({ to: '/meetings' })],
    ['Past meetings', () => void navigate({ to: '/meetings', search: { view: 'past' } })],
    ['Notes', () => void navigate({ to: '/notes' })],
    ['Account', () => void navigate({ to: '/account' })],
    ['Join someone else’s call', () => void navigate({ to: '/join/$code', params: { code: 'kpw-rnzq-hte' } })],
    ['Record in the room', () => void navigate({ to: '/record' })],
    ['Unknown call link', () => void navigate({ to: '/join/$code', params: { code: 'zzz-zzzz-zzz' } })]
  ];
  return (
    <>
      <button type="button" aria-label="Prototype controls" onClick={() => setOpen((o) => !o)}
        className={cn('fixed right-4 top-1/2 z-[80] grid size-10 -translate-y-1/2 place-items-center rounded-xl bg-card shadow-[var(--sh-lift),inset_0_0_0_1px_var(--hair)] transition-transform hover:scale-105', open && 'bg-ink text-canvas')}>
        <Icon name="settings" className="size-[18px]" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, x: 10, scale: 0.97 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 10 }} transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="fixed right-16 top-1/2 z-[80] flex w-[300px] -translate-y-1/2 flex-col gap-3 rounded-[18px] bg-card p-3.5 text-ink shadow-float">
            <div><b className="block text-sm">Mock backend</b><span className="text-xs text-ink-3">Data lives in this browser. Set VITE_ALCOVE_API=http to use the real API.</span></div>
            <Segmented label="Account state" value={scenario} onChange={apply} options={[{ value: 'signed-out', label: 'Signed out' }, { value: 'fresh', label: 'First day' }, { value: 'demo', label: 'Weeks in' }]} />
            <div className="flex flex-col">
              {links.map(([l, go]) => <button key={l} type="button" onClick={() => { go(); setOpen(false); }} className="rounded-lg px-2.5 py-1.5 text-left text-[13.5px] text-ink-2 hover:bg-well hover:text-ink">{l}</button>)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
