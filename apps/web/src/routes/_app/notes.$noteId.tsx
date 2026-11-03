import { errorCode, errorMessage, firstName, minutesLabel, type ActionItem, type ActionPatch, type Decision, type DecisionPatch, type Note, type NoteProgress, type Person } from '@alcove/api';
import { Button, Chip, EmptyState, GoneArch, Icon, IconButton, Popover, RecDot, coverFor, cn, useToast } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Player, usePlayer } from '~/features/notes/Player';
import { askExample, exampleNote } from '~/features/notes/example';
import { AskBar, Chapters, Decisions, DocHead, FollowUps, Recipients, Section, Transcript, TranscriptLines } from '~/features/notes/parts';
import { PeoplePicker } from '~/features/people/PeoplePicker';
import { api } from '~/lib/api';
import { log } from '~/lib/log';
import { listNames, sameEmail } from '~/lib/people';
import { q, qk, useDeleteNote, useShareNote, useUpdateAction, useUpdateDecision } from '~/lib/queries';
import { noteWhen } from '~/lib/time';

export const Route = createFileRoute('/_app/notes/$noteId')({
  loader: ({ context, params }) => (params.noteId === 'example' ? undefined : context.queryClient.ensureQueryData(q.note(params.noteId))),
  errorComponent: Missing,
  component: NotePage
});

const nlog = log.child({ component: 'note' });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function NotePage() {
  const { noteId } = Route.useParams();
  const me = useQuery(q.session()).data?.user;
  if (noteId === 'example') return me ? <Example me={me} /> : null;
  return <Stored id={noteId} me={me?.email} />;
}

interface GoneInfo { kind: 'deleted' | 'removed'; audio: string; organizer: string }

function Stored({ id, me }: { id: string; me: string | undefined }) {
  const qc = useQueryClient();
  const [gone, setGone] = useState<GoneInfo | null>(null);
  const note = useQuery({ ...q.note(id), enabled: !gone }).data;
  useEffect(() => { if (gone) qc.removeQueries({ queryKey: qk.note(id), exact: true }); }, [gone, qc, id]);
  if (gone) return <Gone {...gone} />;
  if (!note) return null;
  return <NoteView note={note} me={me} onGone={setGone} />;
}

/*
 * Until the notes are written, the stream says honestly where they are. Each step it finishes (the
 * recording stopping, the notes being written) brings the note up to date; a stream that ends
 * before they're written is followed again a few seconds later, for as long as the page is open.
 */
function useProgress(note: Note): NoteProgress | null {
  const qc = useQueryClient();
  const [p, setP] = useState<NoteProgress | null>(null);
  useEffect(() => {
    if (note.status === 'ready') return;
    let alive = true;
    let again: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => void qc.invalidateQueries({ queryKey: qk.notes });
    const follow = async () => {
      let done = -1;
      try {
        for await (const x of api.notes.progress(note.id)) {
          if (!alive) return;
          setP(x);
          if (x.ready) { refresh(); return; }
          const n = x.steps.filter((s) => s.done).length;
          if (done >= 0 && n > done) refresh();
          done = n;
        }
        nlog.debug('note progress ended before the notes were written', { noteId: note.id });
      } catch (e) {
        const code = errorCode(e);
        nlog.at(code === 'network' ? 'info' : 'warn', 'note progress stopped', { err: e, noteId: note.id });
        if (code === 'not-found' || code === 'forbidden' || code === 'unauthenticated') return;
      }
      if (alive) again = setTimeout(() => void follow(), 4000);
    };
    void follow();
    return () => { alive = false; clearTimeout(again); };
  }, [note.id, note.status, qc]);
  return p;
}

function asText(n: Note): string {
  const about = (a: ActionItem) => [a.owner ? `${a.owner.name}${a.takenOn ? '' : ', not taken on yet'}` : '', a.due].filter((x): x is string => !!x).join(', ');
  // What people said wasn't decided stays out; what nobody has confirmed yet says so.
  const decided = n.decisions.filter((d) => d.state !== 'rejected');
  return [
    n.title, noteWhen(n.startedAt, n.duration), '', n.summary,
    ...(decided.length ? ['', 'Decided', ...decided.map((d) => `- ${d.text}${d.state === 'proposed' ? ' (not confirmed yet)' : ''}`)] : []),
    ...(n.actions.length ? ['', 'Follow-ups', ...n.actions.map((a) => `- ${a.text}${about(a) ? ` (${about(a)})` : ''}`)] : [])
  ].join('\n');
}

function NoteView({ note, me, onGone }: { note: Note; me: string | undefined; onGone: (g: GoneInfo) => void }) {
  const toast = useToast();
  const share = useShareNote();
  const del = useDeleteNote();
  const updateAction = useUpdateAction();
  const updateDecision = useUpdateDecision();
  const player = usePlayer(note.id, note.audio);
  const progress = useProgress(note);
  const [pop, setPop] = useState<'share' | 'more' | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [going, setGoing] = useState(false);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const mine = !note.from;
  const organizer = note.recipients.find((r) => r.role === 'organizer')?.person ?? note.from;
  const myRole = note.recipients.find((r) => me && sameEmail(r.person, { email: me }))?.role;
  const ready = note.status === 'ready';
  const seek = note.audio.length ? (s: number) => player.seek(s) : undefined;
  const open = note.actions.filter((a) => !a.done).length;
  const lines = note.transcript ?? [];
  const written = note.summary.trim() !== '';

  const remove = async () => {
    try {
      await del.mutateAsync(note.id);
      setConfirm(false);
      setGoing(true);
      await sleep(900);
      onGone({ kind: mine ? 'deleted' : 'removed', audio: minutesLabel(note.duration), organizer: organizer ? firstName(organizer.name) : 'The organizer' });
    } catch (e) { toast(errorMessage(e), { icon: 'x' }); }
  };
  const failed = (e: unknown) => toast(errorMessage(e), { icon: 'x' });
  const toggle = (a: ActionItem, on: boolean) => updateAction.mutate({ noteId: note.id, actionId: a.id, patch: { done: on } }, { onSuccess: () => { if (on) toast('Marked done', { ms: 2200 }); }, onError: failed });
  const changeAction = (a: ActionItem, patch: ActionPatch) => updateAction.mutate({ noteId: note.id, actionId: a.id, patch }, {
    onSuccess: () => { if (patch.takeOn) toast('It’s yours. Everyone with the notes sees that.', { icon: 'check' }); }, onError: failed
  });
  const changeDecision = (d: Decision, patch: DecisionPatch) => updateDecision.mutate({ noteId: note.id, decisionId: d.id, patch }, { onError: failed });
  const toConfirm = note.decisions.filter((d) => d.state === 'proposed').length;
  const part = (i: number) => ({ className: going ? 'going' : undefined, style: { '--d': i } });

  return (
    <>
      <div className="note-top" style={{ '--d': 0 }}>
        <Link to="/notes" className="back"><Icon name="left" size={17} />Notes</Link>
        <div className="note-acts">
          <PeoplePicker open={pop === 'share'} onOpenChange={(o) => setPop(o ? 'share' : null)} align="end"
            anchor={<Button variant="secondary" icon="share" disabled={note.status === 'recording'} title={note.status === 'recording' ? 'You can share these once the recording stops.' : undefined}>Share</Button>}
            title="Share these notes" cta="Share" skip={note.recipients.map((r) => r.person.email)}
            note="They find them in Alcove when they sign in with that email."
            after={<div className="pick-have"><span>{note.recipients.length === 1 ? 'Only you have them' : `${note.recipients.length} people have them`}</span></div>}
            onDone={(people: Person[]) => share.mutate({ id: note.id, emails: people.map((p) => p.email) }, {
              onSuccess: () => { setFresh(new Set(people.map((p) => p.email))); toast(`Shared with ${listNames(people)}`, { icon: 'send' }); },
              onError: (e) => toast(errorMessage(e), { icon: 'x' })
            })} />
          <Popover open={pop === 'more'} onOpenChange={(o) => setPop(o ? 'more' : null)} align="end" label="More" className="w-[264px]"
            anchor={<IconButton icon="more" label="More" />}>
            <button type="button" className="pop-item" disabled={!ready} onClick={() => { setPop(null); void navigator.clipboard?.writeText(asText(note)).then(() => toast('Copied as text')); }}>
              <Icon name="copy" size={18} /><span><b>Copy as text</b>{!ready && <small>Once the notes are written.</small>}</span>
            </button>
            <div className="pop-sep" />
            <button type="button" className="pop-item danger" onClick={() => { setPop(null); setConfirm(true); }}>
              <Icon name="trash" size={18} /><span>{mine ? <><b>Delete notes</b><small>For everyone. Can’t be undone.</small></> : <><b>Remove from your notes</b><small>Everyone else keeps them.</small></>}</span>
            </button>
          </Popover>
        </div>
      </div>
      <div className="note" style={{ '--d': 1 }}>
        <article className="doc">
          <DocHead title={note.title} when={noteWhen(note.startedAt, note.duration)} people={note.people}
            chip={note.status === 'recording' ? <div className="status writing mb-[18px]"><RecDot />Still recording</div>
              : note.status === 'pending' ? <div className="status writing mb-[18px]"><span className="spin" />Waiting to be written</div>
                : !mine && organizer ? <Chip tone="accent" className="mb-4">{myRole === 'shared' ? 'Shared with you' : `From ${firstName(organizer.name)}’s call`}</Chip> : null} />
          {confirm && (
            <div className="confirm" role="alertdialog" aria-label={mine ? 'Delete these notes' : 'Remove these notes'}>
              <span className="ic"><Icon name="trash" size={19} /></span>
              <div>
                <b>{mine ? 'Delete these notes for everyone?' : 'Remove these notes from yours?'}</b>
                <p>{mine ? `Removes the summary, the transcript and ${minutesLabel(note.duration)} of audio from Alcove. It can’t be undone.` : `${organizer ? firstName(organizer.name) : 'The organizer'} and everyone else who has them keep them.`}</p>
              </div>
              <div className="btns"><Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" loading={del.isPending} onClick={() => void remove()}>{mine ? 'Delete' : 'Remove'}</Button></div>
            </div>
          )}
          {ready && written ? (
            <>
              <Section title="Summary" {...part(0)}><p className="summary">{note.summary}</p></Section>
              {note.decisions.length > 0 && (
                <Section title="Decided" count={toConfirm ? `${toConfirm} to confirm` : note.decisions.length} {...part(1)}>
                  <Decisions items={note.decisions} me={me} onChange={changeDecision} onSeek={seek} />
                </Section>
              )}
              {note.actions.length > 0 && (
                <Section title="Follow-ups" count={`${open} open`} {...part(2)}>
                  <FollowUps actions={note.actions} me={me} people={note.recipients.map((r) => r.person)} onToggle={toggle} onChange={changeAction} />
                </Section>
              )}
              {lines.length > 0 && <section className={cn('sec', going && 'going')} style={{ '--d': 3 }}><Transcript lines={lines} seconds={note.duration} me={me} onSeek={seek} /></section>}
            </>
          ) : ready && lines.length ? (
            <>
              <section className={cn('sec', going && 'going')}>
                <div className="pending-note quiet">
                  <Icon name="pen" size={18} />
                  <div>
                    <b className="font-semibold text-ink">The summary couldn’t be written.</b>
                    <p className="mt-1">The transcript and the audio are kept, and you can still ask about the {note.kind === 'room' ? 'recording' : 'call'}.</p>
                  </div>
                </div>
              </section>
              <Section title="Transcript" count={minutesLabel(note.duration)} {...part(1)}><TranscriptLines lines={lines} me={me} onSeek={seek} /></Section>
            </>
          ) : ready ? (
            <section className={cn('sec', going && 'going')}>
              <EmptyState className="note-empty" title={note.kind === 'room' ? 'Nothing was said while recording.' : 'Nothing was said while notes were on.'}>
                {note.audio.length ? 'So there’s no summary or transcript. You can still play the audio.' : 'So there’s no summary or transcript.'}
              </EmptyState>
            </section>
          ) : (
            <>
              <section className={cn('sec', going && 'going')}>
                <div className="pending-note">
                  <Icon name="lock" size={18} />
                  <div>
                    <b className="font-semibold text-ink">{note.status === 'recording' ? 'The recording is still going.' : 'The audio is saved and encrypted.'}</b>
                    <p className="mt-1">Summary, decisions and follow-ups are written by Alcove’s notes service. Everyone here gets them when it has.</p>
                    {progress && (
                      <ul className="mt-3 grid gap-1.5 text-[14px]">
                        {progress.steps.map((s) => <li key={s.label} className={cn('flex items-center gap-2', s.done ? 'text-ink-2' : 'text-ink-3')}><Icon name={s.done ? 'check' : 'clock'} size={15} className={s.done ? 'text-accent' : undefined} />{s.label}</li>)}
                      </ul>
                    )}
                  </div>
                </div>
              </section>
              {lines.length > 0 && <Section title="Transcript" count={minutesLabel(note.duration)} {...part(1)}><TranscriptLines lines={lines} me={me} onSeek={seek} /></Section>}
            </>
          )}
          {ready && lines.length > 0 && !going && <AskBar suggestions={note.suggestedQuestions} ask={(question) => api.notes.ask(note.id, question)} onSeek={seek} />}
        </article>
        <aside className="rail">
          {player.total > 0 && <div className={cn(going && 'going')} style={{ '--d': 4 }}><Player noteId={note.id} cover={coverFor(note.id)} player={player} chapters={note.chapters} room={note.kind === 'room'} /></div>}
          {note.chapters.length > 0 && <div className={cn(going && 'going')} style={{ '--d': 5 }}><Chapters chapters={note.chapters} pos={player.pos} onSeek={seek} /></div>}
          <div className={cn(going && 'going')} style={{ '--d': 6 }}><Recipients recipients={note.recipients} me={me} fresh={fresh} /></div>
        </aside>
      </div>
    </>
  );
}

/* Delete is physical: say exactly what went. */
function Gone({ kind, audio, organizer }: GoneInfo) {
  return (
    <div className="gone">
      <GoneArch />
      <h2>{kind === 'deleted' ? 'Deleted' : 'Removed'}</h2>
      {kind === 'deleted' ? (
        <>
          <p className="text-ink-2">Gone from Alcove, for everyone who had them:</p>
          <ul>
            <li><Icon name="check" size={18} />Summary, decisions and follow-ups</li>
            <li><Icon name="check" size={18} />The transcript</li>
            <li><Icon name="check" size={18} />{audio} of audio</li>
          </ul>
        </>
      ) : <p className="mb-4 text-ink-2">They’re out of your notes. {organizer} still has them.</p>}
      <Link to="/notes" className="btn btn-secondary btn-lg">Back to notes</Link>
    </div>
  );
}

function Missing({ error }: ErrorComponentProps) {
  const notFound = errorCode(error) === 'not-found';
  return (
    <div className="gone">
      <GoneArch />
      <h2>{notFound ? 'These notes aren’t here' : 'Couldn’t open these notes'}</h2>
      <p className="mb-4 max-w-[42ch] text-ink-2">{notFound ? 'They were deleted, or they were never shared with you.' : errorMessage(error)}</p>
      <Link to="/notes" className="btn btn-secondary btn-lg">Back to notes</Link>
    </div>
  );
}

/* The call from the welcome screen, written out. Nothing to share or delete. */
function Example({ me }: { me: Person }) {
  const [note] = useState(() => exampleNote(me));
  const [actions, setActions] = useState(note.actions);
  return (
    <>
      <div className="note-top" style={{ '--d': 0 }}><Link to="/home" className="back"><Icon name="left" size={17} />Home</Link></div>
      <div className="note" style={{ '--d': 1 }}>
        <article className="doc">
          <DocHead title={note.title} when="Example · 24 minutes" people={note.people} chip={<Chip tone="accent" className="mb-4">Example</Chip>} />
          <Section title="Summary"><p className="summary">{note.summary}</p></Section>
          <Section title="Decided" count={note.decisions.length}><Decisions items={note.decisions} me={me.email} /></Section>
          <Section title="Follow-ups" count={`${actions.filter((a) => !a.done).length} open`}>
            <FollowUps actions={actions} me={me.email} onToggle={(a, on) => setActions((xs) => xs.map((x) => (x.id === a.id ? { ...x, done: on } : x)))} />
          </Section>
          <AskBar suggestions={note.suggestedQuestions} ask={askExample} />
        </article>
        <aside className="rail">
          <Chapters chapters={note.chapters} pos={0} />
          <Recipients recipients={note.recipients} me={me.email} />
        </aside>
      </div>
    </>
  );
}
