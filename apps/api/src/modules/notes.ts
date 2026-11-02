import {
  ActionItemSchema, ChapterSchema, NoteKindSchema, NoteStatusSchema, NotesAudienceSchema, NotesKeepSchema, ScreenCaptureSchema, TranscriptLineSchema,
  type Note, type NoteKind, type NoteProgress, type NoteSummary, type NotesAudience, type NotesKeep, type OpenAction
} from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../context';
import { id128, sealJson, stateKey, toJson } from '../crypto';
import { exec, tx, type Db } from '../db';
import { ApiError } from '../errors';
import { createItem, getItem, listItems, lockItem, saveRevision, tombstone, type Loaded } from '../vault';
import { me } from './account';
import { deleteRecording, segments } from './audio';

export const NoteManifest = z.object({
  kind: NoteKindSchema, title: z.string(), startedAt: z.string(), duration: z.number(),
  meetingId: z.string().optional(), keep: NotesKeepSchema, audience: NotesAudienceSchema, recordingId: z.string(), status: NoteStatusSchema,
  summary: z.string(), decisions: z.array(z.string()), actions: z.array(ActionItemSchema), chapters: z.array(ChapterSchema),
  screens: z.array(ScreenCaptureSchema), transcript: z.array(TranscriptLineSchema).nullable(), suggestedQuestions: z.array(z.string())
});
export type NoteManifest = z.infer<typeof NoteManifest>;

export function blankNote(o: { kind: NoteKind; title: string; keep: NotesKeep; audience: NotesAudience; recordingId: string; meetingId?: string | undefined }): NoteManifest {
  return {
    kind: o.kind, title: o.title, startedAt: new Date().toISOString(), duration: 0, keep: o.keep, audience: o.audience, recordingId: o.recordingId,
    ...(o.meetingId ? { meetingId: o.meetingId } : {}),
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
/** The recording is complete: queue it for the notes service (which waits for inference to be connected). */
export async function finishRecording(o: Owner, db: Db, noteId: string, durationSeconds: number): Promise<void> {
  const next = await updateNote(o, db, noteId, (n) => ({ ...n, status: 'pending', duration: Math.max(n.duration, durationSeconds) }));
  const head = await getItem(o, db, 'note', noteId, NoteManifest, 'Those notes');
  const job = { noteId, recordingId: next.recordingId, keep: next.keep };
  await exec(db, `INSERT INTO content_jobs (owner_id, job_id, revision_id, kind, state, attempt, job_ciphertext) VALUES ($1,$2,$3,'notes','awaiting_inference',0,$4)
                  ON CONFLICT (owner_id, revision_id, kind) DO NOTHING`,
    [o.ownerId, id128(), head.revisionId, sealJson(stateKey(o.wrapKey, `job:${noteId}`), { v: 1, kind: 'job', ownerId: o.ownerId, noteId }, toJson(job))]);
}

const PENDING_EXCERPT = 'Recording saved and encrypted. Notes will be written once the notes service is connected.';
async function summary(o: Owner, n: Loaded<NoteManifest>): Promise<NoteSummary> {
  const m = n.manifest;
  return {
    id: n.itemId, kind: m.kind, status: m.status, title: m.title, startedAt: m.startedAt, duration: m.duration, people: [await me(o)],
    excerpt: m.summary ? m.summary.split(/(?<=\.)\s/).slice(0, 2).join(' ') : m.status === 'recording' ? 'Recording now.' : PENDING_EXCERPT,
    openActions: m.actions.filter((a) => !a.done).length, totalActions: m.actions.length, keep: m.keep, ...(m.meetingId ? { meetingId: m.meetingId } : {})
  };
}
export async function list(o: Owner, q: { kind?: NoteKind | undefined; text?: string | undefined }): Promise<NoteSummary[]> {
  const text = q.text?.trim().toLowerCase();
  const ns = (await listItems(o, o.pool, 'note', NoteManifest))
    .filter((n) => (!q.kind || n.manifest.kind === q.kind) && (!text || `${n.manifest.title} ${n.manifest.summary} ${(n.manifest.transcript ?? []).map((l) => l.text).join(' ')}`.toLowerCase().includes(text)));
  ns.sort((a, b) => b.manifest.startedAt.localeCompare(a.manifest.startedAt));
  return Promise.all(ns.map((n) => summary(o, n)));
}
export async function get(o: Owner, id: string): Promise<Note> {
  const n = await getItem(o, o.pool, 'note', id, NoteManifest, 'Those notes');
  const m = n.manifest;
  return { ...(await summary(o, n)), summary: m.summary, decisions: m.decisions, actions: m.actions, chapters: m.chapters, screens: m.screens, transcript: m.transcript, audience: m.audience, suggestedQuestions: m.suggestedQuestions, audio: await segments(o, m.recordingId) };
}
export async function recordingOf(o: Owner, id: string): Promise<string> {
  return (await getItem(o, o.pool, 'note', id, NoteManifest, 'Those notes')).manifest.recordingId;
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
export async function setActionDone(o: Owner, noteId: string, actionId: string, done: boolean): Promise<void> {
  await tx(o.pool, (c) => updateNote(o, c, noteId, (n) => {
    if (!n.actions.some((a) => a.id === actionId)) throw new ApiError('not-found', 'That action item doesn’t exist.');
    return { ...n, actions: n.actions.map((a) => (a.id === actionId ? { ...a, done } : a)) };
  }));
}
export async function remove(o: Owner, id: string): Promise<void> {
  const recordingId = await recordingOf(o, id);
  await tx(o.pool, (c) => tombstone(o, c, id));
  await deleteRecording(o, recordingId);
}
