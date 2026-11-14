/*
 * What's waiting on you in your notes: the inbox (decisions to make and follow-ups you've taken on), and notes someone shared
 * with you lately. For you on Home lists them, and the side panel counts them.
 */
import { isAcceptedFollowUp, type Inbox, type NoteSummary } from '@alcove/api';

const WEEK_MS = 7 * 86_400_000;
/** Notes someone shared with you this past week. */
export const sharedLately = (notes: readonly NoteSummary[], now: number) => notes.filter((n) => n.received?.role === 'shared' && now - new Date(n.received.at).getTime() < WEEK_MS);
/** How much is waiting on you: For you's count, and the side panel's. */
export const openCount = (inbox: Inbox, notes: readonly NoteSummary[], now: number) => inbox.decisions.length + inbox.followUps.filter(isAcceptedFollowUp).length + sharedLately(notes, now).length;
