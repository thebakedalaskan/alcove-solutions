import type { Owner } from '../../context';
import { tx } from '../../db';
import * as space from './workspace';
import { log } from '../../log';
import { load, save } from './state';
import { nudge } from './notifications';

const clog = log.child({ component: 'calls' });

/**
 * Whoever started something has lost its document: it stops for everyone, and doesn't come back if they're given it again.
 * Reading the call finds this out, and a read isn't refused for it: the next read tries again.
 */
export async function stopLost(o: Owner, callId: string, lost: space.Lost): Promise<void> {
  try {
    const room = await tx(o.pool, async (c) => {
      const { row, state } = await load(o, c, callId, true);
      if (row.state === 'live') await save(o, c, callId, { ...state, workspace: space.withoutLost(state.workspace, lost) });
      return row.room_name;
    });
    clog.info('stopped: whoever started it lost the document', { callId, present: lost.present.length, play: lost.play.length });
    await nudge(o, room, callId, { call: true, log: false });
  } catch (e) {
    clog.warn('what someone lost not stopped', { callId, err: e });
  }
}
