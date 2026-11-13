/*
 * The head over a document, a board or Trash: where it is, how it's saving, who's in it, Share and ⋯. Beside the list in a
 * call it starts with the list's button; on its own beside another page of the app's, it has ⤢ to go full screen instead;
 * full screen it's the frame's bar, which starts with the way back to where the workspace was opened from.
 */
import { WsDocHead, type WsCrumb, type WsFace, type WsPop, type WsSave } from '@alcove/ui';
import { PageBar } from './Bar';
import { useWs, type Ws } from './context';

export interface PaneHeadProps {
  /** The path: the workspace when you're in it, its folders, and what's open. */
  crumbs: string[];
  save: WsSave;
  faces?: WsFace[] | undefined;
  share?: WsPop | undefined;
  more?: WsPop | undefined;
}

/**
 * The path on the full screen's bar. The workspace's own name goes to its Home, but a call's own workspace has none, and
 * someone outside the workspace isn't told its name at all.
 */
function pathOf(ws: Ws, crumbs: readonly string[]): WsCrumb[] {
  if (ws.sent.name === null) return crumbs.map((label) => ({ label }));
  const [space, ...rest] = crumbs;
  return [...(space === undefined ? [] : [{ label: space, onClick: ws.home ? undefined : () => ws.go({ kind: 'home' }) }]), ...rest.map((label) => ({ label }))];
}

export function PaneHead({ crumbs, save, faces, share, more }: PaneHeadProps) {
  const ws = useWs();
  if (ws.mode === 'page') return <PageBar crumbs={pathOf(ws, crumbs)} save={save} faces={faces} share={share} more={more} moreLabel="More for this document" />;
  const head = { crumbs, save, faces, share, more };
  return ws.mode === 'beside' ? <WsDocHead {...head} onExpand={ws.expand} /> : <WsDocHead {...head} onToggleList={ws.toggleList} />;
}
