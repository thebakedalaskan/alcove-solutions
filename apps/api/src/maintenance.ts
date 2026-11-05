/*
 * Background upkeep (runs every few minutes in the API process):
 *  - removes sessions that have ended;
 *  - purges operation receipts older than 24 hours (they may hold copies of responses);
 *  - retries failed object deletions;
 *  - removes objects older than 24 hours that nothing references (audio or frame writes whose SQL commit failed);
 *  - writes notes still waiting (after a restart, or once a retry is due);
 *  - deletes moves to other devices that ran out;
 *  - deletes rings a day after they ran out, in calls that went on that long;
 *  - deletes for good what's been in a workspace's Trash for 30 days, ends seats whose call is over, and lets go of tags
 *    nobody came back for in 30 days;
 *  - deletes live notes a call left behind when a release from before them ended it.
 */
import { z } from 'zod';
import type { Deps } from './context';
import { exec, rows } from './db';
import { errorMessage } from '@alcove/api';
import { log } from './log';
import { reconcile } from './modules/calls';
import { sweep as sweepLiveNotes } from './modules/liveNotes';
import { sweep as sweepMoves } from './modules/moves';
import { sweep as sweepRings } from './modules/rings';
import { sweepMentions } from './modules/workspaceMentions';
import { sweepSeats, sweepTrash } from './modules/workspaces';
import { work } from './modules/writer';
import { sweepSessions } from './sessions';

const mlog = log.child({ component: 'maintenance' });

const ORPHAN_AGE_MS = 24 * 60 * 60_000;

export async function maintain(d: Deps, opts: { orphanAgeMs?: number; trashAgeMs?: number } = {}) {
  const sessions = await sweepSessions(d);
  const receipts = await exec(d.pool, `DELETE FROM operations WHERE completed_at < now() - interval '24 hours'`);

  let retried = 0;
  for (const g of await rows(d.pool, z.object({ object_id: z.string() }), 'SELECT object_id FROM object_gc ORDER BY queued_at LIMIT 500')) {
    try {
      await d.objects.delete(g.object_id);
      await exec(d.pool, 'DELETE FROM object_gc WHERE object_id = $1', [g.object_id]);
      retried++;
    } catch (e) {
      mlog.warn('object delete retry failed', { objectId: g.object_id, err: e });
      await exec(d.pool, 'UPDATE object_gc SET attempts = attempts + 1, last_error = $2 WHERE object_id = $1', [g.object_id, errorMessage(e).slice(0, 200)]);
    }
  }

  let orphans = 0;
  const cutoff = Date.now() - (opts.orphanAgeMs ?? ORPHAN_AGE_MS);
  for await (const obj of d.objects.list()) {
    if (obj.lastModified.getTime() > cutoff) continue;
    // Audio pieces and shared-screen frames are the objects rows point at.
    const ref = await rows(d.pool, z.object({ n: z.number() }), 'SELECT 1 AS n FROM recording_pieces WHERE object_id = $1 UNION ALL SELECT 1 AS n FROM screen_frames WHERE object_id = $1 LIMIT 1', [obj.id]);
    if (!ref.length) {
      mlog.info('deleting orphaned object', { objectId: obj.id, ageH: Math.round((Date.now() - obj.lastModified.getTime()) / 3_600_000) });
      await d.objects.delete(obj.id).then(() => { orphans++; }, (e: unknown) => mlog.warn('orphan delete failed', { objectId: obj.id, err: e }));
    }
  }
  const notes = await work(d);
  const calls = await reconcile(d);
  const moves = await sweepMoves(d);
  const rings = await sweepRings(d);
  const liveNotes = await sweepLiveNotes(d);
  // Neither stops the other, or what comes next time: each logs what went wrong and says it did nothing.
  const quietly = (what: string, sweep: () => Promise<number>) => sweep().catch((e: unknown) => { mlog.warn('workspace upkeep failed', { what, err: e }); return 0; });
  const trash = await quietly('trash', () => sweepTrash(d, opts.trashAgeMs));
  const seats = await quietly('seats', () => sweepSeats(d));
  const mentions = await quietly('mentions', () => sweepMentions(d));
  return { sessions, receipts, retried, orphans, notes, calls, moves, rings, liveNotes, trash, seats, mentions };
}
