/*
 * Each breakout room's own section of a call's notes (docs: Notes and inference › Breakout rooms), under the call's
 * notes: closed until opened, each with the room's name, its people in the arch and how long it was open. Inside,
 * the room's summary, decisions, open questions, follow-ups and chapters, written from what was said in that room
 * alone, and what was said there. Everyone with the call's notes reads every room's section.
 */
import { minutesLabel, type ActionItem, type ActionPatch, type Decision, type DecisionPatch, type NoteReader, type NoteRoom, type Person, type Question, type QuestionPatch } from '@alcove/api';
import { Faces, Fold, Notice } from '@alcove/ui';
import type { ReactNode } from 'react';
import { listNames } from '~/lib/people';
import type { Correcting, FromLine, LineMarks } from './lines';
import { Decisions, FollowUps, Questions, Section, TranscriptLines } from './parts';

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
 * the reader, as with the call's.
 */
export function RoomSections({ rooms, me, writing, correct, fromLine, settle, tryAgain, marks }: {
  rooms: NoteRoom[]; me: string | undefined; writing: boolean; correct?: Correcting | undefined; fromLine?: FromLine | undefined; settle?: Settling | undefined; tryAgain?: ReactNode; marks?: LineMarks | undefined;
}) {
  return (
    <Section title="Breakout rooms" count={`${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'}`} className="rooms-sec">
      <p className="rooms-lead">Each room’s notes come from what was said in it alone.</p>
      {rooms.map((r) => <RoomFold key={r.id} room={r} me={me} writing={writing} correct={correct} fromLine={fromLine} settle={settle} tryAgain={tryAgain} marks={marks} />)}
    </Section>
  );
}

function RoomFold({ room, me, writing, correct, fromLine, settle, tryAgain, marks }: {
  room: NoteRoom; me: string | undefined; writing: boolean; correct?: Correcting | undefined; fromLine?: FromLine | undefined; settle?: Settling | undefined; tryAgain?: ReactNode; marks?: LineMarks | undefined;
}) {
  const people = room.people.flatMap((x): Person[] => (x.person ? [x.person] : []));
  const said = room.transcript.length > 0;
  return (
    <Fold summary={(
      <span className="room-h">
        <b>{room.name}</b>
        {people.length > 0 && <Faces people={people} size={22} max={5} />}
        <small>{minutesLabel(Math.max(0, room.to - room.from))}{people.length ? ` · ${listNames(people)}` : ''}</small>
      </span>
    )}>
      {!said ? <p className="room-quiet">Nothing was said here while notes were on.</p> : (
        <>
          {room.summary ? <p className="summary">{room.summary}</p>
            : writing ? <p className="room-quiet">This room’s notes are being written.</p>
              : <><Notice tone="caution" icon="pen">This room’s notes couldn’t be written. What was said is below.</Notice>{tryAgain}</>}
          {(room.decisions.length > 0 || settle) && <Part title="Decisions"><Decisions items={room.decisions} me={me} reader={settle?.reader} onChange={settle?.onDecision} />{settle?.decisionForm(room.id)}</Part>}
          {room.questions.length > 0 && <Part title="Still open"><Questions items={room.questions} me={me} onChange={settle?.onQuestion} /></Part>}
          {(room.actions.length > 0 || settle) && (
            <Part title="Follow-ups"><FollowUps actions={room.actions} me={me} reader={settle?.reader} people={settle?.people} onToggle={settle?.onToggle} onChange={settle?.onAction} />{settle?.actionForm(room.id)}</Part>
          )}
          {room.chapters.length > 0 && (
            <Part title="Chapters">
              <ol className="room-chapters">{room.chapters.map((c) => <li key={`${c.at}-${c.title}`}><b>{c.title}</b>{c.summary && <span>{c.summary}</span>}</li>)}</ol>
            </Part>
          )}
          <Fold className="room-said" summary={<span className="room-h"><b>What was said in {room.name}</b><small>{room.transcript.length} {room.transcript.length === 1 ? 'line' : 'lines'}</small></span>}>
            <TranscriptLines lines={room.transcript} gaps={room.gaps} me={me} correct={correct} fromLine={fromLine} marks={marks} />
          </Fold>
        </>
      )}
    </Fold>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return <div className="room-part"><h4>{title}</h4>{children}</div>;
}
