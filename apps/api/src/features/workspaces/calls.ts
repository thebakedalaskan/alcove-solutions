/*
 * What a workspace asks of calls. Calls sit above workspaces (docs/engineering/folder-ownership.md): a call opens a workspace to
 * everyone in it, gives seats documents and makes boards for its rooms, so the workspace keeps rows that name calls and seats,
 * and nothing more of them. What only a call knows, it answers here (features/calls/workspace/seats.ts › workspaceCalls), and
 * whoever reaches into a workspace with something that may touch a call hands that in: app.ts to the routes, upkeep
 * (maintenance.ts), and calls, meetings and account to what they call here.
 */
import type { CallPass } from '../../keys/call-pass';
import type { Deps, Owner } from '../../platform/context';
import type { Db } from '../../platform/db';
import type { Seat } from './access';

/** What a call says of its rooms' boards to a workspace asking what's stranded (`Calls.roomsOf`). */
export type RoomsOfCall = { live: true; boards: string[] } | { live: false; invited: string[] };

export interface Calls {
  /**
   * The seat behind a call pass, for whoever's signed in as `account`, if anyone: while they're let in and the call is going on,
   * with what the call answers about them (`Seat.call`). Removed, not let in, or the call is over: no seat. A pass the call
   * refuses throws as the call would.
   */
  seatOf(d: Deps, pass: CallPass, account: Owner | undefined): Promise<Seat | undefined>;
  /**
   * Whether someone's in a seat now, known only by its name, for what carries a seat in place of a pass (a file's URL): the call
   * is going on, and whoever has the seat is let in and wasn't taken out. With the workspace the call uses now.
   */
  stillIn(d: Deps, at: { callId: string; organizer: string; seat: string }): Promise<{ workspace: string | null } | undefined>;
  /** Tells a call going on to read itself again: something here changed what someone in it can open. */
  tell(d: Pick<Deps, 'pool' | 'livekit'>, callId: string): Promise<void>;
  /**
   * What these calls (by organizer and call, as a workspace's tree names them) say of their rooms' boards, read with `db`, the
   * workspace's transaction, holding nothing of any call. A call that's gone, or whose organizer is, says nothing.
   */
  roomsOf(d: Deps, calls: { ownerId: string; callId: string }[], db: Db): Promise<Map<string, RoomsOfCall>>;
}
