/*
 * A document or board of a workspace, on its own beside another page of the app's: the Drive's tree (features/drive). It's
 * the workspace's own page for it, the same editor, the same people in it, comments, Share and ⋯, without the workspace's
 * list or frame. Whatever holds it says where it is and keeps the address: it's told when another document should take
 * this one's place (a link in its text), when there's nothing left to show (it went to Trash from here, or can't be opened
 * any more), and ⤢ in its head says when it should go full screen.
 */
import { useCallback, useMemo } from 'react';
import type { WorkspacePlace } from './context';
import { Workspace } from './Workspace';

export interface DocumentBesideProps {
  workspaceId: string;
  documentId: string;
  /** A line in it to land on, from a link's hash. */
  block?: string | undefined;
  /** ⤢: the same document, full screen in its workspace. */
  onFullScreen: () => void;
  /** Another document of the same workspace takes this one's place, such as one a link in its text opens. */
  onOpen: (documentId: string, block?: string | undefined) => void;
  /** There's nothing to show here any more: it went to Trash from here, or it can't be opened. */
  onClose: () => void;
}

export function DocumentBeside({ workspaceId, documentId, block, onFullScreen, onOpen, onClose }: DocumentBesideProps) {
  const at = useMemo((): WorkspacePlace => ({ kind: 'document', id: documentId, block }), [documentId, block]);
  const go = useCallback((to: WorkspacePlace) => {
    if (to.kind === 'document') onOpen(to.id, to.block);
    else onClose();
  }, [onOpen, onClose]);
  /* Only one workspace is shown here at a time, and whatever holds it chooses which. */
  const stay = useCallback(() => undefined, []);
  return <Workspace mode="beside" workspaceId={workspaceId} at={at} onGo={go} onSwitch={stay} onLeave={onClose} onExpand={onFullScreen} />;
}
