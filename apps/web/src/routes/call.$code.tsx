import { createFileRoute } from '@tanstack/react-router';
import { CallPage } from '~/features/call/session/CallPage';

/* Guests enter with the call's pass, without an account. */
export const Route = createFileRoute('/call/$code')({
  component: () => <CallPage code={Route.useParams().code} />
});
