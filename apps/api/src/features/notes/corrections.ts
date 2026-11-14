/*
 * Putting a note right (docs: notes-and-inference › Correcting the transcript): correcting a line of its transcript, kept
 * with what it said before, and writing its notes again, with another model if that's chosen, or calling that off.
 */
import { type Change, type LinePatch, type Note, type Person, type Speaker, type TranscriptLine } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../../platform/context';
import { openJson } from '../../keys/crypto';
import { bytea, exec, maybeOne, tx } from '../../platform/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../platform/errors';
import { log } from '../../platform/log';
import { getItem, lockItem } from '../../keys/vault';
import { me } from '../profile/profile';
import { queueDelete } from '../../platform/objects';
import { nameOf, personOf } from '../profile/portraits';
import * as screens from '../recordings/screens/screens';
import { NoteManifest, updateNote, same, queueNotes, jobKey, jobHeader, NotesJob } from './manifest';
import { writtenNote, kept } from './entries';
import { get, jobOf } from './service';
import { locate } from './access';

const nlog = log.child({ component: 'notes' });

/* ---------- correcting the transcript ---------- */

/** The most corrections a line keeps: who changed it and when. The first (what was heard) always stays, then the latest. */
const LINE_HISTORY = 20;

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
    if (n.status !== 'ready') throw new ConflictError('These notes are still being written.', { context: { noteId, state: n.status } });
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
 * confirmed or changed by the time they're written stays (features/notes/writing/writer.ts). Asking again while they're queued or
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
