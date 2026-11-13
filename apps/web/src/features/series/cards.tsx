/*
 * A series where people look before and during a call: what carries over from its earlier calls (`CarriedGroups`), which
 * a call and its pre-join show, and how it repeats, as a call's page says it. Everything comes from the notes the reader
 * has, put together when they look.
 */
import { isAcceptedFollowUp, type CarriedDecision, type Series, type SeriesNote } from '@alcove/api';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { daysFromToday, weekday } from '~/lib/time';
import { useNotesApart } from '~/features/notes/parts';
import { CarriedActionRow, CarriedDecisionRow, CarriedQuestionRow } from './carried';

/** At most this many of each, unless a page says otherwise; the series page has the rest. */
const SHOWN = 3;

export function SeriesLink({ seriesId, children }: { seriesId: string; children: ReactNode }) {
  return <Link to="/calls" search={{ series: seriesId }} {...useNotesApart()}>{children}</Link>;
}

function Group({ label, count, children }: { label: string; count?: string | number | undefined; children: ReactNode }) {
  return <div className="carry-g"><div className="ac-eyebrow">{label}{count ? <span>{count}</span> : null}</div>{children}</div>;
}

/** Why nothing carries over: no notes in the series yet, notes still being written, or nothing left to carry. */
export function nothingYet(s: Series): { title: string; text: string } {
  if (!s.notes.length) return { title: 'Nothing from earlier calls yet', text: 'When a call in this series has notes, what it decided and left open shows here before the next one.' };
  if (!s.notes.some((n) => n.status === 'ready')) return { title: 'The notes are still being written', text: 'What the last call decided and left open shows here once they are.' };
  return { title: 'Nothing carries over', text: 'Earlier calls didn’t decide anything or leave anything open.' };
}

/** When a decision last stopped holding, if it did. */
const stoppedAt = (d: CarriedDecision) => [...d.changes].reverse().find((c) => c.what === 'superseded')?.at;
/**
 * What carries over, sorted for reading: what people settled first (confirmed decisions, follow-ups someone took on),
 * what's still open, and what changed since the latest call. Decisions and follow-ups nobody has settled are told apart.
 */
export function carriedFrom(s: Series) {
  const since = s.notes[0]?.startedAt ?? '';
  return {
    decided: s.decisions.filter((d) => d.state === 'confirmed'),
    unconfirmed: s.decisions.filter((d) => d.state === 'proposed'),
    stopped: s.decisions.filter((d) => d.state === 'superseded' && (stoppedAt(d) ?? '') >= since),
    taken: s.actions.filter((a) => isAcceptedFollowUp(a) && !a.done && a.takenOn),
    untaken: s.actions.filter((a) => isAcceptedFollowUp(a) && !a.done && !a.takenOn),
    done: s.actions.filter((a) => isAcceptedFollowUp(a) && a.done)
  };
}
/** How many things carry over, as a call counts them: what's decided and what's still to settle. */
export function carriedCount(s: Series): number {
  const c = carriedFrom(s);
  return c.decided.length + s.questions.length + c.taken.length + c.untaken.length;
}

/**
 * What carries over, group by group, at most `shown` of each, with a way to the series for the rest. `open`: follow-ups
 * nobody took on are listed after the ones someone did, instead of being counted.
 */
export function CarriedGroups({ s, me, shown = SHOWN, open = false }: { s: Series; me: string | undefined; shown?: number | undefined; open?: boolean | undefined }) {
  const from = new Map(s.notes.map((n) => [n.id, n]));
  const { decided, unconfirmed, stopped, taken, untaken, done } = carriedFrom(s);
  const todo = open ? [...taken, ...untaken] : taken;
  const also = (bits: [number, string][]) => {
    const some = bits.filter(([n]) => n > 0);
    return some.length ? <div className="carry-more">{some.map(([n, what]) => <SeriesLink key={what} seriesId={s.id}>{n} {what}</SeriesLink>)}</div> : null;
  };
  return (
    <div className="carry-groups">
      {(decided.length > 0 || unconfirmed.length > 0) && (
        <Group label="Decisions" count={decided.length}>
          {decided.slice(0, shown).map((d) => <CarriedDecisionRow key={d.id} d={d} calls={from} me={me} />)}
          {also([[decided.length - shown, 'more decided'], [unconfirmed.length, 'not confirmed yet']])}
        </Group>
      )}
      {s.questions.length > 0 && (
        <Group label="Still open" count={s.questions.length}>
          {s.questions.slice(0, shown).map((x) => <CarriedQuestionRow key={x.id} x={x} calls={from} />)}
          {also([[s.questions.length - shown, 'more still open']])}
        </Group>
      )}
      {s.actions.some(isAcceptedFollowUp) && (
        <Group label="Follow-ups" count={taken.length ? `${taken.length} taken on` : undefined}>
          {todo.slice(0, shown).map((a) => <CarriedActionRow key={a.id} a={a} calls={from} me={me} />)}
          {also(open ? [[todo.length - shown, 'more follow-ups'], [done.length, 'done since the last call']] : [[taken.length - shown, 'more taken on'], [untaken.length, 'not taken on yet'], [done.length, 'done since the last call']])}
        </Group>
      )}
      {(stopped.length > 0 || s.answered.length > 0) && (
        <Group label="Settled since the last call">
          {stopped.slice(0, shown).map((d) => <CarriedDecisionRow key={d.id} d={d} calls={from} me={me} />)}
          {s.answered.slice(0, shown).map((x) => <CarriedQuestionRow key={x.id} x={x} calls={from} />)}
          {also([[stopped.length - shown, 'more no longer hold'], [s.answered.length - shown, 'more answered']])}
        </Group>
      )}
    </div>
  );
}

/** Whether there's nothing for `CarriedGroups` to show: a decision that stopped holding before the latest call isn't news. */
export function nothingCarried(s: Series): boolean {
  const c = carriedFrom(s);
  return !c.decided.length && !c.unconfirmed.length && !c.stopped.length && !s.questions.length && !s.answered.length && !s.actions.some(isAcceptedFollowUp);
}

/** Days between two calls, by the calendar. */
const apart = (a: SeriesNote, b: SeriesNote) => daysFromToday(new Date(a.startedAt)) - daysFromToday(new Date(b.startedAt));
/** "Every Tuesday" when the series' last three calls you have were a week apart; otherwise nothing. */
export function weeklyLabel(s: Series): string | undefined {
  const [a, b, c] = s.notes;
  return a && b && c && apart(a, b) === 7 && apart(b, c) === 7 ? `Every ${weekday(new Date(a.startedAt))}` : undefined;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const ORDINALS: Record<number, string> = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', [-1]: 'last' };

/**
 * How a series repeats, in a few words, as a call's page says it beside its title: "Every weekday", "Every other Tuesday",
 * "Every month on the first Thursday". Only its organizer is told the rule; anyone else gets "Every Tuesday" when the series'
 * last three calls they have were a week apart, and otherwise that it's a series.
 */
export function seriesLabel(s: Series): string {
  const rule = s.repeat?.rule;
  if (rule?.every === 'month') return `Every month on the ${ORDINALS[rule.week] ?? 'first'} ${WEEKDAYS[rule.day] ?? 'day'}`;
  if (rule?.every === 'week') {
    const days = [...rule.days].sort((a, b) => a - b);
    if (rule.weeks === 1 && days.join() === '1,2,3,4,5') return 'Every weekday';
    if (days.length === 7) return 'Every day';
    const named = days.map((d) => WEEKDAYS[d] ?? '').filter(Boolean);
    const list = named.length < 2 ? named.join('') : `${named.slice(0, -1).join(', ')} and ${named.at(-1) ?? ''}`;
    return rule.weeks === 2 ? `Every other ${list}` : `Every ${list}`;
  }
  return weeklyLabel(s) ?? 'In a series';
}
