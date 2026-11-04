/*
 * What the ProseMirror side and the React side of the editor share: the latest props, the live view, and small
 * stores React reads with `useSyncExternalStore`. ProseMirror owns the text; these hold what's drawn around it.
 */
import type { EditorView } from 'prosemirror-view';
import type { ReactNode } from 'react';
import type { Person } from '@alcove/api';
import type { EditorProps, MovingBlock, Point, Rect } from './types';

/** A value React can subscribe to. */
export class Store<T> {
  private listeners = new Set<() => void>();
  constructor(private value: T) {}
  readonly get = (): T => this.value;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  set(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    this.listeners.forEach((l) => l());
  }
}

/** Something drawn by React inside DOM that ProseMirror placed: a media block, a face in a tag. */
export interface PortalEntry { key: number; dom: HTMLElement; render: () => ReactNode }

/** Everything React draws into the page. */
export class Portals extends Store<readonly PortalEntry[]> {
  private next = 1;
  private entries = new Map<number, PortalEntry>();
  constructor() { super([]); }
  add(dom: HTMLElement, render: () => ReactNode): number {
    const key = this.next++;
    this.entries.set(key, { key, dom, render });
    this.publish();
    return key;
  }
  update(key: number, render: () => ReactNode): void {
    const was = this.entries.get(key);
    if (!was) return;
    this.entries.set(key, { ...was, render });
    this.publish();
  }
  remove(key: number): void {
    if (this.entries.delete(key)) this.publish();
  }
  private publish(): void { this.set([...this.entries.values()]); }
}

/** A menu that's open. Slash and mention follow the text before the caret; the rest are opened by something. */
export type OpenMenu =
  | { kind: 'slash'; block: string; from: number; to: number; query: string }
  | { kind: 'mention'; block: string; from: number; to: number; query: string }
  /** Link to a document: documents only, with nothing to take out of the line. */
  | { kind: 'documents'; block: string }
  | { kind: 'moment'; block: string }
  | { kind: 'block'; block: string; rect: Rect }
  | { kind: 'move'; block: string; rect: Rect }
  | { kind: 'link'; from: number; to: number; href: string; rect: Rect };

/** The format bar: over the selection, with what's on there. */
export interface FormatBarState { rect: Rect; bold: boolean; italic: boolean; strike: boolean; link: boolean; highlight: boolean }

/** Someone else's caret, relative to the editor. `tag` shows their name, which fades after 3 s of quiet. */
export interface Caret { client: number; top: number; left: number; height: number; name: string; person: Person | undefined; tag: boolean }

/** A block being dragged. `line` is where it will land, relative to the editor, or null over somewhere it can't go. */
export interface DragState { block: MovingBlock; at: Point; line: number | null; target: { id: string; side: 'before' | 'after' } | null; outside: boolean }

/** Files coming in from the desktop: `line` is where they'd land, `after` the block that's below. */
export interface FileDragState { line: number; after: string }

/** A comment thread, as the margin and the marks need it. */
export interface ThreadView { open: boolean; count: number }

export class EditorRuntime {
  props: EditorProps;
  view: EditorView | null = null;
  /** The element everything's measured against: what carets, the gutter and landing lines sit in. */
  root: HTMLElement | null = null;
  /** The people in `props.people`, by ID. */
  people = new Map<string, Person>();
  readonly portals = new Portals();
  readonly menu = new Store<OpenMenu | null>(null);
  readonly bar = new Store<FormatBarState | null>(null);
  readonly carets = new Store<readonly Caret[]>([]);
  readonly drag = new Store<DragState | null>(null);
  readonly fileDrag = new Store<FileDragState | null>(null);
  /** The block under the pointer, for the handles. */
  readonly hover = new Store<string | null>(null);
  /** Open threads, by ID, kept current from the `comments` map. */
  readonly threads = new Store<ReadonlyMap<string, ThreadView>>(new Map());
  /** Counts every redraw of the page, so what's measured against it can measure again. */
  readonly layout = new Store(0);
  /** Counts changes to what `documentName` might say, so tags in the text can say it again. */
  readonly names = new Store(0);
  /** Where the byline goes: ProseMirror keeps this under the title. */
  readonly byline: HTMLElement;
  /** A mouse button is down on the text, so the selection is still being made. */
  selecting = false;
  /** A menu was closed with Esc while the caret stayed in this trigger, so it stays closed. */
  dismissed: number | null = null;

  constructor(props: EditorProps) {
    this.props = props;
    this.byline = document.createElement('div');
    this.byline.className = 'wd-by-slot';
    this.byline.contentEditable = 'false';
  }

  get readOnly(): boolean { return this.props.readOnly === true; }

  /** Asks ProseMirror to draw again, after something it reads from here changed. */
  refresh(): void {
    const v = this.view;
    if (v) v.dispatch(v.state.tr);
  }
}
