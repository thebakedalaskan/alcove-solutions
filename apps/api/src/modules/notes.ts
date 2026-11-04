/*
 * Notes. A note lives in its organizer's vault. Everyone invited to its call gets it when the call
 * ends, and anyone who has it can share it on, by address or with one of their groups; the note
 * keeps, sealed, who shared it with whom, the group's name and when. Who else may read it is kept in
 * note_access as keyed email hashes. Someone else's note is opened with its organizer's keys, and
 * only after that check.
 */
import {
  ActionItemSchema, CaptureGapSchema, ChapterSchema, DecisionSchema, InferenceEvidenceSchema, NoteKindSchema, NoteStatusSchema, QuestionSchema, RoomNoteSchema, ScreenMomentSchema, TranscriptLineSchema, minutesLabel,
  type ActionItem, type ActionPatch, type AnswerPart, type CaptureGap, type Change, type Chapter, type Decision, type DecisionPatch, type GroupShare, type Inbox, type LinePatch, type Note, type NoteKind, type NoteProgress,
  type NoteSummary, type OpenAction, type PendingDecision, type Person, type Question, type QuestionPatch, type Received, type Recipient, type RoomNote, type ScreenMoment, type Speaker, type TranscriptLine
} from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../context';
import { b64u, blindIndex, id128, sealJson, stateKey, toJson } from '../crypto';
import { bytea, exec, maybeOne, rows, tx, type Db } from '../db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, notFound } from '../errors';
import { inference } from '../inference';
import { log } from '../log';
import { findOwner, masterKey } from '../owners';
import { createItem, findItem, getItem, listItems, lockItem, saveRevision, type Loaded } from '../vault';
import { me, profile, unpin } from './account';
import * as additions from './additions';
import { noteObjects, queueDelete, segments } from './audio';
import { answer, answerFromNotes, briefOf, type NoteBrief } from './drafting';
import { MeetingManifest } from './meetings';
import * as personal from './personal';
import { nameOf, personOf } from './portraits';
import * as screens from './screens';
import * as transcripts from './transcripts';

const nlog = log.child({ component: 'notes' });

/**
 * Breakout rooms a call held: each room's name and the invited people sent to it (by email), and
 * when. A call keeps the times in seconds since it started; its note, in seconds into the recording.
 */
export const HeldRooms = z.object({ rooms: z.array(z.object({ id: z.string(), name: z.string(), emails: z.array(z.string()) })), from: z.number(), to: z.number() });
export type HeldRooms = z.infer<typeof HeldRooms>;

/** The rooms a call held, as chapters of its notes: when they opened, and who was in which room. */
export function roomChapters(held: HeldRooms[]): Chapter[] {
  return held.map((h) => {
    const minutes = Math.max(1, Math.round((h.to - h.from) / 60));
    const who = h.rooms.map((r) => `${r.name}: ${r.emails.length ? r.emails.map((e) => nameOf(personOf(e))).join(', ') : 'nobody invited'}`).join('. ');
    const summary = `${who}. ${minutes} min.`;
    return { at: Math.max(0, Math.round(h.from)), title: `${h.rooms.length} breakout rooms`, summary: summary.length > 160 ? `${summary.slice(0, 159).trimEnd()}…` : summary };
  });
}

/** Who shared a note on: their account, and their name and address as they were when they shared it. */
const Sharer = z.object({ id: z.string(), name: z.string(), email: z.string() });
type Sharer = z.infer<typeof Sharer>;
/**
 * Someone a note was shared with after the call: their address, who shared it, the name of the
 * sharer's group it went to (nothing else about the group leaves the sharer's profile), and when.
 */
const SharedWith = z.object({ email: z.string(), by: Sharer, group: z.string().optional(), at: z.string() });
type SharedWith = z.infer<typeof SharedWith>;

export const NoteManifest = z.object({
  kind: NoteKindSchema, title: z.string(), startedAt: z.string(), duration: z.number(),
  meetingId: z.string().optional(), recordingId: z.string(), status: NoteStatusSchema,
  /** Email addresses of everyone invited to the call, who get the notes when it ends. */
  invited: z.array(z.string()),
  /** When the call ended or the recording stopped, which is when everyone invited got the notes. */
  endedAt: z.string().optional(),
  /** Everyone the notes were shared with afterwards, in the order they got them. */
  shared: z.array(SharedWith),
  summary: z.string(), decisions: z.array(DecisionSchema), questions: z.array(QuestionSchema), actions: z.array(ActionItemSchema), chapters: z.array(ChapterSchema),
  /** The stretches of the call nothing was captured in (notes off or paused), where they fall in the recording. */
  gaps: z.array(CaptureGapSchema),
  /** What was on shared screens while screen notes were on: each frame kept (its image is in screen_frames), read and described once the notes are written. */
  screens: z.array(ScreenMomentSchema), transcript: z.array(TranscriptLineSchema).nullable(), suggestedQuestions: z.array(z.string()),
  /** When the notes were last written from the transcript (ISO), or null until they have been. */
  writtenAt: z.string().nullable(),
  /**
   * Each breakout room's own section: who was in it, when, what was said there while notes were on, and its notes once
   * they're written (from that room's transcript alone). Everyone with the note reads them all.
   */
  rooms: z.array(RoomNoteSchema).default([]),
  /** Breakout rooms the call held, in seconds into the recording: each time the notes are written, they're among its chapters. */
  breakouts: z.array(HeldRooms),
  /** The verified models that transcribed the speech and wrote the notes, as they were checked. */
  inference: z.array(InferenceEvidenceSchema)
});
export type NoteManifest = z.infer<typeof NoteManifest>;
/** A note's follow-ups: the call's, then each breakout room's. */
const actionsOf = (m: NoteManifest): ActionItem[] => [...m.actions, ...m.rooms.flatMap((r) => r.actions)];
/** A note's decisions: the call's, then each breakout room's. */
const decisionsOf = (m: NoteManifest): Decision[] => [...m.decisions, ...m.rooms.flatMap((r) => r.decisions)];

/** A note about to be recorded, starting when its recording does. */
export function blankNote(o: { kind: NoteKind; title: string; startedAt: Date; recordingId: string; invited: string[]; meetingId?: string | undefined }): NoteManifest {
  return {
    kind: o.kind, title: o.title, startedAt: o.startedAt.toISOString(), duration: 0, recordingId: o.recordingId,
    ...(o.meetingId ? { meetingId: o.meetingId } : {}), invited: o.invited, shared: [],
    status: 'recording', summary: '', decisions: [], questions: [], actions: [], chapters: [], gaps: [], screens: [], transcript: null, rooms: [], suggestedQuestions: [], writtenAt: null,
    breakouts: [], inference: []
  };
}
/** Creates the note item first, then its recording, in one transaction. */
export async function createNoteWithRecording(o: Owner, db: Db, make: (recordingId: string) => NoteManifest, createRec: (noteItemId: string) => Promise<string>): Promise<{ noteId: string; recordingId: string }> {
  const placeholder = make('pending-recording');
  const { itemId, revisionId } = await createItem(o, db, 'note', placeholder);
  const recordingId = await createRec(itemId);
  await saveRevision(o, db, itemId, revisionId, make(recordingId));
  return { noteId: itemId, recordingId };
}
/** Changes a note in a new revision. Handing back the same manifest changes nothing and writes nothing. */
export async function updateNote(o: Owner, db: Db, noteId: string, fn: (n: NoteManifest) => NoteManifest): Promise<NoteManifest> {
  await lockItem(o, db, noteId);
  const cur = await getItem(o, db, 'note', noteId, NoteManifest, 'Those notes');
  const next = fn(cur.manifest);
  if (next !== cur.manifest) await saveRevision(o, db, noteId, cur.revisionId, next);
  return next;
}

const emailIndex = (o: Owner, email: string) => blindIndex(masterKey(o), 'email', email);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
async function grant(o: Owner, db: Db, noteId: string, emails: string[], role: 'invited' | 'shared'): Promise<void> {
  for (const e of emails) {
    await exec(db, 'INSERT INTO note_access (owner_id, note_item_id, email_index, role) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [o.ownerId, noteId, emailIndex(o, e), role]);
  }
}

/** A breakout room the call held, for its section of the note: who was in it, when (seconds into the recording) and its gaps. */
export interface HeldRoom { id: string; name: string; people: Speaker[]; from: number; to: number; gaps: CaptureGap[] }

/**
 * The recording is complete: its live transcript moves into the note, the main room's lines into the transcript and
 * each breakout room's into that room's section (`rooms`), with the stretches nothing was captured in and what was on
 * shared screens (`shown`, the call's frames as screen moments). Everyone invited gets the note, and it's queued for
 * the notes service (modules/writer.ts), which writes each room's notes too. Runs in the stopping transaction.
 */
export async function finishRecording(o: Owner, db: Db, noteId: string, durationSeconds: number, breakouts: HeldRooms[] = [],
  speakerOf?: ((identity: string) => Speaker | undefined) | undefined, gaps: CaptureGap[] = [], shown: ScreenMoment[] = [], rooms: HeldRoom[] = []): Promise<void> {
  const { recordingId } = (await getItem(o, db, 'note', noteId, NoteManifest, 'Those notes')).manifest;
  // Each line stays inside its own segment of the recording, so nothing said before a pause comes after it.
  const all = transcripts.placed(await transcripts.lines(o, db, noteId), await segments(o, recordingId));
  const heard = all.filter((l) => l.room === undefined);
  // In a call, each line keeps whoever said it; a room recording names nobody.
  const sections: RoomNote[] = rooms.map((r) => ({
    id: r.id, name: r.name, people: r.people, from: r.from, to: r.to, gaps: r.gaps,
    summary: '', decisions: [], questions: [], actions: [], chapters: [], transcript: transcripts.spoken(all.filter((l) => l.room === r.id), speakerOf)
  }));
  const heardBy = await transcripts.heardBy(o, db, noteId);
  const next = await updateNote(o, db, noteId, (n) => ({
    ...n, status: 'pending', endedAt: new Date().toISOString(), duration: Math.max(n.duration, durationSeconds), breakouts, gaps, screens: shown,
    // In a call, each line keeps whoever said it; a room recording names nobody.
    transcript: transcripts.spoken(heard, speakerOf), rooms: sections,
    inference: heardBy
  }));
  await transcripts.clear(o, db, noteId);
  await grant(o, db, noteId, next.invited, 'invited');
  await personal.dropUnheld(db, o.ownerId, noteId);
  await queueNotes(o, db, noteId, next.recordingId);
  nlog.info('notes job queued', {
    noteId, recordingId: next.recordingId, seconds: durationSeconds, lines: heard.length, screens: shown.length, invited: next.invited.length,
    rooms: sections.length, roomLines: sections.reduce((n, r) => n + r.transcript.length, 0)
  });
}

/** Queues a note's notes for the notes service (modules/writer.ts), for its head revision, in the caller's transaction. */
async function queueNotes(o: Owner, db: Db, noteId: string, recordingId: string): Promise<void> {
  const head = await getItem(o, db, 'note', noteId, NoteManifest, 'Those notes');
  const job = { noteId, recordingId };
  await exec(db, `INSERT INTO content_jobs (owner_id, job_id, revision_id, kind, state, attempt, job_ciphertext) VALUES ($1,$2,$3,'notes','queued',0,$4)
                  ON CONFLICT (owner_id, revision_id, kind) DO NOTHING`,
    [o.ownerId, id128(), head.revisionId, sealJson(stateKey(o.root, o.ownerId, `job:${noteId}`), { v: 1, kind: 'job', ownerId: o.ownerId, noteId }, toJson(job))]);
}

/* ---------- finding a note: your own, or one you have access to ---------- */

/** A note and the vault it lives in: your own, or someone else's that you have under your address `as`. */
export type Located =
  | { owner: Owner; note: Loaded<NoteManifest>; mine: true }
  | { owner: Owner; note: Loaded<NoteManifest>; mine: false; as: string };
const AccessRow = z.object({ owner_id: z.string(), note_item_id: z.string() });

/** The IDs of every note this person has, their own and ones shared with them, without opening any vault. */
export async function heldNoteIds(o: Owner): Promise<Set<string>> {
  const Id = z.object({ id: z.string() });
  const own = await rows(o.pool, Id, `SELECT item_id AS id FROM items WHERE owner_id = $1 AND kind = 'note' AND deleted_at IS NULL`, [o.ownerId]);
  const shared = await rows(o.pool, Id, 'SELECT note_item_id AS id FROM note_access WHERE email_index = $1 AND owner_id <> $2', [emailIndex(o, await myEmail(o)), o.ownerId]);
  return new Set([...own, ...shared].map((r) => r.id));
}

/** The address someone has other people's notes under: their profile's, which follows their sign-in. */
export const myEmail = async (o: Owner): Promise<string> => (await profile(o)).email;

/**
 * Every note someone else gave you, by invitation or by sharing it with you: each found by the index of
 * your address `as` right now. Each organizer's keys are opened once, however many of their notes you have.
 */
export async function sharedWithMe(o: Owner, as: string): Promise<Located[]> {
  const access = await rows(o.pool, AccessRow, 'SELECT owner_id, note_item_id FROM note_access WHERE email_index = $1 AND owner_id <> $2', [emailIndex(o, as), o.ownerId]);
  const owners = new Map<string, Owner | undefined>();
  const out: Located[] = [];
  for (const a of access) {
    const owner = owners.has(a.owner_id) ? owners.get(a.owner_id) : await findOwner(o, a.owner_id, undefined);
    owners.set(a.owner_id, owner);
    // Deleted since its row was read, on its own or with its organizer's account: nobody has it any more.
    const note = owner && await findItem(owner, owner.pool, 'note', a.note_item_id, NoteManifest);
    if (owner && note) out.push({ owner, note, mine: false, as });
  }
  return out;
}
/** Every note this person has: their own, and other people's they have under their address `as`. */
async function everyNote(o: Owner, as: string): Promise<Located[]> {
  const own = (await listItems(o, o.pool, 'note', NoteManifest)).map((note): Located => ({ owner: o, note, mine: true }));
  return [...own, ...await sharedWithMe(o, as)];
}

/**
 * How many of these notes, found earlier in this request, the asker can't read any more: deleted,
 * or (someone else's) no longer given to them. An answer that took a while to write is checked with
 * this before it's sent, since it may quote a note that went in the meantime.
 */
export async function goneSince(o: Owner, found: Located[]): Promise<number> {
  const Count = z.object({ n: z.number() });
  const mine = found.filter((l) => l.mine).map((l) => l.note.itemId);
  const theirs = found.filter((l) => !l.mine);
  const ownLeft = mine.length
    ? (await maybeOne(o.pool, Count, `SELECT count(*)::int AS n FROM items WHERE owner_id = $1 AND kind = 'note' AND deleted_at IS NULL AND item_id = ANY($2::text[])`, [o.ownerId, mine]))?.n ?? 0
    : 0;
  const givenLeft = theirs.length
    ? (await maybeOne(o.pool, Count, `SELECT count(*)::int AS n FROM note_access a
        JOIN unnest($2::text[], $3::text[]) AS t(owner_id, note_item_id) ON a.owner_id = t.owner_id AND a.note_item_id = t.note_item_id
        JOIN items i ON i.owner_id = a.owner_id AND i.item_id = a.note_item_id AND i.deleted_at IS NULL
        WHERE a.email_index = $1`, [emailIndex(o, await myEmail(o)), theirs.map((l) => l.owner.ownerId), theirs.map((l) => l.note.itemId)]))?.n ?? 0
    : 0;
  return found.length - ownLeft - givenLeft;
}
export async function locate(o: Owner, id: string, db: Db = o.pool): Promise<Located> {
  const own = await maybeOne(db, z.object({ n: z.number() }), `SELECT 1 AS n FROM items WHERE owner_id = $1 AND item_id = $2 AND kind = 'note' AND deleted_at IS NULL`, [o.ownerId, id]);
  if (own) return { owner: o, note: await getItem(o, db, 'note', id, NoteManifest, 'Those notes'), mine: true };
  const as = await myEmail(o);
  const a = await maybeOne(db, AccessRow, 'SELECT owner_id, note_item_id FROM note_access WHERE note_item_id = $1 AND email_index = $2', [id, emailIndex(o, as)]);
  // No access, or access whose organizer deleted their account since it was read: not found, either way.
  const owner = a && await findOwner(o, a.owner_id, undefined, db);
  if (!owner) throw notFound('Those notes', { noteId: id });
  return { owner, note: await getItem(owner, db, 'note', id, NoteManifest, 'Those notes'), mine: false, as };
}

/**
 * Keeps a note, and this person's way to it, in place until the transaction ends, or says they've gone: deleting the
 * note, or removing it from their notes, waits for what's being written with it, and then takes that too.
 */
export async function holdAccess(o: Owner, l: Located, db: Db): Promise<void> {
  const One = z.object({ n: z.number() });
  const noteId = l.note.itemId;
  const note = await maybeOne(db, One, `SELECT 1 AS n FROM items WHERE owner_id = $1 AND item_id = $2 AND kind = 'note' AND deleted_at IS NULL FOR KEY SHARE`, [l.owner.ownerId, noteId]);
  const given = l.mine || await maybeOne(db, One, 'SELECT 1 AS n FROM note_access WHERE owner_id = $1 AND note_item_id = $2 AND email_index = $3 FOR KEY SHARE', [l.owner.ownerId, noteId, emailIndex(o, l.as)]);
  if (!note || !given) throw notFound('Those notes', { noteId });
}

const Holder = z.object({ email_index: bytea });
/** Everyone who has the organizer's note now, besides the organizer, by the keyed hash of their address. */
async function holders(owner: Owner, db: Db, noteId: string): Promise<Set<string>> {
  const found = await rows(db, Holder, 'SELECT email_index FROM note_access WHERE owner_id = $1 AND note_item_id = $2', [owner.ownerId, noteId]);
  return new Set(found.map((r) => b64u(r.email_index)));
}

/** Who shared a note on, as everyone sees them: the organizer as they are now, anyone else as they were when they shared it. */
const sharerOf = (s: Sharer, organizer: Person): Person => (s.id === organizer.id ? organizer : { ...personOf(s.email, s.name), id: s.id });

/**
 * Everyone who has a note, organizer first; then the people invited to its call (all of them while
 * it records, since they get it when it ends); then the people it was shared with, in the order they
 * got it, each with who shared it, the group's name and when. Whoever has since removed it from
 * their notes no longer has it, so isn't listed.
 */
async function recipients(l: Located, organizer: Person, db: Db = l.owner.pool): Promise<Recipient[]> {
  const m = l.note.manifest;
  const holding = await holders(l.owner, db, l.note.itemId);
  const holds = (email: string) => holding.has(b64u(emailIndex(l.owner, email)));
  // Someone invited who removed the notes and was given them again has them as shared now.
  const sharedTo = new Set(m.shared.map((s) => s.email));
  return [
    { person: organizer, role: 'organizer' },
    ...m.invited.filter((e) => !sharedTo.has(e) && (m.status === 'recording' || holds(e)))
      .map((e): Recipient => ({ person: personOf(e), role: 'invited', ...(m.endedAt ? { at: m.endedAt } : {}) })),
    ...m.shared.filter((s) => holds(s.email))
      .map((s): Recipient => ({ person: personOf(s.email), role: 'shared', by: sharerOf(s.by, organizer), ...(s.group ? { group: s.group } : {}), at: s.at }))
  ];
}

/** Everyone who has a note now, organizer first: who reads whatever is added to it. */
export async function audienceOf(l: Located, db: Db = l.owner.pool): Promise<Person[]> {
  return (await recipients(l, await me(l.owner), db)).map((r) => r.person);
}

/** How someone came to have a note that isn't theirs, from the address they have it under. */
export function receivedBy(m: NoteManifest, as: string, organizer: Person): Received {
  const s = m.shared.find((x) => same(x.email, as));
  if (s) return { role: 'shared', by: sharerOf(s.by, organizer), ...(s.group ? { group: s.group } : {}), at: s.at };
  // Everyone else who has it was invited to the call, and got it when the call ended.
  return { role: 'invited', by: organizer, at: m.endedAt ?? m.startedAt };
}

/**
 * Each time someone shared the note with one of their groups, from the people who still have it: once
 * for each sharer and group (the latest time), newest first. Whoever has the note sees the same list.
 */
function groupSharesOf(who: Recipient[]): GroupShare[] {
  const shares = new Map<string, GroupShare>();
  for (const r of who) {
    if (r.role !== 'shared' || !r.by || !r.group || !r.at) continue;
    const key = `${r.by.email.toLowerCase()}\n${r.group}`;
    const had = shares.get(key);
    if (!had || Date.parse(r.at) > Date.parse(had.at)) shares.set(key, { by: r.by, group: r.group, at: r.at });
  }
  return [...shares.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

function summaryOf(l: Located, organizer: Person, who: Recipient[]): NoteSummary {
  const m = l.note.manifest;
  return {
    id: l.note.itemId, kind: m.kind, status: m.status, title: m.title, startedAt: m.startedAt, duration: m.duration,
    people: who.map((r) => r.person),
    excerpt: m.summary.split(/(?<=\.)\s/).slice(0, 2).join(' '),
    openActions: actionsOf(m).filter((a) => !a.done).length, totalActions: actionsOf(m).length,
    ...(m.meetingId && l.mine ? { meetingId: m.meetingId } : {}), ...(l.mine ? {} : { received: receivedBy(m, l.as, organizer) }),
    groupShares: groupSharesOf(who)
  };
}
async function summary(l: Located): Promise<NoteSummary> {
  const organizer = await me(l.owner);
  return summaryOf(l, organizer, await recipients(l, organizer));
}

export async function list(o: Owner, q: { kind?: NoteKind | undefined; text?: string | undefined }): Promise<NoteSummary[]> {
  const text = q.text?.trim().toLowerCase();
  const all = (await everyNote(o, await myEmail(o)))
    .filter((l) => {
      const m = l.note.manifest;
      return (!q.kind || m.kind === q.kind) && (!text || `${m.title} ${m.summary} ${(m.transcript ?? []).map((t) => t.text).join(' ')}`.toLowerCase().includes(text));
    });
  all.sort((a, b) => b.note.manifest.startedAt.localeCompare(a.note.manifest.startedAt));
  return Promise.all(all.map(summary));
}
/** The series a note's call is in, read from the call in its organizer's vault. Room recordings have no call, so no series. */
export async function seriesOf(l: Located): Promise<string | undefined> {
  const meetingId = l.note.manifest.meetingId;
  return meetingId ? (await findItem(l.owner, l.owner.pool, 'meeting', meetingId, MeetingManifest))?.manifest.seriesId : undefined;
}
export async function get(o: Owner, id: string): Promise<Note> {
  const l = await locate(o, id);
  const m = l.note.manifest;
  const organizer = await me(l.owner);
  const who = await recipients(l, organizer);
  const seriesId = await seriesOf(l);
  return {
    ...summaryOf(l, organizer, who), recipients: who, summary: m.summary, decisions: m.decisions, questions: m.questions, actions: m.actions, chapters: m.chapters,
    gaps: m.gaps, screens: m.screens, transcript: m.transcript, rooms: m.rooms, additions: await additions.of(l, o.ownerId), writtenAt: m.writtenAt, writingAgain: m.status === 'ready' && !!(await jobOf(l.owner, l.owner.pool, id)),
    suggestedQuestions: m.suggestedQuestions, audio: await segments(l.owner, m.recordingId), inference: m.inference, ...(seriesId ? { seriesId } : {})
  };
}
/** A note's notes job while its notes are queued or being written, whichever of its revisions it was queued for. */
async function jobOf(o: Owner, db: Db, noteId: string) {
  return maybeOne(db, z.object({ state: z.string(), attempt: z.number() }), `SELECT state, attempt FROM content_jobs WHERE owner_id = $1 AND kind = 'notes'
    AND revision_id IN (SELECT revision_id FROM revisions WHERE owner_id = $1 AND item_id = $2) LIMIT 1`, [o.ownerId, noteId]);
}
/** The vault and recording to stream a note's audio from, after the access check. */
export async function audioSource(o: Owner, id: string): Promise<{ owner: Owner; recordingId: string }> {
  const l = await locate(o, id);
  return { owner: l.owner, recordingId: l.note.manifest.recordingId };
}
/** One of a note's shared-screen frames, decrypted, for anyone who has the note: only frames the note shows. */
export async function screenImage(o: Owner, id: string, frameId: string): Promise<Uint8Array> {
  const l = await locate(o, id);
  if (!l.note.manifest.screens.some((m) => m.id === frameId)) throw notFound('That frame', { noteId: id });
  return screens.image(l.owner, id, l.note.manifest.recordingId, frameId);
}
/** Where a note is on its way to being written, step by step; `ready` once the notes are written. */
export async function progress(o: Owner, id: string): Promise<NoteProgress> {
  const { owner, note } = await locate(o, id);
  const m = note.manifest;
  const stopped = m.status !== 'recording';
  const seconds = (await segments(owner, m.recordingId)).reduce((s, a) => s + a.seconds, 0);
  // The call's lines and every breakout room's.
  const lines = (m.transcript?.length ?? 0) + m.rooms.reduce((n, r) => n + r.transcript.length, 0);
  // Notes being written again leave the note ready meanwhile: they're done when their job is.
  const job = stopped ? await jobOf(owner, owner.pool, id) : undefined;
  const done = m.status === 'ready' && !job;
  const writing = !inference(o.cfg).configured ? 'Waiting for the notes service to be connected'
    : job?.state === 'writing' ? 'Writing the summary, decisions and follow-ups'
      : job?.state === 'waiting' ? 'Waiting for the notes model. The notes are written as soon as it’s verified and answering'
        : job && job.attempt > 0 ? 'The notes service is busy. Trying again shortly'
          : 'Queued for the notes service';
  return {
    noteId: id, title: m.title, ready: done,
    steps: [
      { label: m.kind === 'room' ? 'Recording stopped' : 'Call ended', done: stopped },
      { label: seconds ? `${minutesLabel(seconds)} of audio saved, encrypted` : 'No audio was recorded', done: stopped },
      { label: !stopped ? 'Transcribing as it goes' : lines ? `Transcript of ${lines} ${lines === 1 ? 'line' : 'lines'}` : 'Nothing was transcribed', done: stopped },
      { label: done ? 'Notes written' : writing, done }
    ]
  };
}

/**
 * Answers a question about written notes from their transcript and each breakout room's section, for anyone who has
 * them. The answer goes only if they still have the notes once it's written: it may quote them.
 */
export async function ask(o: Owner, id: string, question: string): Promise<AnswerPart[]> {
  const l = await locate(o, id);
  const { owner, note } = l;
  const m = note.manifest;
  if (m.status !== 'ready') throw new ConflictError('You can ask about a call once its notes are written.', { context: { noteId: id, status: m.status } });
  if (!m.transcript?.length && !m.rooms.some((r) => r.transcript.length)) throw new ConflictError('Nothing was said while notes were on, so there’s nothing to ask about.', { context: { noteId: id } });
  const t0 = performance.now();
  const parts = await answer(o.cfg, id, briefOf(m, await me(owner), m.invited.map((e) => personOf(e))), await me(o), question);
  const ms = Math.round(performance.now() - t0);
  if (await goneSince(o, [l])) {
    throw new ConflictError('These notes were deleted or removed from yours while the answer was being written, so it isn’t shown.', { context: { noteId: id, mine: l.mine, ms } });
  }
  nlog.info('question answered', { noteId: id, mine: l.mine, cites: parts.length - 1, ms });
  return parts;
}

const NOTHING_TO_ASK = 'You don’t have any notes to answer from yet.';
const NOT_WRITTEN = 'Your notes aren’t written yet. Ask again once they’re ready.';
/**
 * Answers a question from every note this person has, their own and ones shared with them: the ones
 * written with a transcript (modules/drafting.ts chooses which go). Without any, it says so, and
 * nothing goes to the notes model. The answer goes only if they still have every note it read once
 * it's written: it may quote any of them.
 */
export async function askAll(o: Owner, question: string): Promise<AnswerPart[]> {
  const all = await everyNote(o, await myEmail(o));
  const ready = all.filter((l) => l.note.manifest.status === 'ready' && (l.note.manifest.transcript?.length ?? 0) > 0);
  if (!ready.length) {
    const writing = all.some((l) => l.note.manifest.status !== 'ready');
    nlog.info('asked across notes with nothing to answer from', { notes: all.length, writing });
    return [{ type: 'text', text: writing ? NOT_WRITTEN : NOTHING_TO_ASK }];
  }
  // Each vault's owner organized all of their notes here, so each is read once.
  const people = new Map<string, Promise<Person>>();
  const person = (owner: Owner): Promise<Person> => {
    const p = people.get(owner.ownerId) ?? me(owner);
    people.set(owner.ownerId, p);
    return p;
  };
  const notes = await Promise.all(ready.map(async ({ owner, note }): Promise<NoteBrief> => {
    const m = note.manifest;
    return { id: note.itemId, startedAt: m.startedAt, decisions: m.decisions, actions: m.actions, brief: briefOf(m, await person(owner), m.invited.map((e) => personOf(e))) };
  }));
  const t0 = performance.now();
  const { parts, sent, lines } = await answerFromNotes(o.cfg, notes, await person(o), question);
  const ms = Math.round(performance.now() - t0);
  // Writing it can take up to a minute. A note deleted or taken away meanwhile must not show through the answer.
  if (await goneSince(o, ready.filter((l) => sent.includes(l.note.itemId)))) {
    throw new ConflictError('Notes it read were deleted or removed from yours while the answer was being written, so it isn’t shown. Ask again.', { context: { notes: sent.length, ms } });
  }
  nlog.info('question answered across notes', { notes: all.length, ready: ready.length, sent: sent.length, lines, cites: parts.length - 1, ms });
  return parts;
}
/**
 * What waits on this person across every note they have, their own and ones shared with them, newest
 * note first: follow-ups that are theirs and not done, and decisions in written notes nobody has
 * confirmed or rejected. Notes they removed aren't theirs any more, so nothing from them is listed.
 */
export async function inbox(o: Owner): Promise<Inbox> {
  const email = await myEmail(o);
  const all = await everyNote(o, email);
  all.sort((a, b) => b.note.manifest.startedAt.localeCompare(a.note.manifest.startedAt));
  const from = (l: Located) => ({ noteId: l.note.itemId, noteTitle: l.note.manifest.title, noteStartedAt: l.note.manifest.startedAt });
  return {
    followUps: all.flatMap((l) => actionsOf(l.note.manifest)
      .filter((a) => !a.done && a.owner?.person && same(a.owner.person.email, email)).map((a): OpenAction => ({ ...a, ...from(l) }))),
    decisions: all.filter((l) => l.note.manifest.status === 'ready')
      .flatMap((l) => decisionsOf(l.note.manifest).filter((d) => d.state === 'proposed').map((d): PendingDecision => ({ ...d, ...from(l) })))
  };
}

/* ---------- confirming what the notes say ---------- */

/** A note that's written, located for someone who has it, and who they are for its history. */
async function writtenNote(o: Owner, noteId: string) {
  const l = await locate(o, noteId);
  if (l.note.manifest.status !== 'ready') throw new ConflictError('These notes are still being written.', { context: { noteId, status: l.note.manifest.status } });
  const p = await profile(o);
  const by: Change['by'] = { name: p.name, email: p.email };
  return { ...l, by, at: new Date().toISOString() };
}


/**
 * Confirms a decision, says it wasn't decided, puts it back to proposed, rewords it, or says a
 * confirmed one no longer holds: the call's, or a breakout room's. Anyone who has the notes can, and everyone sees who did.
 */
export async function updateDecision(o: Owner, noteId: string, decisionId: string, patch: DecisionPatch): Promise<Note> {
  const { owner, by, at } = await writtenNote(o, noteId);
  let made: Change['what'][] = [];
  await tx(owner.pool, (c) => updateNote(owner, c, noteId, (n) => {
    const d = decisionsOf(n).find((x) => x.id === decisionId);
    if (!d) throw new NotFoundError('That decision doesn’t exist.', { context: { noteId, decisionId } });
    const changes = [...d.changes];
    let next: Decision = d;
    if (patch.text !== undefined && patch.text !== d.text) { changes.push({ by, at, what: 'reworded', before: d.text, after: patch.text }); next = { ...next, text: patch.text }; }
    if (patch.state !== undefined && patch.state !== d.state) {
      // Only something that was decided can stop holding; what nobody confirmed is reopened or said not to be decided.
      if (patch.state === 'superseded' && d.state !== 'confirmed') throw new ConflictError('Only a confirmed decision can stop holding.', { context: { noteId, decisionId, state: d.state } });
      changes.push({ by, at, what: patch.state === 'proposed' ? 'reopened' : patch.state });
      next = { ...next, state: patch.state };
    }
    made = changes.slice(d.changes.length).map((x) => x.what);
    // Item IDs are the note's own, so the one list that has it changes, the call's or a room's.
    const swap = (xs: Decision[]) => xs.map((x) => (x.id === decisionId ? { ...next, changes } : x));
    return made.length ? { ...n, decisions: swap(n.decisions), rooms: n.rooms.map((r) => ({ ...r, decisions: swap(r.decisions) })) } : n;
  }));
  nlog.info('decision changed', { noteId, decisionId, changes: made.join(',') || 'none', mine: owner.ownerId === o.ownerId });
  return get(o, noteId);
}

/** Says an open question, the call's or a breakout room's, was answered, opens it again, or rewords it. Anyone who has the notes can, and everyone sees who did. */
export async function updateQuestion(o: Owner, noteId: string, questionId: string, patch: QuestionPatch): Promise<Note> {
  const { owner, by, at } = await writtenNote(o, noteId);
  let made: Change['what'][] = [];
  await tx(owner.pool, (c) => updateNote(owner, c, noteId, (n) => {
    const q = [...n.questions, ...n.rooms.flatMap((r) => r.questions)].find((x) => x.id === questionId);
    if (!q) throw new NotFoundError('That question doesn’t exist.', { context: { noteId, questionId } });
    const changes = [...q.changes];
    let next: Question = q;
    if (patch.text !== undefined && patch.text !== q.text) { changes.push({ by, at, what: 'reworded', before: q.text, after: patch.text }); next = { ...next, text: patch.text }; }
    if (patch.state !== undefined && patch.state !== q.state) { changes.push({ by, at, what: patch.state === 'answered' ? 'answered' : 'reopened' }); next = { ...next, state: patch.state }; }
    made = changes.slice(q.changes.length).map((x) => x.what);
    const swap = (xs: Question[]) => xs.map((x) => (x.id === questionId ? { ...next, changes } : x));
    return made.length ? { ...n, questions: swap(n.questions), rooms: n.rooms.map((r) => ({ ...r, questions: swap(r.questions) })) } : n;
  }));
  nlog.info('question changed', { noteId, questionId, changes: made.join(',') || 'none', mine: owner.ownerId === o.ownerId });
  return get(o, noteId);
}

/**
 * Changes a follow-up, the call's or a breakout room's. Anyone who has the notes can give it to someone who has them
 * too, reword it, date it or tick it. Only the person it's for can take it on: the notes only ever suggest.
 */
export async function updateAction(o: Owner, noteId: string, actionId: string, patch: ActionPatch): Promise<Note> {
  const { owner, by, at } = await writtenNote(o, noteId);
  const organizer = await me(owner);
  let made: Change['what'][] = [];
  await tx(owner.pool, async (c) => {
    // Who has the notes, read under the note's lock as the change is made: someone who removed them isn't given a follow-up.
    await lockItem(owner, c, noteId);
    const holding = await holders(owner, c, noteId);
    await updateNote(owner, c, noteId, (n) => {
      const a = actionsOf(n).find((x) => x.id === actionId);
      if (!a) throw new NotFoundError('That follow-up doesn’t exist.', { context: { noteId, actionId } });
      const changes = [...a.changes];
      let next: ActionItem = a;
      if (patch.text !== undefined && patch.text !== a.text) { changes.push({ by, at, what: 'reworded', before: a.text, after: patch.text }); next = { ...next, text: patch.text }; }
      if (patch.owner === null && next.owner) {
        changes.push({ by, at, what: 'reassigned', before: next.owner.name });
        const { owner: _gone, ...rest } = next;
        void _gone;
        next = { ...rest, takenOn: false };
      } else if (typeof patch.owner === 'string' && !(next.owner?.person && same(next.owner.person.email, patch.owner))) {
        const email = patch.owner;
        // Follow-ups go to people who have the notes now, so whoever it's for can see it.
        if (!same(email, organizer.email) && !holding.has(b64u(emailIndex(owner, email)))) throw new ValidationError('Share the notes with them first: follow-ups go to people who have the notes.', { context: { noteId, actionId } });
        const person = same(email, organizer.email) ? organizer : personOf(email);
        const name = nameOf(person);
        // Giving it to yourself is taking it on; anyone else has to say yes themselves.
        const self = same(email, by.email);
        changes.push({ by, at, what: self ? 'took-on' : 'reassigned', ...(next.owner ? { before: next.owner.name } : {}), after: name });
        next = { ...next, owner: { name, person }, takenOn: self };
      }
      if (patch.takeOn) {
        if (!next.owner?.person || !same(next.owner.person.email, by.email)) throw new ForbiddenError('Only the person a follow-up is for can take it on. You can give it to yourself.', { context: { noteId, actionId } });
        if (!next.takenOn) { changes.push({ by, at, what: 'took-on' }); next = { ...next, takenOn: true }; }
      }
      if (patch.due !== undefined) {
        const due = patch.due || undefined;
        if (due !== next.due) {
          changes.push({ by, at, what: 'due', ...(next.due ? { before: next.due } : {}), ...(due ? { after: due } : {}) });
          const { due: _old, ...rest } = next;
          void _old;
          next = due ? { ...rest, due } : rest;
        }
      }
      if (patch.done !== undefined && patch.done !== next.done) { changes.push({ by, at, what: patch.done ? 'done' : 'undone' }); next = { ...next, done: patch.done }; }
      made = changes.slice(a.changes.length).map((x) => x.what);
      const swap = (xs: ActionItem[]) => xs.map((x) => (x.id === actionId ? { ...next, changes } : x));
      return made.length ? { ...n, actions: swap(n.actions), rooms: n.rooms.map((r) => ({ ...r, actions: swap(r.actions) })) } : n;
    });
  });
  nlog.info('follow-up changed', { noteId, actionId, changes: made.join(',') || 'none', mine: owner.ownerId === o.ownerId });
  return get(o, noteId);
}

/* ---------- correcting the transcript ---------- */

/** The most corrections a line keeps: who changed it and when. The first (what was heard) always stays, then the latest. */
const LINE_HISTORY = 20;
/** A line's corrections, kept within LINE_HISTORY: the first, which says what was heard, and the latest after it. */
const kept = (changes: Change[]): Change[] => {
  const [first, ...rest] = changes;
  return first && changes.length > LINE_HISTORY ? [first, ...rest.slice(-(LINE_HISTORY - 1))] : changes;
};

/**
 * Who a line can be said by: anyone the transcript already names (guests by the name they joined with), the organizer,
 * and everyone invited, by `Person.id`.
 */
function speakersFor(n: NoteManifest, organizer: Person): Map<string, Speaker> {
  const out = new Map<string, Speaker>();
  for (const l of n.transcript ?? []) if (l.speaker?.person && !out.has(l.speaker.person.id)) out.set(l.speaker.person.id, l.speaker);
  if (!out.has(organizer.id)) out.set(organizer.id, { name: organizer.name, person: organizer });
  for (const e of n.invited) { const p = personOf(e); if (!out.has(p.id)) out.set(p.id, { name: nameOf(p), person: p }); }
  return out;
}

/** A line with the doubts someone vouched for cleared: its words, its speaker, or both. */
function vouched(l: TranscriptLine, clear: { words?: boolean; speaker?: boolean }): TranscriptLine {
  const { unsure, ...rest } = l;
  const left = { ...(unsure?.words && !clear.words ? { words: true as const } : {}), ...(unsure?.speaker && !clear.speaker ? { speaker: true as const } : {}) };
  return left.words || left.speaker ? { ...rest, unsure: left } : rest;
}

/**
 * Corrects a line of a written note's transcript, the call's or a breakout room's section's, in a new revision with
 * who did it and when: its words, who said it, or that it's right as heard, which clears what the transcript wasn't
 * sure of. The organizer can correct any line; anyone else who has the notes, the words of a line said by them (saying
 * it was heard right vouches for its words, never for who said it). Questions asked about the note read it corrected,
 * and so does writing the notes again.
 */
export async function correctLine(o: Owner, noteId: string, lineId: string, patch: LinePatch): Promise<Note> {
  const { owner, mine, by } = await writtenNote(o, noteId);
  const organizer = await me(owner);
  let made: Change['what'][] = [];
  await tx(owner.pool, (c) => updateNote(owner, c, noteId, (n) => {
    // Checked again holding the note, and stamped holding it: notes written again read the transcript holding it too,
    // so a correction after that is later than when they read it, and the app offers writing them again.
    if (n.status !== 'ready') throw new ConflictError('These notes are still being written.', { context: { noteId, status: n.status } });
    const at = new Date().toISOString();
    const inRoom = n.rooms.find((r) => r.transcript.some((x) => x.id === lineId));
    const line = (inRoom ? inRoom.transcript : n.transcript ?? []).find((x) => x.id === lineId);
    if (!line) throw new NotFoundError('That line isn’t in the transcript.', { context: { noteId, lineId } });
    const theirs = !!line.speaker?.person?.email && same(line.speaker.person.email, by.email);
    // Refusals name nobody, so no name reaches a log line.
    if (!mine && patch.speaker !== undefined) throw new ForbiddenError('Only the organizer can say who said a line.', { context: { noteId, lineId } });
    if (!mine && !theirs) throw new ForbiddenError('You can correct what you said. The organizer can correct the rest.', { context: { noteId, lineId } });
    const changes: Change[] = [];
    let next = line;
    if (patch.text !== undefined && patch.text !== next.text) {
      changes.push({ by, at, what: 'reworded', before: next.text, after: patch.text });
      next = vouched({ ...next, text: patch.text }, { words: true });
    }
    if (patch.speaker === null && next.speaker) {
      changes.push({ by, at, what: 'reassigned', before: next.speaker.name });
      const { speaker: _gone, ...rest } = next;
      void _gone;
      next = vouched(rest, { speaker: true });
    } else if (typeof patch.speaker === 'string') {
      const who = speakersFor(n, organizer).get(patch.speaker);
      if (!who) throw new ValidationError('A line can only be said by someone from the call.', { context: { noteId, lineId } });
      // The same person again says it was them: only worth a change when that was in doubt.
      if (who.person?.id !== next.speaker?.person?.id || next.unsure?.speaker) {
        changes.push({ by, at, what: 'reassigned', ...(next.speaker ? { before: next.speaker.name } : {}), after: who.name });
        next = vouched({ ...next, speaker: who }, { speaker: true });
      }
    }
    if (patch.confirm && next.unsure) {
      // Someone else vouches for what they said, never for who said it: that's the organizer's to settle.
      if (!mine && !next.unsure.words) throw new ForbiddenError('Only the organizer can say who said a line.', { context: { noteId, lineId } });
      changes.push({ by, at, what: 'confirmed' });
      next = vouched(next, mine ? { words: true, speaker: true } : { words: true });
    }
    made = changes.map((x) => x.what);
    if (!changes.length) return n;
    const corrected: TranscriptLine = { ...next, changes: kept([...(line.changes ?? []), ...changes]) };
    const swap = (ls: TranscriptLine[]) => ls.map((x) => (x.id === lineId ? corrected : x));
    return inRoom ? { ...n, rooms: n.rooms.map((r) => (r.id === inRoom.id ? { ...r, transcript: swap(r.transcript) } : r)) } : { ...n, transcript: swap(n.transcript ?? []) };
  }));
  nlog.info('transcript line corrected', { noteId, lineId, changes: made.join(',') || 'none', mine });
  return get(o, noteId);
}

/**
 * Has the notes written again from the transcript as it is now: after corrections, or when they couldn't be written.
 * The organizer's alone, since it's their note the notes service writes for. The note stays `ready` meanwhile, readable
 * and changeable by everyone who has it (`Note.writingAgain` says the notes are being written), and what people have
 * confirmed or changed by the time they're written stays (modules/writer.ts). Asking again while they're queued or
 * being written changes nothing. Call writer.kick after it.
 */
export async function rewrite(o: Owner, noteId: string): Promise<Note> {
  const l = await locate(o, noteId);
  const m = l.note.manifest;
  if (!l.mine) throw new ForbiddenError('Only the organizer can have the notes written again.', { context: { noteId } });
  if (m.status === 'recording') throw new ConflictError('The notes are written once the recording stops.', { context: { noteId } });
  const roomLines = m.rooms.flatMap((r) => r.transcript);
  if (!m.transcript?.length && !roomLines.length) throw new ConflictError('Nothing was said while notes were on, so there’s nothing to write from.', { context: { noteId } });
  if (m.status === 'ready') {
    const again = await tx(o.pool, async (c) => {
      // Holding the note while its job is looked for, so two asks at once queue one job.
      await lockItem(o, c, noteId);
      if (await jobOf(o, c, noteId)) return false;
      await queueNotes(o, c, noteId, m.recordingId);
      return true;
    });
    if (again) {
      const all = [...(m.transcript ?? []), ...roomLines];
      nlog.info('notes job queued', { noteId, recordingId: m.recordingId, lines: m.transcript?.length ?? 0, roomLines: roomLines.length, again: true, corrected: all.filter((x) => x.changes?.length).length });
    }
  }
  return get(o, noteId);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/**
 * Shares the notes with more people: by address, or with one of the sharer's groups (its addresses,
 * and its name for everyone it reaches to see). Anyone who has the notes can share them on. People
 * who have them already are skipped; someone who removed them gets them again.
 */
export async function share(o: Owner, id: string, to: { emails: string[]; group?: string | undefined }): Promise<Note> {
  const { owner, note } = await locate(o, id);
  if (note.manifest.status === 'recording') throw new ValidationError('These notes can be shared once the call ends.', { context: { noteId: id } });
  const wanted = [...new Set(to.emails.map((e) => e.trim().toLowerCase()))];
  if (!wanted.length || wanted.some((e) => !EMAIL.test(e))) throw new ValidationError('Share by full email address.', { context: { noteId: id, emails: wanted.length } });
  const sharer = await profile(o);
  const by: Sharer = { id: o.ownerId, name: sharer.name, email: sharer.email };
  const organizer = owner.ownerId === o.ownerId ? sharer.email : (await profile(owner)).email;
  const at = new Date().toISOString();
  const added = await tx(owner.pool, async (c) => {
    // Who has the notes, read under the note's lock: two shares at once can't both add someone.
    await lockItem(owner, c, id);
    const holding = await holders(owner, c, id);
    const fresh = new Set(wanted.filter((e) => !same(e, organizer) && !holding.has(b64u(emailIndex(owner, e)))));
    if (!fresh.size) return 0;
    const given = [...fresh].map((email): SharedWith => ({ email, by, ...(to.group ? { group: to.group } : {}), at }));
    // Someone given the notes again, after removing them, is listed once: as they have them now.
    await updateNote(owner, c, id, (n) => ({ ...n, shared: [...n.shared.filter((s) => !fresh.has(s.email)), ...given] }));
    await grant(owner, c, id, [...fresh], 'shared');
    return fresh.size;
  });
  nlog.info('notes shared', { noteId: id, asked: wanted.length, added, toGroup: to.group !== undefined, byOrganizer: owner.ownerId === o.ownerId });
  return get(o, id);
}

/**
 * Deletes your own note for everyone (deleteOwnNote), its audio and shared-screen objects after the
 * commit, and your pin to it. Someone else's note is only removed from your notes, with your own notes
 * on it: they can quote it, and you no longer have it. What you added to the shared notes stays with them.
 */
export async function remove(o: Owner, id: string): Promise<void> {
  const l = await locate(o, id);
  if (!l.mine) {
    await tx(o.pool, async (c) => {
      await exec(c, 'DELETE FROM note_access WHERE owner_id = $1 AND note_item_id = $2 AND email_index = $3', [l.owner.ownerId, id, emailIndex(o, l.as)]);
      await personal.forget(c, o.ownerId, l.owner.ownerId, id);
    });
    await unpin(o, id);
    nlog.info('shared note removed from my notes', { noteId: id });
    return;
  }
  const { ids, frames } = await tx(o.pool, (c) => deleteOwnNote(o, c, id));
  await queueDelete(o, ids);
  await unpin(o, id);
  nlog.info('note deleted', { noteId: id, recordingId: l.note.manifest.recordingId, objects: ids.length, frames });
}

/**
 * Deletes one of this owner's notes for good, in the caller's transaction: every revision, its
 * recording and pieces, its shared-screen frames, its jobs, everyone's access, everyone's own notes on
 * it and what they added to it (both cascade from its row), the link from its meeting, and this
 * owner's operation receipts (which may hold copies of responses); stored bytes go
 * down to match. Returns the audio and frame objects, for the caller to delete once the transaction
 * commits (failures are retried by maintenance), and how many of them were frames. Deleting a whole
 * account deletes each of its notes this way.
 */
export async function deleteOwnNote(o: Owner, db: Db, id: string): Promise<{ ids: string[]; frames: number }> {
  // The note's row first, as the notes worker takes it: deleting while its notes are being written waits instead of deadlocking.
  await lockItem(o, db, id);
  const audio = await noteObjects(o, db, id);
  const shown = await screens.frameObjects(o, db, id);
  const bytes = audio.bytes + shown.bytes;
  await exec(db, `DELETE FROM content_jobs WHERE owner_id = $1 AND revision_id IN (SELECT revision_id FROM revisions WHERE owner_id = $1 AND item_id = $2)`, [o.ownerId, id]);
  for (const m of (await listItems(o, db, 'meeting', MeetingManifest)).filter((x) => x.manifest.noteId === id)) {
    const { noteId: _drop, ...rest } = m.manifest;
    void _drop;
    await saveRevision(o, db, m.itemId, m.revisionId, rest);
  }
  await exec(db, 'DELETE FROM items WHERE owner_id = $1 AND item_id = $2', [o.ownerId, id]);
  if (bytes) await exec(db, 'UPDATE owners SET stored_bytes = greatest(0, stored_bytes - $2), version = version + 1 WHERE owner_id = $1', [o.ownerId, bytes]);
  await exec(db, 'DELETE FROM operations WHERE owner_id = $1', [o.ownerId]);
  return { ids: [...audio.ids, ...shown.ids], frames: shown.ids.length };
}
