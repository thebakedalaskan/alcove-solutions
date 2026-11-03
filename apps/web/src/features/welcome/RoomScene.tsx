/*
 * In the room: a phone with no connection records a session, sealed as it's captured. Back online,
 * it sends the sealed recording and the session notes write themselves, for the clinician alone.
 */
import { Chip, EASE, Fit, Icon, NotesPanel, NotesSign, Reveal, SealedBadge, cn, useSceneLoop } from '@alcove/ui';
import { AnimatePresence, animate, motion, useAnimationFrame, useReducedMotion } from 'motion/react';
import { useRef, useState, type ReactNode } from 'react';
import { WriteIn, words } from './parts';

const SOAP = [
  ['Subjective', 'Sleep has improved since starting the wind-down routine. Work stress still peaks on Sunday evenings.'],
  ['Objective', 'Engaged and reflective. Calmer speech than in the last session.'],
  ['Assessment', 'Good progress on the sleep goal. Worry about the week ahead remains the main theme.'],
  ['Plan', 'Keep the routine. Try the Sunday planning exercise. Next session in two weeks.']
] as const;
const BARS = Array.from({ length: 30 }, (_, i) => i);
const resting = (i: number) => 0.15 + 0.7 * Math.abs(Math.sin(i * 1.7));
const settled = (i: number) => 0.18 + 0.45 * Math.abs(Math.sin(i * 0.62));
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const MSG = { offline: 'Notes will be written when you’re back online.', sending: 'Sending the sealed recording…', writing: 'Writing your notes in confidential compute.', ready: 'Session notes are ready. Only you can read them.' } as const;

interface State {
  run: number; secs: number; live: boolean; saved: boolean; online: boolean; card: boolean; sent: boolean;
  msg: keyof typeof MSG; writing: boolean;
  /** How many sections of the notes are written; -1 shows them all, as they are. */
  written: number; stop: number;
}
const START: State = { run: 0, secs: 3012, live: false, saved: false, online: false, card: false, sent: false, msg: 'offline', writing: false, written: -1, stop: 0 };

/** The phone on one side; `copy` and the session notes on the other. */
export function RoomScene({ copy }: { copy: ReactNode }) {
  const reduce = useReducedMotion() ?? false;
  const stage = useRef<HTMLDivElement>(null);
  const bars = useRef<(HTMLElement | null)[]>([]);
  const [s, setS] = useState<State>(START);
  const set = (p: Partial<State>) => setS((x) => ({ ...x, ...p }));

  useAnimationFrame((t) => {
    if (!s.live) return;
    const k = t / 1000;
    bars.current.forEach((b, i) => { if (b) b.style.transform = `scaleY(${0.12 + 0.8 * Math.abs(Math.sin(k * 3.1 + i * 0.55) * Math.sin(k * 1.7 + i * 0.23))})`; });
  });

  useSceneLoop(stage, async (c) => {
    for (;;) {
      setS((x) => ({ ...START, run: x.run + 1, stop: x.stop, secs: 0, written: 0 }));
      await c.sleep(500);
      set({ live: true });
      await c.wait(animate(0, 3012, { duration: 4.2, ease: 'easeInOut', onUpdate: (v) => set({ secs: Math.round(v) }) }));
      await c.sleep(300);
      setS((x) => ({ ...x, stop: x.stop + 1, live: false, saved: true, card: true }));
      await c.sleep(2200);
      set({ online: true, msg: 'sending', sent: true });
      await c.sleep(1600);
      set({ msg: 'writing', writing: true });
      for (let i = 1; i <= SOAP.length; i++) {
        set({ written: i });
        await c.sleep(words(SOAP[i - 1]?.[1] ?? '').length * 30 + 550);
      }
      set({ writing: false, msg: 'ready' });
      await c.sleep(4200);
    }
  }, !reduce);

  return (
    <div className="lp-solo">
      <Reveal lift className="phone-col">
        <Fit width={320} height={660} stageRef={stage} className="lp-phone-fit" label="A phone in airplane mode recording a session, then sending it sealed when it's back online">
          <div className="lp-phone dark">
            <div className="scr">
              <div className="isl" />
              <div className="st">
                <span>14:52</span>
                <span className="flex items-center gap-1.5">
                  <span className="ic">
                    <motion.span initial={false} animate={{ opacity: s.online ? 0 : 1, scale: s.online ? 0.6 : 1 }} transition={{ duration: 0.4 }}><Icon name="plane" size={16} /></motion.span>
                    <motion.span initial={false} animate={{ opacity: s.online ? 1 : 0, scale: s.online ? 1 : 0.6 }} transition={{ duration: 0.5, delay: s.online ? 0.2 : 0, ease: [0.34, 1.56, 0.64, 1] }}><Icon name="wifi" size={16} /></motion.span>
                  </span>
                  <span className="batt"><i /></span>
                </span>
              </div>
              <div className="body">
                <NotesSign stage requested={s.saved}>{s.saved ? 'Saved' : 'Recording in the room'}</NotesSign>
                <p className="who">Session with J.R.</p>
                <p className="sub">Tuesday 3 November</p>
                <p className="time">{mmss(s.secs)}</p>
                <div className={cn('wave', s.live && 'is-live')}>
                  {BARS.map((i) => <i key={i} ref={(el) => { bars.current[i] = el; }} style={s.live ? undefined : { transform: `scaleY(${s.saved ? settled(i) : resting(i)})` }} />)}
                </div>
                <p className="state"><Icon name="lock" size={15} /><span>{s.online ? 'Back online' : 'Offline · encrypted on this phone'}</span></p>
              </div>
              <motion.div className="ctrl" initial={false} animate={s.card ? { opacity: 0, y: 20 } : { opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE.in }}>
                <span className="btn"><Icon name="pause" size={20} /></span>
                <motion.span key={s.stop} className="stop" initial={{ scale: 1 }} animate={s.stop ? { scale: [1, 0.88, 1] } : { scale: 1 }} transition={{ duration: 0.3 }}><i /></motion.span>
                <span className="btn"><Icon name="notes" size={20} /></span>
              </motion.div>
              <motion.div className="card" initial={false} animate={s.card ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }} transition={{ duration: 0.8, delay: s.card ? 0.2 : 0, ease: EASE.expo }}>
                <div className="f"><span className="d"><Icon name="lock" size={18} /></span><span><b>Session · 50 min</b><small>{s.msg === 'writing' || s.msg === 'ready' ? 'sent sealed' : 'sealed on this phone'}</small></span></div>
                <p className="msg">{MSG[s.msg]}</p>
                <div className="prog"><motion.b initial={false} animate={{ scaleX: s.sent ? 1 : 0 }} transition={{ duration: s.sent ? 1.6 : 0, ease: EASE.inOut }} /></div>
              </motion.div>
            </div>
          </div>
        </Fit>
      </Reveal>
      <div>
        {copy}
        <Reveal lift className="lp-sess">
          <AnimatePresence>
            {s.writing && (
              <motion.span className="writing" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.5, ease: EASE.out }}>
                <Chip tone="sun" icon="sealed">Writing in confidential compute</Chip>
              </motion.span>
            )}
          </AnimatePresence>
          <NotesPanel title="Session notes · J.R." meta="Tue 3 Nov · 14:00 · 50 min · Only you" end={<Chip>SOAP</Chip>}
            foot={<SealedBadge inline title="Only you can read these notes" />}>
            <dl className="lp-soap">
              {SOAP.map(([k, v], i) => (
                <div key={k} className="contents">
                  <dt className="ac-eyebrow">{k}</dt>
                  {s.written === -1 || s.written > i
                    ? <dd key={`${s.run}-${i}`}><WriteIn chunks={words(v)} step={0.03} blur={4} still={s.written === -1} /></dd>
                    : <dd className="is-dim">{v}</dd>}
                </div>
              ))}
            </dl>
          </NotesPanel>
        </Reveal>
      </div>
    </div>
  );
}
