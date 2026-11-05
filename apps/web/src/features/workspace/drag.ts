/*
 * Dragging a row in the list. It lifts after 5 px and follows the pointer; between two rows a line shows the spot, over the
 * middle of a folder the folder lights up, and pausing there opens a closed one. Esc puts it back. Touch scrolls the list,
 * so rows don't drag on a phone: Move to… does that.
 */
import type { IconName } from '@alcove/ui';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { foldersAbove, isWithin, nameOf, landing, type DropSide, type Tree } from './tree';
import type { ItemPlace } from '@alcove/api';

const LIFT_PX = 5;
const OPEN_MS = 650;
/** How close to the top or bottom of the list the pointer gets before it scrolls, and how far it scrolls each frame. */
const EDGE_PX = 28;
const SCROLL_PX = 7;

/** Where a drag would land, and what shows it. */
export type DropSpot =
  | { kind: 'place'; to: ItemPlace; line: { top: number; left: number } | null; into: string | null }
  | { kind: 'trash' }
  | { kind: 'bring' };

export interface RowDrag { id: string; icon: IconName; label: string; x: number; y: number; spot: DropSpot | null }

interface Armed { id: string; x: number; y: number }

/** What's under the pointer, for a row that's moving. */
function spotAt(t: Tree, moving: string, x: number, y: number, canBring: boolean): DropSpot | null {
  const under = document.elementFromPoint(x, y);
  if (!under) return null;
  if (under.closest('[data-trash]')) return { kind: 'trash' };
  // This call's part of the list is what's brought to it, in the order it came: a document dropped there comes to the call.
  if (canBring && under.closest('[data-sec="pins"], [data-row][data-area="pins"]')) return t.all.get(moving)?.kind === 'document' ? { kind: 'bring' } : null;
  const row = under.closest<HTMLElement>('[data-row]');
  if (!row) {
    const list = under.closest('.wt-scroll');
    const rows = list?.querySelectorAll<HTMLElement>('[data-row]');
    const last = rows?.[rows.length - 1];
    if (!list || !last) return null;
    return { kind: 'place', to: { parent: null }, line: { top: last.offsetTop + last.offsetHeight, left: 12 }, into: null };
  }
  const id = row.dataset['row'];
  const target = id === undefined ? undefined : t.all.get(id);
  if (!target || isWithin(t, target.id, moving)) return null;
  const box = row.getBoundingClientRect();
  const at = (y - box.top) / box.height;
  const folder = target.kind === 'folder';
  const side: DropSide = folder && at > 0.28 && at < 0.72 ? 'inside' : at < 0.5 ? 'before' : 'after';
  if (side === 'inside') return { kind: 'place', to: landing(t, moving, target.id, side), line: null, into: target.id };
  const depth = foldersAbove(t, target.id).length;
  const top = row.offsetTop + (side === 'after' ? row.offsetHeight : 0);
  // Under an open folder, what's next is what's in it.
  if (side === 'after' && row.getAttribute('aria-expanded') === 'true') return { kind: 'place', to: { parent: target.id, after: null }, line: { top, left: 12 + (depth + 1) * 16 }, into: null };
  return { kind: 'place', to: landing(t, moving, target.id, side), line: { top, left: 12 + depth * 16 }, into: null };
}

export function useRowDrag({ tree, canDrag, canBring = false, onDrop, onOpenFolder }: {
  tree: Tree; canDrag: (id: string) => boolean;
  /** In a call: a row can be dropped on This call. */
  canBring?: boolean | undefined;
  onDrop: (id: string, spot: DropSpot) => void; onOpenFolder: (id: string) => void;
}) {
  const [drag, setDrag] = useState<RowDrag | null>(null);
  const armed = useRef<Armed | null>(null);
  const moving = useRef<RowDrag | null>(null);
  const justDropped = useRef(false);
  const said = useRef({ tree, canBring, onDrop, onOpenFolder });
  said.current = { tree, canBring, onDrop, onOpenFolder };

  useEffect(() => {
    let pause: { id: string; timer: ReturnType<typeof setTimeout> } | null = null;
    let frame = 0;
    const show = (d: RowDrag | null) => { moving.current = d; setDrag(d); };
    const stopPause = () => { if (pause) { clearTimeout(pause.timer); pause = null; } };
    const stop = () => {
      armed.current = null;
      stopPause();
      cancelAnimationFrame(frame);
      frame = 0;
      document.documentElement.classList.remove('ws-dragging');
      show(null);
    };
    const place = (x: number, y: number) => {
      const d = moving.current;
      if (!d) return;
      const spot = spotAt(said.current.tree, d.id, x, y, said.current.canBring);
      const into = spot?.kind === 'place' ? spot.into : null;
      if (pause?.id !== into) {
        stopPause();
        if (into) pause = { id: into, timer: setTimeout(() => { said.current.onOpenFolder(into); }, OPEN_MS) };
      }
      show({ ...d, x, y, spot });
    };
    /** Near the top or bottom of the list, it scrolls by itself while the pointer waits there. */
    const edges = () => {
      frame = 0;
      const d = moving.current;
      const list = document.querySelector('.wt-scroll');
      if (!d || !list) return;
      const box = list.getBoundingClientRect();
      const by = d.x < box.left || d.x > box.right ? 0 : d.y < box.top + EDGE_PX ? -SCROLL_PX : d.y > box.bottom - EDGE_PX ? SCROLL_PX : 0;
      if (by === 0) return;
      list.scrollTop += by;
      place(d.x, d.y);
      frame = requestAnimationFrame(edges);
    };
    const move = (e: PointerEvent) => {
      const a = armed.current;
      if (!a) return;
      // The button came up somewhere this page couldn't hear it.
      if (e.buttons === 0) { stop(); return; }
      if (!moving.current) {
        if (Math.abs(e.clientX - a.x) + Math.abs(e.clientY - a.y) < LIFT_PX) return;
        const item = said.current.tree.all.get(a.id);
        if (!item) { stop(); return; }
        moving.current = { id: a.id, icon: item.kind === 'folder' ? 'folder' : 'fileText', label: nameOf(item), x: e.clientX, y: e.clientY, spot: null };
        document.documentElement.classList.add('ws-dragging');
      }
      place(e.clientX, e.clientY);
      if (!frame) frame = requestAnimationFrame(edges);
    };
    const up = () => {
      const d = moving.current;
      stop();
      if (!d) return;
      // The click that ends a drag isn't a click on the row.
      justDropped.current = true;
      setTimeout(() => { justDropped.current = false; }, 60);
      if (d.spot) said.current.onDrop(d.id, d.spot);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !moving.current) return;
      e.preventDefault();
      e.stopPropagation();
      stop();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('keydown', key, true);
    return () => {
      stop();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('keydown', key, true);
    };
  }, []);

  return {
    drag,
    /** Where a drag can start: a row, but not its buttons. */
    arm: (e: ReactPointerEvent<HTMLElement>, id: string) => {
      if (e.button !== 0 || e.pointerType === 'touch' || !canDrag(id)) return;
      if (e.target instanceof Element && e.target.closest('.wt-acts, .wt-f, input')) return;
      armed.current = { id, x: e.clientX, y: e.clientY };
    },
    /** Whether a click is really the end of a drag. */
    ended: () => justDropped.current
  };
}
