/*
 * The head over a document, a board or Trash: where it is, how it's saving, who's in it, Share and ⋯. Beside the list in a
 * call it starts with the list's button; on its own beside another page of the app's, it has ⤢ to go full screen instead;
 * full screen it's the frame's bar, which starts with the way back to where the workspace was opened from. Each step of the
 * path before where you are shows where that is (`Ws.reveal`).
 */
import type { WorkspaceItem } from '@alcove/api';
import { WsDocHead, type WsCrumb, type WsFace, type WsPop, type WsSave } from '@alcove/ui';
import { PageBar } from './full-screen/Bar';
import { useWs, type Ws } from './context';
import { folderName, foldersAbove } from './tree/tree';

export interface PaneHeadProps {
  /** The path (`pathTo`): the workspace when you're in it, its folders, and what's open. */
  crumbs: readonly WsCrumb[];
  save: WsSave;
  faces?: WsFace[] | undefined;
  share?: WsPop | undefined;
  more?: WsPop | undefined;
}

/**
 * The path to something in the workspace: the workspace, unless you're outside it and aren't told its name, then the folders
 * it's in, named as the list names them, each step showing where it is; then `page`, where you are, unless the path ends
 * above it (a board under its own bar, which says its name). A call's own workspace and its call's folder are called the
 * same, so they're one step, which goes where the folder does.
 */
export function pathTo(ws: Ws, item: WorkspaceItem | null, page: string | null): WsCrumb[] {
  const steps: WsCrumb[] = ws.sent.name === null ? [] : [{ label: ws.spaceName, onClick: () => ws.reveal(null) }];
  for (const folder of item ? foldersAbove(ws.tree, item.id) : []) {
    const step: WsCrumb = { label: folderName(folder, ws.callFolder), onClick: () => ws.reveal(folder.id) };
    if (folder.call !== null && steps.at(-1)?.label === step.label) steps.splice(-1, 1, step);
    else steps.push(step);
  }
  return page === null ? steps : [...steps, { label: page }];
}

export function PaneHead({ crumbs, save, faces, share, more }: PaneHeadProps) {
  const ws = useWs();
  if (ws.mode === 'page') return <PageBar crumbs={crumbs} save={save} faces={faces} share={share} more={more} moreLabel="More for this document" />;
  const head = { crumbs, save, faces, share, more };
  return ws.mode === 'beside' ? <WsDocHead {...head} onExpand={ws.expand} /> : <WsDocHead {...head} onToggleList={ws.toggleList} />;
}
