/*
 * Notes. A note lives in its organizer's vault. Everyone invited to its call gets it when the call
 * ends, and anyone who has it can share it on; who else may read it is kept in note_access as keyed
 * email hashes. Someone else's note is opened with its organizer's keys, and only after that check.
 */
import {
  ActionItemSchema, ChapterSchema, NoteKindSchema, NoteStatusSchema, ScreenCaptureSchema, TranscriptLineSchema,
  type Note, type NoteKind, type NoteProgress, type NoteSummary, type OpenAction, type Recipient
} from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../context';
import { blindIndex, id128, sealJson, stateKey, toJson } from '../crypto';
import { exec, maybeOne, rows, tx, type Db } from '../db';
import { NotFoundError, ValidationError, notFound } from '../errors';
import { log } from '../log';
import { masterKey, openOwner } from '../owners';
import { createItem, getItem, listItems, lockItem, saveRevision, type Loaded } from '../vault';
import { me, profile } from './account';
import { queueDelete, recordingObjects, segments } from './audio';
import { MeetingManifest } from './meetings';
import { personOf } from './portraits';

const nlog = log.child({ component: 'notes' });

export const NoteManifest = z.object({
  kind: NoteKindSchema, title: z.string(), startedAt: z.string(), duration: z.number(),
  meetingId: z.string().optional(), recordingId: z.string(), status: NoteStatusSchema,
  /** Email addresses of everyone invited to the call, who get the notes when it ends. */
  invited: z.array(z.string()),
  /** Email addresses the notes were shared with afterwards. */
  shared: z.array(z.string()),
  summary: z.string(), decisions: z.array(z.string()), actions: z.array(ActionItemSchema), chapters: z.array(ChapterSchema),
  screens: z.array(ScreenCaptureSchema), transcript: z.array(TranscriptLineSchema).nullable(), suggestedQuestions: z.array(z.string())
});
export type NoteManifest = z.infer<typeof NoteManifest>;

export function blankNote(o: { kind: NoteKind; title: string; recordingId: string; invited: string[]; meetingId?: string | undefined }): NoteManifest {
  return {
    kind: o.kind, title: o.title, startedAt: new Date().toISOString(), duration: 0, recordingId: o.recordingId,
    ...(o.meetingId ? { meetingId: o.meetingId } : {}), invited: o.invited, shared: [],
    status: 'recording', summary: '', decisions: [], actions: [], chapters: [], screens: [], transcript: null, suggestedQuestions: []
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
export async function updateNote(o: Owner, db: Db, noteId: string, fn: (n: NoteManifest) => NoteManifest): Promise<NoteManifest> {
  await lockItem(o, db, noteId);
  const cur = await getItem(o, db, 'note', noteId, NoteManifest, 'Those notes');
  const next = fn(cur.manifest);
  await saveRevision(o, db, noteId, cur.revisionId, next);
  return next;
}

const emailIndex = (o: Owner, email: string) => blindIndex(masterKey(o), 'email', email);
async function grant(o: Owner, db: Db, noteId: string, emails: string[], role: 'invited' | 'shared'): Promise<void> {
  for (const e of emails) {
    await exec(db, 'INSERT INTO note_access (owner_id, note_item_id, email_index, role) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [o.ownerId, noteId, emailIndex(o, e), role]);
  }
}

/** The recording is complete: everyone invited gets the note, and it's queued for the notes service. */
export async function finishRecording(o: Owner, db: Db, noteId: string, durationSeconds: number): Promise<void> {
  const next = await updateNote(o, db, noteId, (n) => ({ ...n, status: 'pending', duration: Math.max(n.duration, durationSeconds) }));
  await grant(o, db, noteId, next.invited, 'invited');
  const head = await getItem(o, db, 'note', noteId, NoteManifest, 'Those notes');
  const job = { noteId, recordingId: next.recordingId };
  await exec(db, `INSERT INTO content_jobs (owner_id, job_id, revision_id, kind, state, attempt, job_ciphertext) VALUES ($1,$2,$3,'notes','awaiting_inference',0,$4)
                  ON CONFLICT (owner_id, revision_id, kind) DO NOTHING`,
    [o.ownerId, id128(), head.revisionId, sealJson(stateKey(o.root, o.ownerId, `job:${noteId}`), { v: 1, kind: 'job', ownerId: o.ownerId, noteId }, toJson(job))]);
  nlog.info('notes job queued', { noteId, recordingId: next.recordingId, seconds: durationSeconds, invited: next.invited.length });
}

/* ---------- finding a note: your own, or one you have access to ---------- */

/** A note, the vault it lives in, and whether that vault is yours. */
interface Located { owner: Owner; note: Loaded<NoteManifest>; mine: boolean }
const AccessRow = z.object({ owner_id: z.string(), note_item_id: z.string() });

async function myIndex(o: Owner): Promise<Uint8Array> { return emailIndex(o, (await profile(o)).email); }

async function sharedWithMe(o: Owner): Promise<Located[]> {
  const access = await rows(o.pool, AccessRow, 'SELECT owner_id, note_item_id FROM note_access WHERE email_index = $1 AND owner_id <> $2', [await myIndex(o), o.ownerId]);
  const out: Located[] = [];
  for (const a of access) {
    const owner = await openOwner(o, a.owner_id, undefined);
    out.push({ owner, note: await getItem(owner, owner.pool, 'note', a.note_item_id, NoteManifest, 'Those notes'), mine: false });
  }
  return out;
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
export async function get(o: Owner, id: string): Promise<Note> {
  const l = await locate(o, id);
  const m = l.note.manifest;
  return {
    ...(await summary(l)), recipients: await recipients(l.owner, m), summary: m.summary, decisions: m.decisions, actions: m.actions, chapters: m.chapters,
    screens: m.screens, transcript: m.transcript, suggestedQuestions: m.suggestedQuestions, audio: await segments(l.owner, m.recordingId)
  };
}
/** The vault and recording to stream a note's audio from, after the access check. */
export async function audioSource(o: Owner, id: string): Promise<{ owner: Owner; recordingId: string }> {
  const l = await locate(o, id);
  return { owner: l.owner, recordingId: l.note.manifest.recordingId };
}
export async function progress(o: Owner, id: string): Promise<NoteProgress> {
  const n = await get(o, id);
  const pieces = n.audio.reduce((s, a) => s + a.pieces, 0);
  return {
    noteId: id, title: n.title, ready: n.status !== 'recording',
    steps: [
      { label: n.kind === 'room' ? 'Recording stopped' : 'Call ended', done: n.status !== 'recording' },
      { label: pieces ? `${pieces} encrypted audio ${pieces === 1 ? 'piece' : 'pieces'} saved` : 'No audio was recorded', done: n.status !== 'recording' },
      { label: 'Queued for the notes service', done: n.status !== 'recording' },
      { label: n.status === 'ready' ? 'Notes written' : 'Waiting for the notes service to be connected', done: n.status === 'ready' }
    ]
  };
}
export async function openActions(o: Owner): Promise<OpenAction[]> {
  return (await listItems(o, o.pool, 'note', NoteManifest)).flatMap((n) => n.manifest.actions.filter((a) => !a.done).map((a) => ({ ...a, noteId: n.itemId, noteTitle: n.manifest.title })));
}
/** Ticks a follow-up. Everyone with the note sees the same list. */
export async function setActionDone(o: Owner, noteId: string, actionId: string, done: boolean): Promise<void> {
  const { owner } = await locate(o, noteId);
  await tx(owner.pool, (c) => updateNote(owner, c, noteId, (n) => {
    if (!n.actions.some((a) => a.id === actionId)) throw new NotFoundError('That follow-up doesn’t exist.', { context: { noteId, actionId } });
    return { ...n, actions: n.actions.map((a) => (a.id === actionId ? { ...a, done } : a)) };
  }));
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
