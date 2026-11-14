import { createFileRoute } from '@tanstack/react-router';
import { JoinPage } from '~/features/calls/lobby/JoinPage';

/* Before the call: the only place your camera shows outside a call. Anyone with the link comes here; the organizer by their account. */
export const Route = createFileRoute('/join/$code')({ component: Join });

/* One link at a time (features/calls/lobby/JoinPage.tsx): another link's page starts over, with nothing carried across. */
function Join() {
  const { code } = Route.useParams();
  return <JoinPage key={code} code={code} />;
}
