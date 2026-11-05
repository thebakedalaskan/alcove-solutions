/*
 * The handles beside a block and dragging by them. One gutter follows the pointer, so hundreds of blocks don't each
 * carry their own, and it stays out of the text the caret moves through. A drag is pointer events, not the browser's
 * drag and drop: the block's dots follow the pointer, a line shows where it lands, and it moves for everyone only on
 * letting go. Past the page, `blockDrop` decides, because a block can land on a document in the list.
 */
import { Avatar, Icon, cn } from '@alcove/ui';
import type { EditorView } from 'prosemirror-view';
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { addBelow, departure, movingBlock } from '../actions';
import { allBlocks, findBlock, scrollerOf } from '../commands';
import { useStore } from '../menus/Menus';
import { decorChange } from '../plugins/decor';
import { moveBlock } from '../plugins/retire';
import type { DragState, EditorRuntime } from '../runtime';
import { headingLevel, indentAttr, isListLine, lineKind, schema } from '../schema';
import type { MovingBlock, Point } from '../types';

/** How far the pointer goes before a press on the dots is a drag. */
const DRAG_FROM = 5;
const INDENT = 26;
/** How near an edge of the page the pointer has to be to scroll it. */
const SCROLL_EDGE = 56;

/** The space between blocks nearest a height on the window, and what's either side of it. */
export function landing(rt: EditorRuntime, y: number): { line: number; id: string; side: 'before' | 'after' } | null {
  const view = rt.view, root = rt.root;
  if (!view || !root) return null;
  const top = root.getBoundingClientRect().top;
  let last: { id: string; bottom: number } | null = null;
  for (const b of allBlocks(view.state.doc)) {
    const dom = view.nodeDOM(b.pos);
    if (!(dom instanceof Element) || !b.id) continue;
    const box = dom.getBoundingClientRect();
    if (y < box.top + box.height / 2) return { line: box.top - top, id: b.id, side: 'before' };
    last = { id: b.id, bottom: box.bottom };
  }
  return last ? { line: last.bottom - top, id: last.id, side: 'after' } : null;
}

function useDrag(rt: EditorRuntime) {
  return (e: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    const view = rt.view;
    const moving: MovingBlock | null = view ? movingBlock(view.state, id) : null;
    if (e.button !== 0 || !view || !moving) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const from: Point = { x: e.clientX, y: e.clientY };
    let at = from;
    let frame = 0;
    let wasOutside = false;
    const scroller = scrollerOf(view.dom);
    handle.setPointerCapture(e.pointerId);

    const place = (point: Point) => {
      at = point;
      const outside = rt.props.blockDrop?.over(point, moving) === true;
      if (wasOutside && !outside) rt.props.blockDrop?.leave();
      wasOutside = outside;
      const pane = (scroller ?? rt.root)?.getBoundingClientRect();
      const inPane = pane && point.x >= pane.left - 80 && point.x <= pane.right && point.y >= pane.top && point.y <= pane.bottom;
      const spot = outside || !inPane ? null : landing(rt, point.y);
      const here = spot && spot.id !== id ? spot : null;
      const next: DragState = { block: moving, at: point, line: here?.line ?? null, target: here ? { id: here.id, side: here.side } : null, outside };
      rt.drag.set(next);
    };

    /* A long document scrolls under the block while the pointer waits at its edge. */
    const creep = () => {
      /* Someone else deleted it: there's nothing left to drag. */
      if (view.isDestroyed || !findBlock(view.state.doc, id)) { finish(false); return; }
      frame = requestAnimationFrame(creep);
      if (!scroller) return;
      const box = scroller.getBoundingClientRect();
      const near = at.y < box.top + SCROLL_EDGE ? at.y - box.top - SCROLL_EDGE : at.y > box.bottom - SCROLL_EDGE ? at.y - box.bottom + SCROLL_EDGE : 0;
      if (near === 0) return;
      scroller.scrollTop += near / 4;
      place(at);
    };

    const onMove = (m: PointerEvent) => {
      if (!rt.drag.get()) {
        if (Math.abs(m.clientX - from.x) + Math.abs(m.clientY - from.y) < DRAG_FROM) return;
        rt.menu.set(null);
        rt.bar.set(null);
        view.dispatch(decorChange(view.state.tr, { ghost: id }));
        frame = requestAnimationFrame(creep);
      }
      place({ x: m.clientX, y: m.clientY });
    };

    const finish = (commit: boolean) => {
      rt.endDrag = null;
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      cancelAnimationFrame(frame);
      const drag = rt.drag.get();
      if (!drag) {
        if (commit) rt.menu.set({ kind: 'block', block: id, rect: handle.getBoundingClientRect() });
        return;
      }
      rt.drag.set(null);
      if (!view.isDestroyed) view.dispatch(decorChange(view.state.tr, { ghost: null }));
      if (drag.outside) {
        const drop = rt.props.blockDrop;
        /* What lands is what's there now: someone may have been typing in it all this time. */
        const leaving = commit ? departure(rt, id) : null;
        if (drop && leaving) void Promise.resolve(drop.drop(drag.at, leaving.moving)).then((gone) => { if (gone) leaving.arrived(); });
        drop?.leave();
      } else if (commit && drag.target) moveBlock(rt, id, drag.target.id, drag.target.side);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (k: KeyboardEvent) => {
      if (k.key !== 'Escape') return;
      k.preventDefault();
      k.stopPropagation();
      finish(false);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    rt.endDrag = () => finish(false);
  };
}

/** Where the handles sit beside a block, in the canvas's terms: at its top, and moved in with a list's indent. */
function gutterAt(view: EditorView, root: HTMLElement, id: string): { top: number; left: number } | null {
  const ref = findBlock(view.state.doc, id);
  const dom = ref ? view.nodeDOM(ref.pos) : null;
  if (!ref || !(dom instanceof HTMLElement)) return null;
  const box = dom.getBoundingClientRect(), page = root.getBoundingClientRect();
  const indented = isListLine(ref.node) || ref.node.type === schema.nodes.toggle;
  const lower = lineKind(ref.node) === 'heading' && headingLevel(ref.node) === 1 ? 4 : 1;
  return { top: box.top - page.top + lower, left: box.left - page.left + (indented ? indentAttr(ref.node) * INDENT : 0) };
}

export function Handles({ rt, root }: { rt: EditorRuntime; root: HTMLElement | null }) {
  const hover = useStore(rt.hover);
  const drag = useStore(rt.drag);
  const layout = useStore(rt.layout);
  const start = useDrag(rt);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  /* Stays through a fade out, so the handles don't jump as they go. */
  const shown = useRef<string | null>(null);
  if (hover) shown.current = hover;

  useEffect(() => {
    if (!root) return;
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || rt.drag.get() || !(e.target instanceof Element)) return;
      if (e.target.closest('.wb-gut')) return;
      rt.hover.set(e.target.closest('.wb[data-b]')?.getAttribute('data-b') ?? null);
    };
    const leave = () => rt.hover.set(null);
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerleave', leave);
    return () => {
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerleave', leave);
    };
  }, [root, rt]);

  useLayoutEffect(() => {
    const view = rt.view;
    if (view && root && hover) setAt(gutterAt(view, root, hover));
  }, [hover, layout, root, rt]);

  const id = shown.current;
  return (
    <>
      {!rt.readOnly && at && id && (
        <div className={cn('wb-gut', hover && !drag && 'is-on')} style={{ top: at.top, left: at.left }} onMouseDown={(e) => e.preventDefault()}>
          <button type="button" className="wb-add" aria-label="Add a block" onClick={() => addBelow(rt, id)}><Icon name="plus" size={15} /></button>
          <button type="button" className="wb-grip" aria-label="Drag to move, click for options" onPointerDown={(e) => start(e, id)}><Icon name="grip" size={15} /></button>
        </div>
      )}
      {drag && drag.line !== null && <span className="wb-line" style={{ top: drag.line }} />}
    </>
  );
}

/** Other people's carets: one horizon colour, told apart by face and name. */
export function Carets({ rt, root }: { rt: EditorRuntime; root: HTMLElement | null }) {
  const carets = useStore(rt.carets);
  const width = root?.clientWidth ?? 0;
  return (
    <>
      {carets.map((c) => (
        <span key={c.client} className={cn('wb-rc', c.tag && 'is-tag', width > 0 && c.left > width - 110 && 'is-flip')} style={{ top: c.top, left: c.left, height: c.height }} aria-hidden="true">
          <i />
          <em>{c.person ? <Avatar person={c.person} size={14} /> : <Avatar person={{ name: c.name }} size={14} />}{c.name}</em>
        </span>
      ))}
    </>
  );
}

/** A line showing where files from the desktop will land. */
export function FileLine({ rt }: { rt: EditorRuntime }) {
  const drag = useStore(rt.fileDrag);
  return drag && <span className="wb-line is-file" style={{ top: drag.line }}><em>Drop to add here</em></span>;
}
