/*
 * Who hosts the call, on the call screen (docs: Calls and recordings › Host hand-off). While someone stands in for the
 * organizer, everyone sees who, in one calm line in the status bar; whoever stands in sees that it's them, and can bring
 * everyone back from breakout rooms there. What changed is told once, as a notice from the call; this is what stays. Whoever
 * hosts has their controls here too, as People and the call's settings use them.
 */
import type { CallSession, CallState, Person } from '@alcove/api';
import { Avatar, Icon } from '@alcove/ui';
import type { QueryClient } from '@tanstack/react-query';
import { callKeys } from '~/features/calls/list/queryKeys';
import { callName } from '~/lib/people';
import type { CallView } from '../layout/view';
import type { HostControls } from '../layout/Panel';
import type { RoomView } from '../media/livekit';

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

/**
 * Whoever hosts' controls: letting people in, muting someone's microphone (by its track in the room), taking someone out of the
 * call, locking it, and pointing at shared screens. Someone removed can't come back, so their pin goes with them (and nobody is
 * told it waits for them); someone let in from the link comes off the invite as they go, so who's invited is read again.
 */
export function hostControls({ session, state, roomView, view, qc }: { session: CallSession; state: CallState; roomView: RoomView; view: CallView; qc: QueryClient }): HostControls {
  return {
    admit: (id) => session.admit(id),
    deny: (id) => session.deny(id),
    mute: (id) => { const sid = roomView.people[id]?.micSid; return sid ? session.mute(id, sid) : Promise.resolve(); },
    remove: async (id) => {
      const gone = state.participants.find((p) => p.id === id);
      const seat = gone?.seat;
      if (seat && view.layout.pins.includes(seat)) view.setPins(view.layout.pins.filter((s) => s !== seat));
      await session.remove(id);
      if (gone?.person.email) void qc.invalidateQueries({ queryKey: callKeys.byCode(state.code) });
    },
    locked: state.locked,
    lock: (v) => session.lock(v),
    pointing: state.pointing,
    setPointing: (v) => session.setPointing(v)
  };
}
