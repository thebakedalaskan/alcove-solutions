/*
 * One person's board: its doc, and everything about them that isn't in it, such as what they've selected, what they're
 * typing in, their tool and their undo. It's a plain object that gestures and keys call into, and components read slices
 * of it, because most of what happens here happens every frame and React should hear only about what changes the drawing.
 *
 * Other people's changes are read once a frame. Your own are read at once, so what you did is on the sheet when you next
 * look. `readBoard` keeps the identity of whatever didn't change, which is what lets one move draw one object again.
 */
import { errorCode, errorMessage, type LiveStore } from '@alcove/api';
import {
  BOARD_COMMENTS, BOARD_LIMITS, BOARD_OBJECTS, MAP_ROOM, NODE, addBranch, addMindMap, addObject, addSibling, addTableLine, addTemplate, applyThemes, boardNight, bounds, cellKey, colourIn, contains, duplicateObjects, frameAt, freeNear,
  hasBox, isAttached, landedFrameId, makeHistory, moveObjects, newId, objectText, observeBoard, observeSettings, readBoard, removeObjects, removeTableLine, resizeObject, setNight, type BoardHistory, type BoardObject, type BoardStep, type BoardTheme,
  type BoardView, type Box, type Camera, type NewObject, type Pad, type StepResult, type StickyColour, type TableAxis, type TemplateName
} from '@alcove/board';
import type { BoardMoreItem, BoardTool, IconName, ToastOptions } from '@alcove/ui';
import { useMemo, useSyncExternalStore } from 'react';
import type * as Y from 'yjs';
import { editable } from '~/lib/keys';
import { log as rootLog } from '~/lib/log';
import { BoardCameraStore, PHONE_SHEET, phoneCamera, tokenMs, type BoardPlace, type SheetPoint } from './camera';
import { STICKY, holdKeys, nextSpot, textField } from './editing';
import { holdBoardKeys } from './keys';
import { JustPut } from './landing';
import { BoardOverlay } from './overlay';
import type { PillKind } from './pills';
import { MOUNT_ALL, NO_GUIDES, drawn, everything, hangsOff, reachHolds, reachOf, sameIds } from './selection';
import { BOARD_LOOKS, type BoardFly, type BoardLook, type BoardMode, type BoardMoreItems, type BoardState } from './state';

const log = rootLog.child({ component: 'board' });

/** What answers Sort into themes: given the stickies picked, by their ids and what each says, the themes they sort into. */
export type SortAsk = (stickies: readonly { id: string; text: string }[]) => Promise<readonly BoardTheme[]>;

const NOTHING: ReadonlySet<string> = new Set();
const NONE_LANDING: ReadonlyMap<string, number> = new Map();
/** How far apart rooms' frames land, one after another, as the canvas has them. */
const LAND_STEP_MS = 180;

/**
 * Rooms' frames (`frames`, by id) among `arrived`, in reading order, each with what it holds, and how long each waits to land:
 * 180 ms after the one before. Nothing when none of them is there.
 */
function landingOf(arrived: readonly BoardObject[], frames: ReadonlySet<string>): Map<string, number> | null {
  const landing = arrived.filter((o) => o.k === 'frame' && frames.has(o.id)).sort((a, b) => ('x' in a && 'x' in b ? a.x - b.x || a.y - b.y : 0));
  if (!landing.length) return null;
  const waits = new Map(landing.map((f, i) => [f.id, i * LAND_STEP_MS]));
  for (const o of arrived) {
    const wait = o.f ? waits.get(o.f) : undefined;
    if (wait !== undefined && !waits.has(o.id)) waits.set(o.id, wait);
  }
  return waits;
}
/** Whatever is open or under way over the sheet, closed. */
const CLOSED = { fly: null, picking: false, menu: false, voteMenu: false, barMenu: false, draft: null, lineFrom: null } satisfies Partial<BoardState>;
/** The tools with options to pick, which open as the tool is picked. */
const OPTIONS: Partial<Record<BoardTool, BoardFly>> = { note: 'note', shape: 'shape', line: 'line', pen: 'pen' };
/** What a board with nothing on it frames: the canvas's working space. */
const BLANK: Box = { x: 0, y: 0, w: 1160, h: 530 };
/** With no bar to keep clear of. */
const BARE_PAD: Pad = { l: 40, r: 40, t: 56, b: 40 };
/** A frame filling the sheet, with room for its title. */
const SLIDE_PAD: Pad = { l: 40, r: 40, t: 96, b: 40 };
/**
 * Clear of the bar and of the pill under it, with room for a frame's title above the frame: where a vote frames what it's on
 * (tools/run.tsx), and the top of whatever's framed while a pill shows.
 */
export const CLEAR: Pad = { l: 36, r: 36, t: 136, b: 30 };
/** A frame whoever presents steps to: clear of the bar and the pill, and of the pager at the frame's foot (14 px up, 40 px tall). */
const PRESENTING_PAD: Pad = { ...CLEAR, b: 72 };
/** A new table's columns and rows, in board units. */
const TABLE = { col: 160, row: 48 } as const;
/** What the bar takes at the top of the sheet, and the room `reveal` leaves at its edges, in pixels. */
const BAR_ROOM = 56;
const EDGE = 24;
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
/**
 * What's said as Night board turns on or off: it changes the board for everyone, whatever their theme, so the person pressing it
 * hears that even when their own dark theme shows them nothing changing.
 */
const NIGHT_SAID = { on: 'Night board is on. The board is dark for everyone, whatever their theme.', off: 'Night board is off. The board follows each person’s theme.' } as const;
/** What's said when what someone is typing in is deleted under them. */
const DELETED: Partial<Record<BoardObject['k'], string>> = { note: 'This sticky was deleted.', text: 'This text was deleted.', shape: 'This shape was deleted.', frame: 'This frame was deleted.' };

/** What a vote takes, while it's on: a press on a sticky it takes is a vote for it, or takes one back, and moves nothing. */
export interface BoardBallot {
  takes(id: string): boolean;
  press(id: string): void;
  /** The stickies it takes, in the order Tab goes through them. */
  order(): readonly string[];
}

export class Board implements LiveStore<BoardState> {
  readonly doc: Y.Doc;
  /** This surface's own, so undo takes back what was done here and nothing else. */
  readonly origin = {};
  readonly camera = new BoardCameraStore();
  /** What this person sees ahead of the doc. */
  readonly overlay = new BoardOverlay(() => this.showOverlay());
  /** What this person has just put on the board, kept apart from what someone else puts in the same place at the same moment. */
  readonly justPut = new JustPut(this);
  /** The doc as last read, which is what writes go by. `view` is what's shown, and can be ahead of it. */
  written: BoardView;
  mode: BoardMode;
  /**
   * Says something to the person at this board, with something to press, such as Undo, when there is one: what happened, or
   * why something they tried here didn't, such as a full board or a refusal from the call.
   */
  tell: (text: string, o?: ToastOptions) => void = () => undefined;
  /** Told when following stops, whatever stopped it. */
  onFollow: ((id: string | null) => void) | undefined;
  /** Told what to say to this person about what just happened to them, and the icon that goes with it. */
  onSay: ((text: string, icon: IconName) => void) | undefined;
  moreItems: BoardMoreItems = {};
  /** While a vote is on and this person can vote: what it takes, and what a press on that does. The surface fills this in. */
  ballot: BoardBallot | null = null;
  /** Lets go of whatever the pointer is holding, as if it had been taken away. Says whether it was holding anything. The sheet's listeners fill this in. */
  letGo: () => boolean = () => false;
  /** Writes in a word still being composed. The field being typed in fills this in. */
  flushTyping: (() => void) | null = null;
  /** Where this person was when they started following, which is where Stop and Esc take them. */
  home: BoardPlace | null = null;
  /** Told, as the board comes to rest, which of its outermost frames is in the middle of this person's view, or null for none. */
  onRest: ((frame: string | null) => void) | undefined;

  private state: BoardState;
  private sheet: HTMLElement | null = null;
  private history: BoardHistory | null = null;
  private stepping = false;
  /** What was made by this edit, which goes again if nothing's written on it. */
  private fresh: string | null = null;
  /** The line it was made on the end of, which goes with it. */
  private freshLine: string | null = null;
  /** The words a table's cell had as it opened for typing, so one opened empty and left empty leaves nothing to undo. */
  private cellBefore: string | null = null;
  /** Whether the camera has been put anywhere yet, which waits until the sheet has a size. */
  private framed = false;
  /** Nobody has moved the camera or changed anything yet, so a board that fills after it opens can frame what arrived. */
  private untouched = true;
  /** The frame a picture of the board asks for, which may not have arrived yet. */
  private wanted: string | null = null;
  /** The kind of pill at the top of the sheet, if one shows: whatever's framed keeps clear of it. */
  private pill: PillKind | null = null;
  private frame = 0;
  private readonly waits = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly listeners = new Set<() => void>();
  private readonly pointerWatchers = new Set<(at: SheetPoint | null) => void>();

  constructor(doc: Y.Doc, mode: BoardMode) {
    this.doc = doc;
    this.mode = mode;
    this.written = readBoard(doc);
    this.state = {
      view: this.written, tool: 'select', colour: 'butter', shape: 'rect', line: 'elbow', pen: 'pen', fly: null, sel: [], edit: null, cell: null, picking: false, menu: false, voteMenu: false, barMenu: false, night: boardNight(doc), hover: null,
      draft: null, lineFrom: null, pressing: false, map: false, marquee: null, guides: NO_GUIDES, space: false, panning: false, glide: false, settling: NOTHING, landed: NOTHING, landing: NONE_LANDING,
      near: null, following: null, watching: false, slide: null, sorting: false, canUndo: false, canRedo: false
    };
  }

  get look(): BoardLook { return BOARD_LOOKS[this.mode]; }
  get canEdit(): boolean { return this.look.edit; }
  /** On a phone nothing moves under a finger, but stickies come from the sheet. */
  get canAdd(): boolean { return this.look.edit || this.look.phone; }

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
    const stopSettings = observeSettings(this.doc, () => { if (boardNight(this.doc) !== this.state.night) this.set({ night: boardNight(this.doc) }); });
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
      stopSettings();
      stopCamera();
      this.overlay.stop();
      this.justPut.stop();
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
    // Framed once it has a size, and again as that size settles, as the call makes room for it, until someone does something on it;
    // drawn small, whenever it changes.
    if (!this.camera.width || (this.framed && !this.look.mini && !this.untouched)) return;
    this.framed = true;
    this.fitShown(false, true);
  }

  setMode(mode: BoardMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (this.canEdit) return;
    this.letGo();
    this.editTaken();
    this.set({ ...CLOSED, hover: null, sel: [], tool: 'select' });
  }

  /** Until when what arrives is rooms' boards coming back, and which frames they are: they land frame by frame. */
  private landingUntil = 0;
  private landingFrames: ReadonlySet<string> = NOTHING;

  /**
   * Rooms (by id) whose boards are coming back to this board until `until` (ms): each lands as its frame, one after another,
   * with what it holds, whether it's here already, as on a board just opened, or arrives after.
   */
  expectLanding(until: number, rooms: readonly string[]): void {
    if (until <= Date.now() || !rooms.length) return;
    this.landingUntil = until;
    this.landingFrames = new Set(rooms.map(landedFrameId));
    const landing = landingOf(this.state.view.objects, this.landingFrames);
    if (!landing) return;
    this.set({ landing });
    this.landed(landing);
    this.showLanding();
  }

  /**
   * What's landing, brought into view as it lands, as the board every room shares glides out to its rooms' frames: for someone
   * whose view is still their own, not following anyone, whoever presents included, or in the middle of something on the board.
   */
  private showLanding(): void {
    const { following, edit, pressing, view } = this.state;
    if (this.look.mini || following !== null || edit !== null || pressing || !this.camera.width) return;
    const frames = [...this.landingFrames].filter((id) => view.byId.get(id)?.k === 'frame');
    if (frames.length) this.showFrames(frames);
  }

  /** Lets go of what's landing once the last of it has. */
  private landed(landing: ReadonlyMap<string, number>): void {
    const last = Math.max(0, ...landing.values());
    this.later('landing', (this.sheet ? tokenMs(this.sheet, '--bd-glide') : 700) + last + 100, () => this.set({ landing: NONE_LANDING }));
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
    this.justPut.heard();
    const { view: was, sel, edit, landed } = this.state;
    const view = this.overlay.over(this.written);
    const patch: Partial<BoardState> = { view };
    if (sel.some((id) => !view.byId.has(id))) patch.sel = sel.filter((id) => view.byId.has(id));
    const arrived = view.objects.length > was.objects.length ? view.objects.filter((o) => !was.byId.has(o.id)) : [];
    // Rooms' boards coming back land frame by frame; anything else that arrives pops in.
    const landing = Date.now() < this.landingUntil ? landingOf(arrived, this.landingFrames) : null;
    if (landing) patch.landing = landing;
    const popping = landing ? arrived.filter((o) => !landing.has(o.id)) : arrived;
    if (popping.length && popping.length <= POP_AT_ONCE) patch.landed = new Set([...landed, ...popping.map((o) => o.id)]);
    this.set(patch);
    if (patch.landed && this.sheet) this.later('landed', tokenMs(this.sheet, '--duration-2') * 2, () => this.set({ landed: NOTHING }));
    if (landing) {
      this.landed(landing);
      this.showLanding();
    }
    if (edit && !view.byId.has(edit)) {
      this.editTaken();
      const kind = was.byId.get(edit)?.k;
      const said = kind && DELETED[kind];
      if (said) this.onSay?.(said, 'trash');
    }
    // What first arrives on a board nobody's moved round yet, as a template or a saved board's content does just after it opens,
    // is framed as the canvas frames it, centred on what's there; and anything of yours that runs off the sheet is brought in.
    // Drawn small, what's shown is all there is.
    if (this.look.mini) this.fitShown(false);
    else if (!was.objects.length && this.untouched && (heard || !this.allInView(view))) this.fitAll(false, true);
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

  /**
   * A change of this person's that arrives in its own time, such as Sort's answer or a picture of a screen, as an undo of its own
   * whatever step is under way: typing on, dragging, or a blank sticky going again leaves it be. Returns the step it made, to
   * take back by itself, or null if it changed nothing.
   */
  writeApart<T>(change: () => T): { result: T; step: BoardStep | null } {
    this.untouched = false;
    const done = this.history ? this.history.separate(change) : { result: change(), step: null };
    this.read();
    return done;
  }

  /** Goes a step back or forward, for whoever `may`. If one can't finish, what went back stays back and the board carries on. */
  private travel(step: (history: BoardHistory) => StepResult, may = this.canEdit): void {
    const { history } = this;
    if (!history || this.stepping || !may) return;
    const result = this.settle(() => step(history));
    if (!result.ok) log.error('undo failed', { err: result.error });
    this.set({ sel: [] });
  }

  /** Takes back this person's last change, and only theirs, whatever anyone else has done since. */
  undo(): void {
    this.travel((history) => history.undo());
  }

  /**
   * Takes back one change of this person's, wherever it is in their undo, if it hasn't been taken back already. It's what a
   * toast's Undo does, so a phone has it too for what it adds, though its bar has no Undo.
   */
  undoStep(step: BoardStep): void {
    this.travel((history) => history.undoStep(step), this.canAdd);
  }

  /**
   * Moves something this person has just put on the board, as if it had gone there in the first place: undoing what put it
   * there takes it away from where it is now, and no undo puts it back where it was (`BoardHistory.amend`). It glides there.
   */
  moveAsPut(id: string, to: { x: number; y: number }): void {
    const { history } = this;
    const move = (): void => moveObjects(this.doc, [{ id, x: to.x, y: to.y }], this.origin);
    this.settle(() => (history ? history.amend(id, move) : move()));
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
    this.ownView();
    this.letGo();
    this.finishEdit();
    const options = OPTIONS[tool] ?? null;
    const { tool: was, fly } = this.state;
    this.set({ ...CLOSED, tool, sel: [], hover: null, fly: tool === was && fly === options ? null : options });
  }

  /** Night board, from the bar's More: makes the board dark in any theme, for everyone, or lets it follow each person's theme again. */
  toggleNight(): void {
    if (this.canAdd) this.nightBoard(!this.state.night);
  }

  /**
   * Night board on or off, for everyone, and what that did said to whoever pressed it, the same from either menu. It's for whoever
   * can change the board, which whoever offers it makes sure of.
   */
  nightBoard(on: boolean): void {
    setNight(this.doc, on, this.origin);
    this.tell(on ? NIGHT_SAID.on : NIGHT_SAID.off, { icon: 'moon', topic: 'board-night' });
  }

  /** More, beside the rail. */
  toggleMore(): void {
    this.ownView();
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
    const { fly, picking, menu, voteMenu, barMenu } = this.state;
    if (fly || picking || menu || voteMenu || barMenu) this.set({ fly: null, picking: false, menu: false, voteMenu: false, barMenu: false });
  }

  /** The bar's More: opens it, in place of anything else open over the sheet, or closes it. */
  toggleBarMenu(): void {
    this.set({ ...CLOSED, barMenu: !this.state.barMenu });
  }

  /** The bar's Vote: opens its menu, in place of anything else open over the sheet, or closes it if it's open. */
  toggleVoteMenu(): void {
    this.set({ ...CLOSED, voteMenu: !this.state.voteMenu });
  }

  /* ---------- sort into themes ---------- */

  /**
   * Sort into themes, on the stickies picked. `ask` is given what each of them says now, and asks confidential compute, which
   * answers with the themes. They're written as this person's change, an undo of its own whatever they've started meanwhile, so
   * the stickies travel into their themes together and one undo puts it all back. The toast says how many themes there are, and
   * its Undo takes back the sort itself, whatever's been done since. A board that has closed meanwhile writes nothing, and one
   * that couldn't be sorted says so.
   */
  async sortIntoThemes(stickies: readonly string[], ask: SortAsk): Promise<void> {
    if (!this.canEdit || this.state.sorting || stickies.length < 2) return;
    this.set({ sorting: true });
    try {
      const themes = await ask(stickies.flatMap((id) => {
        const o = this.written.byId.get(id);
        return o?.k === 'note' ? [{ id, text: o.t }] : [];
      }));
      if (!this.sheet || !this.canEdit) return;
      // What's left of the answer: a sticky deleted meanwhile has nowhere to go, and a theme with none left isn't drawn.
      const found = themes.filter((t) => t.ids.some((id) => this.written.byId.get(id)?.k === 'note'));
      if (!found.length) {
        this.tell('Those stickies have gone, so there was nothing to sort.');
        return;
      }
      const { step } = this.settle(() => this.writeApart(() => applyThemes(this.doc, found, this.origin)));
      this.set({ sel: [] });
      this.tell(`Sorted into ${found.length} ${found.length === 1 ? 'theme' : 'themes'}.`, { icon: 'group', ...(step ? { action: { label: 'Undo', onClick: () => this.undoStep(step) } } : {}) });
    } catch (e) {
      // What was picked can't be sorted, and the answer says why; anything else is worth trying again.
      const picked = errorCode(e) === 'invalid';
      if (picked) log.info('sort into themes refused', { stickies: stickies.length });
      else log.warn('sort into themes failed', { code: errorCode(e), stickies: stickies.length });
      if (this.sheet) this.tell(picked ? errorMessage(e) : 'Couldn’t sort these into themes. Try again.');
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
    const { tool, sel, following, fly, voteMenu, barMenu } = this.state;
    if (!held && tool === 'select' && !sel.length && !following && !fly && !voteMenu && !barMenu) return false;
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
    this.set({ edit: id, cell: null, sel: [id], tool: 'select' });
  }

  /** Opens a table's cell for typing, in the words everyone has for it: they came with its row and column (`bindCell`). */
  startCell(id: string, row: string, col: string): void {
    const o = this.state.view.byId.get(id);
    if (!this.canEdit || o?.k !== 'table' || !o.rows.some((r) => r.id === row) || !o.cols.some((c) => c.id === col)) return;
    this.finishEdit();
    this.beginStep();
    this.cellBefore = o.cells[cellKey(row, col)] ?? '';
    this.set({ edit: id, cell: { row, col }, sel: [id], tool: 'select' });
  }

  /**
   * Moves focus off the field being typed in before the board puts another in its place, as Escape does. Taken away while it
   * still has focus, a field gives it up in the middle of React's commit, and everything listening for that runs there: in a
   * test it's user-event's own listener, whose act can't run inside React's, and in a browser anything else that listens.
   */
  private leaveField(): void {
    const field = document.activeElement;
    if (field instanceof HTMLTextAreaElement && this.sheet?.contains(field)) this.focusSheet();
  }

  /** Tab in a table: the next cell along, or the first of the next row; back with Shift. Off the end, it closes. */
  nextCell(back: boolean): void {
    const { edit, cell, view } = this.state;
    const o = edit ? view.byId.get(edit) : undefined;
    if (o?.k !== 'table' || !cell) return;
    this.leaveField();
    const keys = o.rows.flatMap((r) => o.cols.map((c) => ({ row: r.id, col: c.id })));
    const at = keys.findIndex((k) => k.row === cell.row && k.col === cell.col);
    const next = keys[at + (back ? -1 : 1)];
    if (next) this.startCell(o.id, next.row, next.col);
    else this.finishEdit();
  }

  /** Stops typing. A sticky made for this and left blank goes again, leaving nothing to undo, unless something hangs off it by then: taking that too couldn't be undone. */
  finishEdit(): void {
    const { edit, cell } = this.state;
    if (!edit) return;
    this.flushTyping?.();
    const before = this.cellBefore;
    this.cellBefore = null;
    if (cell) {
      // A cell opened empty and left empty has nothing in it to take back, even where opening it made a cell the table was missing.
      const now = readBoard(this.doc, this.written).byId.get(edit);
      const left = now?.k === 'table' ? now.cells[cellKey(cell.row, cell.col)] ?? '' : null;
      this.set({ edit: null, cell: null });
      if (before === '' && left === '') { this.stepping = false; this.history?.drop(); this.read(); return; }
      this.endStep();
      return;
    }
    const text = objectText(this.doc, edit);
    const blank = this.fresh === edit && text !== null && !text.toString().trim() && !hangsOff(readBoard(this.doc, this.written), this.doc.getMap<unknown>(BOARD_COMMENTS), edit, this.freshLine);
    this.fresh = null;
    this.freshLine = null;
    if (blank) removeObjects(this.doc, [edit], this.origin);
    this.set({ edit: null, cell: null });
    if (!blank) {
      this.endStep();
      return;
    }
    // Adding it and taking it away came to nothing, so it isn't left to undo.
    this.stepping = false;
    this.history?.drop();
    this.read();
  }

  /**
   * Typing ended without this person asking. They may not know yet, so what they type next waits, or it would go to the call,
   * and the board's keys sleep until they click or press Esc, or the rest of it would reach the tools.
   */
  private editTaken(): void {
    if (this.state.edit && editable(document.activeElement) && this.sheet?.contains(document.activeElement)) {
      holdKeys(() => this.focusSheet());
      holdBoardKeys();
    }
    this.finishEdit();
  }

  /** The field lost focus with nothing pressed and nothing taking it, because something moved or hid it. Focus has already gone to the page, so what comes next has to wait all the same. */
  fieldLost(): void {
    if (!this.state.edit) return;
    holdKeys(() => this.focusSheet());
    holdBoardKeys();
    this.finishEdit();
  }

  /** Tab: finishes this one and starts the next beside it, in the same colour. With no room for it, this one stays open. */
  nextSticky(): void {
    const { edit, view } = this.state;
    const o = edit ? view.byId.get(edit) : undefined;
    if (!o || !hasBox(o)) return;
    this.leaveField();
    if (this.doc.getMap<unknown>(BOARD_OBJECTS).size >= BOARD_LIMITS.objects) {
      this.refuse();
      return;
    }
    const { x, y } = nextSpot(view, o);
    const colour = o.k === 'note' ? o.c : o.k === 'shape' && o.c ? o.c : undefined;
    this.finishEdit();
    this.newSticky(x, y, colour);
  }

  /* ---------- what More adds ---------- */

  /**
   * Where something from More lands, `w` by `h`, in board units: the middle of what this person sees, or the nearest place to
   * it with nothing there, so it never lands on what's on the board.
   */
  middle(w: number, h: number): { x: number; y: number } {
    if (!this.camera.width) return freeNear(this.state.view, { x: 0, y: 0 }, w, h);
    const seen = this.camera.visible();
    return freeNear(this.state.view, { x: Math.round(seen.x + seen.w / 2 - w / 2), y: Math.round(seen.y + seen.h / 2 - h / 2) }, w, h);
  }

  /** A table of three by three, in the middle of the view, with its first cell open for typing. */
  addTable(): void {
    if (!this.canEdit) return;
    const cols = [0, 1, 2].map(() => ({ id: newId(), size: TABLE.col })), rows = [0, 1, 2].map(() => ({ id: newId(), size: TABLE.row }));
    const w = TABLE.col * cols.length, h = TABLE.row * rows.length;
    this.finishEdit();
    const id = addObject(this.doc, { k: 'table', ...this.middle(w, h), w, h, rows, cols, cells: {} }, this.origin);
    if (!id) { this.refuse(); return; }
    this.read();
    const [row] = rows, [col] = cols;
    if (row && col) this.startCell(id, row.id, col.id);
    this.reveal(id);
  }

  /** Another row or column at the end of a table, and the table that much bigger, all one undo. */
  growTable(id: string, axis: TableAxis): void {
    const o = this.state.view.byId.get(id);
    if (!this.canEdit || o?.k !== 'table') return;
    const lines = o[axis];
    const size = lines.length ? lines.reduce((n, l) => n + l.size, 0) / lines.length : axis === 'cols' ? TABLE.col : TABLE.row;
    // The new line takes its share of the table at the size the others have now on the board, so nothing else shrinks.
    const scale = axis === 'cols' ? o.w / Math.max(1, lines.reduce((n, l) => n + l.size, 0)) : o.h / Math.max(1, lines.reduce((n, l) => n + l.size, 0));
    this.finishEdit();
    this.beginStep();
    const added = addTableLine(this.doc, id, axis, lines.length, size, this.origin);
    if (added) resizeObject(this.doc, id, axis === 'cols' ? { x: o.x, y: o.y, w: o.w + size * scale, h: o.h } : { x: o.x, y: o.y, w: o.w, h: o.h + size * scale }, this.origin);
    this.endStep();
    if (!added) { this.tell(`A table has at most ${lines.length} ${axis === 'cols' ? 'columns' : 'rows'}.`); return; }
    this.read();
  }

  /** Takes a row or a column out of a table, and the table that much smaller. The last one stays. */
  shrinkTable(id: string, axis: TableAxis, line: string): void {
    const o = this.state.view.byId.get(id);
    if (!this.canEdit || o?.k !== 'table' || o[axis].length < 2) return;
    const total = Math.max(1, o[axis].reduce((n, l) => n + l.size, 0));
    const share = (o[axis].find((l) => l.id === line)?.size ?? 0) / total;
    this.finishEdit();
    this.beginStep();
    removeTableLine(this.doc, id, axis, line, this.origin);
    resizeObject(this.doc, id, axis === 'cols' ? { x: o.x, y: o.y, w: Math.max(TABLE.col, o.w * (1 - share)), h: o.h } : { x: o.x, y: o.y, w: o.w, h: Math.max(TABLE.row, o.h * (1 - share)) }, this.origin);
    this.endStep();
    this.read();
  }

  /** A mind map's first idea, in the middle of the view, open for typing. */
  addMindMap(): void {
    if (!this.canEdit) return;
    this.finishEdit();
    this.beginStep();
    // Room for its first branches too, so they land clear of what's there: the first idea at the left of it.
    const at = this.middle(MAP_ROOM.w, MAP_ROOM.h);
    const id = addMindMap(this.doc, { x: at.x + NODE.first.w / 2, y: at.y + MAP_ROOM.h / 2 }, this.origin);
    this.openMade(id);
  }

  /** Tab on a mind map's idea: a new one branching from it, open for typing. */
  branch(): void {
    const { edit } = this.state;
    if (!edit) return;
    this.leaveField();
    this.finishEdit();
    this.beginStep();
    this.openMade(addBranch(this.doc, edit, this.origin), true);
  }

  /** Enter on a mind map's idea: another beside it, from the same one, open for typing. */
  nextIdea(): void {
    const { edit } = this.state;
    if (!edit) return;
    this.leaveField();
    this.finishEdit();
    this.beginStep();
    this.openMade(addSibling(this.doc, edit, this.origin), true);
  }

  /**
   * Something just made, open for typing, which goes again if it's left with nothing in it. Or the board was full. A branch is
   * kept apart from one someone else makes from the same idea at the same moment.
   */
  private openMade(id: string | null, branched = false): void {
    if (!id) {
      this.endStep();
      this.refuse();
      return;
    }
    this.read();
    if (branched) this.justPut.watch([id]);
    this.fresh = id;
    this.set({ edit: id, cell: null, sel: [id], tool: 'select' });
    this.reveal(id);
  }

  /**
   * Brings something into view, clear of the bar, if it's out of sight: something just put on the board where the room it found
   * was, or a sticky Tab has gone to in a vote. The view glides to it at the same zoom, or out as far as it takes to show all of
   * it. Where it's in view already, nothing moves.
   */
  reveal(id: string): void {
    const o = this.state.view.byId.get(id);
    if (!o || !hasBox(o) || !this.camera.width) return;
    const { z } = this.camera.getSnapshot();
    const seen = this.camera.visible();
    const top = (this.look.bar ? BAR_ROOM : 0) / z;
    const room = { x: seen.x, y: seen.y + top, w: seen.w, h: seen.h - top };
    if (contains(room, o.x, o.y) && contains(room, o.x + o.w, o.y + o.h)) return;
    this.takeCamera();
    const fits = o.w * z <= this.camera.width - 2 * EDGE && o.h * z <= this.camera.height - BAR_ROOM - 2 * EDGE;
    this.glideTo(fits ? this.camera.centred({ x: o.x + o.w / 2, y: o.y + o.h / 2 - top / 2, z }) : this.camera.fitting(o, this.look.bar ? undefined : BARE_PAD));
  }

  /** A template from More, beside everything on the board, and the view goes to it. */
  addTemplate(name: TemplateName): void {
    if (!this.canEdit) return;
    this.finishEdit();
    const made = addTemplate(this.doc, name, this.origin);
    this.read();
    if (!made.length) {
      if (name !== 'blank') this.refuse();
      return;
    }
    const boxes = made.flatMap((id) => { const o = this.state.view.byId.get(id); return o && hasBox(o) ? [o] : []; });
    this.set({ sel: made });
    if (boxes.length) {
      this.takeCamera();
      this.glideTo(this.camera.fitting(bounds(boxes), this.look.bar ? undefined : BARE_PAD));
    }
  }

  /**
   * On a phone, a sticky from the sheet, where the sheet said it would go, kept apart from what someone else puts there at the
   * same moment. It isn't picked up: nothing moves under a finger there.
   */
  addFromSheet(input: NewObject): string | null {
    if (!this.canAdd) return null;
    this.untouched = false;
    const id = addObject(this.doc, input, this.origin);
    if (!id) { this.refuse(); return null; }
    this.read();
    this.justPut.watch([id]);
    return id;
  }

  /** Puts something on the board in the middle of the view, selected: a picture, or something from the workspace. */
  addHere(input: NewObject): string | null {
    if (!this.canEdit) return null;
    this.finishEdit();
    const id = addObject(this.doc, input, this.origin);
    if (!id) { this.refuse(); return null; }
    this.read();
    this.set({ sel: [id], tool: 'select' });
    this.reveal(id);
    return id;
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

  /**
   * The person has taken the camera. They've started looking around from here, so following stops and leaves them here, whoever
   * presents included, and a glide ends at once, where it was heading.
   */
  takeCamera(): void {
    this.untouched = false;
    this.home = null;
    this.stopFollow();
    if (this.state.glide) this.set({ glide: false });
  }

  /**
   * What a picture of the board shows (`mini`): a frame alone, filling it, or everything, with none, held there as the sheet and
   * the frame change, and once the frame arrives if it hasn't yet, as the next frame beside whoever presents is.
   */
  present(slide: string | null): void {
    this.wanted = slide;
    if (this.camera.width) this.fitShown(false);
  }

  /** Fits what's shown: on a picture of the board, the frame it shows, alone, or else everything, or as it opens (`opening`), where it can be read. */
  private fitShown(glide: boolean, opening = false): void {
    const want = this.look.mini ? this.wanted : null;
    const frame = want ? this.state.view.byId.get(want) : undefined;
    const slide = frame?.k === 'frame' ? frame.id : null;
    if (this.state.slide !== slide) this.set({ slide });
    if (frame?.k !== 'frame') { this.fitAll(glide, opening); return; }
    const cam = this.camera.fitting(frame, SLIDE_PAD);
    if (glide) this.glideTo(cam);
    else this.camera.set(cam);
  }

  /** Whether all of this is on the sheet. */
  private allInView(view: BoardView): boolean {
    const box = bounds(drawn(view)), seen = this.camera.visible();
    return contains(seen, box.x, box.y) && contains(seen, box.x + box.w, box.y + box.h);
  }

  /**
   * Shows all of the board, or (`opening`) frames it as it opens: on a sheet a phone's width, whoever's looking, that's where
   * it can be read (`phoneCamera`) rather than all of it, too small to read. A picture of a board always shows all of it.
   * Either way it's clear of the pill, while one shows.
   */
  fitAll(glide = true, opening = false): void {
    if (!this.camera.width) return;
    const boxes = drawn(this.state.view);
    const readable = opening && !this.look.mini && (this.look.phone || this.camera.width < PHONE_SHEET);
    const pad = !this.look.bar ? BARE_PAD : this.pill !== null ? CLEAR : undefined;
    const cam = readable ? phoneCamera(this.state.view, this.camera.width, this.camera.height, this.pill !== null) : this.camera.fitting(boxes.length ? bounds(boxes) : BLANK, pad);
    if (glide) this.glideTo(cam);
    else this.camera.set(cam);
  }

  /** `pad`, and below the pill while one shows under the bar. */
  private underPill(pad: Pad): Pad {
    return this.pill !== null && this.look.bar ? { ...pad, t: Math.max(pad.t, CLEAR.t) } : pad;
  }

  /**
   * Which pill shows now, if any. One coming or going frames a board nobody's moved round yet again, clear of it, as the size
   * of the sheet settling does; not while following anyone, whoever presents included, whose pills come and go with them.
   */
  setPill(kind: PillKind | null): void {
    const was = this.pill;
    this.pill = kind;
    if ((was === null) === (kind === null)) return;
    const theirs = (k: PillKind | null) => k === 'following';
    if (!this.framed || !this.untouched || this.look.mini || this.state.following !== null || theirs(was) || theirs(kind) || !this.camera.width) return;
    this.fitShown(true, true);
    // The board framing itself again isn't anyone touching it: it goes on framing what arrives on it, and as the sheet settles.
    this.untouched = true;
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

  /** Fills the sheet with these frames, all of them: everything, when none of them is on the board. */
  showFrames(ids: readonly string[]): void {
    const frames = ids.flatMap((id) => { const f = this.state.view.byId.get(id); return f?.k === 'frame' ? [f] : []; });
    if (!frames.length) { this.showEverything(); return; }
    this.takeCamera();
    this.glideTo(this.camera.fitting(bounds(frames), this.underPill(SLIDE_PAD)));
  }

  /** Fills the sheet with a frame, in the middle, with room above for its title and the pill. */
  focusFrame(id: string): void {
    const frame = this.state.view.byId.get(id);
    if (frame?.k !== 'frame') return;
    this.takeCamera();
    this.glideTo(this.camera.fitting(frame, this.underPill(SLIDE_PAD)));
  }

  /**
   * Whoever presents, stepping through frames: glides to one, clear of the bar, the pill and the pager at the frame's foot, and
   * everyone following them glides with them.
   */
  toFrame(id: string): void {
    const frame = this.state.view.byId.get(id);
    if (frame?.k !== 'frame') return;
    this.takeCamera();
    this.glideTo(this.camera.fitting(frame, PRESENTING_PAD));
  }

  /**
   * Follows someone by their call identity, or with `watching`, whoever presents the board. A tile doesn't: it's a picture of the
   * board, with nothing on it to stop following by.
   */
  follow(id: string | null, watching = false): void {
    if (id === null) this.stopFollow();
    else if (!this.look.mini) this.set({ following: id, watching });
  }

  stopFollow(): void {
    if (!this.state.following) return;
    this.set({ following: null, watching: false });
    this.onFollow?.(null);
  }

  /**
   * This person has started something of their own while following whoever presents: they stop following, where they are, and
   * what they started goes on from there. A vote on a sticky isn't that, as it changes nothing on the board.
   */
  ownView(): void {
    if (!this.state.watching) return;
    this.home = null;
    this.stopFollow();
  }

  /** The outermost frame in the middle of this person's view, or null with none there. */
  private frameInView(): string | null {
    const { view } = this.state;
    const seen = this.camera.visible();
    let at = frameAt(view, seen.x + seen.w / 2, seen.y + seen.h / 2);
    for (let left = view.frames.length; at?.f && left > 0; left -= 1) {
      const up = view.byId.get(at.f);
      at = up?.k === 'frame' ? up : null;
    }
    return at?.id ?? null;
  }

  private cameraMoved = (): void => {
    this.later('rest', REST_MS, () => {
      this.camera.rest();
      this.onRest?.(this.frameInView());
    });
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
