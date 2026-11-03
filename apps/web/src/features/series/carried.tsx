/*
 * What carries over in a series, item by item: a decision, an open question or a follow-up, each
 * with the call it came from (a link to its notes) and the moment it was said (a link into them).
 * Home shows them as they are; the series page adds what people can change.
 */
import { errorMessage, type CarriedAction, type CarriedDecision, type CarriedQuestion, type SeriesNote } from '@alcove/api';
import { Avatar, Chip, Icon, cn, useToast } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { MomentLink, decisionLine } from '~/features/notes/parts';
import { freshCalls, useOpenComposer } from '~/features/shell/context';
import { listNames, sameEmail, spokenName } from '~/lib/people';
import { useScheduleNext } from '~/lib/queries';
import { hm, shortDay } from '~/lib/time';

/** The call something came from, as a link to its notes. */
function From({ note }: { note: SeriesNote | undefined }) {
  return note ? <Link to="/notes/$noteId" params={{ noteId: note.id }} className="carry-from">{shortDay(new Date(note.startedAt))}</Link> : null;
}

/** How long something has stayed unsettled: nothing from the latest call, a line after that, and a caution chip once it's stale. */
function Lingering({ later, stale, what }: { later: number; stale: boolean; what: string }) {
  if (!later) return null;
  const text = `${what} ${later} call${later === 1 ? '' : 's'} later`;
  return stale ? <Chip tone="caution" icon="clock">{text}</Chip> : <span>{text}</span>;
}

function Row({ glyph, noteId, at, meta, className, children }: { glyph: ReactNode; noteId: string; at?: number | undefined; meta: ReactNode; className?: string | undefined; children: ReactNode }) {
  return (
    <div className={cn('carry', className)}>
      <span className="g">{glyph}</span>
      <div className="carry-b"><span className="t">{children}</span><span className="m">{meta}</span></div>
      {at !== undefined ? <MomentLink noteId={noteId} at={at} /> : <span />}
    </div>
  );
}

const DECIDED_GLYPH = { confirmed: 'check', superseded: 'swap' } as const;

/** A decision from an earlier call: confirmed, no longer holding, or not confirmed yet. `actions` are what the reader can change. */
export function CarriedDecisionRow({ d, note, me, actions }: { d: CarriedDecision; note: SeriesNote | undefined; me: string | undefined; actions?: ReactNode }) {
  const glyph = d.state === 'confirmed' || d.state === 'superseded' ? <Icon name={DECIDED_GLYPH[d.state]} size={15} /> : <span className="pend" />;
  return <Row className={d.state} glyph={glyph} noteId={d.noteId} at={d.at} meta={<><From note={note} /><span>{decisionLine(d, me)}</span>{actions}</>}>{d.text}</Row>;
}

/** A question an earlier call left open, and how many calls it has stayed open through. */
export function CarriedQuestionRow({ x, note, actions }: { x: CarriedQuestion; note: SeriesNote | undefined; actions?: ReactNode }) {
  return <Row glyph={<Icon name="ask" size={15} />} noteId={x.noteId} at={x.at} meta={<><From note={note} /><Lingering later={x.later} stale={x.stale} what="Still open" />{actions}</>}>{x.text}</Row>;
}

/** Who a follow-up is with, briefly: taken on, only suggested, or nobody's yet. */
function owned(a: CarriedAction, me: string | undefined): string {
  if (!a.owner) return 'Nobody is on this yet';
  const mine = !!me && !!a.owner.person && sameEmail(a.owner.person, { email: me });
  if (a.takenOn) return mine ? 'You took this on' : `${spokenName(a.owner, me)} took this on`;
  return `Suggested for ${mine ? 'you' : spokenName(a.owner, me)}`;
}

/**
 * A follow-up from an earlier call: who it's with, when it's due, and whether it has stayed undone
 * through later calls. `check` takes the owner's place when the reader can tick it.
 */
export function CarriedActionRow({ a, note, me, check, actions }: { a: CarriedAction; note: SeriesNote | undefined; me: string | undefined; check?: ReactNode; actions?: ReactNode }) {
  const glyph = check ?? (a.owner ? <Avatar person={a.owner.person ?? { name: a.owner.name }} size={20} /> : <span className="pend" />);
  return (
    <Row className={cn('act-row', a.done && 'done', !a.takenOn && 'maybe')} glyph={glyph} noteId={a.noteId} at={a.at}
      meta={<><From note={note} /><span>{a.done ? 'Done' : owned(a, me)}</span>{a.due && !a.done && <span>Due {a.due}</span>}{!a.done && <Lingering later={a.later} stale={a.stale} what="Not done" />}{actions}</>}>
      {a.text}
    </Row>
  );
}

/**
 * Schedules the next call after `meetingId`, a week on, and says when: on the calendar, with who's
 * invited. "Change" opens it in the composer, for another day or time, or to cancel it.
 */
export function useScheduleNextCall() {
  const next = useScheduleNext();
  const toast = useToast();
  const open = useOpenComposer();
  return {
    pending: next.isPending,
    run: (meetingId: string) => next.mutate({ meetingId }, {
      onSuccess: (m) => {
        freshCalls.add(m.id);
        const where = m.calendarUrl ? 'your Google Calendar' : 'your calendar';
        const n = m.guests.length;
        const who = !n ? '' : m.calendarUrl ? ` ${listNames(m.guests)} ${n > 1 ? 'get invitations' : 'gets an invitation'}.` : ` ${listNames(m.guests)} ${n > 1 ? 'are' : 'is'} invited.`;
        toast(`On ${where} for ${shortDay(new Date(m.startsAt))}, ${hm(m.startsAt)}.${who}`, { icon: 'cal', ms: 6000, action: { label: 'Change', onClick: () => open(m) } });
      },
      onError: (e) => toast(errorMessage(e), { icon: 'x' })
    })
  };
}
