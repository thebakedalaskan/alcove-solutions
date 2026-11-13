/*
 * The call as a line, under its stage: play and where it's got to, then the line itself, its chapters as lengths with the one
 * you're in named above it, what was decided as rose diamonds on it (hollow until someone confirms it), follow-ups as blue
 * dots under it, a screen that was shared as a tinted length, stretches nothing was captured in as a pause, and the sun where
 * the recording has got to; then how long it is, its speed (a menu of speeds to pick from), the captions and full screen.
 * Pressing or dragging along it, or pressing a mark, moves the sun there, playing on if it was. While the call is still
 * being recorded, the line ends where it has got to, in the colour of recording. A call that kept no recording has the line
 * and no player.
 */
import type { CaptureGap, Chapter, NoteAction, NoteDecision, ScreenShare } from '@alcove/api';
import { Icon, IconButton, Select, Spinner, cn, type SelectOption } from '@alcove/ui';
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { gapLabel } from '~/lib/capture';
import { position } from '~/lib/time';
import { RATES, usePlayerAt, type PlayerState } from './Player';

/** The speeds, as the menu lists them: "0.75×", "1×" … "2×". */
const SPEEDS: SelectOption<string>[] = RATES.map((r) => ({ value: String(r), label: `${r}×` }));

/** Where something is on the line, as a share of it. */
const share = (at: number, span: number) => (span > 0 ? Math.max(0, Math.min(1, at / span)) : 0);
const percent = (n: number) => `${(n * 100).toFixed(3)}%`;

export interface Mark { id: string; kind: 'decide' | 'follow'; open: boolean; at: number; text: string }
const KIND: Record<Mark['kind'], string> = { decide: 'Decision', follow: 'Follow-up' };

/** What goes on the line: decisions, unless someone said they weren't, and follow-ups, each where it was said. Hollow until people have said so. */
export const marksOf = (decisions: readonly NoteDecision[], actions: readonly NoteAction[]): Mark[] => [
  ...decisions.flatMap((d): Mark[] => (d.at === undefined || d.state === 'rejected' ? [] : [{ id: d.id, kind: 'decide', open: d.state !== 'confirmed', at: d.at, text: d.text }])),
  ...actions.flatMap((a): Mark[] => (a.at === undefined ? [] : [{ id: a.id, kind: 'follow', open: !a.takenOn, at: a.at, text: a.text }]))
];

/** The line has room for so many: up to `max`, decisions first, none closer than `gap` of the line to another of its kind. The rest are in the notes. */
function fewMarks(marks: readonly Mark[], span: number, max = 12, gap = 0.02): Mark[] {
  const byTime = (a: Mark, b: Mark) => a.at - b.at;
  const shown: Mark[] = [];
  for (const m of [...marks.filter((x) => x.kind === 'decide').sort(byTime), ...marks.filter((x) => x.kind === 'follow').sort(byTime)]) {
    if (shown.length >= max) break;
    if (!shown.some((s) => s.kind === m.kind && Math.abs(s.at - m.at) < gap * span)) shown.push(m);
  }
  return shown.sort(byTime);
}

/** A share's length, in words: "2 min 30 s". */
export const lengthOf = (seconds: number): string => {
  const s = Math.max(1, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return [m ? `${m} min` : '', r ? `${r} s` : ''].filter(Boolean).join(' ');
};

export interface CallLineProps {
  player: PlayerState;
  /** How long the line stands for, in seconds. */
  span: number;
  chapters: readonly Chapter[];
  marks: readonly Mark[];
  shares: readonly ScreenShare[];
  gaps: readonly CaptureGap[];
  /** Where the call is, for a note with no recording to play. */
  here: number;
  /** The call is still being recorded: how far it's got, in seconds, which is where the line ends. */
  edge?: number | undefined;
  /** Moves the sun along the line, playing on if it was. */
  onScrub?: ((at: number) => void) | undefined;
  /** Captions on the stage, when there's anything to caption. */
  captions?: { on: boolean; toggle: () => void } | undefined;
  /** Full screen, where the browser allows it. */
  full?: { on: boolean; toggle: () => void } | undefined;
}

/** The call, as a line under its stage. */
export function CallLine({ player, span, chapters, marks, shares, gaps, here, edge, onScrub, captions, full }: CallLineProps) {
  const hasAudio = player.total > 0;
  const live = edge !== undefined;
  const end = edge ?? span;
  // Whole seconds are all that's shown, so nothing is drawn more often than that.
  const heard = usePlayerAt(player, (p) => Math.round(p));
  const pos = hasAudio ? heard : here;
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const [ghost, setGhost] = useState<number | null>(null);
  const atPointer = (e: PointerEvent<HTMLElement>) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return 0;
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * span;
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (!onScrub || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    setDrag(true);
    onScrub(Math.min(end, atPointer(e)));
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const at = Math.min(end, atPointer(e));
    setGhost(at);
    if (drag && onScrub) onScrub(at);
  };
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    // Space plays and pauses, as it does anywhere on the page, rather than press the line at no place on it.
    if (e.key === ' ' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (!e.repeat && hasAudio) player.toggle();
      return;
    }
    const by: Record<string, number> = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -30, PageUp: 30 };
    const step = by[e.key];
    const to = step !== undefined ? pos + step : e.key === 'Home' ? 0 : e.key === 'End' ? end : undefined;
    if (to === undefined || !onScrub) return;
    e.preventDefault();
    onScrub(Math.max(0, Math.min(end, to)));
  };
  const p = share(pos, span);
  const parts = chapters.length ? chapters : [{ at: 0, title: '', summary: '' }];
  const current = Math.max(0, parts.findLastIndex((c) => c.at <= pos));
  const now = parts[current];
  const shown = useMemo(() => fewMarks(marks, span), [marks, span]);
  /* In full screen only the player shows, so the speeds open inside it. */
  const fullScreen = full?.on ? document.fullscreenElement : null;
  return (
    <div className={cn('cd-line', !hasAudio && 'is-silent', live && 'is-live')} style={{ '--p': percent(p), '--edge': percent(share(end, span)) }}>
      {hasAudio && (
        <button type="button" className="cd-play" aria-label={player.playing ? 'Pause' : 'Play'} title={player.playing ? 'Pause' : 'Play'} aria-keyshortcuts="Space" aria-busy={player.busy} onClick={player.toggle}>
          {player.busy ? <Spinner /> : <Icon name={player.playing ? 'pause' : 'play'} size={15} />}
        </button>
      )}
      <span className="cd-t">{position(pos)}</span>
      <div className="cd-track">
        {now?.title && <span className={cn('cd-seg-l', share(now.at, span) > 0.62 && 'is-r')} style={share(now.at, span) > 0.62 ? undefined : { left: percent(share(now.at, span)) }}>{now.title}</span>}
        <div ref={track} className={cn('cd-rail', onScrub && 'is-live-scrub')} role="slider" tabIndex={onScrub ? 0 : -1} aria-label="Position in the call" aria-valuemin={0} aria-valuemax={Math.round(end)}
          aria-valuenow={Math.round(pos)} aria-valuetext={position(pos)} onPointerDown={down} onPointerMove={move} onPointerLeave={() => setGhost(null)}
          onPointerUp={() => setDrag(false)} onPointerCancel={() => setDrag(false)} onKeyDown={keys}>
          {parts.map((c, i) => {
            const next = parts[i + 1]?.at ?? span;
            const from = share(c.at, span);
            const width = share(next, span) - from;
            const fill = pos >= next ? 1 : pos <= c.at ? 0 : (pos - c.at) / Math.max(1, next - c.at);
            return <span key={`${c.at}-${c.title}`} className={cn('cd-seg', fill >= 1 && 'is-past', fill > 0 && fill < 1 && 'is-now')} style={{ left: percent(from), width: `calc(${percent(width)} - 4px)`, '--f': percent(fill) }} title={c.title || undefined} />;
          })}
          {shares.map((s) => (
            <span key={s.id} className="cd-shr" style={{ left: percent(share(s.at, span)), width: percent(share(s.until, span) - share(s.at, span)) }} title={`${s.label}, from ${position(s.at)}, ${lengthOf(s.until - s.at)}`}>
              <Icon name="monitor" size={11} />
            </span>
          ))}
          {gaps.map((g) => <span key={`${g.kind}-${g.from}`} className="cd-gap" style={{ left: percent(share(g.at, span)) }} title={`${gapLabel(g)}. Nothing was recorded`}><Icon name="pause" size={9} /></span>)}
          {live && <i className="cd-edge" />}
          {(hasAudio || pos > 0) && <i className="cd-sun" />}
          {ghost !== null && onScrub && <span className="cd-ghost" style={{ left: percent(share(ghost, span)) }} aria-hidden="true"><b>{position(ghost)}</b></span>}
        </div>
        {shown.map((m) => {
          const label = `${KIND[m.kind]} at ${position(m.at)}: ${m.text}`;
          const cls = cn('cd-mk', m.kind === 'decide' ? 'is-dec' : 'is-fu', m.open && 'is-open');
          return onScrub
            ? <button key={m.id} type="button" className={cls} style={{ left: percent(share(m.at, span)) }} aria-label={label} title={label} onClick={() => onScrub(m.at)} />
            : <span key={m.id} className={cls} style={{ left: percent(share(m.at, span)) }} title={label} />;
        })}
      </div>
      <span className="cd-end" title={hasAudio ? 'The recording is encrypted. Only the people who have these notes can play it.' : undefined}>{position(end)}</span>
      <span className="cd-ctl">
        {hasAudio && <Select value={String(player.rate)} onChange={(r) => player.setRate(Number(r))} options={SPEEDS} label="Speed" align="end" container={fullScreen} className="cd-speed" />}
        {captions && <IconButton icon="captions" label={captions.on ? 'Hide captions' : 'Show captions'} size={17} on={captions.on} aria-pressed={captions.on} onClick={captions.toggle} />}
        {full && <IconButton icon={full.on ? 'shrink' : 'grow'} label={full.on ? 'Leave full screen' : 'Full screen'} size={17} onClick={full.toggle} />}
      </span>
    </div>
  );
}
