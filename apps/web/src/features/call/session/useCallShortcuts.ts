import { useEffect, useRef } from 'react';
import { overlayOpen, typing, withMod, withModShift } from '~/lib/keys';
import type { PanelView } from '../layout/Panel';

interface CallShortcuts {
  panel: PanelView | null;
  pinned: boolean;
  zenOffered: boolean;
  canMark: boolean;
  unpinAll: () => void;
  setPanel: (panel: PanelView | null) => void;
  flip: (panel: PanelView) => void;
  pressMic: () => void;
  pressCam: () => void;
  togglePeople: () => void;
  pressBoard: () => void;
  mark: () => void;
}

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
        // Popovers and sheets close themselves first; then Escape unpins everyone you pinned (Undo puts them back), then closes the panel.
        if (document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"]')) return;
        if (keys.current.pinned) keys.current.unpinAll();
        else if (keys.current.panel) keys.current.setPanel(null);
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
      if (k === 'c') keys.current.flip('chat');
      if (k === 'b') keys.current.mark();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [workspace, toggleZen]);
}
