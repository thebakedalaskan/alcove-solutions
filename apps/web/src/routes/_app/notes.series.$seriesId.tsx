import { errorCode, errorMessage, firstName, minutesLabel, type CarriedAction, type CarriedDecision, type CarriedQuestion, type LaterCall, type Series } from '@alcove/api';
import { ArchThumb, Button, Card, Check, Chip, EmptyState, GoneArch, Icon, IconButton, SealedBadge, buttonClass, coverFor, cn, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { AskBar, Section } from '~/features/notes/parts';
import { CarriedActionRow, CarriedDecisionRow, CarriedQuestionRow, NextOnCalendar, useScheduleNextCall } from '~/features/series/carried';
import { useOpenComposer } from '~/features/shell/context';
import { api } from '~/lib/api';
import { sameEmail } from '~/lib/people';
import { q, useDismissRevisit, useUpdateAction, useUpdateDecision, useUpdateQuestion } from '~/lib/queries';
import { hm, longDay, noteDay, shortDay, timeZone } from '~/lib/time';

/*
 * A series as the reader sees it: what the calls they have notes from decided, left open and handed
 * out, with where each came from; asking across those calls; and, for the organizer, the next call.
 */
export const Route = createFileRoute('/_app/notes/series/$seriesId')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(q.series(params.seriesId)),
  errorComponent: Missing,
  component: SeriesPage
});

function SeriesPage() {
  const { seriesId } = Route.useParams();
  const me = useQuery(q.session()).data?.user.email;
  const s = useQuery(q.series(seriesId)).data;
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
  const revisit = useDismissRevisit();
  const failed = (e: unknown) => toast(errorMessage(e), { icon: 'x' });
  const from = new Map(s.notes.map((n) => [n.id, n]));
  const decide = (d: CarriedDecision, state: CarriedDecision['state']) => decision.mutate({ noteId: d.noteId, decisionId: d.id, patch: { state } }, { onError: failed });
  const answer = (x: CarriedQuestion) => question.mutate({ noteId: x.noteId, questionId: x.id, patch: { state: 'answered' } }, { onSuccess: () => toast('Marked answered', { ms: 2200 }), onError: failed });
  const reopen = (x: CarriedQuestion) => question.mutate({ noteId: x.noteId, questionId: x.id, patch: { state: 'open' } }, { onError: failed });
  /** The notes got it wrong: the later call says nothing about this. */
  const wrong = (later: LaterCall) => revisit.mutate({ noteId: later.noteId, revisitId: later.id }, { onError: failed });
  const tick = (a: CarriedAction, done: boolean) => action.mutate({ noteId: a.noteId, actionId: a.id, patch: { done } }, { onSuccess: () => { if (done) toast('Marked done', { ms: 2200 }); }, onError: failed });
  const takeOn = (a: CarriedAction) => action.mutate({ noteId: a.noteId, actionId: a.id, patch: { takeOn: true } }, { onSuccess: () => toast('It’s yours. Everyone with the notes sees that.', { icon: 'check' }), onError: failed });
  const mine = (a: CarriedAction) => !!me && !!a.owner?.person && sameEmail(a.owner.person, { email: me });

  const confirmed = s.decisions.filter((d) => d.state === 'confirmed');
  const proposed = s.decisions.filter((d) => d.state === 'proposed');
  const superseded = s.decisions.filter((d) => d.state === 'superseded');
  const todo = s.actions.filter((a) => !a.done);
  const taken = todo.filter((a) => a.takenOn);
  const untaken = todo.filter((a) => !a.takenOn);
  const done = s.actions.filter((a) => a.done);
  const empty = !s.decisions.length && !s.questions.length && !s.answered.length && !s.actions.length;
  const latest = s.notes[0];
  const calls = s.notes.length + s.older;
  const who = s.isOrganizer ? 'Your series' : `${firstName(s.organizer.name)}’s series`;
  const row = (d: CarriedDecision, actions: ReactNode, laterActions?: ReactNode) => <CarriedDecisionRow key={d.id} d={d} calls={from} me={me} actions={actions} laterActions={laterActions} />;
  const followUp = (a: CarriedAction) => (
    <CarriedActionRow key={a.id} a={a} calls={from} me={me} check={<Check checked={a.done} onChange={(on) => tick(a, on)} label={`${a.done ? 'Mark not done' : 'Mark done'}: ${a.text}`} />}
      actions={mine(a) && !a.takenOn && !a.done ? <button type="button" className="lk" onClick={() => takeOn(a)}>Take it on</button> : undefined} />
  );

  return (
    <>
      <div className="note-top" style={{ '--d': 0 }}>
        <Link to="/notes" className={cn(buttonClass({ variant: 'quiet', size: 'sm' }), 'back')}><Icon name="left" size={16} />Notes</Link>
      </div>
      <div className="note" style={{ '--d': 1 }}>
        <article className="doc series">
          <Chip icon="repeat" className="lead-chip">{who}</Chip>
          <h1>{s.title}</h1>
          <div className="doc-meta">
            {s.next ? <span className="ac-mono">Next call {shortDay(new Date(s.next.startsAt))}, {hm(s.next.startsAt)}</span>
              : s.recurring ? <span>Repeats on your Google Calendar</span>
                : latest ? <span className="ac-mono">Last call {noteDay(latest.startedAt)}</span> : null}
            <span>{!calls ? 'No call in it has notes yet' : s.isOrganizer ? `${calls} ${calls === 1 ? 'call' : 'calls'} with notes` : `You have notes from ${calls} of its calls`}</span>
          </div>
          {empty ? (
            <section className="sec"><EmptyState className="note-empty" title={nothing(s).title}>{nothing(s).text}</EmptyState></section>
          ) : (
            <>
              {s.decisions.length > 0 && (
                <Section title="Decided" count={proposed.length ? `${proposed.length} to confirm` : confirmed.length || undefined} style={{ '--d': 2 }}>
                  <div className="carry-list">
                    {confirmed.map((d) => (d.replacedBy
                      ? row(d, null, <><button type="button" className="lk" onClick={() => decide(d, 'superseded')}>It no longer holds</button><LaterWrong later={d.replacedBy} onWrong={wrong}>It still holds</LaterWrong></>)
                      : row(d, <button type="button" className="lk on-hover" onClick={() => decide(d, 'superseded')}>It no longer holds</button>)))}
                    {proposed.length > 0 && <div className="grp">Not confirmed yet</div>}
                    {proposed.map((d) => row(d, <>
                      <button type="button" className="lk" onClick={() => decide(d, 'confirmed')}>Confirm</button>
                      <button type="button" className="lk quiet" onClick={() => decide(d, 'rejected')}>It wasn’t decided</button>
                    </>))}
                    {superseded.length > 0 && <div className="grp">No longer holds</div>}
                    {superseded.map((d) => row(d, <button type="button" className="lk on-hover" onClick={() => decide(d, 'confirmed')}>It still holds</button>))}
                  </div>
                </Section>
              )}
              {s.questions.length > 0 && (
                <Section title="Still open" count={s.questions.length} style={{ '--d': 3 }}>
                  <div className="carry-list">
                    {s.questions.map((x) => (x.answeredIn
                      ? <CarriedQuestionRow key={x.id} x={x} calls={from} laterActions={<><button type="button" className="lk" onClick={() => answer(x)}>It was answered</button><LaterWrong later={x.answeredIn} onWrong={wrong}>It’s still open</LaterWrong></>} />
                      : <CarriedQuestionRow key={x.id} x={x} calls={from} actions={<button type="button" className="lk" onClick={() => answer(x)}>It was answered</button>} />))}
                  </div>
                </Section>
              )}
              {s.answered.length > 0 && (
                <Section title="Answered since the last call" count={s.answered.length} style={{ '--d': 3 }}>
                  <div className="carry-list">
                    {s.answered.map((x) => <CarriedQuestionRow key={x.id} x={x} calls={from} actions={<button type="button" className="lk on-hover" onClick={() => reopen(x)}>It’s still open</button>} />)}
                  </div>
                </Section>
              )}
              {s.actions.length > 0 && (
                <Section title="Follow-ups" count={`${todo.length} open`} style={{ '--d': 4 }}>
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
          {s.notes.some((n) => n.status === 'ready') && <AskBar label="Ask about these calls" suggestions={SUGGESTIONS} ask={(text) => api.series.ask(s.id, text, timeZone())} />}
        </article>
        <aside className="rail">
          {s.isOrganizer && <div style={{ '--d': 4 }}><NextCall s={s} /></div>}
          <div style={{ '--d': 5 }}>
            <Card title="Calls" aside={<span className="ac-mono">{s.notes.length}</span>}>
              {s.notes.length ? (
                <div className="ser-calls">
                  {s.notes.map((n) => (
                    <Link key={n.id} to="/notes/$noteId" params={{ noteId: n.id }} className="nrow">
                      <ArchThumb cover={coverFor(n.id)} />
                      <span className="min-w-0"><b>{noteDay(n.startedAt)}, {hm(n.startedAt)}</b><small>{n.status === 'ready' ? `${minutesLabel(n.duration)}${n.title === s.title ? '' : ` · ${n.title}`}` : 'Notes being written'}</small></span>
                      <Icon name="chevron" size={16} className="go" />
                    </Link>
                  ))}
                </div>
              ) : <p className="ser-p">No call in this series has notes yet.</p>}
              {s.older > 0 && <p className="ser-p ser-older">{s.older} older {s.older === 1 ? 'call isn’t' : 'calls aren’t'} shown, and nothing carries over from {s.older === 1 ? 'it' : 'them'}: only the newest {s.notes.length} count.</p>}
              <div className="seal"><SealedBadge inline title={s.isOrganizer ? 'Everyone invited sees only the calls they have notes from. Nothing here is kept.' : 'Only from the calls you have notes from. Nothing here is kept.'} /></div>
            </Card>
          </div>
        </aside>
      </div>
    </>
  );
}

/** Says a later call didn't do what the notes think it did. */
function LaterWrong({ later, onWrong, children }: { later: LaterCall; onWrong: (l: LaterCall) => void; children: ReactNode }) {
  return <button type="button" className="lk quiet" onClick={() => onWrong(later)}>{children}</button>;
}

/** For the organizer: the next call in the series, or a way to schedule it. */
function NextCall({ s }: { s: Series }) {
  const open = useOpenComposer();
  const next = useScheduleNextCall();
  const latest = s.notes.find((n) => n.meetingId)?.meetingId;
  if (s.next) {
    const m = s.next;
    return (
      <Card title="Next call">
        <div className="ser-when"><b>{longDay(new Date(m.startsAt))}</b><span className="ac-mono">{hm(m.startsAt)} to {hm(m.endsAt)}</span></div>
        <div className="ser-acts">
          <Link to="/join/$code" params={{ code: m.code }} className={buttonClass({ size: 'sm' })}><Icon name="video" size={16} />Join</Link>
          {m.status === 'scheduled' && <IconButton icon="pen" label="Change this call" onClick={() => open({ meeting: m })} />}
        </div>
      </Card>
    );
  }
  return (
    <Card title="Next call">
      {s.recurring
        ? <NextOnCalendar><p className="ser-p">It’s on your Google Calendar. Make it an Alcove call from Home when it’s coming up.</p></NextOnCalendar>
        : (
          <>
            <p className="ser-p">Nothing is scheduled. The next call gets the same people and notes setting.</p>
            {latest && <Button icon="repeat" className="ser-btn" loading={next.pending} onClick={() => next.run(latest)}>Schedule next week’s call</Button>}
          </>
        )}
    </Card>
  );
}

function Missing({ error }: ErrorComponentProps) {
  const notFound = errorCode(error) === 'not-found';
  return (
    <div className="gone">
      <GoneArch />
      <h2>{notFound ? 'This series isn’t here' : 'Couldn’t open this series'}</h2>
      <p className="mb-4 max-w-[42ch] text-ink-2">{notFound ? 'Its calls’ notes were deleted, or none of them were given to you.' : errorMessage(error)}</p>
      <Link to="/notes" className={buttonClass({ size: 'lg' })}>Back to notes</Link>
    </div>
  );
}
