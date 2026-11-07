/*
 * Background upkeep (runs every few minutes in the API process):
 *  - removes sessions that have ended;
 *  - purges operation receipts older than 24 hours (they may hold copies of responses);
 *  - retries failed object deletions;
 *  - removes objects older than 24 hours that nothing references (audio, shared-screen video, frame or file writes whose SQL commit failed);
 *  - joins shared screens' video that is still in pieces once the share's tail is over (replay doesn't need the notes service);
 *  - writes notes still waiting (after a restart, or once a retry is due);
 *  - deletes moves to other devices that ran out;
 *  - deletes rings a day after they ran out, in calls that went on that long;
 *  - deletes for good what's been in a workspace's Trash for 30 days, ends seats whose call is over, and lets go of tags
 *    nobody came back for in 30 days;
 *  - deletes live notes a call left behind when a release from before them ended it;
 *  - takes away what an upload left when its browser went, a day on, and forgets uploads counted before yesterday.
 */
import { z } from 'zod';
import type { Deps } from './context';
import { exec, rows } from './db';
import { log } from './log';
import { deleteQueued } from './features/recordings/audio';
import { sweep as sweepAgents } from './features/agents/service';
import { reconcile } from './features/calls/lifecycle';
import { sweep as sweepLiveNotes } from './features/calls/live-notes';
import { pruneUploadDays, sweepUploads } from './features/workspaces/media';
import { sweep as sweepMoves } from './features/calls/moves';
import { sweep as sweepRings } from './features/calls/rings';
import { sweepMentions } from './features/workspaces/mentions';
import { sweepSeats, sweepTrash } from './features/workspaces/service';
import { joinDue } from './features/recordings/screens';
import { work } from './features/notes/writer';
import { sweepSessions } from './sessions';

const mlog = log.child({ component: 'maintenance' });

const ORPHAN_AGE_MS = 24 * 60 * 60_000;

export async function maintain(d: Deps, opts: { orphanAgeMs?: number; trashAgeMs?: number; uploadAgeMs?: number } = {}) {
  /* What's old enough to go is as old as it was when upkeep started: the sweeps before one don't move its line. */
  const started = Date.now();
  const sessions = await sweepSessions(d);
  const agents = await sweepAgents(d);
  const receipts = await exec(d.pool, `DELETE FROM operations WHERE completed_at < now() - interval '24 hours'`);

  const retried = await deleteQueued(d);

  let orphans = 0;
  const cutoff = Date.now() - (opts.orphanAgeMs ?? ORPHAN_AGE_MS);
  for await (const obj of d.objects.list()) {
    if (obj.lastModified.getTime() > cutoff) continue;
    // Audio pieces, shared screens' video (pieces and joined chunks), frames, pieces of files and pictures' previews are the objects rows point at.
    const ref = await rows(d.pool, z.object({ n: z.number() }), `SELECT 1 AS n FROM recording_pieces WHERE object_id = $1 UNION ALL SELECT 1 AS n FROM screen_frames WHERE object_id = $1
      UNION ALL SELECT 1 AS n FROM screen_pieces WHERE object_id = $1 UNION ALL SELECT 1 AS n FROM screen_videos WHERE object_id = $1
      UNION ALL SELECT 1 AS n FROM workspace_media_pieces WHERE object_id = $1 UNION ALL SELECT 1 AS n FROM workspace_media_previews WHERE object_id = $1 LIMIT 1`, [obj.id]);
    if (!ref.length) {
      mlog.info('deleting orphaned object', { objectId: obj.id, ageH: Math.round((Date.now() - obj.lastModified.getTime()) / 3_600_000) });
      await d.objects.delete(obj.id).then(() => { orphans++; }, (e: unknown) => mlog.warn('orphan delete failed', { objectId: obj.id, err: e }));
    }
  }
  // Shared screens' video, for any whose timer was lost (a restart) or whose join failed.
  const { joined: videos } = await joinDue(d);
  const notes = await work(d);
  const calls = await reconcile(d);
  const moves = await sweepMoves(d);
  const rings = await sweepRings(d);
  const liveNotes = await sweepLiveNotes(d);
  // Neither stops the other, or what comes next time: each logs what went wrong and says it did nothing.
  const quietly = (what: string, sweep: () => Promise<number>) => sweep().catch((e: unknown) => { mlog.warn('workspace upkeep failed', { what, err: e }); return 0; });
  const trash = await quietly('trash', () => sweepTrash(d, opts.trashAgeMs, started));
  const seats = await quietly('seats', () => sweepSeats(d));
  const uploads = await quietly('uploads', () => sweepUploads(d, opts.uploadAgeMs, started));
  const uploadDays = await quietly('upload days', () => pruneUploadDays(d));
  const mentions = await quietly('mentions', () => sweepMentions(d));
  return { sessions, agents, receipts, retried, orphans, videos, notes, calls, moves, rings, liveNotes, trash, seats, uploads, uploadDays, mentions };
}
