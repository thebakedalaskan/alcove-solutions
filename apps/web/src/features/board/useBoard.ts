/*
 * One person's board: its doc, and everything about them that isn't in it, such as what they've selected, what they're
 * typing in, their tool and their undo. It's a plain object that gestures and keys call into, and components read slices
 * of it, because most of what happens here happens every frame and React should hear only about what changes the drawing.
 *
 * Other people's changes are read once a frame. Your own are read at once, so what you did is on the sheet when you next
 * look. `readBoard` keeps the identity of whatever didn't change, which is what lets one move draw one object again.
 */
import { errorCode, type LiveStore } from '@alcove/api';
import {
  BOARD_COMMENTS, BOARD_LIMITS, BOARD_OBJECTS, addObject, applyThemes, bounds, colourIn, contains, duplicateObjects, frameAt, hasBox, isAttached, makeHistory, objectText, observeBoard, readBoard,
  removeObjects, type BoardHistory, type BoardObject, type BoardTheme, type BoardView, type Box, type Camera, type NewObject, type Pad, type StepResult, type StickyColour
} from '@alcove/board';
import type { BoardMoreItem, BoardTool, ToastOptions } from '@alcove/ui';
import { useMemo, useSyncExternalStore } from 'react';
import type * as Y from 'yjs';
import { typing } from '~/lib/keys';
import { log as rootLog } from '~/lib/log';
import { BoardCameraStore, tokenMs, type BoardPlace, type SheetPoint } from './camera';
import { STICKY, holdKeys, nextSpot, textField } from './editing';
import { BoardOverlay } from './overlay';
import { MOUNT_ALL, NO_GUIDES, drawn, everything, hangsOff, reachHolds, reachOf, sameIds } from './selection';
import { BOARD_LOOKS, type BoardFly, type BoardLook, type BoardMode, type BoardMoreItems, type BoardState } from './state';

const log = rootLog.child({ component: 'board' });

const NOTHING: ReadonlySet<string> = new Set();
/** Whatever is open or under way over the sheet, closed. */
const CLOSED = { fly: null, picking: false, menu: false, draft: null, lineFrom: null, barMenu: false } satisfies Partial<BoardState>;
/** The tools with options to pick, which open as the tool is picked. */
const OPTIONS: Partial<Record<BoardTool, BoardFly>> = { note: 'note', shape: 'shape', line: 'line', pen: 'pen' };
/** What a board with nothing on it frames: the canvas's working space. */
const BLANK: Box = { x: 0, y: 0, w: 1160, h: 530 };
/** With no bar to keep clear of. */
const BARE_PAD: Pad = { l: 40, r: 40, t: 56, b: 40 };
/** A frame filling the sheet, with room for its title. */
const SLIDE_PAD: Pad = { l: 40, r: 40, t: 96, b: 40 };
/** The same with no bar over the sheet: room for the title, and the frame in the middle. */
const PRESENT_PAD: Pad = { l: 48, r: 48, t: 72, b: 32 };
const ZOOM_STEP = 1.25;
/** How far Duplicate puts a copy from what it copied. */
const COPY_OFFSET = { x: 24, y: 24 };
/** Above this many at once it's a board loading or a template landing, not stickies arriving. */
const POP_AT_ONCE = 24;
/** How often a moving camera checks what's mounted. Well inside the time a fast pan takes to cross the margin. */
const NEAR_EVERY_MS = 100;
/** How long a camera has to be still to count as at rest. */
const REST_MS = 100;
/** A moment past the transition's own end. */
const SETTLE_MS = 20;
/** What's said when what someone is typing in is deleted under them. */
const DELETED: Partial<Record<BoardObject['k'], string>> = { note: 'This sticky was deleted.', text: 'This text was deleted.', shape: 'This shape was deleted.', frame: 'This frame was deleted.' };

export class Board implements LiveStore<BoardState> {
  readonly doc: Y.Doc;
  /** This surface's own, so undo takes back what was done here and nothing else. */
  readonly origin = {};
  readonly camera = new BoardCameraStore();
  /** What this person sees ahead of the doc. */
  readonly overlay = new BoardOverlay(() => this.showOverlay());
  /** The doc as last read, which is what writes go by. `view` is what's shown, and can be ahead of it. */
  written: BoardView;
  mode: BoardMode;
  /** Says something to the person at this board, with something to press, such as Undo, when there is one. */
  tell: (text: string, o?: ToastOptions) => void = () => undefined;
  /** Told when following stops, whatever stopped it. */
  onFollow: ((id: string | null) => void) | undefined;
  /** Told what to say to this person about what just happened to them. */
  onSay: ((text: string) => void) | undefined;
  moreItems: BoardMoreItems = {};
  /** Lets go of whatever the pointer is holding, as if it had been taken away. Says whether it was holding anything. The sheet's listeners fill this in. */
  letGo: () => boolean = () => false;
  /** Writes in a word still being composed. The field being typed in fills this in. */
  flushTyping: (() => void) | null = null;
  /** Where this person was when they started following, which is where Stop and Esc take them. */
  home: BoardPlace | null = null;

  private state: BoardState;
  private sheet: HTMLElement | null = null;
  private history: BoardHistory | null = null;
  private stepping = false;
  /** What was made by this edit, which goes again if nothing's written on it. */
  private fresh: string | null = null;
  /** The line it was made on the end of, which goes with it. */
  private freshLine: string | null = null;
  /** Whether the camera has been put anywhere yet, which waits until the sheet has a size. */
  private framed = false;
  /** Nobody has moved the camera or changed anything yet, so a board that fills after it opens can frame what arrived. */
  private untouched = true;
  private frame = 0;
  private readonly waits = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly listeners = new Set<() => void>();
  private readonly pointerWatchers = new Set<(at: SheetPoint | null) => void>();

  constructor(doc: Y.Doc, mode: BoardMode) {
    this.doc = doc;
    this.mode = mode;
    this.written = readBoard(doc);
    this.state = {
      view: this.written, tool: 'select', colour: 'butter', shape: 'rect', line: 'elbow', pen: 'pen', fly: null, sel: [], edit: null, picking: false, menu: false, hover: null,
      draft: null, lineFrom: null, pressing: false, map: false, marquee: null, guides: NO_GUIDES, space: false, panning: false, glide: false, settling: NOTHING, landed: NOTHING,
      near: null, following: null, barMenu: false, slide: null, sorting: false, canUndo: false, canRedo: false
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
    // What opens off the selection bar is about what was selected.
    const reselected = patch.sel !== undefined && patch.sel !== this.state.sel;
    this.state = { ...this.state, ...(reselected ? { picking: false, menu: false } : {}), ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Starts watching the doc and the sheet. Returns how to stop. */
  attach(sheet: HTMLElement, world: HTMLElement): () => void {
    this.sheet = sheet;
    const history = makeHistory(this.doc, this.origin);
    this.history = history;
    history.subscribe(this.stacks);

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
      this.editTaken();
      size.disconnect();
      stopNear();
      stopDoc();
      stopCamera();
      this.overlay.stop();
      history.destroy();
      this.history = null;
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
    this.letGo();
    this.editTaken();
    this.set({ ...CLOSED, hover: null, sel: [], tool: 'select' });
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
    this.frame ||= requestAnimationFrame(this.heard);
  };

  /** What arrives on its own is someone else's, and what they moved travels. This person's own changes are read at once. */
  private heard = (): void => this.read(true);

  private showOverlay(): void {
    const view = this.overlay.over(this.written);
    if (view !== this.state.view) this.set({ view });
  }

  /** Lets go of what the pointer was carrying: its last place goes to the doc, and the doc is what shows from here. */
  land(): void {
    this.overlay.land();
    this.read();
    this.showOverlay();
  }

  /** Reads the board now. Writes in a gesture call this, so what they did is drawn in the frame it was written. */
  read = (heard = false): void => {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    const before = this.written;
    this.written = readBoard(this.doc, before);
    if (this.written === before) return;
    if (heard && !this.look.mini) this.overlay.heard(before, this.written);
    const { view: was, sel, edit, landed } = this.state;
    const view = this.overlay.over(this.written);
    const patch: Partial<BoardState> = { view };
    if (sel.some((id) => !view.byId.has(id))) patch.sel = sel.filter((id) => view.byId.has(id));
    const arrived = view.objects.length > was.objects.length ? view.objects.filter((o) => !was.byId.has(o.id)) : [];
    if (arrived.length && arrived.length <= POP_AT_ONCE) patch.landed = new Set([...landed, ...arrived.map((o) => o.id)]);
    this.set(patch);
    if (patch.landed && this.sheet) this.later('landed', tokenMs(this.sheet, '--duration-2') * 2, () => this.set({ landed: NOTHING }));
    if (edit && !view.byId.has(edit)) {
      this.editTaken();
      const kind = was.byId.get(edit)?.k;
      const said = kind && DELETED[kind];
      if (said) this.onSay?.(said);
    }
    if (this.look.mini || (!was.objects.length && this.untouched && !this.allInView(view))) this.fitAll(false);
    this.settleNear();
  };

  /* ---------- undo ---------- */

  private stacks = (): void => {
    const { history, state } = this;
    if (!history) return;
    const canUndo = history.canUndo(), canRedo = history.canRedo();
    if (canUndo !== state.canUndo || canRedo !== state.canRedo) this.set({ canUndo, canRedo });
  };

  /** Everything until `endStep` is one undo, however long it takes: a drag with a pause in it, or all that's typed in one go. */
  beginStep(): void {
    if (!this.history || this.stepping) return;
    this.stepping = true;
    this.untouched = false;
    this.history.begin();
  }

  endStep(): void {
    if (!this.history || !this.stepping) return;
    this.stepping = false;
    this.history.end();
  }

  /** Makes a change whose objects then travel to their new places together, in place of jumping. */
  settle<T>(change: () => T): T {
    const before = this.state.view;
    const result = change();
    this.read();
    const moved = this.state.view.objects.flatMap((o) => {
      const was = before.byId.get(o.id);
      return was && hasBox(was) && hasBox(o) && (was.x !== o.x || was.y !== o.y) ? [o.id] : [];
    });
    if (!moved.length || !this.sheet) return result;
    this.set({ settling: new Set(moved) });
    this.later('settling', tokenMs(this.sheet, '--bd-glide') + SETTLE_MS, () => this.set({ settling: NOTHING }));
    return result;
  }

  /** A change of this person's, on the sheet at once. One write is one undo by itself, or part of the step it's in. */
  write<T>(change: () => T): T {
    this.untouched = false;
    const result = change();
    this.read();
    return result;
  }

  /** Goes a step back or forward. If one can't finish, what went back stays back and the board carries on. */
  private travel(step: (history: BoardHistory) => StepResult): void {
    const { history } = this;
    if (!history || this.stepping || !this.canEdit) return;
    const result = this.settle(() => step(history));
    if (!result.ok) log.error('undo failed', { err: result.error });
    this.set({ sel: [] });
  }

  /** Takes back this person's last change, and only theirs, whatever anyone else has done since. */
  undo(): void {
    this.travel((history) => history.undo());
  }

  redo(): void {
    this.travel((history) => history.redo());
  }

  /* ---------- selection and tools ---------- */

  select(ids: readonly string[]): void {
    if (!sameIds(this.state.sel, ids)) this.set({ sel: ids });
  }

  selectAll(): void {
    this.finishEdit();
    this.set({ sel: everything(this.state.view) });
  }

  /** Picks a tool and opens its options. Picking it again closes them, and the tool stays, and again opens them: the pen stays picked, so that's how to reach the highlighter. */
  pickTool(tool: BoardTool): void {
    this.letGo();
    this.finishEdit();
    const options = OPTIONS[tool] ?? null;
    const { tool: was, fly } = this.state;
    this.set({ ...CLOSED, tool, sel: [], hover: null, fly: tool === was && fly === options ? null : options });
  }

  /** More, beside the rail. */
  toggleMore(): void {
    this.set({ fly: this.state.fly === 'more' ? null : 'more' });
  }

  /** Does one of More's items. Says whether it had anything to do, so that its key can otherwise be someone else's. */
  runMore(item: BoardMoreItem): boolean {
    const run = this.moreItems[item];
    if (!run) return false;
    this.set({ fly: null });
    run();
    return true;
  }

  /** A press on the sheet closes whatever is open over it. */
  closeOver(): void {
    const { fly, picking, menu, barMenu } = this.state;
    if (fly || picking || menu || barMenu) this.set({ fly: null, picking: false, menu: false, barMenu: false });
  }

  /** The bar's More, beside the name. */
  toggleBarMenu(): void {
    this.set({ barMenu: !this.state.barMenu, fly: null });
  }

  /* ---------- sort into themes ---------- */

  /**
   * Sort into themes, on the stickies picked. `ask` asks confidential compute, which answers with the themes. They're written as
   * this person's change, so the stickies travel into their themes together and one undo puts it all back, and the toast says how
   * many themes there are, with Undo. A board that has closed meanwhile writes nothing, and one that couldn't be sorted says so.
   */
  async sortIntoThemes(stickies: readonly string[], ask: (stickies: readonly string[]) => Promise<readonly BoardTheme[]>): Promise<void> {
    if (!this.canEdit || this.state.sorting || stickies.length < 2) return;
    this.set({ sorting: true });
    try {
      const themes = await ask(stickies);
      if (!this.sheet || !this.canEdit) return;
      // What's left of the answer: a sticky deleted meanwhile has nowhere to go, and a theme with none left isn't drawn.
      const found = themes.filter((t) => t.ids.some((id) => this.written.byId.get(id)?.k === 'note'));
      if (!found.length) {
        this.tell('Those stickies have gone, so there was nothing to sort.');
        return;
      }
      this.untouched = false;
      this.settle(() => this.write(() => applyThemes(this.doc, found, this.origin)));
      this.set({ sel: [] });
      this.tell(`Sorted into ${found.length} ${found.length === 1 ? 'theme' : 'themes'}.`, { icon: 'group', action: { label: 'Undo', onClick: () => this.undo() } });
    } catch (e) {
      log.warn('sort into themes failed', { code: errorCode(e), stickies: stickies.length });
      if (this.sheet) this.tell('Couldn’t sort these into themes. Try again.');
    } finally {
      this.set({ sorting: false });
    }
  }

  hoverOn(id: string | null): void {
    if (id !== this.state.hover) this.set({ hover: id });
  }

  /** Back to Select, dropping anything held. Says whether there was anything to go back from, so that Esc can otherwise be the call's. */
  escape(): boolean {
    const held = this.letGo();
    const { tool, sel, following, fly, barMenu } = this.state;
    if (!held && tool === 'select' && !sel.length && !following && !fly && !barMenu) return false;
    this.stopFollow();
    this.set({ ...CLOSED, tool: 'select', sel: [] });
    return true;
  }

  removeSelected(): boolean {
    const { sel } = this.state;
    if (!sel.length) return false;
    this.untouched = false;
    removeObjects(this.doc, sel, this.origin);
    this.read();
    this.set({ sel: [] });
    return true;
  }

  duplicateSelected(): void {
    const { sel, view } = this.state;
    // A line attached at both ends would land exactly on itself. Copying what it joins copies it.
    const ids = sel.filter((id) => {
      const o = view.byId.get(id);
      return !(o?.k === 'line' && isAttached(o.from) && isAttached(o.to));
    });
    if (!ids.length) return;
    this.untouched = false;
    const copies = duplicateObjects(this.doc, ids, COPY_OFFSET, this.origin);
    if (!copies.length) { this.refuse(); return; }
    this.read();
    this.set({ sel: copies });
  }

  refuse(): void {
    log.info('board is full', { objects: this.state.view.objects.length });
    this.tell('This board is full. Delete something to make room.');
  }

  /* ---------- typing ---------- */

  /** Adds something and opens it for typing, all one undo with whatever is typed. If nothing gets written on it, it goes again. */
  addAndType(input: NewObject): string | null {
    if (!this.canEdit) return null;
    this.finishEdit();
    this.beginStep();
    const id = addObject(this.doc, input, this.origin);
    if (!id) {
      this.endStep();
      this.refuse();
      return null;
    }
    this.read();
    this.fresh = id;
    this.set({ edit: id, sel: [id], tool: 'select' });
    return id;
  }

  /** Adds a sticky at `x y` and opens it for typing. It takes the colour of the frame it lands in, unless given one. */
  newSticky(x: number, y: number, colour?: StickyColour): string | null {
    const { view, colour: picked } = this.state;
    const c = colour ?? colourIn(view, frameAt(view, x + STICKY / 2, y + STICKY / 2), picked);
    return this.addAndType({ k: 'note', x, y, w: STICKY, h: STICKY, c, size: 'm', t: '' });
  }

  /** A line ending on the sticky just opened, as part of making it. */
  addFreshLine(line: NewObject): void {
    this.freshLine = addObject(this.doc, line, this.origin);
    this.read();
  }

  /** Opens something for typing, if it has a place for text. */
  startEdit(id: string): void {
    if (!this.canEdit || !objectText(this.doc, id, textField(this.state.view.byId.get(id)))) return;
    this.finishEdit();
    this.beginStep();
    this.set({ edit: id, sel: [id], tool: 'select' });
  }

  /** Stops typing. A sticky made for this and left blank goes again, leaving nothing to undo, unless something hangs off it by then: taking that too couldn't be undone. */
  finishEdit(): void {
    const { edit } = this.state;
    if (!edit) return;
    this.flushTyping?.();
    const text = objectText(this.doc, edit);
    const blank = this.fresh === edit && text !== null && !text.toString().trim() && !hangsOff(readBoard(this.doc, this.written), this.doc.getMap<unknown>(BOARD_COMMENTS), edit, this.freshLine);
    this.fresh = null;
    this.freshLine = null;
    if (blank) removeObjects(this.doc, [edit], this.origin);
    this.set({ edit: null });
    if (!blank) {
      this.endStep();
      return;
    }
    // Adding it and taking it away came to nothing, so it isn't left to undo.
    this.stepping = false;
    this.history?.drop();
    this.read();
  }

  /** Typing ended without this person asking. They may not know yet, so what they type next waits, or it would go to the call. */
  private editTaken(): void {
    if (this.state.edit && typing(document.activeElement) && this.sheet?.contains(document.activeElement)) holdKeys(() => this.focusSheet());
    this.finishEdit();
  }

  /** The field lost focus with nothing pressed and nothing taking it, because something moved or hid it. Focus has already gone to the page, so what comes next has to wait all the same. */
  fieldLost(): void {
    if (!this.state.edit) return;
    holdKeys(() => this.focusSheet());
    this.finishEdit();
  }

  /** Tab: finishes this one and starts the next beside it, in the same colour. With no room for it, this one stays open. */
  nextSticky(): void {
    const { edit, view } = this.state;
    const o = edit ? view.byId.get(edit) : undefined;
    if (!o || !hasBox(o)) return;
    if (this.doc.getMap<unknown>(BOARD_OBJECTS).size >= BOARD_LIMITS.objects) {
      this.refuse();
      return;
    }
    const { x, y } = nextSpot(view, o);
    const colour = o.k === 'note' ? o.c : o.k === 'shape' && o.c ? o.c : undefined;
    this.finishEdit();
    this.newSticky(x, y, colour);
  }

  focusSheet(): void {
    if (!this.look.mini) this.sheet?.focus({ preventScroll: true });
  }

  /* ---------- the camera ---------- */

  /** Eases the camera somewhere. What it passes on the way stays mounted until it gets there. */
  glideTo(cam: Camera): void {
    const { sheet } = this;
    this.untouched = false;
    if (!sheet) {
      this.camera.set(cam);
      return;
    }
    // Read first: reading a style settles the page, and the move has to settle together with the glide or there's nothing to ease.
    const ms = tokenMs(sheet, '--duration-3') + SETTLE_MS;
    this.set({ glide: true });
    this.camera.set(cam);
    const { near } = this.state;
    if (near) this.set({ near: bounds([near, reachOf(this.camera.visible())]) });
    // Not put off by the next glide, so a run of them can't keep what's mounted from catching up. What's already easing finishes easing.
    if (this.waits.has('glide')) return;
    this.later('glide', ms, () => {
      this.set({ glide: false });
      this.settleNear();
    });
  }

  /** The person has taken the camera. They've started looking around from here, so following stops and leaves them here, and a glide ends at once, where it was heading. */
  takeCamera(): void {
    this.untouched = false;
    this.home = null;
    this.stopFollow();
    if (this.state.glide) this.set({ glide: false });
  }

  /** Whether all of this is on the sheet. */
  private allInView(view: BoardView): boolean {
    const box = bounds(drawn(view)), seen = this.camera.visible();
    return contains(seen, box.x, box.y) && contains(seen, box.x + box.w, box.y + box.h);
  }

  fitAll(glide = true): void {
    if (!this.camera.width) return;
    const boxes = drawn(this.state.view);
    const cam = this.camera.fitting(boxes.length ? bounds(boxes) : BLANK, this.look.bar ? undefined : BARE_PAD);
    if (glide) this.glideTo(cam);
    else this.camera.set(cam);
  }

  zoomBy(factor: number): void {
    this.takeCamera();
    this.glideTo(this.camera.zoomed(factor, this.camera.width / 2, this.camera.height / 2));
  }

  zoomIn = (): void => this.zoomBy(ZOOM_STEP);
  zoomOut = (): void => this.zoomBy(1 / ZOOM_STEP);

  showEverything = (): void => {
    this.takeCamera();
    this.fitAll();
  };

  goTo(place: BoardPlace): void {
    this.glideTo(this.camera.centred(place));
  }

  /** Fills the sheet with a frame. Presenting, it's all the sheet shows. */
  focusFrame(id: string): void {
    const frame = this.state.view.byId.get(id);
    if (frame?.k !== 'frame') return;
    this.takeCamera();
    this.set({ slide: id });
    this.glideTo(this.camera.fitting(frame, this.look.bar ? SLIDE_PAD : PRESENT_PAD));
  }

  /** Follows someone. A tile doesn't: it's a picture of the board, with nothing on it to stop following by. */
  follow(id: string | null): void {
    if (id === null) this.stopFollow();
    else if (!this.look.mini) this.set({ following: id });
  }

  stopFollow(): void {
    if (!this.state.following) return;
    this.set({ following: null });
    this.onFollow?.(null);
  }

  private cameraMoved = (): void => {
    this.later('rest', REST_MS, () => this.camera.rest());
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
