import { useEffect, useRef } from 'react';
import { overlayOpen, shortcut, typing, withMod, withModShift } from '~/lib/keys';

interface CallShortcuts {
  /** Your side shows something: Escape puts it away, once nothing's open over the call and nobody you pinned is here. */
  side: boolean;
  pinned: boolean;
  zenOffered: boolean;
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
export interface CallKey { id: 'mic' | 'cam' | 'chat' | 'board' | 'workspace' | 'mark' | 'people' | 'find' | 'zen' | 'escape'; keys: string[]; what: string }
/** The call's keys. The letters sleep while you type, in a field or in a document, and a moment after. Captions have none: C is Chat. */
export const CALL_KEYS: CallKey[] = [
  { id: 'mic', keys: ['M'], what: 'Mute or unmute your microphone' },
  { id: 'cam', keys: ['V'], what: 'Turn your camera on or off' },
  { id: 'chat', keys: ['C'], what: 'Open or close Chat' },
  { id: 'board', keys: ['O'], what: 'Open a board' },
  { id: 'workspace', keys: ['W'], what: 'Open or close the workspace' },
  { id: 'mark', keys: ['B'], what: 'Mark this moment, for you alone' },
  { id: 'people', keys: ['⇧P'], what: 'Hide the people, or bring them back' },
  { id: 'find', keys: [shortcut('K')], what: 'Find in the workspace' },
  { id: 'zen', keys: [shortcut('⇧F')], what: 'Just the document, and back' },
  { id: 'escape', keys: ['Esc'], what: 'Close what’s open, then unpin everyone, then close your side' }
];
/** On a tile you've reached with Tab, or with the arrow keys from another. */
export const TILE_KEYS: { keys: string[]; what: string }[] = [
  { keys: ['P'], what: 'Pin for you, or unpin' },
  { keys: ['⇧←', '⇧→'], what: 'Move earlier or later' },
  { keys: ['+', '−'], what: 'Make bigger or smaller' },
  { keys: ['L'], what: 'Point at a share shown big' },
  { keys: ['↵'], what: 'Its menu' }
];

/** The call's keyboard subscription, with current view/actions and explicit workspace shortcuts. */
export function useCallShortcuts(current: CallShortcuts, workspace: { find: () => void; toggle: () => void }, toggleZen: () => void) {
  const keys = useRef(current);
  keys.current = current;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Wherever the caret is, this gives you just the document, and everything back.
      if (withModShift(e) && e.key.toLowerCase() === 'f') { if (keys.current.zenOffered) { e.preventDefault(); toggleZen(); } return; }
      // Find, from anywhere in the call. With the workspace in sight it's taken this already, and with words selected the editor has.
      // Behind something it's taking turns with, it comes to the front, so the line Find lands on is one you can see.
      if (withMod(e) && e.key.toLowerCase() === 'k') { if (!e.defaultPrevented && !overlayOpen()) { e.preventDefault(); workspace.find(); } return; }
      // The call's letters sleep while you're typing, in a field or in a document.
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        // Popovers and sheets close themselves first; then Escape unpins everyone you pinned (Undo puts them back), then closes your side.
        if (document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"]')) return;
        if (keys.current.pinned) keys.current.unpinAll();
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
  }, [workspace, toggleZen]);
}
