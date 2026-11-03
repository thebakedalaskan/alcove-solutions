/*
 * Background upkeep (runs every few minutes in the API process):
 *  - closes expired owner sessions, so idle roots leave memory even if the browser never returns;
 *  - purges operation receipts older than 24 hours (they may hold copies of responses);
 *  - retries failed object deletions;
 *  - removes objects older than 24 hours that nothing references (writes whose SQL commit failed).
 */
import { z } from 'zod';
import type { Deps } from './context';
import { exec, rows } from './db';
import { errorMessage } from '@alcove/api';
import { log } from './log';

const mlog = log.child({ component: 'maintenance' });

const ORPHAN_AGE_MS = 24 * 60 * 60_000;

export async function maintain(d: Deps, opts: { orphanAgeMs?: number } = {}) {
  const sessions = d.sessions.sweep();
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
    const ref = await rows(d.pool, z.object({ n: z.number() }), `SELECT 1 AS n FROM recording_pieces WHERE object_id = $1
      UNION ALL SELECT 1 FROM object_refs WHERE object_id = $1 UNION ALL SELECT 1 FROM upload_parts WHERE object_id = $1 LIMIT 1`, [obj.id]);
    if (!ref.length) {
      mlog.info('deleting orphaned object', { objectId: obj.id, ageH: Math.round((Date.now() - obj.lastModified.getTime()) / 3_600_000) });
      await d.objects.delete(obj.id).then(() => { orphans++; }, (e: unknown) => mlog.warn('orphan delete failed', { objectId: obj.id, err: e }));
    }
  }
  return { sessions, receipts, retried, orphans };
}
