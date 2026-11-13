/*
 * Notes. A note lives in its organizer's vault. Everyone invited to its call gets it when the call
 * ends, and anyone who has it can share it on, by address, with one of their groups, or by a link
 * whoever opens signed in (links.ts); the note keeps, sealed, who shared it with whom, the group's
 * name or that it was a link, and when. Who else may read it is kept in note_access as keyed email
 * hashes. Someone else's note is opened with its organizer's keys, and only after that check. Its organizer can also make
 * it visible to their team (`team_notes`): everyone live-licensed on that team reads it and asks about it, and changes
 * nothing (`locateToRead` finds it; `locate`, which everything that changes a note uses, refuses it).
 */
import {
  ACCEPTED_FOLLOW_UP, isAcceptedFollowUp, type FollowUpReview, ActionItemSchema, CaptureGapSchema, ChangerSchema, ChapterSchema, DecisionSchema, InferenceEvidenceSchema, ModelIdSchema, NoteKindSchema, NoteStatusSchema, QuestionSchema, RoomNoteSchema, ScreenMomentSchema, TranscriptLineSchema, UnencryptedUseSchema,
  isAssignee, isBy, isProposer, mayAssign, mayChangeAction, mayDecide, mayDispute, mayRewordDecision, maySayNotReplaced, minutesLabel, nameWords, searchOf, startsName, termsSaidIn,
  type ActionItem, type ActionPatch, type ActionProposal, type AnswerPart, type CaptureGap, type Change, type Chapter, type Decision, type DecisionPatch, type DecisionProposal, type GroupShare, type Inbox, type LinePatch,
  type Note, type NoteFound, type NoteKind, type NoteProgress, type NoteReader, type NoteSaid, type NoteSearch, type NoteSummary, type OpenAction, type PendingDecision, type Person, type Question, type QuestionPatch, type QuestionProposal, type Received, type Recipient, type RecipientRole,
  type RevisitPatch, type RoomNote, type RoomRef, type Speaker, type TranscriptLine
} from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../../context';
import { b64u, blindIndex, id128, openJson, sealJson, stateKey, toJson, type RecordHeader } from '../../crypto';
import { bytea, exec, maybeOne, rows, timestamp, tx, type Db } from '../../db';
import { ConflictError, ForbiddenError, InternalError, NotFoundError, ValidationError, notFound } from '../../errors';
import { inference, type ChatModel } from '../../inference';
import { log } from '../../log';
import { findOwner, indexKey } from '../../owners';
import { createItem, findItem, findItems, getItem, listItems, lockItem, saveRevision, type Loaded } from '../../vault';
import { me, profile, unpin } from '../account/account';
import { carryModel } from './carryModel';
import { resolveModel } from './models';
import * as additions from './additions';
import { noteObjects, purgeAudio, queueDelete, segments } from '../recordings/audio';
import { actionTarget } from './follow-up-proposals';
import { entriesOf } from './backing';
import { WorkedDocument } from '../calls/space-state';
import { answer, answerFromNotes, briefOf, type NoteBrief } from './drafting';
import { meterFor } from '../billing/meter';
import { HeldRooms } from '../calls/held-rooms';
import { Ticked } from '../calls/live-notes';
import { MeetingManifest } from '../meetings/service';
import * as personal from './personal';
import * as links from './links';
import { nameOf, personOf } from '../account/portraits';
import * as screens from '../recordings/screens';
import * as transcripts from '../recordings/transcripts';
import { workedOnFor } from './worked-on';
import { licensedOn, teamReaders } from '../billing/teams';
import { homeFor } from './home';

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
const Sharer = z.object({ id: z.string(), name: z.string(), email: z.string() });
type Sharer = z.infer<typeof Sharer>;
/**
 * Someone a note was shared with after the call: their address, who shared it, the name of the
 * sharer's group it went to (nothing else about the group leaves the sharer's profile), and when.
 * `link`: they opened a link the sharer made, rather than being given it by their address; false on
 * shares from before links, which were all by address.
 */
const SharedWith = z.object({ email: z.string(), by: Sharer, group: z.string().optional(), at: z.string(), link: z.boolean().default(false) });
type SharedWith = z.infer<typeof SharedWith>;

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
const allActionsOf = (m: NoteManifest): ActionItem[] => [...m.actions, ...m.rooms.flatMap((r) => r.actions)];
const actionsOf = (m: NoteManifest): ActionItem[] => allActionsOf(m).filter(isAcceptedFollowUp);
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

const emailIndex = (o: Owner, email: string) => blindIndex(indexKey(o), 'email', email);
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
 * each breakout room's into that room's section (`rooms`), with the stretches nothing was captured in, what was on
 * shared screens' video kept, the model the organizer chose (`model`), the follow-ups ticked during the call, and the
 * ones people added (`added`), which are theirs in the note from now on, whatever becomes of the notes. Everyone invited
 * gets the note, and it's queued for the notes service (features/notes/writer.ts), which writes each room's notes too.
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

/** Queues a note's notes for the notes service (features/notes/writer.ts), for its head revision, in the caller's transaction. */
async function queueNotes(o: Owner, db: Db, noteId: string, recordingId: string, was: NotesJob['was'] = null): Promise<void> {
  const head = await getItem(o, db, 'note', noteId, NoteManifest, 'Those notes');
  const job: NotesJob = { noteId, recordingId, was, screens: null };
  await exec(db, `INSERT INTO content_jobs (owner_id, job_id, revision_id, kind, state, attempt, job_ciphertext) VALUES ($1,$2,$3,'notes','queued',0,$4)
                  ON CONFLICT (owner_id, revision_id, kind) DO NOTHING`,
    [o.ownerId, id128(), head.revisionId, sealJson(jobKey(o, noteId), jobHeader(o, noteId), toJson(job))]);
}

/* ---------- finding a note: your own, or one you have access to ---------- */

/** A note and the vault it lives in: your own, or someone else's that you have under your address `as`. */
export type Located =
  | { owner: Owner; note: Loaded<NoteManifest>; mine: true }
  | { owner: Owner; note: Loaded<NoteManifest>; mine: false; as: string };
/**
 * Someone else's note its organizer made visible to the team the reader is live-licensed on (`teamId`), since `at`: it's
 * theirs to read and ask about, and nothing more (docs: Plans and usage › Team).
 */
export interface TeamLocated { owner: Owner; note: Loaded<NoteManifest>; mine: false; team: { teamId: string; at: string } }
/** A note as someone may read it: their own, given to them, or their team's. */
export type Seen = Located | TeamLocated;
const viaTeam = (l: Seen): l is TeamLocated => 'team' in l;
const AccessRow = z.object({ owner_id: z.string(), note_item_id: z.string() });
const TeamNoteRow = z.object({ owner_id: z.string(), note_item_id: z.string(), created_at: timestamp });
/** What every change to a note refuses someone who has it only through their team. */
export const TEAM_READS = 'This note is visible to your team to read and ask about. Only its organizer changes it.';

/**
 * A note as this person may read it. A transcript that's to be deleted once the notes are written is there to write
 * them from, for its organizer: everyone else gets the notes, and never reads it, by any path. That goes for the main
 * room's and every breakout room's, which any of them may still hold while its notes can't be written.
 */
export function asRead(l: Seen): NoteManifest {
  const m = l.note.manifest;
  return l.mine || m.keep.transcript ? m : { ...m, transcript: m.transcript === null ? null : [], rooms: m.rooms.map((r) => ({ ...r, transcript: [] })) };
}
/** Whether a note holds anything that was said, in the main room or any breakout room. */
const said = (m: NoteManifest): boolean => !!m.transcript?.length || m.rooms.some((r) => r.transcript.length > 0);

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
export async function goneSince(o: Owner, found: Seen[]): Promise<number> {
  const Count = z.object({ n: z.number() });
  const mine = found.filter((l) => l.mine).map((l) => l.note.itemId);
  const theirs = found.filter((l): l is Extract<Located, { mine: false }> => !l.mine && !viaTeam(l));
  const team = found.filter(viaTeam);
  // A team's note goes with the note, with its organizer making it not visible, or with the reader's license.
  const licensed = team.length ? await licensedOn(o.pool, o.ownerId) : null;
  const teamLeft = licensed && team.length
    ? (await maybeOne(o.pool, Count, `SELECT count(*)::int AS n FROM team_notes t
        JOIN unnest($2::text[], $3::text[]) AS x(owner_id, note_item_id) ON t.owner_id = x.owner_id AND t.note_item_id = x.note_item_id
        JOIN items i ON i.owner_id = t.owner_id AND i.item_id = t.note_item_id AND i.deleted_at IS NULL
        WHERE t.team_id = $1`, [licensed.teamId, team.map((l) => l.owner.ownerId), team.map((l) => l.note.itemId)]))?.n ?? 0
    : 0;
  const ownLeft = mine.length
    ? (await maybeOne(o.pool, Count, `SELECT count(*)::int AS n FROM items WHERE owner_id = $1 AND kind = 'note' AND deleted_at IS NULL AND item_id = ANY($2::text[])`, [o.ownerId, mine]))?.n ?? 0
    : 0;
  const givenLeft = theirs.length
    ? (await maybeOne(o.pool, Count, `SELECT count(*)::int AS n FROM note_access a
        JOIN unnest($2::text[], $3::text[]) AS t(owner_id, note_item_id) ON a.owner_id = t.owner_id AND a.note_item_id = t.note_item_id
        JOIN items i ON i.owner_id = a.owner_id AND i.item_id = a.note_item_id AND i.deleted_at IS NULL
        WHERE a.email_index = $1`, [emailIndex(o, await myEmail(o)), theirs.map((l) => l.owner.ownerId), theirs.map((l) => l.note.itemId)]))?.n ?? 0
    : 0;
  return found.length - ownLeft - givenLeft - teamLeft;
}
/** A note this person has, their own or given to them, or nothing. */
async function given(o: Owner, id: string, db: Db): Promise<Located | undefined> {
  const own = await maybeOne(db, z.object({ n: z.number() }), `SELECT 1 AS n FROM items WHERE owner_id = $1 AND item_id = $2 AND kind = 'note' AND deleted_at IS NULL`, [o.ownerId, id]);
  if (own) return { owner: o, note: await getItem(o, db, 'note', id, NoteManifest, 'Those notes'), mine: true };
  const as = await myEmail(o);
  const a = await maybeOne(db, AccessRow, 'SELECT owner_id, note_item_id FROM note_access WHERE note_item_id = $1 AND email_index = $2', [id, emailIndex(o, as)]);
  // No access, or access whose organizer deleted their account since it was read: nothing, either way.
  const owner = a && await findOwner(o, a.owner_id, undefined, db);
  return owner ? { owner, note: await getItem(owner, db, 'note', id, NoteManifest, 'Those notes'), mine: false, as } : undefined;
}
/** Where someone else's note is visible to the team this person is live-licensed on, without opening anything. */
async function onTeam(o: Owner, id: string, db: Db): Promise<{ row: z.infer<typeof TeamNoteRow>; teamId: string } | undefined> {
  const licensed = await licensedOn(db, o.ownerId);
  const row = licensed && await maybeOne(db, TeamNoteRow, `SELECT t.owner_id, t.note_item_id, t.created_at FROM team_notes t
    JOIN items i ON i.owner_id = t.owner_id AND i.item_id = t.note_item_id AND i.kind = 'note' AND i.deleted_at IS NULL
    WHERE t.note_item_id = $1 AND t.team_id = $2 AND t.owner_id <> $3`, [id, licensed.teamId, o.ownerId]);
  return licensed && row ? { row, teamId: licensed.teamId } : undefined;
}
/**
 * A note this person has, to change it (or anything of theirs on it): their own, or given to them. One they can only read
 * through their team is refused (`forbidden`); anything else is `not-found`, the same for a note that was never there.
 */
export async function locate(o: Owner, id: string, db: Db = o.pool): Promise<Located> {
  const l = await given(o, id, db);
  if (l) return l;
  if (await onTeam(o, id, db)) throw new ForbiddenError(TEAM_READS, { context: { noteId: id } });
  throw notFound('Those notes', { noteId: id });
}
/** A note this person may read and ask about: their own, given to them, or visible to the team they're live-licensed on. */
export async function locateToRead(o: Owner, id: string, db: Db = o.pool): Promise<Seen> {
  const l = await given(o, id, db);
  if (l) return l;
  const t = await onTeam(o, id, db);
  // Its organizer deleted their account since the row was read: it's gone.
  const owner = t && await findOwner(o, t.row.owner_id, undefined, db);
  if (!t || !owner) throw notFound('Those notes', { noteId: id });
  return { owner, note: await getItem(owner, db, 'note', id, NoteManifest, 'Those notes'), mine: false, team: { teamId: t.teamId, at: t.row.created_at.toISOString() } };
}

/**
 * The notes made visible to the team this person is live-licensed on that they don't have otherwise (`except`: what they
 * have), each opened with its organizer's keys, once for each organizer. None without a live license.
 */
async function teamNotes(o: Owner, except: ReadonlySet<string>): Promise<TeamLocated[]> {
  const licensed = await licensedOn(o.pool, o.ownerId);
  if (!licensed) return [];
  const found = await rows(o.pool, TeamNoteRow, 'SELECT owner_id, note_item_id, created_at FROM team_notes WHERE team_id = $1 AND owner_id <> $2', [licensed.teamId, o.ownerId]);
  const owners = new Map<string, Owner | undefined>();
  const out: TeamLocated[] = [];
  for (const r of found) {
    if (except.has(r.note_item_id)) continue;
    const owner = owners.has(r.owner_id) ? owners.get(r.owner_id) : await findOwner(o, r.owner_id, undefined);
    owners.set(r.owner_id, owner);
    // Deleted since its row was read, on its own or with its organizer's account.
    const note = owner && await findItem(owner, owner.pool, 'note', r.note_item_id, NoteManifest);
    if (owner && note) out.push({ owner, note, mine: false, team: { teamId: licensed.teamId, at: r.created_at.toISOString() } });
  }
  return out;
}

/**
 * The team's notes (`GET /v1/team/notes`): every note made visible to the team this person is live-licensed on, their own
 * among them, newest first, each as they have it (a note also given to them says so). None without a live license.
 */
export async function teamList(o: Owner): Promise<NoteSummary[]> {
  const licensed = await licensedOn(o.pool, o.ownerId);
  if (!licensed) return [];
  const visible = new Set((await rows(o.pool, z.object({ id: z.string() }), 'SELECT note_item_id AS id FROM team_notes WHERE team_id = $1', [licensed.teamId])).map((r) => r.id));
  if (!visible.size) return [];
  const held: Seen[] = (await everyNote(o, await myEmail(o))).filter((l) => visible.has(l.note.itemId));
  const notes = [...held, ...await teamNotes(o, new Set(held.map((l) => l.note.itemId)))];
  notes.sort((a, b) => b.note.manifest.startedAt.localeCompare(a.note.manifest.startedAt));
  return Promise.all(notes.map(async (l) => summary(l, await seriesOf(l))));
}

/**
 * Makes a note visible to its organizer's team, to read and ask about, or stops it being (docs: Plans and usage › Team). Only
 * its organizer, and making it visible only while they're live-licensed on a team, once its call has ended. It stays visible
 * to that team after they leave it, until they say otherwise, or the note or their account goes. Saying it again changes nothing.
 */
export async function setTeamVisible(o: Owner, id: string, visible: boolean): Promise<void> {
  const l = await locate(o, id);
  const context = { noteId: id, visible };
  if (!l.mine) throw new ForbiddenError('Only the organizer can make these notes visible to their team.', { context });
  if (visible && l.note.manifest.status === 'recording') throw new ValidationError('These notes can be made visible to your team once the call ends.', { context });
  // Under the note's lock, as what's added to it is: whoever adds reads who'd read it under the same lock, so a team that can
  // read the notes from now on is a change in who reads it, which their seal won't pass.
  const done = await tx(o.pool, async (c) => {
    await lockItem(o, c, id);
    if (!visible) return { changed: await exec(c, 'DELETE FROM team_notes WHERE owner_id = $1 AND note_item_id = $2', [o.ownerId, id]), teamId: null };
    const licensed = await licensedOn(c, o.ownerId);
    if (!licensed) throw new ForbiddenError('You need a license on a team to make notes visible to it.', { context });
    // Made visible to another team before, while they were on it: it's this one's now.
    const changed = await exec(c, `INSERT INTO team_notes (owner_id, note_item_id, team_id) VALUES ($1,$2,$3)
      ON CONFLICT (owner_id, note_item_id) DO UPDATE SET team_id = EXCLUDED.team_id, created_at = now() WHERE team_notes.team_id <> EXCLUDED.team_id`, [o.ownerId, id, licensed.teamId]);
    return { changed, teamId: licensed.teamId };
  });
  nlog.info('note team visibility set', { ...context, ...(done.teamId ? { teamId: done.teamId } : {}), changed: done.changed > 0 });
}
/** Titles of whichever of these notes are the account's own, read together from their manifests. */
export async function ownNoteTitles(o: Owner, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  return new Map((await findItems(o, o.pool, 'note', ids, NoteManifest)).map((n) => [n.itemId, n.manifest.title]));
}
/** The title of a note the account has, someone else's included, by the check reading it takes, from its manifest alone. */
export async function noteTitle(o: Owner, id: string): Promise<string> { return (await locate(o, id)).note.manifest.title; }

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
async function recipients(l: Seen, organizer: Person, db: Db = l.owner.pool): Promise<Recipient[]> {
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
      .map((s): Recipient => ({ person: personOf(s.email), role: 'shared', by: sharerOf(s.by, organizer), ...(s.group ? { group: s.group } : {}), ...(s.link ? { link: true } : {}), at: s.at }))
  ];
}

/**
 * Who reads whatever is added to a note now: everyone who has it, organizer first, and, while its organizer has it visible to
 * their team, that team, by its ID, its name and how many people live-licensed on it aren't among them (`people`).
 */
export interface Audience { people: Person[]; team: { id: string; name: string; people: number } | null }
export async function audienceOf(l: Located, db: Db = l.owner.pool): Promise<Audience> {
  const people = (await recipients(l, await me(l.owner), db)).map((r) => r.person);
  const row = await maybeOne(db, z.object({ team_id: z.string() }), 'SELECT team_id FROM team_notes WHERE owner_id = $1 AND note_item_id = $2', [l.owner.ownerId, l.note.itemId]);
  const team = row && await teamReaders(l.owner, db, row.team_id, people.map((p) => emailIndex(l.owner, p.email)));
  return { people, team: row && team ? { id: row.team_id, ...team } : null };
}

/** How someone came to have a note that isn't theirs, from the address they have it under. */
export function receivedBy(m: NoteManifest, as: string, organizer: Person): Received {
  const s = m.shared.find((x) => same(x.email, as));
  if (s) return { role: 'shared', by: sharerOf(s.by, organizer), ...(s.group ? { group: s.group } : {}), ...(s.link ? { link: true } : {}), at: s.at };
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

/** Whether a note's organizer made it visible to their team (docs: Plans and usage › Team). */
async function teamVisible(l: Seen): Promise<boolean> {
  return (await exec(l.owner.pool, 'SELECT 1 FROM team_notes WHERE owner_id = $1 AND note_item_id = $2', [l.owner.ownerId, l.note.itemId])) > 0;
}
/** How someone came to have a note that isn't theirs: given to them, or made visible to their team. */
const receivedOf = (l: Exclude<Seen, { mine: true }>, organizer: Person): Received =>
  (viaTeam(l) ? { role: 'team', by: organizer, at: l.team.at } : receivedBy(l.note.manifest, l.as, organizer));
function summaryOf(l: Seen, organizer: Person, who: Recipient[], visible: boolean, seriesId: string | undefined): NoteSummary {
  const m = l.note.manifest;
  return {
    id: l.note.itemId, kind: m.kind, status: m.status, title: m.title, startedAt: m.startedAt, duration: m.duration,
    people: who.map((r) => r.person), sharedWith: who.filter((r) => r.role === 'shared').map((r) => r.person.email),
    excerpt: m.summary.split(/(?<=\.)\s/).slice(0, 2).join(' '),
    openActions: actionsOf(m).filter((a) => !a.done).length, totalActions: actionsOf(m).length,
    ...(m.meetingId && l.mine ? { meetingId: m.meetingId } : {}), ...(l.mine ? {} : { received: receivedOf(l, organizer) }),
    teamVisible: visible, ...(seriesId ? { seriesId } : {}), groupShares: groupSharesOf(who)
  };
}
async function summary(l: Seen, seriesId: string | undefined): Promise<NoteSummary> {
  const organizer = await me(l.owner);
  return summaryOf(l, organizer, await recipients(l, organizer), await teamVisible(l), seriesId);
}

/** Lines of what was said a found note quotes, at most: enough for the palette to open a call's other moments in place. */
const SAID_SHOWN = 10;
/** Everything said in a note as someone may read it: the main room, then each breakout room's lines, which say which room. */
const saidIn = (m: NoteManifest): TranscriptLine[] => [...(m.transcript ?? []), ...m.rooms.flatMap((r) => r.transcript.map((l) => ({ ...l, room: { id: r.id, name: r.name } })))];

/**
 * What a line became in a note, read in the part of the call it was said in (the main room, or its breakout room's
 * section): what a decision that isn't rejected rests on, or else what a follow-up rests on.
 */
function madeIn(m: NoteManifest): (line: TranscriptLine) => NoteSaid['made'] {
  const parts = new Map(partsOf(m).map((p) => [p.room?.id ?? '', {
    decided: new Set(p.decisions.filter((d) => d.state !== 'rejected').flatMap((d) => d.lines)),
    followed: new Set(p.actions.filter(isAcceptedFollowUp).flatMap((a) => a.lines))
  }]));
  return (line) => {
    const part = parts.get(line.room?.id ?? '');
    return part?.decided.has(line.id) ? 'decision' : part?.followed.has(line.id) ? 'follow-up' : undefined;
  };
}

/**
 * What a search finds in a note as someone may read it: the lines with most of its words, best first, then the earliest,
 * and how many lines have any. A word is in the note when it's in its title, summary, decisions, follow-ups or anything
 * said, or starts a name of someone who spoke. With `by` (an address) only the lines they said count, so the note is found
 * only through one of them, and with no words it's all of them, in time order. Nothing, when the note doesn't match.
 */
function foundIn(l: Seen, { terms, question }: NoteSearch, by: string | undefined): Pick<NoteFound, 'said' | 'saidCount'> | undefined {
  const m = asRead(l);
  const all = saidIn(m);
  const lines = by === undefined ? all : all.filter((line) => line.speaker?.person !== undefined && same(line.speaker.person.email, by));
  if (by !== undefined && !lines.length) return undefined;
  const written = by === undefined ? [m.title, m.summary, ...decisionsOf(m).map((d) => d.text), ...actionsOf(m).map((a) => a.text)] : [];
  // The note is read once: every line's words lower-cased, and each speaker's name split into its words. `searchOf` has
  // lower-cased the search's words already.
  const names = new Map<string, string[]>();
  for (const line of lines) if (line.speaker && !names.has(line.speaker.name)) names.set(line.speaker.name, nameWords(line.speaker.name));
  const heard = lines.map((line) => ({ line, words: line.text.toLowerCase(), name: line.speaker ? names.get(line.speaker.name) ?? [] : [] }));
  const note = [...written.map((w) => w.toLowerCase()), ...heard.map((h) => h.words)].join(' ');
  const speakers = [...names.values()];
  const has = terms.filter((t) => note.includes(t) || speakers.some((name) => startsName(name, t))).length;
  if (terms.length && (question ? !has : has < terms.length)) return undefined;
  const matched = heard.flatMap(({ line, words, name }) => { const n = terms.length ? termsSaidIn(words, name, terms) : 1; return n ? [{ line, n }] : []; });
  const made = madeIn(m);
  const said = matched.sort((a, b) => b.n - a.n || a.line.at - b.line.at).slice(0, SAID_SHOWN).map(({ line }): NoteSaid => {
    const became = made(line);
    return { id: line.id, at: line.at, text: line.text, ...(line.speaker ? { speaker: line.speaker } : {}), ...(line.room ? { room: line.room } : {}), ...(became ? { made: became } : {}) };
  });
  return { said, saidCount: matched.length };
}

export async function list(o: Owner, q: { kind?: NoteKind | undefined; text?: string | undefined; by?: string | undefined }): Promise<NoteFound[]> {
  const search = searchOf(q.text ?? '');
  const by = q.by?.trim().toLowerCase() || undefined;
  const notes = (await everyNote(o, await myEmail(o))).filter((l) => !q.kind || l.note.manifest.kind === q.kind);
  notes.sort((a, b) => b.note.manifest.startedAt.localeCompare(a.note.manifest.startedAt));
  const found = notes.flatMap((l) => {
    const hit = search.terms.length || by !== undefined ? foundIn(l, search, by) : { said: [], saidCount: 0 };
    return hit ? [{ l, hit }] : [];
  });
  // Each call's series is read once, however many of its notes there are: a series' calls are each other's.
  const seriesOfCall = new Map<string, Promise<string | undefined>>();
  const seriesFor = (l: Located): Promise<string | undefined> => {
    const key = `${l.owner.ownerId}:${l.note.manifest.meetingId ?? ''}`;
    const known = seriesOfCall.get(key) ?? seriesOf(l);
    seriesOfCall.set(key, known);
    return known;
  };
  return Promise.all(found.map(async ({ l, hit }) => ({ ...await summary(l, await seriesFor(l)), ...hit })));
}
/**
 * A call someone was invited to that kept notes, as its note says: its title, when it started, how long it ran in seconds,
 * its organizer, and everyone invited who still has the notes (the person asking among them).
 */
export interface InvitedCall { noteId: string; title: string; startedAt: string; duration: number; organizer: Person; guests: Person[] }
/**
 * The calls this person was invited to that kept notes, which is all they keep of someone else's call once it's over: the
 * invitation goes when it ends. Only the notes given to them are read, and of those only a call's they got as someone
 * invited, not one shared with them afterwards (`receivedBy` tells them apart the same way). Nothing else about a note is
 * worked out, and each organizer is read once, however many of their calls there are.
 */
export async function invitedCalls(o: Owner): Promise<InvitedCall[]> {
  const as = await myEmail(o);
  const invited = (await sharedWithMe(o, as)).filter((l) => l.note.manifest.kind === 'call' && !l.note.manifest.shared.some((s) => same(s.email, as)));
  const organizers = new Map<string, Promise<Person>>();
  const organizerOf = (owner: Owner): Promise<Person> => {
    const known = organizers.get(owner.ownerId) ?? me(owner);
    organizers.set(owner.ownerId, known);
    return known;
  };
  return Promise.all(invited.map(async (l): Promise<InvitedCall> => {
    const organizer = await organizerOf(l.owner);
    const guests = (await recipients(l, organizer)).flatMap((r) => (r.role === 'invited' ? [r.person] : []));
    const m = l.note.manifest;
    return { noteId: l.note.itemId, title: m.title, startedAt: m.startedAt, duration: m.duration, organizer, guests };
  }));
}

/** The series a note's call is in, read from the call in its organizer's vault. Room recordings have no call, so no series. */
export async function seriesOf(l: Seen): Promise<string | undefined> {
  const meetingId = l.note.manifest.meetingId;
  return meetingId ? (await findItem(l.owner, l.owner.pool, 'meeting', meetingId, MeetingManifest))?.manifest.seriesId : undefined;
}
export async function get(o: Owner, id: string): Promise<Note> {
  const l = await locateToRead(o, id);
  const m = l.note.manifest;
  const read = asRead(l);
  const organizer = await me(l.owner);
  const who = await recipients(l, organizer);
  // The call it was, in its organizer's vault: the series it's in, and its home. A room recording has neither.
  const call = m.meetingId ? (await findItem(l.owner, l.owner.pool, 'meeting', m.meetingId, MeetingManifest))?.manifest : undefined;
  const seriesId = call?.seriesId;
  const { decisions, questions, actions, suggestions, rooms } = entriesOf(read);
  return {
    ...summaryOf(l, organizer, who, await teamVisible(l), seriesId), recipients: who, summary: m.summary, decisions, questions, actions, suggestions, chapters: m.chapters,
    gaps: m.gaps, screens: m.screens, transcript: read.transcript, rooms, additions: await additions.of(l, o.ownerId), writtenAt: m.writtenAt, writingAgain: m.status === 'ready' && !!(await jobOf(l.owner, l.owner.pool, id)),
    details: m.details, suggestedQuestions: m.suggestedQuestions, audio: await segments(l.owner, m.recordingId), kept: m.keep, inference: m.inference, workedOn: await workedOnFor(o, m.workedOn, everyoneWith(m, organizer.email)),
    shares: m.keep.recording ? await screens.shareIntervals(l.owner, m.recordingId, m.segmentSeconds) : [], model: m.model, unencrypted: m.unencrypted,
    home: await homeFor(o, id, call?.workspaceId ?? null)
  };
}
/** A note's notes job while its notes are queued or being written, whichever of its revisions it was queued for. */
async function jobOf(o: Owner, db: Db, noteId: string) {
  return maybeOne(db, z.object({ state: z.string(), attempt: z.number() }), `SELECT state, attempt FROM content_jobs WHERE owner_id = $1 AND kind = 'notes'
    AND revision_id IN (SELECT revision_id FROM revisions WHERE owner_id = $1 AND item_id = $2) LIMIT 1`, [o.ownerId, noteId]);
}
/** The vault and recording to stream a note's audio from, after the access check. */
export async function audioSource(o: Owner, id: string): Promise<{ owner: Owner; recordingId: string }> {
  const l = await locateToRead(o, id);
  return { owner: l.owner, recordingId: l.note.manifest.recordingId };
}
/**
 * The vault and recording to replay a kept share's video in one segment from, after the same access check as the
 * audio: not found unless the note's recording has that video. One query besides opening the note, for every range.
 */
export async function videoAccess(o: Owner, id: string, shareId: string, segment: number): Promise<{ owner: Owner; recordingId: string }> {
  const l = await locateToRead(o, id);
  if (!l.note.manifest.keep.recording) throw notFound('That shared screen’s video', { noteId: id, segment });
  const recordingId = l.note.manifest.recordingId;
  const has = await maybeOne(l.owner.pool, z.object({ chunk: z.number() }), `SELECT v.chunk FROM screen_videos v
    JOIN screen_shares s ON s.owner_id = v.owner_id AND s.recording_id = v.recording_id AND s.share_id = v.share_id
    WHERE v.owner_id = $1 AND v.recording_id = $2 AND v.share_id = $3 AND v.segment = $4 AND v.chunk = 0 AND s.keep`, [l.owner.ownerId, recordingId, shareId, segment]);
  if (!has) throw notFound('That shared screen’s video', { noteId: id, segment });
  return { owner: l.owner, recordingId };
}
/** One of a note's shared-screen frames, decrypted, for anyone who has the note: only frames the note shows. */
export async function screenImage(o: Owner, id: string, frameId: string): Promise<Uint8Array> {
  const l = await locateToRead(o, id);
  if (!l.note.manifest.screens.some((m) => m.id === frameId)) throw notFound('That frame', { noteId: id });
  return screens.image(l.owner, id, l.note.manifest.recordingId, frameId);
}
/** Where a note is on its way to being written, step by step; `ready` once the notes are written. */
export async function progress(o: Owner, id: string): Promise<NoteProgress> {
  const { owner, note } = await locateToRead(o, id);
  const m = note.manifest;
  const stopped = m.status !== 'recording';
  const seconds = m.recorded ?? (await segments(owner, m.recordingId)).reduce((s, a) => s + a.seconds, 0);
  // The call's lines and every breakout room's.
  const lines = (m.transcript?.length ?? 0) + m.rooms.reduce((n, r) => n + r.transcript.length, 0);
  const audio = !seconds && (stopped || m.keep.recording) ? 'No audio was recorded'
    : m.keep.recording ? `${minutesLabel(seconds)} of audio saved, encrypted`
      : stopped ? 'The recording was deleted when the call ended' : 'The recording is deleted when the call ends';
  const transcript = !stopped ? 'Transcribing as it goes'
    : lines ? `Transcript of ${lines} ${lines === 1 ? 'line' : 'lines'}${m.keep.transcript ? '' : ', deleted once the notes are written'}`
      : !m.keep.transcript && m.writtenAt !== null ? 'The transcript was deleted once the notes were written' : 'Nothing was transcribed';
  // Notes being written again leave the note ready meanwhile: they're done when their job is.
  const job = stopped ? await jobOf(owner, owner.pool, id) : undefined;
  const done = m.status === 'ready' && !job;
  const writing = !inference(o.cfg).configured ? 'Waiting for the notes service to be connected'
    : job?.state === 'writing' ? 'Writing the summary, decisions and follow-ups'
      : job?.state === 'waiting' ? 'Waiting for the notes model. The notes are written as soon as it’s verified and answering'
        : job && job.attempt > 0 ? 'The notes service is busy. Trying again shortly'
          : 'Queued for the notes service';
  const video = stopped && m.keep.recording ? await screens.videoReady(owner, m.recordingId) : null;
  return {
    noteId: id, title: m.title, ready: done,
    steps: [
      { label: m.kind === 'room' ? 'Recording stopped' : 'Call ended', done: stopped },
      { label: audio, done: stopped },
      { label: transcript, done: stopped },
      ...(video === null ? [] : [{ label: video || done ? 'Shared screens ready to replay' : 'Getting shared screens ready to replay', done: video || done }]),
      { label: done ? 'Notes written' : writing, done }
    ]
  };
}

/**
 * Answers a question about written notes from their transcript and each breakout room's section, or from the notes
 * themselves once a transcript's been deleted, for anyone who has them. The answer goes only if they still have the
 * notes once it's written: it may quote them.
 */
export async function ask(o: Owner, id: string, question: string): Promise<AnswerPart[]> {
  const l = await locateToRead(o, id);
  const { owner, note } = l;
  const m = note.manifest;
  if (m.status !== 'ready') throw new ConflictError('You can ask about a call once its notes are written.', { context: { noteId: id, status: m.status } });
  const read = asRead(l);
  if (!said(read) && m.writtenAt === null) {
    throw new ConflictError(said(m) ? 'These notes aren’t written yet, so there’s nothing to ask about.' : 'Nothing was said while notes were on, so there’s nothing to ask about.', { context: { noteId: id } });
  }
  const t0 = performance.now();
  // The model chosen for the call answers questions about it too.
  const via = await resolveModel(o.cfg, m.model);
  await recordUnencryptedUse(owner, id, via);
  const parts = await answer(o.cfg, meterFor(o, { payer: o.ownerId, spend: 'ask', whose: 'yours' }), id, { ...briefOf(read, await me(owner), m.invited.map((e) => personOf(e))), via }, await me(o), question);
  const ms = Math.round(performance.now() - t0);
  if (await goneSince(o, [l])) {
    throw new ConflictError('These notes were deleted or removed from yours while the answer was being written, so it isn’t shown.', { context: { noteId: id, mine: l.mine, ms } });
  }
  nlog.info('question answered', { noteId: id, mine: l.mine, team: viaTeam(l), cites: parts.length - 1, ms });
  return parts;
}

const NOTHING_TO_ASK = 'You don’t have any notes to answer from yet.';
const NOT_WRITTEN = 'Your notes aren’t written yet. Ask again once they’re ready.';
/** How many notes one question can refer to (@-references). */
const MAX_REFS = 5;
/** Whether a note can answer questions: written, or with a transcript the reader can read. */
const answerable = (l: Seen): boolean => l.note.manifest.status === 'ready' && (l.note.manifest.writtenAt !== null || (asRead(l).transcript?.length ?? 0) > 0);
/**
 * Answers a question from every note this person may read: their own, ones shared with them, and the ones visible to the
 * team they're live-licensed on; the ones with notes written or a transcript they can read (features/notes/drafting.ts
 * chooses which go). `refs` (up to 5, the question's @-references) are each opened as anything else is, refused if they
 * can't be, and go first; nothing else goes that the search didn't find. Without any, it says so, and nothing goes to
 * the notes model. The asker pays. The answer goes only if they still have every note it read once it's written: it may
 * quote any of them.
 */
export async function askAll(o: Owner, question: string, refs: readonly string[] = []): Promise<AnswerPart[]> {
  const wanted = [...new Set(refs)];
  if (wanted.length > MAX_REFS) throw new ValidationError(`Refer to ${MAX_REFS} notes at most in one question.`, { context: { refs: wanted.length } });
  const given = await everyNote(o, await myEmail(o));
  const all: Seen[] = [...given, ...await teamNotes(o, new Set(given.map((l) => l.note.itemId)))];
  // Each reference is opened as anything else is: one this person can't read is `not-found`, the same for one that never was.
  for (const id of wanted) {
    const l = all.find((x) => x.note.itemId === id) ?? await locateToRead(o, id);
    if (!answerable(l)) throw new ConflictError('A note you referred to isn’t written yet. Ask again once it’s ready.', { context: { noteId: id, status: l.note.manifest.status } });
  }
  const ready = all.filter(answerable);
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
  const notes = await Promise.all(ready.map(async (l): Promise<NoteBrief> => {
    const m = asRead(l);
    return { id: l.note.itemId, startedAt: m.startedAt, decisions: decisionsOf(m), actions: actionsOf(m), brief: briefOf(m, await person(l.owner), m.invited.map((e) => personOf(e))) };
  }));
  const t0 = performance.now();
  // Across notes, the asker's own choice of model.
  const via = await resolveModel(o.cfg, (await profile(o)).preferences.model);
  const { parts, sent, lines } = await answerFromNotes(o.cfg, meterFor(o, { payer: o.ownerId, spend: 'ask', whose: 'yours' }), notes, await person(o), question, via, async (ids) => {
    const sent = new Set(ids);
    for (const l of ready) if (sent.has(l.note.itemId)) await recordUnencryptedUse(l.owner, l.note.itemId, via);
  }, new Set(wanted));
  const ms = Math.round(performance.now() - t0);
  // Writing it can take up to a minute. A note deleted or taken away meanwhile must not show through the answer.
  if (await goneSince(o, ready.filter((l) => sent.includes(l.note.itemId)))) {
    throw new ConflictError('Notes it read were deleted or removed from yours while the answer was being written, so it isn’t shown. Ask again.', { context: { notes: sent.length, ms } });
  }
  nlog.info('question answered across notes', { notes: all.length, team: all.length - given.length, refs: wanted.length, ready: ready.length, sent: sent.length, lines, cites: parts.length - 1, ms });
  return parts;
}
/**
 * What waits on this person across every note they have, their own and ones shared with them, newest note first:
 * follow-ups that are theirs and not done; decisions in written notes nobody has confirmed or rejected and that they can
 * confirm, unless they proposed one or said it wasn't decided, which is already their answer; and, in notes they
 * organized, confirmed decisions someone disputes, which are theirs to settle. Notes they removed aren't theirs any more,
 * so nothing from them is listed, and each entry comes with what backs it as the note stands now.
 */
export async function inbox(o: Owner): Promise<Inbox> {
  const email = await myEmail(o);
  const all = await everyNote(o, email);
  all.sort((a, b) => b.note.manifest.startedAt.localeCompare(a.note.manifest.startedAt));
  const readerIn = (l: Located): NoteReader => ({ id: o.ownerId, email, role: roleIn(l) });
  const from = (l: Located) => ({ noteId: l.note.itemId, noteTitle: l.note.manifest.title, noteStartedAt: l.note.manifest.startedAt, role: roleIn(l) });
  const waiting = (d: Decision, r: NoteReader) => (d.state === 'confirmed' ? r.role === 'organizer' && d.disputes.length > 0
    : d.state === 'proposed' && mayDecide(d, 'confirmed', r) && !isProposer(d, r) && !d.disputes.some((x) => isBy(x.by, r)));
  const read = all.map((l) => ({ l, ...entriesOf(asRead(l)) }));
  return {
    followUps: read.flatMap(({ l, actions, rooms }) => [...actions, ...rooms.flatMap((r) => r.actions)]
      .filter((a) => !a.done && isAssignee(a, { email })).map((a): OpenAction => ({ ...a, ...from(l) }))),
    decisions: read.filter(({ l }) => l.note.manifest.status === 'ready')
      .flatMap(({ l, decisions, rooms }) => [...decisions, ...rooms.flatMap((r) => r.decisions)].filter((d) => waiting(d, readerIn(l))).map((d): PendingDecision => ({ ...d, ...from(l) })))
  };
}

/* ---------- confirming what the notes say ---------- */

/** How someone has a note, as a change to it records. */
const roleIn = (l: Located): RecipientRole => (l.mine ? 'organizer' : l.note.manifest.shared.some((x) => same(x.email, l.as)) ? 'shared' : 'invited');

/** A note that's written, located for someone who has it, and who they are for its history and its grants. */
async function writtenNote(o: Owner, noteId: string) {
  const l = await locate(o, noteId);
  if (l.note.manifest.status !== 'ready') throw new ConflictError('These notes are still being written.', { context: { noteId, status: l.note.manifest.status } });
  const p = await profile(o);
  const role = roleIn(l);
  const by: Change['by'] = { id: o.ownerId, name: p.name, email: p.email, as: role };
  const reader: NoteReader = { id: o.ownerId, email: p.email, role };
  return { ...l, by, reader, at: new Date().toISOString() };
}

/** The most changes a decision, open question or follow-up keeps in the note (`kept`). Nothing reads the note's earlier revisions, so past this they're out of the history. */
const ENTRY_HISTORY = 40;
/** The most decisions, open questions or follow-ups one part of a note can hold: the notes write 12, 12 and 20, and every change copies the note. */
const MAX_ENTRIES = 60;

/** Entries in the order of their moments, as the notes write them; ones without a moment last. */
const inOrder = <T extends { at?: number | undefined }>(xs: T[]): T[] => [...xs].sort((a, b) => (a.at ?? Number.POSITIVE_INFINITY) - (b.at ?? Number.POSITIVE_INFINITY));

/** Why someone can't move a decision where they asked to. Refusals name nobody, so no name reaches a log line. */
function decisionRefusal(d: Decision, to: Decision['state'], r: NoteReader): string {
  if (to === 'rejected') return 'Only the organizer can say a decision wasn’t decided. You can say you don’t think it was.';
  if (to === 'confirmed' && r.role === 'shared') return 'Only the organizer and people invited to the call can confirm a decision. You can say you don’t think it was decided.';
  if (to === 'confirmed' && d.state === 'proposed') return 'Someone else has to confirm words you wrote.';
  if (to === 'confirmed' && d.state === 'rejected') return 'Only the organizer can confirm what they said wasn’t decided.';
  return 'Only the organizer, or whoever confirmed this decision, can change where it stands.';
}
/** Refused when it isn't what they read: someone may have changed it since, and that isn't what they'd be agreeing to. */
const CHANGED = 'This changed after you opened it, so nothing was saved. Read it again.';

/**
 * Moves a decision, the call's or a breakout room's, along (`grants.ts` says who may), rewords it, or says it wasn't
 * decided as someone who can't reject it. New words on a confirmed decision put it back to proposed, since what people
 * confirmed was the words before, and only the organizer can confirm new words of their own in the same change: anyone
 * else's words take someone else. Confirming says what was read, and is refused if it says something else by now. A
 * dispute stands until whoever raised it takes it back, or the organizer settles the decision; their confirming again is
 * how a confirmed one is settled.
 */
export async function updateDecision(o: Owner, noteId: string, decisionId: string, patch: DecisionPatch): Promise<Note> {
  const { owner, by, at, reader } = await writtenNote(o, noteId);
  let made: Change['what'][] = [];
  await tx(owner.pool, (c) => updateNote(owner, c, noteId, (n) => {
    const d = decisionsOf(n).find((x) => x.id === decisionId);
    if (!d) throw new NotFoundError('That decision doesn’t exist.', { context: { noteId, decisionId } });
    const context = { noteId, decisionId, state: d.state };
    if (patch.seen && patch.seen.text !== d.text) throw new ConflictError(CHANGED, { context });
    const changes = [...d.changes];
    let next: Decision = d;
    const text = patch.text;
    const reworded = text !== undefined && text !== d.text;
    if (reworded) {
      if (!mayRewordDecision(d, reader)) throw new ForbiddenError('Only the organizer, or whoever wrote or confirmed this decision, can reword it now.', { context });
      changes.push({ by, at, what: 'reworded', before: d.text, after: text });
      next = { ...next, text };
    }
    const to = patch.state ?? (reworded && d.state === 'confirmed' ? 'proposed' : d.state);
    // Confirming what's confirmed means something only when it stands behind new words, or settles a dispute: the organizer's, either way.
    const settling = patch.state === 'confirmed' && d.state === 'confirmed' && reader.role === 'organizer' && (reworded || d.disputes.length > 0);
    if (reworded && to === 'confirmed' && d.state === 'confirmed' && !settling) throw new ForbiddenError('Someone else has to confirm words you wrote.', { context });
    if (to !== d.state || settling) {
      // Only something that was decided can stop holding; what nobody confirmed is reopened or said not to be decided.
      if (to === 'superseded' && d.state !== 'confirmed') throw new ConflictError('Only a confirmed decision can stop holding.', { context });
      // Asked with the words as they are after this change, so writing them and confirming them is one person doing both.
      if (to !== d.state && !mayDecide({ state: d.state, changes }, to, reader)) throw new ForbiddenError(decisionRefusal(d, to, reader), { context });
      changes.push({ by, at, what: to === 'proposed' ? 'reopened' : to });
      const settled = reader.role === 'organizer' && (to === 'confirmed' || to === 'rejected');
      next = { ...next, state: to, disputes: settled ? [] : to === 'confirmed' ? next.disputes.filter((x) => !isBy(x.by, reader)) : next.disputes };
    }
    if (patch.dispute !== undefined) {
      const had = next.disputes.some((x) => isBy(x.by, reader));
      if (patch.dispute && !had) {
        if (!mayDispute({ state: next.state, changes }, reader)) throw new ForbiddenError('You can’t dispute this decision: it’s yours to change, or it’s settled.', { context });
        changes.push({ by, at, what: 'disputed' });
        next = { ...next, disputes: [...next.disputes, { by, at }] };
      } else if (!patch.dispute && had) {
        changes.push({ by, at, what: 'undisputed' });
        next = { ...next, disputes: next.disputes.filter((x) => !isBy(x.by, reader)) };
      }
    }
    made = changes.slice(d.changes.length).map((x) => x.what);
    // Item IDs are the note's own, so the one list that has it changes, the call's or a room's.
    const swap = (xs: Decision[]) => xs.map((x) => (x.id === decisionId ? { ...next, revision: id128(), changes: kept(changes, ENTRY_HISTORY) } : x));
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
    const swap = (xs: Question[]) => xs.map((x) => (x.id === questionId ? { ...next, revision: id128(), changes: kept(changes, ENTRY_HISTORY) } : x));
    return made.length ? { ...n, questions: swap(n.questions), rooms: n.rooms.map((r) => ({ ...r, questions: swap(r.questions) })) } : n;
  }));
  nlog.info('question changed', { noteId, questionId, changes: made.join(',') || 'none', mine: owner.ownerId === o.ownerId });
  return get(o, noteId);
}

/** Who a follow-up can go to, by address: the organizer, or someone who has the notes now, so whoever it's for can see it. */
function assignable(email: string, organizer: Person, holding: Set<string>, owner: Owner, context: Record<string, string>): Speaker {
  if (!same(email, organizer.email) && !holding.has(b64u(emailIndex(owner, email)))) throw new ValidationError('Share the notes with them first: follow-ups go to people who have the notes.', { context });
  const person = same(email, organizer.email) ? organizer : personOf(email);
  return { name: nameOf(person), person };
}

/**
 * Changes a follow-up, the call's or a breakout room's, as far as `grants.ts` lets this person: `takeOn` is the person
 * it's for saying they'll do it, and nobody else can, since the notes only ever suggest. Taking it on, or giving it to
 * yourself, says what was read, and is refused if it says something else by now. Taking the owner off is that person
 * saying it isn't theirs, or the organizer deciding it isn't. Whatever someone took on stays as they agreed to it: the
 * organizer changing its words or its date asks them again.
 */
export async function updateAction(o: Owner, noteId: string, actionId: string, patch: ActionPatch): Promise<Note> {
  const { owner, by, at, reader } = await writtenNote(o, noteId);
  const organizer = await me(owner);
  let made: Change['what'][] = [];
  await tx(owner.pool, async (c) => {
    // Who has the notes, read under the note's lock as the change is made: someone who removed them isn't given a follow-up.
    await lockItem(owner, c, noteId);
    const holding = await holders(owner, c, noteId);
    await updateNote(owner, c, noteId, (n) => {
      const a = actionsOf(n).find((x) => x.id === actionId);
      if (!a) throw new NotFoundError('That follow-up doesn’t exist.', { context: { noteId, actionId } });
      const context = { noteId, actionId };
      const taking = patch.takeOn === true || (typeof patch.owner === 'string' && same(patch.owner, by.email) && !isAssignee(a, reader));
      if (taking && !patch.seen) throw new ValidationError('Say what you read.', { context });
      if (patch.seen && (patch.seen.text !== a.text || patch.seen.due !== (a.due ?? null))) throw new ConflictError(CHANGED, { context });
      const changing = () => { if (!mayChangeAction(a, reader)) throw new ForbiddenError('Only the organizer, or whoever took this on, can change it now.', { context }); };
      const assigning = () => { if (!mayAssign(a, reader)) throw new ForbiddenError('Only the organizer, or the person it’s for, can say who this is for.', { context }); };
      const changes = [...a.changes];
      let next: ActionItem = a;
      let agreedTo = false;
      if (patch.text !== undefined && patch.text !== a.text) {
        changing();
        changes.push({ by, at, what: 'reworded', before: a.text, after: patch.text });
        next = { ...next, text: patch.text };
        agreedTo = true;
      }
      if (patch.owner === null && next.owner) {
        assigning();
        // From the person it's for, that's their answer: not mine. From the organizer, it's taking it away.
        changes.push({ by, at, what: isAssignee(a, reader) ? 'declined' : 'reassigned', before: next.owner.name });
        const { owner: _gone, ...rest } = next;
        void _gone;
        next = { ...rest, takenOn: false };
      } else if (typeof patch.owner === 'string' && !(next.owner?.person && same(next.owner.person.email, patch.owner))) {
        assigning();
        const to = assignable(patch.owner, organizer, holding, owner, context);
        // Giving it to yourself is taking it on; anyone else has to say yes themselves.
        const self = same(patch.owner, by.email);
        changes.push({ by, at, what: self ? 'took-on' : 'reassigned', ...(next.owner ? { before: next.owner.name } : {}), after: to.name });
        next = { ...next, owner: to, takenOn: self };
      }
      if (patch.takeOn) {
        if (!isAssignee(next, reader)) throw new ForbiddenError('Only the person a follow-up is for can take it on. You can give it to yourself.', { context });
        if (!next.takenOn) { changes.push({ by, at, what: 'took-on' }); next = { ...next, takenOn: true }; }
      }
      // Taking back a yes (Undo): it's suggested for them again, and the record says they reopened it.
      if (patch.takeOn === false) {
        if (!isAssignee(next, reader)) throw new ForbiddenError('Only whoever took this on can take that back.', { context });
        if (next.takenOn) { changes.push({ by, at, what: 'reopened' }); next = { ...next, takenOn: false }; }
      }
      if (patch.due !== undefined) {
        const due = patch.due || undefined;
        if (due !== next.due) {
          changing();
          changes.push({ by, at, what: 'due', ...(next.due ? { before: next.due } : {}), ...(due ? { after: due } : {}) });
          const { due: _old, ...rest } = next;
          void _old;
          next = due ? { ...rest, due } : rest;
          agreedTo = true;
        }
      }
      // What someone took on, changed by someone else: it's not what they said they'd do any more, so they say again.
      if (agreedTo && a.takenOn && next.takenOn && !isAssignee(a, reader) && !isAssignee(next, reader)) {
        changes.push({ by, at, what: 'reopened' });
        next = { ...next, takenOn: false };
      }
      if (patch.done !== undefined && patch.done !== next.done) {
        changing();
        changes.push({ by, at, what: patch.done ? 'done' : 'undone' });
        next = { ...next, done: patch.done };
      }
      made = changes.slice(a.changes.length).map((x) => x.what);
      const swap = (xs: ActionItem[]) => xs.map((x) => (x.id === actionId ? { ...next, revision: id128(), changes: kept(changes, ENTRY_HISTORY) } : x));
      return made.length ? { ...n, actions: swap(n.actions), rooms: n.rooms.map((r) => ({ ...r, actions: swap(r.actions) })) } : n;
    });
  });
  nlog.info('follow-up changed', { noteId, actionId, changes: made.join(',') || 'none', mine: owner.ownerId === o.ownerId });
  return get(o, noteId);
}


/** Review is shared and locked, and never claims that the proposed owner agreed to the task. */
export async function reviewAction(o: Owner, noteId: string, decision: FollowUpReview): Promise<Note> {
  const { owner, by, at, reader } = await writtenNote(o, noteId);
  await tx(owner.pool, async (c) => {
    await lockItem(owner, c, noteId);
    await updateNote(owner, c, noteId, (n) => {
      const proposal = allActionsOf(n).find((a) => a.id === decision.id);
      if (!proposal) throw new NotFoundError('That suggestion doesn’t exist.', { context: { noteId } });
      const target = proposal.changeOf ? actionsOf(n).find((a) => a.id === proposal.changeOf) : undefined;
      if (!mayChangeAction(target ?? proposal, reader)) throw new ForbiddenError('You can’t review this suggestion.', { context: { noteId } });
      if (proposal.revision !== decision.revision) throw new ConflictError('This suggestion changed. Review it again.', { context: { noteId } });
      const review = decision.decision === 'accept' ? 'accepted' : 'dismissed';
      if (proposal.review !== 'suggested') {
        if (proposal.review === review) return n;
        throw new ConflictError('Someone already reviewed this suggestion.', { context: { noteId } });
      }
      const part = n.rooms.find((r) => r.actions.some((a) => a.id === proposal.id)) ?? n;
      if (review === 'accepted' && proposal.changeOf === null && part.actions.filter(isAcceptedFollowUp).length >= MAX_ENTRIES) throw new ConflictError('These notes have as many follow-ups as they can keep.', { context: { noteId } });
      if (review === 'accepted' && proposal.changeOf && (!target || JSON.stringify(actionTarget(target)) !== JSON.stringify(proposal.target))) throw new ConflictError('The task changed. Review a new suggestion for it.', { context: { noteId } });
      if (review === 'accepted' && target && (target.owner?.person?.email ?? null) !== (proposal.owner?.person?.email ?? null) && !mayAssign(target, reader)) throw new ForbiddenError('Only the organizer, or the person it’s for, can change who this is for.', { context: { noteId } });
      const swap = (xs: ActionItem[]): ActionItem[] => xs.map((a) => {
        if (a.id === proposal.id) return { ...a, review, reviewed: { by, at, decision: decision.decision }, changes: kept([...a.changes, { by, at, what: decision.decision === 'accept' ? 'accepted' : 'dismissed' }], ENTRY_HISTORY) };
        if (review !== 'accepted' || !target || a.id !== target.id) return a;
        const { owner: _owner, due: _due, ...rest } = a;
        const mine = isAssignee(a, reader);
        const ownerChanged = (a.owner?.person?.email ?? a.owner?.name ?? null) !== (proposal.owner?.person?.email ?? proposal.owner?.name ?? null);
        const dueChanged = (a.due ?? null) !== (proposal.due ?? null);
        const textChanged = a.text !== proposal.text;
        const takenOn = a.takenOn && !ownerChanged && (mine || (!textChanged && !dueChanged));
        const events: Change[] = [];
        if (textChanged) events.push({ by, at, what: 'reworded', before: a.text, after: proposal.text });
        if (ownerChanged) events.push({ by, at, what: 'reassigned', ...(a.owner ? { before: a.owner.name } : {}), ...(proposal.owner ? { after: proposal.owner.name } : {}) });
        if (dueChanged) events.push({ by, at, what: 'due', ...(a.due ? { before: a.due } : {}), ...(proposal.due ? { after: proposal.due } : {}) });
        if (a.takenOn && !takenOn) events.push({ by, at, what: 'reopened' });
        return { ...rest, text: proposal.text, ...(proposal.owner ? { owner: proposal.owner } : {}), ...(proposal.due ? { due: proposal.due } : {}), lines: proposal.lines, sourceId: proposal.sourceId, sourceVersion: proposal.sourceVersion, revision: id128(), takenOn, changes: kept([...a.changes, ...events], ENTRY_HISTORY) };
      });
      return { ...n, actions: swap(n.actions), rooms: n.rooms.map((r) => ({ ...r, actions: swap(r.actions) })) };
    });
  });
  nlog.info('follow-up suggestion reviewed', { noteId, suggestionId: decision.id, decision: decision.decision });
  return get(o, noteId);
}

/* ---------- adding to what the notes say ---------- */

/** The part of a note a proposal goes in: the call's, or a breakout room's section. A room that isn't in the note is refused. */
function partOf(n: NoteManifest, noteId: string, room: string | undefined) {
  if (room === undefined) {
    return { lines: n.transcript ?? [], decisions: n.decisions, questions: n.questions, actions: n.actions, put: (x: Partial<Pick<NoteManifest, 'decisions' | 'questions' | 'actions'>>): NoteManifest => ({ ...n, ...x }) };
  }
  const r = n.rooms.find((x) => x.id === room);
  if (!r) throw new NotFoundError('That breakout room isn’t in these notes.', { context: { noteId, room } });
  return { lines: r.transcript, decisions: r.decisions, questions: r.questions, actions: r.actions, put: (x: Partial<Pick<RoomNote, 'decisions' | 'questions' | 'actions'>>): NoteManifest => ({ ...n, rooms: n.rooms.map((y) => (y.id === room ? { ...y, ...x } : y)) }) };
}

/** The lines someone says a proposal rests on, and the moment of the first, from that part of the note alone. */
function linesOf(part: TranscriptLine[], ids: string[] | undefined, noteId: string): { lines: string[]; at?: number } {
  const lines = [...new Set(ids ?? [])];
  const found = lines.map((id) => part.find((l) => l.id === id));
  if (found.some((l) => !l)) throw new ValidationError('That line isn’t in this part of the notes.', { context: { noteId } });
  const first = found[0];
  return { lines, ...(first ? { at: Math.round(first.at) } : {}) };
}

/**
 * What adding to a note did, from the write itself: the entry with those words in that part (`id`: the one made, or the
 * one already there, since the same words again add nothing), whether this added it, and whether it's theirs (they
 * proposed it, now or before; one just made always is). An agent is handed an entry's ID back only when it's theirs.
 */
export interface Added { id: string; added: boolean; theirs: boolean }
/** An entry already in that part with the same words, as adding it again finds it. */
const already = (x: Decision | Question | ActionItem, reader: NoteReader): Added => ({ id: x.id, added: false, theirs: isProposer(x, reader) });
/** Thrown should a write not say what it did, though every way through it does. */
const unsaid = (noteId: string) => new InternalError('Adding to the notes didn’t say what it added.', { context: { noteId } });

/**
 * Adds a decision the notes didn't hear, in the words of someone who has them, the call's or a breakout room's. It
 * starts proposed, with who proposed it as its first change, and takes someone else confirming it. This is someone
 * saying the call decided something: what they add from their own notes is `additions.ts`, which says only who added it.
 * The same words again add nothing, so a retry can't add it twice. The lines it rests on are checked first, so lines from
 * nowhere are refused whether or not the words are there already.
 */
export async function proposeDecision(o: Owner, noteId: string, p: DecisionProposal): Promise<Added> {
  const { owner, by, at, reader } = await writtenNote(o, noteId);
  let made: Added | undefined;
  await tx(owner.pool, (c) => updateNote(owner, c, noteId, (n) => {
    const part = partOf(n, noteId, p.room);
    const grounds = linesOf(part.lines, p.lines, noteId);
    const there = part.decisions.find((x) => x.text === p.text);
    if (there) { made = already(there, reader); return n; }
    if (part.decisions.length >= MAX_ENTRIES) throw new ConflictError('There are too many decisions here to add another.', { context: { noteId } });
    const d: Decision = { id: id128(), text: p.text, ...grounds, state: 'proposed', against: [], disputes: [], changes: [{ by, at, what: 'proposed' }] };
    made = { id: d.id, added: true, theirs: true };
    return part.put({ decisions: inOrder([...part.decisions, d]) });
  }));
  if (!made) throw unsaid(noteId);
  nlog.info('decision proposed', { noteId, added: made.added, lines: p.lines?.length ?? 0, inRoom: p.room !== undefined, mine: owner.ownerId === o.ownerId });
  return made;
}

/**
 * Adds an open question the notes didn't hear to their Still open, the call's or a breakout room's, as `proposeDecision`
 * adds a decision: it starts open, with who added it as its first change (`proposed`), which also keeps it when the notes
 * are written again, and anyone who has the notes can say it was answered (`updateQuestion`). It's what an agent's
 * `add_question` does: the app has no way to add one. The same words again add nothing, so a retry can't add it twice, and
 * the lines are checked first, as for a decision. It says what it did, as `Added`, and reads nothing back.
 */
export async function addQuestion(o: Owner, noteId: string, p: QuestionProposal): Promise<Added> {
  const { owner, by, at, reader } = await writtenNote(o, noteId);
  let made: Added | undefined;
  await tx(owner.pool, (c) => updateNote(owner, c, noteId, (n) => {
    const part = partOf(n, noteId, p.room);
    const grounds = linesOf(part.lines, p.lines, noteId);
    const there = part.questions.find((x) => x.text === p.text);
    if (there) { made = already(there, reader); return n; }
    if (part.questions.length >= MAX_ENTRIES) throw new ConflictError('There are too many open questions here to add another.', { context: { noteId } });
    const q: Question = { id: id128(), text: p.text, ...grounds, state: 'open', against: [], changes: [{ by, at, what: 'proposed' }] };
    made = { id: q.id, added: true, theirs: true };
    return part.put({ questions: inOrder([...part.questions, q]) });
  }));
  if (!made) throw unsaid(noteId);
  nlog.info('question added', { noteId, added: made.added, lines: p.lines?.length ?? 0, inRoom: p.room !== undefined, mine: owner.ownerId === o.ownerId });
  return made;
}

/**
 * Adds a follow-up the notes didn't hear, as `proposeDecision` does: straight onto the checklist, from Add a follow-up in
 * Alcove and from an agent's `add_follow_up` alike. Who it's for and when it's due are only suggestions until that person
 * takes it on, even when it's for whoever added it. Only the checklist counts as the same words: a suggestion waiting for
 * review, or one dismissed, with these words stays as it is beside the one added.
 */
export async function proposeAction(o: Owner, noteId: string, p: ActionProposal): Promise<Added> {
  const { owner, by, at, reader } = await writtenNote(o, noteId);
  const organizer = await me(owner);
  let made: Added | undefined;
  await tx(owner.pool, async (c) => {
    await lockItem(owner, c, noteId);
    const holding = await holders(owner, c, noteId);
    await updateNote(owner, c, noteId, (n) => {
      const part = partOf(n, noteId, p.room);
      const to = p.owner === undefined ? undefined : assignable(p.owner, organizer, holding, owner, { noteId });
      const grounds = linesOf(part.lines, p.lines, noteId);
      const checklist = part.actions.filter(isAcceptedFollowUp);
      const there = checklist.find((x) => x.text === p.text);
      if (there) { made = already(there, reader); return n; }
      if (checklist.length >= MAX_ENTRIES) throw new ConflictError('There are too many follow-ups here to add another.', { context: { noteId } });
      const a: ActionItem = {
        ...ACCEPTED_FOLLOW_UP, revision: id128(), id: id128(), text: p.text, ...(to ? { owner: to } : {}), takenOn: false, ...(p.due ? { due: p.due } : {}), done: false,
        ...grounds, against: [], changes: [{ by, at, what: 'proposed' }], from: null
      };
      made = { id: a.id, added: true, theirs: true };
      return part.put({ actions: inOrder([...part.actions, a]) });
    });
  });
  if (!made) throw unsaid(noteId);
  nlog.info('follow-up proposed', { noteId, added: made.added, lines: p.lines?.length ?? 0, inRoom: p.room !== undefined, assigned: p.owner !== undefined, mine: owner.ownerId === o.ownerId });
  return made;
}

/**
 * Says the notes got it wrong, this later call didn't replace that decision or answer that question, or takes that back.
 * Everyone with both notes sees who said so. Whoever is shown a revisit has both, so only they can: having this one
 * alone says nothing about the earlier call, and finds nothing here. For a decision it goes as far as the grants on
 * that decision do, in the earlier note (`maySayNotReplaced`): it settles the suggestion for all of them. Saying it
 * twice changes nothing.
 */
export async function updateRevisit(o: Owner, noteId: string, revisitId: string, patch: RevisitPatch): Promise<Note> {
  const { owner, note, by, reader, at } = await writtenNote(o, noteId);
  const r = note.manifest.revisits.find((x) => x.id === revisitId);
  if (!r) throw notFound('That later call', { noteId, revisitId });
  const earlier = await locate(o, r.noteId);
  if (r.kind === 'replaced') {
    const d = decisionsOf(earlier.note.manifest).find((x) => x.id === r.itemId);
    if (!d) throw notFound('That decision', { noteId, revisitId });
    if (!maySayNotReplaced(d, { ...reader, role: roleIn(earlier) })) {
      throw new ForbiddenError('Only the organizer, or whoever confirmed this decision, can say a later call didn’t replace it.', { context: { noteId, revisitId } });
    }
  }
  await tx(owner.pool, (c) => updateNote(owner, c, noteId, (n) => (
    n.revisits.some((x) => x.id === revisitId && Boolean(x.dismissed) !== patch.dismissed)
      ? { ...n, revisits: n.revisits.map((x) => (x.id === revisitId ? { ...x, dismissed: patch.dismissed ? { by, at } : null } : x)) } : n
  )));
  nlog.info('revisit changed', { noteId, revisitId, kind: r.kind, dismissed: patch.dismissed, mine: owner.ownerId === o.ownerId });
  return get(o, noteId);
}

/* ---------- correcting the transcript ---------- */

/** The most corrections a line keeps: who changed it and when. The first (what was heard) always stays, then the latest. */
const LINE_HISTORY = 20;
/**
 * Changes kept within a limit: the first, which says what something was to begin with; the latest of every kind, since
 * who may do what and what the note says are read from them (who proposed it, who confirmed it, who said it wasn't
 * theirs); and then as many of the latest as fit. Saying something and taking it back can't push those out.
 */
function kept(changes: Change[], limit: number): Change[] {
  if (changes.length <= limit) return changes;
  const keep = new Set<number>([0, ...new Map(changes.map((c, i) => [c.what, i])).values()]);
  for (let i = changes.length - 1; i >= 0 && keep.size < limit; i--) keep.add(i);
  return changes.filter((_, i) => keep.has(i));
}

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
    const corrected: TranscriptLine = { ...next, changes: kept([...(line.changes ?? []), ...changes], LINE_HISTORY) };
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
 * confirmed or changed by the time they're written stays (features/notes/writer.ts). Asking again while they're queued or
 * being written changes nothing, except a new `model`: it's saved for the job that's waiting to read it, and
 * refused while the notes are being written, which have read the old one. Call writer.kick after it.
 */
export async function rewrite(o: Owner, noteId: string, opts: { model?: string | null | undefined } = {}): Promise<Note> {
  const l = await locate(o, noteId);
  const m = l.note.manifest;
  if (!l.mine) throw new ForbiddenError('Only the organizer can have the notes written again.', { context: { noteId } });
  if (m.status === 'recording') throw new ConflictError('The notes are written once the recording stops.', { context: { noteId } });
  const roomLines = m.rooms.flatMap((r) => r.transcript);
  if (!m.transcript?.length && !roomLines.length) {
    throw new ConflictError(m.writtenAt === null ? 'Nothing was said while notes were on, so there’s nothing to write from.' : 'The transcript was deleted once the notes were written, so they can’t be written again.', { context: { noteId } });
  }
  if (m.status === 'ready') {
    const again = await tx(o.pool, async (c) => {
      // Holding the note while its job is looked for, so two asks at once queue one job.
      await lockItem(o, c, noteId);
      const job = await jobOf(o, c, noteId);
      // Another model: the notes keep it, and their frames are read again with it. A job that's queued or waiting reads
      // it when it starts; one being written now has read the old one already. The job keeps the model it replaced.
      const now = (await getItem(o, c, 'note', noteId, NoteManifest, 'Those notes')).manifest.model;
      if (opts.model !== undefined) {
        const model = opts.model;
        if (model !== now) {
          if (job?.state === 'writing') throw new ConflictError('The notes are being written now. Choose the model again once they’re done.', { context: { noteId } });
          await updateNote(o, c, noteId, (n) => ({ ...n, model }));
        }
      }
      if (job) return false;
      await queueNotes(o, c, noteId, m.recordingId, { model: now });
      return true;
    });
    if (again) {
      const all = [...(m.transcript ?? []), ...roomLines];
      nlog.info('notes job queued', { noteId, recordingId: m.recordingId, lines: m.transcript?.length ?? 0, roomLines: roomLines.length, again: true, corrected: all.filter((x) => x.changes?.length).length });
    }
  }
  return get(o, noteId);
}

/**
 * Stops the notes being written again, as the organizer asked: the job goes, and the AI model the notes had comes back.
 * Notes already being written finish the request they're on and save nothing (writer.ts). Frames taken for it go now;
 * any it takes before it notices go with it. Nothing to stop is nothing to do. The first notes, written when a call
 * ends, can't be stopped.
 */
export async function cancelRewrite(o: Owner, noteId: string): Promise<Note> {
  const l = await locate(o, noteId);
  if (!l.mine) throw new ForbiddenError('Only the organizer can stop the notes being written again.', { context: { noteId } });
  if (l.note.manifest.status !== 'ready') throw new ConflictError('The first notes for a call can’t be stopped.', { context: { noteId } });
  const stopped = await tx(o.pool, async (c) => {
    await lockItem(o, c, noteId);
    const job = await maybeOne(c, z.object({ job_id: z.string(), state: z.string(), job_ciphertext: bytea }), `SELECT job_id, state, job_ciphertext FROM content_jobs
      WHERE owner_id = $1 AND kind = 'notes' AND revision_id IN (SELECT revision_id FROM revisions WHERE owner_id = $1 AND item_id = $2) LIMIT 1`, [o.ownerId, noteId]);
    if (!job) return null;
    const { was } = openJson(jobKey(o, noteId), jobHeader(o, noteId), job.job_ciphertext, NotesJob);
    await exec(c, 'DELETE FROM content_jobs WHERE owner_id = $1 AND job_id = $2', [o.ownerId, job.job_id]);
    // A job that doesn't know the model before leaves the one chosen.
    const next = await updateNote(o, c, noteId, (n) => (!was || n.model === was.model ? n : { ...n, model: was.model }));
    return { state: job.state, left: await screens.dropUnshown(o, c, noteId, new Set(next.screens.map((x) => x.id))) };
  });
  if (stopped) {
    await queueDelete(o, stopped.left);
    nlog.info('notes rewrite cancelled', { noteId, state: stopped.state, frames: stopped.left.length });
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
    const given = [...fresh].map((email): SharedWith => ({ email, by, ...(to.group ? { group: to.group } : {}), at, link: false }));
    // Someone given the notes again, after removing them, is listed once: as they have them now.
    await updateNote(owner, c, id, (n) => ({ ...n, shared: [...n.shared.filter((s) => !fresh.has(s.email)), ...given] }));
    await grant(owner, c, id, [...fresh], 'shared');
    return fresh.size;
  });
  nlog.info('notes shared', { noteId: id, asked: wanted.length, added, toGroup: to.group !== undefined, byOrganizer: owner.ownerId === o.ownerId });
  return get(o, id);
}

/**
 * Gives a note to one more account, as shared by `by` through a link they made (links.ts), in the caller's transaction,
 * holding the note's lock. The organizer, and anyone who has it already, are skipped. Says whether they got it now.
 */
export async function giveByLink(owner: Owner, db: Db, noteId: string, email: string, organizerEmail: string, by: Sharer, at: string): Promise<boolean> {
  const address = email.trim().toLowerCase();
  if (same(address, organizerEmail) || (await holders(owner, db, noteId)).has(b64u(emailIndex(owner, address)))) return false;
  // Someone given the notes again, after removing them, is listed once: as they have them now.
  await updateNote(owner, db, noteId, (n) => ({ ...n, shared: [...n.shared.filter((x) => !same(x.email, address)), { email: address, by, at, link: true }] }));
  await grant(owner, db, noteId, [address], 'shared');
  return true;
}

/**
 * Deletes your own note for everyone (deleteOwnNote), its audio and shared-screen objects after the
 * commit, and your pin to it. Someone else's note is only removed from your notes, with your own notes
 * on it and the links you made to it: they can quote it, or hand it on, and you no longer have it.
 * What you added to the shared notes stays with them.
 * A call's note can't go while the call is on: the call is still writing to it, and everything live hangs
 * off it. Asked holding the note, as ending the call finishes it holding the note.
 */
export async function remove(o: Owner, id: string): Promise<void> {
  const l = await locate(o, id);
  if (!l.mine) {
    await tx(o.pool, async (c) => {
      await exec(c, 'DELETE FROM note_access WHERE owner_id = $1 AND note_item_id = $2 AND email_index = $3', [l.owner.ownerId, id, emailIndex(o, l.as)]);
      await personal.forget(c, o.ownerId, l.owner.ownerId, id);
      await links.forgetMade(o, c, l.owner.ownerId, id);
    });
    await unpin(o, id);
    nlog.info('shared note removed from my notes', { noteId: id });
    return;
  }
  const { ids, frames } = await tx(o.pool, async (c) => {
    await lockItem(o, c, id);
    const { kind, status } = (await getItem(o, c, 'note', id, NoteManifest, 'Those notes')).manifest;
    if (kind === 'call' && status === 'recording') throw new ConflictError('This call is still going. You can delete its notes once it ends.', { context: { noteId: id } });
    return deleteOwnNote(o, c, id);
  });
  await queueDelete(o, ids);
  await unpin(o, id);
  nlog.info('note deleted', { noteId: id, recordingId: l.note.manifest.recordingId, objects: ids.length, frames });
}

/**
 * Deletes one of this owner's notes for good, in the caller's transaction: every revision, its
 * recording and pieces, its shared screens' video and frames, its jobs, everyone's access, everyone's own notes on
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
  const video = await screens.videoObjects(o, db, id);
  const bytes = audio.bytes + shown.bytes + video.bytes;
  await exec(db, `DELETE FROM content_jobs WHERE owner_id = $1 AND revision_id IN (SELECT revision_id FROM revisions WHERE owner_id = $1 AND item_id = $2)`, [o.ownerId, id]);
  for (const m of (await listItems(o, db, 'meeting', MeetingManifest)).filter((x) => x.manifest.noteId === id)) {
    const { noteId: _drop, ...rest } = m.manifest;
    void _drop;
    await saveRevision(o, db, m.itemId, m.revisionId, rest);
  }
  await exec(db, 'DELETE FROM items WHERE owner_id = $1 AND item_id = $2', [o.ownerId, id]);
  if (bytes) await exec(db, 'UPDATE owners SET stored_bytes = greatest(0, stored_bytes - $2), version = version + 1 WHERE owner_id = $1', [o.ownerId, bytes]);
  await exec(db, 'DELETE FROM operations WHERE owner_id = $1', [o.ownerId]);
  return { ids: [...audio.ids, ...shown.ids, ...video.ids], frames: shown.ids.length };
}
