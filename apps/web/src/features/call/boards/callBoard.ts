/*
 * The board in a call, as this browser holds it (docs: Calls and recordings › A board in a call): the board in the part of the
 * call you're in (`CallState.board`), which votes, ideas from the call and breakout rooms hang on, or a saved board you
 * opened just for you, which touches nothing in the call. Whichever is on your stage (layout/onStage.ts) has its session open
 * while you can open it; so does the call's board while it's in the call, for its presented tile. Who you're following on it,
 * and what you're told as it closes, are here too. What's drawn is features/board/CallBoard.tsx, loaded the first time it's
 * needed.
 *
 * And how the call helps with it: ideas from what's said while notes are on, in the tray, and Sort into themes, which goes to
 * confidential compute unless notes are paused (docs: Calls and recordings › A board in a call).
 */
import {
  BOARD_SHOT_TOPIC, BoardShotMessageSchema, DocCallerStateSchema, errorCode, type CallBoardIdea, type CallBoardOpen, type CallSession, type CallState, type DocSession, type DocStatus,
  type Person
} from '@alcove/api';
import type { BoardStep } from '@alcove/board';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { useReducedMotion } from 'motion/react';
import { useToast, wsToast, type BoardIdea } from '@alcove/ui';
import { boardPictures, boardUpload, linkableIn } from '~/features/board/around';
import type { BoardHandle, BoardPerson, BoardPictures } from '~/features/board/BoardSurface';
import type { BoardCommenting } from '~/features/board/comments';
import type { BoardUpload } from '~/features/board/more/items';
import type { BoardItem } from '~/features/board/more/objects';
import type { SortAsk } from '~/features/board/useBoard';
import { usePersonIds } from '~/features/workspace/ids';
import { canKeepEdits } from '~/features/workspace/keep';
import { useOpensAgain } from '~/features/workspace/opened';
import { openDocument } from '~/features/workspace/session';
import { api } from '~/lib/api';
import { captureHere } from '~/lib/capture';
import { log } from '~/lib/log';
import { callName } from '~/lib/people';
import { q, useSortStickies } from '~/lib/queries';
import { agoLabel } from '~/lib/time';

const blog = log.child({ component: 'call-board' });

/** Each person's colour on a board, by their seat in the call, so it holds through their reconnections. */
const WHO = ['var(--who-1)', 'var(--who-2)', 'var(--who-3)', 'var(--who-4)', 'var(--who-5)', 'var(--who-6)'] as const;
function colourOf(seat: string): string {
  let n = 0;
  for (let i = 0; i < seat.length; i++) n = (n * 31 + seat.charCodeAt(i)) >>> 0;
  return WHO[n % WHO.length] ?? WHO[0];
}
/** How long a board that's just opened, or come back, takes to rise: `--bd-rise`, and a moment more. */
const RISE_MS = 700;
/** How long a board closed for everyone takes to sink before the faces come back: the canvas's 420 ms (`--duration-3`). */
const SINK_MS = 420;
/**
 * How long "A board you can't open" waits before it says so. A seat lands a moment after someone's let in, so their first read
 * can say it about a board they're about to have, and the call reads itself again when the seat lands.
 */
export const NO_ACCESS_WAIT_MS = 1500;

/** Whose connection each browser on the board is, as the server says on each awareness line. */
function clientsOf(doc: DocSession, me: string): Map<string, number[]> {
  const by = new Map<string, number[]>();
  const add = (id: string, client: number) => by.set(id, [...(by.get(id) ?? []), client]);
  for (const [client, state] of doc.awareness.getStates()) {
    if (client === doc.awareness.clientID) continue;
    const id = DocCallerStateSchema.safeParse(state).data?.user?.callIdentity;
    if (id) add(id, client);
  }
  // This browser's own state is never stamped back to it, and it's yours.
  add(me, doc.awareness.clientID);
  return by;
}
const sameClients = (a: ReadonlyMap<string, readonly number[]>, b: ReadonlyMap<string, readonly number[]>) =>
  a.size === b.size && [...a].every(([id, c]) => { const d = b.get(id); return d !== undefined && d.length === c.length && c.every((x, i) => d[i] === x); });

/**
 * The board's session, opened from the call with its pass for as long as this board is open here and you can open it, and
 * closed when it isn't. What's typed offline is kept on this device for an account, as any document's is. It opens again as the
 * board's page does (features/workspace/opened.ts): once the connection's back if it couldn't open at all, by itself a little
 * later each time if it can't be opened right now, and with `reopen`, which is Try again: what's kept here goes again.
 */
function useBoardSession(open: CallBoardOpen | null, owner: string | null, pass: string | undefined): { doc: DocSession | null; status: DocStatus | null; reopen: () => void } {
  const workspaceId = open?.role ? open.workspaceId : null;
  const documentId = open?.role ? open.documentId : null;
  const [round, setRound] = useState(0);
  const reopen = useCallback(() => setRound((r) => r + 1), []);
  const [opened, setOpened] = useState<{ key: string; doc: DocSession; ready: boolean } | null>(null);
  useEffect(() => {
    if (!workspaceId || !documentId) { setOpened(null); return undefined; }
    const key = `${workspaceId}/${documentId}`;
    // Another board's session goes at once. This one's, opening again, stays on the stage until the new one's here, as on its
    // page.
    setOpened((was) => (was?.key === key ? was : null));
    let gone = false;
    let held: DocSession | null = null;
    const start = () => {
      openDocument(workspaceId, documentId, owner, pass).then((s) => {
        if (gone) { s.close(); return; }
        held = s;
        setOpened({ key, doc: s, ready: false });
        // One that never opens says why in its status.
        s.ready.then(() => { if (!gone) setOpened({ key, doc: s, ready: true }); }, () => undefined);
      }, (e: unknown) => {
        if (gone) return;
        blog.warn('the board couldn’t be opened in the call', { workspaceId, documentId, code: errorCode(e) });
        addEventListener('online', start, { once: true });
      });
    };
    start();
    return () => {
      gone = true;
      removeEventListener('online', start);
      held?.close();
    };
  }, [workspaceId, documentId, owner, pass, round]);
  const doc = opened?.doc ?? null;
  const status = useDocStatus(doc);
  useOpensAgain(status, opened?.ready ?? false, reopen);
  return { doc, status, reopen };
}

/** Everyone in the call as the board knows them: their name and face, their colour, and their browsers on it. */
function useBoardPeople(doc: DocSession | null, participants: CallState['participants'], me: string) {
  const [clients, setClients] = useState<ReadonlyMap<string, readonly number[]>>(new Map());
  useEffect(() => {
    if (!doc) { setClients(new Map()); return undefined; }
    const read = () => { const now = clientsOf(doc, me); setClients((was) => (sameClients(was, now) ? was : now)); };
    read();
    doc.awareness.on('change', read);
    return () => doc.awareness.off('change', read);
  }, [doc, me]);
  // Rebuilt only when someone comes or goes, from the call or the board: a new list costs the board a render.
  const key = JSON.stringify([participants.map((p) => [p.id, p.seat, p.person.name, p.person.email, p.person.photoUrl ?? '', p.person.portrait ?? null]), [...clients]]);
  return useMemo(() => {
    const people = participants.map((p): BoardPerson => ({ id: p.id, person: p.person, name: p.isMe ? 'You' : callName(p.person), colour: colourOf(p.seat), clients: clients.get(p.id) ?? [] }));
    const onBoard = new Set(people.filter((p) => p.clients.length > 0 && p.id !== me).map((p) => p.id));
    return { people, onBoard };
  }, [key]);
}

/** Something to press in what the call says, such as Undo. */
export interface SaidAction { label: string; onClick: () => void }
/**
 * Comments on the board in the call, as its page has them. Each is written as who you are in the board's workspace: the ID it
 * keys your address under, which is a member's ID there too, and never the address itself; with none known, by name alone.
 * Each writer's face is whoever in the call that ID or name is. Someone who can only look reads them.
 */
function useBoardComments(participants: CallState['participants'], workspaceId: string | null, pass: string, canAdd: boolean): BoardCommenting | undefined {
  const toast = useToast();
  // Rebuilt only when someone comes, goes or changes their name or face, not with every snapshot of the call: new comments
  // cost the board a render.
  const key = JSON.stringify(participants.map((p) => [p.id, p.isMe, p.person.name, p.person.email, p.person.photoUrl ?? '', p.person.portrait ?? null]));
  const people = useMemo(() => participants, [key]);
  const emails = useMemo(() => [...new Set(people.flatMap((p) => (p.person.email ? [p.person.email] : [])))].sort(), [people]);
  const ids = usePersonIds(workspaceId ?? '', pass, emails, workspaceId !== null);
  return useMemo(() => {
    const mine = people.find((p) => p.isMe);
    if (!mine) return undefined;
    const idOf = (p: Person): string => (p.email ? ids.of(p.email) ?? '' : '');
    return {
      me: canAdd ? { by: idOf(mine.person), name: mine.person.name } : null,
      person: mine.person,
      face: (r) => (r.by !== '' ? people.find((p) => idOf(p.person) === r.by) : undefined)?.person
        ?? people.find((p) => p.person.name === r.name)?.person ?? { name: r.name || 'Someone' },
      onResolved: (reopen) => {
        const said = wsToast.resolved(reopen);
        toast(said.text, { icon: said.icon, action: said.action, ms: said.ms });
      }
    };
  }, [people, ids, canAdd, toast]);
}

/** A saved board you opened just for you, from the picker: by where it's kept, and what it's called. */
export interface SavedBoard { workspaceId: string; documentId: string; name: string }

/**
 * What's said when the board in the call leaves it for everyone, but not as a presentation closing for everyone, which the stage
 * says (layout/onStage.ts). Moving to a room, or back, brings that part's board, unsaid. Otherwise it was closed for everyone
 * by whoever opened it or the organizer (`board-close`), and it's still saved where it was; or it was moved to Trash, alone or
 * in a folder, or deleted, its workspace with it, which the board's own session says as it hears it.
 */
function goneWords(name: string, status: DocStatus | null, where: string | null): { text: string; icon: 'x' | 'trash' } {
  if (status?.trashed) return { text: `${name} was moved to Trash, so it closed for everyone.`, icon: 'trash' };
  if (status?.closed === 'deleted') return { text: `${name} was deleted, so it closed for everyone.`, icon: 'trash' };
  return { text: where ? `${name} was closed for everyone. It’s saved in ${where}.` : `${name} was closed for everyone.`, icon: 'x' };
}

export interface CallBoardFacts {
  session: CallSession;
  /** Which board is on your stage: the call's, a saved one just for you, or none. */
  stage: 'call' | 'saved' | null;
  /** The saved board you opened just for you, while you have it. */
  saved: SavedBoard | null;
  state: CallState;
  me: string;
  /** Your account, for keeping what's typed offline: null for a guest. */
  owner: string | null;
  /** Who's talking now, by connection. */
  talking: readonly string[];
  say: (text: string, icon: 'presentation' | 'lock' | 'eye' | 'image' | 'x' | 'waveform' | 'trash', action?: SaidAction) => void;
  /** The part of the call you're in: arriving in a room with its board open is told as the room, not as the board. */
  place: string;
  /** Rooms have just closed and their boards came back, which the call says itself: a board made for them just opens. */
  cameBack: () => boolean;
  /** A workspace's name, where it's known here: where a board closed for everyone stays saved. */
  spaceName: (workspaceId: string) => string | null;
}

export function useCallBoard({ session, stage, saved, state, me, owner, talking, say, place, cameBack, spaceName }: CallBoardFacts) {
  const open = state.board.open;
  const pass = session.ticket.pass;
  const reduce = useReducedMotion();
  const onStage = stage === 'call';
  const hidden = !onStage;
  const key = open ? `${open.workspaceId ?? ''}/${open.documentId ?? ''}/${open.openedBy ?? ''}` : '';
  /** The open board as it last read: renamed while it's open, it closes under its new name. */
  const latest = useRef<CallBoardOpen | null>(null);
  useEffect(() => { if (open) latest.current = open; });
  /*
   * Closed for everyone while it's shown to you, a board sinks before it goes: drawn as it was for `SINK_MS`, its session still
   * open, and then the faces come back. Not when another opens in its place, nor for someone who hid it, nor with reduced motion.
   */
  const [shut, setShut] = useState<{ key: string; sinking: CallBoardOpen | null }>({ key, sinking: null });
  if (shut.key !== key) setShut({ key, sinking: key === '' && !hidden && !reduce && latest.current?.role ? latest.current : null });
  const sinking = shut.key === key ? shut.sinking : null;
  useEffect(() => {
    if (!sinking) return undefined;
    const t = setTimeout(() => setShut((was) => (was.sinking === sinking ? { ...was, sinking: null } : was)), SINK_MS);
    return () => clearTimeout(t);
  }, [sinking]);
  /*
   * A saved board just for you is opened as yours, with your account, not the call's pass: the call has nothing to do with it.
   * It's what's drawn while it's on your stage; otherwise the call's board is, or the one sinking as it closes. It's named as
   * its workspace names it now (read as it's drawn, for its links, so it costs nothing more), not as it was named when it
   * opened: a rename, here or anywhere else, holds.
   */
  const savedTree = useQuery({ ...q.workspaceTree(saved?.workspaceId ?? ''), enabled: saved !== null }).data;
  const liveName = saved ? savedTree?.items.find((i) => i.id === saved.documentId)?.name : undefined;
  const savedName = liveName === undefined ? saved?.name : liveName || 'Untitled board';
  const savedOpen = useMemo((): CallBoardOpen | null => (saved ? {
    workspaceId: saved.workspaceId, documentId: saved.documentId, name: savedName ?? saved.name, openedBy: me, canClose: true, everyone: false, role: 'edit', seal: 'Sealed', frame: null
  } : null), [saved?.workspaceId, saved?.documentId, savedName, me]);
  const mineDrawn = stage === 'saved' && savedOpen !== null;
  const { doc, status, reopen } = useBoardSession(mineDrawn ? savedOpen : open ?? sinking, owner, mineDrawn ? undefined : pass);
  const { people, onBoard } = useBoardPeople(doc, state.participants, me);
  /* Its session is kept while it's off your stage: putting it back tries its connection at once if it's down, as Try now does. */
  const shownBefore = useRef(onStage || mineDrawn);
  useEffect(() => {
    const before = shownBefore.current;
    shownBefore.current = onStage || mineDrawn;
    if (!before && shownBefore.current) doc?.retry();
  }, [onStage, mineDrawn, doc]);
  const talkingKey = [...talking].sort().join(' ');
  const talkingSet = useMemo(() => new Set(talkingKey ? talkingKey.split(' ') : []), [talkingKey]);
  const handle = useRef<BoardHandle | null>(null);
  const [following, setFollowing] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  /** A board you can't open is said to be so only once it's been so for a moment (`NO_ACCESS_WAIT_MS`). */
  const [refused, setRefused] = useState(false);
  /**
   * How many times a board came to you with the rest of your part of the call (rooms opening or closing, or rooms that share it
   * opening while you oversee them): it opens on your stage.
   */
  const [arrived, setArrived] = useState(0);
  /** The call's board was on your stage, as it was before this render: only then is its closing said. */
  const shownNow = useRef(false);
  /**
   * The last presentation of a board here. Closing that for everyone closes the board as it ends, in the same change, and the
   * stage says so (layout/onStage.ts), so the board doesn't say it again.
   */
  const presentedBoard = useRef<{ key: string; documentId: string } | null>(null);
  const presentNow = state.workspace.present;
  if (presentNow?.kind === 'board' && presentNow.id) presentedBoard.current = { key: presentNow.key, documentId: presentNow.id };

  /* What's said as boards open and close, and what rises. Joining a call that has one open says nothing: it was already open. */
  const was = useRef<CallBoardOpen | null | undefined>(undefined);
  /** Where you were the last time the board changed: moving to another part of the call brings its board with it, unsaid. */
  const wasAt = useRef(place);
  /** What the next board to open says in place of the usual, from whoever opened it here: who it let in, say. */
  const next = useRef<string | null>(null);
  const riseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rise = useCallback(() => {
    setFresh(true);
    clearTimeout(riseTimer.current);
    riseTimer.current = setTimeout(() => setFresh(false), RISE_MS);
  }, []);
  useEffect(() => () => clearTimeout(riseTimer.current), []);
  const openedBy = open?.openedBy ?? null;
  const opener = openedBy ? state.participants.find((p) => p.id === openedBy) ?? null : null;
  useEffect(() => {
    const before = was.current;
    const moved = wasAt.current !== place;
    was.current = open;
    wasAt.current = place;
    if (before === undefined) return;
    const same = before && open && before.documentId === open.documentId && before.workspaceId === open.workspaceId;
    if (same) return;
    // Following anyone on it goes with it.
    setFollowing(null);
    // Going to a room, or back: what's open there just rises, as the rest of the room does, and the call says where you are.
    if (moved || (open && cameBack())) { if (open) { rise(); setArrived((n) => n + 1); } return; }
    if (open === null) {
      // Only someone who had it open hears it's gone: nobody else's screen had it.
      if (!before || !shownNow.current) return;
      const end = state.workspace.ended;
      const last = presentedBoard.current;
      if (end?.close && last && end.key === last.key && last.documentId === before.documentId) return;
      const gone = latest.current?.documentId === before.documentId ? latest.current : before;
      const said = goneWords(gone.name ?? 'The board', status, gone.workspaceId ? spaceName(gone.workspaceId) : null);
      say(said.text, said.icon);
      return;
    }
    rise();
    const told = next.current;
    next.current = null;
    // Whoever made or brought it hears what it let in; nobody else's screen changes for a board someone else opened.
    if (open.role !== null && open.openedBy === me && told) say(told, 'lock');
    // `key` says everything about the open board this reads, and `place` where you are.
  }, [key, place]);
  useEffect(() => { shownNow.current = onStage && open !== null; });
  /* A board you can't open is shown so once it's held a moment, and one that opens to you meanwhile just opens. */
  const blocked = open !== null && open.role === null;
  useEffect(() => {
    if (!blocked) { setRefused(false); return undefined; }
    const t = setTimeout(() => setRefused(true), NO_ACCESS_WAIT_MS);
    return () => clearTimeout(t);
  }, [blocked, key]);

  /*
   * On the board every room shares, you land on your room's frame, and when rooms close it glides out to all of it. Whoever
   * stays in the main room sees all of it as the rooms' frames arrive, to watch them fill up. The board's code loads a moment
   * after its session, so this waits for it.
   */
  const frame = open?.frame ?? null;
  const shared = state.breakouts.open?.board === 'shared';
  const roomIds = state.breakouts.open?.rooms.map((r) => r.id).join(' ') ?? '';
  /*
   * Rooms that share the board open: whoever oversees them has it come onto their stage, as everyone in a room lands on theirs,
   * and so it does for the organizer joining again while they're open.
   */
  const sharedFrom = state.isOrganizer && shared && open !== null ? state.breakouts.open?.from ?? null : null;
  useEffect(() => { if (sharedFrom !== null) setArrived((n) => n + 1); }, [sharedFrom]);
  const framed = useRef<{ doc: DocSession | null; frame: string | null; shared: boolean }>({ doc: null, frame: null, shared: false });
  useEffect(() => {
    if (!doc) return undefined;
    const last = framed.current;
    if (last.doc === doc && last.frame === frame && last.shared === shared) return undefined;
    framed.current = { doc, frame, shared };
    const opened = shared && !last.shared && frame === null;
    if (frame === null && last.doc !== doc && !opened) return undefined;
    if (frame === null && last.frame === null && !opened) return undefined;
    let raf = 0;
    let tries = 0;
    const go = () => {
      const h = handle.current;
      if (!h) { if (tries++ < 240) raf = requestAnimationFrame(go); return; }
      if (frame) h.focusFrame(frame);
      else if (opened) h.showRooms(roomIds.split(' ').filter(Boolean));
      else h.fit();
    };
    go();
    return () => cancelAnimationFrame(raf);
    // `roomIds` is read as the rooms open, with `shared`.
  }, [doc, frame, shared]);

  /*
   * A frame to bring into view once the board's drawn here, as someone joins a vote on it from the call: its code loads a moment
   * after it opens, so this waits for it, as landing on a room's frame does.
   */
  const [toFrame, setToFrame] = useState<{ id: string; n: number } | null>(null);
  useEffect(() => {
    if (!toFrame) return undefined;
    let raf = 0;
    let tries = 0;
    const go = () => {
      const h = handle.current;
      if (!h) { if (tries++ < 240) raf = requestAnimationFrame(go); return; }
      h.focusFrame(toFrame.id);
    };
    go();
    return () => cancelAnimationFrame(raf);
  }, [toFrame]);
  const showFrame = useCallback((id: string) => setToFrame((was) => ({ id, n: (was?.n ?? 0) + 1 })), []);

  /* Following someone on the board, or going to them once. The board says if they aren't on it. */
  const follow = useCallback((id: string | null) => {
    setFollowing(id);
    handle.current?.follow(id);
  }, []);
  const goTo = useCallback((id: string) => { handle.current?.goTo(id); }, []);
  const onFollow = useCallback((id: string | null) => setFollowing(id), []);

  /* Pictures on the board, read through its document: the call's with the call's pass (the one sinking too), a saved one as yours. */
  const drawnOpen = mineDrawn ? savedOpen : open ?? sinking;
  const drawnPass = mineDrawn ? undefined : pass;
  const workspaceId = drawnOpen?.workspaceId ?? null;
  const documentId = drawnOpen?.documentId ?? null;
  const pictures = useMemo<BoardPictures>(() => (workspaceId && documentId ? boardPictures(workspaceId, documentId, drawnPass) : () => Promise.reject(new Error('no board'))), [workspaceId, documentId, drawnPass]);
  /* A picture put on the board is kept in its document, as a picture of a screen is, for whoever can add to it. */
  const canAdd = drawnOpen?.role === 'edit';
  const upload = useMemo<BoardUpload | undefined>(() => (workspaceId && documentId && canAdd ? boardUpload(workspaceId, documentId, drawnPass) : undefined), [workspaceId, documentId, drawnPass, canAdd]);
  /*
   * The board's workspace as you can open it, read once it's open to you: each link's name for you, and what More links to.
   * Someone it isn't open to reads nothing of it.
   */
  const tree = useQuery({ ...q.workspaceTree(workspaceId ?? '', drawnPass), enabled: workspaceId !== null && drawnOpen?.role != null }).data;
  const linkable = useMemo(() => (tree ? linkableIn(tree.items) : null), [tree]);
  const named = useMemo(() => new Map((linkable ?? []).map((i) => [i.id, i])), [linkable]);
  const itemFor = useCallback((item: string): BoardItem | null => named.get(item) ?? null, [named]);
  /** What More's From your workspace offers: everything there you can open, but the board itself. Null while it's read. */
  const toLink = useMemo(() => (canAdd ? { items: linkable && linkable.filter((i) => i.id !== documentId) } : undefined), [canAdd, linkable, documentId]);
  const comments = useBoardComments(state.participants, workspaceId, drawnPass ?? '', canAdd);

  /* How the call helps: ideas while notes are on here, and Sort into themes unless they're paused. Both are for whoever can add to it. */
  const notes = captureHere(state.capture).mode;
  // The call's board, open on your stage: a saved board just for you has no ideas from the call and no vote.
  const editing = open?.role === 'edit' && doc !== null && !mineDrawn;
  // Whoever has it open looks for ideas, and the server looks once a minute at most, for everyone here.
  const watching = editing && notes === 'on' && state.phase === 'in-call';
  useEffect(() => (watching ? session.watchIdeas() : undefined), [session, watching]);
  // By the board alone: whoever brought it can come and go, and what you put aside stays aside.
  const ideas = useBoardIdeas(session, state, handle, me, `${open?.workspaceId ?? ''}/${open?.documentId ?? ''}`, say);
  const { mutateAsync: sortIn } = useSortStickies(pass);
  const sort = useMemo((): SortAsk | undefined => {
    if (!editing || notes === 'paused' || !workspaceId || !documentId) return undefined;
    return (stickies) => sortIn({ workspaceId, documentId, stickies });
  }, [editing, notes, workspaceId, documentId, sortIn]);

  return {
    open, doc, people, onBoard, talking: talkingSet, handle, following, follow, goTo, onFollow, fresh, rise, pictures, ideas, sort, upload, itemFor, toLink, comments, showFrame,
    /** A saved board just for you is what's drawn: the call's board isn't. */
    savedDrawn: mineDrawn,
    /** Goes up each time a board comes to you with the rest of your part of the call, to open on your stage. */
    arrived,
    /** How its session is doing: saved, on its way, offline or refused. Null while there's none. */
    status,
    /** Try again, for what Alcove refused: it opens again, and what's kept on this device goes again. Only an account keeps it. */
    tryAgain: owner !== null && canKeepEdits() ? reopen : undefined,
    /** Try now, while its connection is down: it's tried again at once rather than after the wait. */
    tryNow: doc ? doc.retry : undefined,
    /** What's drawn: a saved board just for you, the call's open board, or the one sinking for a moment as it closes. */
    drawn: drawnOpen,
    sinking: sinking !== null && !mineDrawn,
    /** Shown as a board, for you: on your stage, and yours to see or says it isn't; or it's sinking. */
    shown: mineDrawn || (open !== null && onStage && (open.role !== null || refused)) || (sinking !== null && !mineDrawn),
    /** What opening says next, in place of the usual, for whoever opened it here. */
    expect: (text: string) => { next.current = text; },
    opener: opener?.person ?? null
  };
}
export type CallBoard = ReturnType<typeof useCallBoard>;

/* ---------- ideas from the call ---------- */

/** Ideas from the call as this browser shows them: the pill while some wait, and the tray (`BoardTray`) while it's open. */
export interface BoardIdeas {
  /** How many wait that you haven't opened the tray to, or put aside: the pill says so while the tray is closed. */
  waiting: number;
  /** The tray, while it's open: what's in it, and what you've added from it still there, saying so. */
  tray: BoardIdea[] | null;
  open: () => void;
  /** Closes the tray, putting what you didn't add aside, for you alone: the pill comes back only with something new. */
  close: () => void;
  add: (id: string) => void;
  addAll: () => void;
}

/** How often what the tray says of when each idea was said catches up, while it's open. */
const AGO_EVERY_MS = 30_000;

const samePerson = (a: Person, b: Person): boolean => (a.email && b.email ? a.email.toLowerCase() === b.email.toLowerCase() : a.name === b.name);

/**
 * The ideas the call offers you for its board (`CallState.board.ideas`, only ever for someone who can add to it, while notes
 * are on where they are, on a phone too). Adding one writes a sticky, in the frame it fits, as a change of your own, and tells
 * the call, so it goes for everyone there; Add all says so, with Undo, which takes back what it added whatever you've done
 * since. An idea's sticky has an ID made from the idea, so two people adding it at once make one sticky, and one someone else
 * has already added counts as added. What you put aside stays aside for you; nobody else's tray changes.
 */
function useBoardIdeas(session: CallSession, state: CallState, handle: RefObject<BoardHandle | null>, me: string, board: string, say: CallBoardFacts['say']): BoardIdeas {
  const offered = state.board.ideas;
  const [aside, setAside] = useState<ReadonlySet<string>>(() => new Set());
  const [added, setAdded] = useState<ReadonlySet<string>>(() => new Set());
  /** The tray's ideas, in the order they came, while it's open. */
  const [rows, setRows] = useState<readonly CallBoardIdea[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Another board's ideas were for its frames: a board that opens starts with none put aside.
  useEffect(() => { setAside(new Set()); setAdded(new Set()); setRows(null); }, [board]);
  // While it's open, the tray follows the call: what someone else added goes, what's new comes in at the end, and what you added
  // stays, saying so. With nothing left to add, it closes.
  const offeredKey = offered.map((i) => i.id).join(' ');
  useEffect(() => {
    setRows((was) => {
      if (!was) return was;
      const still = new Map(offered.map((i) => [i.id, i]));
      const kept = was.flatMap((r) => (added.has(r.id) ? [r] : (still.get(r.id) ?? [])));
      const fresh = offered.filter((i) => !was.some((r) => r.id === i.id) && !aside.has(i.id) && !added.has(i.id));
      const next = [...kept, ...fresh];
      return next.some((r) => !added.has(r.id)) ? next : null;
    });
  }, [offeredKey, added]);
  const isOpen = rows !== null;
  useEffect(() => {
    if (!isOpen) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), AGO_EVERY_MS);
    return () => clearInterval(t);
  }, [isOpen]);

  const mine = state.participants.find((p) => p.id === me)?.person ?? null;
  const tray = useMemo(() => rows?.map((r): BoardIdea => {
    const who = mine && samePerson(mine, r.said.person) ? 'You' : callName(r.said.person);
    return { id: r.id, person: r.said.person, text: r.said.words, sub: r.said.at ? `${who}, ${agoLabel(r.said.at, now)}` : who, added: added.has(r.id) };
  }) ?? null, [rows, added, now, mine]);

  /** Lets the call know they're on the board, so they go for everyone. They're already on it, so a miss is only logged. */
  const done = (ids: string[]) => {
    session.ideasDone(ids).catch((e: unknown) => blog.warn('ideas from the call not put by', { code: errorCode(e), ideas: ids.length }));
  };
  /** Puts ideas on the board: how many it made, and the step that made them, for Undo. */
  const write = (picked: readonly CallBoardIdea[]): { made: number; step: BoardStep | null } => {
    const did = handle.current?.addStickies(picked.map((i) => ({ text: i.text, frame: i.frame, from: i.id }))) ?? null;
    // What's on the board now is added, made here or by someone else from the same idea; a board that fills up leaves the rest in the tray.
    const on = (n: number): boolean => did?.added[n] === 'made' || did?.added[n] === 'there';
    const took = picked.filter((_, n) => on(n));
    if (!did || !took.length) return { made: 0, step: null };
    setAdded((a) => new Set([...a, ...took.map((i) => i.id)]));
    done(took.map((i) => i.id));
    return { made: did.added.filter((a) => a === 'made').length, step: did.step };
  };
  const waiting = offered.filter((i) => !aside.has(i.id) && !added.has(i.id)).length;
  return {
    waiting,
    tray,
    open: () => {
      const fresh = offered.filter((i) => !aside.has(i.id) && !added.has(i.id));
      if (fresh.length) setRows(fresh);
    },
    close: () => {
      const left = (rows ?? []).filter((r) => !added.has(r.id)).map((r) => r.id);
      setAside((a) => new Set([...a, ...left]));
      setRows(null);
    },
    add: (id) => {
      const idea = rows?.find((r) => r.id === id);
      if (idea && !added.has(id)) write([idea]);
    },
    addAll: () => {
      const { made, step } = write((rows ?? []).filter((r) => !added.has(r.id)));
      // Its Undo takes back what this added, and nothing done since.
      if (made) say(`Added ${made} ${made === 1 ? 'sticky' : 'stickies'} from the call.`, 'waveform', step ? { label: 'Undo', onClick: () => handle.current?.undoStep(step) } : undefined);
    }
  };
}

const noStatus = () => null;
const noSubscribe = () => () => undefined;
/** How the board's session is doing: saved, on its way, offline or refused. Null while there's no session. */
function useDocStatus(doc: DocSession | null): DocStatus | null {
  return useSyncExternalStore(doc ? doc.subscribe : noSubscribe, doc ? doc.getSnapshot : noStatus, doc ? doc.getSnapshot : noStatus);
}

/* ---------- a picture of a share, put on the board ---------- */

/** The widest a picture of a screen goes onto a board: enough to read it there, and no more. */
const SHOT_MAX = 2560;
/**
 * A picture of a share as this browser shows it now: the picture held still if one is (frozen, or an earlier one), else the
 * live one, from the video this browser already decodes to show it. Null when there's nothing to take yet. It never leaves
 * this browser except as a file in the board's document, sealed like the rest of it.
 */
async function shotOf(share: string, held: ImageBitmap | null, name: string): Promise<{ file: File; width: number; height: number } | null> {
  let source: CanvasImageSource;
  let w: number;
  let h: number;
  if (held) {
    source = held;
    w = held.width;
    h = held.height;
  } else {
    const video = document.querySelector(`[data-share="${CSS.escape(share)}"] video`);
    if (!(video instanceof HTMLVideoElement) || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
    source = video;
    w = video.videoWidth;
    h = video.videoHeight;
  }
  const k = Math.min(1, SHOT_MAX / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.88));
    if (!blob) return null;
    return { file: new File([blob], `${name.replace(/[/:]/g, '.')}.jpg`, { type: 'image/jpeg' }), width: canvas.width, height: canvas.height };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * Takes a picture of a share as this browser shows it and keeps it in the board's document, with the call's pass, so it's the
 * board's like anything else on it. The file's ID, or null when there's nothing to take yet.
 */
export async function keepShot(at: { workspaceId: string; documentId: string; pass: string }, share: string, held: ImageBitmap | null, caption: string): Promise<string | null> {
  const shot = await shotOf(share, held, caption);
  if (!shot) return null;
  const media = await api.workspaces.media.upload(at.workspaceId, at.documentId, shot.file, { pass: at.pass, width: shot.width, height: shot.height });
  return media.id;
}

const said = new TextEncoder();
const heard = new TextDecoder();
/** What's sent to whoever's screen went on the board: which share, sealed as everything sent through the room is. */
export const shotNotice = (share: string): Uint8Array => said.encode(JSON.stringify(BoardShotMessageSchema.parse({ share })));
/** A notice that someone put a picture of a share on the board: the share, or null for anything that isn't one. */
export function shotHeard(payload: Uint8Array): string | null {
  try {
    const r = BoardShotMessageSchema.safeParse(JSON.parse(heard.decode(payload)));
    return r.success ? r.data.share : null;
  } catch {
    return null;
  }
}
export { BOARD_SHOT_TOPIC };
