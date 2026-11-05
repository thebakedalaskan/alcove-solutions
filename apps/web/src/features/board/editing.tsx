/*
 * Typing on the board. A textarea over the object, bound to its Y.Text: what you type goes into the Y.Text as the smallest
 * change that explains it, and what others type comes back in with your caret carried past it, so two people can write in
 * one sticky. It always shows the Y.Text, never the view, because the view cuts text past the limit and this is where
 * someone can see and fix all of it. Keys stop here: letters are letters, and nothing on the call or the board hears them.
 */
import { BOARD_LIMITS, difference, objectText, observeBoard, type BoardView, type PlacedObject, type TextChange } from '@alcove/board';
import { BoardEdit } from '@alcove/ui';
import { useLayoutEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { Board } from './useBoard';

/** A sticky's side. */
export const STICKY = 150;
/** The gap Tab leaves between one sticky and the next. */
const NEXT_GAP = 20;
/** How long after the last key someone has stopped typing into nothing. */
const KEYS_STOP_MS = 1200;

/** What Y.Text says changed. */
type TextDelta = readonly { retain?: number | undefined; insert?: unknown; delete?: number | undefined }[];

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
export function bindText(el: HTMLTextAreaElement, text: Y.Text, origin: unknown): { flush: () => void; stop: () => void } {
  const doc = text.doc;
  if (!doc) return { flush: () => undefined, stop: () => undefined };
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
  const composeStart = (): void => {
    composing = true;
    // The word replaces what's selected, so that goes now, as it does in the field. Whatever someone types there meanwhile then stays.
    const { selectionStart: from, selectionEnd: to } = el;
    if (from === to) return;
    write({ start: from, remove: to - from, insert: '' });
    shown = shown.slice(0, from) + shown.slice(to);
  };
  const composeEnd = (): void => {
    composing = false;
    const change = difference(shown, el.value, el.selectionStart);
    const start = missed.reduce(carriedBy, change.start);
    const end = missed.reduce(carriedBy, change.start + change.remove);
    missed = [];
    write({ start, remove: end - start, insert: change.insert });
    const caret = start + change.insert.length;
    show(caret, caret);
  };
  const flush = (): void => { if (composing) composeEnd(); };
  const changed = (event: Y.YTextEvent): void => {
    if (mine) return;
    if (composing) missed.push(event.delta);
    else show(carriedBy(el.selectionStart, event.delta), carriedBy(el.selectionEnd, event.delta), el.selectionDirection ?? undefined);
  };

  el.addEventListener('input', typed);
  el.addEventListener('compositionstart', composeStart);
  el.addEventListener('compositionend', composeEnd);
  text.observe(changed);
  return {
    flush,
    stop() {
      flush();
      el.removeEventListener('input', typed);
      el.removeEventListener('compositionstart', composeStart);
      el.removeEventListener('compositionend', composeEnd);
      text.unobserve(changed);
    }
  };
}

/**
 * Somewhere for keys to go when a field closes under someone still typing, who can't have noticed yet. Focus would drop to
 * the page, where M, V and C are the call's, so the rest of a word could turn their microphone on. The sheet won't do, because
 * those keys pass through it. So focus waits in a hidden field, which the call leaves alone, until the keys stop or something
 * is pressed. It's on the page rather than the board, because the board may be what's closing.
 */
export function holdKeys(then: () => void): void {
  const el = document.createElement('textarea');
  const listening = new AbortController();
  const { signal } = listening;
  let wait: ReturnType<typeof setTimeout> | undefined;
  const stop = (): void => {
    clearTimeout(wait);
    listening.abort();
    el.remove();
  };
  const done = (): void => {
    then();
    stop();
  };
  const carryOn = (): void => {
    clearTimeout(wait);
    wait = setTimeout(done, KEYS_STOP_MS);
  };
  el.className = 'sr-only';
  el.tabIndex = -1;
  el.setAttribute('aria-label', 'The sticky you were typing in has closed');
  el.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') done();
    else carryOn();
  }, { signal });
  // As with a field, switching windows leaves it active. Anything else taking focus means it's no longer needed.
  el.addEventListener('blur', () => { if (document.activeElement !== el) stop(); }, { signal });
  addEventListener('pointerdown', stop, { capture: true, signal });
  document.body.append(el);
  el.focus({ preventScroll: true });
  carryOn();
}

/** The textarea for one object, focused with the caret at the end, as it opens. */
export function BoardTyping({ board, id, label }: { board: Board; id: string; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    let text = objectText(board.doc, id);
    if (!el || !text) return undefined;
    let binding = bindText(el, text, board.origin);
    // Undo makes a deleted object again with a new Y.Text. Someone can be typing in it, and a reconnect can bring the delete and the undo at once, so nothing closes this field: without following, what they type next would go nowhere.
    const follow = (): void => {
      const now = objectText(board.doc, id);
      if (!now || now === text) return;
      binding.stop();
      text = now;
      binding = bindText(el, now, board.origin);
    };
    const stopFollowing = observeBoard(board.doc, follow);
    board.flushTyping = () => binding.flush();
    const key = (e: KeyboardEvent): void => {
      // ⌘ and Ctrl shortcuts aren't typing, so they're the app's as usual. Anything else goes no further than this field.
      if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
      if (e.isComposing) return;
      if (e.key === 'Escape') {
        board.finishEdit();
        board.focusSheet();
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        board.nextSticky();
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
      board.flushTyping = null;
      stopFollowing();
      binding.stop();
      el.removeEventListener('keydown', key);
      el.removeEventListener('blur', blur);
    };
  }, [board, id]);
  return <BoardEdit ref={ref} label={label} maxLength={BOARD_LIMITS.text} />;
}

/** Where Tab puts the next sticky: to the right, or at the start of the next row when the frame it's in runs out. */
export function nextSpot(view: BoardView, o: PlacedObject): { x: number; y: number } {
  const x = o.x + o.w + NEXT_GAP;
  const frame = view.byId.get(o.f);
  if (frame?.k === 'frame' && x + STICKY > frame.x + frame.w) return { x: frame.x + NEXT_GAP, y: o.y + o.h + NEXT_GAP };
  return { x, y: o.y };
}
