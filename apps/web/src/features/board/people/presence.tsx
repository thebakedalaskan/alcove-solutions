/*
 * Who else is on the board, and what they're told about you. It all goes over the document's awareness: this browser says
 * where it is at most every 100 ms and only when something changed, and what others say is `unknown` until
 * `BoardPresenceSchema` parses it, so a state that doesn't shows nothing. Awareness doesn't say who a browser is. `people`
 * does, and a browser it doesn't name has no pointer, so nobody points under another name.
 *
 * Eight people moving ten times a second has to cost almost nothing, so a pointer's moves never reach React: they're written
 * through a ref, in board units, and the kit eases between them. Only someone appearing, going, typing or talking draws
 * anything, and the objects hear only about who started or stopped editing them.
 */
import { BOARD_REACH, BoardPresenceSchema, NO_PRESENCE, type BoardPresence } from '@alcove/board';
import { BoardPointer, moveBoardPointer, useToast } from '@alcove/ui';
import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore, type RefObject } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import { log as rootLog } from '~/lib/log';
import type { BoardPerson } from '../BoardSurface';
import type { SheetPoint } from '../camera';
import { BoardFollowing, publishedView, sharedView, type SharedView } from './follow';
import { sameIds } from '../selection';
import type { Board } from '../useBoard';

const log = rootLog.child({ component: 'board-presence' });

/** The least time between two things this browser says. */
const PUBLISH_MS = 100;
/** How long a pointer that isn't doing anything stays on the sheet. */
const IDLE_MS = 6000;
/** How long after a key someone still counts as typing. */
const TYPING_MS = 1500;

/** What awareness says changed. */
interface AwarenessChange {
  added: readonly number[];
  updated: readonly number[];
  removed: readonly number[];
}

/** Another browser: what it last said, and when. */
interface Peer {
  state: BoardPresence;
  heard: number;
  /** When its pointer last did anything. */
  moved: number;
}

/** A pointer to draw. `at` is where it appeared: after that it moves through its ref. */
export interface BoardPeer {
  client: number;
  person: BoardPerson;
  at: { x: number; y: number };
  typing: boolean;
}

const NO_POINTERS: readonly BoardPeer[] = [];
const NOBODY_EDITING: ReadonlyMap<string, string> = new Map();

/** To a tenth of a board unit, which is less than a pixel at any zoom, so the numbers stay short. */
const tidy = (n: number): number => Math.round(n * 10) / 10;

const samePoint = (a: BoardPresence['at'], b: BoardPresence['at']): boolean => a?.x === b?.x && a?.y === b?.y;

const samePresence = (a: BoardPresence, b: BoardPresence): boolean =>
  samePoint(a.at, b.at) && samePoint(a.view, b.view) && a.view?.z === b.view?.z && a.view?.h === b.view?.h && a.edit === b.edit && a.typing === b.typing && sameIds(a.sel, b.sel);

const samePointers = (a: readonly BoardPeer[], b: readonly BoardPeer[]): boolean => a.length === b.length && a.every((p, i) => {
  const q = b[i];
  return q !== undefined && p.client === q.client && p.person === q.person && p.typing === q.typing;
});

const sameEditing = (a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean => a.size === b.size && [...a].every(([id, colour]) => b.get(id) === colour);

const onTheBoard = (p: { x: number; y: number } | null): boolean => !p || (Math.abs(p.x) <= BOARD_REACH && Math.abs(p.y) <= BOARD_REACH);

/** A browser that has said nothing about itself yet, as every one starts. That's no reason to look into it. */
const saidNothing = (state: unknown): boolean => typeof state === 'object' && state !== null && !('at' in state);

export class BoardPresenceStore {
  readonly following: BoardFollowing;

  private readonly board: Board;
  private readonly awareness: Awareness;
  private readonly peers = new Map<number, Peer>();
  private readonly pointerEls = new Map<number, HTMLElement>();
  /** Browsers whose state was refused, so that each goes in the log once. */
  private readonly refused = new Set<number>();
  private readonly listeners = new Set<() => void>();
  private people: readonly BoardPerson[] = [];
  private clients: ReadonlyMap<number, BoardPerson> = new Map();
  private pointers = NO_POINTERS;
  private editing = NOBODY_EDITING;
  private idle: ReturnType<typeof setTimeout> | undefined;

  /** Where this person's pointer is on the sheet, which stays put while the board moves under it. */
  private pointer: SheetPoint | null = null;
  private typing = false;
  private typed: ReturnType<typeof setTimeout> | undefined;
  private sent: BoardPresence = NO_PRESENCE;
  private sentAt = 0;
  private waiting: ReturnType<typeof setTimeout> | undefined;
  private sel: readonly string[] = [];
  private edit: string | null = null;

  constructor(board: Board, awareness: Awareness) {
    this.board = board;
    this.awareness = awareness;
    this.following = new BoardFollowing(board, this);
  }

  getPointers = (): readonly BoardPeer[] => this.pointers;
  getEditing = (): ReadonlyMap<string, string> => this.editing;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** Starts saying where this person is and listening for everyone else. Returns how to stop, which takes this person off the board. */
  attach(sheet: HTMLElement): () => void {
    const { board, awareness } = this;
    const stopPointer = board.watchPointer(this.pointerMoved);
    const stopCamera = board.camera.subscribe(this.changed);
    const stopBoard = board.subscribe(this.boardChanged);
    const size = new ResizeObserver(() => {
      this.changed();
      this.following.refit();
    });
    size.observe(sheet);
    sheet.addEventListener('input', this.keyed);
    awareness.on('change', this.heardChange);
    this.heardChange({ added: [...awareness.getStates().keys()], updated: [], removed: [] });
    const stopFollowing = this.following.attach(sheet);
    this.changed();
    return () => {
      awareness.off('change', this.heardChange);
      sheet.removeEventListener('input', this.keyed);
      size.disconnect();
      stopFollowing();
      stopBoard();
      stopCamera();
      stopPointer();
      clearTimeout(this.waiting);
      clearTimeout(this.typed);
      clearTimeout(this.idle);
      this.waiting = undefined;
      this.idle = undefined;
      this.pointer = null;
      this.typing = false;
      this.peers.clear();
      this.refused.clear();
      this.refresh();
      const local = awareness.getLocalState();
      if (local) awareness.setLocalState({ ...local, ...NO_PRESENCE });
      this.sent = NO_PRESENCE;
    };
  }

  /** Who's who changed. */
  setPeople(people: readonly BoardPerson[]): void {
    this.people = people;
    this.clients = new Map(people.flatMap((p) => p.clients.map((client) => [client, p] as const)));
    this.refresh();
    this.following.heard();
  }

  viewOf(id: string): SharedView | null {
    let latest: Peer | null = null;
    for (const [client, peer] of this.peers) {
      if (peer.state.view && this.clients.get(client)?.id === id && (!latest || peer.heard > latest.heard)) latest = peer;
    }
    const view = latest?.state.view;
    return view ? sharedView(view) : null;
  }

  nameOf(id: string): string | undefined {
    return this.people.find((p) => p.id === id)?.name;
  }

  /** A pointer on the sheet, or null as it goes. This is how its moves get there without drawing it. */
  holdPointer(client: number, el: HTMLElement | null): void {
    if (el) this.pointerEls.set(client, el);
    else this.pointerEls.delete(client);
  }

  /* ---------- what this browser says ---------- */

  private pointerMoved = (at: SheetPoint | null): void => {
    this.pointer = at;
    this.changed();
  };

  private boardChanged = (): void => {
    const { sel, edit } = this.board.getSnapshot();
    if (sel === this.sel && edit === this.edit) return;
    this.sel = sel;
    this.edit = edit;
    this.changed();
  };

  /** Anything that's a key in a field on the sheet, a word being composed included. */
  private keyed = (): void => {
    this.typing = true;
    clearTimeout(this.typed);
    this.typed = setTimeout(() => {
      this.typing = false;
      this.changed();
    }, TYPING_MS);
    this.changed();
  };

  /** Says what changed now, or as soon as it's been long enough. */
  private changed = (): void => {
    if (this.waiting !== undefined) return;
    const wait = this.sentAt + PUBLISH_MS - performance.now();
    if (wait > 0) this.waiting = setTimeout(this.publish, wait);
    else this.publish();
  };

  private publish = (): void => {
    this.waiting = undefined;
    const next = this.now();
    const local = this.awareness.getLocalState();
    if (!local || samePresence(next, this.sent)) return;
    this.sent = next;
    this.sentAt = performance.now();
    this.awareness.setLocalState({ ...local, ...next });
  };

  private now(): BoardPresence {
    const { pointer, board: { camera } } = this;
    const { sel, edit } = this.board.getSnapshot();
    const { x, y, z } = camera.getSnapshot();
    const view = camera.width ? publishedView(camera.place(), camera.width, camera.height) : null;
    return {
      at: pointer && { x: tidy((pointer.sx - x) / z), y: tidy((pointer.sy - y) / z) },
      view: view && { x: tidy(view.x), y: tidy(view.y), z: Number(view.z.toPrecision(4)), ...(view.h === undefined ? {} : { h: Number(view.h.toPrecision(4)) }) },
      sel: [...sel],
      edit,
      typing: this.typing && edit !== null
    };
  }

  /* ---------- what everyone else says ---------- */

  private heardChange = ({ added, updated, removed }: AwarenessChange): void => {
    for (const client of removed) this.peers.delete(client);
    for (const client of added) this.read(client);
    for (const client of updated) this.read(client);
    this.refresh();
    this.following.heard();
  };

  private read(client: number): void {
    if (client === this.awareness.clientID) return;
    const said: unknown = this.awareness.getStates().get(client);
    const parsed = BoardPresenceSchema.safeParse(said);
    if (!parsed.success || !onTheBoard(parsed.data.at) || !onTheBoard(parsed.data.view)) {
      this.peers.delete(client);
      if (!saidNothing(said) && !this.refused.has(client)) {
        this.refused.add(client);
        log.info('board presence refused', { client });
      }
      return;
    }
    const state = parsed.data, was = this.peers.get(client), heard = performance.now();
    const still = was && was.state.typing === state.typing && samePoint(was.state.at, state.at);
    this.peers.set(client, { state, heard, moved: still ? was.moved : heard });
    const el = this.pointerEls.get(client);
    if (el && state.at) moveBoardPointer(el, state.at.x, state.at.y);
  }

  /** Works out what's on the sheet, and tells whoever draws it only if that's different. */
  private refresh(): void {
    const time = performance.now();
    // Your own pointer isn't drawn, and that goes for one in another window too.
    const me = this.clients.get(this.awareness.clientID)?.id;
    const pointers: BoardPeer[] = [];
    const editing = new Map<string, string>();
    let soonest = Infinity;
    for (const [client, { state, moved }] of this.peers) {
      const person = this.clients.get(client);
      if (!person || person.id === me) continue;
      if (state.edit && !editing.has(state.edit)) editing.set(state.edit, person.colour);
      if (!state.at) continue;
      // Typing doesn't say anything new with each key, so it's all that keeps someone's pointer here while they do.
      const going = moved + IDLE_MS;
      if (!state.typing && time >= going) continue;
      pointers.push({ client, person, at: state.at, typing: state.typing });
      if (!state.typing) soonest = Math.min(soonest, going);
    }
    if (soonest !== Infinity && this.idle === undefined) {
      this.idle = setTimeout(() => {
        this.idle = undefined;
        this.refresh();
      }, soonest - time);
    }
    const drawn = !samePointers(pointers, this.pointers), marked = !sameEditing(editing, this.editing);
    if (drawn) this.pointers = pointers;
    if (marked) this.editing = editing;
    if (drawn || marked) for (const listener of this.listeners) listener();
  }
}

/** Everything about who else is here, for one surface. A tile is a picture of the board, so it says nothing and shows nobody. */
export function useBoardPresence(board: Board, awareness: Awareness, sheet: RefObject<HTMLElement | null>, people: readonly BoardPerson[], picture: boolean): BoardPresenceStore {
  const toast = useToast();
  const presence = useMemo(() => new BoardPresenceStore(board, awareness), [board, awareness]);
  useLayoutEffect(() => {
    presence.following.say = (text) => { toast(text, { icon: 'eye' }); };
  }, [presence, toast]);
  useLayoutEffect(() => presence.setPeople(people), [presence, people]);
  useLayoutEffect(() => (sheet.current && !picture ? presence.attach(sheet.current) : undefined), [presence, sheet, picture]);
  return presence;
}

/** What others have open: an object's id, and the colour of whoever is editing it. */
export function useOthersEditing(presence: BoardPresenceStore): ReadonlyMap<string, string> {
  return useSyncExternalStore(presence.subscribe, presence.getEditing);
}

function Pointer({ presence, peer, talking }: { presence: BoardPresenceStore; peer: BoardPeer; talking: boolean }) {
  const { client, at, typing, person: { person, name, colour } } = peer;
  const hold = useCallback((el: HTMLDivElement | null) => presence.holdPointer(client, el), [presence, client]);
  return <BoardPointer ref={hold} x={at.x} y={at.y} person={person} name={name} colour={colour} talking={talking} typing={typing} />;
}

/** Everyone else's pointers, for `BoardWorld`'s `pointers`. */
export function BoardPointers({ presence, talking }: { presence: BoardPresenceStore; talking: ReadonlySet<string> | undefined }) {
  const pointers = useSyncExternalStore(presence.subscribe, presence.getPointers);
  return pointers.map((peer) => <Pointer key={peer.client} presence={presence} peer={peer} talking={talking?.has(peer.person.id) ?? false} />);
}
