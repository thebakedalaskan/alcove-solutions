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
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type SetStateAction } from 'react';

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
