/*
 * Making and entering calls, as the stand-in answers for them (packages/api-http/src/calls/api.ts is the real client's):
 * starting one now, what a call's link says, picking a time it offers, joining it (the call is then played from its script,
 * src/api/call/), a call moved to this device, a call made ready before it starts, and being rung.
 */
import type { AlcoveApi, CallAheadMake, CallCard, CallMoveIn, CallSession, ID, InstantCallInput, RingReply } from '@alcove/api';
import { readyIn } from '../../world/call-page';
import type { World } from '../../world/world';
import { answer, refused } from '../answer';
import { forgetGoingOn } from '../call/going-on';
import { atTheDoor } from '../call/script';
import { joinCall, type ScriptedCall } from '../call/scripted-call';
import { addMinutes, byCode, meetingFrom } from '../meetings/api';
import { seriesIn } from '../notes/api';
import { current, me } from '../state';
import { ScriptedMove } from './move';
import { Rings, ringing } from './rings';

function cardOf(w: World, code: string): CallCard {
  const m = byCode(w, code);
  if (!m) throw refused('not-found', 'That call link doesn’t lead anywhere.');
  return {
    title: m.title, organizerName: m.organizer.name, startsAt: m.startsAt, hostHere: !m.isOrganizer || m.status === 'live', standIn: null, locked: false, notes: m.notes,
    choices: m.choices, joinMuted: m.joinMuted, offer: m.offer ? { times: m.offer.times, minutes: Math.round((Date.parse(m.endsAt) - Date.parse(m.startsAt)) / 60_000) } : null,
    capture: null, ended: m.status === 'ended', you: 'invited', signInForNotes: ['google']
  };
}
/** What the link says as the call stands: the call's script and the call itself say who's there (call/script.ts). */
const doorOf = (w: World, code: string): CallCard => {
  const m = byCode(w, code);
  return m ? atTheDoor(cardOf(w, code), m) : cardOf(w, code);
};

const calls = new Set<ScriptedCall>();
const moves = new Set<ScriptedMove>();
/** Whatever the last story left open here stops: its calls (and those it left going), its rings, a move on its way. */
export function stopCalls(): void {
  for (const c of calls) c.close();
  calls.clear();
  forgetGoingOn();
  for (const r of ringing) r.close();
  ringing.clear();
  for (const m of moves) m.close();
  moves.clear();
}

export const callsApi: Pick<AlcoveApi, 'calls' | 'rings'> = {
  calls: {
    // As the server makes one: an hour from now, and scheduled until someone joins, so the lobby can ring people.
    startNow: (input?: InstantCallInput) => answer((w) => {
      const m = { ...meetingFrom(w, { title: input?.title ?? `${me().name.split(' ')[0] ?? 'Your'}’s call`, startsAt: new Date().toISOString(), durationMinutes: 60, guests: input?.guests ?? [], notes: input?.notes ?? w.prefs.notesDefault, documents: input?.documents ?? [] }), instant: true };
      w.meetings.push(m);
      return { code: m.code };
    }),
    card: (code: string) => answer((w) => doorOf(w, code), 'anyone'),
    pick: (code: string, at: string) => answer((w) => {
      const m = byCode(w, code);
      if (!m?.offer) throw refused('conflict', 'Someone has picked a time already.');
      const { offer: _offer, ...settled } = { ...m, startsAt: at, endsAt: addMinutes(at, (Date.parse(m.endsAt) - Date.parse(m.startsAt)) / 60_000) };
      w.meetings = w.meetings.map((x) => (x.id === m.id ? settled : x));
      return doorOf(w, code);
    }, 'anyone'),
    series: (code: string) => answer((w) => { const m = byCode(w, code); return m?.seriesId && w.notes.some((n) => n.seriesId === m.seriesId) ? seriesIn(w, m.seriesId) : null; }),
    join: async (code: string, opts: { name?: string | undefined; previous?: string | undefined }): Promise<CallSession> => {
      const m = await answer((w) => {
        const found = byCode(w, code);
        if (!found) throw refused('not-found', 'That call link doesn’t lead anywhere.');
        if (found.status === 'ended') throw refused('conflict', 'This call has ended.');
        return found;
      }, 'anyone');
      const live = joinCall(m, opts);
      calls.add(live);
      current().meetings = current().meetings.map((x) => (x.id === m.id ? { ...x, status: 'live' } : x));
      return live;
    },
    openMove: (): Promise<CallMoveIn> => Promise.reject(refused('not-found', 'That link has run out or was used. Make a new one on the other device.')),
    // The move this browser holds the claim to, if the world has one (`move`): the other device's side isn't here.
    resumeMove: async (claim: string): Promise<CallMoveIn> => {
      const spec = await answer((w) => {
        if (w.move?.claim !== claim) throw refused('not-found', 'That move isn’t there any more. Make a new one on the other device.');
        return w.move;
      }, 'anyone');
      const move = new ScriptedMove(spec);
      moves.add(move);
      return move;
    },
    // A call before it starts, made ready from its page (S3 · A call).
    ready: (meetingId: ID, make: CallAheadMake, name?: string | undefined) => answer((w) => readyIn(w, meetingId, make, name))
  },
  rings: {
    live: () => {
      const store = new Rings(structuredClone(current().rings.filter((r) => Date.parse(r.expiresAt) > Date.now())));
      ringing.add(store);
      return store;
    },
    answer: (id: ID, _reply: RingReply) => answer((w) => {
      if (!w.rings.some((r) => r.id === id)) throw refused('not-found', 'That ring is over.');
      w.rings = w.rings.filter((r) => r.id !== id);
      for (const r of ringing) r.update((rs) => rs.filter((x) => x.id !== id));
    })
  }
};
