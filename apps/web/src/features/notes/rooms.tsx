/*
 * Each breakout room's own section of a call's notes (docs: Notes and inference › Breakout rooms), under the chapter it was
 * open in, in How it went: closed until opened, each with its people in the arch, the room's name and what its notes say
 * first, how long it was open and whether it had a board, whose card is with what the call made. Inside, the room's summary, decisions,
 * open questions, follow-ups (its board's under their own heading) and chapters, written from what was said and written
 * in that room alone, and what was said there. Everyone with the call's notes reads every room's section.
 */
import {
  minutesLabel, type ActionItem, type ActionPatch, type Decision, type DecisionPatch, type NoteReader, type NoteRoom, type NoteWorkedOn, type Person, type Question, type QuestionPatch
} from '@alcove/api';
import { Faces, Fold, Icon, Notice, UnsureKey, cn } from '@alcove/ui';
import type { ReactNode } from 'react';
import { listNames } from '~/lib/people';
import type { Correcting, FromLine, LineMarks } from './lines';
import { TranscriptLines, roomAnchor } from './parts';
import { Decisions, FollowUps, Questions } from './rows';
import { NoteFollowUpReview } from './NoteFollowUps';

/** What someone who has the notes does with a room's decisions, questions and follow-ups, as with the call's. */
export interface Settling {
  /** Who's reading, for what `grants.ts` lets them do. */
  reader: NoteReader;
  onDecision: (d: Decision, patch: DecisionPatch) => void;
  onQuestion: (x: Question, patch: QuestionPatch) => void;
  onToggle: (a: ActionItem, done: boolean) => void;
  onAction: (a: ActionItem, patch: ActionPatch) => void;
  /** Who a follow-up can be given to: the people who have the notes. */
  people: Person[];
  /** Adding a decision or a follow-up to a room's section. */
  decisionForm: (room: string) => ReactNode;
  actionForm: (room: string) => ReactNode;
}

/**
 * The breakout rooms' sections, one fold each. `writing` while the notes are being written; `correct` and `settle` let
 * the reader correct a room's lines and settle what its notes say, as they do the call's. `tryAgain` is under a room
 * whose notes couldn't be written, for someone who can have them written again. `marks` bookmarks a room's lines for
 * the reader, as with the call's. `open` is the room a link came to, which starts open, at `at` in what was said there
 * when the link came to a moment. `boards` are the call's, each in the room it was open in.
 */
export function RoomSections({ noteId, rooms, boards = [], me, writing, correct, fromLine, settle, tryAgain, marks, open, at }: {
  noteId?: string | undefined;
  rooms: NoteRoom[]; boards?: readonly NoteWorkedOn[] | undefined; me: string | undefined; writing: boolean; correct?: Correcting | undefined; fromLine?: FromLine | undefined; settle?: Settling | undefined; tryAgain?: ReactNode; marks?: LineMarks | undefined;
  open?: string | undefined; at?: number | undefined;
}) {
  return (
    <div className="cd-rooms">
      {rooms.map((r) => (
        <RoomFold key={r.id} noteId={noteId} room={r} boards={boards.filter((b) => b.room === r.id)} me={me} writing={writing} correct={correct} fromLine={fromLine} settle={settle} tryAgain={tryAgain} marks={marks}
          open={r.id === open} at={r.id === open ? at : undefined} />
      ))}
    </div>
  );
}

/** What a room's notes say first, as How it went gives it beside the room's name. */
const gistOf = (room: NoteRoom): string => /^.*?[.!?](?=\s|$)/.exec(room.summary.trim())?.[0] ?? room.summary.trim();

function RoomFold({ noteId, room, boards, me, writing, correct, fromLine, settle, tryAgain, marks, open, at }: {
  noteId: string | undefined;
  room: NoteRoom; boards: readonly NoteWorkedOn[]; me: string | undefined; writing: boolean; correct?: Correcting | undefined; fromLine?: FromLine | undefined; settle?: Settling | undefined; tryAgain?: ReactNode;
  marks?: LineMarks | undefined; open: boolean; at: number | undefined;
}) {
  const people = room.people.flatMap((x): Person[] => (x.person ? [x.person] : []));
  const said = room.transcript.length > 0;
  const hasNotes = room.summary.trim() !== '' || room.actions.length > 0 || room.decisions.length > 0 || room.questions.length > 0;
  const spoken = room.actions.filter((a) => a.from === null);
  const fromBoards = room.actions.filter((a) => a.from === 'board');
  return (
    <Fold id={roomAnchor(room.id)} open={open} className="cd-fold" summary={(
      <>
        {people.length > 0 ? <Faces people={people} size={20} max={3} /> : <Icon name="rooms" size={16} />}
        <span className="cd-fold-t"><b>{room.name}</b>{gistOf(room) && <span className="ac-clamp-2">{gistOf(room)}</span>}</span>
        <small>{minutesLabel(Math.max(0, room.to - room.from))}{people.length ? ` · ${listNames(people)}` : ''}{boards.length ? ` · ${boards.length === 1 ? 'a board' : `${boards.length} boards`}` : ''}</small>
      </>
    )}>
      {noteId && settle && <NoteFollowUpReview noteId={noteId} suggestions={room.suggestions} actions={room.actions} people={settle.people} reader={settle.reader} me={me} />}
      {!said && !hasNotes ? <p className="cd-quiet">Nothing was said here while notes were on.</p> : (
        <>
          {room.summary ? <p className="cd-fold-sum">{room.summary}</p>
            : writing ? <p className="cd-quiet">This room’s notes are being written.</p>
              : <><Notice tone="caution" icon="pen">This room’s notes couldn’t be written. What was said is below.</Notice>{tryAgain}</>}
          {(room.decisions.length > 0 || settle) && <Part title="Decided" kind="decide"><Decisions items={room.decisions} room me={me} reader={settle?.reader} onChange={settle?.onDecision} />{settle?.decisionForm(room.id)}</Part>}
          {room.questions.length > 0 && <Part title="Still open"><Questions items={room.questions} room me={me} onChange={settle?.onQuestion} /></Part>}
          {(spoken.length > 0 || settle) && (
            <Part title="Follow-ups" kind="follow"><FollowUps actions={spoken} room me={me} reader={settle?.reader} people={settle?.people} onToggle={settle?.onToggle} onChange={settle?.onAction} />{settle?.actionForm(room.id)}</Part>
          )}
          {fromBoards.length > 0 && (
            <Part title={boards.length > 1 ? 'Follow-ups from the boards' : 'Follow-ups from the board'} kind="follow">
              <FollowUps actions={fromBoards} room me={me} reader={settle?.reader} people={settle?.people} onToggle={settle?.onToggle} onChange={settle?.onAction} />
            </Part>
          )}
          {room.chapters.length > 0 && (
            <Part title="Chapters">
              <ol className="cd-rch">{room.chapters.map((c) => <li key={`${c.at}-${c.title}`}><b>{c.title}</b>{c.summary && <span>{c.summary}</span>}</li>)}</ol>
            </Part>
          )}
          {said && <Fold className="cd-fold is-said" open={at !== undefined} summary={<><b>What was said in {room.name}</b><small>{room.transcript.length} {room.transcript.length === 1 ? 'line' : 'lines'}</small></>}>
            <UnsureKey words={room.transcript.some((l) => l.unsure?.words)} speaker={room.transcript.some((l) => l.unsure?.speaker)} className="cd-key" />
            <TranscriptLines lines={room.transcript} gaps={room.gaps} me={me} focus={at} correct={correct} fromLine={fromLine} marks={marks} className="is-room" />
          </Fold>}
        </>
      )}
    </Fold>
  );
}

function Part({ title, kind, children }: { title: string; kind?: 'decide' | 'follow' | undefined; children: ReactNode }) {
  return <div className={cn('cd-sub', kind && `is-${kind}`)}><h3>{title}</h3>{children}</div>;
}
