/*
 * Where the keys go as what's on your stage changes under them. A frame closing, a tile becoming its frame, Present bringing the
 * pager: whatever had the keys goes or hides, and without this they'd fall to the page, so the next Tab would start from its top.
 * Each of those changes says where they go instead, and they go there as soon as it's drawn, unless they've gone somewhere else
 * meanwhile (you pressed or tabbed on). `from` is what's going: keys still in it go too, and keys anywhere else stay, so
 * Workspace at the top right closing the workspace keeps them, where Close on its bar hands them on.
 */
import { useCallback, useEffect, useRef } from 'react';
import { isScreen, type ThingId } from './onStage';

export type KeysTo =
  /** Into its frame, which says what it is: its bar and what's in it come next with Tab. */
  | { to: 'frame'; id: ThingId }
  /** Its tile with the people, which takes you back to it. */
  | { to: 'tile'; id: ThingId }
  /** Next frame on the pager of the board you present, so → moves it on: on a board with no frames, which has none, the board. */
  | { to: 'pager' }
  /** What opens it again: Board or Workspace at the top right (More on a phone), or Share for your own screen. */
  | { to: 'opener'; id: ThingId };

/** How long a change waits for where its keys go to be drawn: a frame rising, the pager once the call says you present. */
const WAIT_MS = 2500;

const shown = (el: Element | null): el is HTMLElement => el instanceof HTMLElement && el.isConnected && el.closest('[inert]') === null && el.getClientRects().length > 0;
const frameBox = (id: ThingId) => document.querySelector(`.ic-framebox[data-thing="${CSS.escape(id)}"]:not([inert])`);

function find(to: KeysTo, phone: boolean): HTMLElement | null {
  if (to.to === 'frame') return frameBox(to.id)?.querySelector<HTMLElement>('[data-frame]') ?? null;
  if (to.to === 'tile') return document.querySelector<HTMLElement>(`.ic-stage [data-tile="${CSS.escape(to.id)}"]`);
  if (to.to === 'pager') {
    const box = frameBox('board');
    const pager = box?.querySelector('[data-pager]');
    if (pager) return pager.querySelector<HTMLElement>('[aria-label="Next frame"]:not([aria-disabled="true"])') ?? pager.querySelector<HTMLElement>('[aria-label="Back a frame"]');
    // Presented with no frames, the board has no pager to wait for (`data-no-pager`): the keys go to the board itself.
    return box?.querySelector<HTMLElement>('[data-no-pager] [role="application"]') ?? null;
  }
  if (isScreen(to.id)) return document.querySelector<HTMLElement>('.ic-dockbar [data-share]');
  if (phone) return document.querySelector<HTMLElement>('.ic-dockbar [data-more]');
  return document.querySelector<HTMLElement>(`.ic-top [data-open="${to.id === 'ws' ? 'ws' : 'board'}"]`);
}

/** `land(to, from)`: the keys go to `to` once it's drawn, if they're lost by then, or still in `from` (what's going). */
export function useLandKeys(phone: boolean) {
  const pending = useRef<{ to: KeysTo; from: Element | null; until: number } | null>(null);
  const raf = useRef(0);
  const phoneNow = useRef(phone);
  phoneNow.current = phone;
  const tick = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    const now = document.activeElement;
    const free = now === null || now === document.body || !shown(now) || (p.from !== null && p.from.contains(now));
    if (!free || performance.now() > p.until) { pending.current = null; return; }
    const el = find(p.to, phoneNow.current);
    if (shown(el)) {
      el.focus({ preventScroll: true });
      if (document.activeElement === el) { pending.current = null; return; }
    }
    raf.current = requestAnimationFrame(tick);
  }, []);
  const land = useCallback((to: KeysTo, from: Element | null = null) => {
    cancelAnimationFrame(raf.current);
    pending.current = { to, from, until: performance.now() + WAIT_MS };
    raf.current = requestAnimationFrame(tick);
  }, [tick]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return land;
}

/** What on your stage holds the keys now, a frame or a tile, if anything does: what a change to it lets go of. */
export const holding = (): Element | null => document.activeElement?.closest('.ic-framebox, [data-tile]') ?? null;
