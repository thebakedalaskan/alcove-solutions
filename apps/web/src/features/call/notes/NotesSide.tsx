/*
 * Notes, on your side: its head with what's captured in a word (the pill, which opens what's captured) and Open, the bar the
 * organizer's plan puts over the tabs while it stops notes, its tabs (the notes, the transcript, Ask, and your own), and Note to
 * self at the foot of all but Ask. This browser's own problems with capture are bars on the notes and the transcript. A moment that
 * catching up found takes the transcript's place, with a way back to live.
 */
import type { CallSession, CallState, Person, Series } from '@alcove/api';
import type { LivePut } from '~/features/workspace/live/types';
import { captureHere } from '~/lib/capture';
import { NotesHead, NotesTabs, NotesView, SideBody, TranscriptView } from '../layout/Panel';
import type { NotesTab, SidePlaces } from '../layout/side';
import { CapturePill, type CaptureControls } from './Capture';
import { AskView, MomentView } from './CatchUp';
import type { CatchingUp } from './catchingUp';
import { FromLastTime } from './FromLastTime';
import { NotesStopBar, type PlanStop, type StopMark } from './PlanStop';
import type { useNotesCapture } from './useNotesCapture';
import { OwnFoot, YoursView, type OwnInCall } from './Yours';

export function NotesSide({ session, state, getting, controls, capture, screenProblem, phone, planStop, put, stops, carried, account, cu, own, places, onOpenPage, onClose }: {
  session: CallSession;
  state: CallState;
  /** Who gets the notes, as far as you can tell. */
  getting: Person[];
  controls: CaptureControls;
  capture: ReturnType<typeof useNotesCapture>;
  /** Why what you share isn't reaching the notes, if it isn't. */
  screenProblem: string | null;
  phone: boolean;
  planStop: PlanStop | null;
  put: LivePut | null;
  stops: StopMark[];
  /** What carries over from the call before, for your account. */
  carried: Series | null;
  /** Your account's address, which the notes from last time are addressed to. */
  account: string | undefined;
  cu: CatchingUp;
  own: OwnInCall;
  places: SidePlaces;
  /** Opens the workspace on these notes, on your screen, and puts your side away. */
  onOpenPage: () => void;
  onClose: () => void;
}) {
  const me = state.participants.find((p) => p.isMe)?.person.email;
  const capHere = captureHere(state.capture);
  const problems = [capture.uploadError, capture.heardProblem, screenProblem].filter((x): x is string => !!x);
  const earlierNotes = carried?.notes.filter((n) => n.status === 'ready').map((n) => n.id) ?? [];
  const tab = places.notesTab;
  const body = (t: NotesTab) => {
    switch (t) {
      case 'notes': return <NotesView session={session} state={state} getting={getting} problems={problems} put={put} controls={controls} stops={stops}
        carried={carried && <FromLastTime s={carried} me={account} open={!state.liveNotes.notes} />} onSeek={cu.open} />;
      case 'transcript': return cu.moment
        ? <MomentView moment={cu.moment} startedAt={state.startedAt} me={me} onLive={cu.backToLive} />
        : <TranscriptView state={state} me={me} marks={own.enabled ? own.lines : undefined} put={put} controls={controls} problems={problems} />;
      case 'yours': return <YoursView own={own} state={state} me={me} onOpen={cu.open} />;
      case 'ask': return <AskView asks={cu.asks} modelPrivate={state.capture.modelPrivate} ready={state.notes.everOn && state.transcript.length > 0 && capHere.mode !== 'paused'} paused={capHere.mode === 'paused'} startedAt={state.startedAt} range={cu.range} window={cu.window}
        catching={cu.catching} draft={places.askDraft.current} earlier={earlierNotes.length ? earlierNotes : null} scope={cu.scope} onScope={cu.setScope} onRange={cu.setRange} onWindow={cu.refreshWindow} onAsk={cu.ask}
        onAskEarlier={(question) => cu.askEarlier(question, earlierNotes)} onCatchUp={() => cu.catchUp(cu.range)} onOpen={cu.open} onLive={cu.backToLive} keeping={own.enabled ? own : undefined} />;
    }
  };
  return (
    <div className="nn">
      <NotesHead pill={<CapturePill state={state} role={session.ticket.role} getting={getting} controls={controls} pausing={capture.pausing} phone={phone} stop={planStop} />} modelPrivate={state.capture.modelPrivate}
        onOpen={onOpenPage} onClose={onClose} />
      {planStop && <NotesStopBar stop={planStop} />}
      <NotesTabs tab={tab} yours={own.enabled} onTab={(t) => { cu.settle(); places.setNotesTab(t); }} />
      <SideBody view={tab}>{body(tab)}</SideBody>
      {tab !== 'ask' && own.enabled && state.notes.noteId !== null && <OwnFoot own={own} draft={places.ownDraft.current} />}
    </div>
  );
}
