import { type CallAction } from '@alcove/api';
import { ConflictError } from '../../errors';
import * as space from './workspace';
import * as boards from './boards';
import { type Viewer } from './participants';
import { type Stored } from './state';

/* ---------- during the call: the organizer's controls, and what anyone in it can do ---------- */

/**
 * Everything in `act` but a raised hand, an ask for notes, your own share's pointing, ticking or adding a follow-up, what goes by
 * what you can open in the workspace, a board and its timer and vote, and ideas from the call done with, is whoever hosts' (the
 * organizer's own besides, checked by the API).
 */
export const anyone = (a: CallAction): boolean =>
  a.type === 'read-chat' || a.type === 'hand' || a.type === 'request-notes' || a.type === 'others-point' || a.type === 'follow-up' || a.type === 'follow-up-add' || a.type === 'follow-up-edit' || a.type === 'follow-up-review' || a.type === 'board-ideas-done' || space.anyonesAction(a) ||
  boards.isBoardAction(a) || boards.isRunAction(a);

/**
 * Refused for a connection that doesn't host now (`who`: the connection that does, by default whoever hosts): checked
 * again where it counts, as the host may have changed since the request came in. The same 409 as the API's for a
 * connection that hosted before, so its browser drops what it was still sending.
 */
export function stillHosting(v: Viewer, s: Stored, ctx: Record<string, string | number | boolean | null>, who: string | null = s.host): void {
  if (who !== v.pass.identity) throw new ConflictError('You’re not hosting this call from here any more.', { context: { ...ctx, why: 'not host' }, level: 'info' });
}
