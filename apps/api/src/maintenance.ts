/*
 * Background upkeep (runs every few minutes in the API process):
 *  - removes sessions that have ended;
 *  - purges operation receipts older than 24 hours (they may hold copies of responses);
 *  - retries failed object deletions;
 *  - removes objects older than 24 hours that nothing references (audio, shared-screen video, frame or file writes whose SQL commit failed);
 *  - joins shared screens' video that is still in pieces once the share's tail is over (replay doesn't need the notes service);
 *  - writes notes still waiting (after a restart, or once a retry is due);
 *  - deletes moves to other devices, and links to call notes, that ran out;
 *  - deletes rings a day after they ran out, in calls that went on that long;
 *  - deletes for good what's been in a workspace's Trash for 30 days, ends seats whose call is over, and lets go of tags
 *    nobody came back for in 30 days;
 *  - deletes live notes a call left behind when a release from before them ended it;
 *  - settles who pays for workspaces nobody does, gives accounts from before plans their plan, ends graces that are
 *    over, and adds as dollars top-ups the previous release settled;
 *  - deletes team invites that expired, and reckons the storage pool of each team whose license ended or whose grace did;
 *  - takes away what an upload left when its browser went, a day on, and forgets uploads counted before yesterday.
 *
 * Each step stands alone: one that fails is logged and the rest still run, so a sweep that keeps failing can't stop
 * notes being written or Drive exports going.
 */
import { z } from 'zod';
import type { Deps } from './context';
import { exec, rows } from './db';
import { log } from './log';
import { deleteQueued } from './features/recordings/audio';
import { sweep as sweepAgents } from './features/agents/service';
import { reconcile } from './features/calls/lifecycle';
import { sweep as sweepLiveNotes } from './features/calls/live-notes';
import { sweep as sweepAttention } from './features/calls/attention';
import { pruneUploadDays, sweepUploads } from './features/workspaces/media';
import { sweep as sweepMoves } from './features/calls/moves';
import { sweep as sweepNoteLinks } from './features/notes/links';
import { sweep as sweepRings } from './features/calls/rings';
import { sweepMentions } from './features/workspaces/mentions';
import { sweepSeats, sweepTrash } from './features/workspaces/service';
import { joinDue } from './features/recordings/screens';
import { work } from './features/notes/writer';
import { work as exportToDrive } from './features/notes/drive-worker';
import { upkeep as plansUpkeep } from './features/billing/plans';
import { upkeep as teamsUpkeep } from './features/billing/teams';
import { creditCarried } from './features/billing/deposits';
import { sweepSessions } from './sessions';

const mlog = log.child({ component: 'maintenance' });

const ORPHAN_AGE_MS = 24 * 60 * 60_000;

/** One step of upkeep: whatever goes wrong in it is logged, and it counts nothing; the steps after it still run. */
async function step<T>(what: string, run: () => Promise<T>, none: T): Promise<T> {
  try { return await run(); } catch (e) { mlog.error('upkeep step failed; the rest of upkeep goes on', { what, err: e }); return none; }
}

export async function maintain(d: Deps, opts: { orphanAgeMs?: number; trashAgeMs?: number; uploadAgeMs?: number } = {}) {
  /* What's old enough to go is as old as it was when upkeep started: the sweeps before one don't move its line. */
  const started = Date.now();
  const sessions = await step('sessions', () => sweepSessions(d), 0);
  const agents = await step('agents', () => sweepAgents(d), 0);
  const receipts = await step('receipts', () => exec(d.pool, `DELETE FROM operations WHERE completed_at < now() - interval '24 hours'`), 0);

  const retried = await step('object deletes', () => deleteQueued(d), 0);

  const orphans = await step('orphaned objects', () => sweepOrphans(d, Date.now() - (opts.orphanAgeMs ?? ORPHAN_AGE_MS)), 0);
  // Shared screens' video, for any whose timer was lost (a restart) or whose join failed.
  const { joined: videos } = await step('shared screens', () => joinDue(d), { joined: 0, waitMs: null });
  const notes = await step('notes', () => work(d), 0);
  const calls = await step('calls', () => reconcile(d), 0);
  const driveExports = await step('drive exports', () => exportToDrive(d), 0);
  const moves = await step('moves', () => sweepMoves(d), 0);
  const noteLinks = await step('note links', () => sweepNoteLinks(d), 0);
  const rings = await step('rings', () => sweepRings(d), 0);
  const liveNotes = await step('live notes', () => sweepLiveNotes(d), 0);
  const attention = await step('attention', () => sweepAttention(d), 0);
  // Plans: who pays for each workspace, every account's plan, graces that ended, and top-ups paid for before plans.
  const plans = await step('plans', () => plansUpkeep(d).then((r) => r.settled + r.carried + r.due), 0);
  const carried = await step('carried top-ups', () => creditCarried(d), 0);
  // Teams: invites that expired, and pools that shrank as a license ended, or whose grace ended.
  const teams = await step('teams', () => teamsUpkeep(d).then((r) => r.invites + r.teams), 0);
  // Neither stops the other, or what comes next time: each logs what went wrong and says it did nothing.
  const quietly = (what: string, sweep: () => Promise<number>) => sweep().catch((e: unknown) => { mlog.warn('workspace upkeep failed', { what, err: e }); return 0; });
  const trash = await quietly('trash', () => sweepTrash(d, opts.trashAgeMs, started));
  const seats = await quietly('seats', () => sweepSeats(d));
  const uploads = await quietly('uploads', () => sweepUploads(d, opts.uploadAgeMs, started));
  const uploadDays = await quietly('upload days', () => pruneUploadDays(d));
  const mentions = await quietly('mentions', () => sweepMentions(d));
  return { driveExports, sessions, agents, receipts, retried, orphans, videos, notes, calls, moves, noteLinks, rings, liveNotes, attention, plans, carried, teams, trash, seats, uploads, uploadDays, mentions };
}

/** Deletes objects older than `cutoff` (ms) that no row points at: writes whose SQL commit failed. */
async function sweepOrphans(d: Deps, cutoff: number): Promise<number> {
  let orphans = 0;
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
  return orphans;
}
