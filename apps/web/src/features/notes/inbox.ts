/*
 * What's waiting on you in your notes: the inbox (decisions to make and follow-ups you've taken on), and notes someone shared
 * with you lately. For you on Home lists them, and the side panel counts them.
 */
import { isAcceptedFollowUp, type Inbox, type NoteSummary } from '@alcove/api';

const WEEK_MS = 7 * 86_400_000;
/** Notes someone shared with you this past week. */
export const sharedLately = (notes: readonly NoteSummary[], now: number) => notes.filter((n) => n.received?.role === 'shared' && now - new Date(n.received.at).getTime() < WEEK_MS);
/**
 * How much is waiting on you, by For you's tabs before you answer anything: to answer (decisions, follow-ups the notes
 * suggest are yours, notes shared with you lately), and the follow-ups you took on. The side panel's Home counts both.
 */
export function waitingCounts(inbox: Inbox, notes: readonly NoteSummary[], now: number): { ask: number; todo: number } {
  const followUps = inbox.followUps.filter(isAcceptedFollowUp);
  const todo = followUps.filter((a) => a.takenOn).length;
  return { ask: inbox.decisions.length + followUps.length - todo + sharedLately(notes, now).length, todo };
}
