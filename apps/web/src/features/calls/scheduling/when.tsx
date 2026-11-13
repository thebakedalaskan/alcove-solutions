/*
 * When, in the scheduler's editor: the day (a month to pick from), the start and end (typed, or picked from their lists),
 * how it repeats (a menu), and letting a guest pick, how long each time offered is. What a call can be and what each says
 * are times.ts and words.ts; these only draw them and take what's typed or pressed. Which of them is open is the
 * scheduler's: one at a time.
 */
import { MAX_SERIES_CALLS } from '@alcove/api';
import { MonthGrid, Popover, SchedLine, SchedPop, SchedQuiet, SchedRow, SchedTimes, SchedValue, type SchedTime } from '@alcove/ui';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { hm, longDay, shortDay, timeZone } from '~/lib/time';
import { repeatInput, ruleOf, type RepeatKind, type Repeating } from '../flow/draft';
import { LONGEST_CALL, SHORTEST_CALL, TYPED_STEP, dayEnd, lengthAt, localWeekday, monthlyRule, retime } from './times';
import { dayWord, endHm, lengthLabel, repeatLine, repeatWords, untimelyLine } from './words';

/** What in When is open: one at a time, as everything the scheduler opens. */
export type WhenMenu = 'day' | 'start' | 'end' | 'repeat' | 'length';
/** The lengths a guest's times can have, beside any other the call has. */
const LENGTHS = [30, 45, 60, 90, 120] as const;
const DAY_LETTERS = [['M', 1], ['T', 2], ['W', 3], ['T', 4], ['F', 5], ['S', 6], ['S', 0]] as const;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MINUTE = 60_000;

const pad = (n: number) => String(n).padStart(2, '0');
/** A day as MonthGrid takes it. */
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** "09:15" for minutes from midnight. */
const clockOf = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/** Opening and closing one of When's menus. */
export interface WhenOpen { menu: WhenMenu | null; onMenu: (m: WhenMenu | null) => void }

/**
 * The day: "Thu 12 Nov", with Today or Tomorrow quietly after it, opening a month. Days gone are greyed; a day picked keeps
 * the clock time (the scheduler moves it on when that time has gone there).
 */
export function DayRow({ at, now, menu, onMenu, onPick }: WhenOpen & { at: Date; now: Date; onPick: (day: Date) => void }) {
  const rel = dayWord(at, now);
  return (
    <SchedRow icon="cal">
      <Popover open={menu === 'day'} onOpenChange={(o) => onMenu(o ? 'day' : null)} label="Pick a day" align="start" className="sc-pop is-cal"
        anchor={<SchedValue chevron quiet={rel === 'Today' || rel === 'Tomorrow' ? rel : undefined} aria-label={`Day, ${longDay(at)}. Pick another`}>{shortDay(at)}</SchedValue>}>
        <MonthGrid value={isoOf(at)} today={isoOf(now)} from={isoOf(now)} label="Pick a day" autoFocus onCancel={() => onMenu(null)}
          onPick={(iso) => {
            const [y, m, d] = iso.split('-').map(Number);
            onMenu(null);
            onPick(new Date(y ?? at.getFullYear(), (m ?? at.getMonth() + 1) - 1, d ?? at.getDate()));
          }} />
      </Popover>
    </SchedRow>
  );
}

/**
 * The time: its start and its end, each typed as a 24-hour time like every other time here ("14:15", or "1415") to the
 * nearest 5 minutes, or picked from its list in quarter hours; then how long it is, quietly. A start moves the call and keeps
 * its length; an end sets it, and can't pass midnight. What's typed counts once it's finished, on leaving the field or with
 * Enter; one that can't be read or used says why, and what was there stays. The up and down arrows move one 5 minutes;
 * Alt with ↓ (or F4) goes into its list. `fixedEnd` shows the end without changing it: asking to move someone else's call
 * asks for a start.
 */
export function TimeRow({ at, minutes, now, menu, onMenu, onStart, onEnd, fixedEnd = false }: WhenOpen & {
  at: Date;
  /** How long it's meant to be: past midnight, it stops there. */
  minutes: number;
  now: Date;
  onStart: (at: Date) => void;
  onEnd: (minutes: number) => void;
  fixedEnd?: boolean | undefined;
}) {
  const length = lengthAt(at, minutes);
  const [typed, setTyped] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const [why, setWhy] = useState<string | null>(null);
  const [keyed, setKeyed] = useState(false);
  /* Picked anew (on the week, from a list, or what was typed): what's half typed, and why one couldn't be used, go. */
  const picked = `${at.getTime()}:${length}`;
  const [seen, setSeen] = useState(picked);
  if (picked !== seen) {
    setSeen(picked);
    setTyped({ start: null, end: null });
    setWhy(null);
  }
  const fields = { start: useRef<HTMLInputElement>(null), end: useRef<HTMLInputElement>(null) };
  const lists = { start: useRef<HTMLDivElement>(null), end: useRef<HTMLDivElement>(null) };
  const ids = { start: useId(), end: useId() };
  const type = (which: 'start' | 'end', value: string | null) => setTyped((t) => (which === 'start' ? { ...t, start: value } : { ...t, end: value }));

  const use = (which: 'start' | 'end', value: string) => {
    const next = retime(at, minutes, which, value, new Date());
    if (!next.ok) { setWhy(untimelyLine(next.why)); return; }
    setWhy(null);
    if (which === 'start') { if (next.at.getTime() !== at.getTime()) onStart(next.at); } else if (next.minutes !== length) onEnd(next.minutes);
  };
  const commit = (which: 'start' | 'end') => {
    const value = typed[which];
    type(which, null);
    if (value?.trim()) use(which, value);
    else if (value !== null) setWhy(null);
  };
  /* Put away from inside its list (Escape, or a time picked), the keyboard goes back to its field. */
  const close = (which: 'start' | 'end') => {
    if (lists[which].current?.contains(document.activeElement)) fields[which].current?.focus({ preventScroll: true });
    setKeyed(false);
    onMenu(null);
  };
  const keys = (which: 'start' | 'end', e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(which); onMenu(null); return; }
    if ((e.key === 'ArrowDown' && e.altKey) || e.key === 'F4') { e.preventDefault(); setKeyed(true); onMenu(which); return; }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    type(which, null);
    const step = e.key === 'ArrowUp' ? TYPED_STEP : -TYPED_STEP;
    if (which === 'start') {
      const next = new Date(at.getTime() + step * MINUTE);
      if (next.toDateString() === at.toDateString()) use('start', hm(next));
      return;
    }
    /* An end stays on its day, between 5 minutes after the start and midnight. */
    const next = length + step;
    if (next >= SHORTEST_CALL && next <= LONGEST_CALL && at.getTime() + next * MINUTE <= dayEnd(at).getTime()) onEnd(next);
  };

  const day = (m: number) => new Date(at.getFullYear(), at.getMonth(), at.getDate(), Math.floor(m / 60), m % 60);
  const startClock = at.getHours() * 60 + at.getMinutes();
  const starts: SchedTime[] = Array.from({ length: 96 }, (_, i) => ({ value: clockOf(i * 15), label: clockOf(i * 15), gone: day(i * 15).getTime() <= now.getTime() }));
  /* Ends from a quarter hour after the start to midnight, each with the length it makes, as long as a call can be. */
  const toMidnight = Math.round((dayEnd(at).getTime() - at.getTime()) / MINUTE);
  const lengths = [...new Set([...Array.from({ length: 40 }, (_, i) => (i + 1) * 15), toMidnight])].filter((l) => l <= Math.min(toMidnight, LONGEST_CALL)).sort((a, b) => a - b);
  const ends: SchedTime[] = lengths.map((l) => ({ value: String(l), label: endHm(at, l), note: lengthLabel(l) }));

  const field = (which: 'start' | 'end') => {
    const label = which === 'start' ? 'Starts' : 'Ends';
    const open = menu === which;
    const shown = which === 'start' ? hm(at) : endHm(at, length);
    const options = which === 'start' ? starts : ends;
    const value = which === 'start' ? (startClock % 15 ? null : clockOf(startClock)) : (ends.some((o) => o.value === String(length)) ? String(length) : null);
    const near = which === 'start' ? clockOf(Math.min(95, Math.ceil(startClock / 15)) * 15) : ends.find((o) => Number(o.value) >= length)?.value;
    return (
      <SchedPop open={open} onClose={() => close(which)} label={label} className="is-list"
        anchor={(
          <input ref={fields[which]} className="sc-in" type="text" inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={5} aria-label={label}
            aria-haspopup="listbox" aria-controls={open ? ids[which] : undefined} value={typed[which] ?? shown}
            onChange={(e) => type(which, e.target.value)} onFocus={(e) => e.currentTarget.select()} onBlur={() => commit(which)}
            onPointerDown={() => { if (!open) { setKeyed(false); onMenu(which); } }} onKeyDown={(e) => keys(which, e)} />
        )}>
        <SchedTimes id={ids[which]} listRef={lists[which]} label={label} options={options} value={value} near={near} autoFocus={keyed}
          onPick={(v) => {
            close(which);
            fields[which].current?.focus({ preventScroll: true });
            if (which === 'start') onStart(day(Number(v.slice(0, 2)) * 60 + Number(v.slice(3))));
            else onEnd(Number(v));
          }} />
      </SchedPop>
    );
  };

  return (
    <>
      <SchedRow icon="clock">
        {field('start')}
        <span className="sc-dash" aria-hidden="true">–</span>
        {fixedEnd ? <span className="sc-end">{endHm(at, length)}</span> : field('end')}
        <span className="sc-len">{lengthLabel(length)}</span>
      </SchedRow>
      {why && <SchedLine tone="caution">{why}</SchedLine>}
    </>
  );
}

/** Letting a guest pick, how long each time offered is: one length for all of them. */
export function LengthRow({ minutes, menu, onMenu, onChange }: WhenOpen & { minutes: number; onChange: (minutes: number) => void }) {
  const options = [...new Set<number>([...LENGTHS, minutes])].sort((a, b) => a - b).map((m) => ({ value: String(m), label: lengthLabel(m) }));
  return (
    <SchedRow icon="clock">
      <Popover open={menu === 'length'} onOpenChange={(o) => onMenu(o ? 'length' : null)} label="How long" align="start" className="sc-pop is-list"
        anchor={<SchedQuiet chevron>{lengthLabel(minutes)} each</SchedQuiet>}>
        <SchedTimes label="How long" options={options} value={String(minutes)} autoFocus onPick={(v) => { onMenu(null); onChange(Number(v)); }} />
      </Popover>
    </SchedRow>
  );
}

/** "Every Thursday", "Every 2 weeks on Thursday", "Every month on the first Thursday": each choice as it reads for this call. */
function choiceLabel(kind: RepeatKind, at: Date, zone: string): string {
  const day = DAY_NAMES[localWeekday(at, zone)] ?? '';
  if (kind === 'none') return 'Doesn’t repeat';
  if (kind === 'week') return `Every ${day}`;
  if (kind === 'two-weeks') return `Every 2 weeks on ${day}`;
  if (kind === 'month') return repeatLine(monthlyRule(at, zone));
  return 'Days you pick';
}

/**
 * How a call repeats: "Doesn’t repeat", or "Every Thursday · 4 calls", opening a menu with Every Thursday, Every 2 weeks on
 * Thursday, Every month on the first Thursday and Days you pick (the days, in place), and Ends after 4 calls once it repeats.
 * `keep` is a series already, which stays one.
 */
export function RepeatRow({ repeat, at, zone = timeZone(), keep = false, menu, onMenu, onChange }: WhenOpen & {
  repeat: Repeating; at: Date;
  /** Where the organizer is: the calls keep their clock time there. */
  zone?: string | undefined;
  keep?: boolean | undefined;
  onChange: (r: Repeating) => void;
}) {
  const rule = ruleOf(repeat, at, zone);
  const series = repeatInput(repeat, at, zone);
  const today = localWeekday(at, zone);
  const kinds: RepeatKind[] = [...(keep ? [] : ['none' as const]), 'week', 'two-weeks', 'month', 'days'];
  const count = series?.occurrences.length ?? 0;
  const [typed, setTyped] = useState<string | null>(null);
  const commit = () => {
    const n = Number(typed);
    setTyped(null);
    if (Number.isInteger(n) && n >= 2) onChange({ ...repeat, calls: Math.min(MAX_SERIES_CALLS, n) });
  };
  const toggle = (day: number) => onChange({ ...repeat, days: repeat.days.includes(day) ? repeat.days.filter((d) => d !== day) : [...repeat.days, day] });
  return (
    <SchedRow icon="repeat">
      <Popover open={menu === 'repeat'} onOpenChange={(o) => onMenu(o ? 'repeat' : null)} label="How it repeats" align="start" className="sc-pop is-menu"
        anchor={<SchedQuiet chevron><span>{repeatWords(rule, count)}</span></SchedQuiet>}>
        <div className="sc-reps" role="radiogroup" aria-label="How it repeats">
          {kinds.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={repeat.kind === k} className="sc-rep" onClick={() => onChange({ ...repeat, kind: k })}>
              <i aria-hidden="true" />{choiceLabel(k, at, zone)}
            </button>
          ))}
        </div>
        {repeat.kind === 'days' && (
          <div className="sc-days" role="group" aria-label="Which days">
            {DAY_LETTERS.map(([letter, day]) => (
              <button key={day} type="button" className="sc-day" aria-label={DAY_NAMES[day]} aria-pressed={day === today || repeat.days.includes(day)} disabled={day === today}
                title={day === today ? 'The first call is on this day' : undefined} onClick={() => toggle(day)}>{letter}</button>
            ))}
          </div>
        )}
        {series && (
          <label className="sc-ends">
            Ends after
            <input type="text" inputMode="numeric" maxLength={2} aria-label="How many calls" value={typed ?? String(count)}
              onChange={(e) => setTyped(e.target.value)} onFocus={(e) => e.currentTarget.select()} onBlur={commit}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} />
            {count === 1 ? 'call' : 'calls'}
            {count === MAX_SERIES_CALLS && <small>The most one repeat can have</small>}
          </label>
        )}
      </Popover>
    </SchedRow>
  );
}
