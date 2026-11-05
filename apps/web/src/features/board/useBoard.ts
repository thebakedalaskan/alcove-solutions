/*
 * One person's board: its doc, and everything about them that isn't in it, such as what they've selected, what they're
 * typing in, their tool and their undo. It's a plain object that gestures and keys call into, and components read slices
 * of it, because most of what happens here happens every frame and React should hear only about what changes the drawing.
 *
 * Other people's changes are read once a frame. Your own are read at once, so what you did is on the sheet when you next
 * look. `readBoard` keeps the identity of whatever didn't change, which is what lets one move draw one object again.
 */
import type { LiveStore } from '@alcove/api';
import {
  BOARD_OBJECTS, addObject, bounds, colourIn, duplicateObjects, frameAt, hasBox, makeUndo, objectText, observeBoard, readBoard, removeObjects,
  type BoardView, type Box, type Camera, type Pad, type StickyColour
} from '@alcove/board';
import type { BoardTool } from '@alcove/ui';
import { useMemo, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { log as rootLog } from '~/lib/log';
import { BoardCameraStore, tokenMs, type BoardPlace, type SheetPoint } from './camera';
import { STICKY, nextSpot } from './editing';
import { MOUNT_ALL, NO_GUIDES, everything, reachHolds, reachOf, sameIds, type Guide } from './selection';

const log = rootLog.child({ component: 'board' });

export type BoardMode = 'call' | 'page' | 'tile' | 'present' | 'phone' | 'read';

/** What each mode has. */
export interface BoardLook {
  /** The bar along the top of the sheet. */
  bar: boolean;
  /** The tools beside it. */
  rail: boolean;
  /** Whether anything can be changed. Without it, a drag moves the board around. */
  edit: boolean;
  /** No dots on the sheet. */
  clean: boolean;
  page: boolean;
  phone: boolean;
  /** A picture of the board: it can't be pressed, and always shows all of it. */
  mini: boolean;
}

const LOOK: BoardLook = { bar: true, rail: true, edit: true, clean: false, page: false, phone: false, mini: false };
const BARE: BoardLook = { ...LOOK, bar: false, rail: false, edit: false, clean: true };

export const BOARD_LOOKS: Record<BoardMode, BoardLook> = {
  call: LOOK,
  page: { ...LOOK, page: true },
  read: { ...LOOK, rail: false, edit: false },
  present: BARE,
  tile: { ...BARE, mini: true },
  phone: { ...BARE, page: true, phone: true }
};

export interface BoardState {
  view: BoardView;
  tool: BoardTool;
  /** The colour picked on the sticky tool, which a sticky takes where no frame says otherwise. */
  colour: StickyColour;
  sel: readonly string[];
  /** What's being typed in. */
  edit: string | null;
  /** The box being dragged out, in board units. */
  marquee: Box | null;
  guides: readonly Guide[];
  /** Space is held, so a press drags the board. */
  space: boolean;
  /** The board is being dragged around. */
  panning: boolean;
  /** The camera is easing to where it was last put. */
  glide: boolean;
  /** Objects travelling to new places together, as they do after an undo. */
  settling: ReadonlySet<string>;
  /** Objects that have just landed, which pop in. */
  landed: ReadonlySet<string>;
  /** Past 500 objects, the part of the board that's mounted, in board units. */
  near: Box | null;
  /** Whose view this is, if it isn't your own. */
  following: string | null;
  canUndo: boolean;
  canRedo: boolean;
}

const NOTHING: ReadonlySet<string> = new Set();
/** What a board with nothing on it frames: the canvas's working space. */
const BLANK: Box = { x: 0, y: 0, w: 1160, h: 530 };
/** With no bar to keep clear of. */
const BARE_PAD: Pad = { l: 40, r: 40, t: 56, b: 40 };
/** A frame filling the sheet, with room for its title. */
const SLIDE_PAD: Pad = { l: 40, r: 40, t: 96, b: 40 };
const ZOOM_STEP = 1.25;
/** How far Duplicate puts a copy from what it copied. */
const COPY_OFFSET = { x: 24, y: 24 };
/** Above this many at once it's a board loading or a template landing, not stickies arriving. */
const POP_AT_ONCE = 24;
/** How often a moving camera checks what's mounted. Well inside the time a fast pan takes to cross the margin. */
const NEAR_EVERY_MS = 100;
/** A moment past the transition's own end. */
const SETTLE_MS = 20;

type UndoStep = Y.UndoManager['undoStack'][number];

/** Whether a step would bring back something that was deleted. An object that has been undone and redone has older items under its id, and the step may name one of those. */
function restores(doc: Y.Doc, step: UndoStep): boolean {
  for (const latest of doc.getMap<unknown>(BOARD_OBJECTS)._map.values()) {
    for (let item: Y.Item | null = latest; item; item = item.left) if (Y.isDeleted(step.deletions, item.id)) return true;
  }
  return false;
}

export class Board implements LiveStore<BoardState> {
  readonly doc: Y.Doc;
  /** This surface's own, so undo takes back what was done here and nothing else. */
  readonly origin = {};
  readonly camera = new BoardCameraStore();
  mode: BoardMode;
  /** Says something to the person at this board. */
  tell: (text: string) => void = () => undefined;
  /** Told when following stops from this side: a scroll, a zoom, Esc. */
  onFollow: ((id: string | null) => void) | undefined;

  private state: BoardState;
  private sheet: HTMLElement | null = null;
  private undoManager: Y.UndoManager | null = null;
  private capture = 0;
  private stepping = false;
  /** A sticky made by this edit, which goes again if nothing's written on it. */
  private fresh: string | null = null;
  /** Whether the camera has been put anywhere yet, which waits until the sheet has a size. */
  private framed = false;
  private frame = 0;
  private readonly waits = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly listeners = new Set<() => void>();
  private readonly pointerWatchers = new Set<(at: SheetPoint | null) => void>();

  constructor(doc: Y.Doc, mode: BoardMode) {
    this.doc = doc;
    this.mode = mode;
    this.state = {
      view: readBoard(doc), tool: 'select', colour: 'butter', sel: [], edit: null, marquee: null, guides: NO_GUIDES, space: false, panning: false,
      glide: false, settling: NOTHING, landed: NOTHING, near: null, following: null, canUndo: false, canRedo: false
    };
  }

  get look(): BoardLook { return BOARD_LOOKS[this.mode]; }
  get canEdit(): boolean { return this.look.edit; }

  getSnapshot = (): BoardState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  set(patch: Partial<BoardState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Starts watching the doc and the sheet. Returns how to stop. */
  attach(sheet: HTMLElement, world: HTMLElement): () => void {
    this.sheet = sheet;
    const undo = makeUndo(this.doc, this.origin);
    this.undoManager = undo;
    this.capture = undo.captureTimeout;
    undo.on('stack-item-added', this.stacks);
    undo.on('stack-item-popped', this.stacks);
    undo.on('stack-cleared', this.stacks);

    const stopCamera = this.camera.attach(sheet, world);
    const stopDoc = observeBoard(this.doc, this.changed);
    const stopNear = this.camera.subscribe(this.cameraMoved);
    const measure = (): void => this.measure(sheet);
    const size = new ResizeObserver(measure);
    size.observe(sheet);
    measure();
    this.read();
    this.settleNear();
    return () => {
      // A board can close with a blank new sticky open, which shouldn't stay behind for everyone.
      this.finishEdit();
      size.disconnect();
      stopNear();
      stopDoc();
      stopCamera();
      undo.destroy();
      this.undoManager = null;
      this.sheet = null;
      this.stepping = false;
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0;
      for (const wait of this.waits.values()) clearTimeout(wait);
      this.waits.clear();
    };
  }

  private measure(sheet: HTMLElement): void {
    this.camera.resize(sheet.offsetWidth, sheet.offsetHeight);
    if (!this.camera.width || (this.framed && !this.look.mini)) return;
    this.framed = true;
    this.fitAll(false);
  }

  setMode(mode: BoardMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (this.canEdit) return;
    this.finishEdit();
    this.set({ sel: [], tool: 'select' });
  }

  private later(name: string, ms: number, then: () => void): void {
    clearTimeout(this.waits.get(name));
    this.waits.set(name, setTimeout(() => {
      this.waits.delete(name);
      then();
    }, ms));
  }

  /* ---------- reading the doc ---------- */

  private changed = (): void => {
    this.frame ||= requestAnimationFrame(this.read);
  };

  /** Reads the board now. Writes in a gesture call this, so a drag draws in the frame it was written. */
  read = (): void => {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    const { view: was, sel, edit, landed } = this.state;
    const view = readBoard(this.doc, was);
    if (view === was) return;
    const patch: Partial<BoardState> = { view };
    if (sel.some((id) => !view.byId.has(id))) patch.sel = sel.filter((id) => view.byId.has(id));
    const arrived = view.objects.length > was.objects.length ? view.objects.filter((o) => !was.byId.has(o.id)) : [];
    if (arrived.length && arrived.length <= POP_AT_ONCE) patch.landed = new Set([...landed, ...arrived.map((o) => o.id)]);
    this.set(patch);
    if (patch.landed && this.sheet) this.later('landed', tokenMs(this.sheet, '--duration-2') * 2, () => this.set({ landed: NOTHING }));
    if (edit && !view.byId.has(edit)) this.finishEdit();
    if (this.look.mini) this.fitAll(false);
    this.settleNear();
  };

  /* ---------- undo ---------- */

  private stacks = (): void => {
    const undo = this.undoManager;
    if (undo) this.set({ canUndo: undo.canUndo(), canRedo: undo.canRedo() });
  };

  /** Everything until `endStep` is one undo, however long it takes: a drag with a pause in it, or all that's typed in one go. */
  beginStep(): void {
    const undo = this.undoManager;
    if (!undo || this.stepping) return;
    this.stepping = true;
    undo.stopCapturing();
    undo.captureTimeout = Number.MAX_SAFE_INTEGER;
  }

  endStep(): void {
    const undo = this.undoManager;
    if (!undo || !this.stepping) return;
    this.stepping = false;
    undo.captureTimeout = this.capture;
    undo.stopCapturing();
  }

  /** Makes a change whose objects then travel to their new places together, in place of jumping. */
  settle(change: () => void): void {
    const before = this.state.view;
    change();
    this.read();
    const moved = this.state.view.objects.flatMap((o) => {
      const was = before.byId.get(o.id);
      return was && hasBox(was) && hasBox(o) && (was.x !== o.x || was.y !== o.y) ? [o.id] : [];
    });
    if (!moved.length || !this.sheet) return;
    this.set({ settling: new Set(moved) });
    this.later('settling', tokenMs(this.sheet, '--bd-glide') + SETTLE_MS, () => this.set({ settling: NOTHING }));
  }

  /** One change on its own, as one undo, however soon it follows the last one. */
  private step(change: () => void): void {
    const within = this.stepping;
    if (!within) this.beginStep();
    change();
    if (!within) this.endStep();
  }

  /**
   * Goes a step back or forward. A value someone else wrote over this person's normally stays, which is what makes undo
   * yours alone. Bringing an object back is different. Someone changing a field at the moment it was deleted would count as
   * that, the field wouldn't return, and the object would fail to parse and be gone for everyone. So it comes back whole,
   * as it was deleted: deleting wins over a change made at the same moment, and nothing else is in a step like this.
   */
  private travel(undo: Y.UndoManager, stack: readonly UndoStep[], go: () => void): void {
    const step = stack.at(-1);
    const was = undo.ignoreRemoteMapChanges;
    undo.ignoreRemoteMapChanges = was || (!!step && restores(this.doc, step));
    try {
      this.settle(go);
    } catch (err) {
      // Yjs can follow an item it has already collected, and throw part way. What went back stays back, and the board carries on.
      log.error('undo failed', { err });
    } finally {
      undo.ignoreRemoteMapChanges = was;
    }
    this.set({ sel: [] });
  }

  /** Takes back this person's last change, and only theirs, whatever anyone else has done since. */
  undo(): void {
    const undo = this.undoManager;
    if (undo && !this.stepping) this.travel(undo, undo.undoStack, () => undo.undo());
  }

  redo(): void {
    const undo = this.undoManager;
    if (undo && !this.stepping) this.travel(undo, undo.redoStack, () => undo.redo());
  }

  /* ---------- selection and tools ---------- */

  select(ids: readonly string[]): void {
    if (!sameIds(this.state.sel, ids)) this.set({ sel: ids });
  }

  selectAll(): void {
    this.finishEdit();
    this.set({ sel: everything(this.state.view) });
  }

  pickTool(tool: BoardTool): void {
    this.finishEdit();
    this.set({ tool, sel: [] });
  }

  /** Back to Select. Says whether there was anything to go back from, so that Esc can otherwise be the call's. */
  escape(): boolean {
    const { tool, sel, following } = this.state;
    if (tool === 'select' && !sel.length && !following) return false;
    this.stopFollow();
    this.set({ tool: 'select', sel: [] });
    return true;
  }

  removeSelected(): boolean {
    const { sel } = this.state;
    if (!sel.length) return false;
    this.step(() => removeObjects(this.doc, sel, this.origin));
    this.read();
    this.set({ sel: [] });
    return true;
  }

  duplicateSelected(): void {
    const { sel } = this.state;
    if (!sel.length) return;
    let copies: string[] = [];
    this.step(() => { copies = duplicateObjects(this.doc, sel, COPY_OFFSET, this.origin); });
    if (!copies.length) { this.refuse(); return; }
    this.read();
    this.set({ sel: copies });
  }

  private refuse(): void {
    log.info('board is full', { objects: this.state.view.objects.length });
    this.tell('This board is full. Delete something to make room.');
  }

  /* ---------- typing ---------- */

  /** Adds a sticky at `x y` and opens it for typing. It takes the colour of the frame it lands in, unless given one. */
  newSticky(x: number, y: number, colour?: StickyColour): void {
    if (!this.canEdit) return;
    this.finishEdit();
    const { view, colour: picked } = this.state;
    const c = colour ?? colourIn(view, frameAt(view, x + STICKY / 2, y + STICKY / 2), picked);
    this.beginStep();
    const id = addObject(this.doc, { k: 'note', x, y, w: STICKY, h: STICKY, c, size: 'm', t: '' }, this.origin);
    if (!id) {
      this.endStep();
      this.refuse();
      return;
    }
    this.read();
    this.fresh = id;
    this.set({ edit: id, sel: [id], tool: 'select' });
  }

  /** Opens something for typing, if it has a place for text. */
  startEdit(id: string): void {
    if (!this.canEdit || !objectText(this.doc, id)) return;
    this.finishEdit();
    this.beginStep();
    this.set({ edit: id, sel: [id], tool: 'select' });
  }

  /** Stops typing. A sticky made for this and left blank goes again, leaving nothing to undo. */
  finishEdit(): void {
    const { edit } = this.state;
    if (!edit) return;
    const text = objectText(this.doc, edit);
    const blank = this.fresh === edit && text !== null && !text.toString().trim();
    this.fresh = null;
    if (blank) removeObjects(this.doc, [edit], this.origin);
    this.set({ edit: null });
    this.endStep();
    if (!blank) return;
    // Adding it and taking it away are one step that came to nothing, so it isn't left to undo.
    this.undoManager?.undoStack.pop();
    this.stacks();
    this.read();
  }

  /** Tab: finishes this one and starts the next beside it, in the same colour. */
  nextSticky(): void {
    const { edit, view } = this.state;
    const o = edit ? view.byId.get(edit) : undefined;
    if (!o || !hasBox(o)) return;
    const { x, y } = nextSpot(view, o);
    const colour = o.k === 'note' ? o.c : o.k === 'shape' && o.c ? o.c : undefined;
    this.finishEdit();
    this.newSticky(x, y, colour);
  }

  focusSheet(): void {
    this.sheet?.focus({ preventScroll: true });
  }

  /* ---------- the camera ---------- */

  /** Eases the camera somewhere. What it passes on the way stays mounted until it gets there. */
  glideTo(cam: Camera): void {
    const { sheet } = this;
    if (!sheet) {
      this.camera.set(cam);
      return;
    }
    // Read before the camera moves. Reading a style makes the browser work styles out there and then, which would take the move as a jump, ahead of `glide` being drawn.
    const takes = tokenMs(sheet, '--duration-3');
    this.set({ glide: true });
    this.camera.set(cam);
    const { near } = this.state;
    if (near) this.set({ near: bounds([near, reachOf(this.camera.visible())]) });
    this.later('glide', takes + SETTLE_MS, () => {
      this.set({ glide: false });
      this.settleNear();
    });
  }

  /** The person has taken the camera: anything easing it stops where it is. */
  stopGlide(): void {
    if (this.state.glide) this.set({ glide: false });
  }

  fitAll(glide = true): void {
    if (!this.camera.width) return;
    const boxes = this.state.view.objects.filter(hasBox);
    const cam = this.camera.fitting(boxes.length ? bounds(boxes) : BLANK, this.look.bar ? undefined : BARE_PAD);
    if (glide) this.glideTo(cam);
    else this.camera.set(cam);
  }

  zoomBy(factor: number): void {
    this.stopFollow();
    this.glideTo(this.camera.zoomed(factor, this.camera.width / 2, this.camera.height / 2));
  }

  zoomIn = (): void => this.zoomBy(ZOOM_STEP);
  zoomOut = (): void => this.zoomBy(1 / ZOOM_STEP);

  showEverything = (): void => {
    this.stopFollow();
    this.fitAll();
  };

  goTo(place: BoardPlace): void {
    this.glideTo(this.camera.centred(place));
  }

  /** Fills the sheet with a frame. */
  focusFrame(id: string): void {
    const frame = this.state.view.byId.get(id);
    if (frame?.k === 'frame') this.glideTo(this.camera.fitting(frame, SLIDE_PAD));
  }

  follow(id: string | null): void {
    if (id === null) this.stopFollow();
    else this.set({ following: id });
  }

  stopFollow(): void {
    if (!this.state.following) return;
    this.set({ following: null });
    this.onFollow?.(null);
  }

  private cameraMoved = (): void => {
    if (this.state.view.objects.length > MOUNT_ALL && !this.waits.has('near')) this.later('near', NEAR_EVERY_MS, this.settleNear);
  };

  /** Moves what's mounted to where the camera is. A glide does this when it arrives, having kept what it's passing. */
  private settleNear = (): void => {
    const { view, near, glide } = this.state;
    if (view.objects.length <= MOUNT_ALL || glide) return;
    const seen = this.camera.visible();
    if (!near || !reachHolds(near, seen)) this.set({ near: reachOf(seen) });
  };

  /* ---------- the pointer ---------- */

  /** Calls `watcher` each frame with where the pointer is on the sheet, and with null when it leaves. Returns how to stop. */
  watchPointer(watcher: (at: SheetPoint | null) => void): () => void {
    this.pointerWatchers.add(watcher);
    return () => { this.pointerWatchers.delete(watcher); };
  }

  pointerAt(at: SheetPoint | null): void {
    for (const watcher of this.pointerWatchers) watcher(at);
  }
}

/** One board for this doc. Everything else about it comes from `attach`, so that nothing's left running if React throws this one away. */
export function useBoard(doc: Y.Doc, mode: BoardMode): Board {
  // The doc alone decides which board this is. A change of mode reaches it through `setMode`.
  return useMemo(() => new Board(doc, mode), [doc]);
}

/** One slice of a board's state. What reads it draws again only when that slice changes, so `pick` should return a field, not make something new. */
export function useBoardState<T>(board: Board, pick: (state: BoardState) => T): T {
  const read = (): T => pick(board.getSnapshot());
  return useSyncExternalStore(board.subscribe, read, read);
}
