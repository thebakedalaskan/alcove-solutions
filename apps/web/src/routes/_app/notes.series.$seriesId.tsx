import { isAcceptedFollowUp, errorCode, errorMessage, firstName, mayChangeAction, mayDecide, maySayNotReplaced, minutesLabel, type CarriedAction, type CarriedDecision, type CarriedQuestion, type DecisionPatch, type LaterCall, type Series } from '@alcove/api';
import { Button, Check, EmptyState, Evening, Icon, IconButton, buttonClass, cn, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { LineStrip, percent, share } from '~/features/notes/CallLine';
import { GonePage, PageHead } from '~/features/notes/Head';
import { useNoteReader } from '~/features/notes/entries';
import { AskBar, Section, notDecided } from '~/features/notes/parts';
import { CarriedActionRow, CarriedDecisionRow, CarriedQuestionRow, NextOnCalendar, useScheduleNextCall } from '~/features/series/carried';
import { useCallFlow } from '~/features/shell/context';
import { api } from '~/lib/api';
import { sameEmail } from '~/lib/people';
import { q, useUpdateAction, useUpdateDecision, useUpdateQuestion, useUpdateRevisit } from '~/lib/queries';
import { dayMonth, hm, longDay, noteDay, shortDay, timeZone } from '~/lib/time';

/*
 * A series as the reader sees it, on the same evening as a note: its calls on the horizon, what the calls they
 * have notes from decided, left open and handed out, with where each came from; asking across those calls; and, for
 * the organizer, the next call.
 */
export const Route = createFileRoute('/_app/notes/series/$seriesId')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(q.series(params.seriesId)),
  errorComponent: Missing,
  component: SeriesPage
});

function SeriesPage() {
  const { seriesId } = Route.useParams();
  const me = useQuery(q.session()).data?.user.email;
  // A failed read keeps the last answer, which would keep showing calls someone may not read any more.
  const s = useQuery({ ...q.series(seriesId), throwOnError: (e) => errorCode(e) === 'not-found' }).data;
  return s ? <SeriesView s={s} me={me} /> : null;
}

const SUGGESTIONS = ['What did we decide, and why?', 'What’s still open?', 'What have I taken on?'];

/** Why nothing carries over: no notes in the series yet, notes still being written, or nothing left to carry. */
function nothing(s: Series): { title: string; text: string } {
  if (!s.notes.length) return { title: 'Nothing carries over yet', text: 'Once a call in this series has notes, what it decided, left open and handed out shows here, for everyone who has them.' };
  if (!s.notes.some((n) => n.status === 'ready')) return { title: 'The notes are still being written', text: 'What the call decided and left open shows here once they are.' };
  return { title: 'Nothing carries over', text: 'The calls you have notes from didn’t decide anything or leave anything open.' };
}

function SeriesView({ s, me }: { s: Series; me: string | undefined }) {
  const toast = useToast();
  const decision = useUpdateDecision();
  const question = useUpdateQuestion();
  const action = useUpdateAction();
  const revisit = useUpdateRevisit();
  const failed = (e: unknown) => toast(errorMessage(e), { icon: 'x' });
  const from = new Map(s.notes.map((n) => [n.id, n]));
  const readerAs = useNoteReader();
  /** Who the reader is to the call something came from: the series is one organizer's, but each call's notes reached people their own way. */
  const reader = (x: { noteId: string }) => readerAs(s.isOrganizer ? 'organizer' : from.get(x.noteId)?.received?.role ?? 'shared');
  const change = (d: CarriedDecision, patch: DecisionPatch) => decision.mutate({ noteId: d.noteId, decisionId: d.id, patch }, { onError: failed });
  const decide = (d: CarriedDecision, state: CarriedDecision['state']) => change(d, state === 'confirmed' ? { state, seen: { text: d.text } } : { state });
  const answer = (x: CarriedQuestion) => question.mutate({ noteId: x.noteId, questionId: x.id, patch: { state: 'answered' } }, { onSuccess: () => toast('Marked answered', { ms: 2200 }), onError: failed });
  const reopen = (x: CarriedQuestion) => question.mutate({ noteId: x.noteId, questionId: x.id, patch: { state: 'open' } }, { onError: failed });
  /** The notes got it wrong: the later call says nothing about this. */
  const wrong = (later: LaterCall) => revisit.mutate({ noteId: later.noteId, revisitId: later.id, dismissed: true }, { onError: failed });
  /** Takes back that someone said a later call says nothing about this. */
  const undo = (later: LaterCall | undefined) => later?.dismissed && <button type="button" className="nd-act" onClick={() => revisit.mutate({ noteId: later.noteId, revisitId: later.id, dismissed: false }, { onError: failed })}>Undo</button>;
  /** What the reader can say about the later call that seems to replace a decision, as far as the grants go: that it didn't, or taking that back. */
  const aboutLater = (d: CarriedDecision, didnt: string) => {
    const later = d.replacedBy;
    if (!later || !maySayNotReplaced(d, reader(d))) return undefined;
    return later.dismissed ? undo(later) : <LaterWrong later={later} onWrong={wrong}>{didnt}</LaterWrong>;
  };
  const tick = (a: CarriedAction, done: boolean) => action.mutate({ noteId: a.noteId, actionId: a.id, patch: { done } }, { onSuccess: () => { if (done) toast('Marked done', { ms: 2200 }); }, onError: failed });
  const takeOn = (a: CarriedAction) => action.mutate({ noteId: a.noteId, actionId: a.id, patch: { takeOn: true, seen: { text: a.text, due: a.due ?? null } } }, { onSuccess: () => toast('It’s yours. Everyone with the notes sees that.', { icon: 'check' }), onError: failed });
  const mine = (a: CarriedAction) => !!me && !!a.owner?.person && sameEmail(a.owner.person, { email: me });

  const confirmed = s.decisions.filter((d) => d.state === 'confirmed');
  const proposed = s.decisions.filter((d) => d.state === 'proposed');
  const superseded = s.decisions.filter((d) => d.state === 'superseded');
  const todo = s.actions.filter((a) => isAcceptedFollowUp(a) && !a.done);
  const taken = todo.filter((a) => a.takenOn);
  const untaken = todo.filter((a) => !a.takenOn);
  const done = s.actions.filter((a) => isAcceptedFollowUp(a) && a.done);
  const empty = !s.decisions.length && !s.questions.length && !s.answered.length && !s.actions.some(isAcceptedFollowUp);
  const latest = s.notes[0];
  const calls = s.notes.length + s.older;
  const who = s.isOrganizer ? 'Your series' : `${firstName(s.organizer.name)}’s series`;
  const row = (d: CarriedDecision, actions: ReactNode, laterActions?: ReactNode) => <CarriedDecisionRow key={d.id} d={d} calls={from} me={me} actions={actions} laterActions={laterActions} saidWrong page />;
  const followUp = (a: CarriedAction) => (
    <CarriedActionRow key={a.id} a={a} calls={from} me={me} page check={<Check checked={a.done} disabled={!mayChangeAction(a, reader(a))} onChange={(on) => tick(a, on)} label={`${a.done ? 'Mark not done' : 'Mark done'}: ${a.text}`} />}
      actions={mine(a) && !a.takenOn && !a.done ? <button type="button" className="nd-take" onClick={() => takeOn(a)}>I’ll do it</button> : undefined} />
  );

  return (
    <Evening moment="note" className="nd nd-series">
      <PageHead title={s.title}>
        {s.next ? <span className="nd-when">Next call {shortDay(new Date(s.next.startsAt))}, {hm(s.next.startsAt)}</span>
          : s.recurring ? <span className="nd-when">Repeats on your Google Calendar</span>
            : latest ? <span className="nd-when">Last call {noteDay(latest.startedAt)}</span> : null}
        <span>{!calls ? 'No call in it has notes yet' : s.isOrganizer ? `${calls} ${calls === 1 ? 'call' : 'calls'} with notes` : `You have notes from ${calls} of its calls`}</span>
        <span className="nd-how"><Icon name="repeat" size={13} />{who}</span>
      </PageHead>
      <CallsLine s={s} />
      <div className="nd-cols" style={{ '--d': 2 }}>
        <div className="nd-main">
          <div className="nd-read">
            {empty ? (
              <EmptyState className="nd-nothing" title={nothing(s).title}>{nothing(s).text}</EmptyState>
            ) : (
              <>
                {s.decisions.length > 0 && (
                  <Section title="Decided" kind="decide" count={proposed.length ? `${proposed.length} to confirm` : undefined}>
                    <div className="carry-list">
                      {confirmed.map((d) => {
                        const stands = d.replacedBy && !d.replacedBy.dismissed;
                        const noLonger = mayDecide(d, 'superseded', reader(d)) && <button type="button" className={cn('nd-act', !stands && 'on-hover')} onClick={() => decide(d, 'superseded')}>It no longer holds</button>;
                        const also = aboutLater(d, 'It still holds');
                        if (!stands) return row(d, noLonger, also);
                        return row(d, null, noLonger || also ? <>{noLonger}{also}</> : undefined);
                      })}
                      {proposed.length > 0 && <div className="grp">Not confirmed yet</div>}
                      {proposed.map((d) => {
                        const no = notDecided(d, reader(d));
                        return row(d, <>
                          {mayDecide(d, 'confirmed', reader(d)) && <button type="button" className="hm-yes" onClick={() => decide(d, 'confirmed')}>Confirm</button>}
                          {no && <IconButton icon="x" label="It wasn’t decided" size={16} className="nd-more" onClick={() => change(d, no)} />}
                        </>, aboutLater(d, 'It wasn’t replaced'));
                      })}
                      {superseded.length > 0 && <div className="grp">No longer holds</div>}
                      {superseded.map((d) => row(d, mayDecide(d, 'confirmed', reader(d)) ? <button type="button" className="nd-act on-hover" onClick={() => decide(d, 'confirmed')}>It still holds</button> : undefined, aboutLater(d, 'It wasn’t replaced')))}
                    </div>
                  </Section>
                )}
                {s.questions.length > 0 && (
                  <Section title="Still open" count={s.questions.length}>
                    <div className="carry-list">
                      {s.questions.map((x) => (x.answeredIn && !x.answeredIn.dismissed
                        ? <CarriedQuestionRow key={x.id} x={x} calls={from} me={me} saidWrong page laterActions={<><button type="button" className="nd-act" onClick={() => answer(x)}>It was answered</button><LaterWrong later={x.answeredIn} onWrong={wrong}>It’s still open</LaterWrong></>} />
                        : <CarriedQuestionRow key={x.id} x={x} calls={from} me={me} saidWrong page actions={<button type="button" className="hm-yes" onClick={() => answer(x)}>It was answered</button>} laterActions={undo(x.answeredIn)} />))}
                    </div>
                  </Section>
                )}
                {s.answered.length > 0 && (
                  <Section title="Answered since the last call" count={s.answered.length}>
                    <div className="carry-list">
                      {s.answered.map((x) => <CarriedQuestionRow key={x.id} x={x} calls={from} me={me} saidWrong page actions={<button type="button" className="nd-act on-hover" onClick={() => reopen(x)}>It’s still open</button>} laterActions={undo(x.answeredIn)} />)}
                    </div>
                  </Section>
                )}
                {s.actions.some(isAcceptedFollowUp) && (
                  <Section title="Follow-ups" kind="follow" count={`${todo.length} open`}>
                    <div className="carry-list">
                      {taken.map(followUp)}
                      {untaken.length > 0 && <div className="grp">Not taken on yet</div>}
                      {untaken.map(followUp)}
                      {done.length > 0 && <div className="grp">Done since the last call</div>}
                      {done.map(followUp)}
                    </div>
                  </Section>
                )}
              </>
            )}
          </div>
          {s.notes.some((n) => n.status === 'ready') && <AskBar label="Ask about these calls" waiting="Reading the calls in confidential compute" suggestions={SUGGESTIONS} ask={(text) => api.series.ask(s.id, text, timeZone())} />}
        </div>
        <aside className="nd-side" aria-label="About this series">
          {s.isOrganizer && <NextCall s={s} />}
          <Calls s={s} />
        </aside>
      </div>
    </Evening>
  );
}

/** The calls of a series along the horizon, the sun on the latest one, and for the organizer the next one still to come. */
function CallsLine({ s }: { s: Series }) {
  const calls = [...s.notes].reverse();
  const t = (iso: string) => new Date(iso).getTime();
  const start = calls[0] ? t(calls[0].startedAt) : 0;
  const latest = calls.at(-1);
  const end = s.next ? t(s.next.startsAt) : latest ? t(latest.startedAt) : 0;
  const span = end - start;
  const at = (iso: string) => share(t(iso) - start, span);
  const lit = latest ? at(latest.startedAt) : 0;
  return (
    <LineStrip className="is-silent is-calls" label="The calls in this series">
      <div className="nd-hz-in" style={{ '--p': percent(lit) }}>
        <div className="nd-track">
          <i className="nd-rail" /><i className="nd-lit" />
          {calls.map((n, i) => {
            const x = at(n.startedAt);
            const next = calls[i + 1];
            return (
              <Link key={n.id} to="/notes/$noteId" params={{ noteId: n.id }} className={cn('nd-ch', n === latest && 'is-on', x > 0.72 && 'is-r', x > 0.92 && 'is-end')} style={{ '--x': percent(x), '--room': percent((next ? at(next.startedAt) : 1) - x || 1) }} aria-label={`The call on ${shortDay(new Date(n.startedAt))}`}>
                <span className="ac-clamp-1">{dayMonth(new Date(n.startedAt))}</span>
                <span className="nd-tip nd-tip-ch"><b>{noteDay(n.startedAt)}</b><small className="ac-time">{hm(n.startedAt)}</small><span>{n.status === 'ready' ? n.title : 'Notes being written'}</span></span>
              </Link>
            );
          })}
          {latest && <i className="nd-sun" />}
          {s.next && <span className="nd-m is-follow is-open is-r" style={{ '--x': percent(1) }}><i /><span className="nd-tip"><b>Next call</b><small className="ac-time">{shortDay(new Date(s.next.startsAt))}, {hm(s.next.startsAt)}</small></span></span>}
        </div>
      </div>
    </LineStrip>
  );
}

/** The calls you have notes from, newest first, and what's beyond the ones that count. */
function Calls({ s }: { s: Series }) {
  const notes = useQuery(q.notes()).data;
  const gist = (id: string, title: string) => notes?.find((x) => x.id === id)?.excerpt || title;
  return (
    <section className="nd-b">
      <h2>Calls</h2>
      {s.notes.map((n) => (
        <Link key={n.id} to="/notes/$noteId" params={{ noteId: n.id }} className="nd-c is-call">
          <span className="nd-c-d">{dayMonth(new Date(n.startedAt))}</span>
          <span className="nd-c-t ac-clamp-1">{n.status === 'ready' ? gist(n.id, n.title) : 'Notes being written'}</span>
          {n.status === 'ready' && <span className="nd-c-d">{minutesLabel(n.duration)}</span>}
        </Link>
      ))}
      {!s.notes.length && <p className="nd-c-open">No call in this series has notes yet.</p>}
      {s.older > 0 && <p className="nd-c-open">{s.older} older {s.older === 1 ? 'call isn’t' : 'calls aren’t'} shown, and nothing carries over from {s.older === 1 ? 'it' : 'them'}: only the newest {s.notes.length} count.</p>}
      <p className="nd-open"><Icon name="sealed" size={14} />{s.isOrganizer ? 'Everyone invited sees only the calls they have notes from. Nothing here is kept.' : 'Only from the calls you have notes from. Nothing here is kept.'}</p>
    </section>
  );
}

/** Says a later call didn't do what the notes think it did. */
function LaterWrong({ later, onWrong, children }: { later: LaterCall; onWrong: (l: LaterCall) => void; children: ReactNode }) {
  return <button type="button" className="nd-act" onClick={() => onWrong(later)}>{children}</button>;
}

/** For the organizer: the next call in the series, or a way to schedule it. */
function NextCall({ s }: { s: Series }) {
  const flow = useCallFlow();
  const next = useScheduleNextCall();
  const latest = s.notes.find((n) => n.meetingId)?.meetingId;
  if (s.next) {
    const m = s.next;
    return (
      <section className="hm-panel nd-call" aria-label="Next call">
        <div className="hm-panel-h"><h2>Next call</h2></div>
        <p className="nd-call-w"><b>{longDay(new Date(m.startsAt))}</b><span>{hm(m.startsAt)} to {hm(m.endsAt)}</span></p>
        <div className="nd-call-a">
          <Link to="/join/$code" params={{ code: m.code }} className={buttonClass({ variant: 'primary', size: 'sm' })}><Icon name="video" size={16} />Join</Link>
          {m.status === 'scheduled' && <IconButton icon="pen" label="Change this call" aria-haspopup="dialog" onClick={() => flow.open(m)} />}
        </div>
      </section>
    );
  }
  return (
    <section className="nd-b">
      <h2>Next call</h2>
      {s.recurring
        ? <NextOnCalendar><p className="nd-c-open">It’s on your Google Calendar. Make it an Alcove call from Home when it’s coming up.</p></NextOnCalendar>
        : (
          <>
            <p className="nd-c-open">Nothing is scheduled. The next call gets the same people and notes setting.</p>
            {latest && <Button size="sm" icon="repeat" className="nd-meet" loading={next.pending} onClick={() => next.run(latest)}>Schedule next week’s call</Button>}
          </>
        )}
    </section>
  );
}

function Missing({ error }: ErrorComponentProps) {
  const notFound = errorCode(error) === 'not-found';
  return <GonePage title={notFound ? 'This series isn’t here' : 'Couldn’t open this series'} lead={notFound ? 'Its calls’ notes were deleted, or none of them were given to you.' : errorMessage(error)} />;
}
