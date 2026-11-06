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
import { MAIN_PLACE, type Change, type Decision, type InferenceEvidence, type Person, type RoomNote, type ScreenMoment } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../../context';
import { id128, openJson, stateKey } from '../../crypto';
import { bytea, exec, maybeOne, tx } from '../../db';
import { NotFoundError, UnansweredError, UnverifiedError } from '../../errors';
import { inference } from '../../inference';
import { log } from '../../log';
import { openOwner } from '../../owners';
import { getItem, lockItem, pruneRevisions } from '../../vault';
import { me, profile } from '../account/account';
import { purgeAudio, queueDelete, segments } from '../recordings/audio';
import * as billing from '../billing/service';
import { briefOf, draft, revisited, roomBriefOf, type BriefBoard, type NotesStyle, type Settled, type Written } from './drafting';
import { doneInNotes } from '../calls/live-notes';
import { NoteManifest, decisionsOf, everyoneWith, roomChapters, updateNote, type Revisit } from './service';
import { personOf } from '../account/portraits';
import * as screens from '../recordings/screens';
import { standing } from './series';
import { verificationKey } from '../recordings/transcripts';
import { boardsToRead, type BoardRead } from './worked-on';

const wlog = log.child({ component: 'writer' });
const ATTEMPTS = 3;
/** Longer than the slowest draft (four minutes) and checking the model first; a worker that dies mid-job frees it after this. */
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

type Item = { text: string; at?: number | undefined; changes: Change[] };
/** A breakout room's notes as written, by the room's ID, or that they couldn't be: the call's are written all the same. */
type RoomWritten = { id: string; notes: Written } | { id: string; failed: true };
/** Breakout rooms' notes as written, and the verifications the requests went to. */
interface RoomsWritten { rooms: RoomWritten[]; evidence: InferenceEvidence[] }
/** What a job wrote: the call's notes (none when nothing was said in the main room), each breakout room's, and when the transcript was read. */
interface Wrote { notes?: Written | undefined; rooms: RoomsWritten; readAt: string }

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
 * (drafting.settledOf), and a new item that's still a kept one in other words is dropped; so is anything settled while
 * the notes were being written, which the model never saw.
 */
function keepTouched<T extends Item>(was: T[], fresh: T[]): T[] {
  const kept = was.filter((x) => x.changes.length > 0);
  return [...kept, ...fresh.filter((x) => !kept.some((k) => alike(k, x)))].sort((a, b) => (a.at ?? Number.POSITIVE_INFINITY) - (b.at ?? Number.POSITIVE_INFINITY));
}
/** A part of the notes written again: its decisions, questions and follow-ups, each list kept as people settled it. Any part that has them is merged the same way. */
const keepSettled = (was: Settled, fresh: Settled): Settled =>
  ({ decisions: keepTouched(was.decisions, fresh.decisions), questions: keepTouched(was.questions, fresh.questions), actions: keepTouched(was.actions, fresh.actions) });

/** The boards a part of the call's notes read: the ones open for everyone in it (`main`, or a breakout room's ID). */
const boardsIn = (read: readonly BoardRead[]) => (place: string): BriefBoard[] =>
  read.filter((x) => x.place === place).map((x, i) => ({ name: x.name, text: x.text, followUps: x.followUps.map((f) => ({ id: `${i}:${f.id}`, text: f.text })) }));

/**
 * Each breakout room's notes, written from what was said in that room alone, and the boards open in it, in the same verified path as the call's:
 * one request a room. An answer that can't be used is asked for again, as many times as the job would try the call's,
 * and only then does the room go without. A room where nothing was said while notes were on keeps its section with no
 * notes, and nothing is sent for it.
 */
async function writeRooms(o: Owner, m: NoteManifest, organizer: Person, style: NotesStyle, boards: (place: string) => BriefBoard[], renew: () => Promise<void>, ctx: Record<string, string | number>): Promise<RoomsWritten> {
  const said = m.rooms.flatMap((r, i) => (r.transcript.length ? [{ r, i }] : []));
  const rooms = await inTurns(said, ROOMS_AT_ONCE, async ({ r, i }): Promise<RoomWritten> => {
    for (let tried = 1; ; tried++) {
      // Each request is a fresh lease on the job, so another worker doesn't take it while rooms are written.
      await renew();
      try {
        return { id: r.id, notes: await draft(o.cfg, { ...roomBriefOf(m, r, organizer), ticks: m.ticked.filter((t) => t.room === r.id), boards: boards(r.id) }, tried > 1 ? { ...style, brief: true } : style) };
      } catch (e) {
        // Waiting for the notes model, or a note deleted meanwhile, is the whole job's; anything else is this room's alone.
        if (e instanceof UnverifiedError || e instanceof UnansweredError || e instanceof NotFoundError) throw e;
        if (tried < ATTEMPTS) { wlog.info('a breakout room’s notes came back unusable; asking again', { ...ctx, room: i, tried, err: e }); continue; }
        wlog.warn('a breakout room’s notes could not be written; the rest are written without them', { ...ctx, room: i, tried, err: e });
        return { id: r.id, failed: true };
      }
    }
  });
  return { rooms, evidence: rooms.flatMap((x) => ('notes' in x ? [x.notes.evidence] : [])) };
}

/** How many breakout rooms' notes are written at once: each is a request of up to four minutes. */
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
 * Writes the notes into the note, each breakout room's too (or finishes it without them, with its shared screens read
 * when they were), charges for them and closes the job, together. The charge is for the minutes recorded, not the
 * length of the call: time with notes off is free. Whenever they're written, what people already added, confirmed or
 * changed stays, in the call's notes and each room's, even if the first try never wrote anything; notes written again
 * (the organizer asked, after correcting the transcript) aren't charged again, and when they can't be written, the notes
 * stay as they were. `writtenAt` says when the notes read the transcript, so a correction made since is offered for
 * writing them again. Follow-ups ticked during the call are done in whichever part of the notes is written, and wait for
 * the ones that aren't.
 *
 * A call set not to keep its transcript loses it here, once notes are written from it, and not before. Each part of
 * the call goes with its own notes, the main room's and each breakout room's: the new revision has none of those, and
 * every earlier revision goes, in the transaction that closes the job found through them, with any receipt that might
 * copy one. Notes that can't be written leave their part's transcript in the new revision alone, so the organizer can
 * have them written, and it goes when they are. A call set not to keep its recording lost its audio when it ended;
 * anything that got in since goes here too.
 */
async function settle(o: Owner, jobId: string, noteId: string, wrote: Wrote | undefined, shown?: ScreenMoment[] | undefined): Promise<void> {
  const any = Boolean(wrote?.notes) || Boolean(wrote?.rooms.evidence.length);
  const leftover = await tx(o.pool, async (c) => {
    let first = true;
    // Breakout rooms join the chapters the notes wrote, in order: the call's note covers the rooms too.
    // The notes model's verifications join the ones the transcript went to.
    const next = await updateNote(o, c, noteId, (m) => {
      first = m.writtenAt === null;
      const rooms = roomChapters(m.breakouts);
      const chapters = [...(wrote?.notes?.chapters ?? m.chapters), ...rooms]
        .filter((x, i, all) => all.findIndex((y) => y.at === x.at && y.title === x.title && y.summary === x.summary) === i)
        .sort((a, b) => a.at - b.at);
      if (!wrote) return { ...m, status: 'ready', chapters, ...(shown ? { screens: shown } : {}) };
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
      const evidence = [...(wrote.notes ? [wrote.notes.evidence] : []), ...wrote.rooms.evidence];
      const inference = evidence.reduce((all, e) => (all.some((x) => verificationKey(x) === verificationKey(e)) ? all : [...all, e]), m.inference);
      if (!wrote.notes) {
        return { ...m, status: 'ready', chapters, rooms: sections, inference, ticked: waiting, ...(any ? { writtenAt: wrote.readAt } : {}), ...(shown ? { screens: shown } : {}) };
      }
      const { evidence: _, ticks, ...written } = wrote.notes;
      const items = { ...written, ...keepSettled(m, written) };
      const actions = doneInNotes(items.actions, m.ticked.filter((t) => t.room === null), ticks, m.transcript ?? []);
      return { ...m, status: 'ready', ...items, actions, chapters, rooms: sections, writtenAt: wrote.readAt, transcript: m.keep.transcript ? m.transcript : [], inference, ticked: waiting };
    });
    await exec(c, 'DELETE FROM content_jobs WHERE owner_id = $1 AND job_id = $2', [o.ownerId, jobId]);
    if (any && first) {
      const recorded = next.recorded ?? (await segments(o, next.recordingId, c)).reduce((n, s) => n + s.seconds, 0);
      const minutes = Math.max(1, Math.ceil(recorded / 60));
      await billing.charge({ cfg: o.cfg }, c, o.ownerId, { amount: minutes * billing.PER_MINUTE, label: `Notes, ${minutes} min` });
    }
    if (any && !next.keep.transcript) {
      const revisions = await pruneRevisions(o, c, noteId);
      await exec(c, 'DELETE FROM operations WHERE owner_id = $1', [o.ownerId]);
      wlog.info('transcript deleted, as the call was set to', { noteId, revisions });
    }
    return next.keep.recording ? [] : purgeAudio(o, c, next.recordingId);
  });
  await queueDelete(o, leftover);
}

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
async function compareWithEarlier(o: Owner, noteId: string, read: NoteManifest, organizer: Person, ctx: Record<string, string | number>): Promise<void> {
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
    const { found, evidence } = await revisited(o.cfg, briefOf(m, organizer, m.invited.map((e) => personOf(e))), decisions, earlier);
    const fresh = found.map((r): Revisit => ({ ...r, id: id128(), dismissed: null }));
    await tx(o.pool, (c) => updateNote(o, c, noteId, (n) => (!fresh.length && !n.revisits.length ? n : {
      ...n, revisits: revisitsAfter(n.revisits, fresh, decisionsOf(n)),
      inference: !fresh.length || n.inference.some((x) => verificationKey(x) === verificationKey(evidence)) ? n.inference : [...n.inference, evidence]
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
    const { recordingId } = openJson(stateKey(o.root, o.ownerId, `job:${noteId}`), { v: 1, kind: 'job', ownerId: o.ownerId, noteId }, job.job_ciphertext, Job);
    // Read holding the note, with when: corrections are stamped holding it too, so one made after this is later than
    // `readAt`, and the app offers writing the notes again with it.
    const { note, readAt } = await tx(o.pool, async (c) => {
      await lockItem(o, c, noteId);
      return { note: await getItem(o, c, 'note', noteId, NoteManifest, 'Those notes'), readAt: new Date().toISOString() };
    });
    const lines = note.manifest.transcript?.length ?? 0;
    const at = { ...ctx, noteId, recordingId, lines, seconds: note.manifest.duration };
    // Finishing without notes still keeps what was read on each shared screen so far (kept in its frame's row).
    const readSoFar = async () => screens.withReadings(note.manifest.screens, note.manifest.screens.length ? await screens.framesOf(o, o.pool, noteId) : []);
    if (job.tried >= ATTEMPTS) {
      wlog.error('notes job outlived its last attempt; finishing the note without a summary', at);
      await settle(o, job.job_id, noteId, undefined, await readSoFar());
      return;
    }
    try {
      const t0 = performance.now();
      // What was on shared screens is read first, frame by frame, so the notes can say what was shown while it was said;
      // a call where nothing was transcribed still keeps what its screens showed.
      const shown = screens.withReadings(note.manifest.screens, note.manifest.screens.length ? await screens.readAll(o, noteId, recordingId) : []);
      // The job's owner is the organizer of a call, or the person who recorded a room: their choices decide, for the
      // call's notes and each breakout room's.
      const organizer = await me(o);
      const { notesLanguage: language, summaryLength: length } = (await profile(o)).preferences;
      // After an attempt that didn't work, which may have been cut off, ask for less rather than the same again.
      const style: NotesStyle = { language, length, brief: job.tried > 0 };
      const renew = async () => {
        await exec(d.pool, 'UPDATE content_jobs SET lease_until = now() + make_interval(secs => $3) WHERE owner_id = $1 AND job_id = $2', [job.owner_id, job.job_id, LEASE_SECONDS]);
      };
      // The boards open for everyone in the call, as they are now, for the notes of the part each was open in: only those
      // everyone the note went to can open, because one summary goes to them all, the people it was shared with since included.
      const boards = boardsIn(await boardsToRead(o, note.manifest.workedOn, everyoneWith(note.manifest, organizer.email), at));
      // Each breakout room's notes, from what was said there alone.
      const rooms = await writeRooms(o, note.manifest, organizer, style, boards, renew, at);
      if (!lines) {
        await settle(o, job.job_id, noteId, { rooms, readAt }, shown);
        wlog.info(rooms.evidence.length ? 'only breakout rooms were transcribed; their notes written' : 'nothing was transcribed; note finished without notes',
          { ...at, screens: shown.length, rooms: note.manifest.rooms.length, roomsWritten: rooms.evidence.length });
        await compareWithEarlier(o, noteId, note.manifest, organizer, at);
        return;
      }
      await renew();
      const notes = await draft(o.cfg, { ...briefOf(note.manifest, organizer, note.manifest.invited.map((e) => personOf(e))), screens: shown, ticks: note.manifest.ticked.filter((t) => t.room === null), boards: boards(MAIN_PLACE) }, style);
      await settle(o, job.job_id, noteId, { notes, rooms, readAt });
      wlog.info('notes written', {
        ...at, language: style.language, length: style.length, decisions: notes.decisions.length, actions: notes.actions.length, chapters: notes.chapters.length, screens: shown.length,
        screenRefs: [...notes.decisions, ...notes.questions, ...notes.actions, ...notes.chapters].filter((x) => x.screen).length,
        rooms: note.manifest.rooms.length, roomsWritten: rooms.evidence.length, ms: Math.round(performance.now() - t0)
      });
      await compareWithEarlier(o, noteId, note.manifest, organizer, at);
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
        await settle(o, job.job_id, noteId, undefined, await readSoFar());
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
  const d: Deps = { cfg: from.cfg, pool: from.pool, objects: from.objects, livekit: from.livekit, hub: from.hub, docs: from.docs };
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
