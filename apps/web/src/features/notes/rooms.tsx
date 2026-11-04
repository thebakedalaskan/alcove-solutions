/*
 * Each breakout room's own section of a call's notes (docs: Notes and inference › Breakout rooms), under the call's
 * notes: closed until opened, each with the room's name, its people in the arch and how long it was open. Inside,
 * the room's summary, decisions, open questions, follow-ups and chapters, written from what was said in that room
 * alone, and what was said there. Everyone with the call's notes reads every room's section.
 */
import { minutesLabel, type ActionItem, type ActionPatch, type Decision, type DecisionPatch, type Person, type Question, type QuestionPatch, type RoomNote } from '@alcove/api';
import { Faces, Fold, Notice } from '@alcove/ui';
import type { ReactNode } from 'react';
import { listNames } from '~/lib/people';
import type { Correcting } from './lines';
import { Decisions, FollowUps, Questions, Section, TranscriptLines, roomAnchor } from './parts';

/** What someone who has the notes does with a room's decisions, questions and follow-ups, as with the call's. */
export interface Settling {
  onDecision: (d: Decision, patch: DecisionPatch) => void;
  onQuestion: (x: Question, patch: QuestionPatch) => void;
  onToggle: (a: ActionItem, done: boolean) => void;
  onAction: (a: ActionItem, patch: ActionPatch) => void;
  /** Who a follow-up can be given to: the people who have the notes. */
  people: Person[];
}

/**
 * The breakout rooms' sections, one fold each. `writing` while the notes are being written; `correct` and `settle` let
 * the reader correct a room's lines and settle what its notes say, as they do the call's. `tryAgain` is under a room
 * whose notes couldn't be written, for someone who can have them written again. `open` is the room a link came to, which
 * starts open, at `at` in what was said there when the link came to a moment.
 */
export function RoomSections({ rooms, me, writing, correct, settle, tryAgain, open, at }: {
  rooms: RoomNote[]; me: string | undefined; writing: boolean; correct?: Correcting | undefined; settle?: Settling | undefined; tryAgain?: ReactNode;
  open?: string | undefined; at?: number | undefined;
}) {
  return (
    <Section title="Breakout rooms" count={`${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'}`} className="rooms-sec">
      <p className="rooms-lead">Each room’s notes come from what was said in it alone.</p>
      {rooms.map((r) => <RoomFold key={r.id} room={r} me={me} writing={writing} correct={correct} settle={settle} tryAgain={tryAgain} open={r.id === open} at={r.id === open ? at : undefined} />)}
    </Section>
  );
}

function RoomFold({ room, me, writing, correct, settle, tryAgain, open, at }: {
  room: RoomNote; me: string | undefined; writing: boolean; correct?: Correcting | undefined; settle?: Settling | undefined; tryAgain?: ReactNode; open: boolean; at: number | undefined;
}) {
  const people = room.people.flatMap((x): Person[] => (x.person ? [x.person] : []));
  const said = room.transcript.length > 0;
  return (
    <Fold id={roomAnchor(room.id)} open={open} summary={(
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
          {room.decisions.length > 0 && <Part title="Decided"><Decisions items={room.decisions} me={me} onChange={settle?.onDecision} /></Part>}
          {room.questions.length > 0 && <Part title="Still open"><Questions items={room.questions} me={me} onChange={settle?.onQuestion} /></Part>}
          {room.actions.length > 0 && (
            <Part title="Follow-ups"><FollowUps actions={room.actions} me={me} people={settle?.people} onToggle={settle?.onToggle} onChange={settle?.onAction} /></Part>
          )}
          {room.chapters.length > 0 && (
            <Part title="Chapters">
              <ol className="room-chapters">{room.chapters.map((c) => <li key={`${c.at}-${c.title}`}><b>{c.title}</b>{c.summary && <span>{c.summary}</span>}</li>)}</ol>
            </Part>
          )}
          <Fold className="room-said" open={at !== undefined} summary={<span className="room-h"><b>What was said in {room.name}</b><small>{room.transcript.length} {room.transcript.length === 1 ? 'line' : 'lines'}</small></span>}>
            <TranscriptLines lines={room.transcript} gaps={room.gaps} me={me} focus={at} correct={correct} />
          </Fold>
        </>
      )}
    </Fold>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return <div className="room-part"><h4>{title}</h4>{children}</div>;
}
