import { type Series } from '../notes/series';
import { type ID, type ISODate } from '../shared/ids';
import { type LiveStore } from '../shared/live';
import { type InstantCallInput } from './entry';
import { type CallMoveIn } from './moves';
import { type IncomingRing, type RingReply } from './rings';
import { type CallSession } from './session';
import { type CallCard } from './state';
/**
 * The API as the listener service (apps/listener) uses it, with its key: never the app's. A listener LiveKit sent to a
 * call joins it with the invite its dispatch carried.
 */
export interface ListenerApi {
  join(invite: string): Promise<{ place: string; session: CallSession }>;
}

export interface CallsApi {
  /** Creates a call that starts now and returns its code. */
  startNow(input?: InstantCallInput): Promise<{ code: string }>;
  /** What a call's link says before joining, for anyone, signed in or not: its title and organizer, whether notes are on, and where you stand. */
  card(code: string): Promise<CallCard>;
  /**
   * Settles a call that offers times on one of them, for anyone with its link, signed in or not. It goes on the organizer's
   * calendar then. Picking again once it's settled is refused.
   */
  pick(code: string, at: ISODate): Promise<CallCard>;
  /**
   * What carries over into a call, for someone signed in: its series as you see it, from the earlier notes you have
   * now, before joining and during the call. Null when the call isn't in a series, or you aren't its organizer and
   * have no notes from it: being invited to this call opens nothing from the others.
   */
  series(code: string): Promise<Series | null>;
  /**
   * Joins a call by its link. The organizer hosts; invited people join with their accounts; anyone else asks to
   * join: signed in, under their account, otherwise with `name` (1–60 characters). Refused until the organizer is
   * there, while the call is locked, and once it has ended.
   */
  join(code: string, opts: { mic: boolean; cam: boolean; name?: string | undefined; previous?: string | undefined }): Promise<CallSession>;
  /**
   * Opens a move link on this device, with the code from the link's fragment. The code works once: from now on
   * this device holds the move (and the other device sees it was opened). Refused once the code has run out or
   * been used.
   */
  openMove(code: string): Promise<CallMoveIn>;
  /** Picks up a move this tab opened before it went to sign in, by the claim it kept (in this tab's sessionStorage). */
  resumeMove(claim: string): Promise<CallMoveIn>;
}

export interface RingsApi {
  /**
   * Who's ringing you now, pushed as it changes for as long as it's open. It reconnects by itself; `close` ends it.
   * A browser opens one and the whole app reads it.
   */
  live(): LiveStore<IncomingRing[]> & { close(): void };
  /**
   * Answers a ring, which leaves `live()` at once: `join` takes it off your screen on the way to the call; the others
   * tell the organizer, and `in-5` and `in-15` ring you again then. `not-found` once the ring is gone: it was stopped,
   * or the call ended.
   */
  answer(id: ID, reply: RingReply): Promise<void>;
}
