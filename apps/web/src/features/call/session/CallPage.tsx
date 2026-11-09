import { Navigate } from '@tanstack/react-router';
import { sessions } from '~/lib/live';
import { InCall } from './InCall';

export function CallPage({ code }: { code: string }) {
  const active = sessions.call;
  if (!active || active.code !== code) return <Navigate to="/join/$code" params={{ code }} replace />;
  return <InCall key={`${active.session.ticket.callId}:${active.session.ticket.identity}`} session={active.session} />;
}
