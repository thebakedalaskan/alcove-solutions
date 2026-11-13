/*
 * Your side of the call: one view at a time, on the right, at a fixed width, the stage making room for it. In a window too narrow
 * for both, it sits over the stage instead, as a phone's sheet sits over the call, rather than squeezing it; on a phone it's that
 * sheet. Its button at the top right is lit while it's open, and pressing it again puts it away. Only your screen changes:
 * nothing here goes anywhere.
 *
 * - Notes: the call's notes, its transcript, Ask and your own notes, as tabs, with Note to self at the foot of all but Ask.
 * - Chat, and People (who's here, and breakout rooms for the organizer).
 * - Rooms: setting up breakout rooms and watching them.
 * - Mine: a presenter's own notes beside what they present.
 */
import type { CallNotificationTarget, CallSide } from '@alcove/api';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type SetStateAction } from 'react';
import type { ChatTab } from '../chat/ChatPanel';
import type { PrivateAudience } from '../chat/PrivateChat';
import type { ReplyJump } from '../chat/replyAlerts';
import { PHONE_W } from './panels';

export type SideView = 'notes' | 'chat' | 'people' | 'rooms' | 'mine';
/** The Notes view's tabs. Yours is only for someone with an account to keep their own notes under. */
export type NotesTab = 'notes' | 'transcript' | 'ask' | 'yours';
/** Where your side is, to the tab: a view, or the Notes view on one of its tabs (`notes` is its first). */
export type SidePlace = Exclude<SideView, 'notes'> | NotesTab;

/** How wide the side is: 368 px, or 340 px in a window under 1200 px. The call's toasts keep clear of it at the same widths (call.css). */
export const sideWidth = (windowWidth: number): number => (windowWidth < 1200 ? 340 : 368);
/**
 * The narrowest the stage gets beside your side: narrower, and a frame's bar has no room to say what's in it and who presents it.
 * In a window too narrow for both (wider than a phone, with the people beside what's open keeping their room at its edge), your
 * side sits over the stage, left of the people, and the stage keeps its width under it.
 */
export const STAGE_BESIDE_SIDE = 480;
/**
 * The shortest the call's area gets with your side between the top bar and the dock: shorter, as a phone on its side is, and
 * there's no room in it for what your side shows, so it's the sheet over the call a phone has, standing at the right (call.css).
 */
export const SIDE_MIN_HEIGHT = 360;

export function useSide(opts: { phone: boolean }): { view: SideView | null; open: (v: SideView) => void; toggle: (v: SideView) => void; close: () => void } {
  const [view, setView] = useState<SideView | null>(null);
  /* A window that narrows to a phone puts the side away: there it's a sheet over the whole call, which only you bring up. */
  const wasPhone = useRef(opts.phone);
  useEffect(() => {
    if (opts.phone && !wasPhone.current) setView(null);
    wasPhone.current = opts.phone;
  }, [opts.phone]);
  const open = useCallback((v: SideView) => setView(v), []);
  const toggle = useCallback((v: SideView) => setView((now) => (now === v ? null : v)), []);
  const close = useCallback(() => setView(null), []);
  return useMemo(() => ({ view, open, toggle, close }), [view, open, toggle, close]);
}

/**
 * Your side as you left it: a reload finds it as it was (`kept`), and a call you've just joined opens Notes beside the stage, on a
 * wide screen, while notes are on. Once it moves, where it is (Notes, Chat or People) is kept for this call (`keep`, which writes
 * through the layout's own updater and never changes).
 */
export function useSideKept({ side, kept, keep, notesOn }: { side: ReturnType<typeof useSide>; kept: CallSide | null | undefined; keep: (side: CallSide | null) => void; notesOn: boolean }): void {
  const keptSide = useRef(kept);
  useEffect(() => {
    if (innerWidth < PHONE_W) return;
    const was = keptSide.current;
    if (was) side.open(was);
    else if (was === undefined && notesOn && innerWidth >= 1100) side.open('notes');
    // Once, as the call opens.
  }, []);
  const sideKept = side.view === 'notes' || side.view === 'chat' || side.view === 'people' ? side.view : null;
  const sideMoved = useRef(false);
  useEffect(() => {
    if (sideMoved.current) keep(sideKept);
    sideMoved.current = true;
  }, [sideKept]);
}

/** Notes' tabs, as places your side can be. */
const isNotesTab = (p: SidePlace): p is NotesTab => p === 'notes' || p === 'transcript' || p === 'ask' || p === 'yours';

/**
 * Where your side is, to the tab, and where its views jump to. Notes has its tabs, and where your side is, to the tab, is what
 * catching up returns to (`place`, `goTo`). Chat shows one conversation, which a tile, a row in People or a notification can choose
 * as well as its own tabs; Chat, its questions and People each bring a message, a question or a row into sight when they're asked
 * to, their `request` going up each time. What's typed in Ask and in Note to self is kept here, above the side, so moving your side
 * to another view and back keeps it, and typing in one draws only it.
 */
export function useSidePlaces(side: ReturnType<typeof useSide>) {
  const [actionTarget, setActionTarget] = useState<ReplyJump>();
  const [notesTab, setNotesTab] = useState<NotesTab>('notes');
  const place: SidePlace | null = side.view === 'notes' ? notesTab : side.view;
  const goTo = (p: SidePlace | null) => {
    if (p === null) { side.close(); return; }
    if (isNotesTab(p)) { setNotesTab(p); side.open('notes'); return; }
    side.open(p);
  };
  const askDraft = useRef({ text: '' });
  const ownDraft = useRef({ text: '' });
  const [chatTab, setChatTab] = useState<ChatTab>({ kind: 'room' });
  const [questionTarget, setQuestionTarget] = useState<ReplyJump>();
  const [chatTarget, setChatTarget] = useState<ReplyJump>();
  return { place, goTo, notesTab, setNotesTab, actionTarget, setActionTarget, chatTab, setChatTab, chatTarget, setChatTarget, questionTarget, setQuestionTarget, askDraft, ownDraft };
}
export type SidePlaces = ReturnType<typeof useSidePlaces>;

/** The next request to bring something into sight: the same jump asked again still moves. */
const jump = (id: string) => (was: ReplyJump | undefined): ReplyJump => ({ id, request: (was?.request ?? 0) + 1 });

/**
 * What opens your side on something in particular: a message addressed to you, a private conversation, the room's questions, or
 * what a notification was about. Each comes back to the call from the floating call first (`returnToCall`), and opens Chat or
 * People through `openSide`, which gives everything back; a notification about the timer opens Timer for everyone instead.
 */
export function sideOpeners({ places, openSide, returnToCall, part, generation, openTimer }: {
  places: SidePlaces;
  openSide: (place: SidePlace) => void;
  returnToCall: () => void;
  /** The part of the call this browser is in, and the call's generation, for a private conversation's audience. */
  part: string;
  generation: number;
  openTimer: () => void;
}) {
  const { setChatTab, setChatTarget, setQuestionTarget, setActionTarget } = places;
  const addressed = (id: string, audience: PrivateAudience | null) => { setChatTab(audience ? { kind: 'private', audience } : { kind: 'room' }); setChatTarget(jump(id)); returnToCall(); openSide('chat'); };
  /** A private conversation with someone here, from their tile, their row in People or a message of theirs: Chat opens on it. */
  const privately = (identity: string) => { setChatTab({ kind: 'private', audience: { identity, place: part, generation } }); returnToCall(); openSide('chat'); };
  /** The room's questions, in Chat, at one of them if it says which. */
  const questions = (id?: string) => { setChatTab({ kind: 'questions' }); if (id) setQuestionTarget(jump(id)); openSide('chat'); };
  const notification = (target: CallNotificationTarget) => {
    returnToCall();
    if (target.type === 'private') {
      setChatTab({ kind: 'private', audience: { identity: target.peer, place: part, generation } });
      setChatTarget(jump(target.message)); openSide('chat');
    } else if (target.type === 'thread' || target.type === 'chat') {
      setChatTab({ kind: 'room' }); setChatTarget(jump(target.message)); openSide('chat');
    } else if (target.type === 'attention' && target.section === 'questions') questions(target.id);
    else if (target.type === 'attention') {
      // A raised hand is at the top of People, its row in focus.
      setActionTarget(jump(target.id)); openSide('people');
    }
    else if (target.type === 'admission') { setActionTarget(jump(target.identity)); openSide('people'); }
    else if (target.type === 'timer') openTimer();
    else { setActionTarget(jump(target.id)); openSide('people'); }
  };
  return { addressed, privately, questions, notification };
}

/** What's typed in Chat or Ask and not sent yet. It's kept above the side, so moving to another view and back keeps it. */
export interface Draft { text: string }
const draftStates = new WeakMap<Draft, { revision: number; snapshot: { text: string; revision: number }; listeners: Set<() => void> }>();
function draftState(draft: Draft) {
  const existing = draftStates.get(draft);
  if (existing) return existing;
  const created = { revision: 0, snapshot: { text: draft.text, revision: 0 }, listeners: new Set<() => void>() };
  draftStates.set(draft, created);
  return created;
}
/** Follows the draft across view unmounts, so an old rejection cannot replace a newer edit. */
export const draftRevision = (draft: Draft) => draftState(draft).revision;
export function useDraft(draft: Draft) {
  const subscribe = useCallback((listener: () => void) => {
    const state = draftState(draft);
    state.listeners.add(listener);
    return () => { state.listeners.delete(listener); };
  }, [draft]);
  const snapshot = useCallback(() => {
    const state = draftState(draft);
    if (state.snapshot.text !== draft.text) state.snapshot = { text: draft.text, revision: state.revision };
    return state.snapshot;
  }, [draft]);
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  const setText = useCallback((value: SetStateAction<string>) => {
    draft.text = typeof value === 'function' ? value(draft.text) : value;
    const state = draftState(draft);
    state.revision++;
    state.snapshot = { text: draft.text, revision: state.revision };
    for (const listener of state.listeners) listener();
  }, [draft]);
  return [current.text, setText] as const;
}
