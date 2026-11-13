/*
 * Reading notes (docs: notes-and-inference): a note as each reader may have it, the list and search of someone's notes, what
 * a note's page plays and shows, its progress, asking about one note or all of them, what's waiting on someone, and taking
 * a note out of their notes. The stored note is ./manifest.ts; who has one, ./access.ts.
 */
import {
  isAcceptedFollowUp, isAssignee, isBy, isProposer, mayDecide, minutesLabel, nameWords, searchOf, startsName, termsSaidIn, type AnswerPart, type Decision, type Inbox, type Note, type NoteFound,
  type NoteKind, type NoteProgress, type NoteReader, type NoteSaid, type NoteSearch, type NoteSummary, type OpenAction, type PendingDecision, type Person, type TranscriptLine
} from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../../platform/context';
import { exec, maybeOne, rows, tx, type Db } from '../../platform/db';
import { ConflictError, ForbiddenError, ValidationError, notFound } from '../../platform/errors';
import { inference } from '../../inference/inference';
import { log } from '../../platform/log';
import { findItem, getItem, listItems, lockItem, saveRevision } from '../../keys/vault';
import { me, profile, unpin } from '../profile/profile';
import { resolveModel } from '../../inference/models';
import * as additions from './additions';
import { noteObjects, segments } from '../recordings/audio';
import { queueDelete } from '../../platform/objects';
import { entriesOf } from './backing';
import { answer, answerFromNotes, type NoteBrief } from './writing/answers';
import { briefOf } from './writing/brief';
import { meterFor } from '../billing/meter/meter';
import { MeetingManifest } from '../meetings/service';
import * as personal from './personal/personal';
import * as links from './links/links';
import { personOf } from '../profile/portraits';
import * as screens from '../recordings/screens/screens';
import { workedOnFor } from './worked-on';
import { licensedOn } from '../billing/teams/teams';
import { homeFor } from './home';
import { NoteManifest, partsOf, same, decisionsOf, actionsOf, everyoneWith, recordUnencryptedUse, emailIndex } from './manifest';
import { type Seen, everyNote, myEmail, teamNotes, summary, locate, asRead, type Located, sharedWithMe, recipients, locateToRead, summaryOf, teamVisible, goneSince, viaTeam } from './access';
import { roleIn } from './entries';

const nlog = log.child({ component: 'notes' });
/** Whether a note holds anything that was said, in the main room or any breakout room. */
const said = (m: NoteManifest): boolean => !!m.transcript?.length || m.rooms.some((r) => r.transcript.length > 0);

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
  const { l, writingAgain } = await readWithJob(o, id);
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
    gaps: m.gaps, screens: m.screens, transcript: read.transcript, rooms, additions: await additions.of(l, o.ownerId), writtenAt: m.writtenAt, writingAgain,
    details: m.details, suggestedQuestions: m.suggestedQuestions, audio: await segments(l.owner, m.recordingId), kept: m.keep, inference: m.inference, workedOn: await workedOnFor(o, m.workedOn, everyoneWith(m, organizer.email)),
    shares: m.keep.recording ? await screens.shareIntervals(l.owner, m.recordingId, m.segmentSeconds) : [], model: m.model, unencrypted: m.unencrypted,
    home: await homeFor(o, id, call?.workspaceId ?? null)
  };
}
const HeadAndJob = z.object({ head: z.string(), writing: z.boolean() });
/**
 * A note as this person may read it, and whether its notes are being written again, as of one moment. Notes written again
 * are saved and their job dropped in one transaction (writer.ts), so a note read just before that, with its job looked
 * for just after, would pass the notes from before off as the ones written again: the app would stop waiting, and show
 * them. One statement says both whether there's a job and which revision is the head, and a note that changed since it
 * was read is read again: what's said of its job is never newer than the note.
 */
async function readWithJob(o: Owner, id: string): Promise<{ l: Seen; writingAgain: boolean }> {
  const l = await locateToRead(o, id);
  // Notes still being written the first time say so themselves: only written notes are written again.
  if (l.note.manifest.status !== 'ready') return { l, writingAgain: false };
  const now = await maybeOne(l.owner.pool, HeadAndJob, `SELECT i.current_revision_id AS head, EXISTS (SELECT 1 FROM content_jobs j WHERE j.owner_id = $1 AND j.kind = 'notes'
      AND j.revision_id IN (SELECT revision_id FROM revisions WHERE owner_id = $1 AND item_id = $2)) AS writing
    FROM items i WHERE i.owner_id = $1 AND i.item_id = $2`, [l.owner.ownerId, id]);
  if (!now || now.head === l.note.revisionId) return { l, writingAgain: now?.writing ?? false };
  nlog.debug('note changed as it was read; read again', { noteId: id, writing: now.writing });
  const again = await locateToRead(o, id);
  return { l: again, writingAgain: again.note.manifest.status === 'ready' && now.writing };
}
/** A note's notes job while its notes are queued or being written, whichever of its revisions it was queued for. */
export async function jobOf(o: Owner, db: Db, noteId: string) {
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
 * team they're live-licensed on; the ones with notes written or a transcript they can read (features/notes/writing/answers.ts
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
