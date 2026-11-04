import {
  errorCode, errorMessage, firstName, minutesLabel, type ActionItem, type ActionPatch, type Decision, type DecisionPatch, type Note, type NoteProgress, type Person, type Question,
  type QuestionPatch
} from '@alcove/api';
import { Button, Chip, EmptyState, GoneArch, Icon, IconButton, NotesSign, Notice, Popover, Spinner, buttonClass, cn, useToast } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { Provenance } from '~/features/notes/Evidence';
import { Player, usePlayer } from '~/features/notes/Player';
import { askExample, exampleNote } from '~/features/notes/example';
import { speakersOf, type Correcting } from '~/features/notes/lines';
import { AskBar, Chapters, Decisions, DocHead, FollowUps, Questions, Recipients, Section, Transcript, TranscriptLines, type ScreenRefShown, type ScreensShown } from '~/features/notes/parts';
import { ScreenMomentRow, ScreenRefChip, ScreenViewer, ScreensCard, useScreenViewer } from '~/features/notes/screens';
import { PeoplePicker } from '~/features/people/PeoplePicker';
import { SeriesCard } from '~/features/series/cards';
import { api } from '~/lib/api';
import { log } from '~/lib/log';
import { listNames, sameEmail } from '~/lib/people';
import { q, qk, useCorrectLine, useDeleteNote, useRewriteNotes, useShareNote, useUpdateAction, useUpdateDecision, useUpdateQuestion } from '~/lib/queries';
import { noteWhen } from '~/lib/time';

/** `at`: a moment to open the notes at (seconds into the call), from a link in a series or an answer. */
const atOf = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);

export const Route = createFileRoute('/_app/notes/$noteId')({
  validateSearch: (s: Record<string, unknown>): { at?: number | undefined } => ({ at: atOf(s['at']) }),
  loader: ({ context, params }) => (params.noteId === 'example' ? undefined : context.queryClient.ensureQueryData(q.note(params.noteId))),
  errorComponent: Missing,
  component: NotePage
});

const nlog = log.child({ component: 'note' });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function NotePage() {
  const { noteId } = Route.useParams();
  const { at } = Route.useSearch();
  const me = useQuery(q.session()).data?.user;
  if (noteId === 'example') return me ? <Example me={me} /> : null;
  return <Stored key={noteId} id={noteId} me={me?.email} at={at} />;
}

interface GoneInfo { kind: 'deleted' | 'removed'; audio: string; screens: number; organizer: string }

function Stored({ id, me, at }: { id: string; me: string | undefined; at: number | undefined }) {
  const qc = useQueryClient();
  const [gone, setGone] = useState<GoneInfo | null>(null);
  const note = useQuery({ ...q.note(id), enabled: !gone }).data;
  useEffect(() => { if (gone) qc.removeQueries({ queryKey: qk.note(id), exact: true }); }, [gone, qc, id]);
  if (gone) return <Gone {...gone} />;
  if (!note) return null;
  return <NoteView note={note} me={me} at={at} onGone={setGone} />;
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
  // What people said wasn't decided stays out; what nobody has confirmed yet, or no longer holds, says so.
  const decided = n.decisions.filter((d) => d.state !== 'rejected');
  const open = n.questions.filter((x) => x.state === 'open');
  return [
    n.title, noteWhen(n.startedAt, n.duration), '', n.summary,
    ...(decided.length ? ['', 'Decided', ...decided.map((d) => `- ${d.text}${d.state === 'proposed' ? ' (not confirmed yet)' : d.state === 'superseded' ? ' (no longer holds)' : ''}`)] : []),
    ...(open.length ? ['', 'Still open', ...open.map((x) => `- ${x.text}`)] : []),
    ...(n.actions.length ? ['', 'Follow-ups', ...n.actions.map((a) => `- ${a.text}${about(a) ? ` (${about(a)})` : ''}`)] : [])
  ].join('\n');
}

function NoteView({ note, me, at, onGone }: { note: Note; me: string | undefined; at: number | undefined; onGone: (g: GoneInfo) => void }) {
  const toast = useToast();
  const share = useShareNote();
  const del = useDeleteNote();
  const updateAction = useUpdateAction();
  const updateDecision = useUpdateDecision();
  const updateQuestion = useUpdateQuestion();
  const correctLine = useCorrectLine();
  const rewrite = useRewriteNotes();
  const player = usePlayer(note.id, note.audio);
  // Brought here to a moment: the audio waits there, ready to play. Once per link, so a refresh doesn't move it back.
  const { seek: cue } = player;
  const cued = useRef('');
  useEffect(() => {
    const key = `${note.id}@${at ?? ''}`;
    if (at === undefined || !note.audio.length || cued.current === key) return;
    cued.current = key;
    cue(at, false);
  }, [at, note.id, note.audio.length, cue]);
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
  // What was on shared screens: among the transcript lines, beside the note, and wherever the notes point at it.
  const viewer = useScreenViewer();
  const screens: ScreensShown | undefined = note.screens.length
    ? { moments: note.screens, row: (m) => <ScreenMomentRow noteId={note.id} m={m} me={me} written={ready} onOpen={viewer.show} /> } : undefined;
  const onScreen: ScreenRefShown = (ref) => <ScreenRefChip screen={ref} screens={note.screens} onOpen={viewer.show} />;

  const remove = async () => {
    try {
      await del.mutateAsync(note.id);
      setConfirm(false);
      setGoing(true);
      await sleep(900);
      onGone({ kind: mine ? 'deleted' : 'removed', audio: minutesLabel(note.duration), screens: note.screens.length, organizer: organizer ? firstName(organizer.name) : 'The organizer' });
    } catch (e) { toast(errorMessage(e), { icon: 'x' }); }
  };
  const failed = (e: unknown) => toast(errorMessage(e), { icon: 'x' });
  const toggle = (a: ActionItem, on: boolean) => updateAction.mutate({ noteId: note.id, actionId: a.id, patch: { done: on } }, { onSuccess: () => { if (on) toast('Marked done', { ms: 2200 }); }, onError: failed });
  const changeAction = (a: ActionItem, patch: ActionPatch) => updateAction.mutate({ noteId: note.id, actionId: a.id, patch }, {
    onSuccess: () => { if (patch.takeOn) toast('It’s yours. Everyone with the notes sees that.', { icon: 'check' }); }, onError: failed
  });
  const changeDecision = (d: Decision, patch: DecisionPatch) => updateDecision.mutate({ noteId: note.id, decisionId: d.id, patch }, { onError: failed });
  const changeQuestion = (x: Question, patch: QuestionPatch) => updateQuestion.mutate({ noteId: note.id, questionId: x.id, patch }, { onError: failed });
  // The organizer corrects any line; anyone else who has the notes, the words of their own lines (the server's rule too).
  const correct: Correcting | undefined = ready ? {
    can: (l) => mine || (!!me && !!l.speaker?.person?.email && sameEmail(l.speaker.person, { email: me })),
    people: mine && note.kind === 'call' ? speakersOf(note) : null,
    onCorrect: (l, patch) => correctLine.mutate({ noteId: note.id, lineId: l.id, patch }, { onError: failed })
  } : undefined;
  const since = note.writtenAt;
  const corrected = since ? lines.filter((l) => (l.changes ?? []).some((c) => c.at > since)).length : 0;
  const writeAgain = () => rewrite.mutate(note.id, { onError: failed });
  const toConfirm = note.decisions.filter((d) => d.state === 'proposed').length;
  const stillOpen = note.questions.filter((x) => x.state === 'open').length;
  const part = (i: number) => ({ className: going ? 'going' : undefined, style: { '--d': i } });

  return (
    <>
      <div className="note-top" style={{ '--d': 0 }}>
        <Link to="/notes" className={cn(buttonClass({ variant: 'quiet', size: 'sm' }), 'back')}><Icon name="left" size={16} />Notes</Link>
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
            <button type="button" className="ac-pop-item" disabled={!ready} onClick={() => { setPop(null); void navigator.clipboard?.writeText(asText(note)).then(() => toast('Copied as text')); }}>
              <Icon name="copy" size={18} /><span><b>Copy as text</b>{!ready && <small>Once the notes are written.</small>}</span>
            </button>
            <div className="ac-pop-sep" />
            <button type="button" className="ac-pop-item is-caution" onClick={() => { setPop(null); setConfirm(true); }}>
              <Icon name="trash" size={18} /><span>{mine ? <><b>Delete notes</b><small>For everyone. Can’t be undone.</small></> : <><b>Remove from your notes</b><small>Everyone else keeps them.</small></>}</span>
            </button>
          </Popover>
        </div>
      </div>
      <div className="note" style={{ '--d': 1 }}>
        <article className="doc">
          <DocHead title={note.title} when={noteWhen(note.startedAt, note.duration)} people={note.people} proof={note.inference.length ? <Provenance evidence={note.inference} kind={note.kind} /> : undefined}
            series={note.seriesId ? <Link to="/notes/series/$seriesId" params={{ seriesId: note.seriesId }} className="ser-link"><Icon name="repeat" size={15} />In a series</Link> : undefined}
            chip={note.status === 'recording' ? <NotesSign className="lead-chip">Still recording</NotesSign>
              : note.status === 'pending' ? <Chip className="lead-chip"><Spinner className="size-3" />Waiting to be written</Chip>
                : !mine && organizer ? <Chip tone="sun" className="lead-chip">{myRole === 'shared' ? 'Shared with you' : `From ${firstName(organizer.name)}’s call`}</Chip> : null} />
          {confirm && (
            <div className="confirm" role="alertdialog" aria-label={mine ? 'Delete these notes' : 'Remove these notes'}>
              <span className="ic"><Icon name="trash" size={19} /></span>
              <div>
                <b>{mine ? 'Delete these notes for everyone?' : 'Remove these notes from yours?'}</b>
                <p>{mine ? `Removes the summary, the transcript, ${minutesLabel(note.duration)} of audio${note.screens.length ? ` and ${note.screens.length} shared ${note.screens.length === 1 ? 'screen' : 'screens'}` : ''} from Alcove. It can’t be undone.` : `${organizer ? firstName(organizer.name) : 'The organizer'} and everyone else who has them keep them.`}</p>
              </div>
              <div className="btns"><Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button><Button variant="primary" loading={del.isPending} onClick={() => void remove()}>{mine ? 'Delete' : 'Remove'}</Button></div>
            </div>
          )}
          {ready && written ? (
            <>
              <Section title="Summary" {...part(0)}><p className="summary">{note.summary}</p></Section>
              {note.decisions.length > 0 && (
                <Section title="Decided" count={toConfirm ? `${toConfirm} to confirm` : note.decisions.length} {...part(1)}>
                  <Decisions items={note.decisions} me={me} onChange={changeDecision} onSeek={seek} shown={onScreen} />
                </Section>
              )}
              {note.questions.length > 0 && (
                <Section title="Still open" count={stillOpen ? `${stillOpen} open` : 'All answered'} {...part(2)}>
                  <Questions items={note.questions} me={me} onChange={changeQuestion} onSeek={seek} shown={onScreen} />
                </Section>
              )}
              {note.actions.length > 0 && (
                <Section title="Follow-ups" count={`${open} open`} {...part(3)}>
                  <FollowUps actions={note.actions} me={me} people={note.recipients.map((r) => r.person)} onToggle={toggle} onChange={changeAction} shown={onScreen} />
                </Section>
              )}
              {lines.length > 0 && (
                <section className={cn('sec', going && 'going')} style={{ '--d': 4 }}>
                  {mine && corrected > 0 && (
                    <div className="tr-again">
                      <Icon name="pen" size={16} />
                      <span>{corrected === 1 ? 'A line was corrected' : `${corrected} lines were corrected`} since these notes were written.</span>
                      <Button variant="secondary" size="sm" loading={rewrite.isPending} onClick={writeAgain}>Write the notes again</Button>
                    </div>
                  )}
                  <Transcript lines={lines} gaps={note.gaps} seconds={note.duration} me={me} onSeek={seek} focus={at} screens={screens} correct={correct} />
                </section>
              )}
            </>
          ) : ready && lines.length ? (
            <>
              <section className={cn('sec', going && 'going')}>
                <Notice tone="caution" icon="pen">
                  <b>The summary couldn’t be written.</b> The transcript and the audio are kept, and you can still ask about the {note.kind === 'room' ? 'recording' : 'call'}.
                </Notice>
                {mine && <Button variant="secondary" size="sm" className="mt-3" loading={rewrite.isPending} onClick={writeAgain}>Try writing them again</Button>}
              </section>
              <Section title="Transcript" count={minutesLabel(note.duration)} {...part(1)}><TranscriptLines lines={lines} gaps={note.gaps} me={me} onSeek={seek} focus={at} screens={screens} correct={correct} /></Section>
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
                {note.status === 'pending' && note.writtenAt ? (
                  <Notice tone="info" icon="pen">
                    <b>Writing the notes again.</b> From the transcript as it is now, with its corrections. What people already confirmed or changed stays as it is.
                  </Notice>
                ) : (
                  <Notice tone="info" icon="lock">
                    <b>{note.status === 'recording' ? 'The recording is still going.' : 'The audio is saved and encrypted.'}</b> Summary, decisions and follow-ups are written by Alcove’s notes service. Everyone here gets them when it has.
                  </Notice>
                )}
                {progress && (
                  <ul className="steps">
                    {progress.steps.map((s) => <li key={s.label} className={cn(s.done && 'done')}><Icon name={s.done ? 'check' : 'clock'} size={15} />{s.label}</li>)}
                  </ul>
                )}
              </section>
              {lines.length > 0 && <Section title="Transcript" count={minutesLabel(note.duration)} {...part(1)}><TranscriptLines lines={lines} gaps={note.gaps} me={me} onSeek={seek} screens={screens} /></Section>}
            </>
          )}
          {ready && lines.length > 0 && !going && <AskBar suggestions={note.suggestedQuestions} ask={(question) => api.notes.ask(note.id, question)} onSeek={seek} shown={onScreen} />}
        </article>
        <aside className="rail">
          {player.total > 0 && <div className={cn(going && 'going')} style={{ '--d': 4 }}><Player noteId={note.id} player={player} chapters={note.chapters} room={note.kind === 'room'} /></div>}
          {note.chapters.length > 0 && <div className={cn(going && 'going')} style={{ '--d': 5 }}><Chapters chapters={note.chapters} gaps={note.gaps} pos={player.pos} onSeek={seek} /></div>}
          {note.screens.length > 0 && <div className={cn(going && 'going')} style={{ '--d': 5 }}><ScreensCard noteId={note.id} screens={note.screens} onOpen={viewer.show} /></div>}
          <div className={cn(going && 'going')} style={{ '--d': 6 }}><Recipients recipients={note.recipients} me={me} fresh={fresh} /></div>
          {!going && <div style={{ '--d': 7 }}><SeriesCard note={note} /></div>}
        </aside>
      </div>
      <ScreenViewer noteId={note.id} screens={note.screens} open={viewer.open} me={me} onOpen={viewer.show} onClose={viewer.close} onSeek={seek} />
    </>
  );
}

/* Delete is physical: say exactly what went. */
function Gone({ kind, audio, screens, organizer }: GoneInfo) {
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
            {screens > 0 && <li><Icon name="check" size={18} />{screens} shared {screens === 1 ? 'screen' : 'screens'}, and what was read on {screens === 1 ? 'it' : 'them'}</li>}
          </ul>
        </>
      ) : <p className="mb-4 text-ink-2">They’re out of your notes. {organizer} still has them.</p>}
      <Link to="/notes" className={buttonClass({ size: 'lg' })}>Back to notes</Link>
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
      <Link to="/notes" className={buttonClass({ size: 'lg' })}>Back to notes</Link>
    </div>
  );
}

/* The call from the welcome screen, written out. Nothing to share or delete. */
function Example({ me }: { me: Person }) {
  const [note] = useState(() => exampleNote(me));
  const [actions, setActions] = useState(note.actions);
  return (
    <>
      <div className="note-top" style={{ '--d': 0 }}><Link to="/home" className={cn(buttonClass({ variant: 'quiet', size: 'sm' }), 'back')}><Icon name="left" size={16} />Home</Link></div>
      <div className="note" style={{ '--d': 1 }}>
        <article className="doc">
          <DocHead title={note.title} when="Example · 24 minutes" people={note.people} chip={<Chip tone="sun" className="lead-chip">Example</Chip>} />
          <Section title="Summary"><p className="summary">{note.summary}</p></Section>
          <Section title="Decided" count={note.decisions.length}><Decisions items={note.decisions} me={me.email} /></Section>
          <Section title="Still open" count={`${note.questions.length} open`}><Questions items={note.questions} me={me.email} /></Section>
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
