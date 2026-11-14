/*
 * A workspace, full screen (docs/design/pages.md › A workspace): its own side panel, dark in both themes, beside the page
 * that's open, with one bar over the page that the page fills in (Bar.tsx). Home's evening runs up behind the bar, which is
 * clear until the page scrolls under it. On a phone the side panel and the page take turns.
 */
import { WsFrame } from '@alcove/ui';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';
import type { ListDrag } from '../tree/List';
import { Side } from './Side';

/** What a page full screen needs of the frame: where its bar goes, whether a phone shows it, and saying it's scrolled under the bar. */
export interface FrameState {
  bar: HTMLDivElement | null;
  /** A phone shows the page, not the workspace's pages: its bar has the way back to them. */
  onPage: boolean;
  setScrolled: (scrolled: boolean) => void;
}

const FrameContext = createContext<FrameState | null>(null);
/** The frame a page is in, full screen; null anywhere else (in a call, or beside the Drive's tree). */
export const useFrame = (): FrameState | null => useContext(FrameContext);

export function Frame({ drags, phoneList, home, following, pane, children }: {
  drags: ListDrag;
  /** On a phone, the workspace's pages take the screen. */
  phoneList: boolean;
  /** The page is the workspace's Home. */
  home: boolean;
  following: boolean;
  pane: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  const [scrolled, setScrolled] = useState(false);
  /* Each Home opens at its top, under a clear bar. */
  useEffect(() => { if (!home) setScrolled(false); }, [home]);
  const state = useMemo((): FrameState => ({ bar, onPage: !phoneList, setScrolled }), [bar, phoneList]);
  return (
    <FrameContext value={state}>
      <WsFrame ref={pane} side={<Side drags={drags} />} bar={setBar} phone={phoneList ? 'list' : 'page'} home={home} scrolled={scrolled} following={following}>
        {children}
      </WsFrame>
    </FrameContext>
  );
}
