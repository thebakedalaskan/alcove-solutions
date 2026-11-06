/*
 * What Alcove can see: one note, as you see it and as Alcove's servers hold it, in a window on the recorder's night water
 * (welcome-night.css, `lp-pv`). The switch turns each part of the note into the sealed record that's all the servers have
 * of it, its letters scrambling for a moment as it turns. When it first comes well into view it turns to Alcove's view and
 * back once, unless someone has pressed the switch first. With reduced motion it waits to be pressed, and nothing scrambles.
 */
import { Faces, Icon, SealedBadge, Segmented, cn, useSceneLoop, type Choice } from '@alcove/ui';
import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { CAST } from '~/features/notes/cast';
import { HELD } from './night';

type View = 'you' | 'alcove';
const VIEWS: Choice<View>[] = [{ value: 'you', label: 'What you see' }, { value: 'alcove', label: 'What Alcove sees' }];
const HEX = '0123456789abcdef';
const recordOf = (sealed: string) => `sealed · ${sealed}`;
/** The scramble settles this many letters a beat, a beat this long, until the longest record has settled. */
const PER_BEAT = 3;
const BEAT_MS = 28;
const BEATS = Math.ceil(Math.max(...HELD.map((h) => recordOf(h.sealed).length)) / PER_BEAT);

/** A letter of noise: the same for the same row, place and beat, so drawing it twice draws the same thing. */
function noise(row: number, i: number, beat: number): string {
  let h = Math.imul(row + 1, 2246822519) + Math.imul(i + 1, 374761393) + Math.imul(beat + 1, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return HEX[(h ^ (h >>> 16)) & 15] ?? '0';
}

/** Row `row`'s `text`, with its first `beats` beats of letters settled and the rest still noise. */
function scrambled(row: number, text: string, beats: number): string {
  if (beats >= BEATS) return text;
  return Array.from(text, (ch, i) => (i < beats * PER_BEAT || ch === ' ' || ch === '·' ? ch : noise(row, i, beats))).join('');
}

export function SealedScene() {
  const reduce = useReducedMotion() ?? false;
  const [view, setView] = useState<View>('you');
  const [beats, setBeats] = useState(BEATS);
  const [near, setNear] = useState(false);
  const win = useRef<HTMLDivElement>(null);
  const touched = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopScramble = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  const show = (v: View) => {
    setView(v);
    stopScramble();
    if (v === 'you' || reduce) { setBeats(BEATS); return; }
    let beat = 0;
    setBeats(0);
    timer.current = setInterval(() => {
      beat += 1;
      setBeats(beat);
      if (beat >= BEATS) stopScramble();
    }, BEAT_MS);
  };
  useEffect(() => stopScramble, []);

  /* It turns once it's well in view, not as soon as its top edge is. */
  useEffect(() => {
    const el = win.current;
    if (reduce || !el) return undefined;
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { setNear(true); io.disconnect(); } }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, [reduce]);

  useSceneLoop(win, async (c) => {
    await c.sleep(1600);
    if (touched.current) return;
    show('alcove');
    await c.sleep(4200);
    if (touched.current) return;
    show('you');
  }, near && !reduce);

  const sealed = view === 'alcove';
  return (
    <div ref={win} className={cn('lp-pv', sealed && 'is-sealed')}>
      <div className="lp-pv-top">
        <Segmented value={view} onChange={(v) => { touched.current = true; show(v); }} options={VIEWS} label="Whose view of the note" />
        <span className="lp-pv-say">{sealed ? 'Sealed records, a size and a time' : 'The note, opened for you'}</span>
      </div>
      <dl className="lp-pv-rows">
        {HELD.map((h, row) => (
          <div key={h.label} className="lp-pv-row">
            <dt>{h.label}</dt>
            <dd>
              <span className="plain" aria-hidden={sealed || undefined}>
                {h.people
                  ? <><span aria-hidden="true"><Faces people={h.people.map((id) => CAST[id])} size={22} /></span><span className="sr-only">{h.plain}</span></>
                  : h.plain}
              </span>
              <span className="sealed" aria-hidden={!sealed || undefined}><Icon name="lock" size={14} /><span>{scrambled(row, recordOf(h.sealed), beats)}</span></span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="lp-pv-foot"><SealedBadge inline title="Confidential compute · hardware verified 11:58" /></p>
    </div>
  );
}
