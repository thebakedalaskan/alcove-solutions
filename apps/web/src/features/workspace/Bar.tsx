/*
 * The bar over a page full screen (WsBar): the way back to where the workspace was opened from, the path, and you at the
 * far right, whose face opens your menu (features/shell/YouMenu.tsx), with what the page says about itself (how it's
 * saving, who else is in it, Share and ⋯). Each page puts its own bar in the frame's place for it, so there's one bar
 * however the page changes. On a phone a page's bar goes back to the workspace's pages, and the pages' bar goes back where
 * the workspace was opened from.
 */
import { firstName } from '@alcove/api';
import { WsBar, hereLine, type WsCrumb, type WsFace, type WsPop, type WsSave } from '@alcove/ui';
import { createPortal } from 'react-dom';
import { YourFace } from '~/features/shell/YouMenu';
import { useWs } from './context';
import { useFrame } from './Frame';

/** The words for where a workspace full screen was opened from, which ← says. */
export const FROM_WORDS = { drive: 'Drive', calls: 'Calls' } as const;

export interface PageBarProps {
  /** The path after the way back: the workspace, its folders, and the page, last. */
  crumbs?: readonly WsCrumb[] | undefined;
  save?: WsSave | undefined;
  /** Who else is on this page, each with their card. */
  faces?: readonly WsFace[] | undefined;
  share?: WsPop | undefined;
  more?: WsPop | undefined;
  moreLabel?: string | undefined;
}

export function PageBar({ crumbs, save, faces = [], share, more, moreLabel }: PageBarProps) {
  const ws = useWs();
  const frame = useFrame();
  if (!frame?.bar || !ws.frame) return null;
  const { from, onBack } = ws.frame;
  const here = faces.length > 0 ? { faces: [...faces], line: hereLine(faces.map((f) => firstName(f.person.name))) } : undefined;
  return createPortal(
    <WsBar back={{ label: FROM_WORDS[from], onClick: onBack }} crumbs={crumbs} up={frame.onPage ? { label: ws.spaceName, onClick: ws.showPages } : undefined}
      save={save} here={here} share={share} more={more} moreLabel={moreLabel} onExit={onBack}
      me={<YourFace size={30} />} />,
    frame.bar
  );
}
