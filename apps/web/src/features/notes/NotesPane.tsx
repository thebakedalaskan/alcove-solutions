/*
 * The Notes tab of a call's page: the gist, and the full summary behind it; then For you, exactly what the Calls row promised
 * (a decision to confirm, a follow-up suggested for you), each answered in place, with a toast that says what happened and
 * Undo; then everything else once: Decided, Follow-ups (yours first, suggested ones marked until someone takes them) and
 * Still open, each with who and a ▶ chip that plays its moment on the stage without leaving the tab; the shared notes; and How
 * it went, chapter by chapter, with what was shared then and each breakout room's own notes. Until the notes are written, what
 * the page knows of them stands in their place (`notices`).
 */
import {
  isAcceptedFollowUp, mayDecide, type ActionItem, type ActionPatch, type Decision, type DecisionPatch, type Note, type NoteReader, type Question, type QuestionPatch
} from '@alcove/api';
import { Icon, useToast } from '@alcove/ui';
import type { ReactNode } from 'react';
import { NoteFollowUpReview } from './NoteFollowUps';
import { Moment, Section, Summary, type ScreenRefShown } from './parts';
import { RoomSections, type Settling } from './rooms';
import { DecisionRow, Decisions, FollowUpRow, FollowUps, Questions, isMine } from './rows';

/** What someone with the notes does with them, each saying it worked once it has (a failure says so itself, and rejects). */
export interface Acting {
  decision: (d: Decision, patch: DecisionPatch) => Promise<unknown>;
  question: (x: Question, patch: QuestionPatch) => Promise<unknown>;
  action: (a: ActionItem, patch: ActionPatch) => Promise<unknown>;
  toggle: (a: ActionItem, done: boolean) => Promise<unknown>;
}

/** What's waiting on the reader in a call: decisions they can confirm (or, organizing, settle), and follow-ups suggested to them. */
export function waitingOn(note: Note, me: string | undefined, reader: NoteReader): { decisions: Note['decisions']; actions: Note['actions'] } {
  return {
    decisions: note.decisions.filter((d) => (d.state === 'proposed' && mayDecide(d, 'confirmed', reader)) || (d.state === 'confirmed' && reader.role === 'organizer' && d.disputes.length > 0)),
    actions: note.actions.filter((a) => isAcceptedFollowUp(a) && a.from === null && isMine(a, me) && !a.takenOn && !a.done)
  };
}

const ignore = () => undefined;

/** For you: what's waiting on you here, answered in place, said in a toast with Undo while there's one to give. */
function ForYou({ note, me, reader, onSeek, shown, act }: { note: Note; me: string | undefined; reader: NoteReader; onSeek: ((s: number) => void) | undefined; shown: ScreenRefShown; act: Acting }) {
  const toast = useToast();
  const { decisions, actions } = waitingOn(note, me, reader);
  const count = decisions.length + actions.length;
  const confirmed = (d: Decision) => void act.decision(d, { state: 'confirmed', seen: { text: d.text } }).then(() => toast('Confirmed for everyone with the notes.', {
    icon: 'check', ms: 6000, action: { label: 'Undo', onClick: () => void act.decision(d, { state: 'proposed' }).catch(ignore) }
  }), ignore);
  const notDecidedHere = (d: Decision, patch: DecisionPatch) => void act.decision(d, patch).then(() => toast(patch.state === 'rejected' ? 'Crossed out for everyone with the notes.' : 'Everyone with the notes sees that. The organizer settles it.', {
    icon: 'x', ms: 6000, action: { label: 'Undo', onClick: () => void act.decision(d, patch.state === 'rejected' ? { state: 'proposed' } : { dispute: false }).catch(ignore) }
  }), ignore);
  const took = (a: ActionItem) => void act.action(a, { takeOn: true, seen: { text: a.text, due: a.due ?? null } }).then(() => toast('It’s yours. It’s on Home with your other follow-ups.', {
    icon: 'check', ms: 6000, action: { label: 'Undo', onClick: () => void act.action(a, { takeOn: false }).catch(ignore) }
  }), ignore);
  const notMine = (a: ActionItem) => void act.action(a, { owner: null }).then(() => toast('It’s not yours. Nobody has it now.', {
    icon: 'x', ms: 6000, ...(me ? { action: { label: 'It’s mine', onClick: () => void act.action({ ...a, owner: undefined }, { owner: me, seen: { text: a.text, due: a.due ?? null } }).catch(ignore) } } : {})
  }), ignore);
  return (
    <Section title="For you" count={count ? String(count) : undefined} className="is-you">
      {count === 0 ? <p className="cd-none"><Icon name="check" size={16} />Nothing from this call is waiting on you.</p> : (
        <>
          {decisions.map((d) => (
            <DecisionRow key={d.id} d={d} reader={reader} me={me} onSeek={onSeek} shown={shown} onChange={(x, patch) => void act.decision(x, patch).catch(ignore)}
              forYou={{ onConfirm: confirmed, onNotDecided: notDecidedHere }} />
          ))}
          {actions.map((a) => (
            <FollowUpRow key={a.id} a={a} reader={reader} me={me} people={[]} onSeek={onSeek} shown={shown} forYou={{ onTake: took, onNotMine: notMine }} />
          ))}
        </>
      )}
    </Section>
  );
}

/** How many there are, and how many of them are yours or waiting: "3", "3 · 1 yours". */
const counted = (n: number, extra?: string) => (n ? `${n}${extra ? ` · ${extra}` : ''}` : undefined);

export interface NotesPaneProps {
  note: Note;
  me: string | undefined;
  reader: NoteReader;
  /** Plays a moment on the stage, from a ▶ chip. */
  onSeek: ((s: number) => void) | undefined;
  shown: ScreenRefShown;
  act: Acting;
  /** The notes are written: the lists can be settled, and added to. */
  settled: boolean;
  /** What stands in for the notes until they're written, and offers around them: being written, written again, couldn't be. */
  notices: ReactNode;
  /** Adding a decision or a follow-up, the call's or a breakout room's. */
  decisionForm: (room?: string | undefined) => ReactNode;
  actionForm: (room?: string | undefined) => ReactNode;
  /** The breakout rooms' notes, settled as the call's are. */
  settle: Settling | undefined;
  /** What people added to the shared notes, and the box to write there. */
  shared: ReactNode;
  /** The room a link came to, and the moment in it. */
  room: string | undefined;
  at: number | undefined;
  writing: boolean;
  tryAgain: ReactNode;
  /** A note your team can see, from someone else: to read, and nothing in it to change, add to or settle. */
  locked?: boolean | undefined;
}

export function NotesPane({ note, me, reader, onSeek, shown, act, settled, notices, decisionForm, actionForm, settle, shared, room, at, writing, tryAgain, locked = false }: NotesPaneProps) {
  const people = note.recipients.map((r) => r.person);
  const waiting = locked ? { decisions: [], actions: [] } : waitingOn(note, me, reader);
  const forYou = new Set([...waiting.decisions.map((d) => d.id), ...waiting.actions.map((a) => a.id)]);
  const decided = note.decisions.filter((d) => !forYou.has(d.id));
  const said = note.actions.filter((a) => a.from === null && !forYou.has(a.id));
  const fromBoards = note.actions.filter((a) => a.from === 'board');
  const yours = note.actions.filter((a) => isMine(a, me) && !a.done && isAcceptedFollowUp(a)).length;
  const onDecision = locked ? undefined : (d: Decision, patch: DecisionPatch) => void act.decision(d, patch).catch(ignore);
  const onQuestion = locked ? undefined : (x: Question, patch: QuestionPatch) => void act.question(x, patch).catch(ignore);
  const onToggle = locked ? undefined : (a: ActionItem, done: boolean) => void act.toggle(a, done).catch(ignore);
  const onAction = locked ? undefined : (a: ActionItem, patch: ActionPatch) => void act.action(a, patch).catch(ignore);
  const written = note.summary.trim() !== '';
  const chapters = note.chapters;
  // Each breakout room sits under the chapter it was open in; any no chapter covers, after them.
  const roomsIn = (from: number, to: number) => note.rooms.filter((r) => r.from >= from - 2 && r.from < to);
  const placed = new Set(chapters.flatMap((c, i) => roomsIn(c.at, chapters[i + 1]?.at ?? Infinity).map((r) => r.id)));
  const unplaced = note.rooms.filter((r) => !placed.has(r.id));
  const roomsOf = (list: Note['rooms']) => list.length > 0 && (
    <RoomSections noteId={note.id} rooms={list} boards={note.workedOn.filter((w) => w.kind === 'board')} me={me} writing={writing} settle={settle} tryAgain={tryAgain} open={room} at={at} />
  );
  return (
    <div className="cd-notes">
      {notices}
      {settled && written && <Summary summary={note.summary} details={note.details} />}
      {settled && written && !locked && <ForYou note={note} me={me} reader={reader} onSeek={onSeek} shown={shown} act={act} />}
      {settled && written && (
        <Section title="Decided" kind="decide" id="decided" count={counted(decided.length)}>
          {decided.length > 0 ? <Decisions items={decided} me={me} reader={reader} onChange={onDecision} onSeek={onSeek} shown={shown} /> : !forYou.size && <p className="cd-quiet">The notes didn’t hear anything decided.</p>}
          {!locked && decisionForm()}
        </Section>
      )}
      {(settled || note.actions.length > 0) && (
        <Section title="Follow-ups" kind="follow" id="follow-ups" count={counted(said.filter(isAcceptedFollowUp).length, yours ? `${yours} yours` : undefined)}>
          {said.some(isAcceptedFollowUp) ? <FollowUps actions={said} me={me} reader={settled ? reader : undefined} people={people} onToggle={onToggle} onChange={settled ? onAction : undefined} onSeek={onSeek} shown={shown} />
            : settled && !waiting.actions.length && <p className="cd-quiet">The notes didn’t hear anything to follow up.</p>}
          {!locked && <NoteFollowUpReview noteId={note.id} suggestions={note.suggestions} actions={note.actions} people={people} reader={reader} me={me} onSeek={onSeek} shown={shown} />}
          {settled && !locked && actionForm()}
        </Section>
      )}
      {settled && written && fromBoards.length > 0 && (
        <Section title={note.workedOn.filter((w) => w.kind === 'board' && w.room === null).length > 1 ? 'Follow-ups from the boards' : 'Follow-ups from the board'} kind="follow" id="board-follow-ups" count={counted(fromBoards.length)}>
          <FollowUps actions={fromBoards} me={me} reader={reader} people={people} onToggle={onToggle} onChange={onAction} onSeek={onSeek} shown={shown} />
        </Section>
      )}
      {note.questions.length > 0 && (
        <Section title="Still open" count={counted(note.questions.filter((x) => x.state === 'open').length)}>
          <Questions items={note.questions} me={me} onChange={settled ? onQuestion : undefined} onSeek={onSeek} shown={shown} />
        </Section>
      )}
      {shared}
      {chapters.length > 0 && settled && (
        <Section title="How it went" count={`${chapters.length} ${chapters.length === 1 ? 'chapter' : 'chapters'}`} className="cd-how">
          {chapters.map((c, i) => {
            const next = chapters[i + 1]?.at ?? Infinity;
            const shares = note.shares.filter((s) => s.at >= c.at && s.at < next);
            const rooms = roomsIn(c.at, next);
            return (
              <div key={`${c.at}-${c.title}`} className="cd-hw">
                <span className="tmc"><Moment at={c.at} onSeek={onSeek} /></span>
                <div className="tx">
                  <p className="t">
                    <b>{c.title}</b>
                    {shares.map((s) => <span key={s.id} className="tag"><Icon name="monitor" size={14} />{s.label}</span>)}
                    {!shares.length && c.screen && shown(c.screen)}
                    {rooms.length > 0 && <span className="tag"><Icon name="rooms" size={14} />{rooms.length === 1 ? 'A breakout room' : `${rooms.length} breakout rooms`}</span>}
                  </p>
                  {c.summary && <p className="g">{c.summary}</p>}
                  {roomsOf(rooms)}
                </div>
              </div>
            );
          })}
        </Section>
      )}
      {(chapters.length === 0 || !settled) && note.rooms.length > 0 && <Section title="Breakout rooms" count={String(note.rooms.length)}>{roomsOf(note.rooms)}</Section>}
      {chapters.length > 0 && settled && unplaced.length > 0 && <Section title="Breakout rooms" count={String(unplaced.length)}>{roomsOf(unplaced)}</Section>}
    </div>
  );
}
