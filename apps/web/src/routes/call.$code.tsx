import { createFileRoute } from '@tanstack/react-router';
import { CallPage } from '~/features/call/session/CallPage';

/* Guests enter with the call's pass, without an account. Another call's address is another page: nothing carries across. */
export const Route = createFileRoute('/call/$code')({ component: Call });

function Call() {
  const { code } = Route.useParams();
  return <CallPage key={code} code={code} />;
}
