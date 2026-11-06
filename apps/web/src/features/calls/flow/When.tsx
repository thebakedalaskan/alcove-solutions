/*
 * When: three times that work, the best already picked, how long, and how it repeats. Pick another time widens the
 * modal around the week. Changing a call's time uses the same pieces (Times, Week, Length).
 */
import { MAX_SERIES_CALLS, type Meeting, type Person } from '@alcove/api';
import { Button, FlowBody, FlowFoot, FlowRow, IconButton, Segmented, Switch, TimeCard, TimeCardWaiting, WeekGrid, cn, type WeekEvent } from '@alcove/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { callName } from '~/lib/people';
import { dayMonth, hm, shortDay, timeZone, weekday } from '~/lib/time';
import { useTimes, useWeek } from '../scheduling/availability';
import { repeatInput, ruleOf, type Draft, type RepeatKind, type Repeating } from './draft';
import { localDay, localWeekday, workingDays, type Slot } from '../scheduling/times';
import { callCount, dayWord, freeLine, repeatLine, shortTime, whenLine } from '../scheduling/words';

const LENGTHS = [30, 45, 60] as const;
const lengthLabel = (m: number) => (m % 60 ? `${m} min` : `${m / 60} h`);
/** Hours the week shows, and where nine o'clock sits in them. */
const WEEK_FROM = 7;
const WEEK_TO = 21;
const WEEK_DAYS = 5;
const DAY_LETTERS = [['M', 1], ['T', 2], ['W', 3], ['T', 4], ['F', 5], ['S', 6], ['S', 0]] as const;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
/** The most times a guest can be offered, which is also how many cards there are to tick. */
const MOST_OFFERED = 3;
const soonestFirst = (a: Date, b: Date) => a.getTime() - b.getTime();

/** A call's length, offered beside the usual ones when it's something else. */
export function Length({ minutes, onChange }: { minutes: number; onChange: (m: number) => void }) {
  const options = [...new Set<number>([...LENGTHS, minutes])].sort((a, b) => a - b).map((m) => ({ value: String(m), label: lengthLabel(m) }));
  return <Segmented value={String(minutes)} onChange={(v) => onChange(Number(v))} options={options} label="How long" />;
}

/** The cards to pick from. */
function Times({ times, shown, on, onPick }: {
  times: ReturnType<typeof useTimes>; shown: readonly Slot[];
  /** Which are picked. */
  on: (at: Date) => boolean;
  onPick: (at: Date) => void;
}) {
  return (
    <div className="cf-times" aria-busy={times.loading}>
      {times.loading ? [0, 1, 2].map((i) => <TimeCardWaiting key={i} />) : shown.map((s) => (
        <TimeCard key={s.at.getTime()} day={dayWord(s.at, times.now)} time={hm(s.at)} note={freeLine(s)} picked={on(s.at)} onClick={() => onPick(s.at)} />
      ))}
    </div>
  );
}

/** The week: five working days from today, then the next five, with what's already in them. */
export function Week({ emails, chosen, minutes, onPick, except }: { emails: readonly string[]; chosen: Date | null; minutes: number; onPick: (at: Date) => void; except?: Meeting | undefined }) {
  const [page, setPage] = useState(0);
  const days = useMemo(() => {
    const all = workingDays(new Date(), WEEK_DAYS * (page + 1));
    return all.slice(-WEEK_DAYS);
  }, [page]);
  const week = useWeek(emails, days, except);
  const hoursOf = (at: Date) => at.getHours() + at.getMinutes() / 60;
  const dayIndex = (at: Date) => days.findIndex((d) => d.toDateString() === at.toDateString());

  const events = useMemo<WeekEvent[]>(() => {
    const out: WeekEvent[] = [];
    const place = (from: Date, to: Date, kind: WeekEvent['kind'], title?: string | undefined) => {
      const day = dayIndex(from);
      if (day < 0) return;
      const end = to.toDateString() === from.toDateString() ? hoursOf(to) : WEEK_TO;
      const a = Math.max(WEEK_FROM, hoursOf(from));
      const b = Math.min(WEEK_TO, end);
      if (b > a) out.push({ day, from: a, to: b, kind, title });
    };
    for (const e of week.own) place(new Date(e.from), new Date(e.to), 'mine', e.title);
    const isOwn = (from: string) => week.own.some((e) => e.from === from);
    for (const i of week.you) if (!isOwn(i.from)) place(new Date(i.from), new Date(i.to), 'busy');
    for (const person of week.readable) for (const i of person) place(new Date(i.from), new Date(i.to), 'busy');
    return merged(out);
  }, [week.own, week.you, week.readable, days]);

  const at = (day: number, hour: number) => { const d = days[day] ?? new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(hour), hour % 1 ? 30 : 0); };
  const first = days[0];
  const last = days.at(-1);
  const pickDay = chosen ? dayIndex(chosen) : -1;
  return (
    <div className="cf-wk">
      <div className="cf-wk-top">
        <span>{first && last ? `${dayMonth(first)} – ${dayMonth(last)}` : ''}</span>
        <span className="cf-wk-nav">
          <IconButton icon="left" size={16} label="Earlier days" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} />
          <IconButton icon="right" size={16} label="Later days" onClick={() => setPage((p) => p + 1)} />
        </span>
      </div>
      <WeekGrid label="Pick a time" from={WEEK_FROM} to={WEEK_TO} events={events}
        days={days.map((d) => ({ weekday: weekday(d).slice(0, 3), date: d.getDate(), today: d.toDateString() === new Date().toDateString(), label: shortDay(d) }))}
        pick={chosen && pickDay >= 0 ? { day: pickDay, from: hoursOf(chosen), to: hoursOf(chosen) + minutes / 60, label: hm(chosen) } : null}
        isBusy={(day, hour) => events.some((e) => e.day === day && e.from <= hour && e.to > hour)}
        isPast={(day, hour) => at(day, hour).getTime() <= Date.now()} onPick={(day, hour) => onPick(at(day, hour))} />
    </div>
  );
}

/** One block for each run of busy time: a big call's calendars would otherwise stack up hundreds of them. */
function merged(events: WeekEvent[]): WeekEvent[] {
  const busy = events.filter((e) => e.kind === 'busy').sort((a, b) => a.day - b.day || a.from - b.from);
  const out: WeekEvent[] = events.filter((e) => e.kind === 'mine');
  let run: WeekEvent | null = null;
  for (const e of busy) {
    if (run && run.day === e.day && e.from <= run.to) run.to = Math.max(run.to, e.to);
    else { run = { ...e }; out.push(run); }
  }
  return out;
}

/**
 * The day a repeat ends. A date field says something at every keystroke, most of it on the way to what's meant, so what's
 * typed stays as it is and counts once it's finished: on leaving the field, or with Enter. A date that can't be the end
 * puts the last one back.
 */
function Until({ value, min, onChange }: { value: string; min: string; onChange: (until: string) => void }) {
  const [typed, setTyped] = useState<string | null>(null);
  const commit = () => {
    if (typed && typed >= min) onChange(typed);
    setTyped(null);
  };
  return <input type="date" value={typed ?? value} min={min} onChange={(e) => setTyped(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} />;
}

/** How a call repeats: the row, and what it opens. */
export function RepeatRow({ repeat, at, zone = timeZone(), keep = false, onChange }: {
  repeat: Repeating; at: Date | null;
  /** Where the organizer is: the calls keep their clock time there. */
  zone?: string | undefined;
  /** It's a series already, and stays one. */
  keep?: boolean | undefined;
  onChange: (r: Repeating) => void;
}) {
  const [open, setOpen] = useState(false);
  const when = at ?? new Date();
  const rule = ruleOf(repeat, when, zone);
  const series = repeatInput(repeat, when, zone);
  const today = localWeekday(when, zone);
  const pick = (kind: RepeatKind) => onChange({ ...repeat, kind });
  const toggle = (day: number) => onChange({ ...repeat, days: repeat.days.includes(day) ? repeat.days.filter((d) => d !== day) : [...repeat.days, day] });
  const choices: { kind: RepeatKind; label: string }[] = [
    ...(keep ? [] : [{ kind: 'none', label: 'Doesn’t repeat' } satisfies { kind: RepeatKind; label: string }]), { kind: 'week', label: `Every ${DAY_NAMES[today]}` }, { kind: 'two-weeks', label: 'Every 2 weeks' },
    { kind: 'month', label: 'Every month' }, { kind: 'days', label: 'Days you pick' }
  ];
  return (
    <>
      <FlowRow icon="repeat" title={rule ? repeatLine(rule) : 'Doesn’t repeat'} sub={series ? `${callCount(series.occurrences.length)}, until ${shortDay(new Date(series.occurrences.at(-1) ?? when))}` : undefined}
        expanded={open} onClick={() => setOpen((o) => !o)} />
      {open && (
        <div className="cf-more">
          <div className="cf-picks" role="group" aria-label="How it repeats">
            {choices.map((c) => <button key={c.kind} type="button" className="cf-pick" aria-pressed={repeat.kind === c.kind} onClick={() => pick(c.kind)}>{c.label}</button>)}
          </div>
          {repeat.kind === 'days' && (
            <div className="cf-picks" role="group" aria-label="Which days">
              {DAY_LETTERS.map(([letter, day]) => (
                <button key={day} type="button" className="cf-pick day" aria-label={DAY_NAMES[day]} aria-pressed={day === today || repeat.days.includes(day)} disabled={day === today}
                  title={day === today ? 'The first call is on this day' : undefined} onClick={() => toggle(day)}>{letter}</button>
              ))}
            </div>
          )}
          {series && (
            <label className="cf-end">
              Until
              <Until value={series.until} min={localDay(when, zone)} onChange={(until) => onChange({ ...repeat, until })} />
              <small>{series.occurrences.length === MAX_SERIES_CALLS ? `${MAX_SERIES_CALLS} calls, the most one repeat can have` : callCount(series.occurrences.length)}</small>
            </label>
          )}
        </div>
      )}
    </>
  );
}

export function When({ draft, change, guests, team, wide, onWide, back, onNext }: {
  draft: Draft; change: (d: Partial<Draft>) => void; guests: Person[]; team: boolean; wide: boolean; onWide: (w: boolean) => void; back: boolean; onNext: (at: Date) => void;
}) {
  const emails = useMemo(() => guests.map((g) => g.email), [guests]);
  const times = useTimes(emails, draft.minutes);
  const chosen = draft.at ?? times.slots[0]?.at ?? null;
  const [guest] = guests;
  /* A guest with a private calendar can pick a time themselves, when someone is on their own and it's one guest. */
  const offerable = !team && guests.length === 1 && times.unknown === 1;
  const canOffer = offerable && times.slots.length >= 2 && !times.loading;
  const offer = draft.offer;
  const everyone = team && guests.length > 0;
  const empty = !times.loading && !times.slots.length;
  const offered = (at: Date) => offer?.some((t) => t.getTime() === at.getTime()) ?? false;
  const known = (at: Date) => times.slots.some((s) => s.at.getTime() === at.getTime());
  /*
   * What the cards show: the best times, with one picked from the week in front of them. While offering it's every time
   * offered and then the best others, so what's ticked is what's sent, and there's no card for a time too many.
   */
  const shown: Slot[] = offer
    ? [...offer.map((at) => times.slot(at)), ...times.slots.filter((s) => !offered(s.at))].slice(0, MOST_OFFERED).sort((a, b) => soonestFirst(a.at, b.at))
    : chosen && !known(chosen) ? [times.slot(chosen), ...times.slots.slice(0, 2)] : times.slots;
  const ticked = (at: Date) => (offer ? offered(at) : chosen?.getTime() === at.getTime());
  const pick = (at: Date) => {
    if (!offer) { change({ at }); return; }
    const next = offered(at) ? offer.filter((t) => t.getTime() !== at.getTime()) : [...offer, at].sort(soonestFirst);
    if (next.length >= 2) change({ offer: next });
  };
  /* Offering these times: the ones on the cards, a time from the week among them. The week picks one time, so it closes. */
  const offerThese = () => { onWide(false); change({ offer: shown.map((s) => s.at).sort(soonestFirst), repeat: { ...draft.repeat, kind: 'none' } }); };
  const go = () => {
    if (chosen) onNext(offer?.[0] ?? chosen);
  };
  /* The best time is already picked, so once they're in, Enter takes it. */
  const button = useRef<HTMLButtonElement>(null);
  const ready = !times.loading;
  useEffect(() => { if (ready) button.current?.focus({ preventScroll: true }); }, [ready]);
  /* With nothing to suggest, the week is the way on; and an offer goes if who it was for has changed. */
  useEffect(() => { if (empty) onWide(true); }, [empty, onWide]);
  useEffect(() => { if (ready && offer && !offerable) change({ offer: null }); }, [ready, offer, offerable, change]);
  return (
    <>
      <FlowBody back={back}>
        <h2>{everyone ? 'When works for everyone?' : 'When works?'}</h2>
        <p className="cf-sub">{times.loading ? 'Reading calendars…' : empty ? 'Nothing is free in the next two weeks. Pick a time from the week.' : whenLine({ guests, slots: times.slots, source: times.source, failed: times.failed, unknown: times.unknown })}</p>
        <div className={cn(wide && 'cf-split')}>
          <div className="min-w-0">
            <Times times={times} shown={shown} on={ticked} onPick={pick} />
            <div className="cf-bar">
              <Length minutes={draft.minutes} onChange={(minutes) => change({ minutes })} />
              {!wide && !offer && <button type="button" className="lk" onClick={() => onWide(true)}>Pick another time</button>}
            </div>
          </div>
          {wide && <Week emails={emails} chosen={chosen} minutes={draft.minutes} onPick={(at) => change({ at })} />}
        </div>
        <div className="cf-rows">
          {!offer && <RepeatRow repeat={draft.repeat} at={chosen} onChange={(repeat) => change({ repeat })} />}
          {canOffer && guest && (
            <FlowRow icon="calClock" title={`Let ${callName(guest)} pick`} sub="Offer these times instead of choosing one"
              end={<Switch checked={!!offer} label={`Let ${callName(guest)} pick`} onChange={(on) => { if (on) offerThese(); else change({ offer: null }); }} />} />
          )}
        </div>
      </FlowBody>
      <FlowFoot summary={!team && guest ? `${callName(guest)} sees it in their own time zone.` : undefined}>
        <Button ref={button} variant="primary" disabled={!chosen} onClick={go}>
          {offer ? `Offer ${offer.length} times` : chosen ? `Use ${shortTime(chosen, times.now)}` : 'Pick a time'}
        </Button>
      </FlowFoot>
    </>
  );
}
