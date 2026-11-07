import { useEffect, useRef } from 'react';
import { overlayOpen, shortcut, typing, withMod, withModShift } from '~/lib/keys';

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

/** A key the call has, as Keyboard shortcuts in More lists it: `id` says which, for leaving out one you don't have here. */
export interface CallKey { id: 'mic' | 'cam' | 'chat' | 'board' | 'workspace' | 'mark' | 'people' | 'find' | 'focus' | 'escape'; keys: string[]; what: string }
/** The call's keys. The letters sleep while you type, in a field or in a document, and a moment after. Captions have none: C is Chat. */
export const CALL_KEYS: CallKey[] = [
  { id: 'mic', keys: ['M'], what: 'Mute or unmute your microphone' },
  { id: 'cam', keys: ['V'], what: 'Turn your camera on or off' },
  { id: 'chat', keys: ['C'], what: 'Open or close Chat' },
  { id: 'board', keys: ['O'], what: 'Open a board, just for you, or close it' },
  { id: 'workspace', keys: ['W'], what: 'Open the workspace, just for you, or close it' },
  { id: 'mark', keys: ['B'], what: 'Mark this moment, for you alone' },
  { id: 'people', keys: ['⇧P'], what: 'Hide the people, or bring them back' },
  { id: 'find', keys: [shortcut('K')], what: 'Find in the workspace' },
  { id: 'focus', keys: [shortcut('⇧F')], what: 'Fill your window with what’s open, and back' },
  { id: 'escape', keys: ['Esc'], what: 'Close a menu, leave focus, unpin everyone, then put your side away' }
];
/** On a tile you've reached with Tab, or with the arrow keys from another. */
export const TILE_KEYS: { keys: string[]; what: string }[] = [
  { keys: ['P'], what: 'Pin for you, or unpin' },
  { keys: ['⇧←', '⇧→'], what: 'Move earlier or later' },
  { keys: ['+', '−'], what: 'Make bigger or smaller' },
  { keys: ['L'], what: 'Point at a share on your stage' },
  { keys: ['↵'], what: 'Its menu' }
];

/** The call's keyboard subscription, with current view/actions and explicit workspace shortcuts. */
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
      if (k === 'm') keys.current.pressMic();
      if (k === 'v') keys.current.pressCam();
      if (k === 'c') keys.current.chat();
      if (k === 'b') keys.current.mark();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [workspace, toggleFocus]);
}
