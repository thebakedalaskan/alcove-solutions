import {
  NoteMomentSchema, errorCode, errorMessage, firstName, minutesLabel, type ActionItem, type ActionPatch, type Decision, type DecisionPatch, type Note, type NoteProgress, type Person,
  type Question, type QuestionPatch
} from '@alcove/api';
import { Button, Chip, Dots, EmptyState, GoneArch, Icon, IconButton, NotesSign, Notice, Popover, Spinner, buttonClass, cn, useToast } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Provenance } from '~/features/notes/Evidence';
import { Player, usePlayer, type PlayerState } from '~/features/notes/Player';
import { askExample, exampleNote } from '~/features/notes/example';
import { correctedSince, speakersOf, type Correcting } from '~/features/notes/lines';
import { receivedLine } from '~/features/notes/meta';
import { AskBar, Chapters, Decisions, DocHead, FollowUps, Questions, Recipients, Section, Transcript, TranscriptLines, type ScreenRefShown, type ScreensShown } from '~/features/notes/parts';
import { ScreenMomentRow, ScreenRefChip, ScreenViewer, ScreensCard, useScreenViewer } from '~/features/notes/screens';
import { PinNote, ShareNote } from '~/features/notes/share';
import { SeriesCard, SeriesChip } from '~/features/series/cards';
import { useNoteOnScreen } from '~/features/shell/notify';
import { api } from '~/lib/api';
import { log } from '~/lib/log';
import { sameEmail } from '~/lib/people';
import { q, qk, useCorrectLine, useDeleteNote, useRewriteNotes, useUpdateAction, useUpdateDecision, useUpdateQuestion } from '~/lib/queries';
import { noteWhen } from '~/lib/time';

export const Route = createFileRoute('/_app/notes/$noteId')({
  /**
   * `at`: a moment in the recording, in seconds, from a link in an answer or a series: the page opens the player
   * there without playing, and the transcript at the line said then.
   */
  validateSearch: (s: Record<string, unknown>): { at?: number | undefined } => {
    const at = NoteMomentSchema.safeParse(s['at']);
    return { at: at.success ? at.data : undefined };
  },
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
  useNoteOnScreen(id);
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
  // Followed until the notes are written: the first time, or again (the note stays ready meanwhile).
  useEffect(() => {
    if (note.status === 'ready' && !note.writingAgain) return;
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
  }, [note.id, note.status, note.writingAgain, qc]);
  return p;
}

/**
 * Opens the player at the moment the address asks for (`?at=`), without playing; once for each note and moment,
 * so a refresh doesn't move it back.
 */
function useOpenAt(noteId: string, at: number | undefined, player: PlayerState) {
  const done = useRef<string | null>(null);
  const { seek, total } = player;
  useEffect(() => {
    if (at === undefined || total <= 0 || done.current === `${noteId}@${at}`) return;
    done.current = `${noteId}@${at}`;
    seek(at, false);
  }, [at, noteId, seek, total]);
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

/** Where a note's page starts: back to Notes, and the note's title (or what happened to it). */
function Crumb({ to = 'Notes', here }: { to?: 'Notes' | 'Home' | undefined; here?: string | undefined }) {
  return (
    <nav className="crumb" aria-label="Breadcrumb">
      <Link to={to === 'Home' ? '/home' : '/notes'}><Icon name="left" size={16} />{to}</Link>
      {here && <><span aria-hidden="true">/</span><span className="ac-clamp-1" aria-current="page">{here}</span></>}
    </nav>
  );
}

/** A note's state, then the series it's in and how you got it, as chips above its title. */
function Chips({ note }: { note: Note }) {
  const received = note.received;
  return (
    <>
      {note.status === 'recording' ? <NotesSign>Still recording</NotesSign>
        : note.status === 'pending' ? <Chip><Spinner className="size-3" />Being written</Chip>
          : note.writingAgain ? <Chip><Spinner className="size-3" />Being written again</Chip>
            : <Chip tone="sun" icon="check">Ready</Chip>}
      {note.seriesId && <SeriesChip seriesId={note.seriesId} />}
      {received && <Chip icon={received.role === 'shared' ? 'share' : 'video'}>{receivedLine(received)}</Chip>}
    </>
  );
}

function NoteView({ note, me, at, onGone }: { note: Note; me: string | undefined; at: number | undefined; onGone: (g: GoneInfo) => void }) {
  const toast = useToast();
  const del = useDeleteNote();
  const updateAction = useUpdateAction();
  const updateDecision = useUpdateDecision();
  const updateQuestion = useUpdateQuestion();
  const correctLine = useCorrectLine();
  const rewrite = useRewriteNotes();
  const player = usePlayer(note.id, note.audio);
  useOpenAt(note.id, at, player);
  const progress = useProgress(note);
  const [more, setMore] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [going, setGoing] = useState(false);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const received = note.received;
  const mine = !received;
  const organizer = note.recipients.find((r) => r.role === 'organizer')?.person;
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
    organizer: mine,
    onCorrect: (l, patch) => correctLine.mutate({ noteId: note.id, lineId: l.id, patch }, { onError: failed })
  } : undefined;
  const corrected = correctedSince(lines, note.writtenAt);
  // Where writing them again has got to, once the notes service says.
  const step = note.writingAgain && progress && !progress.ready ? progress.steps.at(-1)?.label : undefined;
  const writeAgain = () => rewrite.mutate(note.id, { onError: failed });
  const toConfirm = note.decisions.filter((d) => d.state === 'proposed').length;
  const stillOpen = note.questions.filter((x) => x.state === 'open').length;
  const part = (i: number) => ({ className: going ? 'going' : undefined, style: { '--d': i } });

  return (
    <>
      <div className="note-top" style={{ '--d': 0 }}>
        <Crumb here={note.title} />
        <div className="note-acts">
          <PinNote noteId={note.id} />
          <ShareNote note={note} onShared={(emails) => setFresh(new Set(emails))} />
          <Popover open={more} onOpenChange={setMore} align="end" label="More" className="w-[264px]"
            anchor={<IconButton icon="more" label="More" />}>
            <button type="button" className="ac-pop-item" disabled={!ready} onClick={() => { setMore(false); void navigator.clipboard?.writeText(asText(note)).then(() => toast('Copied as text')); }}>
              <Icon name="copy" size={18} /><span><b>Copy as text</b>{!ready && <small>Once the notes are written.</small>}</span>
            </button>
            <div className="ac-pop-sep" />
            <button type="button" className="ac-pop-item is-caution" onClick={() => { setMore(false); setConfirm(true); }}>
              <Icon name="trash" size={18} /><span>{mine ? <><b>Delete notes</b><small>For everyone. Can’t be undone.</small></> : <><b>Remove from your notes</b><small>Everyone else keeps them.</small></>}</span>
            </button>
          </Popover>
        </div>
      </div>
      <div className="note" style={{ '--d': 1 }}>
        <article className="doc">
          <DocHead title={note.title} when={noteWhen(note.startedAt, note.duration)} people={note.people} me={me} chips={<Chips note={note} />}
            proof={note.inference.length ? <Provenance evidence={note.inference} kind={note.kind} /> : undefined} />
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
              {note.writingAgain && (
                <section className={cn('sec', going && 'going')}>
                  <Notice tone="info" icon="pen">
                    <b>Writing the notes again</b> from the transcript as it is now. Until then these are the notes as they were, and whatever anyone confirms or changes stays.{step ? ` ${step}.` : ''}
                  </Notice>
                </section>
              )}
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
                <Section title="Transcript" count={minutesLabel(note.duration)} {...part(4)}>
                  {mine && corrected > 0 && !note.writingAgain && (
                    <div className="tr-again">
                      <Icon name="pen" size={16} />
                      <span>{corrected === 1 ? 'A line was corrected' : `${corrected} lines were corrected`} since these notes were written.</span>
                      <Button variant="secondary" size="sm" loading={rewrite.isPending} onClick={writeAgain}>Write the notes again</Button>
                    </div>
                  )}
                  <Transcript lines={lines} gaps={note.gaps} seconds={note.duration} me={me} onSeek={seek} focus={at} screens={screens} correct={correct} />
                </Section>
              )}
            </>
          ) : ready && lines.length ? (
            <>
              <section className={cn('sec', going && 'going')}>
                {note.writingAgain ? (
                  <Notice tone="info" icon="pen"><b>Writing the notes</b> from the transcript as it is now.{step ? ` ${step}.` : ''}</Notice>
                ) : (
                  <>
                    <Notice tone="caution" icon="pen">
                      <b>The summary couldn’t be written.</b> The transcript and the audio are kept, and you can still ask about the {note.kind === 'room' ? 'recording' : 'call'}.
                    </Notice>
                    {mine && <Button variant="secondary" size="sm" className="mt-3" loading={rewrite.isPending} onClick={writeAgain}>Try writing them again</Button>}
                  </>
                )}
              </section>
              <Section title="Transcript" count={minutesLabel(note.duration)} {...part(1)}><TranscriptLines lines={lines} gaps={note.gaps} me={me} onSeek={seek} focus={at} screens={screens} correct={correct} /></Section>
            </>
          ) : ready ? (
            <section className={cn('sec', going && 'going')}>
              <EmptyState className="note-empty" title={note.kind === 'room' ? 'Nothing was said while recording' : 'Nothing was said while notes were on'}
                action={player.total > 0 ? <Button size="sm" icon={player.playing ? 'pause' : 'play'} onClick={player.toggle}>{player.playing ? 'Pause' : `Play ${minutesLabel(player.total)}`}</Button> : undefined}>
                {note.audio.length ? 'So there’s no summary or transcript. You can still play the audio.' : 'So there’s no summary or transcript.'}
              </EmptyState>
            </section>
          ) : (
            <>
              <section className={cn('sec', going && 'going')}>
                <Notice tone="info" icon="lock">
                  <b>{note.status === 'recording' ? 'The recording is still going.' : 'The audio is saved and encrypted.'}</b> Summary, decisions and follow-ups are {note.status === 'recording' ? 'written in confidential compute once it stops' : 'being written in confidential compute'}. {note.kind === 'room' ? 'They show here when they’re ready.' : 'Everyone invited gets them when they’re ready.'}
                </Notice>
                {progress && <Steps steps={progress.steps} />}
              </section>
              {lines.length > 0 && <Section title="Transcript" count={minutesLabel(note.duration)} {...part(1)}><TranscriptLines lines={lines} gaps={note.gaps} me={me} onSeek={seek} screens={screens} /></Section>}
            </>
          )}
          {ready && lines.length > 0 && !going && <AskBar suggestions={note.suggestedQuestions} ask={(question) => api.notes.ask(note.id, question)} onSeek={seek} shown={onScreen} />}
        </article>
        <aside className="rail" aria-label="About these notes">
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

/** How the notes are coming along: what's done, ticked; what's happening now, with dots; what's still to come. */
function Steps({ steps }: { steps: NoteProgress['steps'] }) {
  const now = steps.findIndex((s) => !s.done);
  return (
    <ul className="steps">
      {steps.map((s, i) => (
        <li key={s.label} className={cn(s.done && 'done', i === now && 'now')}>
          {s.done ? <Icon name="check" size={15} /> : i === now ? <Dots /> : <Icon name="clock" size={15} />}{s.label}
        </li>
      ))}
    </ul>
  );
}

/** What's left where a note was: what went, or why it isn't here, and the way back. */
function GonePage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <div className="note-top"><Crumb /></div>
      <section className="ac-card gone" aria-label={title}>
        <GoneArch />
        <h2>{title}</h2>
        {children}
        <Link to="/notes" className={buttonClass({ size: 'sm' })}>Back to notes</Link>
      </section>
    </>
  );
}

/* Delete is physical: say exactly what went. */
function Gone({ kind, audio, screens, organizer }: GoneInfo) {
  if (kind === 'removed') return <GonePage title="Removed"><p>They’re out of your notes. {organizer} still has them.</p></GonePage>;
  return (
    <GonePage title="Deleted">
      <p>Gone from Alcove, for everyone who had them:</p>
      <ul>
        <li><Icon name="check" size={17} />Summary, decisions and follow-ups</li>
        <li><Icon name="check" size={17} />The transcript</li>
        <li><Icon name="check" size={17} />{audio} of audio</li>
        {screens > 0 && <li><Icon name="check" size={17} />{screens} shared {screens === 1 ? 'screen' : 'screens'}, and what was read on {screens === 1 ? 'it' : 'them'}</li>}
      </ul>
    </GonePage>
  );
}

function Missing({ error }: ErrorComponentProps) {
  const notFound = errorCode(error) === 'not-found';
  return (
    <GonePage title={notFound ? 'These notes aren’t here' : 'Couldn’t open these notes'}>
      <p>{notFound ? 'They were deleted, or they were never shared with you.' : errorMessage(error)}</p>
    </GonePage>
  );
}

/* The call from the welcome screen, written out. Nothing to share or delete. */
function Example({ me }: { me: Person }) {
  const [note] = useState(() => exampleNote(me));
  const [actions, setActions] = useState(note.actions);
  return (
    <>
      <div className="note-top" style={{ '--d': 0 }}><Crumb to="Home" here={note.title} /></div>
      <div className="note" style={{ '--d': 1 }}>
        <article className="doc">
          <DocHead title={note.title} when="Example · 24 min" people={note.people} me={me.email} chips={<Chip tone="sun">Example</Chip>} />
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
