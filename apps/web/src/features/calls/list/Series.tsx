/*
 * A series of calls on Calls' sheet: its name, how it repeats and how many calls you have notes from; its next call; the
 * calls so far, each led by its date; and what carries over from them (questions still open, follow-ups, decisions), each
 * with its moment, settled right here as far as the reader may. Asking across the calls sits at its foot. A series you're
 * invited to but have no notes from yet still shows its next call.
 */
import { errorCode, errorMessage, isAcceptedFollowUp, mayChangeAction, mayDecide, maySayNotReplaced, type CarriedAction, type CarriedDecision, type CarriedQuestion, type DecisionPatch, type Inbox, type LaterCall, type NoteFound, type Series } from '@alcove/api';
import { Button, CallsGroup, CallsMore, CarryRow, Check, EmptyState, Icon, MomentChip, SheetHead, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useOpenScheduling } from '~/features/calls/scheduling/search';
import { repeatLineHere } from '~/features/calls/scheduling/words';
import { useNoteReader } from '~/features/notes/entries';
import { readerRole } from '~/features/notes/meta';
import { AskBar, decisionLine, inNote, notDecided } from '~/features/notes/parts';
import { NextOnCalendar, useScheduleNextCall } from '~/features/notes/series/carried';
import { api } from '~/lib/api';
import { sameEmail, spokenName } from '~/lib/people';
import { useUpdateAction, useUpdateDecision, useUpdateQuestion, useUpdateRevisit } from '~/features/notes/queries';
import { seriesQueries } from '~/features/notes/series/queries';
import { dayMonth, hm, position, shortDay, timeZone } from '~/lib/time';
import { plural } from '~/lib/words';
import { type Ahead } from './ahead';
import { pastGroups } from './past';
import { AheadRow, PastRow } from './Rows';

/** Calls so far shown before All N calls opens the rest. */
const SO_FAR = 4;
const SUGGESTIONS = ['What did we decide, and why?', 'What’s still open?', 'What have I taken on?'];

export function SeriesView({ id, next, notes, inbox, pinned, me, now, toAll }: {
  id: string;
  /** Its next call, from what's ahead: yours, one you're invited to, or the next occurrence on your calendar. */
  next: Ahead | undefined;
  notes: NoteFound[]; inbox: Inbox | undefined; pinned: readonly string[]; me: string | undefined; now: number;
  /** Where to go when it isn't here. */
  toAll: ReactNode;
}) {
  // A read that fails keeps the last answer, which would keep showing calls someone may not read any more.
  const read = useQuery({ ...seriesQueries.series(id), retry: (n, e) => errorCode(e) !== 'not-found' && n < 2 });
  const gone = read.isError && errorCode(read.error) === 'not-found';
  const s = read.isError ? undefined : read.data;
  if (read.isPending) return <SheetHead title={next?.title ?? 'Series'} />;
  if (!s && !next) {
    return gone
      ? <EmptyState className="cs-empty" title="This series isn’t here" action={toAll}>Its calls’ notes were deleted, or none of them were given to you.</EmptyState>
      : <EmptyState className="cs-empty" title="Couldn’t open this series" action={<Button variant="primary" icon="retry" onClick={() => void read.refetch()}>Try again</Button>}>{read.isError ? errorMessage(read.error) : ''}</EmptyState>;
  }
  return <SeriesOf s={s} next={next} notes={notes} inbox={inbox} pinned={pinned} me={me} now={now} />;
}

/** How a series repeats, and when: "Every weekday at 09:00". */
function repeatsLine(s: Series | undefined, next: Ahead | undefined): string | undefined {
  const call = next?.kind === 'call' ? next.call : s?.next;
  const repeat = s?.repeat ?? call?.repeat;
  if (repeat && call) return `${repeatLineHere(repeat, new Date(call.startsAt))} at ${hm(call.startsAt)}`;
  return s?.recurring || next?.kind === 'event' ? 'Repeats on your Google Calendar' : undefined;
}

function SeriesOf({ s, next, notes, inbox, pinned, me, now }: { s: Series | undefined; next: Ahead | undefined; notes: NoteFound[]; inbox: Inbox | undefined; pinned: readonly string[]; me: string | undefined; now: number }) {
  const schedule = useOpenScheduling();
  const [all, setAll] = useState(false);
  const calls = s ? s.notes.length + s.older : 0;
  const title = s?.title ?? next?.title ?? '';
  const sub = [repeatsLine(s, next), s ? (calls ? plural(calls, 'call') : 'No call in it has notes yet') : undefined].filter((x) => x !== undefined).join(' · ');
  const organizer = s?.isOrganizer ?? (next?.kind === 'call' && next.call.isOrganizer);
  const changeable = organizer && next?.kind === 'call' && next.call.status === 'scheduled' && !next.call.offer;
  const sofar = (s?.notes ?? []).flatMap((x) => notes.filter((n) => n.id === x.id));
  const shown = all ? sofar : sofar.slice(0, SO_FAR);
  const groups = pastGroups(shown, new Date(now));
  return (
    <>
      <SheetHead title={title} sub={sub || undefined}
        actions={changeable && next.kind === 'call' ? <Button size="sm" icon="cal" onClick={() => schedule({ schedule: 'move', meeting: next.call.id })}>Change the series</Button> : undefined} />
      {next ? <CallsGroup label="Next" soon><AheadRow a={next} me={me} now={now} /></CallsGroup> : s && organizer ? <NothingNext s={s} /> : null}
      {groups.map((g, i) => (
        <CallsGroup key={g.label} label={g.label}
          more={i === groups.length - 1 && !all && sofar.length > SO_FAR ? <CallsMore onSelect={() => setAll(true)}>All {plural(sofar.length, 'call')} in this series</CallsMore> : undefined}>
          {g.rows.map((n) => <PastRow key={n.id} n={n} me={me} now={now} inbox={inbox} pinned={pinned.includes(n.id)} series />)}
        </CallsGroup>
      ))}
      {s && s.older > 0 && <p className="cs-none">{plural(s.older, 'older call')} {s.older === 1 ? 'isn’t' : 'aren’t'} shown, and nothing carries over from {s.older === 1 ? 'it' : 'them'}: only the newest {s.notes.length} count.</p>}
      {s && <Carried s={s} me={me} />}
      {s?.notes.some((n) => n.status === 'ready') && <AskBar label="Ask about these calls" waiting="Reading the calls" suggestions={SUGGESTIONS} ask={(text) => api.series.ask(s.id, text, timeZone())} />}
    </>
  );
}

/** For the organizer, with nothing scheduled next: Schedule next week's call, or where a calendar's series has its next one. */
function NothingNext({ s }: { s: Series }) {
  const next = useScheduleNextCall();
  const latest = s.notes.find((n) => n.meetingId)?.meetingId;
  return (
    <CallsGroup label="Next" soon>
      {s.recurring
        ? <div className="cs-none"><NextOnCalendar><span>The next one is on your Google Calendar. It shows here once it’s coming up.</span></NextOnCalendar></div>
        : (
          <p className="cs-none cs-next">
            <span>Nothing is scheduled. The next call gets the same people and notes setting.</span>
            {latest && <Button size="sm" icon="repeat" loading={next.pending} onClick={() => next.run(latest)}>Schedule next week’s call</Button>}
          </p>
        )}
    </CallsGroup>
  );
}

/** Why nothing carries over: no notes yet, notes still being written, or nothing left to carry. */
function nothing(s: Series): string {
  if (!s.notes.length) return 'Once a call in this series has notes, what it decided, left open and handed out shows here.';
  if (!s.notes.some((n) => n.status === 'ready')) return 'The notes are still being written. What the call decided and left open shows here once they are.';
  return 'Nothing is left open from earlier calls.';
}

/** Where something was said: its moment in the call it came from, or the call when the notes can't tell. */
function From({ s, noteId, at, room }: { s: Series; noteId: string; at: number | undefined; room: CarriedQuestion['room'] }) {
  const call = s.notes.find((n) => n.id === noteId);
  if (!call) return null;
  const day = shortDay(new Date(call.startedAt));
  const label = `Open ${call.title}, ${day}${at === undefined ? '' : `, at ${position(at)}`}${room ? `, in ${room.name}` : ''}`;
  return <MomentChip time={at === undefined ? dayMonth(new Date(call.startedAt)) : position(at)} label={label} link={(p) => <Link to="/calls/$noteId" params={{ noteId }} {...inNote(at, room)} {...p} />} />;
}

/** Where a later call came back to something: which call, and what the notes think it did, with what the reader can say. */
function Later({ s, later, before, after, actions }: { s: Series; later: LaterCall; before?: string | undefined; after: string; actions?: ReactNode }) {
  const call = s.notes.find((n) => n.id === later.noteId);
  return (
    <span className="carry-later">
      <Icon name="swap" size={13} />
      <span>{before}{call ? <Link to="/calls/$noteId" params={{ noteId: call.id }} {...inNote(later.at, later.room)} className="carry-from">{shortDay(new Date(call.startedAt))}{later.room ? ` · ${later.room.name}` : ''}</Link> : 'A later call'}{after}</span>
      {actions && <span className="acts">{actions}</span>}
    </span>
  );
}

/** What carries over, settled in place: questions still open, then follow-ups, then decisions, each where it stands. */
function Carried({ s, me }: { s: Series; me: string | undefined }) {
  const toast = useToast();
  const decision = useUpdateDecision();
  const question = useUpdateQuestion();
  const action = useUpdateAction();
  const revisit = useUpdateRevisit();
  const readerAs = useNoteReader();
  const failed = (e: unknown) => toast(errorMessage(e), { icon: 'x' });
  const from = new Map(s.notes.map((n) => [n.id, n]));
  /** Who the reader is to the call something came from: each call's notes reached people their own way. */
  const reader = (x: { noteId: string }) => readerAs(s.isOrganizer ? 'organizer' : readerRole(from.get(x.noteId)?.received));
  const change = (d: CarriedDecision, patch: DecisionPatch) => decision.mutate({ noteId: d.noteId, decisionId: d.id, patch }, { onError: failed });
  const decide = (d: CarriedDecision, state: CarriedDecision['state']) => change(d, state === 'confirmed' ? { state, seen: { text: d.text } } : { state });
  const answer = (x: CarriedQuestion) => question.mutate({ noteId: x.noteId, questionId: x.id, patch: { state: 'answered' } }, { onSuccess: () => toast('Marked answered', { ms: 2200 }), onError: failed });
  const reopen = (x: CarriedQuestion) => question.mutate({ noteId: x.noteId, questionId: x.id, patch: { state: 'open' } }, { onError: failed });
  const wrong = (later: LaterCall, dismissed: boolean) => revisit.mutate({ noteId: later.noteId, revisitId: later.id, dismissed }, { onError: failed });
  const tick = (a: CarriedAction, done: boolean) => action.mutate({ noteId: a.noteId, actionId: a.id, patch: { done } }, { onSuccess: () => { if (done) toast('Marked done', { ms: 2200 }); }, onError: failed });
  const takeOn = (a: CarriedAction) => action.mutate({ noteId: a.noteId, actionId: a.id, patch: { takeOn: true, seen: { text: a.text, due: a.due ?? null } } }, { onSuccess: () => toast('It’s yours. Everyone with the notes sees that.', { icon: 'check' }), onError: failed });
  const mine = (a: CarriedAction) => !!me && !!a.owner?.person && sameEmail(a.owner.person, { email: me });
  const quiet = (label: string, go: () => void) => <Button variant="quiet" size="xs" onClick={go}>{label}</Button>;
  /** Who said the notes got a later call wrong. */
  const whoSaid = (later: LaterCall) => (later.dismissed ? `${spokenName({ name: later.dismissed.by.name, person: later.dismissed.by }, me)} said ` : '');

  const open = s.questions;
  const todo = s.actions.filter((a) => isAcceptedFollowUp(a));
  const decisions = s.decisions;
  const empty = !open.length && !s.answered.length && !todo.length && !decisions.length;

  const questionRow = (x: CarriedQuestion, settled: boolean) => {
    const by = x.answeredIn;
    const later = by && (by.dismissed
      ? <Later s={s} later={by} before={whoSaid(by)} after=" didn’t answer this" actions={quiet('Undo', () => wrong(by, false))} />
      : !settled ? <Later s={s} later={by} after=" may have answered this" actions={<>{quiet('It was answered', () => answer(x))}{quiet('It’s still open', () => wrong(by, true))}</>} />
        : <Later s={s} later={by} before="Answered on " after="" />);
    return (
      <CarryRow key={x.id} kind="ask" done={settled} later={later}
        sub={<>{settled ? 'Answered since the last call' : x.later ? `Still open, ${plural(x.later, 'call')} later` : 'Still open'}<From s={s} noteId={x.noteId} at={x.at} room={x.room} /></>}
        actions={settled ? quiet('It’s still open', () => reopen(x)) : by && !by.dismissed ? undefined : <Button size="xs" onClick={() => answer(x)}>It was answered</Button>}>
        {x.text}
      </CarryRow>
    );
  };
  const followRow = (a: CarriedAction) => {
    const who = !a.owner ? 'Nobody’s yet' : mine(a) ? (a.takenOn ? 'Yours' : 'Suggested for you') : `${spokenName(a.owner, me)}${a.takenOn ? '' : ', suggested'}`;
    const due = a.due ? `, due ${a.due}` : '';
    return (
      <CarryRow key={a.id} kind="follow" done={a.done}
        mark={mayChangeAction(a, reader(a)) ? <Check checked={a.done} onChange={(on) => tick(a, on)} label={`${a.done ? 'Mark not done' : 'Mark done'}: ${a.text}`} /> : undefined}
        sub={<>{a.done ? 'Done since the last call' : `${who}${due}`}<From s={s} noteId={a.noteId} at={a.at} room={a.room} /></>}
        actions={mine(a) && !a.takenOn && !a.done ? <Button size="xs" onClick={() => takeOn(a)}>I’ll do it</Button> : undefined}>
        {a.text}
      </CarryRow>
    );
  };
  const decisionRow = (d: CarriedDecision) => {
    const r = reader(d);
    const by = d.replacedBy;
    const sayNot = by && !by.dismissed && maySayNotReplaced(d, r) ? quiet(d.state === 'confirmed' ? 'It still holds' : 'It wasn’t replaced', () => wrong(by, true)) : undefined;
    const later = by && (by.dismissed ? <Later s={s} later={by} before={whoSaid(by)} after={` didn’t replace this: ${by.text}`} actions={maySayNotReplaced(d, r) ? quiet('Undo', () => wrong(by, false)) : undefined} />
      : d.state === 'superseded' ? <Later s={s} later={by} before="Replaced on " after={`: ${by.text}`} actions={sayNot} />
        : <Later s={s} later={by} after={` may have replaced this: ${by.text}`} actions={sayNot} />);
    const no = d.state === 'proposed' ? notDecided(d, r) : undefined;
    const actions = d.state === 'proposed'
      ? <>{mayDecide(d, 'confirmed', r) && <Button size="xs" onClick={() => decide(d, 'confirmed')}>Confirm</Button>}{no && quiet('It wasn’t decided', () => change(d, no))}</>
      : d.state === 'confirmed' && mayDecide(d, 'superseded', r) ? quiet('It no longer holds', () => decide(d, 'superseded'))
        : d.state === 'superseded' && mayDecide(d, 'confirmed', r) ? quiet('It still holds', () => decide(d, 'confirmed')) : undefined;
    return (
      <CarryRow key={d.id} kind="decide" done={d.state === 'superseded'} later={later}
        sub={<>{d.state === 'superseded' ? 'No longer holds' : decisionLine(d, me)}<From s={s} noteId={d.noteId} at={d.at} room={d.room} /></>} actions={actions}>
        {d.text}
      </CarryRow>
    );
  };
  return (
    <CallsGroup label="What carries over">
      {empty ? <p className="cs-none">{nothing(s)}</p> : (
        <>
          {open.map((x) => questionRow(x, false))}
          {todo.map(followRow)}
          {decisions.map(decisionRow)}
          {s.answered.map((x) => questionRow(x, true))}
        </>
      )}
    </CallsGroup>
  );
}
