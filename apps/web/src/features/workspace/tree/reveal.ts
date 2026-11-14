/*
 * Showing where something is, for a step of the path over the page (Head.tsx): a folder opened in the list or the side panel,
 * with the folders around it, its row in view and lit, and the keyboard on it, while the page stays as it is. In a call the
 * list comes out for it first, and the workspace and This call are the list's top, with This call lit. Full screen, what a
 * step names can be a page of its own: the workspace's Home, or a call's own page once it has notes; a call kept behind
 * "N more" in the side panel shows the rest of them. Beside another page of the app's, that page shows it, and a call's
 * folder is the call there too. Nothing here keeps anything but the one landing on its way.
 */
import { DURATION } from '@alcove/ui';
import { useNavigate } from '@tanstack/react-router';
import type { RefObject } from 'react';
import type { WorkspaceProps } from '../context';
import { behindMore, type HomeOf } from '../full-screen/calls';
import { foldersAbove, type Tree } from './tree';

/** By then the list is out and a folder that was opening has opened, so its rows are where they'll stay. */
const SETTLED_MS = DURATION[2] * 1000 + 60;

/** In a call, This call's heading among the rows that glow (`Ws.glowing`): a step that names the workspace or This call lights it. */
export const THIS_CALL = 'sec:this-call';

/** The landing on its way, if one is: the next step pressed takes its place. */
let landing: { frame: number; timer: ReturnType<typeof setTimeout> } | null = null;

/**
 * Brings a row of the list into view in the list's own scroller, moving nothing around it, and puts the keyboard on it: the
 * row of `id`, or with null the list's top, scrolled there, and its first row. Tried as the list comes out, and again once
 * it and the folders have opened, unless the person has gone somewhere else meanwhile: into the page, or to another row.
 */
export function showRow(scope: HTMLElement | null, id: string | null): void {
  if (landing) { cancelAnimationFrame(landing.frame); clearTimeout(landing.timer); }
  /* Where the keyboard was once the first landing was done: the second goes only while it's still there. */
  let left: Element | null | undefined;
  const land = () => {
    const now = document.activeElement;
    if (left !== undefined && now !== left && now !== document.body) return;
    const row = scope?.querySelector<HTMLElement>(id === null ? '.wt-scroll [data-row]' : `[data-row="${CSS.escape(id)}"]`);
    const box = row?.closest<HTMLElement>('.wt-scroll');
    if (row && box) {
      const r = row.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      if (id === null) box.scrollTop = 0;
      else if (r.top < b.top || r.bottom > b.bottom) box.scrollTop += r.top - b.top - (b.height - r.height) / 2;
      const open = row.querySelector<HTMLElement>('.wt-open');
      if (open && document.activeElement !== open) open.focus({ preventScroll: true });
    }
    left = document.activeElement;
  };
  const frame = requestAnimationFrame(land);
  const timer = setTimeout(() => { cancelAnimationFrame(frame); landing = null; land(); }, SETTLED_MS);
  landing = { frame, timer };
}

/** What showing where something is needs of the workspace around it (Workspace.tsx). */
export interface RevealIn {
  mode: WorkspaceProps['mode'];
  tree: Tree;
  /** In a call, the call's own folder, which the list shows as This call, at its top. */
  callFolder: string | null;
  /** Full screen, a call's own workspace: the call it's for. It has no Home. */
  home: HomeOf | null;
  /** The pane, or the frame full screen, that holds the list. */
  pane: RefObject<HTMLElement | null>;
  /** Brings the list out where it can be seen, if it's away. */
  showList: () => void;
  /** Full screen, the side panel shows every call kept in the workspace, not the first few and "N more". */
  showAllCalls: () => void;
  openAll: (ids: string[]) => void;
  /** Lights rows for a moment, as one that arrives is. */
  light: (ids: readonly string[]) => void;
  go: WorkspaceProps['onGo'];
  onPlace: WorkspaceProps['onPlace'];
}

/** `Ws.reveal`: the workspace (null), or one of its folders, shown where it is. */
export function useReveal(r: RevealIn): (folder: string | null) => void {
  const navigate = useNavigate();
  return (folder) => {
    /*
     * Beside the Drive, a call's folder is the call, as its row there is: its own page once it has notes, and otherwise the
     * place that lists its row. Anything else is shown by the Drive.
     */
    if (r.mode === 'beside') {
      const item = folder === null ? undefined : r.tree.all.get(folder);
      const noteId = item?.call?.noteId;
      if (noteId) { void navigate({ to: '/calls/$noteId', params: { noteId } }); return; }
      r.onPlace?.(item?.call ? item.parent : folder);
      return;
    }
    /* Full screen the workspace's own name is its Home. A call's own workspace has none, so it's the call it's for that's shown. */
    if (r.mode === 'page' && folder === null && r.home === null) { r.go({ kind: 'home' }); return; }
    const shown = r.mode === 'page' ? folder ?? r.home?.call?.folder.id ?? null : folder === r.callFolder ? null : folder;
    const noteId = r.mode === 'page' && shown !== null ? r.tree.all.get(shown)?.call?.noteId : null;
    if (noteId) { void navigate({ to: '/calls/$noteId', params: { noteId } }); return; }
    if (shown !== null) {
      if (r.mode === 'page' && behindMore(r.tree, shown, r.home?.call?.folder.id ?? null)) r.showAllCalls();
      r.openAll([...foldersAbove(r.tree, shown).map((f) => f.id), shown]);
      r.light([shown]);
    } else if (r.mode === 'call') r.light([THIS_CALL]);
    r.showList();
    showRow(r.pane.current, shown);
  };
}
