/* Workspace in the side panel: the one you had open, your first, or a new one for someone who has none. */
import { createFileRoute, redirect } from '@tanstack/react-router';
import { placesOf } from '~/features/workspace/places';
import { q, workspaceToOpen } from '~/lib/queries';

export const Route = createFileRoute('/_app/workspace/')({
  loader: async ({ context: { queryClient: qc }, preload }) => {
    // Hovering the link never makes anyone a workspace.
    if (preload) return;
    const session = await qc.ensureQueryData(q.session());
    if (!session) return;
    const workspaceId = await workspaceToOpen(qc, placesOf(session.ownerId).workspace, session.user.name);
    throw redirect({ to: '/workspace/$workspaceId', params: { workspaceId }, replace: true });
  }
});
