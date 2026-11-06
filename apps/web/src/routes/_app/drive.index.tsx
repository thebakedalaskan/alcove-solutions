/*
 * The Drive: every workspace you're in, newest first, each opening on its own page (features/drive/Drive.tsx).
 */
import { createFileRoute } from '@tanstack/react-router';
import { Drive } from '~/features/drive/Drive';
import { q } from '~/lib/queries';

export const Route = createFileRoute('/_app/drive/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(q.workspaces()),
  component: Drive
});
