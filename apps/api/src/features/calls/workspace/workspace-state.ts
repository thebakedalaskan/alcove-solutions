import type { Owner } from '../../../platform/context';
import { tx } from '../../../platform/db';
import * as space from './workspace';
import { log } from '../../../platform/log';
import { placesOf } from '../places';
import { load, save } from '../state';
import { tellRoom } from '../attention/notifications';
import { openForCall } from '../../workspaces/access';

const clog = log.child({ component: 'calls' });

/**
 * Whoever started something has lost its document, or the workspace they presented: it stops for everyone, how a presentation
 * ended is said where it was presented, and it doesn't come back if they're given it again. A workspace everyone viewed that's
 * been deleted since takes them back to the home, which opens to everyone in the call then, if nothing had (a board settled
 * it, or the release before did). Reading the call finds this out, and a read isn't refused for it: the next read tries again.
 */
export async function stopLost(o: Owner, callId: string, lost: space.Lost): Promise<void> {
  const backHome = lost.viewing !== null;
  let saved: { room: string | null; home: string | null };
  try {
    saved = await tx(o.pool, async (c) => {
      const { row, state } = await load(o, c, callId, true);
      if (row.state === 'live') await save(o, c, callId, { ...state, workspace: space.withoutLost(state.workspace, lost, placesOf(state), space.ending(o, callId)) });
      return { room: row.room_name, home: state.workspace.home?.workspaceId ?? null };
    });
  } catch (e) {
    clog.warn('what someone lost not stopped', { callId, backHome, err: e });
    return;
  }
  clog.info(backHome ? 'back in the home: the workspace everyone viewed is gone' : 'stopped: whoever started it lost the document',
    { callId, present: lost.present.length, space: lost.space.length, play: lost.play.length, backHome });
  const { room, home } = saved;
  if (backHome && home !== null) await openForCall({ organizer: o, callId }, home).catch((e: unknown) => clog.warn('the home not opened to the call', { callId, workspaceId: home, err: e }));
  await tellRoom(o, room, callId, { call: true, log: false });
}
