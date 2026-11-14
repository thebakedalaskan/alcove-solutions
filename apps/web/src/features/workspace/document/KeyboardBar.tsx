/*
 * The bar over a phone's keyboard while you write in a document: blocks, styles, @, photos and checklists, which a phone
 * has no slash key or shortcuts for. It shows while the caret is in the page and rises with the keyboard, which the
 * visual viewport says the height of. While it's up, sheets sit above it (`--kbar`, which workspace.css reads). It's drawn on
 * the page's body, not where the document is: in a call the workspace sits in the stage's frame, under the dock, which would
 * otherwise cover the bar whenever no keyboard lifts it (a document opened with the caret already in it, a hidden keyboard).
 */
import { WsKeyboardBar, WsMenu, WsPopover, type WsMenuRow } from '@alcove/ui';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMedia } from '~/lib/live';
import type { EditorHandle } from '../editor/types';

/** The bar's own height, in px, as `.ws-kbar` draws it. */
const BAR = 72;

/** Whether the caret is in a document's text now. */
const inText = (el: Element | null): boolean => el instanceof HTMLElement && el.isContentEditable && el.closest('.ws-ed') !== null;

/** How far the on-screen keyboard has pushed up from the foot of the window, in px. */
function keyboardHeight(): number {
  const vv = window.visualViewport;
  return vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
}

export function KeyboardBar({ editor }: { editor: EditorHandle }) {
  const phone = useMedia('(max-width: 640px)');
  const [writing, setWriting] = useState(() => typeof document !== 'undefined' && inText(document.activeElement));
  const [lift, setLift] = useState(0);
  const [styles, setStyles] = useState(false);

  /* Focus moving between the text and something else; a moment later, so a press on the bar never hides it in passing. */
  useEffect(() => {
    if (!phone) return;
    let frame = 0;
    const check = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setWriting(inText(document.activeElement))); };
    check();
    document.addEventListener('focusin', check);
    document.addEventListener('focusout', check);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('focusin', check);
      document.removeEventListener('focusout', check);
    };
  }, [phone]);

  /* The keyboard opening, closing or changing height. */
  const shown = phone && (writing || styles);
  useEffect(() => {
    if (!shown) return;
    const vv = window.visualViewport;
    const move = () => setLift(keyboardHeight());
    move();
    vv?.addEventListener('resize', move);
    vv?.addEventListener('scroll', move);
    return () => {
      vv?.removeEventListener('resize', move);
      vv?.removeEventListener('scroll', move);
    };
  }, [shown]);

  /* What opens while it's up sits over it, not behind it. */
  useEffect(() => {
    if (!shown) return;
    const root = document.documentElement;
    root.style.setProperty('--kbar', `${lift + BAR}px`);
    return () => { root.style.removeProperty('--kbar'); };
  }, [shown, lift]);

  if (!shown) return null;
  const then = (run: () => void) => () => { setStyles(false); run(); };
  const rows: WsMenuRow[] = [
    { type: 'head', label: 'The words you’ve selected' },
    { id: 'bold', label: 'Bold', icon: 'bold', onSelect: then(() => editor.toggleMark('bold')) },
    { id: 'italic', label: 'Italic', icon: 'italic', onSelect: then(() => editor.toggleMark('italic')) },
    { id: 'strike', label: 'Strikethrough', icon: 'strike', onSelect: then(() => editor.toggleMark('strike')) },
    { id: 'highlight', label: 'Highlight', icon: 'highlighter', onSelect: then(() => editor.toggleMark('highlight')) },
    { type: 'sep' },
    { type: 'head', label: 'This line' },
    { id: 'paragraph', label: 'Text', icon: 'para', onSelect: then(() => editor.turnInto('paragraph')) },
    { id: 'h1', label: 'Heading 1', icon: 'h1', onSelect: then(() => editor.turnInto('h1')) },
    { id: 'h2', label: 'Heading 2', icon: 'h2', onSelect: then(() => editor.turnInto('h2')) },
    { id: 'h3', label: 'Heading 3', icon: 'h3', onSelect: then(() => editor.turnInto('h3')) },
    { id: 'quote', label: 'Quote', icon: 'quote', onSelect: then(() => editor.turnInto('quote')) }
  ];
  return createPortal(
    <>
      {/* Pressing a tool keeps the caret, and the keyboard, where they are. */}
      <div onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}>
        <WsKeyboardBar lift={lift} onBlock={() => editor.openSlash()} onStyle={() => setStyles((on) => !on)} onTag={() => editor.openMention()}
          onPhoto={() => editor.addPhotos()} onChecklist={() => editor.turnInto('todo')}
          onDone={() => { setStyles(false); if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); }} />
      </div>
      {styles && (
        <WsPopover open takeFocus={false} label="Text style" at={() => new DOMRect(8, window.innerHeight - lift - BAR, 46, BAR)} side="top"
          onOpenChange={(open) => { if (!open) setStyles(false); }}>
          <WsMenu rows={rows} label="Text style" />
        </WsPopover>
      )}
    </>,
    document.body
  );
}
