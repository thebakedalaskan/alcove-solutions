/*
 * Who hosts the call, on the call screen (docs: Calls and recordings › Host hand-off). While someone stands in for the
 * organizer, everyone sees who, in one calm line in the status bar; whoever stands in sees that it's them, and can bring
 * everyone back from breakout rooms there. What changed is told once, as a notice from the call; this is what stays.
 */
import type { CallState, Person } from '@alcove/api';
import { Avatar, Icon } from '@alcove/ui';
import { callName } from '~/lib/people';

/** Who hosts now, as the call shows them, or null for the moment nobody does. */
export const hostPerson = (state: CallState): Person | null => state.participants.find((p) => p.id === state.host.id)?.person ?? null;

/** The organizer's first name, from the call: they may be away, and so not among the people in it. */
export const organizerFirst = (state: CallState): string => callName(state.host.organizer);

/** "Priya is hosting while Art is away", or for Priya, "You’re hosting while Art is away". Nothing while the organizer hosts. */
export function HostSpill({ state, onBringBack }: { state: CallState; onBringBack?: (() => void) | undefined }) {
  const host = hostPerson(state);
  if (!state.host.standIn || !host) return null;
  const away = organizerFirst(state);
  return (
    <div className="ic-spill ic-hosting" role="status">
      {state.isHost ? <Icon name="people" size={15} /> : <Avatar person={host} size={20} />}
      <span className="tx2">{state.isHost ? <><b>You’re hosting</b> while {away} is away</> : <><b>{callName(host)}</b> is hosting while {away} is away</>}</span>
      {state.isHost && onBringBack && <button type="button" className="sp-btn" onClick={onBringBack}>Bring everyone back</button>}
    </div>
  );
}
