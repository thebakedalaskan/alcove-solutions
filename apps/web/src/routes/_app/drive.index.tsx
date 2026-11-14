/*
 * The Drive: the tree of places beside a sheet of large previews (features/drive/Drive.tsx). Where you are in it is the
 * address's search params, so the page stays put as you move; a workspace full screen is /drive/$workspaceId.
 */
import { createFileRoute } from '@tanstack/react-router';
import { Drive } from '~/features/drive/Drive';
import { driveSearch } from '~/features/drive/places';
import { workspaceQueries } from '~/features/workspace/queries';

export const Route = createFileRoute('/_app/drive/')({
  validateSearch: driveSearch,
  loader: ({ context }) => context.queryClient.ensureQueryData(workspaceQueries.workspaces()),
  component: DrivePage
});

function DrivePage() {
  return <Drive at={Route.useSearch()} />;
}
