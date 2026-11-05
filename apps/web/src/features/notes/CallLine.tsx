/*
 * The call, drawn on the horizon at the foot of a note's sky. Its chapters stand on the line, what was decided and what's
 * to do sit on it (solid once people have said so), the sun is where the recording has got to, and the light under the
 * line is what was said. It stays at the top of the page as the note is read, so the next jump is one press away. A call
 * that kept no recording has no player; one that kept nothing to go to has a line to look at and no more. While the call
 * is still being recorded, the line ends where it's got to, and what's there so far plays.
 */
import type { CaptureGap, Chapter, NoteAction, NoteDecision } from '@alcove/api';
import { Icon, Spinner, cn } from '@alcove/ui';
import { memo, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { gapLabel } from '~/lib/capture';
import { position } from '~/lib/time';
import { usePlayerAt, type PlayerState } from './Player';
import type { Glint } from './wave';

/** Where something is on the line, as a share of it. */
export const share = (at: number, span: number) => (span > 0 ? Math.max(0, Math.min(1, at / span)) : 0);
export const percent = (n: number) => `${(n * 100).toFixed(3)}%`;

export interface Mark { id: string; kind: 'decide' | 'follow'; open: boolean; at: number; text: string }
const KIND: Record<Mark['kind'], string> = { decide: 'Decision', follow: 'Follow-up' };

/** What goes on the line: decisions, unless someone said they weren't, and follow-ups, each where it was said. Hollow until people have said so. */
export const marksOf = (decisions: NoteDecision[], actions: NoteAction[]): Mark[] => [
  ...decisions.flatMap((d): Mark[] => (d.at === undefined || d.state === 'rejected' ? [] : [{ id: d.id, kind: 'decide', open: d.state !== 'confirmed', at: d.at, text: d.text }])),
  ...actions.flatMap((a): Mark[] => (a.at === undefined ? [] : [{ id: a.id, kind: 'follow', open: !a.takenOn, at: a.at, text: a.text }]))
];

/** The glints, which only change as the sun passes one. */
const Wave = memo(function Wave({ glints, lit }: { glints: Glint[]; lit: number }) {
  return (
    <div className="nd-wave" aria-hidden="true">
      {glints.map((g) => (
        <i key={`${g.x}-${g.top}`} className={cn('nd-g', g.x + g.w / 2 <= lit && 'is-lit')}
          style={{ left: `${g.x.toFixed(2)}%`, top: g.top, width: `${g.w.toFixed(2)}%`, '--o': g.o.toFixed(2), '--far': g.far.toFixed(2), '--every': `${g.every.toFixed(1)}s`, '--after': `${g.after.toFixed(1)}s` }} />
      ))}
    </div>
  );
});

/** A chapter of the call, standing on the line. */
function ChapterMark({ c, span, next, on, onGo }: { c: Chapter; span: number; next: number; on: boolean; onGo: ((c: Chapter) => void) | undefined }) {
  const x = share(c.at, span);
  const inner = <><span className="ac-clamp-1">{c.title}</span><span className="nd-tip nd-tip-ch"><b>{c.title}</b><small className="ac-time">{position(c.at)}</small>{c.summary && <span>{c.summary}</span>}</span></>;
  const cls = cn('nd-ch', on && 'is-on', x > 0.72 && 'is-r');
  const style = { '--x': percent(x), '--room': percent(share(next, span) - x) };
  return onGo
    ? <button type="button" className={cls} style={style} aria-label={`Chapter: ${c.title}, ${position(c.at)}`} onClick={() => onGo(c)}>{inner}</button>
    : <span className={cls} style={style}>{inner}</span>;
}

/** What was decided or is to do, on the line where it was said, saying what it is when pointed at. */
function MarkDot({ m, i, span, onGo }: { m: Mark; i: number; span: number; onGo: ((at: number) => void) | undefined }) {
  const x = share(m.at, span);
  const inner = <><i /><span className="nd-tip"><b>{KIND[m.kind]}</b><small className="ac-time">{position(m.at)}</small><span>{m.text}</span></span></>;
  const cls = cn('nd-m', `is-${m.kind}`, m.open && 'is-open', x < 0.12 && 'is-l', x > 0.86 && 'is-r');
  const style = { '--x': percent(x), '--i': i };
  return onGo
    ? <button type="button" className={cls} style={style} aria-label={`${KIND[m.kind]} at ${position(m.at)}: ${m.text}`} onClick={() => onGo(m.at)}>{inner}</button>
    : <span className={cls} style={style}>{inner}</span>;
}

/** A stretch nothing was captured in isn't in the recording, so it's a point on the line, saying when it was. */
function GapMark({ g, span }: { g: CaptureGap; span: number }) {
  const label = gapLabel(g);
  return <span className="nd-gap" style={{ '--x': percent(share(g.at, span)) }} role="note" aria-label={label} tabIndex={0}><Icon name="pause" size={10} /><span className="nd-tip"><b>{label}</b><span>Nothing was recorded</span></span></span>;
}

/**
 * The strip that stays at the top of the page, with its band of sky and water behind it once it has stuck: a call's line
 * on a note, and the calls of a series on its page.
 */
export function LineStrip({ className, label, children }: { className?: string | undefined; label: string; children: ReactNode }) {
  const mark = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = mark.current;
    if (!el) return;
    const seen = new IntersectionObserver(([e]) => { if (e) setStuck(!e.isIntersecting && e.boundingClientRect.top <= 8); }, { rootMargin: '-8px 0px 0px 0px' });
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  return (
    <>
      <div ref={mark} className="nd-hz-mark" aria-hidden="true" />
      <section className={cn('nd-hz', stuck && 'is-stuck', className)} aria-label={label} style={{ '--d': 1 }}>{children}</section>
    </>
  );
}

/** Pointing along what can be played, up to `end`, says when that is, without drawing the page again. */
function useGhost(end: number, span: number) {
  const ghost = useRef<HTMLSpanElement>(null);
  const label = useRef<HTMLElement>(null);
  const onMouseMove = (e: MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const at = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * end;
    if (ghost.current) ghost.current.style.left = percent(share(at, span));
    if (label.current) label.current.textContent = position(at);
  };
  return { ghost, label, onMouseMove };
}

export interface CallLineProps {
  player: PlayerState;
  /** How long the line stands for, in seconds. */
  span: number;
  chapters: Chapter[];
  marks: Mark[];
  gaps: CaptureGap[];
  glints: Glint[];
  /** Where someone last went, for a call with no recording to say so. */
  here?: number | undefined;
  /** The call is still being recorded: how far it's got, in seconds, which is where the line ends. */
  edge?: number | undefined;
  /** Nothing was said: still water. */
  still?: boolean | undefined;
  /** The marks have just arrived: the notes were written while the page was open. */
  fresh?: boolean | undefined;
  /** Goes to a moment, when there's anything to go to. */
  onGo?: ((at: number) => void) | undefined;
  /** Goes to a chapter, which may be more than a moment: a breakout room's. */
  onChapter?: ((c: Chapter) => void) | undefined;
  /** Under the line: that the call kept no recording. */
  children?: ReactNode;
}

/** The call on the horizon: the player when there's a recording, and the chapters and marks whether or not. */
export function CallLine({ player, span, chapters, marks, gaps, glints, here = 0, edge, still = false, fresh = false, onGo, onChapter, children }: CallLineProps) {
  const hasAudio = player.total > 0;
  const live = edge !== undefined;
  const end = edge ?? span;
  // Whole seconds are all that's shown, so nothing is drawn more often than that.
  const heard = usePlayerAt(player, (p) => Math.round(p));
  const pos = hasAudio ? heard : here;
  const ghost = useGhost(end, span);
  const seek = (e: MouseEvent<HTMLElement>) => {
    // Space and Enter press a button at no place on it: `keys` is what moves the sun from the keyboard.
    if (e.detail === 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    onGo?.(((e.clientX - r.left) / r.width) * end);
  };
  const keys = (e: KeyboardEvent<HTMLElement>) => {
    const to = e.key === 'ArrowRight' ? Math.min(end, pos + 10) : e.key === 'ArrowLeft' ? Math.max(0, pos - 10) : e.key === 'Home' ? 0 : e.key === 'End' ? end : undefined;
    if (to === undefined) return;
    e.preventDefault();
    onGo?.(to);
  };
  const p = share(pos, span);
  const current = Math.max(0, chapters.findLastIndex((c) => c.at <= pos));
  return (
    <LineStrip className={cn(!hasAudio && 'is-silent', !onGo && 'is-fixed', still && 'is-still', live && 'is-live', fresh && 'is-fresh')} label={live ? 'The call so far' : 'The call'}>
      <div className="nd-hz-in" style={{ '--p': percent(p), '--edge': percent(share(end, span)) }}>
        {hasAudio && <button type="button" className="nd-play" aria-label={player.playing ? 'Pause' : 'Play'} title={player.playing ? 'Pause' : 'Play'} aria-busy={player.busy} onClick={player.toggle}>{player.busy ? <Spinner /> : <Icon name={player.playing ? 'pause' : 'play'} size={16} />}</button>}
        {hasAudio && <span className="nd-now">{position(pos)}</span>}
        <div className="nd-track">
          {hasAudio && (
            <button type="button" className="nd-seek" role="slider" aria-label="Position in the recording" aria-valuemin={0} aria-valuemax={Math.round(end)} aria-valuenow={Math.round(pos)} aria-valuetext={position(pos)}
              onClick={seek} onKeyDown={keys} onMouseMove={ghost.onMouseMove} />
          )}
          <i className="nd-rail" /><i className="nd-lit" />
          {glints.length > 0 && <Wave glints={glints} lit={live ? 100 : Math.round(p * 300) / 3} />}
          {chapters.map((c, i) => <ChapterMark key={`${c.at}-${c.title}`} c={c} span={span} next={chapters[i + 1]?.at ?? span} on={i === current} onGo={onChapter} />)}
          {gaps.map((g) => <GapMark key={`${g.kind}-${g.from}`} g={g} span={span} />)}
          {marks.map((m, i) => <MarkDot key={m.id} m={m} i={i} span={span} onGo={onGo} />)}
          {live && <i className="nd-edge" />}
          {hasAudio && <><i className="nd-sun" /><span ref={ghost.ghost} className="nd-ghost" aria-hidden="true"><b ref={ghost.label} /></span></>}
        </div>
        {hasAudio && <span className="nd-end" title="The recording is encrypted. Only the people who have these notes can play it."><Icon name="lock" size={13} />{position(end)}</span>}
      </div>
      {children}
    </LineStrip>
  );
}
