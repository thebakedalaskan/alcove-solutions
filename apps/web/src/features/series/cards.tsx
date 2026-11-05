/*
 * A series where people look after a call: beside a call's notes, the series it's in and its next call, or a
 * way to start one. `CarriedGroups` is what carries over itself, which a call and its pre-join show. Everything
 * comes from the notes the reader has, put together when they look.
 */
import { firstName, minutesLabel, type CarriedDecision, type Note, type Series, type SeriesNote } from '@alcove/api';
import { ArchThumb, Button, Card, Chip, Icon, coverFor } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { q } from '~/lib/queries';
import { daysFromToday, hm, shortDay, weekday } from '~/lib/time';
import { useNotesApart } from '~/features/notes/parts';
import { CarriedActionRow, CarriedDecisionRow, CarriedQuestionRow, NextOnCalendar, useScheduleNextCall } from './carried';

/** At most this many of each, unless a page says otherwise; the series page has the rest. */
const SHOWN = 3;

const calls = (n: number) => `${n} call${n === 1 ? '' : 's'}`;

export function SeriesLink({ seriesId, children }: { seriesId: string; children: ReactNode }) {
  return <Link to="/notes/series/$seriesId" params={{ seriesId }} {...useNotesApart()}>{children}</Link>;
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
    taken: s.actions.filter((a) => !a.done && a.takenOn),
    untaken: s.actions.filter((a) => !a.done && !a.takenOn),
    done: s.actions.filter((a) => a.done)
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
          {s.questions.slice(0, shown).map((x) => <CarriedQuestionRow key={x.id} x={x} calls={from} me={me} />)}
          {also([[s.questions.length - shown, 'more still open']])}
        </Group>
      )}
      {s.actions.length > 0 && (
        <Group label="Follow-ups" count={taken.length ? `${taken.length} taken on` : undefined}>
          {todo.slice(0, shown).map((a) => <CarriedActionRow key={a.id} a={a} calls={from} me={me} />)}
          {also(open ? [[todo.length - shown, 'more follow-ups'], [done.length, 'done since the last call']] : [[taken.length - shown, 'more taken on'], [untaken.length, 'not taken on yet'], [done.length, 'done since the last call']])}
        </Group>
      )}
      {(stopped.length > 0 || s.answered.length > 0) && (
        <Group label="Settled since the last call">
          {stopped.slice(0, shown).map((d) => <CarriedDecisionRow key={d.id} d={d} calls={from} me={me} />)}
          {s.answered.slice(0, shown).map((x) => <CarriedQuestionRow key={x.id} x={x} calls={from} me={me} />)}
          {also([[stopped.length - shown, 'more no longer hold'], [s.answered.length - shown, 'more answered']])}
        </Group>
      )}
    </div>
  );
}

/** Whether there's nothing for `CarriedGroups` to show: a decision that stopped holding before the latest call isn't news. */
export function nothingCarried(s: Series): boolean {
  const c = carriedFrom(s);
  return !c.decided.length && !c.unconfirmed.length && !c.stopped.length && !s.questions.length && !s.answered.length && !s.actions.length;
}

/** Days between two calls, by the calendar. */
const apart = (a: SeriesNote, b: SeriesNote) => daysFromToday(new Date(a.startedAt)) - daysFromToday(new Date(b.startedAt));
/** "Every Tuesday" when the series' last three calls you have were a week apart; otherwise nothing. */
export function weeklyLabel(s: Series): string | undefined {
  const [a, b, c] = s.notes;
  return a && b && c && apart(a, b) === 7 && apart(b, c) === 7 ? `Every ${weekday(new Date(a.startedAt))}` : undefined;
}

/** Beside a note's state: the series its call is in, "Every Tuesday" or "In a series". */
export function SeriesChip({ seriesId }: { seriesId: string }) {
  const s = useQuery(q.series(seriesId)).data;
  return <Chip tone="outline" icon="history">{(s && weeklyLabel(s)) ?? 'In a series'}</Chip>;
}

/** Beside a call's notes: the series it's in, or for the organizer, a way to meet again. Room recordings have neither. */
export function SeriesCard({ note }: { note: Note }) {
  if (note.kind !== 'call' || note.status === 'recording') return null;
  if (note.seriesId) return <InSeries seriesId={note.seriesId} noteId={note.id} />;
  return !note.received && note.meetingId ? <MeetAgain meetingId={note.meetingId} /> : null;
}

function MeetAgain({ meetingId }: { meetingId: string }) {
  const next = useScheduleNextCall();
  return (
    <Card title="Meet again">
      <p className="ser-p">Schedule the next call with the same people, a week on. What’s decided and still open here carries over to it.</p>
      <Button icon="repeat" className="ser-btn" loading={next.pending} onClick={() => next.run(meetingId)}>Schedule next week’s call</Button>
    </Card>
  );
}

/* The series' other calls shown beside a note; the series page has them all. */
const OTHER_CALLS = 3;

/** The series a note's call is in: its other calls, newest first, what's still open across them, and for the organizer the next call. */
function InSeries({ seriesId, noteId }: { seriesId: string; noteId: string }) {
  const s = useQuery(q.series(seriesId)).data;
  const notes = useQuery(q.notes()).data;
  const next = useScheduleNextCall();
  if (!s) return null;
  const others = s.notes.filter((n) => n.id !== noteId).slice(0, OTHER_CALLS);
  /* Under each call's day, the start of its summary, from the notes list. */
  const gist = (n: SeriesNote) => (n.status === 'ready' ? notes?.find((x) => x.id === n.id)?.excerpt || n.title : 'Notes being written');
  const latest = s.notes.find((n) => n.meetingId)?.meetingId;
  const questions = s.questions.length;
  const actions = s.actions.filter((a) => !a.done).length;
  const open = [questions ? `${questions} question${questions === 1 ? '' : 's'}` : '', actions ? `${actions} follow-up${actions === 1 ? '' : 's'}` : ''].filter(Boolean);
  const across = s.isOrganizer ? (s.notes.length === 1 ? 'from its first call' : `across its ${calls(s.notes.length)}`) : 'across the calls you have notes from';
  return (
    <Card title={weeklyLabel(s) ?? 'In a series'} aside={<Link to="/notes/series/$seriesId" params={{ seriesId }} aria-label={`All ${calls(s.notes.length + s.older)} in this series`}>All<Icon name="right" size={14} /></Link>}>
      {others.length > 0 && (
        <div className="ser-rows">
          {others.map((n) => (
            <Link key={n.id} to="/notes/$noteId" params={{ noteId: n.id }}>
              <ArchThumb cover={coverFor(n.id)} width={20} />
              <span className="min-w-0"><b>{new Date(n.startedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</b><small className="ac-clamp-1">{gist(n)}</small></span>
              <span className="ac-mono">{minutesLabel(n.duration)}</span>
            </Link>
          ))}
        </div>
      )}
      <p className="ser-p">
        {s.isOrganizer ? '' : `From ${firstName(s.organizer.name)}’s calls. `}
        {open.length ? `${open.join(' and ')} ${questions + actions === 1 ? 'is' : 'are'} still open ${across}.` : `Nothing is left open ${across}.`}
      </p>
      {s.isOrganizer && (s.next
        ? <div className="ser-next"><Icon name="cal" size={15} /><span>Next call <b className="ac-mono">{shortDay(new Date(s.next.startsAt))}, {hm(s.next.startsAt)}</b></span></div>
        : s.recurring
          ? <NextOnCalendar><div className="ser-next"><Icon name="cal" size={15} /><span>The next one is on your Google Calendar.</span></div></NextOnCalendar>
          : latest && <Button icon="repeat" className="ser-btn" loading={next.pending} onClick={() => next.run(latest)}>Schedule next week’s call</Button>)}
    </Card>
  );
}
