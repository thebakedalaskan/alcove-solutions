/*
 * A month to pick a day from: six weeks, Monday first, with the days of the months either side filling them in quietly,
 * today marked in the warm colour of now and the day picked filled. The arrows at its head go a month back or on. From the
 * keyboard, the arrow keys move a day (up and down a week), Home and End go to the week's ends, Page Up and Page Down a
 * month (with Shift, a year), Enter picks and Esc goes back without picking. Any day can be picked, past ones too. Days are
 * `YYYY-MM-DD`, on the reader's own calendar.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '../cn';
import { IconButton } from './primitives';

const WEEKDAYS = [['Mon', 'Monday'], ['Tue', 'Tuesday'], ['Wed', 'Wednesday'], ['Thu', 'Thursday'], ['Fri', 'Friday'], ['Sat', 'Saturday'], ['Sun', 'Sunday']] as const;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** A day from `YYYY-MM-DD`, or null for anything else. */
function dayOf(iso: string | null): Date | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isoOf(d) === iso ? d : null;
}
const plusDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** The same day of another month, or that month's last day where it has no such day. */
function plusMonths(d: Date, n: number): Date {
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), last));
}
/** Monday is 0. */
const weekdayOf = (d: Date) => (d.getDay() + 6) % 7;
/** "Friday 13 November 2026", which is what a day is read out as. */
const spoken = (d: Date) => `${WEEKDAYS[weekdayOf(d)]?.[1] ?? ''} ${d.getDate()} ${MONTHS[d.getMonth()] ?? ''} ${d.getFullYear()}`;

/** The six weeks a month is shown in, from the Monday on or before its first day. */
function weeksOf(month: Date): Date[][] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = plusDays(first, -weekdayOf(first));
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (__, i) => plusDays(start, w * 7 + i)));
}

export function MonthGrid({ value, today, onPick, onCancel, label = 'Pick a date', autoFocus = false }: {
  /** The day picked, as YYYY-MM-DD, or null while there's none. */
  value: string | null;
  /** Today, as YYYY-MM-DD: marked, and where it opens when nothing's picked. */
  today: string;
  onPick: (date: string) => void;
  /** Esc, from a day: put it away without picking. */
  onCancel?: (() => void) | undefined;
  /** Names it for assistive tech. */
  label?: string | undefined;
  /** Gives the picked day, or today, the keyboard as it opens: for a calendar that takes a list's place. */
  autoFocus?: boolean | undefined;
}) {
  const start = dayOf(value) ?? dayOf(today) ?? new Date();
  /* The day the keys are on, which is in the month shown. */
  const [active, setActive] = useState(start);
  const grid = useRef<HTMLTableElement>(null);
  const moving = useRef(autoFocus);
  const title = useId();
  const activeIso = isoOf(active);

  /* Where the keys went, the keyboard goes: after the month it's in is drawn. */
  useEffect(() => {
    if (!moving.current) return;
    moving.current = false;
    grid.current?.querySelector<HTMLElement>(`[data-day="${activeIso}"]`)?.focus({ preventScroll: true });
  }, [activeIso]);

  const go = (to: Date) => { moving.current = true; setActive(to); };
  const keys = (e: KeyboardEvent<HTMLTableElement>) => {
    const to = e.key === 'ArrowLeft' ? plusDays(active, -1) : e.key === 'ArrowRight' ? plusDays(active, 1)
      : e.key === 'ArrowUp' ? plusDays(active, -7) : e.key === 'ArrowDown' ? plusDays(active, 7)
        : e.key === 'Home' ? plusDays(active, -weekdayOf(active)) : e.key === 'End' ? plusDays(active, 6 - weekdayOf(active))
          : e.key === 'PageUp' ? plusMonths(active, e.shiftKey ? -12 : -1) : e.key === 'PageDown' ? plusMonths(active, e.shiftKey ? 12 : 1) : null;
    if (to) { e.preventDefault(); e.stopPropagation(); go(to); return; }
    if (e.key === 'Escape' && onCancel) { e.preventDefault(); e.stopPropagation(); onCancel(); }
  };

  return (
    <div className="ac-cal" role="group" aria-label={label}>
      <div className="ac-cal-head">
        <b id={title} aria-live="polite">{MONTHS[active.getMonth()]} {active.getFullYear()}</b>
        <IconButton icon="chevronLeft" size={16} label="Previous month" onClick={() => setActive(plusMonths(active, -1))} />
        <IconButton icon="chevron" size={16} label="Next month" onClick={() => setActive(plusMonths(active, 1))} />
      </div>
      <table ref={grid} className="ac-cal-grid" role="grid" aria-labelledby={title} onKeyDown={keys}>
        <thead><tr>{WEEKDAYS.map(([short, long]) => <th key={short} scope="col" abbr={long}>{short}</th>)}</tr></thead>
        <tbody>
          {weeksOf(active).map((week) => (
            <tr key={isoOf(week[0] ?? active)}>
              {week.map((d) => {
                const iso = isoOf(d);
                const out = d.getMonth() !== active.getMonth();
                return (
                  <td key={iso} aria-selected={iso === value}>
                    <button type="button" data-day={iso} tabIndex={iso === activeIso ? 0 : -1} aria-label={spoken(d)} aria-current={iso === today ? 'date' : undefined}
                      className={cn('ac-cal-d', out && 'is-out', iso === today && 'is-today', iso === value && 'is-on')}
                      /* A day of the month shown takes the keys when it's pressed; one either side is picked as it is, the month staying put. */
                      onFocus={() => { if (!out && iso !== activeIso) setActive(d); }} onClick={() => onPick(iso)}>
                      {d.getDate()}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
