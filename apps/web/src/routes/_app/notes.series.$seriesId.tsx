import { errorCode, errorMessage, firstName, mayChangeAction, mayDecide, minutesLabel, type CarriedAction, type CarriedDecision, type CarriedQuestion, type DecisionPatch, type Series } from '@alcove/api';
import { ArchThumb, Button, Card, Check, Chip, EmptyState, GoneArch, Icon, IconButton, SealedBadge, buttonClass, coverFor, cn, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useNoteReader } from '~/features/notes/entries';
import { AskBar, Section, notDecided } from '~/features/notes/parts';
import { CarriedActionRow, CarriedDecisionRow, CarriedQuestionRow, NextOnCalendar, useScheduleNextCall } from '~/features/series/carried';
import { useOpenComposer } from '~/features/shell/context';
import { api } from '~/lib/api';
import { sameEmail } from '~/lib/people';
import { q, useUpdateAction, useUpdateDecision, useUpdateQuestion } from '~/lib/queries';
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
  const failed = (e: unknown) => toast(errorMessage(e), { icon: 'x' });
  const from = new Map(s.notes.map((n) => [n.id, n]));
  const readerAs = useNoteReader();
  /** Who the reader is to the call something came from: the series is one organizer's, but each call's notes reached people their own way. */
  const reader = (x: { noteId: string }) => readerAs(s.isOrganizer ? 'organizer' : from.get(x.noteId)?.received?.role ?? 'shared');
  const change = (d: CarriedDecision, patch: DecisionPatch) => decision.mutate({ noteId: d.noteId, decisionId: d.id, patch }, { onError: failed });
  const decide = (d: CarriedDecision, state: CarriedDecision['state']) => change(d, state === 'confirmed' ? { state, seen: { text: d.text } } : { state });
  const answer = (x: CarriedQuestion) => question.mutate({ noteId: x.noteId, questionId: x.id, patch: { state: 'answered' } }, { onSuccess: () => toast('Marked answered', { ms: 2200 }), onError: failed });
  const tick = (a: CarriedAction, done: boolean) => action.mutate({ noteId: a.noteId, actionId: a.id, patch: { done } }, { onSuccess: () => { if (done) toast('Marked done', { ms: 2200 }); }, onError: failed });
  const takeOn = (a: CarriedAction) => action.mutate({ noteId: a.noteId, actionId: a.id, patch: { takeOn: true, seen: { text: a.text, due: a.due ?? null } } }, { onSuccess: () => toast('It’s yours. Everyone with the notes sees that.', { icon: 'check' }), onError: failed });
  const mine = (a: CarriedAction) => !!me && !!a.owner?.person && sameEmail(a.owner.person, { email: me });

  const confirmed = s.decisions.filter((d) => d.state === 'confirmed');
  const proposed = s.decisions.filter((d) => d.state === 'proposed');
  const superseded = s.decisions.filter((d) => d.state === 'superseded');
  const todo = s.actions.filter((a) => !a.done);
  const taken = todo.filter((a) => a.takenOn);
  const untaken = todo.filter((a) => !a.takenOn);
  const done = s.actions.filter((a) => a.done);
  const empty = !s.decisions.length && !s.questions.length && !s.actions.length;
  const latest = s.notes[0];
  const calls = s.notes.length + s.older;
  const who = s.isOrganizer ? 'Your series' : `${firstName(s.organizer.name)}’s series`;
  const row = (d: CarriedDecision, actions: ReactNode) => <CarriedDecisionRow key={d.id} d={d} note={from.get(d.noteId)} me={me} actions={actions} />;
  const followUp = (a: CarriedAction) => (
    <CarriedActionRow key={a.id} a={a} note={from.get(a.noteId)} me={me} check={<Check checked={a.done} disabled={!mayChangeAction(a, reader(a))} onChange={(on) => tick(a, on)} label={`${a.done ? 'Mark not done' : 'Mark done'}: ${a.text}`} />}
      actions={mine(a) && !a.takenOn && !a.done ? <button type="button" className="lk" onClick={() => takeOn(a)}>I’ll do it</button> : undefined} />
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
                <Section title="Decisions" count={proposed.length ? `${proposed.length} to confirm` : confirmed.length || undefined} style={{ '--d': 2 }}>
                  <div className="carry-list">
                    {confirmed.map((d) => row(d, mayDecide(d, 'superseded', reader(d)) ? <button type="button" className="lk on-hover" onClick={() => decide(d, 'superseded')}>It no longer holds</button> : undefined))}
                    {proposed.length > 0 && <div className="grp">Not confirmed yet</div>}
                    {proposed.map((d) => {
                      const no = notDecided(d, reader(d));
                      return row(d, <>
                        {mayDecide(d, 'confirmed', reader(d)) && <button type="button" className="lk" onClick={() => decide(d, 'confirmed')}>Confirm</button>}
                        {no && <button type="button" className="lk quiet" onClick={() => change(d, no)}>It wasn’t decided</button>}
                      </>);
                    })}
                    {superseded.length > 0 && <div className="grp">No longer holds</div>}
                    {superseded.map((d) => row(d, mayDecide(d, 'confirmed', reader(d)) ? <button type="button" className="lk on-hover" onClick={() => decide(d, 'confirmed')}>It still holds</button> : undefined))}
                  </div>
                </Section>
              )}
              {s.questions.length > 0 && (
                <Section title="Still open" count={s.questions.length} style={{ '--d': 3 }}>
                  <div className="carry-list">
                    {s.questions.map((x) => <CarriedQuestionRow key={x.id} x={x} note={from.get(x.noteId)} actions={<button type="button" className="lk" onClick={() => answer(x)}>It was answered</button>} />)}
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
