/*
 * The boards on a note (docs: Notes and inference › Boards), under its summary: each board open in the call that the reader
 * can open now, as a live picture of all of it drawn from the board itself, in the reader's theme as the board itself is. The
 * call's board has its name, what's on it, where it's saved and who can open it, and the way to its page; each breakout
 * room's is a card of its own, side by side with the other rooms', that opens it in one click. A board opens only once its
 * card is on screen, to read and never to write, and nothing of it is kept on this device.
 */
import { errorCode, minutesLabel, type DocSession, type NoteRoom, type NoteWorkedOn, type Person } from '@alcove/api';
import { NoteBoard, NoteRoomBoard, NoteRoomBoards, cn } from '@alcove/ui';
import { useNavigate } from '@tanstack/react-router';
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { BoardPictures } from '~/features/board/BoardSurface';
import type { BoardCounts } from '~/features/board/counts';
import { BoardSurface, loadCounts } from '~/features/board/lazy';
import { openToRead } from '~/features/workspace/session';
import { api } from '~/lib/api';
import { log } from '~/lib/log';
import { listNames } from '~/lib/people';

const blog = log.child({ component: 'note-boards' });

/** The width the picture draws a board at before shrinking it into the card: about the canvas's board on a page. */
const DRAWN_W = 900;

/**
 * The board's session, opened to read once `on` (its card has come on screen), with how many frames and stickies it has as it
 * changes, counted by what loads with the board's surface, and closed when the card goes. One that can't be opened leaves the
 * card with its words and no picture.
 */
function useReading(workspaceId: string, documentId: string, on: boolean): { session: DocSession | null; counted: BoardCounts | null } {
  const [session, setSession] = useState<DocSession | null>(null);
  const [counted, setCounted] = useState<BoardCounts | null>(null);
  useEffect(() => {
    if (!on) return undefined;
    let gone = false;
    let held: DocSession | null = null;
    let stop = (): void => {};
    openToRead(workspaceId, documentId, undefined).then(async (s) => {
      held = s;
      if (gone) { s.close(); return; }
      const [{ watchCounts }] = await Promise.all([loadCounts(), s.ready]);
      if (gone) return;
      stop = watchCounts(s.doc, setCounted);
      setSession(s);
    }).catch((e: unknown) => {
      if (!gone) blog.info('a board on a note wasn’t opened', { workspaceId, documentId, code: errorCode(e) });
    });
    return () => {
      gone = true;
      stop();
      held?.close();
      setSession(null);
    };
  }, [workspaceId, documentId, on]);
  return { session, counted };
}

/**
 * A board drawn small: where its picture goes, measured, and the board drawn at its full size and shrunk to fit once the card
 * is on screen. It takes the reader's theme from the page, as the board's own page does.
 */
function useBoardPicture(board: NoteWorkedOn): { box: RefObject<HTMLSpanElement | null>; picture: ReactNode; counted: BoardCounts | null } {
  const box = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const sizes = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    sizes.observe(el);
    const shown = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setSeen(true); shown.disconnect(); } }, { rootMargin: '240px' });
    shown.observe(el);
    return () => { sizes.disconnect(); shown.disconnect(); };
  }, []);
  const { session, counted } = useReading(board.workspaceId, board.id, seen);
  const pictures = useMemo<BoardPictures>(() => (media, signal) => api.workspaces.media.picture(board.workspaceId, board.id, media, { signal }), [board.workspaceId, board.id]);
  const scale = size && size.w > 0 ? size.w / DRAWN_W : 1;
  const picture = session && size && size.w > 0 ? (
    <span className="nd-board-mini" style={{ width: DRAWN_W, height: Math.max(1, Math.round(size.h / scale)), transform: `scale(${scale})` }}>
      <Suspense fallback={null}><BoardSurface doc={session.doc} awareness={session.awareness} mode="tile" pictures={pictures} /></Suspense>
    </span>
  ) : null;
  return { box, picture, counted };
}

/** Goes to a board's page. */
function useOpenBoard(board: NoteWorkedOn): () => void {
  const navigate = useNavigate();
  return () => void navigate({ to: '/drive/$workspaceId/$documentId', params: { workspaceId: board.workspaceId, documentId: board.id } });
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "3 frames, 13 stickies, saved in Product." Until the board's read, where it's saved. */
function aboutOf(counted: BoardCounts | null, workspace: string | null): string {
  const where = workspace === null ? 'shared with you' : `saved in ${workspace}`;
  if (!counted) return `${capital(where)}.`;
  const parts = [
    counted.frames ? `${counted.frames} ${counted.frames === 1 ? 'frame' : 'frames'}` : '',
    counted.stickies ? `${counted.stickies} ${counted.stickies === 1 ? 'sticky' : 'stickies'}` : ''
  ].filter(Boolean);
  return `${parts.length ? parts.join(', ') : 'Nothing on it yet'}, ${where}.`;
}
/** One summary goes to everyone, so it reads a board only when everyone invited can open it. */
const NOT_EVERYONE = 'Not everyone invited can open it, so the summary leaves it out.';
const reachOf = (everyone: boolean): string => (everyone ? 'Everyone invited can open it.' : NOT_EVERYONE);

/** One of the call's boards. */
function NoteBoardCard({ board }: { board: NoteWorkedOn }) {
  const { box, picture, counted } = useBoardPicture(board);
  const open = useOpenBoard(board);
  return <NoteBoard name={board.name || 'Untitled board'} about={aboutOf(counted, board.workspace)} reach={reachOf(board.everyone)} picture={picture} pictureRef={box} onOpen={open} />;
}

/** The call's boards, each once. */
export function NoteBoardCards({ boards, className }: { boards: readonly NoteWorkedOn[]; className?: string | undefined }) {
  if (!boards.length) return null;
  return <div className={cn('nd-boards', className)}>{boards.map((b) => <NoteBoardCard key={`${b.workspaceId}/${b.id}`} board={b} />)}</div>;
}

/** A breakout room's board, with the room it was open in. `several`: the room had more than one, so the card names the board too. */
export interface RoomBoard { room: NoteRoom; board: NoteWorkedOn; several: boolean }

/** The first sentence of what a room's notes say. */
const firstSentence = (s: string): string => /^.*?[.!?](?=\s|$)/.exec(s.trim())?.[0] ?? s.trim();
const sentence = (s: string): string => (/[.!?…]$/.test(s) ? s : `${s}.`);
/**
 * What a room's card says: what came of it, as the first follow-up its board gave, else the first one said there, else the
 * first sentence of its notes, and who was there. "One owner for launch comms. Priya and Theo were here."
 */
function lineOf(room: NoteRoom): string {
  const came = (room.actions.find((a) => a.from === 'board') ?? room.actions[0])?.text ?? firstSentence(room.summary);
  const people = room.people.flatMap((x): Person[] => (x.person ? [x.person] : []));
  const who = people.length ? `${listNames(people)} ${people.length === 1 ? 'was' : 'were'} here.` : '';
  return [came ? sentence(came) : '', who].filter(Boolean).join(' ');
}

function NoteRoomBoardCard({ entry }: { entry: RoomBoard }) {
  const { box, picture } = useBoardPicture(entry.board);
  const open = useOpenBoard(entry.board);
  const board = entry.board.name || 'Untitled board';
  return (
    <NoteRoomBoard name={entry.several ? `${entry.room.name} · ${board}` : entry.room.name} line={lineOf(entry.room)} reach={entry.board.everyone ? undefined : NOT_EVERYONE}
      picture={picture} pictureRef={box} onOpen={open} />
  );
}

/**
 * Each breakout room's board, side by side, under how many rooms the call had and for how long: "3 breakout rooms · 10 min",
 * or "2 of 3 breakout rooms · 10 min" when some rooms had no board, or one the reader can't open.
 */
export function NoteRoomBoardCards({ rooms, held }: { rooms: readonly RoomBoard[]; held: readonly NoteRoom[] }) {
  if (!rooms.length) return null;
  const shown = new Set(rooms.map((x) => x.room.id)).size;
  const minutes = Math.max(0, ...held.map((r) => r.to - r.from));
  const count = shown < held.length ? `${shown} of ${held.length}` : `${held.length}`;
  return (
    <NoteRoomBoards label={`${count} breakout ${held.length === 1 ? 'room' : 'rooms'} · ${minutesLabel(minutes)}`}>
      {rooms.map((x) => <NoteRoomBoardCard key={`${x.board.workspaceId}/${x.board.id}`} entry={x} />)}
    </NoteRoomBoards>
  );
}
