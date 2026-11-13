/*
 * A note as it's stored: its sealed manifest, made with its recording when a call or a room recording starts, changed
 * under its item's lock, and finished when the recording stops, which queues writing its notes (docs: notes-and-inference ›
 * The notes worker). Everyone it's given to by address has a `note_access` row, found by a keyed hash.
 */
import {
  isAcceptedFollowUp, ActionItemSchema, CaptureGapSchema, ChangerSchema, ChapterSchema, DecisionSchema, InferenceEvidenceSchema, ModelIdSchema, NoteKindSchema, NoteStatusSchema, QuestionSchema,
  RoomNoteSchema, ScreenMomentSchema, TranscriptLineSchema, UnencryptedUseSchema, type ActionItem, type CaptureGap, type Chapter, type Decision, type NoteKind, type RoomNote, type RoomRef,
  type Speaker
} from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../../platform/context';
import { blindIndex, id128, sealJson, stateKey, toJson, type RecordHeader } from '../../keys/crypto';
import { exec, tx, type Db } from '../../platform/db';
import { type ChatModel } from '../../inference/inference';
import { log } from '../../platform/log';
import { indexKey } from '../../keys/owners';
import { createItem, getItem, lockItem, saveRevision } from '../../keys/vault';
import { carryModel } from '../profile/carry-model';
import { purgeAudio, segments } from '../recordings/audio';
import { WorkedDocument } from '../workspaces/worked';
import { HeldRooms } from './held-rooms';
import { Ticked } from './ticked';
import * as personal from './personal/personal';
import { nameOf, personOf } from '../profile/portraits';
import * as screens from '../recordings/screens/screens';
import * as transcripts from '../recordings/transcripts';

const nlog = log.child({ component: 'notes' });

/** The rooms a call held, as chapters of its notes: when they opened, and who was in which room, a guest by name only. */
export function roomChapters(held: HeldRooms[]): Chapter[] {
  return held.map((h) => {
    const minutes = Math.max(1, Math.round((h.to - h.from) / 60));
    const names = (r: HeldRooms['rooms'][number]) => [...r.emails.map((e) => nameOf(personOf(e))), ...r.guests.map((g) => g.name)];
    const who = h.rooms.map((r) => `${r.name}: ${names(r).join(', ') || 'nobody'}`).join('. ');
    const summary = `${who}. ${minutes} min.`;
    return { at: Math.max(0, Math.round(h.from)), title: `${h.rooms.length} breakout rooms`, summary: summary.length > 160 ? `${summary.slice(0, 159).trimEnd()}…` : summary };
  });
}

/** Who shared a note on: their account, and their name and address as they were when they shared it. */
export const Sharer = z.object({ id: z.string(), name: z.string(), email: z.string() });
export type Sharer = z.infer<typeof Sharer>;
/**
 * Someone a note was shared with after the call: their address, who shared it, the name of the
 * sharer's group it went to (nothing else about the group leaves the sharer's profile), and when.
 * `link`: they opened a link the sharer made, rather than being given it by their address; false on
 * shares from before links, which were all by address.
 */
export const SharedWith = z.object({ email: z.string(), by: Sharer, group: z.string().optional(), at: z.string(), link: z.boolean().default(false) });
export type SharedWith = z.infer<typeof SharedWith>;

/** What a call's notes keep of what they were written from: without the transcript it's deleted once they're written, and without the recording when the call ends. */
export const NoteKeep = z.object({ transcript: z.boolean(), recording: z.boolean() });
export type NoteKeep = z.infer<typeof NoteKeep>;
/** What a note keeps unless its call was set otherwise: a room recording, and every note from before these choices. */
const KEEP_ALL: NoteKeep = { transcript: true, recording: true };

/**
 * Where this call came back to something an earlier call in its series left standing, as the notes model read it: a
 * decision it replaced (`by`, this note's own decision) or a question it answered (`at`, seconds into this recording,
 * and `room`, the breakout room it was answered in). It names the earlier note and its item by their random IDs and
 * says nothing of what they said. It's only ever a suggestion, and it lives here, in the later note: someone who has
 * only the earlier call's notes learns nothing from this one, and it goes when this note does. `dismissed`: someone
 * who has both said the notes got it wrong, and writing them again doesn't bring it back.
 */
export const Revisit = z.object({
  id: z.string(), kind: z.enum(['replaced', 'answered']), noteId: z.string(), itemId: z.string(),
  by: z.string().optional(), at: z.number().optional(), room: z.string().optional(),
  dismissed: z.object({ by: ChangerSchema, at: z.string() }).nullable().default(null)
});
export type Revisit = z.infer<typeof Revisit>;

export const NoteManifest = z.preprocess(carryModel, z.object({
  kind: NoteKindSchema, title: z.string(), startedAt: z.string(), duration: z.number(),
  meetingId: z.string().optional(), recordingId: z.string(), status: NoteStatusSchema,
  /** Email addresses of everyone invited to the call, who get the notes when it ends. */
  invited: z.array(z.string()),
  /** When the call ended or the recording stopped, which is when everyone invited got the notes. */
  endedAt: z.string().optional(),
  /** Everyone the notes were shared with afterwards, in the order they got them. */
  shared: z.array(SharedWith),
  summary: z.string(), decisions: z.array(DecisionSchema), questions: z.array(QuestionSchema), actions: z.array(ActionItemSchema), chapters: z.array(ChapterSchema),
  /** The full summary (Note.details), written after the notes; empty on a note written before it was. */
  details: z.string().default(''),
  /** The stretches of the call nothing was captured in (notes off or paused), where they fall in the recording. */
  gaps: z.array(CaptureGapSchema),
  /** What was on shared screens kept for the notes: each frame kept (its image is in screen_frames), read and described once the notes are written. */
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
  inference: z.array(InferenceEvidenceSchema),
  /** What the notes keep, as the call was set when they started. */
  keep: NoteKeep.default(KEEP_ALL),
  /**
   * Seconds of audio recorded, saved when the recording stops: what the notes are billed for, whether or not the audio
   * is kept. Null until then, and on a note stopped before this was saved, whose audio is all still there to count.
   */
  recorded: z.number().nullable().default(null),
  /**
   * Each segment's seconds of audio, by segment index, saved when the recording stops, so shared screens keep their
   * place once audio the call didn't keep is deleted. Empty in a note stored before.
   */
  segmentSeconds: z.array(z.number()).default([]),
  /** What this call came back to from earlier calls in its series, once the notes are written. */
  revisits: z.array(Revisit).default([]),
  /**
   * Follow-ups ticked during the call, waiting for the notes they go in: each is done in the call's notes or its room's
   * when those are written (liveNotes.doneInNotes), and leaves this list then. Empty in a note stored before calls kept them.
   */
  ticked: z.array(Ticked).default([]),
  /** What was worked on in the call, and by whom: only IDs and who, read for each person by what they can open. Empty in a note stored before calls kept it. */
  workedOn: z.array(WorkedDocument).default([]),
  /** The model for these notes (the organizer's choice in the call, or when writing them again), or null for the default model. */
  model: ModelIdSchema.nullable().default(null),
  /** Every time a model outside a secure enclave was sent something for these notes. */
  unencrypted: z.array(UnencryptedUseSchema).default([])
}));
export type NoteManifest = z.infer<typeof NoteManifest>;

/** Persist disclosure before content leaves for an unencrypted model, even when its request fails or the model changes. */
export async function recordUnencryptedUse(o: Owner, noteId: string, via: ChatModel): Promise<void> {
  if (via.private) return;
  await tx(o.pool, (c) => updateNote(o, c, noteId, (n) => n.unencrypted.some((u) => u.model === via.model && u.task === 'notes') ? n : {
    ...n, unencrypted: [...n.unencrypted, { model: via.model, task: 'notes', at: new Date().toISOString() }]
  }));
}
/** A note's follow-ups: the call's, then each breakout room's. */
export const allActionsOf = (m: NoteManifest): ActionItem[] => [...m.actions, ...m.rooms.flatMap((r) => r.actions)];
export const actionsOf = (m: NoteManifest): ActionItem[] => allActionsOf(m).filter(isAcceptedFollowUp);
/** A note's decisions: the call's, then each breakout room's. */
export const decisionsOf = (m: NoteManifest): Decision[] => [...m.decisions, ...m.rooms.flatMap((r) => r.decisions)];
/** The parts of a note people settle: the call's own, then each breakout room's section, by name. */
export const partsOf = (m: NoteManifest): (Pick<NoteManifest, 'decisions' | 'questions' | 'actions'> & { room?: RoomRef })[] =>
  [{ decisions: m.decisions, questions: m.questions, actions: m.actions }, ...m.rooms.map((r) => ({ room: { id: r.id, name: r.name }, decisions: r.decisions, questions: r.questions, actions: r.actions }))];
/**
 * Everyone a note has gone to, by address: its organizer's (`organizer`), everyone invited, and everyone it's been shared with
 * since. What one summary reads, and what the note says everyone can open, goes by all of them.
 */
export const everyoneWith = (m: Pick<NoteManifest, 'invited' | 'shared'>, organizer: string): string[] => [organizer, ...m.invited, ...m.shared.map((s) => s.email)];

/** A note about to be recorded, starting when its recording does. */
export function blankNote(o: { kind: NoteKind; title: string; startedAt: Date; recordingId: string; invited: string[]; meetingId?: string | undefined; keep?: NoteKeep | undefined }): NoteManifest {
  return {
    kind: o.kind, title: o.title, startedAt: o.startedAt.toISOString(), duration: 0, recordingId: o.recordingId,
    ...(o.meetingId ? { meetingId: o.meetingId } : {}), invited: o.invited, shared: [],
    status: 'recording', summary: '', details: '', decisions: [], questions: [], actions: [], chapters: [], gaps: [], screens: [], transcript: null, rooms: [], suggestedQuestions: [], writtenAt: null, workedOn: [],
    breakouts: [], inference: [], keep: o.keep ?? KEEP_ALL, recorded: null, segmentSeconds: [], revisits: [], ticked: [], model: null, unencrypted: []
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

export const emailIndex = (o: Owner, email: string) => blindIndex(indexKey(o), 'email', email);
export const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
export async function grant(o: Owner, db: Db, noteId: string, emails: string[], role: 'invited' | 'shared'): Promise<void> {
  for (const e of emails) {
    await exec(db, 'INSERT INTO note_access (owner_id, note_item_id, email_index, role) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [o.ownerId, noteId, emailIndex(o, e), role]);
  }
}

/** A breakout room the call held, for its section of the note: who was in it, when (seconds into the recording) and its gaps. */
export interface HeldRoom { id: string; name: string; people: Speaker[]; from: number; to: number; gaps: CaptureGap[] }

/**
 * The recording is complete: its live transcript moves into the note, the main room's lines into the transcript and
 * each breakout room's into that room's section (`rooms`), with the stretches nothing was captured in, what was on
 * shared screens' video kept, the model the organizer chose (`model`), the follow-ups ticked during the call, and the
 * ones people added (`added`), which are theirs in the note from now on, whatever becomes of the notes. Everyone invited
 * gets the note, and it's queued for the notes service (features/notes/writing/writer.ts), which writes each room's notes too.
 * Runs in the stopping transaction, once the recording has stopped. A call set not to keep its recording loses its audio
 * here, after everything worked out from it (where lines fall, the seconds billed, and each segment's length) is in the note. Returns the
 * objects to delete once that transaction commits.
 */
export async function finishRecording(o: Owner, db: Db, noteId: string, durationSeconds: number, breakouts: HeldRooms[] = [],
  speakerOf?: ((identity: string) => Speaker | undefined) | undefined, gaps: CaptureGap[] = [], rooms: HeldRoom[] = [], ticked: Ticked[] = [], workedOn: WorkedDocument[] = [], added: { room: string | null; action: ActionItem }[] = [], model: string | null = null): Promise<string[]> {
  const { recordingId } = (await getItem(o, db, 'note', noteId, NoteManifest, 'Those notes')).manifest;
  const audio = await segments(o, recordingId, db);
  // Each line stays inside its own segment of the recording, so nothing said before a pause comes after it.
  const all = transcripts.placed(await transcripts.lines(o, db, noteId), audio);
  const heard = all.filter((l) => l.room === undefined);
  const lineAt = new Map(transcripts.spoken(all, speakerOf).map((l) => [l.id, l.at]));
  const carried = added.map((a) => {
    const first = a.action.lines.find((id) => lineAt.has(id));
    const at = first === undefined ? undefined : lineAt.get(first);
    return { ...a, action: { ...a.action, ...(at === undefined ? {} : { at }) } };
  });
  // In a call, each line keeps whoever said it; a room recording names nobody.
  const sections: RoomNote[] = rooms.map((r) => ({
    id: r.id, name: r.name, people: r.people, from: r.from, to: r.to, gaps: r.gaps,
    summary: '', decisions: [], questions: [], actions: carried.flatMap((a) => (a.room === r.id ? [a.action] : [])), chapters: [], transcript: transcripts.spoken(all.filter((l) => l.room === r.id), speakerOf)
  }));
  const heardBy = await transcripts.heardBy(o, db, noteId);
  const next = await updateNote(o, db, noteId, (n) => ({
    ...n, status: 'pending', endedAt: new Date().toISOString(), duration: Math.max(n.duration, durationSeconds), breakouts, gaps, model,
    recorded: audio.reduce((total, s) => total + s.seconds, 0),
    segmentSeconds: Array.from({ length: audio.reduce((n, s) => Math.max(n, s.index + 1), 0) }, (_, i) => audio.find((s) => s.index === i)?.seconds ?? 0),
    // In a call, each line keeps whoever said it; a room recording names nobody.
    transcript: transcripts.spoken(heard, speakerOf), rooms: sections, actions: [...n.actions, ...carried.flatMap((a) => (sections.some((r) => r.id === a.room) ? [] : [a.action]))],
    inference: heardBy, ticked, workedOn
  }));
  await transcripts.clear(o, db, noteId);
  await grant(o, db, noteId, next.invited, 'invited');
  await personal.dropUnheld(db, o.ownerId, noteId);
  await queueNotes(o, db, noteId, next.recordingId);
  nlog.info('notes job queued', {
    noteId, recordingId: next.recordingId, seconds: durationSeconds, lines: heard.length, invited: next.invited.length,
    rooms: sections.length, roomLines: sections.reduce((n, r) => n + r.transcript.length, 0), ticked: ticked.length, added: added.length
  });
  return next.keep.recording ? [] : purgeAudio(o, db, next.recordingId);
}

/**
 * A notes job, sealed: the note and its recording, the AI model the notes had before they were asked to be written again
 * (`was`: what stopping that, or failing it, goes back to; null when not known, as for first notes and a job queued by
 * the release before), and how far it has got with the shared screens (none until it starts on them).
 */
export const NotesJob = z.object({
  noteId: z.string(), recordingId: z.string(), was: z.object({ model: ModelIdSchema.nullable() }).nullable().default(null), screens: screens.ScreenProgressSchema.nullable().default(null)
});
export type NotesJob = z.infer<typeof NotesJob>;
export const jobKey = (o: Owner, noteId: string) => stateKey(o.root, o.ownerId, `job:${noteId}`);
export const jobHeader = (o: Owner, noteId: string): RecordHeader => ({ v: 1, kind: 'job', ownerId: o.ownerId, noteId });

/** Queues a note's notes for the notes service (features/notes/writing/writer.ts), for its head revision, in the caller's transaction. */
export async function queueNotes(o: Owner, db: Db, noteId: string, recordingId: string, was: NotesJob['was'] = null): Promise<void> {
  const head = await getItem(o, db, 'note', noteId, NoteManifest, 'Those notes');
  const job: NotesJob = { noteId, recordingId, was, screens: null };
  await exec(db, `INSERT INTO content_jobs (owner_id, job_id, revision_id, kind, state, attempt, job_ciphertext) VALUES ($1,$2,$3,'notes','queued',0,$4)
                  ON CONFLICT (owner_id, revision_id, kind) DO NOTHING`,
    [o.ownerId, id128(), head.revisionId, sealJson(jobKey(o, noteId), jobHeader(o, noteId), toJson(job))]);
}
