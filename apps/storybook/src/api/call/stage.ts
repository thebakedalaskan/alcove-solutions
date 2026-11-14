/*
 * What's open and presented in each part of the call, as the server keeps it, and what you see of it where you are: the
 * board open there (or the main room's, for a room that shares it), what's presented and how the last presentation ended,
 * and who's on the board with you. Presenting the workspace or a board, moving it on and stopping it, are here too.
 */
import { AlcoveApiError, type BreakoutBoardMode, type CallBoard, type CallParticipant, type CallPresent, type CallSeat, type PresentStart } from '@alcove/api';
import { BOARD_VIEW_WIDTH, readBoard, roomFrameId } from '@alcove/board';
import { reading } from '~/features/board/slides';
import { nextId } from '../state';
import { boardDoc, onTheBoard } from '../workspaces/workspaces';
import { CallWithChat } from './chat';

/** How many times as wide as it's tall someone else presenting a board has their sheet: a laptop's stage. */
const PRESENTERS_SHEET = 1.8;

/**
 * What's presented in one part of the call, as the server keeps it: the board open there, and which frame everyone's on, or the
 * workspace everyone views; by whom, by their seat, which holds across their reconnections, as the server's person does; and
 * which presentation it is.
 */
type Presented = { kind: 'board'; by: CallSeat; key: string; id: string; section: number } | { kind: 'workspace'; by: CallSeat; key: string };

export abstract class CallWithStage extends CallWithChat {
  /**
   * The board open in each part of the call, as the server keeps them (`main`, or a room's ID): where it's kept, who opened it,
   * by participant ID, and whether `everyone` can edit it, as one the call made, or a saved one someone let everyone into; and
   * what rooms were opened with to work on.
   */
  protected boards = new Map<string, { at: { workspaceId: string; documentId: string } | null; openedBy: string; everyone: boolean }>();
  protected boardMode: BreakoutBoardMode = 'none';
  /** What's presented in each part of the call: one thing at a time in each. */
  protected presented = new Map<string, Presented>();
  /** How the last presentation in each part of the call ended, until another starts there. */
  protected ended = new Map<string, { key: string; close: boolean; by: CallSeat }>();
  /** Who's on the board where you are besides you, by their connection, and where their pointer is. */
  protected onIt = new Map<string, { x: number; y: number }>();

  /** Where the board shown in a part of the call is open: there, or in a room with none of its own while rooms share the main board, the main room. */
  protected shownAt(place: string): string { return place === 'main' || this.boards.has(place) || this.boardMode !== 'shared' ? place : 'main'; }
  /** Where the board shown where you are is kept, if it's open to you. */
  protected hereAt(): { workspaceId: string; documentId: string } | null { return this.boards.get(this.shownAt(this.crypto.getSnapshot().place))?.at ?? null; }
  /**
   * The board where you are, as the server says it to you: one you can't open says who brought it and nothing of itself, and one
   * in Trash or gone has left. The same board keeps its vote and ideas, since its session carries on.
   */
  private boardHere(was: CallBoard): CallBoard {
    const place = this.crypto.getSnapshot().place;
    const at = this.shownAt(place);
    const b = this.boards.get(at);
    if (!b) return { open: null, timer: null, vote: null, ideas: [] };
    const openedBy = this.getSnapshot().participants.some((p) => p.id === b.openedBy) ? b.openedBy : null;
    const seen = { openedBy, canClose: b.openedBy === this.me.id || this.me.isOrganizer, seal: at === 'main' ? 'Sealed' : 'Sealed to this room', frame: at === place ? null : roomFrameId(place) };
    if (!b.at) return { open: { workspaceId: null, documentId: null, name: null, role: null, everyone: false, ...seen }, timer: null, vote: null, ideas: [] };
    const item = this.itemIn(b.at.workspaceId, b.at.documentId);
    if (!item) return { open: null, timer: null, vote: null, ideas: [] };
    const same = was.open?.documentId === b.at.documentId;
    // Everyone here can edit it as the server says: let in, or in the workspace the call opens to everyone, and not restricted.
    const w = this.getSnapshot().workspace;
    const everyone = b.everyone || (w.everyone && b.at.workspaceId === w.id && !item.restricted);
    return {
      open: { ...b.at, name: item.name, role: item.role ?? 'edit', everyone, ...seen },
      timer: null, vote: same ? was.vote : null, ideas: same ? was.ideas : []
    };
  }
  /** Where someone is in the call now, by their participant ID: the room they're in, or the main room. */
  protected whereIs(id: string): string { return this.getSnapshot().breakouts.open?.rooms.find((r) => r.members.includes(id))?.id ?? 'main'; }
  /** Whoever presents it, on the connection they're on now: none while they're reloading. */
  protected presenterOf(p: Presented): CallParticipant | undefined { return this.getSnapshot().participants.find((x) => x.seat === p.by.seat); }
  protected isMine(p: Presented): boolean { return p.by.seat === this.me.seat; }
  /** Whether someone other than `seat` presents the board open at `at`, there or in a room that shares it, while they're here. */
  protected presentedByOthers(at: string, seat: string): boolean {
    const open = this.boards.get(at)?.at;
    return [...this.presented].some(([place, p]) => p.kind === 'board' && p.id === open?.documentId && this.shownAt(place) === at && p.by.seat !== seat && this.presenterOf(p) !== undefined);
  }
  /**
   * What's presented where you are, as you may know it: the board open there, a frame at a time, or the workspace everyone
   * views. Someone who can open nothing in the workspace is told who's presenting it, and nothing else. A presentation of a
   * board that's closed is over; one whose presenter is reloading is hidden until they're back.
   */
  private presentHere(): CallPresent | null {
    const s = this.getSnapshot();
    const place = this.crypto.getSnapshot().place;
    const p = this.presented.get(place);
    const by = p ? this.presenterOf(p) : undefined;
    if (!p || !by || this.whereIs(by.id) !== place) return null;
    const mine = by.id === this.me.id;
    const seen = { key: p.key, by: this.seatOf(by), mine };
    if (p.kind === 'workspace') {
      const w = s.workspace;
      return w.canOpen && w.id !== null ? { kind: 'workspace', id: w.id, name: null, section: null, ...seen } : { kind: null, id: null, name: null, section: null, ...seen };
    }
    const open = this.boards.get(this.shownAt(place))?.at;
    const item = open?.documentId === p.id ? this.itemIn(open.workspaceId, p.id) : undefined;
    return item ? { kind: 'board', id: p.id, name: item.name, section: p.section, ...seen } : null;
  }
  /** A presentation starts in a part of the call, in place of whatever was presented there, and nothing has ended there since. */
  protected startsHere(place: string, p: Presented): void {
    this.presented.set(place, p);
    this.ended.delete(place);
  }
  /**
   * What's presented in a part of the call ends for good, said there at once, as the server says it (`ended`): for whoever
   * presented it, everyone following keeping it open on their own, or for everyone (`close`). Its presenter, whoever or whatever
   * ended it.
   */
  protected endIt(place: string, p: Presented, close: boolean): void {
    this.presented.delete(place);
    this.ended.set(place, { key: p.key, close, by: p.by });
  }
  /**
   * What's presented in a part of the call ends as `by` ends it, its presenter or the organizer: for whoever presented it, which
   * only they choose, or for everyone (`close`). So a presenter whose presentation closed for everyone without them knows it was
   * the organizer. A board closed for everyone closes in the call too, where it's open: by the organizer always; by anyone else
   * when it's this part of the call's own board or they opened it, and nobody else presents it where it shows. Otherwise it's
   * closed for everyone in this part of the call alone, and the board stays.
   */
  protected endsHere(place: string, close: boolean, by: CallParticipant | undefined): void {
    const p = this.presented.get(place);
    if (!p) return;
    this.endIt(place, p, close);
    const at = this.shownAt(place);
    const mayClose = by !== undefined && (by.isOrganizer || ((at === place || this.boards.get(at)?.openedBy === by.id) && !this.presentedByOthers(at, by.seat)));
    if (p.kind === 'board' && close && mayClose) this.boardOut(at, by);
    this.showBoard();
  }
  /**
   * The board open in a part of the call (`at`) closes for everyone, there and in each room that shares it, as `by` closes it:
   * every presentation of it ends, said at once, for everyone when its presenter or the organizer closed it, and otherwise for
   * its presenter alone, as nobody else closes someone's presentation for everyone. The faces come back, and nothing on it is lost.
   */
  protected boardOut(at: string, by: CallParticipant | undefined): void {
    const open = this.boards.get(at)?.at;
    for (const [place, p] of [...this.presented]) {
      if (p.kind !== 'board' || !open || p.id !== open.documentId || this.shownAt(place) !== at) continue;
      this.endIt(place, p, by !== undefined && (by.isOrganizer || p.by.seat === by.seat));
    }
    this.boards.delete(at);
    this.onIt.clear();
  }
  /** Whoever's gone to another part of the call has left what they presented where they were: it ends there for good, said at once. */
  protected endsMoved(): void {
    for (const [place, p] of [...this.presented]) {
      const by = this.presenterOf(p);
      if (by && this.whereIs(by.id) !== place) this.endIt(place, p, false);
    }
  }
  /** Tells the call what's open where you are now, what's presented there, which rooms are on a board of their own, and who's on yours. */
  protected showBoard(): void {
    // A board presented that isn't open where it was presented any more, or that's in Trash or gone, is over: that's said there.
    for (const [place, p] of [...this.presented]) {
      const open = this.boards.get(this.shownAt(place))?.at;
      if (p.kind === 'board' && (open?.documentId !== p.id || !this.itemIn(open.workspaceId, p.id))) this.endIt(place, p, false);
    }
    const present = this.presentHere();
    const last = this.ended.get(this.crypto.getSnapshot().place) ?? null;
    this.change((s) => ({
      ...s, board: this.boardHere(s.board), workspace: { ...s.workspace, present, ended: last && last.key !== present?.key ? last : null },
      breakouts: s.breakouts.open ? { ...s.breakouts, open: { ...s.breakouts.open, board: this.boardMode, rooms: s.breakouts.open.rooms.map((r) => ({ ...r, board: this.boards.has(r.id) })) } } : s.breakouts
    }));
    this.sayWhoIsOn();
  }
  /**
   * Who's on the board where you are now, as its awareness says them to whoever has it open: someone else presenting it with their
   * view on the frame they're on, as their browser says it, which is what everyone following them sees.
   */
  protected sayWhoIsOn(): void {
    const at = this.hereAt();
    if (!at) return;
    const shown = this.presentersView(at);
    onTheBoard(at.documentId, this.getSnapshot().participants.flatMap((p) => {
      if (p.isMe) return [];
      if (shown && p.seat === shown.seat) return [{ callIdentity: p.id, person: p.person, at: shown.at, view: shown.view }];
      const point = this.onIt.get(p.id);
      return point ? [{ callIdentity: p.id, person: p.person, at: point }] : [];
    }));
  }
  /**
   * Someone else presenting the board where you are: their seat, and their pointer and view on the frame they're on, of its frames
   * in the order they sit, framed with room round it as their sheet would show it: a laptop's stage, `PRESENTERS_SHEET` times as
   * wide as it's tall, which their view says (`h`), as a browser does, so everyone following sees all of it, whatever their shape.
   */
  private presentersView(at: { workspaceId: string; documentId: string }): { seat: string; at: { x: number; y: number }; view: { x: number; y: number; z: number; h: number } } | null {
    const now = this.presented.get(this.crypto.getSnapshot().place);
    if (now?.kind !== 'board' || now.id !== at.documentId || this.isMine(now)) return null;
    const frames = readBoard(boardDoc(at.workspaceId, at.documentId)).frames.filter((f) => !f.f).sort(reading);
    const f = frames[Math.min(now.section, frames.length - 1)];
    if (!f) return null;
    const middle = { x: f.x + f.w / 2, y: f.y + f.h / 2 };
    const wide = Math.max(f.w + 160, (f.h + 200) * PRESENTERS_SHEET);
    return { seat: now.by.seat, at: { x: middle.x + 40, y: middle.y + 30 }, view: { ...middle, z: BOARD_VIEW_WIDTH / wide, h: BOARD_VIEW_WIDTH / PRESENTERS_SHEET } };
  }
  /**
   * The workspace everyone views, for someone who can open it, or a board where it's open, as the server lets either be: one at a
   * time where you are. Presenting while you present something presents this in its place; the same again is the same one.
   */
  startPresenting(what: PresentStart): Promise<void> {
    const place = this.crypto.getSnapshot().place;
    const w = this.getSnapshot().workspace;
    if (what.kind === 'workspace' ? w.id === null || !w.canOpen : this.boards.get(this.shownAt(place))?.at?.documentId !== what.id) {
      return Promise.reject(new AlcoveApiError('not-found', `That ${what.kind === 'workspace' ? 'workspace' : 'document'} doesn’t exist, or you don’t have access to it.`));
    }
    const there = this.presented.get(place);
    // Someone else's here, while they're here, is in the way; while they reload it isn't, and it ends for good, said at once. A
    // new one of yours here is the end of your last, as a start clears how the last one ended.
    if (there && !this.isMine(there) && this.presenterOf(there)) return Promise.reject(new AlcoveApiError('conflict', 'Someone else is presenting here.'));
    const mine = there && this.isMine(there) ? there : undefined;
    const same = what.kind === 'workspace' ? mine?.kind === 'workspace' : mine?.kind === 'board' && mine.id === what.id;
    const key = same && mine ? mine.key : nextId('present');
    this.startsHere(place, what.kind === 'workspace' ? { kind: 'workspace', by: this.seat, key } : { kind: 'board', by: this.seat, key, id: what.id, section: what.section ?? 0 });
    if (there && !mine) this.ended.set(place, { key: there.key, close: false, by: there.by });
    this.showBoard();
    return Promise.resolve();
  }
  /** What's presented where you are, while its presenter is here, for whoever started it or the organizer to move on or stop. */
  private presentedHere(): { place: string; now: Presented } | AlcoveApiError {
    const place = this.crypto.getSnapshot().place;
    const now = this.presented.get(place);
    if (!now || !this.presenterOf(now)) return new AlcoveApiError('conflict', 'Nothing is being presented here.');
    if (!this.isMine(now) && !this.me.isOrganizer) return new AlcoveApiError('forbidden', 'Only whoever started this, or the organizer, can do that.');
    return { place, now };
  }
  movePresenting(section: number): Promise<void> {
    const here = this.presentedHere();
    if (here instanceof AlcoveApiError) return Promise.reject(here);
    if (here.now.kind !== 'board') return Promise.reject(new AlcoveApiError('conflict', 'Only a board is presented a frame at a time.'));
    this.presented.set(here.place, { ...here.now, section });
    this.showBoard();
    return Promise.resolve();
  }
  stopPresenting(close: boolean): Promise<void> {
    const here = this.presentedHere();
    if (here instanceof AlcoveApiError) return Promise.reject(here);
    if (!close && !this.isMine(here.now)) return Promise.reject(new AlcoveApiError('forbidden', 'Only whoever’s presenting this can end it just for themselves.'));
    this.endsHere(here.place, close, this.me);
    return Promise.resolve();
  }
}
