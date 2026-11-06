/*
 * What the listener service hears (docs: Calls and recordings › The listener). Each part of a live call whose notes are
 * on or paused has a task, the main room's for now; the call's own changes keep them (`follow`, on every save of its
 * state). The API asks LiveKit to send a listener to each task (`supervise`, which a new task kicks and which runs every
 * few seconds too): LiveKit pushes the job to one of the listener processes registered with it, which joins through
 * the API with the one-time invite the dispatch carried (`take`). While it holds the task, the speech it sends for that
 * part of the call is taken. A task whose listener never joined within ARRIVE_WITHIN_MS of being sent, or left, is sent
 * another. LiveKit never sends one again by itself (we tell LiveKit Cloud not to; its own server never does).
 *
 * A task that's done isn't deleted: it's ended, with why, and keeps who held it last and how many listeners were sent,
 * so what happened in a call can be looked into afterwards. Maintenance deletes ended tasks after a week (`sweep`).
 */
import { MAIN_PLACE } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../../context';
import { b64u, id128, random, sha } from '../../crypto';
import { exec, maybeOne, rows, timestamp, tx, type Db } from '../../db';
import { log } from '../../log';

const llog = log.child({ component: 'listening' });

/** How long a listener has to join after it's sent, before another is sent. */
export const ARRIVE_WITHIN_MS = 10_000;
/** How often every API instance looks for tasks that need a listener sent. */
export const SUPERVISE_EVERY_MS = 5_000;
/**
 * How long a listener may go without asking the API anything (it asks every few seconds) and still count as hearing,
 * and then as there at all: a crash LiveKit never told of, or one that's stuck, is found by this.
 */
const UNSEEN_MS = 20_000;
const GONE_MS = 30_000;
/** How often a listener's asking is noted: no more than one write each this often. */
const SEEN_EVERY_MS = 5_000;
/** A listener that leaves this soon after joining without ever being heard failed: the next waits before it's sent. */
const FAILED_WITHIN_MS = 30_000;
/** Seconds the next listener waits after `failures` in a row: 10, 20, 40… up to five minutes. */
const backoff = `(CASE WHEN t.failures = 0 THEN 0 ELSE least(10 * power(2, t.failures - 1), 300) END)`;
/** How long the invite a listener is sent with can be used. */
const INVITE_TTL_MS = 60_000;
/**
 * A listener's invite: random, meaning nothing. LiveKit carries it in the dispatch, so it says nothing about the call
 * or its account; only its hash is kept, on the task, so the database can't join a call with what it holds either.
 */
const newInvite = (): string => b64u(random(32));
const inviteHash = (invite: string): string => b64u(sha(new TextEncoder().encode(invite)));
/** How long an ended task is kept, to look into what happened. */
const KEEP_ENDED_DAYS = 7;
/** The most tasks one look sends listeners to: the next look takes the rest. */
const DISPATCH_AT_ONCE = 50;

const where = (place: string) => (place === MAIN_PLACE ? 'main' : 'room');

/** Ends a call's open tasks, saying why. */
async function endOpen(o: Owner, db: Db, callId: string, why: 'notes-off' | 'call-ended'): Promise<void> {
  const n = await exec(db, `UPDATE listen_tasks SET ended_at = now(), ended_why = $3, invite_id = NULL
    WHERE owner_id = $1 AND call_id = $2 AND ended_at IS NULL`, [o.ownerId, callId, why]);
  if (n) llog.info('listening tasks ended', { callId, tasks: n, why });
}

/**
 * Keeps a call's tasks in step with its notes, in the transaction that saves its state: one for the main room while
 * notes are on or paused, none open once they're off. A new task gets a listener sent as soon as that's committed.
 */
export async function follow(o: Owner, db: Db, callId: string, notes: 'on' | 'paused' | 'off'): Promise<void> {
  if (notes === 'off') { await endOpen(o, db, callId, 'notes-off'); return; }
  // Only a live call is heard: an ended call's state is still saved as it's tidied up.
  const opened = await exec(db, `INSERT INTO listen_tasks (owner_id, task_id, call_id, place) SELECT $1::text, $2::text, $3::text, $4::text
    WHERE EXISTS (SELECT 1 FROM calls WHERE owner_id = $1 AND call_id = $3 AND state = 'live')
    ON CONFLICT (owner_id, call_id, place) WHERE ended_at IS NULL DO NOTHING`, [o.ownerId, id128(), callId, MAIN_PLACE]);
  if (opened) kick(o);
}

/** Ends every task of a call, once it's over. */
export async function end(o: Owner, db: Db, callId: string): Promise<void> {
  await endOpen(o, db, callId, 'call-ended');
}

const Due = z.object({ owner_id: z.string(), task_id: z.string(), call_id: z.string(), room_name: z.string(), dispatches: z.number(), failures: z.number(), dispatched_at: timestamp.nullable(), joined_at: timestamp.nullable(), left_at: timestamp.nullable() });
/** Why a task is sent a listener: it's new, its listener never joined in time, left, or hasn't been seen for a while. */
const whyOf = (t: z.infer<typeof Due>): 'new' | 'never-arrived' | 'left' | 'unseen' => (!t.dispatched_at ? 'new' : t.left_at ? 'left' : t.joined_at ? 'unseen' : 'never-arrived');

/**
 * Sends a listener to every open task of a live call that needs one, once there's a listener service (LISTENER_KEY):
 * never sent one, its listener didn't join within ARRIVE_WITHIN_MS, it left, or it hasn't asked the API anything for
 * GONE_MS. After listeners in a row that failed (left without ever being heard), the next waits (`backoff`), so one
 * that can't work doesn't come and go over and over. Each task is taken under a row lock that other API instances skip, so two instances
 * looking at once send one listener, not two. Each send has a new invite, so a listener sent before can't join with
 * its own any more. Returns how many it sent.
 */
export async function supervise(d: Deps): Promise<number> {
  // With no listener service set up (no LISTENER_KEY), no listener could join: nothing is sent, and the tasks wait.
  if (!d.cfg.LISTENER_KEY) return 0;
  const sent = await tx(d.pool, async (c) => {
    const due = await rows(c, Due, `
      SELECT t.owner_id, t.task_id, t.call_id, k.room_name, t.dispatches, t.failures, t.dispatched_at, t.joined_at, t.left_at FROM listen_tasks t
      JOIN calls k ON k.owner_id = t.owner_id AND k.call_id = t.call_id AND k.state = 'live' AND k.room_name IS NOT NULL
      WHERE t.ended_at IS NULL AND (t.dispatched_at IS NULL
        OR (t.left_at IS NOT NULL AND t.left_at < now() - make_interval(secs => ${backoff}))
        OR (t.joined_at IS NULL AND t.dispatched_at < now() - make_interval(secs => greatest($1, ${backoff})))
        OR (t.joined_at IS NOT NULL AND t.left_at IS NULL AND coalesce(t.seen_at, t.joined_at) < now() - make_interval(secs => $2)))
      ORDER BY t.created_at LIMIT ${DISPATCH_AT_ONCE} FOR UPDATE OF t SKIP LOCKED`, [ARRIVE_WITHIN_MS / 1000, GONE_MS / 1000]);
    const out: { task: z.infer<typeof Due>; invite: string; why: ReturnType<typeof whyOf> }[] = [];
    for (const t of due) {
      const invite = newInvite();
      await exec(c, `UPDATE listen_tasks SET dispatches = dispatches + 1, dispatched_at = now(), invite_id = $3, holder = NULL, joined_at = NULL, heard_at = NULL, heard_generation = NULL, heard_segment = NULL, seen_at = NULL, left_at = NULL
        WHERE owner_id = $1 AND task_id = $2`, [t.owner_id, t.task_id, inviteHash(invite)]);
      out.push({ task: t, why: whyOf(t), invite });
    }
    return out;
  });
  // Asked of LiveKit once the invites are kept: a listener that's quick can't arrive before its invite does.
  for (const { task, invite, why } of sent) {
    const ctx = { callId: task.call_id, taskId: task.task_id, dispatches: task.dispatches + 1, why };
    await d.livekit.dispatch(task.room_name, d.cfg.LISTENER_AGENT, JSON.stringify({ invite })).then(
      () => llog.info(why === 'new' ? 'listener dispatched' : 'listener missing; dispatching again', { ...ctx, failures: task.failures }),
      (e: unknown) => llog.warn('listener not dispatched; trying again shortly', { ...ctx, err: e }));
  }
  return sent.length;
}

/** Whether a look for tasks needing a listener is already on its way in this process. */
let kicked = false;
/** Looks for tasks that need a listener in a moment, once the transaction that opened one has committed. */
function kick(from: Deps): void {
  if (kicked) return;
  kicked = true;
  const d: Deps = { cfg: from.cfg, pool: from.pool, objects: from.objects, livekit: from.livekit, hub: from.hub, docs: from.docs };
  setTimeout(() => { kicked = false; supervise(d).catch((e: unknown) => llog.warn('looking for tasks that need a listener failed', { err: e })); }, 200).unref();
}

/** Looks for tasks that need a listener every SUPERVISE_EVERY_MS, in this process, until it's stopped. */
export function supervising(d: Deps): () => void {
  const timer = setInterval(() => { supervise(d).catch((e: unknown) => llog.warn('looking for tasks that need a listener failed', { err: e })); }, SUPERVISE_EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
}

const Taken = z.object({ owner_id: z.string(), call_id: z.string(), task_id: z.string(), place: z.string() });
/**
 * Takes a listener's invite, once, within INVITE_TTL_MS of its dispatch: the listener becomes the task's holder, as of
 * now. An invite already taken, replaced by a newer send, too old, or for a task that's ended, finds nothing.
 */
export async function take(d: Pick<Deps, 'pool'>, invite: string, identity: string): Promise<z.infer<typeof Taken> | undefined> {
  const t = await maybeOne(d.pool, Taken, `UPDATE listen_tasks SET invite_id = NULL, holder = $2, joined_at = now(), heard_at = NULL, heard_generation = NULL, heard_segment = NULL, seen_at = now(), left_at = NULL
    WHERE invite_id = $1 AND ended_at IS NULL AND dispatched_at > now() - make_interval(secs => $3) RETURNING owner_id, call_id, task_id, place`,
    [inviteHash(invite), identity, INVITE_TTL_MS / 1000]);
  if (t) llog.info('listener joined its task', { callId: t.call_id, taskId: t.task_id, place: where(t.place) });
  return t;
}

/**
 * A listener is out of the call, however it went: LiveKit says it left the room, it left or was taken out of the call,
 * or it couldn't come in at all (the host is away, so nobody can let it into the call's group). If it held one of the
 * call's open tasks, another is sent: at once if it had been working (heard, or there a while), or after `backoff` if it
 * left soon after joining without ever being heard, so one that can't work doesn't come and go over and over. True when
 * it held one, so the call takes it out too. Anyone else, or a listener already replaced (a late or repeated webhook),
 * changes nothing.
 */
export async function left(d: Deps, ownerId: string, callId: string, identity: string): Promise<boolean> {
  const r = await maybeOne(d.pool, z.object({ failures: z.number() }), `UPDATE listen_tasks SET left_at = now(),
      failures = CASE WHEN heard_at IS NOT NULL OR joined_at < now() - make_interval(secs => $4) THEN 0 ELSE failures + 1 END
    WHERE owner_id = $1 AND call_id = $2 AND holder = $3 AND left_at IS NULL AND ended_at IS NULL RETURNING failures`,
  [ownerId, callId, identity, FAILED_WITHIN_MS / 1000]);
  if (!r) return false;
  if (r.failures) { llog.info('listener left without being heard; the next waits', { callId, failures: r.failures }); return true; }
  llog.info('listener left its task', { callId });
  kick(d);
  return true;
}

/** The listener holding one of the call's tasks asked the API something: it's still there. Noted once every SEEN_EVERY_MS at most. */
export async function seen(d: Pick<Deps, 'pool'>, ownerId: string, callId: string, identity: string): Promise<void> {
  await exec(d.pool, `UPDATE listen_tasks SET seen_at = now() WHERE owner_id = $1 AND call_id = $2 AND holder = $3 AND left_at IS NULL AND ended_at IS NULL
    AND (seen_at IS NULL OR seen_at < now() - make_interval(secs => $4))`, [ownerId, callId, identity, SEEN_EVERY_MS / 1000]);
}

/** Whether `holder` holds the call's task for `place` now: only then is what it hears there taken. */
export async function holds(o: Owner, db: Db, callId: string, place: string, holder: string): Promise<boolean> {
  return Boolean(await maybeOne(db, z.object({ n: z.number() }),
    'SELECT 1 AS n FROM listen_tasks WHERE owner_id = $1 AND call_id = $2 AND place = $3 AND holder = $4 AND left_at IS NULL AND ended_at IS NULL', [o.ownerId, callId, place, holder]));
}

/**
 * The listener holding the call's task for `place` had what it heard taken, in this MLS generation and notes segment:
 * it's hearing that part of the call, and it's working (`failures` start again). Until it's taken in the generation and
 * segment there are now, a listener may still be getting the call's keys, coming into the room, or catching up.
 */
export async function tookFrom(o: Owner, db: Db, callId: string, place: string, holder: string, at: { generation: number; segment: number }): Promise<void> {
  // Written only when that's news: the first taken in this generation and segment.
  const n = await exec(db, `UPDATE listen_tasks SET heard_at = now(), heard_generation = $5, heard_segment = $6, failures = 0
    WHERE owner_id = $1 AND call_id = $2 AND place = $3 AND holder = $4 AND left_at IS NULL AND ended_at IS NULL
      AND (heard_at IS NULL OR heard_generation IS DISTINCT FROM $5 OR heard_segment IS DISTINCT FROM $6)`, [o.ownerId, callId, place, holder, at.generation, at.segment]);
  if (n) llog.info('listener hearing its task', { callId, place: where(place), ...at });
}

/**
 * Whether a listener is hearing the call's `place` now: what it sent was taken in this MLS generation and notes segment
 * (`at`), it asked the API something within UNSEEN_MS, and it hasn't left. Only then is what a browser sends for that
 * part of the call set aside, so nothing is lost while a listener comes in, catches up with a new host's keys or a new
 * segment, or has gone without anyone saying so.
 */
export async function heard(o: Owner, db: Db, callId: string, place: string, at: { generation: number; segment: number }): Promise<boolean> {
  return Boolean(await maybeOne(db, z.object({ n: z.number() }),
    `SELECT 1 AS n FROM listen_tasks WHERE owner_id = $1 AND call_id = $2 AND place = $3 AND holder IS NOT NULL AND heard_at IS NOT NULL
      AND heard_generation = $4 AND heard_segment = $5 AND seen_at > now() - make_interval(secs => $6) AND left_at IS NULL AND ended_at IS NULL`,
    [o.ownerId, callId, place, at.generation, at.segment, UNSEEN_MS / 1000]));
}

/** Deletes tasks that ended more than a week ago. Returns how many. */
export async function sweep(d: Pick<Deps, 'pool'>): Promise<number> {
  return exec(d.pool, `DELETE FROM listen_tasks WHERE ended_at < now() - make_interval(days => $1)`, [KEEP_ENDED_DAYS]);
}
