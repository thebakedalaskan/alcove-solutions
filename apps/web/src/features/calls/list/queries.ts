/*
 * The calls' data: every call ahead, one call, a call by its link and the link's card, and the changes made to calls:
 * starting, scheduling, changing, cancelling, answering, ringing, picking a time and getting one ready. The calendar around
 * them is the scheduler's (features/calls/scheduling/queries.ts).
 */
import { errorCode, type CallAheadMake, type ChangeScope, type InstantCallInput, type ISODate, type MeetingInput, type Patch, type ProposalAnswer, type RingReply } from '@alcove/api';
import { queryOptions, useIsMutating, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { accountKeys } from '~/features/account/queryKeys';
import { noteKeys } from '~/features/notes/queryKeys';
import { workspaceKeys } from '~/features/workspace/queryKeys';
import { api } from '~/lib/api';
import { answerCallOptions, readMeeting } from '~/lib/queryWrites';
import { callKeys } from './queryKeys';

export const callQueries = {
  upcoming: () => queryOptions({ queryKey: callKeys.upcoming, queryFn: () => api.meetings.upcoming(), refetchInterval: 60_000 }),
  byCode: (code: string) => queryOptions({ queryKey: callKeys.byCode(code), queryFn: () => api.meetings.byCode(code) }),
  /**
   * A call link's title and organizer, what the call captures and whether it can be joined yet, for anyone (no
   * account needed), and for someone signed in where they stand (signing in starts the cache over, so it's read again).
   * Read again every 3 to 5 seconds while waiting for the organizer, so joining opens soon after they arrive, and now
   * and then after that (capture changing, a lock); a little apart, so many people waiting don't read it in step. After
   * a refusal (too many reads from one address) or a failed read it waits 20 seconds or more; a code that leads nowhere
   * isn't asked again.
   */
  card: (code: string) => queryOptions({
    queryKey: callKeys.card(code), queryFn: () => api.calls.card(code),
    refetchInterval: (query) => {
      const failed = query.state.error ? errorCode(query.state.error) : null;
      if (failed === 'not-found') return false;
      const d = query.state.data;
      const base = failed ? 20_000 : d?.ended ? 30_000 : d?.hostHere ? 10_000 : 3_000;
      // How far apart from other browsers, by the milliseconds of when this one last heard back. It's asked for on every
      // render and must stay the same until the next answer: a new value restarts the wait, so a random one never ends.
      const apart = ((query.state.dataUpdatedAt + query.state.errorUpdatedAt) % 997) / 997;
      return Math.round(base * (1 + apart / 1.5));
    }
  }),
  /* Starting and scheduling calls. */
  /** One call as it is now, for its card: the answers people have given change while it's open. */
  meeting: (id: string) => queryOptions({ queryKey: callKeys.meeting(id), queryFn: ({ client }) => readMeeting(api, client, id), retry: false })
};

export function useScheduleCall() {
  const qc = useQueryClient();
  return useMutation({ networkMode: 'always', mutationFn: (input: MeetingInput) => api.meetings.create(input), onSuccess: () => qc.invalidateQueries({ queryKey: callKeys.meetings }) });
}
/** A call changed or went: Home's calls, and any series it's the next call of, catch up. */
export const callsChanged = (qc: QueryClient) => { void qc.invalidateQueries({ queryKey: callKeys.meetings }); void qc.invalidateQueries({ queryKey: noteKeys.allSeries }); };
/** Changes a call. In a series, `scope: 'following'` changes this call and every later one. */
export function useUpdateCall() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: string; input: Patch<MeetingInput>; scope?: ChangeScope | undefined }) => api.meetings.update(v.id, v.input, { scope: v.scope }), onSuccess: () => callsChanged(qc) });
}
/**
 * Cancels a call. In a series, `scope: 'following'` cancels this call and every later one. Its link leads nowhere now, so
 * what's cached of the link goes with it: coming Back to it reads that first, and opens no lobby or camera on the way.
 */
export function useCancelCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; code: string; scope?: ChangeScope | undefined }) => api.meetings.cancel(v.id, { scope: v.scope }),
    onSuccess: (_r, v) => {
      qc.removeQueries({ queryKey: callKeys.byCode(v.code) });
      qc.removeQueries({ queryKey: callKeys.card(v.code) });
      callsChanged(qc);
    }
  });
}
/** The keys an answer projects over (lib/queryWrites.ts), and whose session owns it. */
const answerKeys = { session: accountKeys.session, meeting: callKeys.meeting, upcoming: callKeys.upcoming };
/** Says whether you're coming to a call you're invited to. The card shows the answer at once, and goes back if it's refused. */
export function useAnswerCall() {
  const qc = useQueryClient();
  return useMutation(answerCallOptions(api, qc, answerKeys));
}
export function usePendingRsvp(id: string) {
  return useIsMutating({ mutationKey: ['meetings', 'answer'], predicate: (mutation) => {
    const v = mutation.state.variables;
    return !!v && typeof v === 'object' && 'id' in v && v.id === id;
  } }) > 0;
}
export function useStartNow() {
  const qc = useQueryClient();
  return useMutation({ networkMode: 'always', mutationFn: (input: InstantCallInput) => api.calls.startNow(input), onSuccess: () => qc.invalidateQueries({ queryKey: callKeys.meetings }) });
}

/* ---------- ringing, and picking a time ---------- */

/** Answers a ring. */
export function useRingAnswer() {
  return useMutation({ mutationFn: (v: { id: string; reply: RingReply }) => api.rings.answer(v.id, v.reply) });
}
/** Settles a call that offers times on one of them. When someone got there first, the link's card is read again before this finishes: it says the time they took. */
export function usePickTime(code: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (at: string) => api.calls.pick(code, at),
    onError: (e) => (errorCode(e) === 'conflict' ? qc.invalidateQueries({ queryKey: callKeys.card(code) }) : undefined)
  });
}

/** You, invited, asking the organizer to move a call to another time: they see it on theirs, and can move it there. */
export function useProposeTime() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: string; startsAt: ISODate }) => api.meetings.propose(v.id, v.startsAt), onSuccess: (m) => { qc.setQueryData(callKeys.meeting(m.id), m); callsChanged(qc); } });
}
/** The organizer answering a request to move a call: Move it moves the call there, as changing its time does; Keep lets the request go. */
export function useAnswerProposal() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: string; email: string; answer: ProposalAnswer }) => api.meetings.answerProposal(v.id, v.email, v.answer), onSuccess: (m) => { qc.setQueryData(callKeys.meeting(m.id), m); callsChanged(qc); } });
}

/**
 * Gets a call ready before it starts, from its page: its home settled, with an agenda, a board or a document for files (`name`)
 * made there and brought to the call. The call reads again, and so does what you can bring and the workspaces you're in.
 */
export function useReadyCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; make: CallAheadMake; name?: string | undefined }) => api.calls.ready(v.id, v.make, v.name),
    onSuccess: () => { callsChanged(qc); void qc.invalidateQueries({ queryKey: workspaceKeys.documents }); void qc.invalidateQueries({ queryKey: workspaceKeys.workspaces }); }
  });
}
