/*
 * The recorder in the night scene, on Record and on the stage. It stands on the horizon where the sun would: a dark disc with
 * the last of the light around its rim, full of colour only while it records. Its reflection on the water is the voice, each
 * row one moment, the newest at the horizon and the older ones further out. What moves them is the microphone (useVoice),
 * which changes a few CSS variables and never redraws anything.
 */
import { useReducedMotion } from 'motion/react';
import { forwardRef, useEffect, useRef, type RefObject } from 'react';

/** idle: dark. check: a lit rim, while the level is checked. live: full of colour. paused: dark again. set: sinking, while it finishes. */
export type OrbState = 'idle' | 'check' | 'live' | 'paused' | 'set';
/** idle and still: moonlight on calm water, on Record and on the stage. level: the check's reflection. live: the voice, in the orb's colour. */
export type VoiceKind = 'idle' | 'level' | 'live' | 'still';

interface VoiceBit { left: string; width: string; every: string; after: string }
interface VoiceRow { top: number; w: number; a: number; o: number; t: number; bits: VoiceBit[] }

function seeded(seed: number): () => number {
  let n = seed;
  return () => { n = (n * 16807) % 2147483647; return (n - 1) / 2147483646; };
}

/** How loud the rows start, before the microphone has filled them: the shape of someone talking. */
function speech(i: number): number {
  const t = i * 0.42;
  const v = Math.pow(Math.abs(Math.sin(t * 2.3)), 1.4) * (0.62 + 0.38 * Math.sin(t * 0.77 + 1.1)) + 0.28 * Math.abs(Math.sin(t * 5.1 + 0.6));
  return Math.max(0.08, Math.min(1, v));
}

function drawVoice(kind: VoiceKind): VoiceRow[] {
  const span = kind === 'idle' || kind === 'level' ? 76 : 148;
  const calm = kind === 'idle' || kind === 'still';
  const r = seeded(7);
  const beat = seeded(11);
  const rows: VoiceRow[] = [];
  for (let y = 7, i = 0; y < span; y += 8, i++) {
    const far = y / span;
    const w = calm ? 300 : (span > 100 ? 190 : 150) + far * 120;
    const n = 1 + Math.round(r() * (calm ? 1 : 2));
    const bits: VoiceBit[] = [];
    let x = 2 + r() * 8;
    for (let k = 0; k < n; k++) {
      let width: number;
      let left: number;
      if (calm) {
        /* Still water: short dashes close to the middle, a little wider further out, as under the sun on Home. */
        const spread = (kind === 'still' ? 7 : 12) + far * (kind === 'still' ? 14 : 34);
        width = ((6 + r() * (kind === 'still' ? 14 : 24)) * (0.8 + far)) / 3;
        left = 50 + ((r() - 0.5) * 2 * spread) / 3 - width / 2;
      } else {
        const room = 96 - x;
        width = room * (k === n - 1 ? 1 : 0.34 + r() * 0.3);
        left = x;
        x += width + 2 + r() * 5;
      }
      bits.push({ left: `${left.toFixed(1)}%`, width: `${width.toFixed(1)}%`, every: `${(34 + beat() * 22).toFixed(1)}s`, after: `${(-beat() * 56).toFixed(1)}s` });
    }
    rows.push({ top: y, w, a: calm ? 1 : (kind === 'level' ? 0.72 : 1) * speech(i + 3), o: 0.92 - far * 0.66, t: far, bits });
  }
  return rows;
}
const VOICES: Record<VoiceKind, VoiceRow[]> = { idle: drawVoice('idle'), level: drawVoice('level'), live: drawVoice('live'), still: drawVoice('still') };

/**
 * The recorder and its voice, placed on the horizon (`--hz`) of whatever holds them: `--orb` is its radius. It goes in place of
 * the scene's sun and glitter, which record.css hides. Pass its ref to useVoice for it to move with the microphone.
 */
export const RecorderSun = forwardRef<HTMLDivElement, { orb: OrbState; voice: VoiceKind }>(function RecorderSun({ orb, voice }, ref) {
  return (
    <div ref={ref} className="rec-sun" aria-hidden="true">
      <div className="rec-up">
        <div className="rec-at">
          <div className="rec-orb" data-on={orb}><i className="glow" /><i className="lit" /><i className="body" /><i className="fill"><b /></i><i className="rim" /><i className="rim is-hot" /></div>
        </div>
      </div>
      <div className="rec-at rec-voice" data-kind={voice}>
        <i className="rec-edge" />
        {VOICES[voice].map((row, i) => (
          <div key={`${voice}-${i}`} className="rec-v" style={{ top: row.top, '--w': `${row.w.toFixed(0)}px`, '--a': row.a.toFixed(3), '--o': row.o.toFixed(2), '--t': row.t.toFixed(2) }}>
            {row.bits.map((b) => <i key={b.left} style={{ left: b.left, width: b.width, '--every': b.every, '--after': b.after }} />)}
          </div>
        ))}
      </div>
    </div>
  );
});

/** Five bars that show how loud the microphone is. useVoice moves them. */
export const RecMeter = forwardRef<HTMLSpanElement>(function RecMeter(_, ref) {
  return <span ref={ref} className="rec-meter" aria-hidden="true"><i /><i /><i /><i /><i /></span>;
});

/** A recording's own print, for its row in a list: the same ID always draws the same bars. It's a mark, not its sound. */
export function RecPrint({ id }: { id: string }) {
  let n = 0;
  for (const c of id) n = (n * 31 + c.charCodeAt(0)) % 2147483646;
  const r = seeded(n + 1);
  return <span className="rec-print" aria-hidden="true">{Array.from({ length: 7 }, (_, i) => <i key={i} style={{ '--h': (0.24 + r() * 0.76).toFixed(2) }} />)}</span>;
}

/** How often the voice moves on a row. */
const EVERY_MS = 130;
/** The microphone's level as the eye reads it: speech sits well up the scale, and a quiet room stays just off the bottom. */
const heard = (level: number) => Math.max(0.05, Math.min(1, Math.sqrt(level) * 1.2));

/**
 * While `on`, moves `sun` and `meter` with `level` (the microphone, 0 to 1): the newest level at the horizon, moving out across
 * the water, and the orb rising and falling a little with it. `gain` shrinks the voice for a check. Only CSS variables change.
 * With reduced motion the scene stays a still picture and only the meter, which is how you read the level, moves.
 */
export function useVoice({ sun, meter, level, on, gain = 1 }: {
  sun: RefObject<HTMLElement | null>; meter?: RefObject<HTMLElement | null> | undefined; level: () => number; on: boolean; gain?: number | undefined;
}) {
  const reduce = useReducedMotion() ?? false;
  const read = useRef(level);
  read.current = level;
  useEffect(() => {
    if (!on) return undefined;
    const box = sun.current;
    const bars = Array.from(meter?.current?.querySelectorAll<HTMLElement>('i') ?? []);
    const orb = box?.querySelector<HTMLElement>('.rec-orb');
    const amps: number[] = [];
    const t = setInterval(() => {
      const lv = heard(read.current());
      bars.forEach((b, k) => b.style.setProperty('--m', lv * 5.4 > k ? '1' : '0.28'));
      if (reduce) return;
      const rows = box?.querySelectorAll<HTMLElement>('.rec-v') ?? [];
      amps.unshift(lv);
      amps.length = Math.min(amps.length, rows.length);
      amps.forEach((a, i) => rows[i]?.style.setProperty('--a', (a * gain).toFixed(3)));
      orb?.style.setProperty('--lv', lv.toFixed(3));
    }, EVERY_MS);
    return () => {
      clearInterval(t);
      bars.forEach((b) => b.style.removeProperty('--m'));
      orb?.style.removeProperty('--lv');
    };
  }, [sun, meter, on, gain, reduce]);
}
