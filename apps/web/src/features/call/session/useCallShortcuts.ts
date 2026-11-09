import { useEffect, useRef } from 'react';
import { overlayOpen, typing, withMod, withModShift } from '~/lib/keys';

interface CallShortcuts {
  /** Your side shows something: Escape puts it away, once nothing's open over the call and nobody you pinned is here. */
  side: boolean;
  pinned: boolean;
  /** Focus is on offer (something's on your stage, on a screen bigger than a phone), and whether it's on: Escape leaves it first. */
  focusOffered: boolean;
  focused: boolean;
  leaveFocus: () => void;
  canMark: boolean;
  unpinAll: () => void;
  closeSide: () => void;
  /** Chat, in your side: opens it, or puts it away. */
  chat: () => void;
  pressMic: () => void;
  pressCam: () => void;
  togglePeople: () => void;
  pressBoard: () => void;
  mark: () => void;
}

/**
 * The call's keys, handled here: M and V (microphone and camera), C (Chat), B (Mark this moment), W (Workspace), O (Board),
 * ⇧P (hide the people beside what's open, or bring them back), ⌘K (find in the workspace) and ⌘⇧F (focus). The letters sleep
 * while you type, in a field or in a document, and a moment after. Captions have none: C is Chat. Escape goes in the call's
 * order: an open menu or sheet takes it first, then pointing at a share (SharePointing.tsx), then focus, then pins, then your
 * side. `current` is the call as it is now, read as each key comes; `workspace` its find and its toggle.
 */
export function useCallShortcuts(current: CallShortcuts, workspace: { find: () => void; toggle: () => void }, toggleFocus: () => void) {
  const keys = useRef(current);
  keys.current = current;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Wherever the caret is, this fills your window with what's open, and gives everything back.
      if (withModShift(e) && e.key.toLowerCase() === 'f') { if (keys.current.focusOffered) { e.preventDefault(); toggleFocus(); } return; }
      // Find, from anywhere in the call. With the workspace in sight it's taken this already, and with words selected the editor has.
      // Closed, it opens on your stage, so the line Find lands on is one you can see.
      if (withMod(e) && e.key.toLowerCase() === 'k') { if (!e.defaultPrevented && !overlayOpen()) { e.preventDefault(); workspace.find(); } return; }
      // The call's letters sleep while you're typing, in a field or in a document.
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        // Popovers and sheets close themselves first; then Escape leaves focus, unpins everyone you pinned (Undo puts them back), then closes your side.
        if (document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"]')) return;
        if (keys.current.focused) keys.current.leaveFocus();
        else if (keys.current.pinned) keys.current.unpinAll();
        else if (keys.current.side) keys.current.closeSide();
        return;
      }
      if (k === 'p' && e.shiftKey) { e.preventDefault(); keys.current.togglePeople(); return; }
      if (k === 'w' && !e.shiftKey && !overlayOpen()) { e.preventDefault(); workspace.toggle(); return; }
      if (k === 'o' && !e.shiftKey && !overlayOpen()) { e.preventDefault(); keys.current.pressBoard(); return; }
      if (k !== 'm' && k !== 'v' && k !== 'c' && !(k === 'b' && keys.current.canMark)) return;
      // The key is a shortcut here, not a character for whatever gets focus next.
      e.preventDefault();
      if (k === 'm' && !e.repeat) keys.current.pressMic();
      if (k === 'v') keys.current.pressCam();
      if (k === 'c') keys.current.chat();
      if (k === 'b') keys.current.mark();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [workspace, toggleFocus]);
}
