/* Privacy: sealed audio travels from your device to confidential compute, which is checked first; sealed notes go to the people invited. */
import { Avatar, EASE, Fit, Icon, useSceneLoop } from '@alcove/ui';
import { motion, useReducedMotion } from 'motion/react';
import { useMemo, useRef, useState } from 'react';
import { CAST, firstOf, type CastId } from '~/features/notes/cast';
import { SceneFrame } from './parts';

const TO: CastId[] = ['theo', 'priya', 'kofi'];
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** What the servers hold: sealed bytes, drawn as a stable run of base64 (illustration). */
function sealedText(): string {
  let seed = 7, out = '';
  for (let i = 0; i < 400; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    out += (B64[(seed >>> 16) % 64] ?? 'A') + (i % 6 === 5 ? ' ' : '');
  }
  return out;
}

type Phase = 'rest' | 'in' | 'scan' | 'ok' | 'out' | 'sent';
const at = (p: Phase, ...ps: Phase[]) => ps.includes(p);

function Packet({ from, to, delay, duration }: { from: readonly [number, number]; to: readonly [number, number]; delay: number; duration: number }) {
  return (
    <motion.span className="lp-pk" initial={{ left: from[0], top: from[1], opacity: 0 }} animate={{ left: [from[0], to[0]], top: [from[1], to[1]], opacity: [0, 1, 1, 0] }}
      transition={{ left: { duration, delay, ease: EASE.inOut }, top: { duration, delay, ease: EASE.inOut }, opacity: { duration, delay, times: [0, 0.15, 0.85, 1] } }} />
  );
}

export function PrivacyScene() {
  const reduce = useReducedMotion() ?? false;
  const stage = useRef<HTMLDivElement>(null);
  const blob = useMemo(sealedText, []);
  const [s, setS] = useState<{ phase: Phase; run: number }>({ phase: 'rest', run: 0 });
  const go = (phase: Phase) => setS((x) => ({ phase, run: phase === 'in' ? x.run + 1 : x.run }));
  useSceneLoop(stage, async (c) => {
    for (;;) {
      go('in'); await c.sleep(1300);
      go('scan'); await c.sleep(1100);
      go('ok'); await c.sleep(600);
      go('out'); await c.sleep(1300);
      go('sent'); await c.sleep(2600);
    }
  }, !reduce);
  const ok = at(s.phase, 'rest', 'ok', 'out', 'sent');
  return (
    <SceneFrame>
      <Fit width={1180} height={440} stageRef={stage} label="Sealed audio travels from your device to confidential compute, then sealed notes go to the people you invited">
        <div className="lp-scene">
          <div className="lp-node" style={{ left: 110, top: 60 }}>
            <div className="lp-dev"><Icon name="mic" size={30} /></div>
            <p className="lbl">Your device</p><p className="sub">Speech is encrypted before it leaves.</p>
          </div>
          <div className="lp-node" style={{ left: 470, top: 34 }}>
            <div className="lp-encl">
              <motion.span key={`scan-${s.run}`} className="scan" initial={{ top: -40 }} animate={{ top: at(s.phase, 'scan', 'ok', 'out', 'sent') ? 180 : -40 }} transition={{ duration: 1.1, ease: EASE.inOut }} />
              <motion.span className="ok" initial={false} animate={{ scale: ok ? 1 : 0 }} transition={ok ? { duration: 0.6, ease: [0.34, 1.8, 0.64, 1] } : { duration: 0 }}><Icon name="check" size={22} /></motion.span>
            </div>
            <p className="lbl">Confidential compute</p><p className="sub">Checked before it gets anything. The AI works only here.</p>
          </div>
          <div className="lp-node" style={{ left: 830, top: 48 }}>
            <div className="grid w-full gap-2">
              {TO.map((id, k) => (
                <motion.div key={`${id}-${s.run}`} className="lp-to" initial={{ x: 0 }} animate={s.phase === 'sent' ? { x: [0, 4, 0] } : { x: 0 }} transition={{ duration: 0.36, delay: k * 0.12, ease: EASE.inOut }}>
                  <Avatar person={CAST[id]} size={24} />{firstOf(id)}<Icon name="lock" size={15} />
                </motion.div>
              ))}
            </div>
            <p className="lbl mt-1.5">The people you invited</p><p className="sub">Each gets the notes sealed to their own account.</p>
          </div>
          <div className="lp-track" style={{ left: 300, top: 118, width: 200 }} />
          <div className="lp-track" style={{ left: 680, top: 118, width: 190 }} />
          {at(s.phase, 'in', 'scan') && [0, 0.25, 0.5].map((d) => <Packet key={`in-${s.run}-${d}`} from={[305, 118]} to={[525, 118]} delay={d} duration={1.1} />)}
          {at(s.phase, 'out', 'sent') && [0, 1, 2].map((k) => <Packet key={`out-${s.run}-${k}`} from={[695, 118]} to={[873, 61 + k * 34]} delay={k * 0.15} duration={1} />)}
          <div className="lp-srv">
            <span className="k"><Icon name="server" size={16} />Alcove’s servers</span>
            <span className="blob">
              <motion.span animate={reduce ? {} : { x: ['0%', '-50%'] }} transition={{ duration: 40, ease: 'linear', repeat: Infinity }}>{blob} {blob}</motion.span>
            </span>
          </div>
        </div>
      </Fit>
    </SceneFrame>
  );
}
