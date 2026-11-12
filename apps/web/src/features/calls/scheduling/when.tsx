/*
 * When, in the scheduler: three times as cards (ticks when a guest picks from them), the time picked as it will read with
 * its start and end to type, how long, and how it repeats, opening in place. What a call can be and what each says are
 * times.ts and words.ts; these only draw them and take what's typed or pressed.
 */
import { MAX_SERIES_CALLS } from '@alcove/api';
import { FlowNote, Icon, Segmented, TimeCard } from '@alcove/ui';
import { useId, useState } from 'react';
import { hm, timeZone } from '~/lib/time';
import { repeatInput, ruleOf, type RepeatKind, type Repeating } from '../flow/draft';
import { TYPED_STEP, localWeekday, monthlyRule, retime } from './times';
import { callCount, dayWord, repeatLine, untimelyLine } from './words';

const LENGTHS = [30, 45, 60] as const;
/** "45 min", "1 h", "1 h 15 min" */
export const lengthLabel = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`);
const DAY_LETTERS = [['M', 1], ['T', 2], ['W', 3], ['T', 4], ['F', 5], ['S', 6], ['S', 0]] as const;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** A time on a card: when, and, when a guest picks, what their clock says then. */
export interface CardTime { at: Date; note?: string | undefined; guest?: string | undefined }

/**
 * Three times to pick from, soonest first, the picked one filled with a tick. Letting a guest pick, each is a tick box
 * instead (`ticked`), with the guest's own time under it.
 */
export function TimeCards({ times, now, picked, ticks, onPick }: {
  times: readonly CardTime[]; now: Date; picked: Date | null;
  /** Letting a guest pick: which are ticked. */
  ticks?: ((at: Date) => boolean) | undefined;
  onPick: (at: Date) => void;
}) {
  return (
    <div className="cf-times sc-cards" role="group" aria-label={ticks ? 'Times to offer' : 'Times that work'}>
      {times.map((t) => (
        <TimeCard key={t.at.getTime()} day={dayWord(t.at, now)} time={hm(t.at)} note={t.guest ?? t.note} box={!!ticks}
          picked={ticks ? ticks(t.at) : picked?.getTime() === t.at.getTime()} onClick={() => onPick(t.at)} />
      ))}
    </div>
  );
}

/**
 * The time picked, as it will read: its day, then its start and its end, each typed as a 24-hour time like every other time
 * here ("14:15", or "1415"), to the nearest 5 minutes; the up and down arrows move it 5 minutes. A start moves the call and
 * keeps its length; an end sets the length. What's typed counts once it's finished, on leaving the field or with Enter; a
 * time that can't be read or used says why, and what was there stays, as it does, saying nothing, for a field left empty.
 */
export function StartEnd({ at, minutes, now, onChange }: { at: Date; minutes: number; now: Date; onChange: (c: { at: Date; minutes: number }) => void }) {
  const [typed, setTyped] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const [why, setWhy] = useState<string | null>(null);
  /* Picked anew (a card, the week, a length, or what was typed): what's half typed, and why one couldn't be used, go. */
  const picked = `${at.getTime()}:${minutes}`;
  const [seen, setSeen] = useState(picked);
  if (picked !== seen) {
    setSeen(picked);
    setTyped({ start: null, end: null });
    setWhy(null);
  }
  const end = new Date(at.getTime() + minutes * 60_000);
  const type = (which: 'start' | 'end', value: string | null) => setTyped((t) => (which === 'start' ? { ...t, start: value } : { ...t, end: value }));
  const use = (which: 'start' | 'end', value: string) => {
    const next = retime(at, minutes, which, value, new Date());
    if (!next.ok) { setWhy(untimelyLine(next.why)); return; }
    setWhy(null);
    if (next.at.getTime() !== at.getTime() || next.minutes !== minutes) onChange({ at: next.at, minutes: next.minutes });
  };
  const commit = (which: 'start' | 'end') => {
    const value = typed[which];
    type(which, null);
    if (value?.trim()) use(which, value);
    else if (value !== null) setWhy(null);
  };
  const field = (which: 'start' | 'end', label: string, value: Date) => (
    <input className="sc-in" type="text" inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={5} aria-label={label} value={typed[which] ?? hm(value)}
      onChange={(e) => type(which, e.target.value)} onFocus={(e) => e.currentTarget.select()} onBlur={() => commit(which)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(which); }
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        type(which, null);
        // A start stays on its day; an end past midnight is the next day's, as when it's typed.
        const next = new Date(value.getTime() + (e.key === 'ArrowUp' ? TYPED_STEP : -TYPED_STEP) * 60_000);
        if (which === 'end' || next.toDateString() === at.toDateString()) use(which, hm(next));
      }} />
  );
  return (
    <>
      <p className="sc-time"><span>{dayWord(at, now)},</span>{field('start', 'Starts', at)}<span className="dash" aria-hidden="true">–</span>{field('end', 'Ends', end)}</p>
      {why && <FlowNote icon="clock" className="sc-why">{why}</FlowNote>}
    </>
  );
}

/** How long: 30 min, 45 min and 1 h, and any other length the call has (typed, or dragged on the week) beside them. */
export function Lengths({ minutes, onChange }: { minutes: number; onChange: (m: number) => void }) {
  const options = [...new Set<number>([...LENGTHS, minutes])].sort((a, b) => a - b).map((m) => ({ value: String(m), label: lengthLabel(m) }));
  return <Segmented className="sc-lens" value={String(minutes)} onChange={(v) => onChange(Number(v))} options={options} label="How long" />;
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
 * How a call repeats: a row that opens in place, with Every Thursday, Every 2 weeks on Thursday, Every month on the first
 * Thursday and Days you pick, and how many calls it runs for. `keep` is a series already, which stays one.
 */
export function RepeatChoice({ repeat, at, zone = timeZone(), keep = false, onChange }: {
  repeat: Repeating; at: Date;
  /** Where the organizer is: the calls keep their clock time there. */
  zone?: string | undefined;
  keep?: boolean | undefined;
  onChange: (r: Repeating) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
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
    <>
      <button type="button" className="sc-row" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <Icon name="repeat" size={17} />
        <span className="min-w-0"><b className="ac-clamp-1">{rule ? repeatLine(rule) : 'Doesn’t repeat'}</b>{series && <small>{callCount(count)}</small>}</span>
        <span className="chev"><Icon name="chevron" size={15} /></span>
      </button>
      {open && (
        <div id={id} className="sc-reps">
          <div role="radiogroup" aria-label="How it repeats">
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
              <input className="sc-in" type="text" inputMode="numeric" maxLength={2} aria-label="How many calls" value={typed ?? String(count)}
                onChange={(e) => setTyped(e.target.value)} onFocus={(e) => e.currentTarget.select()} onBlur={commit}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} />
              {count === 1 ? 'call' : 'calls'}
              {count === MAX_SERIES_CALLS && <small>The most one repeat can have</small>}
            </label>
          )}
        </div>
      )}
    </>
  );
}
