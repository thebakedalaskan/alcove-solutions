/*
 * Typing on the board. A textarea over the object, bound to its Y.Text: what you type goes into the Y.Text as the smallest
 * change that explains it, and what others type comes back in with your caret carried past it, so two people can write in
 * one sticky. It always shows the Y.Text, never the view, because the view cuts text past the limit and this is where
 * someone can see and fix all of it. Keys stop here: letters are letters, and nothing on the call or the board hears them.
 */
import { BOARD_LIMITS, objectText, type BoardObject, type BoardView, type PlacedObject } from '@alcove/board';
import { BoardEdit } from '@alcove/ui';
import { useLayoutEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { Board } from './useBoard';

/** A sticky's side. */
export const STICKY = 150;
/** The gap Tab leaves between one sticky and the next. */
const NEXT_GAP = 20;

interface TextChange {
  start: number;
  remove: number;
  insert: string;
}

/** What Y.Text says changed. */
type TextDelta = readonly { retain?: number | undefined; insert?: unknown; delete?: number | undefined }[];

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/**
 * The smallest change that turns `was` into `now`. The caret says where it ended, which settles what a prefix and suffix
 * alone can't, such as which of three a's was just typed. It never stops inside a surrogate pair: Yjs would have to replace
 * the half it was left with, and an emoji would turn into a box for everyone.
 */
export function difference(was: string, now: string, caret: number): TextChange {
  const tailRoom = Math.min(was.length, Math.max(0, now.length - caret));
  let tail = 0;
  while (tail < tailRoom && was.charCodeAt(was.length - 1 - tail) === now.charCodeAt(now.length - 1 - tail)) tail += 1;
  const headRoom = Math.min(was.length, now.length) - tail;
  let head = 0;
  while (head < headRoom && was.charCodeAt(head) === now.charCodeAt(head)) head += 1;
  if (head > 0 && isHighSurrogate(was.charCodeAt(head - 1))) head -= 1;
  if (tail > 0 && isLowSurrogate(was.charCodeAt(was.length - tail))) tail -= 1;
  return { start: head, remove: was.length - head - tail, insert: now.slice(head, now.length - tail) };
}

/** Where a place in the text has got to after a change someone else made. Text they add right at the caret goes after it, so two people typing at one spot don't shuffle together. */
function carriedBy(place: number, delta: TextDelta): number {
  let at = 0, now = place;
  for (const op of delta) {
    if (op.retain) at += op.retain;
    else if (op.delete) { if (at < now) now -= Math.min(op.delete, now - at); }
    else if (typeof op.insert === 'string') {
      if (at < now) now += op.insert.length;
      at += op.insert.length;
    }
  }
  return now;
}

/**
 * Keeps a textarea and a Y.Text the same until the returned function is called. While a word is being composed, as an IME
 * or a dead key does, the browser owns the field: writing to it would break the word. So what others type meanwhile
 * waits, and the finished word goes in where it now belongs.
 */
export function bindText(el: HTMLTextAreaElement, text: Y.Text, origin: unknown): () => void {
  const doc = text.doc;
  if (!doc) return () => undefined;
  let shown = text.toString(), composing = false, mine = false;
  let missed: TextDelta[] = [];
  el.value = shown;

  const write = ({ start, remove, insert }: TextChange): void => {
    if (!remove && !insert) return;
    mine = true;
    doc.transact(() => {
      if (remove) text.delete(start, remove);
      if (insert) text.insert(start, insert);
    }, origin);
    mine = false;
  };
  const show = (start: number, end: number, direction?: 'forward' | 'backward' | 'none'): void => {
    const top = el.scrollTop;
    shown = text.toString();
    el.value = shown;
    el.setSelectionRange(start, end, direction);
    el.scrollTop = top;
  };

  const typed = (): void => {
    if (composing) return;
    const change = difference(shown, el.value, el.selectionStart);
    shown = el.value;
    write(change);
  };
  const composeStart = (): void => { composing = true; };
  const composeEnd = (): void => {
    composing = false;
    const change = difference(shown, el.value, el.selectionStart);
    const start = missed.reduce(carriedBy, change.start);
    missed = [];
    write({ ...change, start });
    const caret = start + change.insert.length;
    show(caret, caret);
  };
  const changed = (event: Y.YTextEvent): void => {
    if (mine) return;
    if (composing) missed.push(event.delta);
    else show(carriedBy(el.selectionStart, event.delta), carriedBy(el.selectionEnd, event.delta), el.selectionDirection ?? undefined);
  };

  el.addEventListener('input', typed);
  el.addEventListener('compositionstart', composeStart);
  el.addEventListener('compositionend', composeEnd);
  text.observe(changed);
  return () => {
    el.removeEventListener('input', typed);
    el.removeEventListener('compositionstart', composeStart);
    el.removeEventListener('compositionend', composeEnd);
    text.unobserve(changed);
  };
}

/** Which of an object's fields is typed in: a frame has a title. */
export const textField = (o: BoardObject | undefined): 't' | 'title' => (o?.k === 'frame' ? 'title' : 't');

/** The textarea for one object, focused with the caret at the end, as it opens. `field` says what it writes in, and a `title` keeps to one line. */
export function BoardTyping({ board, id, label, field = 't' }: { board: Board; id: string; label: string; field?: 't' | 'title' | undefined }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current, text = objectText(board.doc, id, field);
    if (!el || !text) return undefined;
    const stop = bindText(el, text, board.origin);
    const key = (e: KeyboardEvent): void => {
      // ⌘ and Ctrl shortcuts aren't typing, so they're the app's as usual. Anything else goes no further than this field.
      if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
      if (e.isComposing) return;
      if (e.key === 'Escape' || (e.key === 'Enter' && field === 'title')) {
        e.preventDefault();
        board.finishEdit();
        board.focusSheet();
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        if (field === 'title') {
          board.finishEdit();
          board.focusSheet();
        } else {
          board.nextSticky();
        }
      }
    };
    // Switching to another window takes focus but leaves this field active. You'd expect to come back and carry on.
    const blur = (): void => { if (document.activeElement !== el) board.finishEdit(); };
    el.addEventListener('keydown', key);
    el.addEventListener('blur', blur);
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    el.scrollTop = el.scrollHeight;
    return () => {
      stop();
      el.removeEventListener('keydown', key);
      el.removeEventListener('blur', blur);
    };
  }, [board, id, field]);
  return <BoardEdit ref={ref} label={label} rows={1} maxLength={BOARD_LIMITS.text} />;
}

/** Where Tab puts the next sticky: to the right, or at the start of the next row when the frame it's in runs out. */
export function nextSpot(view: BoardView, o: PlacedObject): { x: number; y: number } {
  const x = o.x + o.w + NEXT_GAP;
  const frame = view.byId.get(o.f);
  if (frame?.k === 'frame' && x + STICKY > frame.x + frame.w) return { x: frame.x + NEXT_GAP, y: o.y + o.h + NEXT_GAP };
  return { x, y: o.y };
}
