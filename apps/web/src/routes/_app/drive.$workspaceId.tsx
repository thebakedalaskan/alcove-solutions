/*
 * A workspace, full screen (features/workspace/Frame.tsx). The routes under this one only say where you are: this one holds
 * the workspace, so moving between its pages keeps its side panel and its bar. `from=calls` says it was opened from a call
 * (Open its workspace), so ← and leaving full screen go back to Calls; otherwise they go back to the Drive, at this workspace,
 * beside its tree. It's kept as you move around the workspace.
 */
import { useMatch, createFileRoute, useLocation, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import type { WorkspaceFrame, WorkspaceFrom, WorkspacePlace } from '~/features/workspace/context';
import { Workspace } from '~/features/workspace/Workspace';

export const Route = createFileRoute('/_app/drive/$workspaceId')({
  validateSearch: (s: Record<string, unknown>): { from?: 'calls' | undefined } => ({ from: s['from'] === 'calls' ? 'calls' : undefined }),
  component: WorkspacePage
});

function WorkspacePage() {
  const { workspaceId } = Route.useParams();
  const { from } = Route.useSearch();
  const navigate = useNavigate();
  const document = useMatch({ from: '/_app/drive/$workspaceId/$documentId', shouldThrow: false })?.params.documentId;
  const inTrash = useMatch({ from: '/_app/drive/$workspaceId/trash', shouldThrow: false }) !== undefined;
  const block = useLocation({ select: (l) => l.hash });
  const at = useMemo((): WorkspacePlace => (inTrash ? { kind: 'trash' } : document ? { kind: 'document', id: document, block: block || undefined } : { kind: 'home' }), [inTrash, document, block]);
  const search = useMemo(() => ({ from }), [from]);
  const onGo = useCallback((to: WorkspacePlace, how?: { replace?: boolean | undefined }) => {
    const replace = how?.replace === true;
    if (to.kind === 'trash') void navigate({ to: '/drive/$workspaceId/trash', params: { workspaceId }, search, replace });
    else if (to.kind === 'home') void navigate({ to: '/drive/$workspaceId', params: { workspaceId }, search, replace });
    /* A call's own pages are only in a call, and nothing here goes to them. */
    else if (to.kind === 'document') void navigate({ to: '/drive/$workspaceId/$documentId', params: { workspaceId, documentId: to.id }, search, ...(to.block ? { hash: to.block } : {}), replace });
  }, [navigate, workspaceId, search]);
  const onSwitch = useCallback((id: string) => { void navigate({ to: '/drive/$workspaceId', params: { workspaceId: id }, search }); }, [navigate, search]);
  const onLeave = useCallback(() => { void navigate({ to: '/drive', replace: true }); }, [navigate]);
  const frame = useMemo((): WorkspaceFrame => {
    const came: WorkspaceFrom = from ?? 'drive';
    return { from: came, onBack: () => { void (came === 'calls' ? navigate({ to: '/calls' }) : navigate({ to: '/drive', search: { ws: workspaceId } })); } };
  }, [from, navigate, workspaceId]);
  return <Workspace mode="page" workspaceId={workspaceId} at={at} onGo={onGo} onSwitch={onSwitch} onLeave={onLeave} frame={frame} />;
}
