/*
 * Notes. A note lives in its organizer's vault. Everyone invited to its call gets it when the call
 * ends, and anyone who has it can share it on; who else may read it is kept in note_access as keyed
 * email hashes. Someone else's note is opened with its organizer's keys, and only after that check.
 */
import {
  ActionItemSchema, ChapterSchema, DecisionSchema, InferenceEvidenceSchema, NoteKindSchema, NoteStatusSchema, QuestionSchema, ScreenCaptureSchema, TranscriptLineSchema, minutesLabel,
  type ActionItem, type ActionPatch, type AnswerPart, type Change, type Chapter, type Decision, type DecisionPatch, type Note, type NoteKind, type NoteProgress,
  type NoteSummary, type OpenAction, type Question, type QuestionPatch, type Recipient
} from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../context';
import { blindIndex, id128, sealJson, stateKey, toJson } from '../crypto';
import { exec, maybeOne, rows, tx, type Db } from '../db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, notFound } from '../errors';
import { inference } from '../inference';
import { nameFrom } from '../identity';
import { log } from '../log';
import { masterKey, openOwner } from '../owners';
import { createItem, findItem, getItem, listItems, lockItem, saveRevision, type Loaded } from '../vault';
import { me, profile } from './account';
import { queueDelete, recordingObjects, segments } from './audio';
import { answer, briefOf } from './drafting';
import { MeetingManifest } from './meetings';
import { personOf } from './portraits';
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
    const who = h.rooms.map((r) => `${r.name}: ${r.emails.length ? r.emails.map((e) => { const p = personOf(e); return p.name === p.email ? nameFrom(e) : p.name; }).join(', ') : 'nobody invited'}`).join('. ');
    const summary = `${who}. ${minutes} min.`;
    return { at: Math.max(0, Math.round(h.from)), title: `${h.rooms.length} breakout rooms`, summary: summary.length > 160 ? `${summary.slice(0, 159).trimEnd()}…` : summary };
  });
}

export const NoteManifest = z.object({
  kind: NoteKindSchema, title: z.string(), startedAt: z.string(), duration: z.number(),
  meetingId: z.string().optional(), recordingId: z.string(), status: NoteStatusSchema,
  /** Email addresses of everyone invited to the call, who get the notes when it ends. */
  invited: z.array(z.string()),
  /** Email addresses the notes were shared with afterwards. */
  shared: z.array(z.string()),
  summary: z.string(), decisions: z.array(DecisionSchema), questions: z.array(QuestionSchema), actions: z.array(ActionItemSchema), chapters: z.array(ChapterSchema),
  screens: z.array(ScreenCaptureSchema), transcript: z.array(TranscriptLineSchema).nullable(), suggestedQuestions: z.array(z.string()),
  /** Breakout rooms the call held, in seconds into the recording, kept until the notes are written and merged into their chapters. */
  breakouts: z.array(HeldRooms),
  /** The verified models that transcribed the speech and wrote the notes, as they were checked. */
  inference: z.array(InferenceEvidenceSchema)
});
export type NoteManifest = z.infer<typeof NoteManifest>;

export function blankNote(o: { kind: NoteKind; title: string; recordingId: string; invited: string[]; meetingId?: string | undefined }): NoteManifest {
  return {
    kind: o.kind, title: o.title, startedAt: new Date().toISOString(), duration: 0, recordingId: o.recordingId,
    ...(o.meetingId ? { meetingId: o.meetingId } : {}), invited: o.invited, shared: [],
    status: 'recording', summary: '', decisions: [], questions: [], actions: [], chapters: [], screens: [], transcript: null, suggestedQuestions: [], breakouts: [], inference: []
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
async function grant(o: Owner, db: Db, noteId: string, emails: string[], role: 'invited' | 'shared'): Promise<void> {
  for (const e of emails) {
    await exec(db, 'INSERT INTO note_access (owner_id, note_item_id, email_index, role) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [o.ownerId, noteId, emailIndex(o, e), role]);
  }
}

/**
 * The recording is complete: its live transcript moves into the note, everyone invited gets the
 * note, and it's queued for the notes service (modules/writer.ts). Runs in the stopping transaction.
 */
export async function finishRecording(o: Owner, db: Db, noteId: string, durationSeconds: number, breakouts: HeldRooms[] = []): Promise<void> {
  const heard = await transcripts.lines(o, db, noteId);
  const heardBy = await transcripts.heardBy(o, db, noteId);
  const organizer = await me(o);
  const next = await updateNote(o, db, noteId, (n) => ({
    ...n, status: 'pending', duration: Math.max(n.duration, durationSeconds), breakouts,
    // Calls have one person in them today, so whoever's microphone it was spoke; a room has no one to name.
    transcript: transcripts.spoken(heard, n.kind === 'call' ? { name: organizer.name, person: organizer } : undefined),
    inference: heardBy
  }));
  await transcripts.clear(o, db, noteId);
  await grant(o, db, noteId, next.invited, 'invited');
  const head = await getItem(o, db, 'note', noteId, NoteManifest, 'Those notes');
  const job = { noteId, recordingId: next.recordingId };
  await exec(db, `INSERT INTO content_jobs (owner_id, job_id, revision_id, kind, state, attempt, job_ciphertext) VALUES ($1,$2,$3,'notes','queued',0,$4)
                  ON CONFLICT (owner_id, revision_id, kind) DO NOTHING`,
    [o.ownerId, id128(), head.revisionId, sealJson(stateKey(o.root, o.ownerId, `job:${noteId}`), { v: 1, kind: 'job', ownerId: o.ownerId, noteId }, toJson(job))]);
  nlog.info('notes job queued', { noteId, recordingId: next.recordingId, seconds: durationSeconds, lines: heard.length, invited: next.invited.length });
}

/* ---------- finding a note: your own, or one you have access to ---------- */

/** A note, the vault it lives in, and whether that vault is yours. */
export interface Located { owner: Owner; note: Loaded<NoteManifest>; mine: boolean }
const AccessRow = z.object({ owner_id: z.string(), note_item_id: z.string() });

async function myIndex(o: Owner): Promise<Uint8Array> { return emailIndex(o, (await profile(o)).email); }

/**
 * Every note someone else gave you, by invitation or by sharing it with you: each found by your
 * email's index right now. Each organizer's keys are opened once, however many of their notes you have.
 */
export async function sharedWithMe(o: Owner): Promise<Located[]> {
  const access = await rows(o.pool, AccessRow, 'SELECT owner_id, note_item_id FROM note_access WHERE email_index = $1 AND owner_id <> $2', [await myIndex(o), o.ownerId]);
  const owners = new Map<string, Owner>();
  const out: Located[] = [];
  for (const a of access) {
    const owner = owners.get(a.owner_id) ?? await openOwner(o, a.owner_id, undefined);
    owners.set(a.owner_id, owner);
    // Deleted since its access row was read: it's gone, not an error.
    const note = await findItem(owner, owner.pool, 'note', a.note_item_id, NoteManifest);
    if (note) out.push({ owner, note, mine: false });
  }
  return out;
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
        WHERE a.email_index = $1`, [await myIndex(o), theirs.map((l) => l.owner.ownerId), theirs.map((l) => l.note.itemId)]))?.n ?? 0
    : 0;
  return found.length - ownLeft - givenLeft;
}
async function locate(o: Owner, id: string, db: Db = o.pool): Promise<Located> {
  const own = await maybeOne(db, z.object({ n: z.number() }), `SELECT 1 AS n FROM items WHERE owner_id = $1 AND item_id = $2 AND kind = 'note' AND deleted_at IS NULL`, [o.ownerId, id]);
  if (own) return { owner: o, note: await getItem(o, db, 'note', id, NoteManifest, 'Those notes'), mine: true };
  const a = await maybeOne(db, AccessRow, 'SELECT owner_id, note_item_id FROM note_access WHERE note_item_id = $1 AND email_index = $2', [id, await myIndex(o)]);
  if (!a) throw notFound('Those notes', { noteId: id });
  const owner = await openOwner(o, a.owner_id, undefined, db);
  return { owner, note: await getItem(owner, db, 'note', id, NoteManifest, 'Those notes'), mine: false };
}

async function recipients(owner: Owner, m: NoteManifest): Promise<Recipient[]> {
  return [
    { person: await me(owner), role: 'organizer' },
    ...m.invited.map((e): Recipient => ({ person: personOf(e), role: 'invited' })),
    ...m.shared.map((e): Recipient => ({ person: personOf(e), role: 'shared' }))
  ];
}

async function summary(l: Located): Promise<NoteSummary> {
  const m = l.note.manifest;
  const organizer = await me(l.owner);
  return {
    id: l.note.itemId, kind: m.kind, status: m.status, title: m.title, startedAt: m.startedAt, duration: m.duration,
    people: (await recipients(l.owner, m)).map((r) => r.person),
    excerpt: m.summary.split(/(?<=\.)\s/).slice(0, 2).join(' '),
    openActions: m.actions.filter((a) => !a.done).length, totalActions: m.actions.length,
    ...(m.meetingId && l.mine ? { meetingId: m.meetingId } : {}), ...(l.mine ? {} : { from: organizer })
  };
}

export async function list(o: Owner, q: { kind?: NoteKind | undefined; text?: string | undefined }): Promise<NoteSummary[]> {
  const text = q.text?.trim().toLowerCase();
  const own: Located[] = (await listItems(o, o.pool, 'note', NoteManifest)).map((note) => ({ owner: o, note, mine: true }));
  const all = [...own, ...await sharedWithMe(o)]
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
  const seriesId = await seriesOf(l);
  return {
    ...(await summary(l)), recipients: await recipients(l.owner, m), summary: m.summary, decisions: m.decisions, questions: m.questions, actions: m.actions, chapters: m.chapters,
    screens: m.screens, transcript: m.transcript, suggestedQuestions: m.suggestedQuestions, audio: await segments(l.owner, m.recordingId), inference: m.inference, ...(seriesId ? { seriesId } : {})
  };
}
/** The vault and recording to stream a note's audio from, after the access check. */
export async function audioSource(o: Owner, id: string): Promise<{ owner: Owner; recordingId: string }> {
  const l = await locate(o, id);
  return { owner: l.owner, recordingId: l.note.manifest.recordingId };
}
/** Where a note is on its way to being written, step by step; `ready` once the notes are written. */
export async function progress(o: Owner, id: string): Promise<NoteProgress> {
  const { owner, note } = await locate(o, id);
  const m = note.manifest;
  const stopped = m.status !== 'recording';
  const seconds = (await segments(owner, m.recordingId)).reduce((s, a) => s + a.seconds, 0);
  const lines = m.transcript?.length ?? 0;
  const job = m.status === 'pending'
    ? await maybeOne(owner.pool, z.object({ state: z.string(), attempt: z.number() }), `SELECT state, attempt FROM content_jobs
        WHERE owner_id = $1 AND kind = 'notes' AND revision_id IN (SELECT revision_id FROM revisions WHERE owner_id = $1 AND item_id = $2)`, [owner.ownerId, id])
    : undefined;
  const writing = !inference(o.cfg).configured ? 'Waiting for the notes service to be connected'
    : job?.state === 'writing' ? 'Writing the summary, decisions and follow-ups'
      : job?.state === 'waiting' ? 'Waiting for the notes model. The notes are written as soon as it’s verified and answering'
        : job && job.attempt > 0 ? 'The notes service is busy. Trying again shortly'
          : 'Queued for the notes service';
  return {
    noteId: id, title: m.title, ready: m.status === 'ready',
    steps: [
      { label: m.kind === 'room' ? 'Recording stopped' : 'Call ended', done: stopped },
      { label: seconds ? `${minutesLabel(seconds)} of audio saved, encrypted` : 'No audio was recorded', done: stopped },
      { label: !stopped ? 'Transcribing as it goes' : lines ? `Transcript of ${lines} ${lines === 1 ? 'line' : 'lines'}` : 'Nothing was transcribed', done: stopped },
      { label: m.status === 'ready' ? 'Notes written' : writing, done: m.status === 'ready' }
    ]
  };
}

/**
 * Answers a question about written notes from their transcript, for anyone who has them. The answer
 * goes only if they still have the notes once it's written: it may quote them.
 */
export async function ask(o: Owner, id: string, question: string): Promise<AnswerPart[]> {
  const l = await locate(o, id);
  const { owner, note } = l;
  const m = note.manifest;
  if (m.status !== 'ready') throw new ConflictError('You can ask about a call once its notes are written.', { context: { noteId: id, status: m.status } });
  if (!m.transcript?.length) throw new ConflictError('Nothing was said while notes were on, so there’s nothing to ask about.', { context: { noteId: id } });
  const t0 = performance.now();
  const parts = await answer(o.cfg, briefOf(m, await me(owner), m.invited.map((e) => personOf(e))), await me(o), question);
  const ms = Math.round(performance.now() - t0);
  if (await goneSince(o, [l])) {
    throw new ConflictError('These notes were deleted or removed from yours while the answer was being written, so it isn’t shown.', { context: { noteId: id, mine: l.mine, ms } });
  }
  nlog.info('question answered', { noteId: id, mine: l.mine, cites: parts.length - 1, ms });
  return parts;
}
export async function openActions(o: Owner): Promise<OpenAction[]> {
  return (await listItems(o, o.pool, 'note', NoteManifest)).flatMap((n) => n.manifest.actions.filter((a) => !a.done).map((a) => ({ ...a, noteId: n.itemId, noteTitle: n.manifest.title })));
}
/* ---------- confirming what the notes say ---------- */

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

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
 * confirmed one no longer holds. Anyone who has the notes can, and everyone sees who did.
 */
export async function updateDecision(o: Owner, noteId: string, decisionId: string, patch: DecisionPatch): Promise<Note> {
  const { owner, by, at } = await writtenNote(o, noteId);
  let made: Change['what'][] = [];
  await tx(owner.pool, (c) => updateNote(owner, c, noteId, (n) => {
    const d = n.decisions.find((x) => x.id === decisionId);
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
    return made.length ? { ...n, decisions: n.decisions.map((x) => (x.id === decisionId ? { ...next, changes } : x)) } : n;
  }));
  nlog.info('decision changed', { noteId, decisionId, changes: made.join(',') || 'none', mine: owner.ownerId === o.ownerId });
  return get(o, noteId);
}

/** Says an open question was answered, opens it again, or rewords it. Anyone who has the notes can, and everyone sees who did. */
export async function updateQuestion(o: Owner, noteId: string, questionId: string, patch: QuestionPatch): Promise<Note> {
  const { owner, by, at } = await writtenNote(o, noteId);
  let made: Change['what'][] = [];
  await tx(owner.pool, (c) => updateNote(owner, c, noteId, (n) => {
    const q = n.questions.find((x) => x.id === questionId);
    if (!q) throw new NotFoundError('That question doesn’t exist.', { context: { noteId, questionId } });
    const changes = [...q.changes];
    let next: Question = q;
    if (patch.text !== undefined && patch.text !== q.text) { changes.push({ by, at, what: 'reworded', before: q.text, after: patch.text }); next = { ...next, text: patch.text }; }
    if (patch.state !== undefined && patch.state !== q.state) { changes.push({ by, at, what: patch.state === 'answered' ? 'answered' : 'reopened' }); next = { ...next, state: patch.state }; }
    made = changes.slice(q.changes.length).map((x) => x.what);
    return made.length ? { ...n, questions: n.questions.map((x) => (x.id === questionId ? { ...next, changes } : x)) } : n;
  }));
  nlog.info('question changed', { noteId, questionId, changes: made.join(',') || 'none', mine: owner.ownerId === o.ownerId });
  return get(o, noteId);
}

/**
 * Changes a follow-up. Anyone who has the notes can give it to someone who has them too, reword it,
 * date it or tick it. Only the person it's for can take it on: the notes only ever suggest.
 */
export async function updateAction(o: Owner, noteId: string, actionId: string, patch: ActionPatch): Promise<Note> {
  const { owner, by, at } = await writtenNote(o, noteId);
  const organizer = await me(owner);
  let made: Change['what'][] = [];
  await tx(owner.pool, (c) => updateNote(owner, c, noteId, (n) => {
    const a = n.actions.find((x) => x.id === actionId);
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
      // Follow-ups go to people who have the notes, so whoever it's for can see it.
      if (![organizer.email, ...n.invited, ...n.shared].some((e) => same(e, email))) throw new ValidationError('Share the notes with them first: follow-ups go to people who have the notes.', { context: { noteId, actionId } });
      const person = same(email, organizer.email) ? organizer : personOf(email);
      // Someone Alcove knows only by their address goes by the name in it: "kofi@…" is Kofi.
      const name = person.name === person.email ? nameFrom(person.email) : person.name;
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
    return made.length ? { ...n, actions: n.actions.map((x) => (x.id === actionId ? { ...next, changes } : x)) } : n;
  }));
  nlog.info('follow-up changed', { noteId, actionId, changes: made.join(',') || 'none', mine: owner.ownerId === o.ownerId });
  return get(o, noteId);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Shares the notes with more people. Anyone who has the notes can share them on. */
export async function share(o: Owner, id: string, emails: string[]): Promise<Note> {
  const { owner, note } = await locate(o, id);
  if (note.manifest.status === 'recording') throw new ValidationError('These notes can be shared once the call ends.', { context: { noteId: id } });
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()))];
  if (!wanted.length || wanted.some((e) => !EMAIL.test(e))) throw new ValidationError('Share by full email address.', { context: { noteId: id, emails: wanted.length } });
  const organizer = (await profile(owner)).email;
  const added = await tx(owner.pool, async (c) => {
    let fresh: string[] = [];
    await updateNote(owner, c, id, (n) => {
      const has = new Set([organizer, ...n.invited, ...n.shared]);
      fresh = wanted.filter((e) => !has.has(e));
      return { ...n, shared: [...n.shared, ...fresh] };
    });
    await grant(owner, c, id, fresh, 'shared');
    return fresh.length;
  });
  nlog.info('notes shared', { noteId: id, added, byOrganizer: owner.ownerId === o.ownerId });
  return get(o, id);
}

/**
 * Deletes your own note for good: every revision, its recording and pieces, its jobs, everyone's
 * access, the link from its meeting, and this owner's operation receipts (which may hold copies of
 * responses). Objects are deleted after the commit; failures are retried by maintenance.
 * Someone else's note is only removed from your notes.
 */
export async function remove(o: Owner, id: string): Promise<void> {
  const l = await locate(o, id);
  if (!l.mine) {
    await exec(o.pool, 'DELETE FROM note_access WHERE owner_id = $1 AND note_item_id = $2 AND email_index = $3', [l.owner.ownerId, id, await myIndex(o)]);
    nlog.info('shared note removed from my notes', { noteId: id });
    return;
  }
  const recordingId = l.note.manifest.recordingId;
  const objects = await tx(o.pool, async (c) => {
    // The note's row first, as the notes worker takes it: deleting while its notes are being written waits instead of deadlocking.
    await lockItem(o, c, id);
    const objs = await recordingObjects(o, c, recordingId);
    await exec(c, `DELETE FROM content_jobs WHERE owner_id = $1 AND revision_id IN (SELECT revision_id FROM revisions WHERE owner_id = $1 AND item_id = $2)`, [o.ownerId, id]);
    for (const m of (await listItems(o, c, 'meeting', MeetingManifest)).filter((x) => x.manifest.noteId === id)) {
      const { noteId: _drop, ...rest } = m.manifest;
      void _drop;
      await saveRevision(o, c, m.itemId, m.revisionId, rest);
    }
    await exec(c, 'DELETE FROM items WHERE owner_id = $1 AND item_id = $2', [o.ownerId, id]);
    if (objs.bytes) await exec(c, 'UPDATE owners SET stored_bytes = greatest(0, stored_bytes - $2), version = version + 1 WHERE owner_id = $1', [o.ownerId, objs.bytes]);
    await exec(c, 'DELETE FROM operations WHERE owner_id = $1', [o.ownerId]);
    return objs.ids;
  });
  await queueDelete(o, objects);
  nlog.info('note deleted', { noteId: id, recordingId, objects: objects.length });
}
