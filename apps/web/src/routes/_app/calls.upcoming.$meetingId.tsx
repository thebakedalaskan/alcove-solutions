/*
 * A call ahead, at /calls/upcoming/<meeting ID> (features/calls/list/Upcoming.tsx): who's invited and how they've answered,
 * Join when it's time, the link, the agenda and the notes, before the call. Calls' rows, Home's Coming up and the week open it.
 */
import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { AheadMissing, CallAhead } from '~/features/calls/list/Upcoming';
import { callQueries } from '~/features/calls/list/queries';

export const Route = createFileRoute('/_app/calls/upcoming/$meetingId')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(callQueries.meeting(params.meetingId)),
  errorComponent: ({ error }: ErrorComponentProps) => <AheadMissing error={error} />,
  component: AheadRoute
});

function AheadRoute() {
  const { meetingId } = Route.useParams();
  return <CallAhead meetingId={meetingId} />;
}
