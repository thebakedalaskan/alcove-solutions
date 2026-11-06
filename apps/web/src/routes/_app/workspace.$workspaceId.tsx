/*
 * The workspace outside a call. The routes under this one only say where you are: this one holds the workspace, so moving
 * between documents never takes the list off the screen.
 */
import { useMatch, createFileRoute, useLocation, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import type { WorkspacePlace } from '~/features/workspace/context';
import { Workspace } from '~/features/workspace/Workspace';

export const Route = createFileRoute('/_app/workspace/$workspaceId')({ component: WorkspacePage });

function WorkspacePage() {
  const { workspaceId } = Route.useParams();
  const navigate = useNavigate();
  const document = useMatch({ from: '/_app/workspace/$workspaceId/$documentId', shouldThrow: false })?.params.documentId;
  const inTrash = useMatch({ from: '/_app/workspace/$workspaceId/trash', shouldThrow: false }) !== undefined;
  const block = useLocation({ select: (l) => l.hash });
  const at = useMemo((): WorkspacePlace => (inTrash ? { kind: 'trash' } : document ? { kind: 'document', id: document, block: block || undefined } : { kind: 'home' }), [inTrash, document, block]);
  const onGo = useCallback((to: WorkspacePlace, how?: { replace?: boolean | undefined }) => {
    const replace = how?.replace === true;
    if (to.kind === 'trash') void navigate({ to: '/workspace/$workspaceId/trash', params: { workspaceId }, replace });
    else if (to.kind === 'home') void navigate({ to: '/workspace/$workspaceId', params: { workspaceId }, replace });
    else void navigate({ to: '/workspace/$workspaceId/$documentId', params: { workspaceId, documentId: to.id }, ...(to.block ? { hash: to.block } : {}), replace });
  }, [navigate, workspaceId]);
  const onSwitch = useCallback((id: string) => { void navigate({ to: '/workspace/$workspaceId', params: { workspaceId: id } }); }, [navigate]);
  const onLeave = useCallback(() => { void navigate({ to: '/workspace', replace: true }); }, [navigate]);
  return <Workspace mode="page" workspaceId={workspaceId} at={at} onGo={onGo} onSwitch={onSwitch} onLeave={onLeave} />;
}
