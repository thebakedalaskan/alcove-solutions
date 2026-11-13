/*
 * A board in the call: one you open, or one someone in the script opens, made in the call's home and filled from its
 * template as the server fills it; each room's own board, which lands on the main board as the rooms close; the board's
 * vote and the ideas the call hears; and what the others do on it.
 */
import { AlcoveApiError, MAX_CALL_IDEAS, type BoardCheck, type BoardOpen, type BoardTemplate, type BoardVotesEach, type BreakoutBoard, type CallBoardIdea, type CallParticipant, type CallState, type Person } from '@alcove/api';
import { addObject, colourIn, fillTemplate, landBoards, readBoard, roomFrames, type FrameObject } from '@alcove/board';
import { current, nextId } from '../state';
import { boardDoc, createItem, moveItem, peopleIn, removeWorkspace, restrict, trashItem, treeOf } from '../workspaces/workspaces';
import { firstOf } from './base';
import type { HeardIdea } from './script';
import { CallWithWorkspace } from './workspace';

export abstract class CallWithBoards extends CallWithWorkspace {
  /** Each room's own board, which comes back when the rooms close. */
  private roomBoards = new Map<string, { workspaceId: string; documentId: string; name: string; who: string[] }>();

  /**
   * A new board in the call's home, named as the server names it and filled from its template as the server fills it; a room's
   * is restricted, and nobody's. Someone who came with the link has no home to make one in.
   */
  private makeBoard(name: string, template: BoardTemplate, room: boolean): { workspaceId: string; documentId: string } | null {
    this.settleHome();
    const home = this.homeId;
    if (home === null) return null;
    const { id } = createItem(home, { kind: 'board', name });
    if (room) restrict(home, id, true);
    fillTemplate(boardDoc(home, id), template, null, id);
    return { workspaceId: home, documentId: id };
  }
  /** The organizer's participant ID, whoever they are here. */
  private organizerId(): string { return this.getSnapshot().participants.find((p) => p.isOrganizer)?.id ?? this.me.id; }
  /**
   * Rooms open with what they have to work on: a board each, filled, with what its people put on it as the script says; or the
   * main board, or a new one, with an empty frame for each room.
   */
  protected boardsForRooms(board: BreakoutBoard | undefined, rooms: readonly { id: string; name: string; people: readonly Person[]; work?: readonly string[] | undefined }[]): void {
    this.boardMode = board?.mode ?? 'none';
    if (!board || board.mode === 'none') return;
    const by = this.organizerId();
    const who = (people: readonly Person[]) => people.map(firstOf);
    if (board.mode === 'each') {
      for (const r of rooms) {
        const made = this.makeBoard(`${r.name} board`, board.template, true);
        if (!made) continue;
        this.boards.set(r.id, { at: made, openedBy: by, everyone: true });
        this.roomBoards.set(r.id, { ...made, name: r.name, who: who(r.people) });
        const doc = boardDoc(made.workspaceId, made.documentId);
        const frame = readBoard(doc).frames[0] ?? { x: 0, y: 0 };
        (r.work ?? []).forEach((t, i) => this.after((3 + i * 4) * 1000, () => {
          addObject(doc, { k: 'note', x: frame.x + 20 + (i % 2) * 170, y: frame.y + 20 + Math.floor(i / 2) * 170, w: 150, h: 150, c: 'butter', size: 'm', t }, { world: true });
        }));
      }
      return;
    }
    let main = this.boards.get('main')?.at ?? null;
    if (!main) {
      main = this.makeBoard(this.meeting.title, board.template, false);
      if (!main) return;
      this.boards.set('main', { at: main, openedBy: by, everyone: true });
    }
    roomFrames(boardDoc(main.workspaceId, main.documentId), rooms.map((r) => ({ id: r.id, name: r.name, who: who(r.people) })), null);
  }
  /** Rooms close: what was open in them closes, and each room's own board lands on the main board, made for them if there's none. */
  protected boardsBack(): void {
    this.boardMode = 'none';
    for (const id of [...this.boards.keys()]) if (id !== 'main') this.boards.delete(id);
    const coming = [...this.roomBoards].map(([room, b]) => ({ room, ...b }));
    this.roomBoards.clear();
    if (!coming.length) return;
    let main = this.boards.get('main')?.at ?? null;
    if (!main) {
      main = this.makeBoard(this.meeting.title, 'blank', false);
      if (!main) return;
      this.boards.set('main', { at: main, openedBy: this.organizerId(), everyone: true });
    }
    landBoards(boardDoc(main.workspaceId, main.documentId), coming.map((r) => ({ key: r.room, name: r.name, who: r.who, doc: boardDoc(r.workspaceId, r.documentId) })), null);
  }

  /* ---------- the board's script: what other people do on it ---------- */

  /** A frame on a board by its title, or its first. */
  private frameCalled(doc: ReturnType<typeof boardDoc> | null, title: string | null): FrameObject | null {
    if (!doc || title === null) return null;
    const { frames } = readBoard(doc);
    return frames.find((f) => f.title === title) ?? frames[0] ?? null;
  }
  /**
   * Someone makes a new board, the board in the main room, made in the call's home and filled as the server fills it, with
   * what `draw` puts on it; or one you can't open (`closedToYou`). It opens on their stage alone until they present it. Then the others work on it as the script says. With a
   * `standing`, your browser opens it as the world says it stands for you: no connection to it, or what's added here refused.
   */
  protected theyOpenBoard(who: Person, template: BoardTemplate, closedToYou: boolean, draw?: ((doc: ReturnType<typeof boardDoc>) => void) | undefined, standing?: 'offline' | 'failed' | undefined): void {
    const p = this.find(who);
    if (!p) return;
    const at = closedToYou ? null : this.makeBoard(this.meeting.title, template, false);
    if (!closedToYou && !at) return;
    if (at) draw?.(boardDoc(at.workspaceId, at.documentId));
    if (at && standing) current().boards[at.documentId] = { ...current().boards[at.documentId], standing };
    this.boards.set('main', { at, openedBy: p.id, everyone: !closedToYou });
    this.onIt.clear();
    this.onIt.set(p.id, { x: 560, y: 260 });
    this.showBoard();
    this.othersWorkOnIt();
  }
  /** Once the main room's board is open, the others fill it as the script says, a sticky at a time, for as long as it's that board. */
  private othersWorkOnIt(): void {
    const plan = this.script.board;
    const opened = this.boards.get('main');
    if (!plan?.work || !opened?.at) return;
    const at = opened.at;
    const every = plan.every ?? 1.2;
    plan.work.forEach((w, i) => this.after((1 + i * every) * 1000, () => { if (this.boards.get('main') === opened) this.theyAddSticky(w.who, w.frame, w.text, at); }));
  }
  /**
   * A sticky in the first free place in a frame of the board `at` (the one where you are, unless said), two to a row, in the
   * frame's colour; their pointer goes with it.
   */
  protected theyAddSticky(who: Person, title: string, text: string, at: { workspaceId: string; documentId: string } | null = this.hereAt()): void {
    const p = this.find(who);
    const doc = at ? boardDoc(at.workspaceId, at.documentId) : null;
    if (!p || !doc) return;
    const frame = this.frameCalled(doc, title);
    const view = readBoard(doc);
    const fx = frame?.x ?? 0, fy = frame?.y ?? 0;
    const taken = view.objects.flatMap((o) => (o.k === 'note' ? [o] : []));
    const free = (x: number, y: number) => !taken.some((o) => o.x < x + 150 && x < o.x + o.w && o.y < y + 150 && y < o.y + o.h);
    const slot = (i: number) => ({ x: fx + 20 + (i % 2) * 170, y: fy + 20 + Math.floor(i / 2) * 170 });
    let i = 0;
    while (i < 40 && !free(slot(i).x, slot(i).y)) i += 1;
    const { x, y } = slot(i);
    addObject(doc, { k: 'note', x, y, w: 150, h: 150, c: colourIn(view, frame, 'butter'), size: 'm', t: text }, { world: true });
    this.onIt.set(p.id, { x: x + 110, y: y + 120 });
    this.sayWhoIsOn();
  }
  /**
   * Someone moves the board where you are to Trash in the Drive, or the folder it's in (`folder`: the call's folder, where the
   * server makes a call's board, for one that's in none): its own connection says it's in Trash (`trashItem`), it leaves the call
   * for everyone, as the server takes a board in Trash out of it until it's back, and what presented it ends (`showBoard`).
   */
  protected boardToTrash(folder: boolean): void {
    const at = this.hereAt();
    const item = at ? this.itemIn(at.workspaceId, at.documentId) : undefined;
    if (!at || !item) return;
    const into = folder ? item.parent ?? treeOf(at.workspaceId).items.find((i) => i.kind === 'folder' && i.call?.here === true)?.id ?? null : null;
    if (folder && into === null) return;
    if (into !== null && item.parent === null) moveItem(at.workspaceId, item.id, { parent: into });
    trashItem(at.workspaceId, into ?? item.id);
    this.showBoard();
  }
  /**
   * Someone deletes the workspace the board where you are is kept in: its own connection says it was deleted (`removeWorkspace`),
   * it leaves the call for everyone, and what presented it ends. When it's the workspace the call views, or its home, nothing in
   * it opens any more, and opening Workspace again settles on another home.
   */
  protected boardWorkspaceGoes(): void {
    const at = this.hereAt();
    if (!at) return;
    removeWorkspace(at.workspaceId);
    if (this.homeId === at.workspaceId) this.homeId = null;
    if (this.getSnapshot().workspace.id === at.workspaceId) this.space((w) => ({ ...w, id: null, home: this.homeId, name: null, canOpen: false, role: null, everyone: false, documents: [], agenda: null, play: null }));
    this.showBoard();
  }
  /**
   * Whoever opened the board where you are, or the organizer, closes it for everyone there (`boardOut`): the faces come back, and
   * nothing on it is lost. As the server does, nobody but the organizer closes it while someone else presents it. Why not, if not.
   */
  protected boardGoes(by: CallParticipant | undefined): AlcoveApiError | null {
    const at = this.shownAt(this.crypto.getSnapshot().place);
    const b = this.boards.get(at);
    if (!b) return new AlcoveApiError('conflict', 'No board is open here.');
    if (!by || (b.openedBy !== by.id && !by.isOrganizer)) return new AlcoveApiError('forbidden', 'Only whoever opened this board, or the organizer, can close it.');
    if (!by.isOrganizer && this.presentedByOthers(at, by.seat)) return new AlcoveApiError('conflict', 'Someone else is presenting this board. You can close it once they stop.');
    this.boardOut(at, by);
    this.showBoard();
    return null;
  }
  protected theyStartVote(who: Person, title: string | null, per: BoardVotesEach): void {
    const p = this.find(who);
    if (!p) return;
    const at = this.hereAt();
    const frame = this.frameCalled(at ? boardDoc(at.workspaceId, at.documentId) : null, title)?.id ?? null;
    void this.session((b) => (b.vote ? b : { ...b, vote: { on: true, frame, per, left: per, mine: [], results: {}, voters: 0, canEnd: this.me.isOrganizer, startedBy: p.id } }));
  }
  /** The vote ends with everyone else's votes, by what each sticky says, and yours: every count at once, and only for what's in it. */
  protected voteEnds(votes: Readonly<Record<string, number>>, voters: number): void {
    const at = this.hereAt();
    const view = at ? readBoard(boardDoc(at.workspaceId, at.documentId)) : null;
    void this.session((b) => {
      if (!b.vote?.on) return b;
      const frame = b.vote.frame === null ? null : view?.frames.find((f) => f.id === b.vote?.frame) ?? null;
      const notes = (view?.objects ?? []).flatMap((o) => (o.k === 'note' && (!frame || (o.x >= frame.x && o.x < frame.x + frame.w && o.y >= frame.y && o.y < frame.y + frame.h)) ? [o] : []));
      const results: Record<string, number> = {};
      for (const [text, n] of Object.entries(votes)) { const note = notes.find((o) => o.t === text); if (note) results[note.id] = (results[note.id] ?? 0) + n; }
      for (const id of b.vote.mine) results[id] = (results[id] ?? 0) + 1;
      return { ...b, vote: { ...b.vote, on: false, results, voters: voters + (b.vote.mine.length ? 1 : 0) } };
    });
  }

  /* ---------- the board: what you do ---------- */

  /**
   * A new board, in the main room or for the room you're in (then restricted, named for the room, and coming back with it), or
   * a saved one, which only the main room opens. In the main room the others work on it as the script says.
   */
  openBoard(from: BoardOpen): Promise<void> {
    const place = this.crypto.getSnapshot().place;
    // Nobody makes or brings in a board while someone else presents one here: it would take theirs off everyone's stage.
    const there = this.presented.get(place);
    if (there?.kind === 'board' && !this.isMine(there) && this.presenterOf(there) && !('documentId' in from && from.documentId === there.id)) {
      return Promise.reject(new AlcoveApiError('conflict', 'Someone else is presenting a board here. You can start one once they stop.'));
    }
    if ('template' in from) {
      const room = place === 'main' ? undefined : this.getSnapshot().breakouts.open?.rooms.find((r) => r.id === place);
      const at = this.makeBoard(room ? `${room.name} board` : this.meeting.title, from.template, room !== undefined);
      if (!at) return Promise.reject(new AlcoveApiError('forbidden', 'Only someone invited can start a board.'));
      this.boards.set(place, { at, openedBy: this.me.id, everyone: true });
      if (room) this.roomBoards.set(place, { ...at, name: room.name, who: room.people.map(firstOf) });
    } else {
      if (place !== 'main') return Promise.reject(new AlcoveApiError('conflict', 'Open a board from the main room.'));
      // Let in, everyone here can edit it while they're in the call; otherwise it opens for whoever can open it already.
      this.boards.set('main', { at: { workspaceId: from.workspaceId, documentId: from.documentId }, openedBy: this.me.id, everyone: from.letIn });
    }
    this.onIt.clear();
    this.showBoard();
    if (place === 'main') this.othersWorkOnIt();
    return Promise.resolve();
  }
  closeBoard(): Promise<void> {
    const no = this.boardGoes(this.me);
    return no ? Promise.reject(no) : Promise.resolve();
  }
  /**
   * Who here can't open a saved board: anyone who came with the link, and anyone not in its workspace, but for one in the workspace
   * the call opens to everyone, which they can. You may let them in if
   * you may share it: you can edit it, in a workspace you're in.
   */
  boardCheck(workspaceId: string, documentId: string): Promise<BoardCheck> {
    const members = new Set(peopleIn(workspaceId).map((p) => p.person.email.toLowerCase()));
    // The workspace the call opens to everyone opens what isn't restricted in it to everyone here.
    const w = this.getSnapshot().workspace;
    const toCall = w.everyone && w.id === workspaceId && this.itemIn(workspaceId, documentId)?.restricted === false;
    const cannot = toCall ? [] : this.getSnapshot().participants.filter((p) => !p.isMe && (this.guests.has(p.id) || !members.has(p.person.email.toLowerCase()))).map((p) => firstOf(p.person));
    return Promise.resolve({ cannot, mayLetIn: treeOf(workspaceId).role !== null && this.itemIn(workspaceId, documentId)?.role === 'edit' });
  }
  /*
   * The board's session, as the server keeps it: a vote whose counts come only when it ends, everyone else's from the script
   * (`board.votes`) and yours. With no board open, nothing changes.
   */
  protected session(change: (b: CallState['board']) => CallState['board']): Promise<void> {
    this.change((s) => (s.board.open ? { ...s, board: change(s.board) } : s));
    return Promise.resolve();
  }
  startVote(frame: string | null, per: BoardVotesEach): Promise<void> {
    return this.session((b) => (b.vote ? b : { ...b, vote: { on: true, frame, per, left: per, mine: [], results: {}, voters: 0, canEnd: true, startedBy: this.me.id } }));
  }
  castVote(sticky: string): Promise<void> {
    return this.session((b) => (b.vote?.on && !b.vote.mine.includes(sticky) && b.vote.left > 0 ? { ...b, vote: { ...b.vote, mine: [...b.vote.mine, sticky], left: b.vote.left - 1 } } : b));
  }
  takeBackVote(sticky: string): Promise<void> {
    return this.session((b) => (b.vote?.on && b.vote.mine.includes(sticky) ? { ...b, vote: { ...b.vote, mine: b.vote.mine.filter((id) => id !== sticky), left: b.vote.left + 1 } } : b));
  }
  /** You end it: everyone else's votes, as the script has them, and yours. */
  endVote(): Promise<void> {
    this.voteEnds(this.script.board?.votes ?? {}, this.script.board?.voters ?? 0);
    return Promise.resolve();
  }
  clearVote(): Promise<void> { return this.session((b) => (b.vote?.on === false ? { ...b, vote: null } : b)); }
  /*
   * Ideas from the call, as the server offers them: what the script says the call heard (`heard`), for whoever can add to the
   * board where they are while notes are on there, each with the frame it fits. The script decides when, so watching changes
   * nothing; added or put by, they go for everyone.
   */
  watchIdeas(): () => void { return () => undefined; }
  ideasDone(ids: string[]): Promise<void> {
    this.change((s) => ({ ...s, board: { ...s.board, ideas: s.board.ideas.filter((i) => !ids.includes(i.id)) } }));
    return Promise.resolve();
  }
  protected theyAreHeard(heard: readonly HeardIdea[]): void {
    const at = this.hereAt();
    const s = this.getSnapshot();
    const notesOn = (s.capture.room ? s.capture.room.mode : s.capture.mode) === 'on';
    if (!at || s.board.open?.role !== 'edit' || !notesOn) return;
    const { frames } = readBoard(boardDoc(at.workspaceId, at.documentId));
    const ideas = heard.flatMap((h): CallBoardIdea[] => {
      const p = this.find(h.who);
      return p ? [{
        id: nextId('idea'), text: h.text, said: { person: p.person, at: new Date(Date.now() - (h.ago ?? 0) * 1000).toISOString(), words: h.said },
        frame: frames.find((f) => f.title === h.frame)?.id ?? null
      }] : [];
    });
    this.change((x) => ({ ...x, board: { ...x.board, ideas: [...x.board.ideas, ...ideas].slice(-MAX_CALL_IDEAS) } }));
  }
}
