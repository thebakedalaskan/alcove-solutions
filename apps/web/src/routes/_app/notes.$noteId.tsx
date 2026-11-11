import {
  NoteMomentSchema, NoteRoomParamSchema, errorCode, errorMessage, firstName, minutesLabel, type ActionItem, type ActionPatch, type Chapter, type Decision, type DecisionPatch, type Note, type NoteProgress, type Person,
  type PersonalPoint, type Question, type QuestionPatch, type TranscriptLine
} from '@alcove/api';
import { Button, Dots, Evening, Faces, Icon, Modal, Notice, RecDot, Select, cn, useToast } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { NoteBoardCards, NoteRoomBoardCards, type RoomBoard } from '~/features/notes/Boards';
import { CallLine, marksOf } from '~/features/notes/CallLine';
import { NoteDriveExports } from '~/features/notes/DriveExports';
import { Provenance } from '~/features/notes/Evidence';
import { GonePage, NoteMenu, PageHead } from '~/features/notes/Head';
import { Propose, useNoteReader, type Seed } from '~/features/notes/entries';
import { Replay, usePlayer, type PlayerState } from '~/features/notes/Player';
import type { Answer } from '~/features/notes/answer';
import { askExample, exampleNote } from '~/features/notes/example';
import { correctedSince, speakersOf, type Correcting } from '~/features/notes/lines';
import { noteAsText, peopleLine, receivedLine } from '~/features/notes/meta';
import { AskBar, ChapterList, Recipients, Section, Summary, Transcript, roomAnchor, type Focus, type LineKinds, type ScreenRefShown, type ScreensShown } from '~/features/notes/parts';
import { RoomSections } from '~/features/notes/rooms';
import { NewFollowUp, NoteFollowUpReview } from '~/features/notes/NoteFollowUps';
import { Decisions, FollowUps, Questions } from '~/features/notes/rows';
import { ScreenMomentRow, ScreenRefChip, ScreenViewer, useScreenViewer } from '~/features/notes/screens';
import { WorkedOn } from '~/features/notes/WorkedOn';
import { PinNote, ShareNote } from '~/features/notes/share';
import { noteWave } from '~/features/notes/wave';
import { OwnNotesCard, SharedNotes, useOwn } from '~/features/personal/OwnNotes';
import { SeriesCard } from '~/features/series/cards';
import { useNoteOnScreen } from '~/features/shell/notify';
import { api } from '~/lib/api';
import { log } from '~/lib/log';
import { sameEmail } from '~/lib/people';
import { q, qk, useCancelRewrite, useCorrectLine, useDeleteNote, useProposeDecision, useRewriteNotes, useUpdateAction, useUpdateDecision, useUpdateQuestion, useAiModels } from '~/lib/queries';
import { noteAt } from '~/lib/time';
import { isUnencrypted, modelOf, modelOptions, modelValue } from '~/lib/aiModels';

export const Route = createFileRoute('/_app/notes/$noteId')({
  /**
   * `at`: a moment in the recording, in seconds, from a link in an answer or a series: the page opens the player
   * there without playing, and the transcript at the line said then. `room`: the breakout room's section the link came
   * to, which opens, with its own transcript at `at`.
   */
  validateSearch: (s: Record<string, unknown>): { at?: number | undefined; room?: string | undefined } => {
    const at = NoteMomentSchema.safeParse(s['at']);
    const room = NoteRoomParamSchema.safeParse(s['room']);
    return { at: at.success ? at.data : undefined, room: room.success ? room.data : undefined };
  },
  loader: ({ context, params }) => (params.noteId === 'example' ? undefined : context.queryClient.ensureQueryData(q.note(params.noteId))),
  errorComponent: Missing,
  component: NotePage
});

const nlog = log.child({ component: 'note' });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function NotePage() {
  const { noteId } = Route.useParams();
  const { at, room } = Route.useSearch();
  const me = useQuery(q.session()).data?.user;
  if (noteId === 'example') return me ? <Example me={me} /> : null;
  return <Stored key={noteId} id={noteId} me={me?.email} at={at} room={room} />;
}

interface GoneInfo { kind: 'deleted' | 'removed'; transcript: boolean; audio: string | null; screens: number; rooms: number; roomsSaid: boolean; organizer: string }
const NO_AUDIO: Note['audio'] = [];
/** "The summary, the transcript and 4 min of audio" */
const asList = (parts: string[]) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`);

function Stored({ id, me, at, room }: { id: string; me: string | undefined; at: number | undefined; room: string | undefined }) {
  const qc = useQueryClient();
  const [gone, setGone] = useState<GoneInfo | null>(null);
  // A failed read keeps the last answer, which would keep showing notes someone may not read any more.
  const note = useQuery({ ...q.note(id), enabled: !gone, throwOnError: (e) => errorCode(e) === 'not-found' }).data;
  useEffect(() => { if (gone) qc.removeQueries({ queryKey: qk.note(id), exact: true }); }, [gone, qc, id]);
  useNoteOnScreen(id);
  if (gone) return <Gone {...gone} />;
  if (!note) return null;
  return <NoteView note={note} me={me} at={at} room={room} onGone={setGone} />;
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
    seek(at);
  }, [at, noteId, seek, total]);
}

/**
 * The column beside a long note stays in view: it scrolls with the page until its end is on screen, then waits there.
 * Set on the column, so it needs nothing from the scrolling itself.
 */
function useStayInView(side: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = side.current;
    if (!el) return;
    const place = () => el.style.setProperty('--nd-stay', `${Math.min(84, innerHeight - el.offsetHeight - 16)}px`);
    const grew = new ResizeObserver(place);
    grew.observe(el);
    addEventListener('resize', place);
    return () => { grew.disconnect(); removeEventListener('resize', place); };
  }, [side]);
}

/** Which lines something in the notes came from. A decision someone said wasn't one no longer counts. */
function kindsOf(note: Note): LineKinds {
  const out = new Map<string, 'decide' | 'follow'>();
  for (const a of note.actions) for (const l of a.lines) out.set(l, 'follow');
  for (const d of note.decisions) if (d.state !== 'rejected') for (const l of d.lines) out.set(l, 'decide');
  return out;
}

/** A line a call hasn't finished can't know its end, so it's drawn to the next quarter of an hour. */
const QUARTER = 900;

function NoteView({ note, me, at, room, onGone }: { note: Note; me: string | undefined; at: number | undefined; room: string | undefined; onGone: (g: GoneInfo) => void }) {
  const toast = useToast();
  const navigate = Route.useNavigate();
  const del = useDeleteNote();
  const updateAction = useUpdateAction();
  const updateDecision = useUpdateDecision();
  const updateQuestion = useUpdateQuestion();
  const proposeDecision = useProposeDecision();
  const correctLine = useCorrectLine();
  const rewrite = useRewriteNotes();
  const cancel = useCancelRewrite();
  const yours = useOwn(note.id);
  const writtenPrivately = !isUnencrypted(useAiModels().data, note.model);
  // A call that doesn't keep its recording has none to play, whatever is still on its way out.
  const audio = note.kept.recording ? note.audio : NO_AUDIO;
  const player = usePlayer(note.id, audio, note.status === 'recording');
  useOpenAt(note.id, at, player);
  const progress = useProgress(note);
  const [going, setGoing] = useState(false);
  const [sharedTo, setSharedTo] = useState<ReadonlySet<string>>(new Set());
  /* The transcript line someone is proposing something from, if they are. */
  const [seed, setSeed] = useState<Seed | null>(null);
  // Writing the notes again: which AI model does it, and whether that's being chosen.
  const [model, setModel] = useState<string | null>(note.model);
  const [choosing, setChoosing] = useState(false);
  const received = note.received;
  const mine = !received;
  const reader = useNoteReader()(received?.role ?? 'organizer');
  const organizer = note.recipients.find((r) => r.role === 'organizer')?.person;
  const ready = note.status === 'ready';
  const live = note.status === 'recording';
  const lines = useMemo(() => note.transcript ?? [], [note.transcript]);
  const written = note.summary.trim() !== '';
  // The transcript went with the notes written, as the call was set to: no transcript here is no sign nothing was said.
  const deleted = !note.kept.transcript && !lines.length;

  /* A moment in a breakout room is in that room's lines: the call's own transcript has nothing to mark. */
  const inRoom = room !== undefined && note.rooms.some((r) => r.id === room);
  const [focus, setFocus] = useState<Focus | undefined>(undefined);
  useEffect(() => { if (at !== undefined && !inRoom) setFocus({ at }); }, [at, inRoom]);
  const { seek: moveTo } = player;
  const hasAudio = audio.length > 0;
  const canGo = hasAudio || lines.length > 0;
  /** Goes to a moment: the sun moves there, playing on if it was (or from there, with `play`), and the transcript goes to that line. */
  const go = useCallback((s: number, play?: boolean) => { moveTo(s, play); setFocus({ at: s }); }, [moveTo]);
  const seek = canGo ? go : undefined;
  /* The shared screens playing above the notes, when there are any. Playing the call from a frame goes up to them. */
  const reduce = useReducedMotion();
  const replay = useRef<HTMLDivElement>(null);
  const toReplay = useRef(false);
  const playFrom = (s: number) => {
    if (!replay.current) { go(s, true); return; }
    moveTo(s, true);
    toReplay.current = true;
  };
  /** Once the viewer has closed after that: focus and the page go to the video, not back to the frame in the transcript. */
  const upToReplay = () => {
    const el = replay.current;
    if (!toReplay.current || !el) return false;
    toReplay.current = false;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    return true;
  };
  /** A chapter in the side list goes to its line in the transcript, or to its breakout rooms. */
  const goChapter = (c: Chapter) => {
    const r = note.rooms.find((x) => Math.abs(x.from - c.at) < 2);
    if (!r) { go(c.at); return; }
    moveTo(c.at);
    void navigate({ search: { room: r.id }, hash: roomAnchor(r.id), hashScrollIntoView: { block: 'start' }, replace: true });
  };
  /** With a recording, a chapter on the line moves the sun and leaves the page, except a breakout rooms' chapter, which opens them. Without one, it goes to its line, as in the side list. */
  const toChapter = (c: Chapter) => {
    const r = note.rooms.find((x) => Math.abs(x.from - c.at) < 2);
    moveTo(c.at);
    if (!r) return;
    void navigate({ search: { room: r.id }, hash: roomAnchor(r.id), hashScrollIntoView: { block: 'start' }, replace: true });
  };

  // What was on shared screens: among the transcript lines, wherever the notes point at it, and in the viewer.
  // Frames judged to have nothing to do with what was said stay out of sight; they're still deleted with the note.
  const viewer = useScreenViewer();
  const moments = note.screens.filter((m) => m.relevance !== 'unrelated');
  const screens: ScreensShown | undefined = moments.length
    ? { moments, row: (m) => <ScreenMomentRow noteId={note.id} m={m} me={me} written={ready} onOpen={viewer.show} /> } : undefined;
  const onScreen: ScreenRefShown = (ref) => <ScreenRefChip screen={ref} screens={moments} onOpen={viewer.show} />;
  const firstScreen = moments[0];

  const roomsSaid = note.rooms.some((r) => r.transcript.length > 0);
  const roomNotes = note.rooms.some((r) => r.summary.trim() !== '');
  const remove = async () => {
    try {
      await del.mutateAsync(note.id);
      setGoing(true);
      await sleep(620);
      onGone({ kind: mine ? 'deleted' : 'removed', transcript: lines.length > 0, audio: hasAudio ? minutesLabel(note.duration) : null, screens: note.screens.length, rooms: note.rooms.length, roomsSaid, organizer: organizer ? firstName(organizer.name) : 'The organizer' });
    } catch (e) { toast(errorMessage(e), { icon: 'x' }); }
  };
  const failed = (e: unknown) => toast(errorMessage(e), { icon: 'x' });
  const toggle = (a: ActionItem, on: boolean) => updateAction.mutate({ noteId: note.id, actionId: a.id, patch: { done: on } }, { onSuccess: () => { if (on) toast('Marked done', { ms: 2200 }); }, onError: failed });
  const changeAction = (a: ActionItem, patch: ActionPatch) => updateAction.mutate({ noteId: note.id, actionId: a.id, patch }, {
    onSuccess: () => { if (patch.takeOn) toast('It’s yours. Everyone with the notes sees that.', { icon: 'check' }); }, onError: failed
  });
  /* Whichever part of the notes it's for, what someone adds is proposed by them; what failed says why, and stays in the field. */
  const adding = (p: Promise<unknown>) => p.then(() => true, (e: unknown) => { failed(e); return false; });
  const addDecision = (r: string | undefined) => (text: string, from: string[]) => adding(proposeDecision.mutateAsync({ noteId: note.id, proposal: { text, lines: from, ...(r ? { room: r } : {}) } }));
  const proposing = (kind: Seed['kind'], line: TranscriptLine) => setSeed({ kind, line, room: note.rooms.find((r) => r.transcript.some((l) => l.id === line.id))?.id });
  const seedFor = (kind: Seed['kind'], r: string | undefined) => (seed?.kind === kind && seed.room === r ? seed : undefined);
  const decisionForm = (r?: string | undefined) => <Propose label="Propose a decision" placeholder="What was decided" hint="Everyone with the notes sees it, as proposed by you, until someone else confirms it." busy={proposeDecision.isPending} seed={seedFor('decision', r)} onAdd={addDecision(r)} onDone={() => setSeed(null)} />;
  const actionForm = (r?: string | undefined) => <NewFollowUp noteId={note.id} room={r} people={note.recipients.map((recipient) => recipient.person)} seed={seedFor('follow-up', r)} onDone={() => setSeed(null)} />;
  const changeDecision = (d: Decision, patch: DecisionPatch) => updateDecision.mutate({ noteId: note.id, decisionId: d.id, patch }, { onError: failed });
  const changeQuestion = (x: Question, patch: QuestionPatch) => updateQuestion.mutate({ noteId: note.id, questionId: x.id, patch }, { onError: failed });
  // The organizer corrects any line; anyone else who has the notes, the words of their own lines (the server's rule too).
  const correct: Correcting | undefined = ready ? {
    can: (l) => mine || (!!me && !!l.speaker?.person?.email && sameEmail(l.speaker.person, { email: me })),
    people: mine && note.kind === 'call' ? speakersOf(note) : null,
    organizer: mine,
    onCorrect: (l, patch) => correctLine.mutate({ noteId: note.id, lineId: l.id, patch }, { onError: failed })
  } : undefined;
  // Only where what it adds will show: notes that couldn't be written have no decisions or follow-ups to show it among.
  const fromLine = ready && written ? proposing : undefined;
  const corrected = correctedSince([...lines, ...note.rooms.flatMap((r) => r.transcript)], note.writtenAt);
  // Where writing them again has got to, once the notes service says.
  const step = note.writingAgain && progress && !progress.ready ? progress.steps.at(-1)?.label : undefined;
  const writeAgain = () => rewrite.mutate({ noteId: note.id, model }, { onSuccess: () => setChoosing(false), onError: failed });
  const pickModel = mine ? <ModelPick value={model} onChange={setModel} /> : null;
  // Offered to the organizer once a line, the call's or a breakout room's, was corrected since the notes were written.
  const again = mine && corrected > 0 && !note.writingAgain ? (
    <div className="nd-offer">
      <Icon name="history" size={16} />
      <span>{corrected === 1 ? 'A line was corrected' : `${corrected} lines were corrected`} since these notes were written.</span>
      {pickModel}
      <Button size="sm" loading={rewrite.isPending} onClick={writeAgain}>Write the notes again</Button>
    </div>
  ) : null;
  // The organizer can stop a rewrite: the notes stay as they were.
  const stop = mine ? <Button variant="quiet" size="sm" loading={cancel.isPending} onClick={() => cancel.mutate(note.id, { onSuccess: () => toast('Stopped. The notes are as they were.'), onError: failed })}>Cancel</Button> : null;
  const writingAgain = note.writingAgain && <p className="nd-again"><Dots /><span><b>Writing the notes again</b> from the transcript as it is now. What people confirmed or took on stays.{step ? ` ${step}.` : ''}</span>{stop}</p>;
  // Each breakout room's own section, under the call's notes; whether any room has what was said in it to show, and
  // whether any has notes, which stay when a call isn't set to keep what they were written from.
  const settle = ready ? { reader, onDecision: changeDecision, onQuestion: changeQuestion, onToggle: toggle, onAction: changeAction, people: note.recipients.map((r) => r.person), decisionForm, actionForm } : undefined;
  const tryAgain = mine ? <>{pickModel}<Button size="sm" className="nd-retry" loading={rewrite.isPending} onClick={writeAgain}>Try writing them again</Button></> : null;
  // The boards open in the call: the main room's with the call's notes, each room's in its section.
  const boards = note.workedOn.filter((w) => w.kind === 'board');
  const rooms = note.rooms.length > 0 ? <RoomSections noteId={note.id} rooms={note.rooms} boards={boards} me={me} writing={!ready || note.writingAgain} correct={correct} fromLine={ready ? proposing : undefined} settle={settle} tryAgain={tryAgain} marks={yours.lines} open={room} at={at} /> : null;
  /** Keeps an answer in your own notes, with what it comes from: nothing else keeps one. */
  const keep = (a: Answer) => yours.own.add.mutateAsync({
    kind: 'answer', question: a.q, answer: a.text,
    points: a.cites.flatMap((c): PersonalPoint[] => (c.type === 'cite' ? [{ kind: 'moment', at: c.at }] : c.type === 'screen' ? [{ kind: 'screen', frameId: c.id }] : []))
  });
  const toConfirm = note.decisions.filter((d) => d.state === 'proposed').length;
  // What was said, and what the notes took from a board's Actions frame, each under its own heading.
  const said = note.actions.filter((a) => a.from === null);
  const fromBoards = note.actions.filter((a) => a.from === 'board');
  const mainBoards = boards.filter((b) => b.room === null);
  const yoursOf = (actions: readonly ActionItem[]) => actions.filter((a) => !a.done && !!me && !!a.owner?.person && sameEmail(a.owner.person, { email: me })).length;
  const forYou = yoursOf(said);
  const boardForYou = yoursOf(fromBoards);
  // The boards, right under the summary as the canvas has them: the call's, then each breakout room's, side by side.
  const roomBoards = note.rooms.flatMap((r): RoomBoard[] => { const own = boards.filter((b) => b.room === r.id); return own.map((b) => ({ room: r, board: b, several: own.length > 1 })); });
  const boardSection = !going && (mainBoards.length > 0 || roomBoards.length > 0) ? (
    <Section title={mainBoards.length + roomBoards.length > 1 ? 'Boards' : 'Board'} id="boards">
      <NoteBoardCards boards={mainBoards} />
      <NoteRoomBoardCards rooms={roomBoards} held={note.rooms} />
    </Section>
  ) : null;
  const boardFollowUps = !going && ready && written && fromBoards.length > 0 ? (
    <Section title={mainBoards.length > 1 ? 'Follow-ups from the boards' : 'Follow-ups from the board'} kind="follow" id="board-follow-ups" count={boardForYou ? `${boardForYou} for you` : undefined}>
      <FollowUps actions={fromBoards} me={me} reader={reader} people={note.recipients.map((r) => r.person)} onToggle={toggle} onChange={changeAction} onSeek={seek} shown={onScreen} />
    </Section>
  ) : null;

  /* The horizon. */
  const marks = useMemo(() => marksOf(note.decisions, note.actions), [note.decisions, note.actions]);
  const heard = Math.max(player.total, note.duration, lines.at(-1)?.at ?? 0, note.chapters.at(-1)?.at ?? 0, ...marks.map((m) => m.at));
  const span = live ? Math.ceil((heard + 60) / QUARTER) * QUARTER : player.total || heard;
  const glints = useMemo(() => noteWave(note.id, lines, span), [note.id, lines, span]);
  const kinds = useMemo(() => kindsOf(note), [note]);
  const showMarks = ready && written;
  // The marks arrive on the line the moment the notes are written, if it happens with the page open.
  const wasReady = useRef(ready);
  const [fresh, setFresh] = useState(false);
  useEffect(() => { if (ready && !wasReady.current) setFresh(true); wasReady.current = ready; }, [ready]);
  const side = useRef<HTMLElement>(null);
  useStayInView(side);

  const delAsk = mine
    ? `Removes ${asList(['the summary', ...(lines.length ? ['the transcript'] : []), ...(note.rooms.length ? [note.rooms.length === 1 ? 'the breakout room’s section' : `${note.rooms.length} breakout rooms’ sections`] : []), ...(hasAudio ? [`${minutesLabel(note.duration)} of audio`] : []), ...(note.screens.length ? [`${note.screens.length} shared ${note.screens.length === 1 ? 'screen' : 'screens'}`] : []), 'anyone’s own notes on them'])}. Nobody can get them back.`
    : `${organizer ? firstName(organizer.name) : 'The organizer'} and everyone else who has them keep them. Your own notes on them go for good. Anything you added to the shared notes stays there, and you can’t take it back after this.`;
  const transcript = (top?: ReactNode) => <Transcript lines={lines} gaps={note.gaps} seconds={span} me={me} onSeek={seek} focus={focus} player={player} live={live} screens={screens} onScreens={viewer.show} correct={correct} fromLine={fromLine} marks={yours.lines} kinds={kinds} top={top} />;
  const noScreens = !lines.length && firstScreen && <button type="button" className="nd-act nd-scrlink" onClick={() => viewer.show(firstScreen)}><Icon name="monitor" size={15} />{moments.length} shared {moments.length === 1 ? 'screen' : 'screens'}</button>;
  const view = live ? 'recording' : note.status === 'pending' ? 'writing' : ready && !written && !lines.length ? 'quiet' : 'ready';
  // The call is still writing to these notes, so they stay until it ends.
  const inCall = note.kind === 'call' && note.status === 'recording';

  return (
    <Evening moment="note" className={cn('nd', going && 'is-going')} data-view={view}>
      <PageHead title={note.title} acts={(
        <>
          <PinNote noteId={note.id} />
          <ShareNote note={note} onShared={(emails) => setSharedTo(new Set(emails))} />
          <NoteMenu ready={ready} mine={mine} inCall={inCall} ask={delAsk} onWriteAgain={mine && ready && !note.writingAgain && ((note.transcript?.length ?? 0) > 0 || note.rooms.some((room) => room.transcript.length > 0)) ? () => setChoosing(true) : undefined} busy={del.isPending} gone={going} onDelete={() => void remove()}
            onCopy={() => void navigator.clipboard?.writeText(noteAsText(note)).then(() => toast('Copied as text'))} />
        </>
      )}>
        <span className="nd-when">{noteAt(note.startedAt)}{hasAudio ? '' : ` · ${minutesLabel(note.duration)}`}</span>
        <span className="nd-faces" title={peopleLine(note.people, me)}><Faces people={note.people} size={24} max={5} /><span>Everyone with the notes</span></span>
        {received && <span className="nd-how">{receivedLine(received)}</span>}
        {live && <span className="nd-rec"><RecDot />Still recording</span>}
        <Provenance evidence={note.inference} kind={note.kind} unencrypted={note.unencrypted} model={note.model} writing={note.status === 'pending' ? 'first' : note.writingAgain ? 'again' : undefined} />
      </PageHead>
      <CallLine player={player} span={span} chapters={showMarks ? note.chapters : []} marks={showMarks ? marks : []} gaps={note.gaps} glints={glints}
        here={focus?.at} edge={live ? heard : undefined} still={ready && !lines.length && !written} fresh={fresh} onScrub={hasAudio ? moveTo : seek} onChapter={hasAudio ? toChapter : canGo || note.rooms.length > 0 ? goChapter : undefined}>
        {!note.kept.recording && !live && <p className="nd-kept"><Icon name="mic" size={15} />The recording was deleted when the call ended.</p>}
      </CallLine>
      <div className="nd-cols" style={{ '--d': 2 }}>
        <div className="nd-main">
          {player.total > 0 && note.shares.length > 0 && <div ref={replay} tabIndex={-1} className="nd-replay"><Replay noteId={note.id} shares={note.shares} player={player} /></div>}
          <div className="nd-read">
            {ready && written ? (
              <>
                {writingAgain}
                <Summary summary={note.summary} details={note.details} />
                {boardSection}
                {boardFollowUps}
                <Section title="Decided" kind="decide" id="decided" count={toConfirm ? `${toConfirm} to confirm` : undefined}>
                  {note.decisions.length > 0 ? <Decisions items={note.decisions} me={me} reader={reader} onChange={changeDecision} onSeek={seek} shown={onScreen} /> : <p className="nd-none">The notes didn’t hear anything decided.</p>}
                  {decisionForm()}
                </Section>
                {note.questions.length > 0 && (
                  <Section title="Still open"><Questions items={note.questions} me={me} onChange={changeQuestion} onSeek={seek} shown={onScreen} /></Section>
                )}
                <Section title="Follow-ups" kind="follow" id="follow-ups" count={forYou ? `${forYou} for you` : undefined}>
                  {said.length > 0 ? <FollowUps actions={said} me={me} reader={reader} people={note.recipients.map((r) => r.person)} onToggle={toggle} onChange={changeAction} onSeek={seek} shown={onScreen} /> : <p className="nd-none">The notes didn’t hear anything to follow up.</p>}
                  {actionForm()}
                </Section>
              </>
            ) : ready && lines.length ? (
              note.writingAgain ? <p className="nd-again"><Dots /><span><b>Writing the notes</b> from the transcript as it is now.{step ? ` ${step}.` : ''}</span>{stop}</p> : (
                <section className="nd-unwritten">
                  <Notice tone="caution" icon="pen">
                    <b>The summary couldn’t be written.</b> {!note.kept.transcript ? 'The transcript stays until they’re written, then it’s deleted' : hasAudio ? 'The transcript and the audio are kept' : 'The transcript is kept'}, and you can still ask about the {note.kind === 'room' ? 'recording' : 'call'}.
                  </Notice>
                  {tryAgain}
                </section>
              )
            ) : ready ? (
              <section className="nd-quiet" aria-label="Nothing was said">
                <h2>{note.kind === 'room' ? 'Nothing was said while recording.' : roomsSaid || roomNotes ? 'Nothing was said in the main room while notes were on.' : deleted ? 'There’s no summary of this call.' : 'Nothing was said while notes were on.'}</h2>
                {roomsSaid ? <p>What was said in the breakout rooms is in each room’s section below.</p> : roomNotes ? <p>The breakout rooms’ notes are in each room’s section below.</p> : deleted ? <p>Its transcript was deleted after the notes were written.</p> : null}
                {roomsSaid && writingAgain}
                {roomsSaid && again}
              </section>
            ) : (
              <section className="nd-writing" aria-label="How the notes are coming along">
                <p className="nd-writing-t">{live ? 'The recording is still going.' : note.kept.recording ? 'The audio is saved and encrypted.' : 'The call has ended.'} Summary, decisions and follow-ups are {live ? (writtenPrivately ? 'written in confidential compute once it stops' : 'written by an unencrypted AI model once it stops') : (writtenPrivately ? 'being written in confidential compute' : 'being written by an unencrypted AI model')}.</p>
                {!live && progress && <Steps steps={progress.steps} />}
              </section>
            )}
            {!(ready && written) && (note.actions.length > 0 || ready) && <Section title="Follow-ups" kind="follow" id="follow-ups">
              <FollowUps actions={said} me={me} reader={reader} people={note.recipients.map((r) => r.person)} onToggle={toggle} onChange={changeAction} onSeek={seek} shown={onScreen} />
              {ready && actionForm()}
            </Section>}
            <NoteFollowUpReview noteId={note.id} suggestions={note.suggestions} actions={note.actions} people={note.recipients.map((r) => r.person)} reader={reader} me={me} onSeek={seek} shown={onScreen} />
            {/* Until there's a summary, the boards come after how the notes stand. */}
            {!(ready && written) && boardSection}
            {/* What was worked on, under what was decided and what's to do, whether or not the notes are written yet. */}
            {!going && <WorkedOn worked={note.workedOn} />}
          </div>
          <div className="nd-said" id="transcript">
            {lines.length > 0 && transcript(ready && written ? again : undefined)}
            {written && deleted && <p className="nd-kept is-doc"><Icon name="transcript" size={15} />The transcript was deleted after the notes were written.</p>}
            {noScreens}
            {rooms}
          </div>
          {ready && (lines.length > 0 || roomsSaid || roomNotes || (written && deleted)) && !going && <AskBar suggestions={note.suggestedQuestions} ask={(question) => api.notes.ask(note.id, question)} onSeek={seek} shown={onScreen} onKeep={keep} />}
        </div>
        <aside ref={side} className="nd-side" aria-label="About these notes">
          {showMarks && <ChapterList chapters={note.chapters} onGo={canGo ? goChapter : undefined} />}
          <OwnNotesCard note={note} me={me} entries={yours.entries} own={yours.own} shown={onScreen} onSeek={seek} />
          <SharedNotes note={note} me={me} mine={mine} shown={onScreen} onSeek={seek} />
          <Recipients recipients={note.recipients} me={me} fresh={sharedTo} />
          {!going && <SeriesCard note={note} />}
          {!going && note.kind === 'call' && note.id !== 'example' && <NoteDriveExports noteId={note.id} recordingAllowed={mine && note.kept.recording} recordingKept={note.kept.recording} />}
        </aside>
      </div>
      <ScreenViewer noteId={note.id} screens={moments} open={viewer.open} me={me} onOpen={viewer.show} onClose={viewer.close} onPlay={canGo ? playFrom : undefined} onCloseFocus={upToReplay} marks={yours.screens} />
      <WriteAgain open={mine && choosing && !note.writingAgain} model={model} busy={rewrite.isPending} onModel={setModel} onCancel={() => setChoosing(false)} onWrite={writeAgain} />
    </Evening>
  );
}

/** How the notes are coming along: what's done, ticked; what's happening now, with dots; what's still to come. */
function Steps({ steps }: { steps: NoteProgress['steps'] }) {
  const now = steps.findIndex((s) => !s.done);
  return (
    <ol className="nd-steps">
      {steps.map((s, i) => (
        <li key={s.label} className={cn(s.done && 'is-done', i === now && 'is-now')}>
          <span className="nd-step-i">{s.done ? <Icon name="check" size={13} /> : i === now ? <Dots /> : null}</span>{s.label}
        </li>
      ))}
    </ol>
  );
}

/** Which AI model writes the notes again: the default, or any the API lists. */
function ModelPick({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const models = useAiModels();
  // An unencrypted choice carries its badge in the picker itself.
  return <Select<string> label="AI model" icon="notesPen" value={modelValue(value)} options={modelOptions(models.data, value)} onChange={(v) => onChange(modelOf(v))} className="max-w-full" />;
}

/** Asked for from the menu: which AI model writes the notes again, then writing them, or not. */
function WriteAgain({ open, model, busy, onModel, onCancel, onWrite }: {
  open: boolean; model: string | null; busy: boolean; onModel: (id: string | null) => void; onCancel: () => void; onWrite: () => void;
}) {
  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) onCancel(); }} label="Write the notes again" className="nd-redo">
      <h2 className="nd-redo-h"><Icon name="notesPen" size={18} />Write the notes again?</h2>
      <p className="nd-redo-p">They’re written again from the transcript as it is now, by the AI model you choose. What people confirmed or took on stays.</p>
      <ModelPick value={model} onChange={onModel} />
      <div className="nd-redo-f">
        <Button variant="quiet" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={onWrite}>Write the notes again</Button>
      </div>
    </Modal>
  );
}

/* Delete is physical: say exactly what went. */
function Gone({ kind, transcript, audio, screens, rooms, roomsSaid, organizer }: GoneInfo) {
  if (kind === 'removed') return <GonePage title="Removed" lead={`They’re out of your notes, with your own notes on them. ${organizer} still has them.`} />;
  const went = [
    'Summary, decisions and follow-ups',
    ...(transcript ? ['The transcript'] : []),
    ...(rooms > 0 ? [`${rooms === 1 ? 'The breakout room’s section' : `${rooms} breakout rooms’ sections`}${roomsSaid ? ', what was said there included' : ''}`] : []),
    ...(audio ? [`The recording, ${audio} of audio`] : []),
    ...(screens > 0 ? [`${screens} shared ${screens === 1 ? 'screen' : 'screens'}, and what was read on ${screens === 1 ? 'it' : 'them'}`] : []),
    'Anyone’s own notes on them, and what people added'
  ];
  return <GonePage title="Deleted" lead="Gone from Alcove, for everyone who had them."><ul>{went.map((w) => <li key={w}><Icon name="check" size={16} />{w}</li>)}</ul></GonePage>;
}

function Missing({ error }: ErrorComponentProps) {
  const notFound = errorCode(error) === 'not-found';
  return <GonePage title={notFound ? 'These notes aren’t here' : 'Couldn’t open these notes'} lead={notFound ? 'They were deleted, or they were never shared with you.' : errorMessage(error)} />;
}

/* The call from the welcome screen, written out. Nothing to share or delete. */
function Example({ me }: { me: Person }) {
  const [note] = useState(() => exampleNote(me));
  const [actions, setActions] = useState(note.actions);
  const player = usePlayer(note.id, NO_AUDIO, false);
  const side = useRef<HTMLElement>(null);
  useStayInView(side);
  return (
    <Evening moment="note" className="nd" data-view="example">
      <PageHead to="Home" title={note.title}>
        <span className="nd-faces" title={peopleLine(note.people, me.email)}><Faces people={note.people} size={24} max={5} /><span>Everyone with the notes</span></span>
        <span className="nd-how">Example · 24 min</span>
      </PageHead>
      <CallLine player={player} span={note.duration} chapters={note.chapters} marks={marksOf(note.decisions, actions)} gaps={[]} glints={[]} />
      <div className="nd-cols" style={{ '--d': 2 }}>
        <div className="nd-main">
          <div className="nd-read">
            <Summary summary={note.summary} details={note.details} />
            <Section title="Decided" kind="decide"><Decisions items={note.decisions} me={me.email} /></Section>
            <Section title="Still open"><Questions items={note.questions} me={me.email} /></Section>
            <Section title="Follow-ups" kind="follow">
              <FollowUps actions={actions} me={me.email} onToggle={(a, on) => setActions((xs) => xs.map((x) => (x.id === a.id ? { ...x, done: on } : x)))} />
            </Section>
          </div>
          <AskBar suggestions={note.suggestedQuestions} ask={askExample} />
        </div>
        <aside ref={side} className="nd-side" aria-label="About these notes">
          <ChapterList chapters={note.chapters} onGo={undefined} />
          <Recipients recipients={note.recipients} me={me.email} />
        </aside>
      </div>
    </Evening>
  );
}
