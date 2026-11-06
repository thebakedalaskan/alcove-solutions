/*
 * Comments on a board: a pin on whatever's commented on, with the face of whoever started the thread, and the thread itself
 * in the workspace's sheet beside it. They aren't on the board: nothing anyone writes here moves or covers a sticky, and the
 * board's undo never takes a comment back. They're written under an origin of their own for that reason, which the board's
 * history doesn't follow. K, or More's Comment, comments on what's picked or what the pointer is on, and with neither, on the
 * next thing pressed. A thread on something that's gone goes with it, and comes back with it.
 *
 * The surface draws at most once for comments: what's open is a store of its own, and the pins and the sheet each read it,
 * and the threads, themselves, so a comment arriving draws them alone.
 */
import { addReply, addThread, hasBox, observeComments, readThreads, resolveThread, type BoardAuthor, type BoardObject, type BoardReply, type BoardThread, type BoardView, type FrameObject, type PlacedObject } from '@alcove/board';
import { firstName } from '@alcove/api';
import { BoardComment, WsCommentCompose, WsCommentThread, WsPopover, type AvatarPerson, type WsComment } from '@alcove/ui';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { inSlide } from './selection';
import type { BoardMode } from './state';
import { useBoardState, type Board } from './useBoard';

/** What a board's comments need from wherever it is. */
export interface BoardCommenting {
  /** Who's writing, as each message keeps it: null for someone who can only read what's been said. */
  me: BoardAuthor | null;
  /** Their face, beside the field. */
  person: AvatarPerson;
  /** A face for whoever wrote a message. */
  face: (reply: BoardReply) => AvatarPerson;
  /** A thread was resolved here: say so, with the way to open it again. */
  onResolved?: ((reopen: () => void) => void) | undefined;
}

/** Comments are nobody's change to the board, so the board's undo leaves them alone. */
const COMMENTS = { comments: true };

/** What's open: a thread, a new comment on something, or the wait for something to be pressed. */
export type CommentOpen = { thread: string } | { on: string } | 'picking' | null;

/** What a thread is about, in a line: the words on it, if it has any. */
function quoteOf(o: BoardObject | undefined): string {
  if (!o) return '';
  if (o.k === 'note' || o.k === 'text' || o.k === 'shape' || o.k === 'node') return o.t;
  if (o.k === 'frame') return o.title;
  if (o.k === 'shot') return o.caption;
  return '';
}

/** Something comments can go on: anything with a box, apart from a stroke of ink, which is only a mark. */
const commentable = (o: BoardObject | undefined): o is PlacedObject => o !== undefined && hasBox(o) && o.k !== 'ink';

const unresolvedOn = (threads: readonly BoardThread[], on: string): BoardThread | undefined => threads.find((t) => t.on === on && !t.resolved);

/** What's open, for the pins and the sheet to read, and K to change. */
export class BoardCommentsStore {
  /** The id of the sheet a thread opens in, which its pin says it controls. */
  readonly sheetId: string;
  private open: CommentOpen = null;
  private readonly listeners = new Set<() => void>();
  private readonly board: Board;

  constructor(board: Board, sheetId: string) {
    this.board = board;
    this.sheetId = sheetId;
  }

  getSnapshot = (): CommentOpen => this.open;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  set(open: CommentOpen): void {
    if (open === this.open) return;
    this.open = open;
    this.listeners.forEach((l) => l());
  }

  /** Opens what's said on `on`, or a new comment there: one thread to a thing, so a comment on something talked about joins in. */
  on(id: string, view: BoardView): void {
    const there = unresolvedOn(readThreads(this.board.doc, view), id);
    this.set(there ? { thread: there.id } : { on: id });
  }

  /** K, or More's Comment: on what's picked, what the pointer is on, or else the next thing pressed. */
  start = (): void => {
    const { sel, hover, view } = this.board.getSnapshot();
    const id = sel.length === 1 ? sel[0] : sel.length === 0 ? hover ?? undefined : undefined;
    const on = id === undefined ? undefined : view.byId.get(id);
    if (commentable(on)) this.on(on.id, view);
    else this.set('picking');
  };

  /** Back to the board, with the keyboard on it. */
  close(): void {
    this.set(null);
    this.board.focusSheet();
  }
}

/** How many times each board's comments have changed: a new count is what has them read again. */
const said = new WeakMap<Y.Doc, number>();

/** The threads on what's on the board, read again as comments change, or as what they're on comes and goes. */
function useThreads(board: Board): BoardThread[] {
  const view = useBoardState(board, (s) => s.view);
  const subscribe = useCallback((changed: () => void) => observeComments(board.doc, () => {
    said.set(board.doc, (said.get(board.doc) ?? 0) + 1);
    changed();
  }), [board]);
  const times = useSyncExternalStore(subscribe, () => said.get(board.doc) ?? 0);
  return useMemo(() => readThreads(board.doc, view), [board, view, times]);
}

const useOpen = (store: BoardCommentsStore): CommentOpen => useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

/**
 * A pin, in screen pixels from where it's pinned: it stands over the corner, 6 left of it to 28 right and 30 above it to 6 below
 * (`board.css`). A frame's title and count sit over its top edge, from 8 above it to 36, as wide as the frame and a little more.
 */
const PIN = { left: 6, right: 28, up: 30, down: 6 } as const;
const TITLE = { up: 36, wider: 20 } as const;

/**
 * Whether a pin on this corner would stand over a frame's title or its count. Then it hangs under the corner, inside what it's
 * pinned to, below the frame's top edge. `z` is the camera's zoom: a pin is one size on the screen at any zoom.
 */
function overATitle(x: number, y: number, frames: readonly FrameObject[], z: number): boolean {
  const left = x - PIN.left / z, right = x + PIN.right / z, top = y - PIN.up / z, bottom = y + PIN.down / z;
  return frames.some((f) => left < f.x + f.w + TITLE.wider && right > f.x && top < f.y && bottom > f.y - TITLE.up);
}

/**
 * The pins, in the layer over the board that stays one size, under everyone's pointers. Presenting, only what's on the slide has
 * its pin: nothing points at what nobody can see.
 */
export function CommentPins({ board, store, commenting, mode }: { board: Board; store: BoardCommentsStore; commenting: BoardCommenting; mode: BoardMode }) {
  const view = useBoardState(board, (s) => s.view);
  const presented = useBoardState(board, (s) => s.slide);
  // To the percent, so a pinch draws the pins again only when it has to.
  const z = useSyncExternalStore(board.camera.subscribe, () => Math.round(board.camera.getSnapshot().z * 100) / 100);
  const threads = useThreads(board);
  const open = useOpen(store);
  const shown = open !== null && open !== 'picking' && 'thread' in open ? open.thread : null;
  const slide = mode === 'present' && presented !== null && view.byId.has(presented) ? inSlide(view, presented) : null;
  return threads.flatMap((t) => {
    const o = view.byId.get(t.on);
    const first = t.replies[0];
    if (t.resolved || !first || !commentable(o) || (slide && !slide.has(o.id))) return [];
    const x = o.x + o.w, y = o.y;
    return [<BoardComment key={t.id} id={t.id} x={x} y={y} person={commenting.face(first)} name={first.name || 'Someone'} text={first.text}
      count={t.replies.length - 1} expanded={shown === t.id} controls={store.sheetId} under={overATitle(x, y, view.frames, z || 1)} onOpen={(id) => store.set(shown === id ? null : { thread: id })} />];
  });
}

/** The most of what's commented on that the sheet beside it keeps clear of, in screen pixels: a sticky's worth, at its top right corner. */
const CLEAR = 240;

/**
 * What the sheet beside a comment sits against: the top right of what it's on, as far as a sticky's worth of it, with its pin when it
 * has one. The sheet opens to the right of that, and where there's no room on the right it opens on the left of it rather than over it.
 */
function besideOf(sheet: HTMLElement | null, board: Board, at: CommentOpen, on: string | undefined): DOMRect {
  const box = sheet?.getBoundingClientRect();
  const o = on === undefined ? undefined : board.getSnapshot().view.byId.get(on);
  const pin = at !== null && at !== 'picking' && 'thread' in at ? sheet?.querySelector(`[data-thread="${CSS.escape(at.thread)}"]`)?.getBoundingClientRect() : undefined;
  if (!box || !o || !hasBox(o)) return pin ?? new DOMRect(box?.left ?? 0, box?.top ?? 0, 0, 0);
  const { x, y, z } = board.camera.getSnapshot();
  const right = box.left + (o.x + o.w) * z + x, top = box.top + o.y * z + y;
  const w = Math.min(o.w * z, CLEAR), h = Math.min(o.h * z, CLEAR);
  if (!pin) return new DOMRect(right - w, top, w, h);
  const left = Math.min(right - w, pin.left), up = Math.min(top, pin.top);
  return new DOMRect(left, up, Math.max(right, pin.right) - left, Math.max(top + h, pin.bottom) - up);
}

/** The thread that's open, or a new comment being written, beside what it's on; and while picking, what catches the press. */
export function CommentSheets({ board, sheet, store, commenting }: { board: Board; sheet: () => HTMLElement | null; store: BoardCommentsStore; commenting: BoardCommenting }) {
  const open = useOpen(store);
  return open === null ? null : <Open board={board} sheet={sheet} store={store} commenting={commenting} open={open} />;
}

function Open({ board, sheet, store, commenting, open }: { board: Board; sheet: () => HTMLElement | null; store: BoardCommentsStore; commenting: BoardCommenting; open: Exclude<CommentOpen, null> }) {
  const view = useBoardState(board, (s) => s.view);
  const threads = useThreads(board);
  const [words, setWords] = useState('');
  const key = open === 'picking' ? '' : 'thread' in open ? open.thread : open.on;
  useEffect(() => { setWords(''); }, [key]);
  const { me } = commenting;

  // A thread, or what a comment's being written on, that goes while it's open takes its sheet with it.
  const gone = open !== 'picking' && ('on' in open ? !view.byId.has(open.on) : !threads.some((t) => t.id === open.thread && !t.resolved));
  useEffect(() => { if (gone) store.set(null); }, [gone, store]);

  // Picking: Esc stops it, from anywhere.
  useEffect(() => {
    if (open !== 'picking') return undefined;
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      store.close();
    };
    addEventListener('keydown', esc, true);
    return () => removeEventListener('keydown', esc, true);
  }, [open, store]);

  if (open === 'picking') {
    const pick = (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const under = document.elementsFromPoint(e.clientX, e.clientY).find((el) => !el.closest('.bo-pick') && el.closest('[data-id]'));
      const id = under?.closest('[data-id]')?.getAttribute('data-id') ?? undefined;
      const o = id === undefined ? undefined : view.byId.get(id);
      if (commentable(o)) store.on(o.id, view);
      else store.close();
    };
    return <div className="bo-pick" onPointerDown={pick} />;
  }
  if (gone) return null;
  const close = (to: boolean) => { if (!to) store.close(); };
  const on = 'on' in open ? open.on : threads.find((t) => t.id === open.thread)?.on;
  const at = () => besideOf(sheet(), board, open, on);

  if ('on' in open) {
    if (!me) return null;
    const send = () => {
      const text = words.trim();
      if (!text) return;
      store.set({ thread: addThread(board.doc, open.on, text, me, COMMENTS) });
    };
    return (
      <WsPopover id={store.sheetId} open onOpenChange={close} at={at} side="right" align="start" label="Comment">
        <WsCommentCompose quote={quoteOf(view.byId.get(open.on))} person={commenting.person} value={words} onChange={setWords} onSend={send} />
      </WsPopover>
    );
  }

  const thread = threads.find((t) => t.id === open.thread);
  if (!thread) return null;
  const messages = thread.replies.map((r): WsComment => ({ id: r.id, person: commenting.face(r), name: firstName(r.name || 'Someone'), text: r.text }));
  const reply = me ? () => {
    const text = words.trim();
    if (!text) return;
    addReply(board.doc, thread.id, text, me, COMMENTS);
    setWords('');
  } : undefined;
  const resolve = me ? () => {
    resolveThread(board.doc, thread.id, true, COMMENTS);
    store.close();
    commenting.onResolved?.(() => resolveThread(board.doc, thread.id, false, COMMENTS));
  } : undefined;
  return (
    <WsPopover id={store.sheetId} open onOpenChange={close} at={at} side="right" align="start" label="Comment">
      <WsCommentThread quote={quoteOf(view.byId.get(thread.on))} messages={messages} value={words} onChange={setWords} onSend={reply} onResolve={resolve} />
    </WsPopover>
  );
}
