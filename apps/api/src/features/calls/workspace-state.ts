import type { Owner } from '../../context';
import { tx } from '../../db';
import * as space from './workspace';
import { log } from '../../log';
import { placesOf } from './places';
import { load, save } from './state';
import { tellRoom } from './notifications';
import { openForCall } from '../workspaces/access';

const clog = log.child({ component: 'calls' });

/**
 * Whoever started something has lost its document, or the workspace they presented: it stops for everyone, how a presentation
 * ended is said where it was presented, and it doesn't come back if they're given it again. A workspace everyone viewed that's
 * been deleted since takes them back to the home, which opens to everyone in the call. Reading the call finds this out, and a
 * read isn't refused for it: the next read tries again.
 */
export async function stopLost(o: Owner, callId: string, lost: space.Lost): Promise<void> {
  try {
    const { room, home } = await tx(o.pool, async (c) => {
      const { row, state } = await load(o, c, callId, true);
      if (row.state === 'live') await save(o, c, callId, { ...state, workspace: space.withoutLost(state.workspace, lost, placesOf(state), space.ending(o, callId)) });
      return { room: row.room_name, home: state.workspace.home?.workspaceId ?? null };
    });
    if (lost.viewing !== null && home !== null) await openForCall({ organizer: o, callId }, home);
    clog.info('stopped: whoever started it lost the document', { callId, present: lost.present.length, space: lost.space.length, play: lost.play.length });
    await tellRoom(o, room, callId, { call: true, log: false });
  } catch (e) {
    clog.warn('what someone lost not stopped', { callId, err: e });
  }
}
