/*
 * The notes service (docs: notes-and-inference). When a recording stops, its note is queued in
 * content_jobs with the transcript already in it. A worker claims the job with a lease, has the
 * notes model draft the summary, decisions, open questions, follow-ups, chapters and suggested
 * questions, and each breakout room's own notes from that room's transcript (one request a room),
 * each part with the boards open for everyone in it that everyone the note went to can open, whose
 * Actions frames' stickies become follow-ups (features/notes/worked-on.ts), and then writes them into the note, charges the recorded minutes and deletes the job in one
 * transaction. Only then is a call in a series compared with what earlier calls left standing: nothing
 * waits for that, and failing costs only the comparison. A failed attempt is tried again a little
 * later, up to three times; after the third, the note is finished without a summary, so its
 * transcript and any audio are still there. When
 * the notes model's evidence doesn't check out, or can't be checked, nothing was sent: the job waits
 * and checks again, as long as it takes, without using up an attempt. The owner's keys are opened
 * for each job and wiped after it. The organizer can have the notes written again from a corrected
 * transcript (notes.rewrite): the same job, which keeps what people already settled.
 */
import { MAIN_PLACE, type Change, type Decision, type InferenceEvidence, type Person, type RoomNote, type ScreenMoment, type UnencryptedUse } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../../../platform/context';
import { id128, openJson, sealJson, toJson } from '../../../keys/crypto';
import { bytea, exec, maybeOne, tx } from '../../../platform/db';
import { NotFoundError, PlanLimitError, UnansweredError, UnverifiedError } from '../../../platform/errors';
import { inference, lostOnceSent, type ChatModel, type Meter } from '../../../inference/inference';
import { log } from '../../../platform/log';
import { failureCode, runs, tracked } from '../../../platform/runs';
import { openOwner } from '../../../keys/owners';
import { getItem, lockItem, pruneRevisions } from '../../../keys/vault';
import { me, profile } from '../../profile/profile';
import { purgeAudio } from '../../recordings/audio';
import { queueDelete } from '../../../platform/objects';
import { close, meterFor, type Source } from '../../billing/meter/meter';
import * as models from '../../../inference/models';
import { attachments, draft, writeDetails, type NotesStyle, type Written } from './drafting';
import { briefOf, roomBriefOf, type BriefBoard, type Settled } from './brief';
import { revisited } from './revisits';
import { type PickWhy } from '../../recordings/screens/reading';
import { doneInNotes } from '../ticked';
import { NoteManifest, NotesJob, decisionsOf, everyoneWith, jobHeader, jobKey, roomChapters, updateNote, type Revisit } from '../manifest';
import { personOf } from '../../profile/portraits';
import * as screens from '../../recordings/screens/screens';
import { standing } from '../series/series';
import { verificationKey } from '../../recordings/transcripts';
import { mergeActionProposals } from './follow-up-proposals';
import { boardsToRead, type BoardRead } from '../worked-on';
import { noteFinal } from '../drive-exports/worker';

const wlog = log.child({ component: 'writer' });
/**
 * The writer's runs, as operators see them (platform/runs.ts): one each time it works, with the jobs it took, and each job's
 * failure by its code.
 */
const WRITER = 'notes-writer';
/**
 * What the writer says as it finishes a note without a summary, for good: its last attempt failed, or a job outlived it (its
 * worker stopped part way). Both lines carry `final: FINAL` and the note's and the job's IDs, and the operators' ring keeps
 * such lines apart, for the work report's finals (platform/recent.ts, features/operator/work.ts).
 */
const WITHOUT_SUMMARY = {
  failed: 'notes could not be written after three attempts; finishing the note without a summary',
  outlived: 'notes job outlived its last attempt; finishing the note without a summary'
} as const;
/** The kind of work given up for good that those lines say they are. */
const FINAL = 'notes-without-summary';
const ATTEMPTS = 3;
/** A worker that dies mid-job frees it after this. A running job renews it all through (HEARTBEAT_MS), however long its notes take (up to 860 s for each part's notes, thinking first). */
const LEASE_SECONDS = 300;
/** How often a running job renews its lease, whatever step it's on (joining video, taking frames, waiting on a model). */
const HEARTBEAT_MS = (LEASE_SECONDS / 3) * 1000;
/** How long to wait before trying a job again, after its first and second failures. */
const RETRY_SECONDS = [20, 90];
/** How long a job waits before trying the notes model again, when its evidence didn't check out or it didn't answer. */
const VERIFY_AGAIN_SECONDS = 300;

const Claimed = z.object({ owner_id: z.string(), job_id: z.string(), revision_id: z.string(), job_ciphertext: bytea, attempt: z.number(), tried: z.number(), waited: z.boolean() });
type Claimed = z.infer<typeof Claimed>;
/** The organizer stopped the notes being written again (notes.cancelRewrite): the job isn't there any more. */
class Cancelled extends Error {}
/** Each verification once: a model checked again with a new key is a verification of its own, and the note keeps it. */
const onceEach = (xs: InferenceEvidence[]) => xs.filter((e, i) => xs.findIndex((x) => x.task === e.task && verificationKey(x) === verificationKey(e)) === i);

/**
 * The writer's rule for a notes job it can take now (claim), as SQL on `t`, the statement's alias for content_jobs: no lease,
 * or one that has run out, by the statement's own clock, whatever its state (a worker that stopped part way leaves its job
 * `writing`). Whatever says whether the writer can take a job says it with this (the operators' views), so it says what the
 * writer does.
 */
export function claimableNotes(t: string): string {
  return `(${t}.lease_until IS NULL OR ${t}.lease_until < now())`;
}

/**
 * The next job that's due, leased to this worker. `tried` is how many attempts came before this one, and `waited` whether
 * the last one waited for the notes model (VERIFY_AGAIN_SECONDS).
 */
async function claim(d: Deps, ownerId: string | null): Promise<Claimed | undefined> {
  return maybeOne(d.pool, Claimed, `
    WITH due AS (
      SELECT q.owner_id, q.job_id, q.attempt, q.state FROM content_jobs q
      WHERE q.kind = 'notes' AND ${claimableNotes('q')} AND ($1::text IS NULL OR q.owner_id = $1)
      ORDER BY q.lease_until NULLS FIRST LIMIT 1 FOR UPDATE SKIP LOCKED)
    UPDATE content_jobs j SET state = 'writing', lease_until = now() + make_interval(secs => $2), attempt = LEAST(j.attempt + 1, $3)
    FROM due WHERE j.owner_id = due.owner_id AND j.job_id = due.job_id
    RETURNING j.owner_id, j.job_id, j.revision_id, j.job_ciphertext, j.attempt, due.attempt AS tried, due.state = 'waiting' AS waited`, [ownerId, LEASE_SECONDS, ATTEMPTS]);
}

type Item = { text: string; at?: number | undefined; changes: Change[] };
/** A breakout room's notes as written, by the room's ID, or that they couldn't be: the call's are written all the same. */
type RoomWritten = { id: string; notes: Written } | { id: string; failed: true };
/** Breakout rooms' notes as written, and the verifications the requests went to. */
interface RoomsWritten { rooms: RoomWritten[]; written: number; evidence: InferenceEvidence[] }
/**
 * What a job wrote: the call's notes (none when nothing was said in the main room), each breakout room's, when the
 * transcript was read, and the verifications the shared screens' requests went to (picking moments, reading frames) and
 * the full summary's did.
 */
interface Wrote { notes?: Written | undefined; rooms: RoomsWritten; readAt: string; screens?: InferenceEvidence[] | undefined; details?: InferenceEvidence | null | undefined }

/**
 * The same item in other words. People reword what they confirm, and the notes model words things afresh each time, so
 * two entries are alike when they point at moments within a minute of each other and most of the shorter one's words
 * are in the other. With no moment to go on, that isn't enough: a short proposal shares its words with too much. Then
 * they must say nearly the same thing, in both directions, in at least three words that say something. Dropping a fresh
 * entry for looking like a kept one loses what the call said, so when in doubt both stay.
 */
const ALIKE = { share: 0.6, seconds: 60, words: 2, unplaced: { share: 0.85, words: 3 } };
const SMALL = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'do', 'for', 'from', 'has', 'have', 'i', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'our', 'should', 'so', 'that', 'the', 'their', 'them', 'they', 'this', 'to', 'us', 'was', 'we', 'were', 'will', 'with', 'you', 'your']);
const wordsOf = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(' ').filter((w) => w && !SMALL.has(w));
function alike(a: Item, b: Item): boolean {
  const placed = a.at !== undefined && b.at !== undefined;
  if (placed && Math.abs((a.at ?? 0) - (b.at ?? 0)) > ALIKE.seconds) return false;
  const [x, y] = [wordsOf(a.text), wordsOf(b.text)];
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length < (placed ? ALIKE.words : ALIKE.unplaced.words)) return false;
  const left = new Map<string, number>();
  for (const w of long) left.set(w, (left.get(w) ?? 0) + 1);
  let shared = 0;
  for (const w of short) { const n = left.get(w) ?? 0; if (n) { shared++; left.set(w, n - 1); } }
  return placed ? shared >= ALIKE.share * short.length : shared >= ALIKE.unplaced.share * long.length;
}
/**
 * What the notes say when they're written again: whatever someone has already confirmed, answered, taken on or changed
 * stays as it is, and the new items take the place of the ones nobody touched. The notes model was told what's settled
 * (brief.settledOf), and a new item that's still a kept one in other words is dropped; so is anything settled while
 * the notes were being written, which the model never saw.
 */
function keepTouched<T extends Item>(was: T[], fresh: T[]): T[] {
  const kept = was.filter((x) => x.changes.length > 0);
  return [...kept, ...fresh.filter((x) => !kept.some((k) => alike(k, x)))].sort((a, b) => (a.at ?? Number.POSITIVE_INFINITY) - (b.at ?? Number.POSITIVE_INFINITY));
}
/** A part of the notes written again: its decisions, questions and follow-ups, each list kept as people settled it. Any part that has them is merged the same way. */
const keepSettled = (was: Settled, fresh: Settled): Settled =>
  ({ decisions: keepTouched(was.decisions, fresh.decisions), questions: keepTouched(was.questions, fresh.questions), actions: mergeActionProposals(was.actions, fresh.actions) });

/** The boards a part of the call's notes read: the ones open for everyone in it (`main`, or a breakout room's ID). */
const boardsIn = (read: readonly BoardRead[]) => (place: string): BriefBoard[] =>
  read.filter((x) => x.place === place).map((x) => ({ name: x.name, text: x.text, followUps: x.followUps.map((f) => ({ id: `${x.key}:${f.id}`, text: f.text })) }));

/**
 * Each breakout room's notes, written from what was said in that room alone, and the boards open in it, in the same verified path as the call's:
 * one request a room. An answer that can't be used is asked for again, as many times as the job would try the call's,
 * and only then does the room go without. A room where nothing was said while notes were on keeps its section with no
 * notes, and nothing is sent for it.
 */
async function writeRooms(o: Owner, meter: Meter, m: NoteManifest, organizer: Person, style: NotesStyle, boards: (place: string) => BriefBoard[], via: ChatModel, renew: () => Promise<void>, ctx: Record<string, string | number>): Promise<RoomsWritten> {
  const said = m.rooms.flatMap((r, i) => (r.transcript.length ? [{ r, i }] : []));
  const rooms = await inTurns(said, ROOMS_AT_ONCE, async ({ r, i }): Promise<RoomWritten> => {
    for (let tried = 1; ; tried++) {
      // Each request is a fresh lease on the job, so another worker doesn't take it while rooms are written.
      await renew();
      try {
        return { id: r.id, notes: await draft(o.cfg, meter, { ...roomBriefOf(m, r, organizer), ticks: m.ticked.filter((t) => t.room === r.id), boards: boards(r.id), via }, tried > 1 ? { ...style, brief: true } : style) };
      } catch (e) {
        // Waiting for the notes model, or a note deleted meanwhile, is the whole job's; anything else is this room's alone.
        if (e instanceof UnverifiedError || e instanceof UnansweredError || e instanceof NotFoundError || e instanceof PlanLimitError) throw e;
        if (tried < ATTEMPTS) { wlog.info('a breakout room’s notes came back unusable; asking again', { ...ctx, room: i, tried, err: e }); continue; }
        wlog.warn('a breakout room’s notes could not be written; the rest are written without them', { ...ctx, room: i, tried, err: e });
        return { id: r.id, failed: true };
      }
    }
  });
  return { rooms, written: rooms.filter((x) => 'notes' in x).length, evidence: rooms.flatMap((x) => ('notes' in x && x.notes.evidence ? [x.notes.evidence] : [])) };
}

/** How many breakout rooms' notes are written at once: each is a request of up to four minutes, or about ten thinking first. */
const ROOMS_AT_ONCE = 3;
/** `fn` over `xs`, at most `cap` at a time, in their order. The first failure stops what hasn't started, and is thrown. */
async function inTurns<T, R>(xs: readonly T[], cap: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Map<number, R>();
  const failures: unknown[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (!failures.length && next < xs.length) {
      const i = next++;
      const x = xs[i];
      if (x === undefined) continue;
      try { out.set(i, await fn(x)); } catch (e) { failures.push(e); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(cap, xs.length) }, () => worker()));
  if (failures.length) throw failures[0];
  return [...out.entries()].sort(([a], [b]) => a - b).map(([, r]) => r);
}

/**
 * The note as saved, with any of its screens before (`was`) that something it still lists points at: an item people
 * settled, kept from notes written before, keeps the moment it was about.
 */
function keepPointedAt(was: NoteManifest, next: NoteManifest): NoteManifest {
  const has = new Set(next.screens.map((m) => m.id));
  const items = [next, ...next.rooms].flatMap((x) => [...x.decisions, ...x.questions, ...x.actions, ...x.chapters]);
  const pointed = new Set(items.flatMap((x) => (x.screen ? [x.screen.id] : [])));
  const back = was.screens.filter((m) => pointed.has(m.id) && !has.has(m.id));
  return back.length ? { ...next, screens: [...next.screens, ...back].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)) } : next;
}

/**
 * Writes the notes into the note, each breakout room's too (or finishes it without them, with its shared screens read
 * when they were), and closes the job, together. What writing them cost was charged to the organizer's AI allowance as
 * each request was answered (features/billing/meter/meter.ts), and what the call held for them is let go once they're saved.
 * Whenever they're written, what people already added, confirmed or changed stays, in the call's notes and each room's,
 * even if the first try never wrote anything; when notes written again (the organizer asked, after correcting the
 * transcript) can't be written, they stay as they were. `writtenAt` says when the notes read the transcript, so a correction made since is offered for
 * writing them again. Follow-ups ticked during the call are done in whichever part of the notes is written, and wait for
 * the ones that aren't.
 *
 * A call set not to keep its transcript loses it here, once notes are written from it, and not before. Each part of
 * the call goes with its own notes, the main room's and each breakout room's: the new revision has none of those, and
 * every earlier revision goes, in the transaction that closes the job found through them, with any receipt that might
 * copy one. Notes that can't be written leave their part's transcript in the new revision alone, so the organizer can
 * have them written, and it goes when they are. A call set not to keep its recording lost its audio when it ended;
 * anything that got in since goes here too.
 *
 * Notes written again that can't be written stay as they were, with the AI model they had (`was`, when the job knows
 * it), as when the organizer stops them: the note's model is always the one that wrote what it shows, or is writing it.
 *
 * Frames the shared screens' analysis took (`left`) are deleted in the same transaction unless the saved note shows
 * them (the ones the notes attached, or that something it still lists points at); their objects once it commits. The
 * rest only went into what the notes say.
 */
async function settle(o: Owner, jobId: string, noteId: string, was: NotesJob['was'], wrote: Wrote | undefined, shown?: ScreenMoment[] | undefined, left: string[] = []): Promise<boolean> {
  const any = Boolean(wrote?.notes) || Boolean(wrote?.rooms.written);
  let call = false;
  let source: Source | null = null;
  const leftover = await tx(o.pool, async (c) => {
    // Holding the note, as stopping the job does: a job that's gone saves nothing.
    await lockItem(o, c, noteId);
    if (!(await exec(c, 'SELECT 1 FROM content_jobs WHERE owner_id = $1 AND job_id = $2 FOR UPDATE', [o.ownerId, jobId]))) return null;
    // Breakout rooms join the chapters the notes wrote, in order: the call's note covers the rooms too.
    // The notes model's verifications join the ones the transcript went to.
    const write = (m: NoteManifest): NoteManifest => {
      const rooms = roomChapters(m.breakouts);
      const chapters = [...(wrote?.notes?.chapters ?? m.chapters), ...rooms]
        .filter((x, i, all) => all.findIndex((y) => y.at === x.at && y.title === x.title && y.summary === x.summary) === i)
        .sort((a, b) => a.at - b.at);
      if (!wrote) return { ...m, status: 'ready', chapters, ...(was ? { model: was.model } : {}), ...(shown ? { screens: shown } : {}) };
      // Each room's section as it is now (a line corrected while the notes were written stays corrected), with its
      // notes as just written: what people settled in it stays, as in the call's. A room whose notes couldn't be
      // written keeps what it had: none the first time, which the note says, and its transcript, to write them from.
      // One that has its notes loses its transcript here, if the call was set to, as the call's does.
      const sections = m.rooms.map((r): RoomNote => {
        const w = wrote.rooms.rooms.find((x) => x.id === r.id);
        if (!w || !('notes' in w)) return r;
        const items = keepSettled(r, w.notes);
        return { ...r, summary: w.notes.summary, chapters: w.notes.chapters, ...items, actions: doneInNotes(items.actions, m.ticked.filter((t) => t.room === r.id), w.notes.ticks, r.transcript), transcript: m.keep.transcript ? r.transcript : [] };
      });
      const roomsWritten = new Set(wrote.rooms.rooms.flatMap((x) => ('notes' in x ? [x.id] : [])));
      // What's ticked in a room whose notes weren't written waits for them; the call's, for the call's.
      const waiting = m.ticked.filter((t) => (t.room === null ? !wrote.notes : !roomsWritten.has(t.room)));
      // What these notes were written with joins what the transcript was: what earlier notes were written with goes,
      // unless something they wrote stays (below).
      const evidence = [...(wrote.notes?.evidence ? [wrote.notes.evidence] : []), ...(wrote.details ? [wrote.details] : []), ...wrote.rooms.evidence, ...(wrote.screens ?? []).map((e) => ({ ...e, task: 'screens' as const }))];
      const inference = onceEach([...m.inference.filter((e) => e.task === 'transcript'), ...evidence]);
      if (!wrote.notes) {
        return { ...m, status: 'ready', chapters, rooms: sections, inference, ticked: waiting, ...(any ? { writtenAt: wrote.readAt } : {}), ...(shown ? { screens: shown } : {}) };
      }
      const { evidence: _, ticks, ...written } = wrote.notes;
      const items = { ...written, ...keepSettled(m, written) };
      const actions = doneInNotes(items.actions, m.ticked.filter((t) => t.room === null), ticks, m.transcript ?? []);
      return { ...m, status: 'ready', ...items, actions, chapters, rooms: sections, writtenAt: wrote.readAt, transcript: m.keep.transcript ? m.transcript : [], inference, ticked: waiting };
    };
    // What stays from notes written before keeps the verifications it was written with: a breakout room whose notes
    // couldn't be written this time, a screen something settled points at, and what earlier calls came back to.
    const saved = (m: NoteManifest): NoteManifest => {
      const w = write(m);
      const next = keepPointedAt(m, w);
      const roomKept = wrote?.rooms.rooms.some((x) => 'failed' in x && Boolean(m.rooms.find((r) => r.id === x.id)?.summary)) ?? false;
      const stays = Boolean(wrote) && (next !== w || roomKept || m.revisits.length > 0);
      return stays ? { ...next, inference: onceEach([...next.inference, ...m.inference.filter((e) => e.task !== 'transcript')]) } : next;
    };
    const next = await updateNote(o, c, noteId, saved);
    call = next.kind === 'call';
    source = sourceOf(next);
    await exec(c, 'DELETE FROM content_jobs WHERE owner_id = $1 AND job_id = $2', [o.ownerId, jobId]);
    if (any && !next.keep.transcript) {
      const revisions = await pruneRevisions(o, c, noteId);
      await exec(c, 'DELETE FROM operations WHERE owner_id = $1', [o.ownerId]);
      wlog.info('transcript deleted, as the call was set to', { noteId, revisions });
    }
    // Shared screens' video is kept only until the notes are written, since the frames are taken from it.
    const unkept = next.keep.recording ? [] : [...await screens.purgeVideo(o, c, next.recordingId), ...await purgeAudio(o, c, next.recordingId)];
    return [...unkept, ...await screens.dropUnused(o, c, noteId, left, new Set(next.screens.map((m) => m.id)))];
  });
  if (!leftover) return false;
  // Written: what the call or recording held of the organizer's allowance for its notes goes.
  if (source) await close(o, o.ownerId, source);
  // Final now: whoever has these notes and exports calls to Google Drive sends them at once, not at the next upkeep.
  if (call) noteFinal(o, o.ownerId, noteId);
  await queueDelete(o, leftover);
  return true;
}

/** What a note's charges belong to, for the AI allowance: its call's recording, or its room recording. */
const sourceOf = (m: Pick<NoteManifest, 'kind' | 'recordingId'>): Source => ({ kind: m.kind === 'call' ? 'call' : 'recording', id: m.recordingId });

/** An unencrypted model's work on a note, which no evidence records: nothing for a private one. */
const usesOf = (via: ChatModel, tasks: UnencryptedUse['task'][]): UnencryptedUse[] => (via.private ? [] : tasks.map((task) => ({ model: via.model, task, at: new Date().toISOString() })));
/** What unencrypted models did, each model and task once, the first time. */
const withUses = (was: UnencryptedUse[], more: UnencryptedUse[]): UnencryptedUse[] =>
  more.reduce((all, u) => (all.some((x) => x.model === u.model && x.task === u.task) ? all : [...all, u]), was);

/**
 * A note's revisits, compared again: what the notes model found now takes the place of what it found before, unless
 * its own decision isn't in the notes any more. What someone said it got wrong stays said, and follows what was found
 * again (written again, the later decision can be a new one), so it can still be seen and undone.
 */
function revisitsAfter(was: Revisit[], fresh: Revisit[], decisions: Decision[]): Revisit[] {
  const wrong = was.filter((r) => r.dismissed);
  const same = (a: Revisit, b: Revisit) => a.noteId === b.noteId && a.itemId === b.itemId;
  return [
    ...wrong.map((w) => { const again = fresh.find((r) => same(r, w)); return again ? { ...again, id: w.id, dismissed: w.dismissed } : w; }),
    ...fresh.filter((r) => !wrong.some((w) => same(r, w)) && (!r.by || decisions.some((d) => d.id === r.by)))
  ];
}

/**
 * What this call came back to from earlier calls in its series, once its notes are written and everyone has them: one
 * request, for a call with anything to compare, and nothing waits for it. Failing, or the worker going down, costs only
 * the comparison: the note keeps the revisits it had, and writing the notes again tries again. Revisits are kept, so the
 * model that found them joins the note's verifications, as the notes' does. What was said is as the notes read it,
 * `read`: a call set not to keep its transcript has just lost it, and it goes no further than this request.
 */
async function compareWithEarlier(o: Owner, meter: Meter, noteId: string, read: NoteManifest, organizer: Person, via: ChatModel, ctx: Record<string, string | number>): Promise<void> {
  try {
    const { manifest: written } = await getItem(o, o.pool, 'note', noteId, NoteManifest, 'Those notes');
    const m: NoteManifest = { ...written, transcript: read.transcript, rooms: written.rooms.map((r) => ({ ...r, transcript: read.rooms.find((x) => x.id === r.id)?.transcript ?? r.transcript })) };
    const earlier = await standing(o, noteId, m);
    const decisions = decisionsOf(m).filter((d) => d.state !== 'rejected');
    const said = Boolean(m.transcript?.length) || m.rooms.some((r) => r.transcript.length > 0);
    // A question can be answered by what was said; a decision only replaced by one of this call's.
    const canFind = said && (earlier.some((x) => x.kind === 'question') || (decisions.length > 0 && earlier.length > 0));
    if (!canFind) {
      wlog.debug('nothing to compare a call with', { ...ctx, earlier: earlier.length });
      if (m.revisits.length) await tx(o.pool, (c) => updateNote(o, c, noteId, (n) => ({ ...n, revisits: revisitsAfter(n.revisits, [], decisionsOf(n)) })));
      return;
    }
    const t0 = performance.now();
    const { found, evidence } = await revisited(o.cfg, meter, { ...briefOf(m, organizer, m.invited.map((e) => personOf(e))), via }, decisions, earlier);
    const fresh = found.map((r): Revisit => ({ ...r, id: id128(), dismissed: null }));
    await tx(o.pool, (c) => updateNote(o, c, noteId, (n) => (!fresh.length && !n.revisits.length ? n : {
      ...n, revisits: revisitsAfter(n.revisits, fresh, decisionsOf(n)),
      inference: !fresh.length || !evidence ? n.inference : onceEach([...n.inference, evidence])
    })));
    wlog.info('call compared with earlier ones in its series', { ...ctx, earlier: earlier.length, replaced: found.filter((r) => r.kind === 'replaced').length, answered: found.filter((r) => r.kind === 'answered').length, ms: Math.round(performance.now() - t0) });
  } catch (e) {
    wlog.warn('call not compared with earlier ones; its notes stand without it', { ...ctx, err: e });
  }
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
    const stored = openJson(jobKey(o, noteId), jobHeader(o, noteId), job.job_ciphertext, NotesJob);
    const { recordingId, was } = stored;
    // Read holding the note, with when: corrections are stamped holding it too, so one made after this is later than
    // `readAt`, and the app offers writing the notes again with it.
    const { note, readAt } = await tx(o.pool, async (c) => {
      await lockItem(o, c, noteId);
      return { note: await getItem(o, c, 'note', noteId, NoteManifest, 'Those notes'), readAt: new Date().toISOString() };
    });
    const lines = note.manifest.transcript?.length ?? 0;
    const at = { ...ctx, noteId, recordingId, lines, seconds: note.manifest.duration };
    // The organizer pays, or whoever recorded the room. Writing the notes the first time is never refused: it's what was
    // transcribed before notes stopped, and the one way past their allowance. Writing them again is as anything else is.
    const meter = meterFor(o, { payer: o.ownerId, spend: 'notes', whose: 'yours', source: sourceOf(note.manifest), final: was === null });
    // A presenter's last piece can still come in for a little while after the call (screens.SHARE_TAIL_MS): the job
    // waits for it, without using an attempt.
    const tail = await screens.tailEndsAt(o, recordingId, note.manifest.duration);
    if (tail !== null && tail > Date.now()) {
      const waitMs = tail - Date.now();
      wlog.info('notes waiting for the last of a shared screen', { ...at, retryInMs: waitMs });
      await exec(d.pool, `UPDATE content_jobs SET state = 'queued', attempt = $3, lease_until = now() + make_interval(secs => $4) WHERE owner_id = $1 AND job_id = $2`,
        [job.owner_id, job.job_id, job.tried, waitMs / 1000]);
      setTimeout(() => kick(d, job.owner_id), waitMs + 250).unref();
      return;
    }
    // What the shared screens' analysis came to, once it has: finishing without notes then keeps it.
    let analysed: { shown: ScreenMoment[]; grids: Map<string, Uint8Array>; why: Map<string, PickWhy>; left: string[] } | null = null;
    // Finishing without notes still keeps what was read on each shared screen so far (kept in its frame's row): the
    // key screens, shown as the notes would show them.
    const readSoFar = async () => (analysed
      ? attachments(analysed.shown, note.manifest.transcript ?? [], { grids: analysed.grids, why: analysed.why })
      : screens.withReadings(note.manifest.screens, note.manifest.screens.length ? await screens.framesOf(o, o.pool, noteId) : []));
    // Only while it's being written: a renewal that lands after the job was put back to wait doesn't hold it longer. A
    // job that's gone was stopped, and goes no further.
    const renew = async () => {
      const held = await exec(d.pool, `UPDATE content_jobs SET lease_until = now() + make_interval(secs => $3) WHERE owner_id = $1 AND job_id = $2 AND state = 'writing'`, [job.owner_id, job.job_id, LEASE_SECONDS]);
      if (!held && !(await exec(d.pool, 'SELECT 1 FROM content_jobs WHERE owner_id = $1 AND job_id = $2', [job.owner_id, job.job_id]))) throw new Cancelled();
    };
    // Stopped: nothing is saved, and the frames it took go, unless the notes are being written again already (that job
    // drops what it doesn't use).
    const stopped = async (step: string) => {
      const left = await tx(o.pool, async (c) => {
        await lockItem(o, c, noteId);
        const again = await exec(c, `SELECT 1 FROM content_jobs WHERE owner_id = $1 AND kind = 'notes' AND revision_id IN (SELECT revision_id FROM revisions WHERE owner_id = $1 AND item_id = $2)`, [o.ownerId, noteId]);
        if (again) return [];
        const { manifest } = await getItem(o, c, 'note', noteId, NoteManifest, 'Those notes');
        return screens.dropUnshown(o, c, noteId, new Set(manifest.screens.map((m) => m.id)));
      });
      await queueDelete(o, left);
      wlog.info('notes job cancelled; what was written is dropped', { ...at, step, frames: left.length });
    };
    // The lease is renewed all through the attempt, not only between requests: joining video and taking frames take a
    // while too. A renewal that fails is logged; the next one tries again.
    const heartbeat = setInterval(() => { renew().catch((e: unknown) => { if (!(e instanceof Cancelled)) wlog.warn('notes job lease not renewed', { ...at, err: e }); }); }, HEARTBEAT_MS);
    heartbeat.unref();
    try {
      const t0 = performance.now();
      // Kept shares' video, joined into what replay seeks in (safe to run again on a retried job).
      // First, before anything that can hold or end the job (the attempts, the notes model): replay doesn't wait for notes.
      // On the last pass, a join that fails (the object store down) doesn't stop the note being finished.
      try {
        await screens.finishVideo(o, recordingId);
      } catch (e) {
        if (job.tried < ATTEMPTS) throw e;
        wlog.warn('shared screens not joined into video before finishing the note', { ...at, err: e });
      }
      if (job.tried >= ATTEMPTS) {
        wlog.error(WITHOUT_SUMMARY.outlived, { ...at, final: FINAL });
        if (!(await settle(o, job.job_id, noteId, was, undefined, await readSoFar()))) await stopped('finishing');
        return;
      }
      const shares = await screens.shareIntervals(o, recordingId, note.manifest.segmentSeconds);
      // What was on shared screens comes first, so the notes can say what was shown while it was said. With shares
      // kept on video: frames picked from what was said, read with the model chosen and judged (screens.analyze), each
      // step kept in the job as it's done. With nothing said there's nothing to tie a screen to, so none are read.
      // Notes written before video was kept read the frames the presenter's browser sent.
      let shown: ScreenMoment[] = [];
      let grids = new Map<string, Uint8Array>();
      let why = new Map<string, PickWhy>();
      let left: string[] = [];
      let screenEvidence: InferenceEvidence[] = [];
      // The model the organizer chose for this call (the default unless they did), for everything below.
      const via = await models.resolveModel(o.cfg, note.manifest.model);
      // An unencrypted model is said to have had the call before anything goes to it: stopped, failed or written, what
      // it was sent stays sent, and the note says so.
      const uses = usesOf(via, [...(shares.length && lines ? ['screens' as const] : []), ...(lines || note.manifest.rooms.some((r) => r.transcript.length) ? ['notes' as const] : [])]);
      if (uses.length) {
        await tx(o.pool, (c) => updateNote(o, c, noteId, (n) => { const all = withUses(n.unencrypted, uses); return all === n.unencrypted ? n : { ...n, unencrypted: all }; }));
      }
      if (shares.length && lines) {
        const save = async (progress: screens.ScreenProgress) => {
          const next: NotesJob = { ...stored, screens: progress };
          await exec(d.pool, 'UPDATE content_jobs SET job_ciphertext = $3 WHERE owner_id = $1 AND job_id = $2', [job.owner_id, job.job_id, sealJson(jobKey(o, noteId), jobHeader(o, noteId), toJson(next))]);
        };
        const done = await screens.analyze(o, noteId, recordingId, {
          lines: note.manifest.transcript ?? [], shares, via, meter, progress: stored.screens ?? { picks: null, skip: [], evidence: [] }, save, renew
        });
        analysed = { shown: done.shown, grids: done.grids, why: done.why, left: done.left };
        ({ shown, grids, why, left } = done);
        screenEvidence = done.evidence;
      }
      if (note.manifest.screens.length) {
        const frames = await screens.readAll(o, meter, noteId, recordingId);
        // A call may span the deployment: retain its earlier frames beside the new video's analysis. Frames already
        // present in that analysis keep its current judgement; nothing judged the stored-only captures before.
        const current = new Set(shown.map((m) => m.id));
        const stored = new Set(frames.filter((f) => f.pick === null).map((f) => f.id));
        const earlier = screens.withReadings(note.manifest.screens, frames).filter((m) => stored.has(m.id) && !current.has(m.id));
        shown = [...shown, ...earlier.map((m) => ({ ...m, relevance: 'key' as const }))].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
        left = [...new Set([...left, ...frames.map((f) => f.id)])];
        if (analysed) analysed = { ...analysed, shown, left };
      }
      // The job's owner is the organizer of a call, or the person who recorded a room: their choices decide, for the
      // call's notes and each breakout room's.
      const organizer = await me(o);
      const { notesLanguage: language } = (await profile(o)).preferences;
      // After an attempt that didn't work, which may have been cut off, ask for less rather than the same again. After one
      // that waited for the notes model, which may have been thinking for ten minutes first, ask without thinking: only
      // the first attempt thinks (drafting.ts › draft).
      const style: NotesStyle = { language, brief: job.tried > 0, quick: job.waited };
      // The boards open for everyone in the call, as they are now, for the notes of the part each was open in: only those
      // everyone the note went to can open, because one summary goes to them all, the people it was shared with since included.
      const boards = boardsIn(await boardsToRead(o, note.manifest.workedOn, everyoneWith(note.manifest, organizer.email), at));
      // Each breakout room's notes, from what was said there alone.
      const rooms = await writeRooms(o, meter, note.manifest, organizer, style, boards, via, renew, at);
      if (!lines) {
        if (!(await settle(o, job.job_id, noteId, was, { rooms, readAt, screens: screenEvidence }, shown, analysed?.left))) { await stopped('saving'); return; }
        wlog.info(rooms.written ? 'only breakout rooms were transcribed; their notes written' : 'nothing was transcribed; note finished without notes',
          { ...at, screens: shown.length, rooms: note.manifest.rooms.length, roomsWritten: rooms.written });
        await compareWithEarlier(o, meter, noteId, note.manifest, organizer, via, at);
        return;
      }
      await renew();
      const brief = { ...briefOf(note.manifest, organizer, note.manifest.invited.map((e) => personOf(e))), screens: shown, grids, why, ticks: note.manifest.ticked.filter((t) => t.room === null), boards: boards(MAIN_PLACE), via };
      const notes = await draft(o.cfg, meter, brief, style);
      // The full summary, from the notes just written: without it, the notes stand as they are.
      await renew();
      const t1 = performance.now();
      let details: InferenceEvidence | null = null;
      try {
        // Each breakout room by what its notes just said.
        const sections = note.manifest.rooms.map((r) => { const w = rooms.rooms.find((x) => x.id === r.id); return w && 'notes' in w ? { ...r, summary: w.notes.summary } : r; });
        ({ details: notes.details, evidence: details } = await writeDetails(o.cfg, meter, { ...brief, rooms: sections }, notes, style));
        wlog.info('full summary written', { ...at, chars: notes.details.length, model: via.model, encrypted: via.private, ms: Math.round(performance.now() - t1) });
      } catch (e) {
        wlog.warn('full summary not written; the notes stand without it', { ...at, model: via.model, err: e });
      }
      if (!(await settle(o, job.job_id, noteId, was, { notes, rooms, readAt, screens: screenEvidence, details }, undefined, left))) { await stopped('saving'); return; }
      wlog.info('notes written', {
        ...at, language: style.language, decisions: notes.decisions.length, actions: notes.actions.length, chapters: notes.chapters.length, screens: shown.length, attached: notes.screens.length,
        screenRefs: [...notes.decisions, ...notes.questions, ...notes.actions, ...notes.chapters].filter((x) => x.screen).length,
        rooms: note.manifest.rooms.length, roomsWritten: rooms.written, model: via.model, encrypted: via.private, ms: Math.round(performance.now() - t0)
      });
      await compareWithEarlier(o, meter, noteId, note.manifest, organizer, via, at);
    } catch (e) {
      if (e instanceof Cancelled) { await stopped('writing'); return; }
      if (e instanceof NotFoundError) { await drop('note deleted while its notes were written'); return; }
      // The writer's own failures, by code, for operators (platform/runs.ts): waiting on the model, or an attempt used up.
      if (!(e instanceof PlanLimitError)) runs.failed(WRITER, failureCode(e));
      if (e instanceof UnverifiedError || (e instanceof UnansweredError && !lostOnceSent(e))) {
        // Unverified: nothing was sent (an outage at Intel or NVIDIA, or NEAR AI out of date). Unanswered: NEAR AI couldn't
        // be reached or was busy, and nothing was charged. Neither is the note's fault, so neither uses the attempts up. A
        // request that timed out once it was sent was charged what it held, so it does (below): notes that keep timing out
        // are finished without a summary after ATTEMPTS, or written again stay as they were, never charged without end.
        wlog.warn(e instanceof UnverifiedError ? 'notes waiting for the notes model to check out' : 'notes waiting for the notes model to answer', { ...at, retryInS: VERIFY_AGAIN_SECONDS, err: e });
        await exec(d.pool, `UPDATE content_jobs SET state = 'waiting', attempt = $3, lease_until = now() + make_interval(secs => $4) WHERE owner_id = $1 AND job_id = $2`,
          [job.owner_id, job.job_id, job.tried, VERIFY_AGAIN_SECONDS]);
        setTimeout(() => kick(d, job.owner_id), VERIFY_AGAIN_SECONDS * 1000 + 250).unref();
        return;
      }
      if (e instanceof PlanLimitError) {
        // Written again once the organizer's notes ran out: they stay as they were, and trying again won't change that.
        wlog.info('notes not written again: the organizer’s notes have run out', at);
        if (!(await settle(o, job.job_id, noteId, was, undefined, await readSoFar(), analysed?.left))) await stopped('finishing');
        return;
      }
      if (job.attempt >= ATTEMPTS) {
        wlog.error(WITHOUT_SUMMARY.failed, { ...at, final: FINAL, err: e });
        if (!(await settle(o, job.job_id, noteId, was, undefined, await readSoFar(), analysed?.left))) await stopped('finishing');
        return;
      }
      const wait = RETRY_SECONDS[job.attempt - 1] ?? 90;
      wlog.warn('notes not written yet; trying again', { ...at, retryInS: wait, err: e });
      await exec(d.pool, `UPDATE content_jobs SET state = 'queued', lease_until = now() + make_interval(secs => $3) WHERE owner_id = $1 AND job_id = $2`, [job.owner_id, job.job_id, wait]);
      setTimeout(() => kick(d, job.owner_id), wait * 1000 + 250).unref();
    } finally {
      clearInterval(heartbeat);
    }
  } finally {
    o.root.fill(0);
    o.wrapKey.fill(0);
  }
}

/** Writes notes that are due, one at a time: an owner's, or anyone's. Returns how many jobs it took. */
export async function work(d: Deps, o: { ownerId?: string | undefined; limit?: number } = {}): Promise<number> {
  if (!inference(d.cfg).configured) return 0;
  return tracked(WRITER, async () => {
    let taken = 0;
    for (; taken < (o.limit ?? 20); taken++) {
      const job = await claim(d, o.ownerId ?? null);
      if (!job) break;
      await attempt(d, job);
    }
    return taken;
  }, (jobs) => ({ jobs }));
}

/** Owners with a worker running, and whether more work was queued for them while it ran. */
const busy = new Map<string, boolean>();
/**
 * Starts writing an owner's queued notes in the background, as soon as a recording stops. Takes
 * only the services from `from`: a request's keys are never kept for later work.
 */
export function kick(from: Deps, ownerId: string): void {
  const d: Deps = { cfg: from.cfg, pool: from.pool, objects: from.objects, livekit: from.livekit, hub: from.hub, docs: from.docs };
  if (busy.has(ownerId)) { busy.set(ownerId, true); return; }
  busy.set(ownerId, false);
  void (async () => {
    try {
      do {
        busy.set(ownerId, false);
        // Replay doesn't wait for notes, or for the notes service to be configured: video is joined whenever a share's tail is over.
        try {
          const { waitMs } = await screens.joinDue(d, ownerId);
          if (waitMs !== null) setTimeout(() => kick(d, ownerId), waitMs + 250).unref();
        } catch (e) {
          wlog.error('shared screens could not be joined', { err: e });
        }
        await work(d, { ownerId });
      } while (busy.get(ownerId));
    } catch (e) {
      wlog.error('notes worker failed', { err: e });
    } finally {
      busy.delete(ownerId);
    }
  })();
}
