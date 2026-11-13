/*
 * The week on the Calls page: what happened and what's ahead, hour by hour, Monday to Sunday with the weekend narrow, and
 * the same week while a call is being scheduled on it. It takes plain data (days, hours as numbers, blocks) and handlers;
 * what's in a week and what pressing it does are the app's. Styles in styles/flow.css (cw-).
 */
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '../cn';

/**
 * What a block is: a call that happened (with notes), an Alcove call ahead, a meeting from your calendar, an invitation
 * waiting for your answer, a time held until a guest picks, or a call just scheduled or moved.
 */
export type CallsWeekKind = 'past' | 'soon' | 'cal' | 'invite' | 'hold' | 'fresh';

export interface CallsWeekDay {
  /** "Mon" */
  weekday: string;
  /** The day of the month. */
  date: number;
  /** The whole day as it's said, "Thursday 5 November": what a screen reader hears. */
  label: string;
  today?: boolean | undefined;
  /** Saturday or Sunday: a narrow column, and outside the working day from start to end. */
  weekend?: boolean | undefined;
}

/** A stretch of one day: `day` is an index into `days`, and `start` and `end` hours from its midnight (9.5 is 09:30). */
export interface CallsWeekSpan { day: number; start: number; end: number }

export interface CallsWeekBlock extends CallsWeekSpan {
  id: string;
  title: string;
  kind: CallsWeekKind;
  /** What waits on you from it: a decision to confirm (a rose diamond) or a follow-up (a blue dot). */
  wait?: 'dec' | 'fu' | undefined;
}

/** When someone else is busy: hatched, never what it is. */
export type CallsWeekBusy = CallsWeekSpan;

/** A time that suits everyone, glowing; `ticked` when it's one of the times offered to a guest. */
export interface CallsWeekSuggestion extends CallsWeekSpan { ticked?: boolean | undefined }

/** What the key under the week names. */
export type CallsWeekKeyKind = CallsWeekKind | 'busy' | 'suggestion' | 'pick' | 'was';
export interface CallsWeekKeyItem { kind: CallsWeekKeyKind; label: string }

export interface CallsWeekProps {
  days: CallsWeekDay[];
  /** The hours shown, each line labelled: 08:00 to 19:00 unless they say otherwise. */
  from?: number | undefined;
  to?: number | undefined;
  blocks: CallsWeekBlock[];
  /** Now, as a day and an hour: the sun on a line. Null when now isn't in this week. */
  now?: { day: number; at: number } | null | undefined;
  /**
   * `browse` (the calls of the week, each pressed to open; a free time pressed or dragged across starts scheduling there),
   * or `schedule` (the week dimmed under the call being made, which is what pressing it places).
   */
  mode?: 'browse' | 'schedule' | undefined;
  /** Scheduling: the working day, in hours. Outside it is greyed, and the weekend all day. */
  work?: { from: number; to: number } | undefined;
  /** Scheduling: other people's busy times, hatched. The key says whose. */
  busy?: CallsWeekBusy[] | undefined;
  /** Scheduling: the times suggested, glowing. */
  suggestions?: CallsWeekSuggestion[] | undefined;
  /** Scheduling: the call being made, solid, with a grip to drag its end. `title` shows under its time when there's room. */
  pick?: (CallsWeekSpan & { title?: string | undefined }) | null | undefined;
  /** Moving a call: where it is now, dashed, with what it says ("Now 10:00"). */
  was?: (CallsWeekSpan & { label: string }) | null | undefined;
  /** How long the ghost under the pointer is, in hours: the length of the call being made. 45 minutes unless it says. */
  length?: number | undefined;
  /** What the ghost says of a time besides its hours: "All 3 free", "Kofi busy". Browse says "New call". */
  ghostNote?: ((day: number, start: number, end: number) => string) | undefined;
  /** A time that can't be picked: by default, whatever's before `now`. */
  isPast?: ((day: number, hour: number) => boolean) | undefined;
  /** A block pressed (browse). */
  onBlock?: ((id: string) => void) | undefined;
  /** A free half hour, or a suggestion, pressed: the call starts there. */
  onPick?: ((day: number, start: number) => void) | undefined;
  /** A free stretch dragged across: the call takes it. */
  onDrag?: ((day: number, start: number, end: number) => void) | undefined;
  /** The pick's grip dragged, or Shift and the arrow keys on its half hour: its new end, a quarter hour at a time. */
  onEnd?: ((end: number) => void) | undefined;
  /** The key under the week, naming what it draws. */
  legend?: CallsWeekKeyItem[] | undefined;
  /** What the week is, for a screen reader: "This week", "Pick a time". */
  label: string;
  className?: string | undefined;
}

const twoDigits = (n: number) => String(n).padStart(2, '0');
/** An hour as a clock says it: 10.25 is "10:15". */
export const weekClock = (h: number) => {
  const minutes = Math.round(h * 60);
  return `${twoDigits(Math.floor(minutes / 60))}:${twoDigits(minutes % 60)}`;
};
/** The pick's end moves a quarter hour at a time. */
const SNAP = 0.25;
/** A block shorter than this many hours has its time beside its title, not under it. */
const SHORT = 0.8;
/** The longest a call can be, in hours: the server's limit. */
const LONGEST = 10;

/**
 * Side by side where they overlap: each block's lane, and how many lanes its run of overlapping blocks needs, so a meeting
 * on your calendar at the time of an Alcove call stands beside it instead of on it.
 */
function lanesOf(blocks: readonly CallsWeekBlock[]): Map<string, { lane: number; of: number }> {
  const out = new Map<string, { lane: number; of: number }>();
  let run: { block: CallsWeekBlock; lane: number }[] = [];
  let runEnd = -Infinity;
  const close = () => {
    const of = run.reduce((n, r) => Math.max(n, r.lane + 1), 1);
    for (const r of run) out.set(r.block.id, { lane: r.lane, of });
    run = [];
    runEnd = -Infinity;
  };
  for (const b of [...blocks].sort((x, y) => x.start - y.start || y.end - x.end)) {
    if (run.length && b.start >= runEnd) close();
    const taken = new Set(run.filter((r) => r.block.end > b.start).map((r) => r.lane));
    let lane = 0;
    while (taken.has(lane)) lane++;
    run.push({ block: b, lane });
    runEnd = Math.max(runEnd, b.end);
  }
  if (run.length) close();
  return out;
}

const WAITS = { dec: 'a decision to confirm', fu: 'a follow-up for you' } as const;

export function CallsWeek({
  days, from = 8, to = 19, blocks, now = null, mode = 'browse', work, busy = [], suggestions = [], pick = null, was = null, length = 0.75,
  ghostNote, isPast, onBlock, onPick, onDrag, onEnd, legend, label, className
}: CallsWeekProps) {
  const scheduling = mode === 'schedule';
  const slots = Math.max(0, (to - from) * 2);
  const hourOf = (slot: number) => from + slot / 2;
  const past = (day: number, hour: number) => (isPast ? isPast(day, hour) : !!now && (day < now.day || (day === now.day && hour < now.at)));
  const today = days.findIndex((d) => d.today);
  /* On a phone the week is today and the next two days, or the last three when today is near the end of it. */
  const near = Math.max(0, Math.min(today < 0 ? 0 : today, days.length - 3));
  const isNear = (day: number) => day >= near && day < near + 3;
  const box = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState(() => ({ day: pick?.day ?? Math.max(0, today), slot: Math.max(0, Math.min(slots - 1, Math.floor(((pick?.start ?? 9) - from) * 2))) }));
  const [hover, setHover] = useState<{ day: number; slot: number } | null>(null);
  /* A stretch being dragged across, by its first and current half hours; and the pick's end while its grip is dragged. */
  const [drag, setDrag] = useState<{ day: number; first: number; last: number } | null>(null);
  const [grip, setGrip] = useState<number | null>(null);
  const [said, setSaid] = useState('');
  /* A drag that went somewhere has been dealt with when it ended: the click that follows it isn't a press. */
  const dragged = useRef(false);
  const lanes = useMemo(() => {
    const out = new Map<string, { lane: number; of: number }>();
    days.forEach((_, day) => { for (const [id, l] of lanesOf(blocks.filter((b) => b.day === day))) out.set(id, l); });
    return out;
  }, [blocks, days]);

  const clamp = (s: CallsWeekSpan) => ({ ...s, start: Math.max(from, s.start), end: Math.min(to, s.end) });
  const shows = (s: CallsWeekSpan) => s.end > from && s.start < to;
  const at = (s: { start: number; end: number }) => ({ '--s': Math.max(from, s.start), '--e': Math.min(to, s.end) });
  const pickEnd = pick ? grip ?? pick.end : null;
  const inPick = (day: number, hour: number) => !!pick && pick.day === day && hour >= pick.start && hour < (pickEnd ?? pick.end);

  /* The pick's end: on a quarter hour, at least a quarter hour after it starts, and no later than the grid or the longest call. */
  const endAt = (h: number) => {
    if (!pick) return h;
    const least = Math.ceil((pick.start + SNAP) / SNAP) * SNAP;
    const most = Math.floor(Math.min(to, pick.start + LONGEST) / SNAP) * SNAP;
    return Math.min(most, Math.max(least, Math.round(h / SNAP) * SNAP));
  };
  const ended = (end: number) => {
    setSaid(`Ends ${weekClock(end)}`);
    if (pick && end !== pick.end) onEnd?.(end);
  };

  const move = (day: number, slot: number) => {
    const next = { day: Math.max(0, Math.min(days.length - 1, day)), slot: Math.max(0, Math.min(slots - 1, slot)) };
    setCursor(next);
    box.current?.querySelector<HTMLElement>(`[data-at="${next.day}-${next.slot}"]`)?.focus();
  };
  const keys = (e: KeyboardEvent<HTMLButtonElement>, day: number, slot: number) => {
    if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && onEnd && pick && pickEnd !== null && pick.day === day && Math.floor((pick.start - from) * 2) === slot) {
      e.preventDefault();
      ended(endAt(pickEnd + (e.key === 'ArrowDown' ? SNAP : -SNAP)));
      return;
    }
    const step: Partial<Record<string, [number, number]>> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const by = step[e.key];
    if (by) { e.preventDefault(); move(day + by[0], slot + by[1]); return; }
    if (e.key === 'Home') { e.preventDefault(); move(day, 0); }
    else if (e.key === 'End') { e.preventDefault(); move(day, slots - 1); }
    else if (e.key === 'Escape' && drag) { e.preventDefault(); setDrag(null); }
  };

  /* Dragging across a day: from where it was pressed to where the pointer is, a half hour at a time. */
  const slotAt = (column: HTMLElement, y: number) => Math.max(0, Math.min(slots - 1, Math.floor((y - column.getBoundingClientRect().top) / (column.clientHeight / slots))));
  const startDrag = (e: PointerEvent<HTMLButtonElement>, day: number, slot: number) => {
    // A finger scrolls the week; only a mouse or a pen drags across it.
    if (!onDrag || e.button !== 0 || e.pointerType === 'touch' || past(day, hourOf(slot))) return;
    const column = e.currentTarget.parentElement;
    if (!column) return;
    column.setPointerCapture(e.pointerId);
    setDrag({ day, first: slot, last: slot });
  };
  const dragTo = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const last = slotAt(e.currentTarget, e.clientY);
    if (last !== drag.last) setDrag({ ...drag, last });
  };
  const endDrag = () => {
    if (!drag) return;
    const [a, b] = [Math.min(drag.first, drag.last), Math.max(drag.first, drag.last)];
    setDrag(null);
    // Pressed and let go: dealt with here, so a click that some browsers still send to the half hour isn't a second press.
    dragged.current = true;
    setTimeout(() => { dragged.current = false; }, 0);
    if (a === b) onPick?.(drag.day, hourOf(a));
    else onDrag?.(drag.day, hourOf(a), hourOf(b + 1));
  };

  const slotLabels = useMemo(() => days.map((d, day) => Array.from({ length: slots }, (_, slot) => {
    const hour = hourOf(slot);
    const note = scheduling ? ghostNote?.(day, hour, Math.min(to, hour + length)) : undefined;
    return `${d.label}, ${weekClock(hour)}${note ? `, ${note}` : ''}`;
  })), [days, slots, from, to, scheduling, ghostNote, length]);

  /* What's under the pointer: a ghost of the call there, unless it's taken, gone, or the call already. */
  const ghost = (() => {
    if (drag) {
      const [a, b] = [Math.min(drag.first, drag.last), Math.max(drag.first, drag.last)];
      return { day: drag.day, start: hourOf(a), end: hourOf(b + 1) };
    }
    if (!hover || grip !== null || !onPick) return null;
    const start = hourOf(hover.slot);
    if (past(hover.day, start) || inPick(hover.day, start)) return null;
    return { day: hover.day, start, end: Math.min(to, start + length) };
  })();
  const ghostWords = ghost && (scheduling ? ghostNote?.(ghost.day, ghost.start, ghost.end) : 'New call');

  const cols = days.map((d) => (d.weekend ? 'minmax(0, .45fr)' : 'minmax(0, 1fr)')).join(' ');
  return (
    <div className={cn('cw', scheduling && 'is-schedule', className)}>
      <span className="sr-only" role="status">{said}</span>
      <div className="cw-grid" style={{ '--cols': cols, '--from': from, '--rows': to - from }}>
        <span className="cw-corner" aria-hidden="true" />
        {days.map((d, day) => (
          <span key={`${d.label}-h`} className={cn('cw-day', d.today && 'is-today', d.weekend && 'is-end')} data-near={isNear(day) ? '' : undefined} aria-hidden="true">
            <b>{d.date}</b>{d.weekday}
          </span>
        ))}
        <div className="cw-hours" aria-hidden="true">
          {Array.from({ length: to - from }, (_, i) => <span key={i}>{weekClock(from + i)}</span>)}
        </div>
        <div ref={box} className="cw-days" role="group" aria-label={label}>
          {days.map((d, day) => {
            const mine = blocks.filter((b) => b.day === day && shows(b));
            return (
              <div key={d.label} className={cn('cw-col', d.today && 'is-today', d.weekend && 'is-end')} data-near={isNear(day) ? '' : undefined}
                onPointerMove={dragTo} onPointerUp={endDrag} onPointerCancel={() => setDrag(null)}>
                {scheduling && work && (d.weekend ? [{ start: from, end: to }] : [{ start: from, end: work.from }, { start: work.to, end: to }]).filter((r) => r.end > r.start).map((r) => (
                  <span key={`off-${r.start}`} className="cw-off" style={at(r)} />
                ))}
                {busy.filter((z) => z.day === day && shows(z)).map((z, i) => <span key={`busy-${i}`} className="cw-busy" style={at(clamp(z))} />)}
                {Array.from({ length: slots }, (_, slot) => {
                  const hour = hourOf(slot);
                  const gone = past(day, hour);
                  const picked = !!pick && pick.day === day && Math.floor((pick.start - from) * 2) === slot;
                  return (
                    <button key={slot} type="button" className="cw-slot" style={{ '--i': slot }} data-at={`${day}-${slot}`} tabIndex={cursor.day === day && cursor.slot === slot ? 0 : -1}
                      aria-label={picked && pickEnd !== null ? `${d.label}, ${weekClock(pick.start)} to ${weekClock(pickEnd)}, this call${onEnd ? '. Shift and the up or down arrow change when it ends' : ''}` : slotLabels[day]?.[slot]}
                      aria-pressed={picked} aria-disabled={gone || !onPick} aria-keyshortcuts={picked && onEnd ? 'Shift+ArrowUp Shift+ArrowDown' : undefined}
                      onFocus={() => setCursor({ day, slot })} onKeyDown={(e) => keys(e, day, slot)}
                      onPointerEnter={() => setHover({ day, slot })} onPointerLeave={() => setHover((h) => (h?.day === day && h.slot === slot ? null : h))}
                      onPointerDown={(e) => startDrag(e, day, slot)}
                      onClick={() => {
                        if (dragged.current) { dragged.current = false; return; }
                        if (!gone) onPick?.(day, hour);
                      }} />
                  );
                })}
                {mine.map((b) => {
                  const lane = lanes.get(b.id) ?? { lane: 0, of: 1 };
                  const words = `${b.title}, ${d.label}, ${weekClock(b.start)} to ${weekClock(b.end)}${b.wait ? `, ${WAITS[b.wait]}` : ''}`;
                  const inner = (
                    <>
                      <b>{b.title}</b>
                      <small>{weekClock(b.start)}</small>
                      {b.wait && <i className={cn('wait', `is-${b.wait}`)} aria-hidden="true" />}
                    </>
                  );
                  const cls = cn('cw-bk', `is-${b.kind}`, Math.min(to, b.end) - Math.max(from, b.start) < SHORT && 'is-short');
                  const style = { ...at(b), '--lane': lane.lane, '--of': lane.of };
                  return onBlock && !scheduling
                    ? <button key={b.id} type="button" className={cls} style={style} title={words} aria-label={words} onClick={() => onBlock(b.id)}>{inner}</button>
                    : <span key={b.id} className={cls} style={style} title={scheduling ? undefined : words} aria-hidden={scheduling ? true : undefined}>{inner}</span>;
                })}
                {was && was.day === day && shows(was) && <span className="cw-was" style={at(was)}><small>{was.label}</small></span>}
                {scheduling && suggestions.filter((g) => g.day === day && shows(g) && !(pick && pick.day === day && pick.start === g.start && !g.ticked)).map((g) => (
                  <button key={`sug-${g.start}`} type="button" className={cn('cw-sug', g.ticked && 'is-ticked')} style={at(g)} tabIndex={-1}
                    aria-label={`${d.label}, ${weekClock(g.start)}, a suggested time`} onClick={() => onPick?.(day, g.start)}>
                    <b>{weekClock(g.start)}</b>
                  </button>
                ))}
                {pick && pickEnd !== null && pick.day === day && shows(pick) && (
                  <span className={cn('cw-pick', pickEnd - pick.start < SHORT && 'is-short')} style={at({ start: pick.start, end: pickEnd })} aria-hidden="true">
                    <b>{weekClock(pick.start)} – {weekClock(pickEnd)}</b>
                    {pick.title && <small>{pick.title}</small>}
                    {onEnd && (
                      <i className={cn('grip', grip !== null && 'is-on')}
                        onPointerDown={(e) => {
                          if (e.button !== 0) return;
                          e.preventDefault();
                          e.stopPropagation();
                          e.currentTarget.setPointerCapture(e.pointerId);
                          setGrip(pickEnd);
                        }}
                        onPointerMove={(e) => {
                          const column = e.currentTarget.closest('.cw-col');
                          if (grip === null || !(column instanceof HTMLElement)) return;
                          setGrip(endAt(from + ((e.clientY - column.getBoundingClientRect().top) / column.clientHeight) * (to - from)));
                        }}
                        onPointerUp={(e) => { e.stopPropagation(); if (grip !== null) ended(grip); setGrip(null); }}
                        onPointerCancel={() => setGrip(null)} />
                    )}
                  </span>
                )}
                {ghost && ghost.day === day && (
                  <span className={cn('cw-ghost', drag && 'is-drag')} style={at(ghost)} aria-hidden="true">
                    <b>{scheduling || drag ? `${weekClock(ghost.start)} – ${weekClock(ghost.end)}` : ghostWords}</b>
                    {(scheduling || drag) ? ghostWords && <small>{ghostWords}</small> : <small>{weekClock(ghost.start)} – {weekClock(ghost.end)}</small>}
                  </span>
                )}
                {now && now.day === day && now.at >= from && now.at <= to && <span className="cw-now" style={{ '--s': now.at }} aria-hidden="true"><i /></span>}
              </div>
            );
          })}
        </div>
      </div>
      {legend && legend.length > 0 && (
        <p className="cw-key">
          {legend.map((k) => <span key={k.kind}><i className={cn('k', `is-${k.kind}`)} aria-hidden="true" />{k.label}</span>)}
        </p>
      )}
    </div>
  );
}
