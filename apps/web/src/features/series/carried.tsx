/*
 * What carries over in a series, item by item: a decision, an open question or a follow-up, each
 * with the call it came from (a link to its notes, at its breakout room's section when it's a room's)
 * and the moment it was said (a link into them), and where a later call seems to have replaced or
 * answered it. A call and its pre-join show them as they are; the series page adds what people can
 * change, and who said the notes got a later call wrong.
 */
import { errorMessage, type CarriedAction, type CarriedDecision, type CarriedQuestion, type LaterCall, type RoomRef, type SeriesNote } from '@alcove/api';
import { Avatar, Button, Chip, Icon, cn, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { MomentLink, decisionLine, inNote, useNotesApart } from '~/features/notes/parts';
import { freshCalls, useCallFlow } from '~/features/shell/context';
import { listNames, sameEmail, spokenName } from '~/lib/people';
import { calendarConnectUrl, q, useScheduleNext } from '~/lib/queries';
import { hm, shortDay } from '~/lib/time';

/** The calls of a series whose notes you have, by note: what an item, and a later call, are looked up in. */
export type SeriesCalls = Map<string, SeriesNote>;

/** The call something came from, as a link to its notes: at its breakout room's section, when it's a room's. */
function From({ note, room }: { note: SeriesNote | undefined; room?: RoomRef | undefined }) {
  const apart = useNotesApart();
  return note ? <Link to="/notes/$noteId" params={{ noteId: note.id }} {...inNote(undefined, room)} {...apart} className="carry-from">{shortDay(new Date(note.startedAt))}{room ? ` · ${room.name}` : ''}</Link> : null;
}

/**
 * Where a later call came back to something, under it: the later call as a link, into the moment and breakout room
 * it happened in, then what the notes think happened. `actions` are what the reader can say about it.
 */
function Later({ later, calls, before, after, actions }: { later: LaterCall; calls: SeriesCalls; before?: string | undefined; after: ReactNode; actions?: ReactNode }) {
  const apart = useNotesApart();
  const note = calls.get(later.noteId);
  return (
    <span className="carry-later">
      <Icon name="swap" size={13} />
      <span>{before}{note ? <Link to="/notes/$noteId" params={{ noteId: note.id }} {...inNote(later.at, later.room)} {...apart} className="carry-from">{shortDay(new Date(note.startedAt))}{later.room ? ` · ${later.room.name}` : ''}</Link> : 'A later call'}{after}</span>
      {actions && <span className="acts">{actions}</span>}
    </span>
  );
}

/** Who said the notes got a later call wrong, as the reader calls them. */
const whoSaid = (later: LaterCall, me: string | undefined) => (later.dismissed ? `${spokenName({ name: later.dismissed.by.name, person: later.dismissed.by }, me)} said ` : '');

/** How long something has stayed unsettled: nothing from the latest call, a line after that, and a caution chip once it's stale. */
function Lingering({ later, stale, what }: { later: number; stale: boolean; what: string }) {
  if (!later) return null;
  const text = `${what} ${later} call${later === 1 ? '' : 's'} later`;
  return stale ? <Chip tone="caution" icon="clock">{text}</Chip> : <span>{text}</span>;
}

function Row({ glyph, noteId, room, at, meta, later, className, children }: { glyph: ReactNode; noteId: string; room?: RoomRef | undefined; at?: number | undefined; meta: ReactNode; later?: ReactNode; className?: string | undefined; children: ReactNode }) {
  return (
    <div className={cn('carry', className)}>
      <span className="g">{glyph}</span>
      <div className="carry-b"><span className="t">{children}</span><span className="m">{meta}</span>{later}</div>
      {at !== undefined ? <MomentLink noteId={noteId} at={at} room={room} /> : <span />}
    </div>
  );
}

const DECIDED_GLYPH = { confirmed: 'check', superseded: 'swap' } as const;

/**
 * A decision from an earlier call: confirmed, no longer holding, or not confirmed yet, and the later decision that seems
 * to replace it. `actions` are what the reader can change; `laterActions`, what they can say about that. `saidWrong`
 * shows a later call someone said the notes got wrong too: everywhere else it's as if it was never suggested.
 */
export function CarriedDecisionRow({ d, calls, me, actions, laterActions, saidWrong = false }: { d: CarriedDecision; calls: SeriesCalls; me: string | undefined; actions?: ReactNode; laterActions?: ReactNode; saidWrong?: boolean | undefined }) {
  const glyph = d.state === 'confirmed' || d.state === 'superseded' ? <Icon name={DECIDED_GLYPH[d.state]} size={15} /> : <span className="pend" />;
  const by = d.replacedBy;
  const later = by && (by.dismissed ? saidWrong && <Later later={by} calls={calls} before={whoSaid(by, me)} after={` didn’t replace this: ${by.text}`} actions={laterActions} />
    : d.state === 'superseded' ? <Later later={by} calls={calls} before="Replaced on " after={`: ${by.text}`} actions={laterActions} />
      : <Later later={by} calls={calls} after={` may have replaced this: ${by.text}`} actions={laterActions} />);
  return <Row className={d.state} glyph={glyph} noteId={d.noteId} room={d.room} at={d.at} later={later} meta={<><From note={calls.get(d.noteId)} room={d.room} /><span>{decisionLine(d, me)}</span>{actions}</>}>{d.text}</Row>;
}

/**
 * A question an earlier call left: how many calls it has stayed open through, and where a later call seems to answer it.
 * Once someone says it was, the later call is where. `laterActions` are what the reader can say about that. `saidWrong`
 * shows a later call someone said the notes got wrong too, as for a decision.
 */
export function CarriedQuestionRow({ x, calls, me, actions, laterActions, saidWrong = false }: { x: CarriedQuestion; calls: SeriesCalls; me: string | undefined; actions?: ReactNode; laterActions?: ReactNode; saidWrong?: boolean | undefined }) {
  const by = x.answeredIn;
  const later = by && (by.dismissed ? saidWrong && <Later later={by} calls={calls} before={whoSaid(by, me)} after=" didn’t answer this" actions={laterActions} />
    : x.state === 'answered' ? <Later later={by} calls={calls} before="Answered on " after="" actions={laterActions} />
      : <Later later={by} calls={calls} after=" may have answered this" actions={laterActions} />);
  const glyph = <Icon name={x.state === 'answered' ? 'check' : 'ask'} size={15} />;
  return <Row className={x.state === 'answered' ? 'answered' : undefined} glyph={glyph} noteId={x.noteId} room={x.room} at={x.at} later={later} meta={<><From note={calls.get(x.noteId)} room={x.room} />{x.state === 'open' && <Lingering later={x.later} stale={x.stale} what="Still open" />}{actions}</>}>{x.text}</Row>;
}

/** Who a follow-up is with, briefly: taken on, only suggested, or nobody's yet. Until it's taken on, who and when are only what the notes heard. */
function owned(a: CarriedAction, me: string | undefined): string {
  if (!a.owner) return 'Nobody is on this yet';
  const mine = !!me && !!a.owner.person && sameEmail(a.owner.person, { email: me });
  if (a.takenOn) return mine ? 'You took this on' : `${spokenName(a.owner, me)} took this on`;
  return `Suggested for ${mine ? 'you' : spokenName(a.owner, me)}`;
}
/** When a follow-up is due, as much as anyone said: a date is someone's word only once it's taken on. */
const dueLine = (a: CarriedAction) => (a.takenOn ? `Due ${a.due}` : `Suggested due ${a.due}`);

/**
 * A follow-up from an earlier call: who it's with, when it's due, and whether it has stayed undone
 * through later calls. `check` takes the owner's place when the reader can tick it.
 */
export function CarriedActionRow({ a, calls, me, check, actions }: { a: CarriedAction; calls: SeriesCalls; me: string | undefined; check?: ReactNode; actions?: ReactNode }) {
  const glyph = check ?? (a.owner ? <Avatar person={a.owner.person ?? { name: a.owner.name }} size={20} /> : <span className="pend" />);
  return (
    <Row className={cn('act-row', a.done && 'done', !a.takenOn && 'maybe')} glyph={glyph} noteId={a.noteId} room={a.room} at={a.at}
      meta={<><From note={calls.get(a.noteId)} room={a.room} /><span>{a.done ? 'Done' : owned(a, me)}</span>{a.due && !a.done && <span>{dueLine(a)}</span>}{!a.done && <Lingering later={a.later} stale={a.stale} what="Not done" />}{actions}</>}>
      {a.text}
    </Row>
  );
}

/**
 * For the organizer of a series that follows a recurring Google Calendar event: its next call is the
 * next occurrence there, which Home shows (`children` says so). Once the calendar isn't connected,
 * Home can't show it, so this says what to do instead.
 */
export function NextOnCalendar({ children }: { children: ReactNode }) {
  const calendar = useQuery(q.calendar()).data;
  if (!calendar || (!calendar.needsAccess && calendar.source !== 'none')) return children;
  return (
    <>
      <p className="ser-p">This series follows a repeating event on your Google Calendar, which isn’t connected now. Connect it again to see the next one on Home and make it an Alcove call.</p>
      <Button icon="cal" className="ser-btn" onClick={() => location.assign(calendarConnectUrl())}>Connect Google Calendar</Button>
    </>
  );
}

/**
 * Schedules the next call after `meetingId`, at the same clock time a week on, and says when: on the
 * calendar, with who's invited. "Change" opens its card, for another day or time, or to cancel it.
 */
export function useScheduleNextCall() {
  const next = useScheduleNext();
  const toast = useToast();
  const flow = useCallFlow();
  return {
    pending: next.isPending,
    run: (meetingId: string) => next.mutate({ meetingId }, {
      onSuccess: (m) => {
        freshCalls.add(m.id);
        const where = m.calendarUrl ? 'your Google Calendar' : 'your calendar';
        const n = m.guests.length;
        const who = !n ? '' : m.calendarUrl ? ` ${listNames(m.guests)} ${n > 1 ? 'get invitations' : 'gets an invitation'}.` : ` ${listNames(m.guests)} ${n > 1 ? 'are' : 'is'} invited.`;
        toast(`On ${where} for ${shortDay(new Date(m.startsAt))}, ${hm(m.startsAt)}.${who}`, { icon: 'cal', ms: 6000, action: { label: 'Change', onClick: () => flow.open(m) } });
      },
      onError: (e) => toast(errorMessage(e), { icon: 'x' })
    })
  };
}
