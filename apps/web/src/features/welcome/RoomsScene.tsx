/* Breakout rooms: six people split into two rooms on one timer, hear from the host, and come back with their notes. */
import { Avatar, Button, CallTile, EASE, Fit, Icon, NotesSign, useSceneLoop } from '@alcove/ui';
import { AnimatePresence, animate, motion, useReducedMotion } from 'motion/react';
import { useRef, useState } from 'react';
import { CAST, firstOf, type CastId } from '~/features/notes/cast';
import { SceneDock, SceneFrame, SceneHead, box, type Rect } from './parts';

const PEOPLE: CastId[] = ['theo', 'priya', 'kofi', 'maya', 'lena', 'diego'];
const ROOMS = [
  { name: 'Room 1 · Pricing', bar: 'linear-gradient(90deg, var(--dawn-2), var(--dawn-3))', x: 24 },
  { name: 'Room 2 · Launch', bar: 'linear-gradient(90deg, var(--dawn-3), var(--dawn-4))', x: 600 }
] as const;
const together = (i: number): Rect => [24 + (i % 3) * 382, 72 + Math.floor(i / 3) * 222, 370, 210];
const apart = (i: number): Rect => [(i < 3 ? 24 : 600) + 16 + (i % 3) * 178, 140, 166, 348];
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

interface State { phase: 'main' | 'panel' | 'split'; speaking: CastId[]; left: number; banner: boolean; toast: boolean; dock: number; open: number }
const START: State = { phase: 'main', speaking: ['theo'], left: 600, banner: false, toast: false, dock: 0, open: 0 };

export function RoomsScene() {
  const reduce = useReducedMotion() ?? false;
  const stage = useRef<HTMLDivElement>(null);
  const [s, setS] = useState<State>(START);
  const set = (p: Partial<State>) => setS((x) => ({ ...x, ...p }));
  useSceneLoop(stage, async (c) => {
    const count = (from: number, to: number, seconds: number) => c.wait(animate(from, to, { duration: seconds, ease: 'linear', onUpdate: (v) => set({ left: Math.round(v) }) }));
    for (;;) {
      await c.sleep(2200);
      setS((x) => ({ ...x, dock: x.dock + 1, phase: 'panel' }));
      await c.sleep(1800);
      setS((x) => ({ ...x, open: x.open + 1 }));
      await c.sleep(300);
      set({ phase: 'split', speaking: [] });
      await c.sleep(1500);
      set({ speaking: ['priya', 'lena'] });
      await count(600, 120, 2.6);
      set({ banner: true, speaking: ['kofi', 'lena'] });
      await c.sleep(2600);
      set({ banner: false });
      await count(120, 0, 1.4);
      set({ speaking: [], phase: 'main' });
      await c.sleep(1200);
      set({ toast: true, speaking: ['theo'] });
      await c.sleep(2600);
      set({ toast: false, left: 600 });
    }
  }, !reduce);

  const split = s.phase === 'split';
  return (
    <SceneFrame>
      <Fit width={1180} height={600} stageRef={stage} label="Six people splitting into two breakout rooms with a shared timer, then returning">
        <div className="lp-scene">
          <SceneHead title="Product all-hands" time="6 people" />
          {ROOMS.map((r, i) => (
            <motion.div key={r.name} className="lp-room" style={box([r.x, 72, 556, 432])} initial={false}
              animate={split ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.97 }}
              transition={split ? { duration: 0.9, delay: 0.15 + i * 0.1, ease: EASE.expo } : { duration: 0.7, delay: 0.2, ease: EASE.inOut }}>
              <div className="bar" style={{ background: r.bar }} />
              <div className="h"><b>{r.name}</b><span>3 people</span><span className="ac-time">{clock(s.left)}</span><NotesSign stage>Notes</NotesSign></div>
            </motion.div>
          ))}
          {PEOPLE.map((id, i) => (
            <motion.div key={id} className="lp-tile" initial={false} animate={{ ...box(split ? apart(i) : together(i)), opacity: s.phase === 'panel' ? 0.45 : 1 }}
              transition={{ duration: 1.2, delay: i * (split ? 0.06 : 0.05), ease: EASE.inOut, opacity: { duration: 0.5 } }}>
              <CallTile person={CAST[id]} name={firstOf(id)} speaking={s.speaking.includes(id)} />
            </motion.div>
          ))}
          <motion.div className="lp-panel" style={{ left: 430, top: 228 }} initial={false}
            animate={s.phase === 'panel' ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 16, scale: 0.98 }}
            transition={s.phase === 'panel' ? { duration: 0.7, ease: EASE.expo } : { duration: 0.45, ease: EASE.in }}>
            <h4>Breakout rooms</h4>
            <div className="r">Rooms<b>2</b></div><div className="r">Length<b>10 min</b></div><div className="r">People<b>Shuffled</b></div>
            <motion.div key={s.open} initial={{ scale: 1 }} animate={s.open ? { scale: [1, 0.95, 1] } : { scale: 1 }} transition={{ duration: 0.24 }}>
              <Button variant="primary" size="sm" tabIndex={-1}>Open rooms</Button>
            </motion.div>
          </motion.div>
          <AnimatePresence>
            {s.banner && (
              <motion.div className="lp-banner" style={{ top: 20, x: '-50%' }} initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10, transition: { duration: 0.5, ease: EASE.in } }} transition={{ duration: 0.7, ease: EASE.expo }}>
                <Avatar person={CAST.theo} size={22} /><span><b>Theo</b> to all rooms: two minutes left. Add anything to your notes.</span>
              </motion.div>
            )}
            {s.toast && (
              <motion.div className="ac-toast" style={{ bottom: 96, x: '-50%' }} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10, transition: { duration: 0.5, ease: EASE.in } }} transition={{ duration: 0.7, ease: EASE.expo }}>
                <Icon name="check" size={18} /><span>Notes from 2 rooms added to the call’s notes</span>
              </motion.div>
            )}
          </AnimatePresence>
          <SceneDock on="rooms" press={s.dock} />
        </div>
      </Fit>
    </SceneFrame>
  );
}
