/*
 * Your side of the call: one view at a time, on the right, at a fixed width, the stage making room for it. In a window too narrow
 * for both, it sits over the stage instead, as a phone's sheet sits over the call, rather than squeezing it; on a phone it's that
 * sheet. Its button at the top right is lit while it's open, and pressing it again puts it away. Only your screen changes:
 * nothing here goes anywhere.
 *
 * - Notes: the call's notes, its transcript and Ask, as tabs, with your own notes at the foot of the notes.
 * - Chat, and People (who's here, and breakout rooms for the organizer).
 * - Rooms: setting up breakout rooms and watching them.
 * - Mine: a presenter's own notes beside what they present.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type SideView = 'notes' | 'chat' | 'people' | 'rooms' | 'mine' | 'attention' | 'timer';
/** The Notes view's tabs. */
export type NotesTab = 'notes' | 'transcript' | 'ask';
/** Where your side is, to the tab: a view, or the Notes view on one of its tabs (`notes` is its first). */
export type SidePlace = Exclude<SideView, 'notes'> | NotesTab;

/** How wide the side is: 368 px, or 340 px in a window under 1200 px. The call's toasts keep clear of it at the same widths (call.css). */
export const sideWidth = (windowWidth: number): number => (windowWidth < 1200 ? 340 : 368);
/**
 * The narrowest the stage gets beside your side: narrower, and a frame's bar has no room to say what's in it and who presents it.
 * In a window too narrow for both (wider than a phone and under 864 px), your side sits over the stage, at the right, and the
 * stage keeps its whole width under it.
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
export function useDraft(draft: Draft) {
  const [text, setText] = useState(draft.text);
  useEffect(() => { draft.text = text; }, [draft, text]);
  return [text, setText] as const;
}
