/*
 * The boards on a note, after the call, under its summary. The call's board is a wide card: a live picture of all of it, drawn
 * by the board's own surface, then its name, what's on it, where it's saved and who can open it, and the way to it; the whole
 * card opens it, and on a phone the picture goes above the words. Each breakout room's board is a card of its own, side by
 * side with the other rooms' and folding to a stack on a phone: its picture, the room's name and a line about it, and one
 * click opens it. Styles are the note's (note.css, nd-board and nd-rboard).
 */
import { useId, type ReactNode, type Ref } from 'react';
import { cn } from '../cn';
import { Icon } from './icon';

export interface NoteBoardProps {
  name: string;
  /** What's on it and where it's saved: "3 frames, 13 stickies, saved in Product." */
  about: string;
  /** Who can open it: "Everyone invited can open it." */
  reach: string;
  /** The board as a picture of all of it, or nothing yet while it opens: the card keeps its size either way. */
  picture?: ReactNode;
  /** Where the picture goes, for whoever draws it to measure. */
  pictureRef?: Ref<HTMLSpanElement> | undefined;
  onOpen: () => void;
  className?: string | undefined;
}

export function NoteBoard({ name, about, reach, picture, pictureRef, onOpen, className }: NoteBoardProps) {
  return (
    <article className={cn('nd-board', className)}>
      <span ref={pictureRef} className="nd-board-pic" aria-hidden="true">{picture}</span>
      <div className="nd-board-t">
        <h3 className="ac-clamp-2">{name}</h3>
        <p>{about} {reach}</p>
        <button type="button" className="nd-board-open" aria-label={`Open the board ${name}`} onClick={onOpen}>Open the board<Icon name="right" size={15} /></button>
      </div>
    </article>
  );
}

export interface NoteRoomBoardProps {
  /** The room's name, or the room's and the board's when it had more than one. */
  name: string;
  /** What came of the room and who was there: "One owner for launch comms. Priya and Theo were here." */
  line: string;
  /** Said only when not everyone invited can open it. */
  reach?: string | undefined;
  picture?: ReactNode;
  pictureRef?: Ref<HTMLSpanElement> | undefined;
  onOpen: () => void;
  className?: string | undefined;
}

/** A screen reader hears it by its name, then what came of it and who can open it: "Comms, button. One owner for launch comms. …". */
export function NoteRoomBoard({ name, line, reach, picture, pictureRef, onOpen, className }: NoteRoomBoardProps) {
  const id = useId();
  return (
    <button type="button" className={cn('nd-rboard', className)} aria-labelledby={`${id}n`} aria-describedby={reach ? `${id}l ${id}r` : `${id}l`} onClick={onOpen}>
      <span ref={pictureRef} className="nd-board-pic" aria-hidden="true">{picture}</span>
      <b id={`${id}n`} className="ac-clamp-1">{name}</b>
      <span id={`${id}l`} className="ln ac-clamp-2">{line}</span>
      {reach && <span id={`${id}r`} className="rc">{reach}</span>}
    </button>
  );
}

/** The rooms' boards, side by side, under what they are: "3 breakout rooms · 10 min", or "2 of 3 breakout rooms · 10 min". */
export function NoteRoomBoards({ label, children, className }: { label: string; children: ReactNode; className?: string | undefined }) {
  return (
    <div className={cn('nd-rboards', className)}>
      <p className="nd-rboards-h">{label}</p>
      <div className="nd-rboards-g">{children}</div>
    </div>
  );
}
