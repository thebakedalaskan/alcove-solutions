/*
 * The notes service (docs: notes-and-inference). When a recording stops, its note is queued in
 * content_jobs with the transcript already in it. A worker claims the job with a lease, has the
 * notes model draft the summary, decisions, open questions, follow-ups, chapters and suggested
 * questions, and then writes them into the note, charges the recorded minutes and deletes the job
 * in one transaction. A failed attempt is tried again a little later, up to three times; after the
 * third, the note is finished without a summary, so its transcript and audio are still there. When
 * the notes model's evidence doesn't check out, or can't be checked, nothing was sent: the job waits
 * and checks again, as long as it takes, without using up an attempt. The owner's keys are opened
 * for each job and wiped after it.
 */
import type { ScreenMoment } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../context';
import { openJson, stateKey } from '../crypto';
import { bytea, exec, maybeOne, tx } from '../db';
import { NotFoundError, UnansweredError, UnverifiedError } from '../errors';
import { inference } from '../inference';
import { log } from '../log';
import { openOwner } from '../owners';
import { getItem } from '../vault';
import { me } from './account';
import { segments } from './audio';
import * as billing from './billing';
import { briefOf, draft, type Written } from './drafting';
import { NoteManifest, roomChapters, updateNote } from './notes';
import { personOf } from './portraits';
import * as screens from './screens';

const wlog = log.child({ component: 'writer' });
const ATTEMPTS = 3;
/** Longer than the slowest draft (three minutes) and checking the model first; a worker that dies mid-job frees it after this. */
const LEASE_SECONDS = 300;
/** How long to wait before trying a job again, after its first and second failures. */
const RETRY_SECONDS = [20, 90];
/** How long a job waits before trying the notes model again, when its evidence didn't check out or it didn't answer. */
const VERIFY_AGAIN_SECONDS = 300;

const Claimed = z.object({ owner_id: z.string(), job_id: z.string(), revision_id: z.string(), job_ciphertext: bytea, attempt: z.number(), tried: z.number() });
type Claimed = z.infer<typeof Claimed>;
const Job = z.object({ noteId: z.string(), recordingId: z.string() });

/** The next job that's due, leased to this worker. `tried` is how many attempts came before this one. */
async function claim(d: Deps, ownerId: string | null): Promise<Claimed | undefined> {
  return maybeOne(d.pool, Claimed, `
    WITH due AS (
      SELECT owner_id, job_id, attempt FROM content_jobs
      WHERE kind = 'notes' AND (lease_until IS NULL OR lease_until < now()) AND ($1::text IS NULL OR owner_id = $1)
      ORDER BY lease_until NULLS FIRST LIMIT 1 FOR UPDATE SKIP LOCKED)
    UPDATE content_jobs j SET state = 'writing', lease_until = now() + make_interval(secs => $2), attempt = LEAST(j.attempt + 1, $3)
    FROM due WHERE j.owner_id = due.owner_id AND j.job_id = due.job_id
    RETURNING j.owner_id, j.job_id, j.revision_id, j.job_ciphertext, j.attempt, due.attempt AS tried`, [ownerId, LEASE_SECONDS, ATTEMPTS]);
}

/**
 * Writes the notes into the note (or finishes it without them, with its shared screens read when
 * they were), charges for them and closes the job, together. The charge is for the minutes recorded,
 * not the length of the call: time with notes off is free.
 */
async function settle(o: Owner, jobId: string, noteId: string, recordingId: string, notes: Written | undefined, shown?: ScreenMoment[] | undefined): Promise<void> {
  const recorded = notes ? (await segments(o, recordingId)).reduce((n, s) => n + s.seconds, 0) : 0;
  await tx(o.pool, async (c) => {
    // Breakout rooms join the chapters the notes wrote, in order: the call's note covers the rooms too.
    // The notes model's verification joins the ones the transcript went to.
    await updateNote(o, c, noteId, (m) => {
      const chapters = [...(notes?.chapters ?? m.chapters), ...roomChapters(m.breakouts)].sort((a, b) => a.at - b.at);
      if (!notes) return { ...m, status: 'ready', chapters, breakouts: [], ...(shown ? { screens: shown } : {}) };
      const { evidence, ...written } = notes;
      return { ...m, status: 'ready', ...written, chapters, breakouts: [], inference: [...m.inference, evidence] };
    });
    await exec(c, 'DELETE FROM content_jobs WHERE owner_id = $1 AND job_id = $2', [o.ownerId, jobId]);
    if (notes) {
      const minutes = Math.max(1, Math.ceil(recorded / 60));
      await billing.charge({ cfg: o.cfg }, c, o.ownerId, { amount: minutes * billing.PER_MINUTE, label: `Notes, ${minutes} min` });
    }
  });
}

async function attempt(d: Deps, job: Claimed): Promise<void> {
  const ctx = { jobId: job.job_id, attempt: job.attempt };
  const drop = async (why: string) => {
    await exec(d.pool, 'DELETE FROM content_jobs WHERE owner_id = $1 AND job_id = $2', [job.owner_id, job.job_id]);
    wlog.info('notes job dropped', { ...ctx, why });
  };
  let o: Owner;
  try { o = await openOwner(d, job.owner_id, undefined); } catch (e) { wlog.warn('notes job’s account can’t be opened', { ...ctx, err: e }); await drop('account'); return; }
  try {
    const rev = await maybeOne(o.pool, z.object({ item_id: z.string() }), 'SELECT item_id FROM revisions WHERE owner_id = $1 AND revision_id = $2', [o.ownerId, job.revision_id]);
    if (!rev) { await drop('note deleted'); return; }
    const noteId = rev.item_id;
    const { recordingId } = openJson(stateKey(o.root, o.ownerId, `job:${noteId}`), { v: 1, kind: 'job', ownerId: o.ownerId, noteId }, job.job_ciphertext, Job);
    const note = await getItem(o, o.pool, 'note', noteId, NoteManifest, 'Those notes');
    const lines = note.manifest.transcript?.length ?? 0;
    const at = { ...ctx, noteId, recordingId, lines, seconds: note.manifest.duration };
    if (job.tried >= ATTEMPTS) {
      wlog.error('notes job outlived its last attempt; finishing the note without a summary', at);
      await settle(o, job.job_id, noteId, recordingId, undefined);
      return;
    }
    try {
      const t0 = performance.now();
      // What was on shared screens is read first, frame by frame, so the notes can say what was shown while it was said;
      // a call where nothing was transcribed still keeps what its screens showed.
      const shown = screens.withReadings(note.manifest.screens, note.manifest.screens.length ? await screens.readAll(o, noteId, recordingId) : []);
      if (!lines) {
        await settle(o, job.job_id, noteId, recordingId, undefined, shown);
        wlog.info('nothing was transcribed; note finished without notes', { ...at, screens: shown.length });
        return;
      }
      const organizer = await me(o);
      const notes = await draft(o.cfg, { ...briefOf(note.manifest, organizer, note.manifest.invited.map((e) => personOf(e))), screens: shown });
      await settle(o, job.job_id, noteId, recordingId, notes);
      wlog.info('notes written', {
        ...at, decisions: notes.decisions.length, actions: notes.actions.length, chapters: notes.chapters.length, screens: shown.length,
        screenRefs: [...notes.decisions, ...notes.questions, ...notes.actions, ...notes.chapters].filter((x) => x.screen).length, ms: Math.round(performance.now() - t0)
      });
    } catch (e) {
      if (e instanceof NotFoundError) { await drop('note deleted while its notes were written'); return; }
      if (e instanceof UnverifiedError || e instanceof UnansweredError) {
        // Unverified: nothing was sent (an outage at Intel or NVIDIA, or NEAR AI out of date). Unanswered: NEAR AI
        // timed out, couldn't be reached or was busy. Neither is the note's fault, so neither uses the attempts up.
        wlog.warn(e instanceof UnverifiedError ? 'notes waiting for the notes model to check out' : 'notes waiting for the notes model to answer', { ...at, retryInS: VERIFY_AGAIN_SECONDS, err: e });
        await exec(d.pool, `UPDATE content_jobs SET state = 'waiting', attempt = $3, lease_until = now() + make_interval(secs => $4) WHERE owner_id = $1 AND job_id = $2`,
          [job.owner_id, job.job_id, job.tried, VERIFY_AGAIN_SECONDS]);
        setTimeout(() => kick(d, job.owner_id), VERIFY_AGAIN_SECONDS * 1000 + 250).unref();
        return;
      }
      if (job.attempt >= ATTEMPTS) {
        wlog.error('notes could not be written after three attempts; finishing the note without a summary', { ...at, err: e });
        await settle(o, job.job_id, noteId, recordingId, undefined);
        return;
      }
      const wait = RETRY_SECONDS[job.attempt - 1] ?? 90;
      wlog.warn('notes not written yet; trying again', { ...at, retryInS: wait, err: e });
      await exec(d.pool, `UPDATE content_jobs SET state = 'queued', lease_until = now() + make_interval(secs => $3) WHERE owner_id = $1 AND job_id = $2`, [job.owner_id, job.job_id, wait]);
      setTimeout(() => kick(d, job.owner_id), wait * 1000 + 250).unref();
    }
  } finally {
    o.root.fill(0);
    o.wrapKey.fill(0);
  }
}

/** Writes notes that are due, one at a time: an owner's, or anyone's. Returns how many jobs it took. */
export async function work(d: Deps, o: { ownerId?: string | undefined; limit?: number } = {}): Promise<number> {
  if (!inference(d.cfg).configured) return 0;
  let taken = 0;
  for (; taken < (o.limit ?? 20); taken++) {
    const job = await claim(d, o.ownerId ?? null);
    if (!job) break;
    await attempt(d, job);
  }
  return taken;
}

/** Owners with a worker running, and whether more work was queued for them while it ran. */
const busy = new Map<string, boolean>();
/**
 * Starts writing an owner's queued notes in the background, as soon as a recording stops. Takes
 * only the services from `from`: a request's keys are never kept for later work.
 */
export function kick(from: Deps, ownerId: string): void {
  const d: Deps = { cfg: from.cfg, pool: from.pool, objects: from.objects, livekit: from.livekit };
  if (busy.has(ownerId)) { busy.set(ownerId, true); return; }
  busy.set(ownerId, false);
  void (async () => {
    try {
      do { busy.set(ownerId, false); await work(d, { ownerId }); } while (busy.get(ownerId));
    } catch (e) {
      wlog.error('notes worker failed', { err: e });
    } finally {
      busy.delete(ownerId);
    }
  })();
}
