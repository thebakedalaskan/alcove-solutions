/*
 * A call that happened, at /calls/<note ID>: its title and one line of what's worth knowing, then two halves. On the left the
 * player, which never scrolls: the call on its stage, always night, and under it its line, then what was shared and made in
 * it. On the right, tabs: Notes, Transcript and Your notes (and Shared, in one column, where what was shared and made moves
 * into a tab), with Ask about this call at the foot. Every ▶ chip plays its moment on the stage without changing the tab.
 * Narrower than the two halves fit, it's one column: the stage, the line, then the tabs. A call set to keep neither its
 * recording nor its transcript has no stage or line: Nothing to play back stands in their place. Until the notes are
 * written the page says how they're coming along; a call deleted or removed says what went.
 */
import {
  errorCode, errorMessage, firstName, minutesLabel, type ActionItem, type ActionPatch, type Decision, type DecisionPatch, type Note, type NoteProgress, type Person,
  type PersonalPoint, type Question, type QuestionPatch, type TranscriptLine
} from '@alcove/api';
import { Button, Dots, Evening, Icon, Modal, Notice, RecDot, Select, Tabs, cn, useToast } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { OwnNotesCard, SharedNotes, useOwn } from '~/features/notes/personal/OwnNotes';
import { seriesLabel } from '~/features/notes/series/cards';
import { useOpenScheduling } from '~/features/calls/scheduling/search';
import { useNoteOnScreen } from '~/features/notifications/notify';
import { api } from '~/lib/api';
import { isUnencrypted, modelOf, modelOptions, modelValue, useAiModels } from '~/features/notes/models';
import { log } from '~/lib/log';
import { listNames, sameEmail } from '~/lib/people';
import { accountQueries } from '~/features/account/queries';
import { seriesQueries } from '~/features/notes/series/queries';
import { noteQueries, useCancelRewrite, useCorrectLine, useDeleteNote, useProposeDecision, useRewriteNotes, useUpdateAction, useUpdateDecision, useUpdateQuestion } from './queries';
import { noteKeys } from './queryKeys';
import { callLength, noteAt } from '~/lib/time';
import type { Answer } from './answer';
import { DownloadMenu, hasTranscript, useSaveTranscript } from './sharing/Download';
import { DriveExportsModal } from './sharing/DriveExports';
import { Propose, useNoteReader, type Seed } from './entries';
import { Provenance } from './Evidence';
import { askExample, exampleNote } from '~/features/examples/note';
import { CallHead, CallMore, GonePage, WhoHas } from './Head';
import { CallLine, marksOf } from './player/Line';
import { correctedSince, speakersOf, type Correcting } from './lines';
import { Made } from './Made';
import { noteAsText, readerRole, receivedLine } from './meta';
import { NewFollowUp } from './follow-ups/NoteFollowUps';
import { NotesPane, type Acting } from './NotesPane';
import { AskBar, type Focus, type LineKinds, type ScreenRefShown, type ScreensShown } from './parts';
import { usePlayer, useSpaceToPlay, type PlayerState } from './player/Player';
import { ScreenMomentRow, ScreenRefChip, ScreenViewer, useScreenViewer } from './player/screens';
import { ShareNote, usePinNote } from './sharing/share';
import { Stage, peopleOn } from './player/Stage';
import { TranscriptPane } from './TranscriptPane';

const nlog = log.child({ component: 'call-page' });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The tabs beside the player. `shared` is there only in one column, where what was shared and made moves into it. */
export type CallTab = 'notes' | 'transcript' | 'shared' | 'yours';

/** Narrower than this, the page is one column: the stage, the line, then the tabs (note.css, `.cd.is-one`). */
const TWO_COLUMNS = 1100;

/** Whether a call's page is in one column, from its own width: what was shared and made moves into a tab then. */
export function useOneColumn(page: RefObject<HTMLElement | null>): boolean {
  const [one, setOne] = useState(false);
  useLayoutEffect(() => {
    const el = page.current;
    if (!el) return undefined;
    const measure = () => setOne(el.clientWidth < TWO_COLUMNS);
    measure();
    const sizes = new ResizeObserver(measure);
    sizes.observe(el);
    return () => sizes.disconnect();
  }, [page]);
  return one;
}

/** A call's page, by its note's ID, at a moment (`at`), in a breakout room's section (`room`), playing from there (`play`). */
export function CallPage({ noteId, at, room, play, tab, onTab, onPlayed }: {
  noteId: string; at: number | undefined; room: string | undefined; play: boolean; tab: CallTab; onTab: (t: CallTab) => void; onPlayed: () => void;
}) {
  const me = useQuery(accountQueries.session()).data?.user;
  if (noteId === 'example') return me ? <Example me={me} tab={tab} onTab={onTab} /> : null;
  return <Stored key={noteId} id={noteId} me={me?.email} at={at} room={room} play={play} tab={tab} onTab={onTab} onPlayed={onPlayed} />;
}

interface GoneInfo { kind: 'deleted' | 'removed'; transcript: boolean; audio: string | null; screens: number; rooms: number; roomsSaid: boolean; organizer: string }
const NO_AUDIO: Note['audio'] = [];
/** "The summary, the transcript and 4 min of audio" */
const asList = (parts: string[]) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`);

function Stored({ id, me, at, room, play, tab, onTab, onPlayed }: { id: string; me: string | undefined; at: number | undefined; room: string | undefined; play: boolean; tab: CallTab; onTab: (t: CallTab) => void; onPlayed: () => void }) {
  const qc = useQueryClient();
  const [gone, setGone] = useState<GoneInfo | null>(null);
  // A failed read keeps the last answer, which would keep showing notes someone may not read any more.
  const note = useQuery({ ...noteQueries.note(id), enabled: !gone, throwOnError: (e) => errorCode(e) === 'not-found' }).data;
  useEffect(() => { if (gone) qc.removeQueries({ queryKey: noteKeys.note(id), exact: true }); }, [gone, qc, id]);
  useNoteOnScreen(id);
  if (gone) return <Gone {...gone} />;
  if (!note) return null;
  return <CallView note={note} me={me} at={at} room={room} play={play} tab={tab} onTab={onTab} onPlayed={onPlayed} onGone={setGone} />;
}

/*
 * Until the notes are written, the stream says honestly where they are. Each step it finishes (the recording stopping, the
 * notes being written) brings the note up to date; a stream that ends before they're written is followed again a few
 * seconds later, for as long as the page is open.
 */
function useProgress(note: Note): NoteProgress | null {
  const qc = useQueryClient();
  const [p, setP] = useState<NoteProgress | null>(null);
  useEffect(() => {
    if (note.status === 'ready' && !note.writingAgain) return;
    let alive = true;
    let again: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => void qc.invalidateQueries({ queryKey: noteKeys.notes });
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
 * Opens the call at the moment the address asks for (`?at=`), once for each note and moment, so the note being read again
 * doesn't move it back. With `play` (Play from in the palette, a ▶ in a search) it plays from there, then `played` takes `play`
 * out of the address: going Back to the page or reloading it opens there without playing.
 */
function useOpenAt(noteId: string, at: number | undefined, play: boolean, player: PlayerState, go: (s: number, play?: boolean) => void, played: () => void) {
  const done = useRef<string | null>(null);
  const { total } = player;
  useEffect(() => {
    if (at === undefined) return;
    const moment = `${noteId}@${at}`;
    const asked = play ? `${moment}+play` : moment;
    if (done.current === asked) return;
    // `play` just left the address: it's the moment that's open, played already.
    if (!play && done.current === `${moment}+play`) { done.current = moment; return; }
    done.current = asked;
    go(at, play && total > 0);
    if (play) played();
  }, [at, noteId, play, played, go, total]);
}

/** Which lines something in the notes came from. A decision someone said wasn't one no longer counts. */
function kindsOf(note: Note): LineKinds {
  const out = new Map<string, 'decide' | 'follow'>();
  for (const a of note.actions) for (const l of a.lines) out.set(l, 'follow');
  for (const d of note.decisions) if (d.state !== 'rejected') for (const l of d.lines) out.set(l, 'decide');
  return out;
}

/** "Priya, Kofi and you": everyone on the stage, you last, as a sentence says it. */
function sayPeople(people: readonly { name: string }[]): string {
  const names = people.map((p, i) => (p.name === 'You' && i > 0 ? 'you' : p.name));
  if (names.length > 1) return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
  return names[0] === 'You' || !names[0] ? 'Only you' : names[0];
}

/** A line a call hasn't finished can't know its end, so it's drawn to the next quarter of an hour. */
const QUARTER = 900;

/** Whether this browser can fill the screen with something, and filling it with the player, or leaving. */
function useFullScreen(el: RefObject<HTMLElement | null>) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const change = () => setOn(document.fullscreenElement !== null && document.fullscreenElement === el.current);
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, [el]);
  // A refusal leaves things as they are: `fullscreenchange` never comes.
  const toggle = () => {
    if (on) void document.exitFullscreen().catch(() => undefined);
    else void el.current?.requestFullscreen().catch(() => undefined);
  };
  return typeof document !== 'undefined' && document.fullscreenEnabled ? { on, toggle } : undefined;
}

function CallView({ note, me, at, room, play, tab, onTab, onPlayed, onGone }: {
  note: Note; me: string | undefined; at: number | undefined; room: string | undefined; play: boolean; tab: CallTab; onTab: (t: CallTab) => void; onPlayed: () => void; onGone: (g: GoneInfo) => void;
}) {
  const toast = useToast();
  const schedule = useOpenScheduling();
  const page = useRef<HTMLDivElement>(null);
  const one = useOneColumn(page);
  const del = useDeleteNote();
  const updateAction = useUpdateAction();
  const updateDecision = useUpdateDecision();
  const updateQuestion = useUpdateQuestion();
  const proposeDecision = useProposeDecision();
  const correctLine = useCorrectLine();
  const rewrite = useRewriteNotes();
  const cancel = useCancelRewrite();
  const pin = usePinNote(note.id);
  const yours = useOwn(note.id);
  const writtenPrivately = !isUnencrypted(useAiModels().data, note.model);
  const saveTranscript = useSaveTranscript(note);
  // A call that doesn't keep its recording has none to play, whatever is still on its way out.
  const audio = note.kept.recording ? note.audio : NO_AUDIO;
  const live = note.status === 'recording';
  const player = usePlayer(note.id, audio, live);
  useSpaceToPlay(player);
  const progress = useProgress(note);
  const [going, setGoing] = useState(false);
  const [sharedTo, setSharedTo] = useState<ReadonlySet<string>>(new Set());
  const [seed, setSeed] = useState<Seed | null>(null);
  const [model, setModel] = useState<string | null>(note.model);
  const [choosing, setChoosing] = useState(false);
  const [drive, setDrive] = useState(false);
  const [captions, setCaptions] = useState(true);
  const fullBox = useRef<HTMLDivElement>(null);
  const full = useFullScreen(fullBox);
  const pane = useRef<HTMLDivElement>(null);
  const paneEnd = useRef<HTMLDivElement>(null);
  const received = note.received;
  const mine = !received;
  // A note visible to your team, from someone else: to read and ask about. Only its organizer changes it (the server's rule too).
  const teamNote = received?.role === 'team';
  const reader = useNoteReader()(readerRole(received));
  const organizer = note.recipients.find((r) => r.role === 'organizer')?.person;
  const ready = note.status === 'ready';
  const lines = useMemo(() => note.transcript ?? [], [note.transcript]);
  const written = note.summary.trim() !== '';
  const settled = ready && written;
  // The transcript went with the notes written, as the call was set to: no transcript here is no sign nothing was said.
  const deleted = !note.kept.transcript && !lines.length;
  // A call set to keep neither its recording nor its transcript has nothing to play back, even while its transcript is
  // still there to write the notes from: no stage and no line, and nothing goes to a moment on them.
  const playback = note.kept.recording || note.kept.transcript;

  /* Where the call is: the player's clock, or for a note with no recording, where someone last went. */
  const hasAudio = audio.length > 0;
  const [here, setHere] = useState(at ?? 0);
  const [focus, setFocus] = useState<Focus | undefined>(at !== undefined ? { at } : undefined);
  const { seek: moveTo } = player;
  /** Goes to a moment: the sun moves there, playing on if it was (or from there, with `play`), and the transcript goes to that line. */
  const go = useCallback((s: number, playIt?: boolean) => {
    if (hasAudio) moveTo(s, playIt); else setHere(s);
    setFocus({ at: s });
  }, [hasAudio, moveTo]);
  const playMoment = (s: number) => go(s, true);
  useOpenAt(note.id, room !== undefined && note.rooms.some((r) => r.id === room) ? undefined : at, play, player, go, onPlayed);
  const canGo = playback && (hasAudio || lines.length > 0);
  const seek = canGo ? playMoment : undefined;

  // What was on shared screens: among the transcript lines, wherever the notes point at it, and in the viewer.
  const viewer = useScreenViewer();
  const moments = note.screens.filter((m) => m.relevance !== 'unrelated');
  const screens: ScreensShown | undefined = moments.length ? { moments, row: (m) => <ScreenMomentRow noteId={note.id} m={m} me={me} written={ready} onOpen={viewer.show} /> } : undefined;
  const onScreen: ScreenRefShown = (ref) => <ScreenRefChip screen={ref} screens={moments} onOpen={viewer.show} />;

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
  /** Each change says what went wrong itself, and rejects, so whoever asked can say what worked. */
  const tell = <T,>(p: Promise<T>): Promise<T> => p.catch((e: unknown) => { failed(e); throw e; });
  const act: Acting = {
    decision: (d: Decision, patch: DecisionPatch) => tell(updateDecision.mutateAsync({ noteId: note.id, decisionId: d.id, patch })),
    question: (x: Question, patch: QuestionPatch) => tell(updateQuestion.mutateAsync({ noteId: note.id, questionId: x.id, patch })),
    action: (a: ActionItem, patch: ActionPatch) => tell(updateAction.mutateAsync({ noteId: note.id, actionId: a.id, patch })),
    toggle: (a: ActionItem, done: boolean) => tell(updateAction.mutateAsync({ noteId: note.id, actionId: a.id, patch: { done } })).then((n) => { if (done) toast('Marked done', { ms: 2200 }); return n; })
  };
  /* Whichever part of the notes it's for, what someone adds is proposed by them; what failed says why, and stays in the field. */
  const adding = (p: Promise<unknown>) => p.then(() => true, (e: unknown) => { failed(e); return false; });
  const addDecision = (r: string | undefined) => (text: string, from: string[]) => adding(proposeDecision.mutateAsync({ noteId: note.id, proposal: { text, lines: from, ...(r ? { room: r } : {}) } }));
  const proposing = (kind: Seed['kind'], line: TranscriptLine) => { setSeed({ kind, line, room: note.rooms.find((r) => r.transcript.some((l) => l.id === line.id))?.id }); onTab('notes'); };
  const seedFor = (kind: Seed['kind'], r: string | undefined) => (seed?.kind === kind && seed.room === r ? seed : undefined);
  const decisionForm = (r?: string | undefined) => <Propose label="Propose a decision" placeholder="What was decided" hint="Everyone with the notes sees it, as proposed by you, until someone else confirms it." busy={proposeDecision.isPending} seed={seedFor('decision', r)} onAdd={addDecision(r)} onDone={() => setSeed(null)} />;
  const actionForm = (r?: string | undefined) => <NewFollowUp noteId={note.id} room={r} people={note.recipients.map((recipient) => recipient.person)} seed={seedFor('follow-up', r)} onDone={() => setSeed(null)} />;
  // The organizer corrects any line; anyone else who has the notes, the words of their own lines (the server's rule too).
  const correct: Correcting | undefined = ready && !teamNote ? {
    can: (l) => mine || (!!me && !!l.speaker?.person?.email && sameEmail(l.speaker.person, { email: me })),
    people: mine && note.kind === 'call' ? speakersOf(note) : null,
    organizer: mine,
    onCorrect: (l, patch) => correctLine.mutate({ noteId: note.id, lineId: l.id, patch }, { onError: failed })
  } : undefined;
  const fromLine = settled && !teamNote ? proposing : undefined;
  const corrected = correctedSince([...lines, ...note.rooms.flatMap((r) => r.transcript)], note.writtenAt);
  const step = note.writingAgain && progress && !progress.ready ? progress.steps.at(-1)?.label : undefined;
  const writeAgain = () => rewrite.mutate({ noteId: note.id, model }, { onSuccess: () => setChoosing(false), onError: failed });
  const pickModel = mine ? <ModelPick value={model} onChange={setModel} /> : null;
  const stop = mine ? <Button variant="quiet" size="sm" loading={cancel.isPending} onClick={() => cancel.mutate(note.id, { onSuccess: () => toast('Stopped. The notes are as they were.'), onError: failed })}>Cancel</Button> : null;
  const tryAgain = mine ? <div className="cd-again-f">{pickModel}<Button size="sm" loading={rewrite.isPending} onClick={writeAgain}>Try writing them again</Button></div> : null;
  const settle = ready && !teamNote ? {
    reader, people: note.recipients.map((r) => r.person),
    onDecision: (d: Decision, patch: DecisionPatch) => void act.decision(d, patch).catch(() => undefined),
    onQuestion: (x: Question, patch: QuestionPatch) => void act.question(x, patch).catch(() => undefined),
    onToggle: (a: ActionItem, done: boolean) => void act.toggle(a, done).catch(() => undefined),
    onAction: (a: ActionItem, patch: ActionPatch) => void act.action(a, patch).catch(() => undefined),
    decisionForm: (r: string) => decisionForm(r), actionForm: (r: string) => actionForm(r)
  } : undefined;
  /** Keeps an answer in your own notes, with what it comes from: nothing else keeps one. */
  const keep = (a: Answer) => yours.own.add.mutateAsync({
    kind: 'answer', question: a.q, answer: a.text,
    points: a.cites.flatMap((c): PersonalPoint[] => (c.type === 'cite' ? [{ kind: 'moment', at: c.at }] : c.type === 'screen' ? [{ kind: 'screen', frameId: c.id }] : []))
  });

  /* The line. */
  const marks = useMemo(() => (settled ? marksOf(note.decisions, note.actions) : []), [settled, note.decisions, note.actions]);
  const heard = Math.max(player.total, note.duration, lines.at(-1)?.at ?? 0, note.chapters.at(-1)?.at ?? 0, ...marks.map((m) => m.at));
  const span = live ? Math.ceil((heard + 60) / QUARTER) * QUARTER : player.total || heard;
  const kinds = useMemo(() => kindsOf(note), [note]);

  const delAsk = mine
    ? `Removes ${asList(['the summary', ...(lines.length ? ['the transcript'] : []), ...(note.rooms.length ? [note.rooms.length === 1 ? 'the breakout room’s section' : `${note.rooms.length} breakout rooms’ sections`] : []), ...(hasAudio ? [`${minutesLabel(note.duration)} of audio`] : []), ...(note.screens.length ? [`${note.screens.length} shared ${note.screens.length === 1 ? 'screen' : 'screens'}`] : []), 'anyone’s own notes on them'])}. Nobody can get them back.`
    : `${organizer ? firstName(organizer.name) : 'The organizer'} and everyone else who has them keep them. Your own notes on them go for good. Anything you added to the shared notes stays there, and you can’t take it back after this.`;
  const view = live ? 'recording' : note.status === 'pending' ? 'writing' : ready && !written && !lines.length ? 'quiet' : 'ready';
  // The call is still writing to these notes, so they stay until it ends.
  const inCall = note.kind === 'call' && live;

  /* What stands in for the notes until they're written, and what's offered around them. */
  const again = mine && corrected > 0 && !note.writingAgain ? (
    <div className="cd-offer"><Icon name="history" size={16} /><span>{corrected === 1 ? 'A line was corrected' : `${corrected} lines were corrected`} since these notes were written.</span>{pickModel}<Button size="sm" loading={rewrite.isPending} onClick={writeAgain}>Write the notes again</Button></div>
  ) : null;
  const notices: ReactNode = settled ? (
    <>{note.writingAgain && <p className="cd-again"><Dots /><span><b>Writing the notes again</b> from the transcript as it is now. What people confirmed or took on stays.{step ? ` ${step}.` : ''}</span>{stop}</p>}{again}</>
  ) : ready && lines.length ? (note.writingAgain ? <p className="cd-again"><Dots /><span><b>Writing the notes</b> from the transcript as it is now.{step ? ` ${step}.` : ''}</span>{stop}</p> : (
    <section className="cd-unwritten">
      <Notice tone="caution" icon="pen"><b>The summary couldn’t be written.</b> {!note.kept.transcript ? 'The transcript stays until they’re written, then it’s deleted' : hasAudio ? 'The transcript and the audio are kept' : 'The transcript is kept'}, and you can still ask about the {note.kind === 'room' ? 'recording' : 'call'}.</Notice>
      {tryAgain}
    </section>
  )) : ready ? (
    <section className="cd-quiet-s" aria-label="Nothing was said">
      <h2>{note.kind === 'room' ? 'Nothing was said while recording.' : roomsSaid || roomNotes ? 'Nothing was said in the main room while notes were on.' : deleted ? 'There’s no summary of this call.' : 'Nothing was said while notes were on.'}</h2>
      {roomsSaid ? <p>What was said in the breakout rooms is in each room’s section below.</p> : roomNotes ? <p>The breakout rooms’ notes are in each room’s section below.</p> : deleted ? <p>Its transcript was deleted after the notes were written.</p> : null}
      {roomsSaid && again}
    </section>
  ) : (
    <section className="cd-writing" aria-label="How the notes are coming along">
      <p className="cd-writing-t">{live ? 'The recording is still going.' : note.kept.recording ? 'The audio is saved and encrypted.' : 'The call has ended.'} Summary, decisions and follow-ups are {live ? (writtenPrivately ? 'written in confidential compute once it stops' : 'written by an unencrypted AI model once it stops') : (writtenPrivately ? 'being written in confidential compute' : 'being written by an unencrypted AI model')}.</p>
      {!live && progress && <Steps steps={progress.steps} />}
    </section>
  );

  /* The line under the title. */
  const stage = useMemo(() => peopleOn(note, me), [note, me]);
  const words = note.kind === 'room' ? (note.people.length > 1 ? `In the room · ${listNames(note.people.filter((p) => !me || !sameEmail(p, { email: me })))} and you` : 'In the room, only you')
    : sayPeople(stage);
  const series = useQuery({ ...seriesQueries.series(note.seriesId ?? ''), enabled: !!note.seriesId }).data;
  const tabs: { value: CallTab; label: string }[] = [
    { value: 'notes', label: 'Notes' }, { value: 'transcript', label: 'Transcript' }, ...(one ? [{ value: 'shared' as const, label: 'Shared' }] : []),
    ...(teamNote ? [] : [{ value: 'yours' as const, label: 'Your notes' }])
  ];
  const shownTab: CallTab = (tab === 'shared' && !one) || (tab === 'yours' && teamNote) ? 'notes' : tab;
  const askable = ready && (lines.length > 0 || roomsSaid || roomNotes || (written && deleted)) && !going;
  const people = useMemo(() => stage.map((p) => p.person), [stage]);

  return (
    <Evening ref={page} moment="note" className={cn('cd', going && 'is-going', one && 'is-one')} data-view={view}>
      <CallHead title={note.title} acts={(
        <>
          {!teamNote && <ShareNote note={note} size="sm" onShared={(emails) => setSharedTo(new Set(emails))} />}
          <DownloadMenu note={note} />
          <CallMore mine={mine} removable={!teamNote} inCall={inCall} ask={delAsk} busy={del.isPending} gone={going} onDelete={() => void remove()} acts={{
            pin,
            ...(ready ? { copy: () => void navigator.clipboard?.writeText(noteAsText(note)).then(() => toast('Copied as text')) } : {}),
            ...(note.kind === 'call' ? { again: () => schedule({ schedule: 'again', note: note.id }, note.recipients.filter((r) => r.role !== 'shared' && !(me && sameEmail(r.person, { email: me }))).map((r) => r.person.email)) } : {}),
            ...(note.kind === 'call' && !teamNote ? { drive: () => setDrive(true) } : {}),
            ...(mine && ready && !note.writingAgain && (lines.length > 0 || roomsSaid) ? { rewrite: () => setChoosing(true) } : {})
          }} />
        </>
      )}>
        <span className="when">{noteAt(note.startedAt)}{live ? '' : ` · ${callLength(note.duration)}`}</span>
        {note.kind === 'room' ? <span className="who"><Icon name="mic" size={15} /><span>{words}</span></span>
          : <WhoHas people={people} words={words} recipients={note.recipients} me={me} fresh={sharedTo} />}
        {received && <span>{receivedLine(received)}</span>}
        {note.seriesId && (
          <Link to="/calls" search={{ series: note.seriesId }} className="cd-ser" title="Every call in this series">
            <Icon name="repeat" size={15} /><span>{series ? seriesLabel(series) : 'In a series'}</span><Icon name="chevron" size={13} className="chev" />
          </Link>
        )}
        {live && <span className="cd-rec"><RecDot />Still recording</span>}
        <Provenance evidence={note.inference} kind={note.kind} unencrypted={note.unencrypted} model={note.model} writing={note.status === 'pending' ? 'first' : note.writingAgain ? 'again' : undefined} />
      </CallHead>
      <div className="cd-cols" style={{ '--d': 1 }}>
        <div className="cd-left">
          {playback ? (
            /* Full screen is night whatever the theme, so the line under the stage, and the speeds it opens, take night's colours. */
            <div ref={fullBox} className={cn('cd-player', full?.on && 'is-full dark')}>
              <Stage note={note} me={me} player={player} here={here} captions={captions && shownTab !== 'transcript'} />
              <CallLine player={player} span={span} chapters={settled ? note.chapters : []} marks={marks} shares={note.shares} gaps={note.gaps} here={here} edge={live ? heard : undefined}
                onScrub={canGo ? (s) => go(s) : undefined} captions={lines.length ? { on: captions, toggle: () => setCaptions((c) => !c) } : undefined} full={full} />
              {!note.kept.recording && !live && <p className="cd-kept"><Icon name="mic" size={15} />The recording was deleted when the call ended.</p>}
            </div>
          ) : <NothingToPlay />}
          {!one && !going && <Made note={note} player={player} onPlay={playMoment} />}
        </div>
        <aside className="cd-right" aria-label="What came of the call">
          <Tabs value={shownTab} onChange={onTab} options={tabs} label="The call’s notes" id="cd-tab" panel="cd-pane" className="cd-tabs" />
          <div ref={pane} id="cd-pane" role="tabpanel" aria-labelledby={`cd-tab-${shownTab}`} className="cd-pane" tabIndex={-1}>
            {shownTab === 'notes' && (
              <NotesPane note={note} me={me} reader={reader} onSeek={seek} shown={onScreen} act={act} settled={settled} notices={notices} decisionForm={decisionForm} actionForm={actionForm}
                settle={settle} room={room} at={at} writing={!ready || note.writingAgain} tryAgain={tryAgain} locked={teamNote}
                shared={!going && !teamNote && <SharedNotes note={note} me={me} mine={mine} shown={onScreen} onSeek={seek} />} />
            )}
            {shownTab === 'transcript' && (
              <TranscriptPane note={note} me={me} player={player} here={here} onSeek={canGo ? go : undefined} focus={focus} pane={pane} screens={screens} correct={correct} fromLine={fromLine}
                marks={yours.lines} kinds={kinds} onDownload={hasTranscript(note) ? saveTranscript : undefined} />
            )}
            {shownTab === 'shared' && <Made note={note} player={player} onPlay={playMoment} tab />}
            {shownTab === 'yours' && <OwnNotesCard note={note} me={me} entries={yours.entries} own={yours.own} shown={onScreen} onSeek={seek} />}
            <div ref={paneEnd} className="cd-end-mark" aria-hidden="true" />
          </div>
          {askable && <AskBar suggestions={note.suggestedQuestions} ask={(question) => api.notes.ask(note.id, question)} onSeek={seek} shown={onScreen} onKeep={teamNote ? undefined : keep} end={paneEnd} />}
        </aside>
      </div>
      <ScreenViewer noteId={note.id} screens={moments} open={viewer.open} me={me} onOpen={viewer.show} onClose={viewer.close} onPlay={canGo ? playMoment : undefined} marks={yours.screens} />
      <WriteAgain open={mine && choosing && !note.writingAgain} model={model} busy={rewrite.isPending} onModel={setModel} onCancel={() => setChoosing(false)} onWrite={writeAgain} />
      {note.kind === 'call' && !teamNote && <DriveExportsModal open={drive} onClose={() => setDrive(false)} noteId={note.id} recordingAllowed={mine && note.kept.recording} recordingKept={note.kept.recording} />}
    </Evening>
  );
}

/** In the player's place, for a call set to keep neither its recording nor its transcript: why there's nothing to play. */
function NothingToPlay() {
  return (
    <section className="cd-unplayed" aria-label="Nothing to play back">
      <Icon name="micOff" size={18} />
      <h2>Nothing to play back</h2>
      <p>This call was set not to keep its recording or its transcript.</p>
    </section>
  );
}

/** How the notes are coming along: what's done, ticked; what's happening now, with dots; what's still to come. */
function Steps({ steps }: { steps: NoteProgress['steps'] }) {
  const now = steps.findIndex((s) => !s.done);
  return (
    <ol className="cd-steps">
      {steps.map((s, i) => (
        <li key={s.label} className={cn(s.done && 'is-done', i === now && 'is-now')}>
          <span className="cd-step-i">{s.done ? <Icon name="check" size={13} /> : i === now ? <Dots /> : null}</span>{s.label}
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

/** Asked for from More: which AI model writes the notes again, then writing them, or not. */
function WriteAgain({ open, model, busy, onModel, onCancel, onWrite }: {
  open: boolean; model: string | null; busy: boolean; onModel: (id: string | null) => void; onCancel: () => void; onWrite: () => void;
}) {
  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) onCancel(); }} label="Write the notes again" className="cd-redo">
      <h2 className="cd-redo-h"><Icon name="notesPen" size={18} />Write the notes again?</h2>
      <p className="cd-redo-p">They’re written again from the transcript as it is now, by the AI model you choose. What people confirmed or took on stays.</p>
      <ModelPick value={model} onChange={onModel} />
      <div className="cd-redo-f">
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

/** A call that isn't here, or couldn't be read: why, and the way back. */
export function Missing({ error }: { error: unknown }) {
  const notFound = errorCode(error) === 'not-found';
  return <GonePage title={notFound ? 'This call isn’t here' : 'Couldn’t open this call'} lead={notFound ? 'Its notes were deleted, or they were never shared with you.' : errorMessage(error)} />;
}

/* The call from the welcome screen, written out: its notes to read and tick, and its transcript. Nothing to play, share or delete. */
function Example({ me, tab, onTab }: { me: Person; tab: CallTab; onTab: (t: CallTab) => void }) {
  const [note, setNote] = useState(() => exampleNote(me));
  const player = usePlayer(note.id, NO_AUDIO, false);
  const reader = { id: '', email: me.email, role: 'organizer' as const };
  const [here, setHere] = useState(0);
  const pane = useRef<HTMLDivElement>(null);
  const paneEnd = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const one = useOneColumn(page);
  const tick = (a: ActionItem, done: boolean) => { setNote((n) => ({ ...n, actions: n.actions.map((x) => (x.id === a.id ? { ...x, done } : x)) })); return Promise.resolve(); };
  const still = () => Promise.resolve();
  const act: Acting = { decision: still, question: still, action: still, toggle: tick };
  const people = peopleOn(note, me.email);
  const shownTab: CallTab = tab === 'shared' && !one ? 'notes' : tab;
  return (
    <Evening ref={page} moment="note" className={cn('cd', one && 'is-one')} data-view="example">
      <CallHead back="Home" title={note.title}>
        <span className="when">Example · 24 min</span>
        <span className="who"><span>{sayPeople(people)}</span></span>
      </CallHead>
      <div className="cd-cols" style={{ '--d': 1 }}>
        <div className="cd-left">
          <div className="cd-player">
            <Stage note={note} me={me.email} player={player} here={here} captions={shownTab !== 'transcript'} />
            <CallLine player={player} span={note.duration} chapters={note.chapters} marks={marksOf(note.decisions, note.actions)} shares={[]} gaps={[]} here={here} onScrub={setHere} />
          </div>
        </div>
        <aside className="cd-right" aria-label="What came of the call">
          <Tabs value={shownTab === 'yours' || shownTab === 'shared' ? 'notes' : shownTab} onChange={onTab} options={[{ value: 'notes', label: 'Notes' }, { value: 'transcript', label: 'Transcript' }]} label="The call’s notes" id="cd-tab" panel="cd-pane" className="cd-tabs" />
          <div ref={pane} id="cd-pane" role="tabpanel" className="cd-pane" tabIndex={-1}>
            {shownTab === 'transcript'
              ? <TranscriptPane note={note} me={me.email} player={player} here={here} onSeek={(s) => setHere(s)} focus={undefined} pane={pane} screens={undefined} correct={undefined} fromLine={undefined} marks={undefined} kinds={kindsOf(note)} onDownload={undefined} />
              : <NotesPane note={note} me={me.email} reader={reader} onSeek={setHere} shown={() => null} act={act} settled notices={null} decisionForm={() => null} actionForm={() => null} settle={undefined} shared={null} room={undefined} at={undefined} writing={false} tryAgain={null} />}
            <div ref={paneEnd} className="cd-end-mark" aria-hidden="true" />
          </div>
          <AskBar suggestions={note.suggestedQuestions} ask={askExample} end={paneEnd} />
        </aside>
      </div>
    </Evening>
  );
}
