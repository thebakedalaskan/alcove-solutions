/**
 * What a call's notes keep (docs: Notes and inference › What's kept, and for how long), end to end: the real API over
 * HTTP via @alcove/api-http, real Postgres, the object store, LiveKit and the fake NEAR AI. "Deleted" is checked where
 * it would still be otherwise: every revision of the note, opened with its owner's keys; the rows beside it; the bucket.
 */
import { AlcoveApiError, DEFAULT_NOTES_CHOICES, firstName, type AlcoveApi, type AnswerPart, type AudioPiece, type CallSession, type CallState, type MeetingInput, type NoteProgress, type NotesChoices, type ScreenPiece, type TranscriptClip } from '@alcove/api';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { openJson, openKey } from '../../keys/crypto';
import { tx } from '../../platform/db';
import { maintain } from '../../maintenance';
import { openOwner } from '../../keys/owners';
import { speechWav } from '../../testing/fakes/near';
import { startHarness, type Harness } from '../../testing/harness';
import { disposeLiveKit, presentScreen, stopPresenting, type TestParticipant } from '../../testing/livekit';
import { cut, recordedWebm } from '../../testing/video';
import { getItem, saveRevision } from '../../keys/vault';

// Sharing a screen goes through a real LiveKit server, which a busy CI runner can be slow to set up.
vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
const open: TestParticipant[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map((p) => p.disconnect().catch(() => undefined))); await stopPresenting(); h.closeCalls(); });

const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
const message = (e: unknown) => (e instanceof AlcoveApiError ? e.message : '');
const fails = (p: Promise<unknown>) => p.then(() => 'succeeded', (e: unknown) => [code(e), message(e)]);
let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session };
}
type Account = Awaited<ReturnType<typeof account>>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean | Promise<boolean>, what: string, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}
const audioBytes = (marker: string) => { const src = Buffer.concat([Buffer.from(marker), randomBytes(2048)]); const out = new Uint8Array(new ArrayBuffer(src.length)); out.set(src); return out; };
/** A piece of audio, number `at` of its segment: five seconds of it unless said otherwise. */
const piece = (marker: string, segment: number, at: number, durationMs = 5000): AudioPiece => ({ data: new Blob([audioBytes(marker)]), segment, seq: at, at: at * 5, durationMs, mimeType: 'audio/webm;codecs=opus' });
const screenPiece = (share: string, i: number, data: Uint8Array<ArrayBuffer>): ScreenPiece => ({ data: new Blob([data]), share, segment: 0, seq: i, at: i * 5, durationMs: 5000, mimeType: 'video/webm;codecs=vp8' });
const speech = (words: string, segment: number, atMs: number, ms = 6000): TranscriptClip => ({ data: new Blob([speechWav(words, ms)], { type: 'audio/wav' }), segment, at: atMs / 1000, durationMs: ms });
/** Every step until the notes are written. `first`: called once the first step is in. */
async function written(api: AlcoveApi, noteId: string, first?: (() => void) | undefined): Promise<NoteProgress[]> {
  const steps: NoteProgress[] = [];
  for await (const p of api.notes.progress(noteId)) { steps.push(p); if (steps.length === 1) first?.(); }
  return steps;
}
/** Answers the notes model still holds, given after each test: one that failed part-way leaves nothing waiting. */
const holds: (() => void)[] = [];
afterEach(() => { for (const answer of holds.splice(0)) answer(); });
/** The notes model keeps its next answer until the returned function is called: the notes are being written until then. */
function holdNotes(): () => void {
  let answer = () => {};
  const answered = new Promise<void>((r) => { answer = () => r(); });
  h.near.holdNext(() => answered);
  holds.push(() => answer());
  return () => answer();
}
async function asked(api: AlcoveApi, noteId: string, question: string): Promise<AnswerPart[]> {
  const parts: AnswerPart[] = [];
  for await (const p of api.notes.ask(noteId, question)) parts.push(p);
  return parts;
}
async function askedAll(api: AlcoveApi, question: string): Promise<AnswerPart[]> {
  const parts: AnswerPart[] = [];
  for await (const p of api.notes.askAll(question)) parts.push(p);
  return parts;
}

/** Scheduled to keep what `choices` says, and joined by its organizer. */
async function held(org: Account, choices: Partial<NotesChoices>, more: Partial<MeetingInput> = {}) {
  const meeting = await org.api.meetings.create({
    title: 'Supplier review', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, guests: [], notes: 'on', choices: { ...DEFAULT_NOTES_CHOICES, ...choices }, ...more
  });
  return { meeting, call: await org.api.calls.join(meeting.code, { mic: true, cam: false }) };
}
const noteOf = async (call: CallSession) => { const end = await call.leave(); if (!end?.pendingNoteId) throw new Error('the call left no note'); return end.pendingNoteId; };

/*
 * Three things said in one clip. What the fake's notes make of it: the first is a decision, the last ends the summary,
 * and the first and the last are chapters, so the words between them are in the transcript and nowhere else.
 */
const DECIDED = 'We agreed to ship on Monday.';
const CANARY = 'Halberd-and-Sons-canary';
const SAID = `${DECIDED} // The supplier is ${CANARY} for now. // Thanks everyone, talk soon.`;

const Text = z.object({ n: z.coerce.number() });
const count = async (sql: string, params: unknown[]) => Text.parse((await h.pool.query(`SELECT count(*) AS n ${sql}`, params)).rows[0]).n;
const StoredRevision = z.object({ revision_id: z.string(), parent_revision_id: z.string().nullable(), key_envelope: z.instanceof(Uint8Array), manifest_ciphertext: z.instanceof(Uint8Array) });
/** Every revision of a note as it's stored, opened with its owner's keys: what's there, whatever the note's head says. */
async function revisionsOf(ownerId: string, noteId: string) {
  const o = await openOwner(h.deps, ownerId, undefined);
  const found = z.array(StoredRevision).parse((await h.pool.query('SELECT revision_id, parent_revision_id, key_envelope, manifest_ciphertext FROM revisions WHERE owner_id = $1 AND item_id = $2', [ownerId, noteId])).rows);
  return found.map((r) => {
    const k = openKey(o.wrapKey, ownerId, `revision:${r.revision_id}`, r.key_envelope, '1');
    const header = { v: 1, kind: 'manifest', ownerId, itemId: noteId, revisionId: r.revision_id, recordId: r.revision_id, keyVersion: '1' } as const;
    return { parent: r.parent_revision_id, text: JSON.stringify(openJson(k, header, r.manifest_ciphertext, z.unknown())) };
  });
}
const Piece = z.object({ object_id: z.string(), recording_id: z.string() });
const piecesOf = async (ownerId: string) => z.array(Piece).parse((await h.pool.query('SELECT object_id, recording_id FROM recording_pieces WHERE owner_id = $1', [ownerId])).rows);
const inBucket = (id: string) => h.objects.get(id).then(() => true, () => false);
const storedBytes = async (ownerId: string) => z.object({ stored_bytes: z.coerce.number() }).parse((await h.pool.query('SELECT stored_bytes FROM owners WHERE owner_id = $1', [ownerId])).rows[0]).stored_bytes;
const job = async (ownerId: string) => z.array(z.object({ state: z.string(), attempt: z.number() })).parse((await h.pool.query('SELECT state, attempt FROM content_jobs WHERE owner_id = $1', [ownerId])).rows)[0];
const retryNow = async (ownerId: string) => {
  await h.pool.query(`UPDATE content_jobs SET lease_until = now() - interval '1 second' WHERE owner_id = $1`, [ownerId]);
  await maintain(h.deps);
};
/** The note's audio, as a browser asks for it. */
const audioStatus = async (who: Account, noteId: string, segment: number) => (await who.fetch(who.api.notes.audioUrl(noteId, segment, 1))).status;
/** A server with no notes service: on it, a stopped recording's job waits, as in any deployment before NEAR AI is connected. */
async function leaveOn(baseUrl: string, org: Account, call: CallSession): Promise<string> {
  const res = await org.fetch(`${baseUrl}/v1/live/calls/${call.ticket.callId}/leave`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-alcove-call': call.ticket.pass }, body: JSON.stringify({ end: true }) });
  expect(res.status).toBe(200);
  return z.object({ ended: z.object({ pendingNoteId: z.string() }) }).parse(await res.json()).ended.pendingNoteId;
}

describe('keeping the transcript', () => {
  it('writes the notes from it and then deletes it from every revision, for the organizer and everyone invited', async () => {
    const org = await account(unique('organizer'));
    const invitedEmail = unique('invited');
    const invited = await account(invitedEmail);
    const { call } = await held(org, { keepTranscript: false }, { guests: [invitedEmail] });
    await call.appendAudio(piece('kept', 0, 0));
    await call.transcribe(speech(SAID, 0, 0), call.ticket.identity);
    expect(await count('FROM transcript_clips WHERE owner_id = $1', [org.session.ownerId])).toBe(1);
    // A receipt from scheduling it: answers are copied into them, so they go with the transcript.
    expect(await count('FROM operations WHERE owner_id = $1', [org.session.ownerId])).toBeGreaterThan(0);
    const answer = holdNotes();
    const noteId = await noteOf(call);

    // While the notes are being written it's there to write them from, and the organizer's alone: the note says what will happen to it.
    expect(await org.api.notes.get(noteId)).toMatchObject({ status: 'pending', kept: { transcript: false, recording: true } });
    expect((await org.api.notes.get(noteId)).transcript?.map((l) => l.text)).toEqual(expect.arrayContaining([expect.stringContaining(CANARY)]));
    expect(await invited.api.notes.get(noteId)).toMatchObject({ status: 'pending', transcript: [], kept: { transcript: false, recording: true } });
    expect((await org.api.notes.list({ text: CANARY })).map((n) => n.id)).toEqual([noteId]);
    expect(await invited.api.notes.list({ text: CANARY })).toEqual([]);
    // A search that finds the note by its title quotes nothing to anyone who can't read what was said.
    expect((await org.api.notes.list({ text: `Supplier ${CANARY}` }))[0]?.said.map((l) => l.text)).toEqual([expect.stringContaining(CANARY)]);
    expect((await invited.api.notes.list({ text: 'Supplier review' }))[0]).toMatchObject({ id: noteId, said: [], saidCount: 0 });
    // Nor through who said it: the organizer's address and first name find their lines for the organizer alone.
    const first = firstName(org.session.user.name);
    const lines = [DECIDED, `The supplier is ${CANARY} for now.`, 'Thanks everyone, talk soon.'];
    expect(await invited.api.notes.list({ by: org.session.user.email })).toEqual([]);
    expect(await invited.api.notes.list({ text: first })).toEqual([]);
    expect((await org.api.notes.list({ by: org.session.user.email }))[0]?.said.map((l) => l.text)).toEqual(lines);
    expect((await org.api.notes.list({ text: first }))[0]?.said.map((l) => l.text)).toEqual(lines);
    expect((await revisionsOf(org.session.ownerId, noteId)).some((r) => r.text.includes(CANARY))).toBe(true);

    const steps = await written(org.api, noteId, answer);
    expect(steps.at(0)?.steps[2]?.label).toBe('Transcript of 3 lines, deleted once the notes are written');
    expect(steps.at(-1)?.steps[2]?.label).toBe('The transcript was deleted once the notes were written');
    const note = await org.api.notes.get(noteId);
    expect(note).toMatchObject({ status: 'ready', transcript: [], writtenAt: expect.any(String), kept: { transcript: false, recording: true } });
    expect(note.decisions.map((d) => d.text)).toEqual([DECIDED]);
    expect(note.summary).toContain('Heard 3 lines');
    // Only the transcript goes: the recording of this call was kept.
    expect(note.audio).toHaveLength(1);
    expect(await audioStatus(org, noteId, 0)).toBe(200);
    expect(await invited.api.notes.get(noteId)).toMatchObject({ transcript: [], decisions: [{ text: DECIDED }] });

    // Nothing holds it any more: one revision, with nothing before it, and no row or receipt.
    const revisions = await revisionsOf(org.session.ownerId, noteId);
    expect(revisions.map((r) => r.parent)).toEqual([null]);
    expect(revisions.some((r) => r.text.includes(CANARY))).toBe(false);
    for (const table of ['transcript_clips', 'transcript_translations', 'content_jobs', 'operations']) expect(await count(`FROM ${table} WHERE owner_id = $1`, [org.session.ownerId]), table).toBe(0);
    expect(await org.api.notes.list({ text: CANARY })).toEqual([]);

    // What people do with the notes from then on keeps going, and brings nothing back.
    await org.api.notes.updateDecision(noteId, note.decisions[0]?.id ?? '', { state: 'confirmed', seen: { text: note.decisions[0]?.text ?? '' } });
    const later = await revisionsOf(org.session.ownerId, noteId);
    expect(later).toHaveLength(2);
    expect(later.some((r) => r.text.includes(CANARY))).toBe(false);

    // It can't be corrected, and the notes can't be written again: there's nothing left to do it from.
    expect(await fails(org.api.notes.rewrite(noteId))).toEqual(['conflict', 'The transcript was deleted once the notes were written, so they can’t be written again.']);
    expect(code(await org.api.notes.correctLine(noteId, 'any-line', { text: 'Not said.' }).catch((e: unknown) => e))).toBe('not-found');

    // Asking answers from the notes, for anyone who has them.
    for (const who of [org, invited]) {
      expect((await asked(who.api, noteId, 'When do we ship?'))[0]?.type).toBe('text');
      const prompt = h.near.prompts.at(-1) ?? '';
      expect(prompt).toContain(DECIDED);
      expect(prompt).toContain('It ended on: Thanks everyone, talk soon.');
      expect(prompt).toContain('The transcript was deleted once the notes were written.');
      expect(prompt).not.toContain(CANARY);
    }
    // And so does asking across notes, which used to go only by transcripts.
    const sent = h.near.prompts.length;
    expect((await askedAll(invited.api, 'When do we ship?'))[0]?.type).toBe('text');
    expect(h.near.prompts.length).toBe(sent + 1);
    expect(h.near.prompts.at(-1)).toContain(DECIDED);
    expect(h.near.prompts.at(-1)).not.toContain(CANARY);
  });

  it('keeps it when the notes can’t be written, so the organizer can have them written, and deletes it when they are', async () => {
    const org = await account(unique('organizer'));
    const invitedEmail = unique('invited');
    const invited = await account(invitedEmail);
    const { meeting, call } = await held(org, { keepTranscript: false }, { guests: [invitedEmail] });
    await call.appendAudio(piece('kept', 0, 0, 90_000));
    await call.transcribe(speech(SAID, 0, 0), call.ticket.identity);
    h.near.failNext(3, 'prose');
    const noteId = await noteOf(call);
    await waitFor(async () => (await job(org.session.ownerId))?.state === 'queued' && (await job(org.session.ownerId))?.attempt === 1, 'the first attempt to fail');
    await retryNow(org.session.ownerId);
    await retryNow(org.session.ownerId);
    expect(await job(org.session.ownerId)).toBeUndefined();

    // Finished without notes: the organizer still reads what was said, so the note can say why.
    const unwritten = await org.api.notes.get(noteId);
    expect(unwritten).toMatchObject({ status: 'ready', summary: '', writtenAt: null, kept: { transcript: false, recording: true } });
    expect(unwritten.transcript).toHaveLength(3);
    expect((await revisionsOf(org.session.ownerId, noteId)).some((r) => r.text.includes(CANARY))).toBe(true);

    // Everyone else gets the notes, not the transcript they'd be written from, whichever way they ask for it.
    expect(await invited.api.notes.get(noteId)).toMatchObject({ transcript: [], writtenAt: null });
    expect(await invited.api.notes.list({ text: CANARY })).toEqual([]);
    expect(await fails(asked(invited.api, noteId, 'Who is the supplier?'))).toEqual(['conflict', 'These notes aren’t written yet, so there’s nothing to ask about.']);
    // Their own notes read a moment for them, and it's no way round: a bookmark there reaches nothing that was said.
    const own = invited.api.notes.personal(noteId);
    for (const line of unwritten.transcript ?? []) {
      expect(JSON.stringify(await own.add({ kind: 'bookmark', label: 'That moment', point: { kind: 'moment', at: line.at } }).catch(() => null))).not.toContain(CANARY);
      expect(await fails(own.add({ kind: 'bookmark', label: 'That line', point: { kind: 'line', lineId: line.id } }))).toEqual(['not-found', 'That moment doesn’t exist, or you don’t have access to it.']);
    }
    const sent = h.near.prompts.length;
    expect((await askedAll(invited.api, 'Who is the supplier?'))[0]).toMatchObject({ type: 'text', text: 'You don’t have any notes to answer from yet.' });
    expect(h.near.prompts.length).toBe(sent);
    const next = await org.api.meetings.scheduleNext(meeting.id, new Date(Date.now() + 7 * 86_400_000).toISOString());
    const askSeries = async () => { for await (const part of invited.api.series.ask(next.seriesId ?? '', 'Who is the supplier?', 'Europe/London')) return part; return null; };
    expect(code(await askSeries().catch((e: unknown) => e))).toBe('conflict');
    expect(h.near.prompts.length).toBe(sent);

    // The organizer can correct it, and ask from it, as with any transcript.
    const line = unwritten.transcript?.find((l) => l.text.includes(CANARY));
    await org.api.notes.correctLine(noteId, line?.id ?? '', { text: `The supplier is ${CANARY} from now on.` });
    expect((await asked(org.api, noteId, 'Who is the supplier?'))[0]).toMatchObject({ type: 'text', text: expect.stringContaining(CANARY) });

    // Asked to, it writes them, and the transcript goes.
    expect(await org.api.notes.rewrite(noteId)).toMatchObject({ writingAgain: true });
    await written(org.api, noteId);
    const note = await org.api.notes.get(noteId);
    expect(note).toMatchObject({ status: 'ready', transcript: [], writtenAt: expect.any(String), decisions: [{ text: DECIDED }] });
    const revisions = await revisionsOf(org.session.ownerId, noteId);
    expect(revisions.map((r) => r.parent)).toEqual([null]);
    expect(revisions.some((r) => r.text.includes(CANARY))).toBe(false);
  });
});

describe('keeping the recording', () => {
  it('deletes the audio when the call ends, while what was worked out from it stays: where lines fall and gaps', async () => {
    const org = await account(unique('organizer'));
    const { call } = await held(org, { keepRecording: false });
    // A minute, a pause, then half a minute more: lines are placed in the recording by the audio before them.
    await call.appendAudio(piece('gone-a', 0, 0, 60_000));
    await call.transcribe(speech('Before the pause.', 0, 1000), call.ticket.identity);
    await call.pause();
    await sleep(300);
    await call.resume();
    await call.appendAudio(piece('gone-b', 1, 0, 30_000));
    await call.transcribe(speech('After the pause.', 1, 1000), call.ticket.identity);
    const ids = (await piecesOf(org.session.ownerId)).map((p) => p.object_id);
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(await inBucket(id)).toBe(true);
    expect(await storedBytes(org.session.ownerId)).toBeGreaterThan(0);
    const answer = holdNotes();
    const noteId = await noteOf(call);

    // Gone with the call, before any notes are written.
    expect(await piecesOf(org.session.ownerId)).toEqual([]);
    for (const id of ids) expect(await inBucket(id)).toBe(false);
    expect(await storedBytes(org.session.ownerId)).toBe(0);
    expect(await org.api.notes.get(noteId)).toMatchObject({ status: 'pending', audio: [], kept: { transcript: true, recording: false } });
    answer();
    const steps = await written(org.api, noteId);
    expect(steps.at(-1)?.steps[1]?.label).toBe('The recording was deleted when the call ended');

    const note = await org.api.notes.get(noteId);
    expect(note).toMatchObject({ status: 'ready', audio: [], gaps: [{ kind: 'paused', at: 60 }], kept: { transcript: true, recording: false } });
    expect(note.transcript?.map((l) => [l.at, l.text])).toEqual([[1, 'Before the pause.'], [61, 'After the pause.']]);
    expect(await audioStatus(org, noteId, 0)).toBe(404);
    // The recording's row stays, stopped: its key seals the shared screens.
    expect(await count(`FROM recordings WHERE owner_id = $1 AND note_item_id = $2 AND state = 'stopped'`, [org.session.ownerId, noteId])).toBe(1);
  });

  it('doesn’t wait for the notes service: without one the audio still goes when the call ends', async () => {
    const org = await account(unique('organizer'));
    const { call } = await held(org, { keepRecording: false });
    await call.appendAudio(piece('gone', 0, 0, 90_000));
    await call.transcribe(speech(SAID, 0, 0), call.ticket.identity);
    const [gone] = await piecesOf(org.session.ownerId);
    const plain = await h.secondServer({ NEAR_AI_API_KEY: undefined });
    try {
      const noteId = await leaveOn(plain.baseUrl, org, call);
      expect(await job(org.session.ownerId)).toMatchObject({ state: 'queued' });
      expect(await piecesOf(org.session.ownerId)).toEqual([]);
      expect(await inBucket(gone?.object_id ?? '')).toBe(false);
      // And once there is one, the notes are written from what the note saved.
      await retryNow(org.session.ownerId);
      expect(await org.api.notes.get(noteId)).toMatchObject({ status: 'ready', decisions: [{ text: DECIDED }] });
    } finally {
      await plain.close();
    }
  });

  it('refuses a piece still on its way when the call ends, and deletes what it left behind', async () => {
    const org = await account(unique('organizer'));
    const { call } = await held(org, { keepRecording: false });
    await call.appendAudio(piece('stored', 0, 0));
    const stored = await storedBytes(org.session.ownerId);
    // The next piece is past every check, and sealed in the bucket, when the call ends.
    const read = h.deps.objects.get;
    let late = '';
    let release = (): void => undefined;
    const released = new Promise<void>((r) => { release = r; });
    h.deps.objects.get = async (id) => { late = id; await released; return read(id); };
    const sending = call.appendAudio(piece('late', 0, 1)).then(() => 'stored', (e: unknown) => [code(e), message(e)]);
    await waitFor(() => late !== '', 'the piece to reach the bucket');
    h.deps.objects.get = read;
    expect(await inBucket(late)).toBe(true);
    await call.leave();
    release();
    expect(await sending).toEqual(['conflict', 'This recording has already stopped.']);
    expect(await piecesOf(org.session.ownerId)).toEqual([]);
    expect(await inBucket(late)).toBe(false);
    expect(await storedBytes(org.session.ownerId)).toBeLessThan(stored);
  });

  it('purges again when the notes are written, in case anything got in after the call ended', async () => {
    const org = await account(unique('organizer'));
    const { call } = await held(org, { keepRecording: false });
    await call.appendAudio(piece('stored', 0, 0));
    await call.transcribe(speech(SAID, 0, 0), call.ticket.identity);
    const [first] = await piecesOf(org.session.ownerId);
    h.near.slowNext(1500);
    const noteId = await noteOf(call);
    // As a piece from the release before this one could, which put it in with no check of the recording's state.
    const objectId = randomBytes(16).toString('base64url');
    await h.objects.put(objectId, audioBytes('straggler'));
    await h.pool.query(`INSERT INTO recording_pieces (owner_id, recording_id, segment, seq, at_ms, object_id, cipher_sha256, cipher_bytes, duration_ms, mime_type)
                        VALUES ($1, $2, 0, 9, 45000, $3, $4, 100, 5000, 'audio/webm')`, [org.session.ownerId, first?.recording_id, objectId, Buffer.alloc(32)]);
    await h.pool.query('UPDATE owners SET stored_bytes = stored_bytes + 100 WHERE owner_id = $1', [org.session.ownerId]);
    await written(org.api, noteId);
    expect(await piecesOf(org.session.ownerId)).toEqual([]);
    expect(await inBucket(objectId)).toBe(false);
    expect(await storedBytes(org.session.ownerId)).toBe(0);
  });

  it('retries an object the store refused to delete', async () => {
    const org = await account(unique('organizer'));
    const { call } = await held(org, { keepRecording: false });
    await call.appendAudio(piece('stored', 0, 0));
    const [stored] = await piecesOf(org.session.ownerId);
    const remove = h.deps.objects.delete;
    h.deps.objects.delete = () => Promise.reject(new Error('the store said no'));
    await call.leave();
    h.deps.objects.delete = remove;
    expect(await piecesOf(org.session.ownerId)).toEqual([]);
    expect(await count('FROM object_gc WHERE object_id = $1', [stored?.object_id])).toBe(1);
    await maintain(h.deps);
    expect(await inBucket(stored?.object_id ?? '')).toBe(false);
    expect(await count('FROM object_gc WHERE object_id = $1', [stored?.object_id])).toBe(0);
  });

  it('doesn’t tell the call what was captured is kept when it won’t be', async () => {
    const org = await account(unique('organizer'));
    const { call } = await held(org, { keepRecording: false });
    await call.setNotes(false);
    expect(call.getSnapshot().notices.at(-1)?.text).toBe('The organizer turned off notes. What was captured so far still goes into the notes.');
    await call.leave();
  });

  it('keeps the shared screens the notes attach, which its key seals, but not their video, and with neither kept the notes still stand on their own', async () => {
    const org = await account(unique('organizer'));
    const { call } = await held(org, { keepTranscript: false, keepRecording: false, allowScreens: true });
    await presentScreen(call, h.deps.livekit);
    const { share } = await call.startShare({ notes: true });
    for (const [i, data] of cut(await recordedWebm(10), 2).entries()) await call.appendScreen(screenPiece(share, i, data));
    await call.shareEnded(share);
    await call.appendAudio(piece('gone', 0, 0));
    await call.transcribe(speech(`${SAID} // As you can see the chart is up.`, 0, 0), call.ticket.identity);
    const noteId = await noteOf(call);
    await written(org.api, noteId);
    const note = await org.api.notes.get(noteId);
    expect(note).toMatchObject({ status: 'ready', transcript: [], audio: [], kept: { transcript: false, recording: false }, decisions: [{ text: DECIDED }] });
    // The frames the notes attached stay; the video they were taken from goes with the recording, so there's no replay.
    expect(note.shares).toEqual([]);
    expect((await h.pool.query('SELECT 1 FROM screen_videos WHERE owner_id = $1', [org.session.ownerId])).rowCount).toBe(0);
    const [moment] = note.screens;
    expect(moment?.share).toBe(share);
    expect((await org.fetch(org.api.notes.screenUrl(noteId, moment?.id ?? ''))).status).toBe(200);
    expect(await piecesOf(org.session.ownerId)).toEqual([]);
    expect(await revisionsOf(org.session.ownerId, noteId)).toHaveLength(1);
  });
});

/*
 * Breakout rooms. Each room's words go as SAID does: the first is a decision, the last ends the room's summary, and the
 * words between are in that room's transcript and nowhere else.
 */
const BLUE = 'We agreed on blue buttons.';
const DESIGN_CANARY = 'Mauve-Ridge-canary';
const DESIGN_SAID = `${BLUE} // The printer is ${DESIGN_CANARY} this year. // Right, back to the others.`;
const QUEUE = 'We decided to close the queue at five.';
const SUPPORT_CANARY = 'Tern-Harbour-canary';
const SUPPORT_SAID = `${QUEUE} // The bank is ${SUPPORT_CANARY} for now. // Right, see you back there.`;
const NO_TRANSCRIPT = 'The transcript was deleted once the notes were written.';

async function settle(call: CallSession, pred: (s: CallState) => boolean): Promise<CallState> {
  for (let i = 0; i < 100 && !pred(call.getSnapshot()); i++) { await call.refresh(); await sleep(30); }
  return call.getSnapshot();
}
const inGroup = (call: CallSession) => waitFor(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
/** A call set to keep what `choices` says, with its organizer and two people invited, each with an account, all in the main room's group. */
async function roomsCall(choices: Partial<NotesChoices>) {
  const org = await account(unique('organizer'));
  const emails = [unique('kofi'), unique('lena')];
  const { meeting, call: host } = await held(org, choices, { guests: emails });
  await inGroup(host);
  const [kofi, lena] = await Promise.all(emails.map(async (email) => {
    const browser = await account(email);
    const call = await browser.api.calls.join(meeting.code, { mic: true, cam: false });
    await inGroup(call);
    return { email, browser, call };
  }));
  if (!kofi || !lena) throw new Error('two people were invited');
  return { org, host, kofi, lena };
}
type Invited = Awaited<ReturnType<typeof roomsCall>>['kofi'];
/** Kofi sent to Design and Lena to Support, each there and the scribe of the room, the only person in it. */
async function rooms(host: CallSession, kofi: Invited, lena: Invited): Promise<void> {
  host.openRooms({ rooms: [{ name: 'Design', emails: [kofi.email] }, { name: 'Support', emails: [lena.email] }], minutes: 10, board: { mode: 'none', template: 'blank' } });
  await settle(host, (s) => s.breakouts.open !== null);
  for (const who of [kofi, lena]) {
    const state = await settle(who.call, (s) => s.capture.room?.scribe === who.call.ticket.identity);
    expect(state.capture.room?.scribe).toBe(who.call.ticket.identity);
  }
}
/** What was said in every part of a call: the main room, then each room by its scribe. */
async function talked(host: CallSession, kofi: Invited, lena: Invited): Promise<void> {
  await host.transcribe(speech(SAID, 0, 0), host.ticket.identity);
  await rooms(host, kofi, lena);
  await kofi.call.transcribe(speech(DESIGN_SAID, 0, 2000), kofi.call.ticket.identity);
  await lena.call.transcribe(speech(SUPPORT_SAID, 0, 2000), lena.call.ticket.identity);
}
const holding = async (ownerId: string, noteId: string) => (await revisionsOf(ownerId, noteId)).map((r) => r.text);
const anyHolds = async (ownerId: string, noteId: string, canary: string) => (await holding(ownerId, noteId)).some((text) => text.includes(canary));

describe('a call with breakout rooms', () => {
  it('writes each room’s notes and then deletes every transcript, from every revision, for the organizer and everyone invited', async () => {
    const { org, host, kofi, lena } = await roomsCall({ keepTranscript: false });
    const { ownerId } = org.session;
    await host.appendAudio(piece('kept', 0, 0));
    await talked(host, kofi, lena);
    expect(await count('FROM transcript_clips WHERE owner_id = $1', [ownerId])).toBe(3);
    const answer = holdNotes();
    const noteId = await noteOf(host);

    // While the notes are being written the rooms' transcripts are there to write them from, and the organizer's alone.
    const pending = await org.api.notes.get(noteId);
    expect(pending).toMatchObject({ status: 'pending', kept: { transcript: false, recording: true } });
    expect(pending.rooms.map((r) => [r.name, r.transcript.length])).toEqual([['Design', 3], ['Support', 3]]);
    const line = pending.rooms[0]?.transcript.find((l) => l.text.includes(DESIGN_CANARY));
    for (const who of [kofi, lena]) {
      const theirs = await who.browser.api.notes.get(noteId);
      expect(theirs.rooms.map((r) => [r.name, r.transcript])).toEqual([['Design', []], ['Support', []]]);
      expect(theirs.transcript).toEqual([]);
    }
    for (const canary of [CANARY, DESIGN_CANARY, SUPPORT_CANARY]) expect(await anyHolds(ownerId, noteId, canary), canary).toBe(true);

    const steps = await written(org.api, noteId, answer);
    expect(steps.at(0)?.steps[2]?.label).toBe('Transcript of 9 lines, deleted once the notes are written');
    expect(steps.at(-1)?.steps[2]?.label).toBe('The transcript was deleted once the notes were written');

    // Everyone has the notes of every room, and nobody has a line of what they came from.
    const note = await org.api.notes.get(noteId);
    expect(note).toMatchObject({ status: 'ready', transcript: [], writtenAt: expect.any(String), decisions: [{ text: DECIDED }], kept: { transcript: false, recording: true } });
    expect(note.rooms.map((r) => [r.name, r.transcript, r.summary, r.decisions.map((d) => d.text)])).toEqual([
      ['Design', [], 'Heard 3 lines. It ended on: Right, back to the others.', [BLUE]], ['Support', [], 'Heard 3 lines. It ended on: Right, see you back there.', [QUEUE]]
    ]);
    expect((await lena.browser.api.notes.get(noteId)).rooms).toEqual(note.rooms);
    // Only the transcript goes: the recording of this call was kept.
    expect(note.audio).toHaveLength(1);

    // Nothing holds it any more: one revision, with nothing before it, and no row or receipt.
    const revisions = await revisionsOf(ownerId, noteId);
    expect(revisions.map((r) => r.parent)).toEqual([null]);
    for (const canary of [CANARY, DESIGN_CANARY, SUPPORT_CANARY]) expect(await anyHolds(ownerId, noteId, canary), canary).toBe(false);
    for (const table of ['transcript_clips', 'transcript_translations', 'content_jobs', 'operations']) expect(await count(`FROM ${table} WHERE owner_id = $1`, [ownerId]), table).toBe(0);

    // What people do with a room's notes from then on keeps going, and brings nothing back.
    await kofi.browser.api.notes.updateDecision(noteId, note.rooms[0]?.decisions[0]?.id ?? '', { state: 'confirmed', seen: { text: note.rooms[0]?.decisions[0]?.text ?? '' } });
    expect(await revisionsOf(ownerId, noteId)).toHaveLength(2);
    for (const canary of [CANARY, DESIGN_CANARY, SUPPORT_CANARY]) expect(await anyHolds(ownerId, noteId, canary), canary).toBe(false);

    // A room's line can't be corrected, and there's nothing left to write the notes from, as with the main room's.
    expect(code(await org.api.notes.correctLine(noteId, line?.id ?? '', { text: 'Not said.' }).catch((e: unknown) => e))).toBe('not-found');
    expect(await fails(org.api.notes.rewrite(noteId))).toEqual(['conflict', 'The transcript was deleted once the notes were written, so they can’t be written again.']);

    // Asking answers from what the notes of every part say, for anyone who has them.
    for (const who of [org, kofi.browser]) {
      expect((await asked(who.api, noteId, 'What did Design decide?'))[0]?.type).toBe('text');
      const prompt = h.near.prompts.at(-1) ?? '';
      expect(prompt).toContain(DECIDED);
      expect(prompt).toContain('Breakout room 1, “Design”');
      expect(prompt).toContain(BLUE);
      expect(prompt).toContain('Breakout room 2, “Support”');
      expect(prompt).toContain(QUEUE);
      expect(prompt).toContain(NO_TRANSCRIPT);
      for (const canary of [CANARY, DESIGN_CANARY, SUPPORT_CANARY]) expect(prompt).not.toContain(canary);
    }
    // And so does asking across notes.
    expect((await askedAll(lena.browser.api, 'What did Design decide?'))[0]?.type).toBe('text');
    const across = h.near.prompts.at(-1) ?? '';
    expect(across).toContain(BLUE);
    expect(across).toContain('Right, back to the others.');
    expect(across).toContain('(deleted once the notes were written)');
    for (const canary of [CANARY, DESIGN_CANARY, SUPPORT_CANARY]) expect(across).not.toContain(canary);
  });

  it('keeps a room’s transcript while its notes can’t be written, for the organizer alone, and deletes it when they are', async () => {
    const { org, host, kofi, lena } = await roomsCall({ keepTranscript: false });
    const { ownerId } = org.session;
    await host.appendAudio(piece('kept', 0, 0, 90_000));
    await talked(host, kofi, lena);
    h.near.failNext(3, 'prose', 'the breakout room “Design”');
    const noteId = await noteOf(host);
    const steps = await written(org.api, noteId);
    expect(steps.at(-1)?.steps[2]?.label).toBe('Transcript of 3 lines, deleted once the notes are written');

    // The call's notes and Support's are written and their transcripts gone. Design's waits for its notes, in the note's only revision.
    const part = await org.api.notes.get(noteId);
    expect(part).toMatchObject({ status: 'ready', transcript: [], decisions: [{ text: DECIDED }], writtenAt: expect.any(String) });
    expect(part.rooms.map((r) => [r.name, r.summary !== '', r.transcript.length])).toEqual([['Design', false, 3], ['Support', true, 0]]);
    expect((await revisionsOf(ownerId, noteId)).map((r) => r.parent)).toEqual([null]);
    expect(await anyHolds(ownerId, noteId, CANARY)).toBe(false);
    expect(await anyHolds(ownerId, noteId, SUPPORT_CANARY)).toBe(false);
    expect(await anyHolds(ownerId, noteId, DESIGN_CANARY)).toBe(true);

    // Nobody else reads it, whichever way they ask.
    const theirs = await kofi.browser.api.notes.get(noteId);
    expect(theirs.rooms.map((r) => r.transcript)).toEqual([[], []]);
    await asked(kofi.browser.api, noteId, 'Who is the printer?');
    expect(h.near.prompts.at(-1)).not.toContain(DESIGN_CANARY);
    await askedAll(kofi.browser.api, 'Who is the printer?');
    expect(h.near.prompts.at(-1)).not.toContain(DESIGN_CANARY);

    // The organizer can correct it and ask from it, as with any transcript.
    const line = part.rooms[0]?.transcript.find((l) => l.text.includes(DESIGN_CANARY));
    await org.api.notes.correctLine(noteId, line?.id ?? '', { text: `The printer is ${DESIGN_CANARY} from now on.` });
    await asked(org.api, noteId, 'Who is the printer?');
    expect(h.near.prompts.at(-1)).toContain(`The printer is ${DESIGN_CANARY} from now on.`);

    // Written again, only what’s left to write from is written: Design gets its notes, what’s written already stays,
    // and the last transcript goes, from every revision.
    expect(await org.api.notes.rewrite(noteId)).toMatchObject({ writingAgain: true });
    await written(org.api, noteId);
    const note = await org.api.notes.get(noteId);
    expect(note).toMatchObject({ transcript: [], decisions: [{ text: DECIDED }], writingAgain: false });
    expect(note.summary).toBe(part.summary);
    expect(note.rooms.map((r) => [r.name, r.transcript, r.decisions.map((d) => d.text)])).toEqual([['Design', [], [BLUE]], ['Support', [], [QUEUE]]]);
    expect((await revisionsOf(ownerId, noteId)).map((r) => r.parent)).toEqual([null]);
    expect(await anyHolds(ownerId, noteId, DESIGN_CANARY)).toBe(false);
    expect(await fails(org.api.notes.rewrite(noteId))).toEqual(['conflict', 'The transcript was deleted once the notes were written, so they can’t be written again.']);
  });

  it('keeps every transcript when the call’s notes can’t be written, for the organizer alone, and deletes them all when they are', async () => {
    const { org, host, kofi, lena } = await roomsCall({ keepTranscript: false });
    const { ownerId } = org.session;
    await talked(host, kofi, lena);
    h.near.failNext(3, 'prose', DECIDED);
    const noteId = await noteOf(host);
    await waitFor(async () => (await job(ownerId))?.state === 'queued' && (await job(ownerId))?.attempt === 1, 'the first attempt to fail');
    await retryNow(ownerId);
    await retryNow(ownerId);
    expect(await job(ownerId)).toBeUndefined();

    const unwritten = await org.api.notes.get(noteId);
    expect(unwritten).toMatchObject({ status: 'ready', summary: '', writtenAt: null });
    expect(unwritten.transcript).toHaveLength(3);
    expect(unwritten.rooms.map((r) => r.transcript.length)).toEqual([3, 3]);
    expect(await lena.browser.api.notes.get(noteId)).toMatchObject({ transcript: [], writtenAt: null });
    expect((await lena.browser.api.notes.get(noteId)).rooms.map((r) => r.transcript)).toEqual([[], []]);
    // A search reads no more than that: what was said in a room is the organizer's alone, whoever said it.
    expect(await lena.browser.api.notes.list({ text: SUPPORT_CANARY })).toEqual([]);
    expect((await org.api.notes.list({ text: SUPPORT_CANARY }))[0]?.said).toMatchObject([{ text: expect.stringContaining(SUPPORT_CANARY), room: { name: 'Support' } }]);
    // Nor through who said it: Lena's address and first name find her lines in Support for the organizer, and none for her.
    const lenas = [['Support', QUEUE], ['Support', `The bank is ${SUPPORT_CANARY} for now.`], ['Support', 'Right, see you back there.']];
    expect(await lena.browser.api.notes.list({ by: lena.email })).toEqual([]);
    expect(await lena.browser.api.notes.list({ text: 'lena' })).toEqual([]);
    expect((await org.api.notes.list({ by: lena.email }))[0]?.said.map((l) => [l.room?.name, l.text])).toEqual(lenas);
    expect((await org.api.notes.list({ text: 'lena' }))[0]?.said.map((l) => [l.room?.name, l.text])).toEqual(lenas);
    expect(await fails(asked(lena.browser.api, noteId, 'Who is the bank?'))).toEqual(['conflict', 'These notes aren’t written yet, so there’s nothing to ask about.']);
    await asked(org.api, noteId, 'Who is the bank?');
    expect(h.near.prompts.at(-1)).toContain(SUPPORT_CANARY);

    expect(await org.api.notes.rewrite(noteId)).toMatchObject({ writingAgain: true });
    await written(org.api, noteId);
    const note = await org.api.notes.get(noteId);
    expect(note).toMatchObject({ transcript: [], writtenAt: expect.any(String), decisions: [{ text: DECIDED }] });
    expect(note.rooms.map((r) => [r.transcript, r.decisions.map((d) => d.text)])).toEqual([[[], [BLUE]], [[], [QUEUE]]]);
    expect((await revisionsOf(ownerId, noteId)).map((r) => r.parent)).toEqual([null]);
    for (const canary of [CANARY, DESIGN_CANARY, SUPPORT_CANARY]) expect(await anyHolds(ownerId, noteId, canary), canary).toBe(false);
  });

  it('deletes a room’s transcript when only the rooms talked, and says so only when it’s true', async () => {
    const off = await roomsCall({ keepTranscript: false });
    await rooms(off.host, off.kofi, off.lena);
    await off.kofi.call.transcribe(speech(DESIGN_SAID, 0, 2000), off.kofi.call.ticket.identity);
    const gone = await noteOf(off.host);
    await written(off.org.api, gone);
    expect(await off.org.api.notes.get(gone)).toMatchObject({ summary: '', transcript: [], writtenAt: expect.any(String), rooms: [{ name: 'Design', transcript: [], decisions: [{ text: BLUE }] }, { name: 'Support', transcript: [] }] });
    expect((await revisionsOf(off.org.session.ownerId, gone)).map((r) => r.parent)).toEqual([null]);
    expect(await anyHolds(off.org.session.ownerId, gone, DESIGN_CANARY)).toBe(false);
    await asked(off.lena.browser.api, gone, 'What did Design decide?');
    expect(h.near.prompts.at(-1)).toContain(BLUE);
    expect(h.near.prompts.at(-1)).toContain(NO_TRANSCRIPT);

    // Kept, a room's transcript is read like the main room's, and nothing says it went.
    const on = await roomsCall({});
    await rooms(on.host, on.kofi, on.lena);
    await on.kofi.call.transcribe(speech(DESIGN_SAID, 0, 2000), on.kofi.call.ticket.identity);
    const kept = await noteOf(on.host);
    await written(on.org.api, kept);
    expect((await on.lena.browser.api.notes.get(kept)).rooms[0]?.transcript).toHaveLength(3);
    // A search finds what was said in a room, and says which room, for anyone who has the notes.
    expect((await on.lena.browser.api.notes.list({ text: DESIGN_CANARY }))[0]?.said).toMatchObject([{ text: expect.stringContaining(DESIGN_CANARY), room: { name: 'Design' } }]);
    await asked(on.lena.browser.api, kept, 'Who is the printer?');
    expect(h.near.prompts.at(-1)).toContain(DESIGN_CANARY);
    expect(h.near.prompts.at(-1)).not.toContain('deleted once');
    await askedAll(on.lena.browser.api, 'What did Design decide?');
    expect(h.near.prompts.at(-1)).toContain(BLUE);
    expect(h.near.prompts.at(-1)).not.toContain('deleted once');
  });

  it('leaves no audio of a call’s rooms when the recording isn’t kept, and their lines keep their places', async () => {
    const { org, host, kofi, lena } = await roomsCall({ keepRecording: false });
    const { ownerId } = org.session;
    await host.appendAudio(piece('before-rooms', 0, 0, 60_000));
    await rooms(host, kofi, lena);
    // The host's browser goes on recording the main room; a room's scribe sends what's said, and can add no audio.
    await host.appendAudio(piece('during-rooms', 0, 1, 60_000));
    expect(code(await kofi.call.appendAudio(piece('in-a-room', 0, 2)).catch((e: unknown) => e))).toBe('forbidden');
    await kofi.call.transcribe(speech(DESIGN_SAID, 0, 2000), kofi.call.ticket.identity);
    const ids = (await piecesOf(ownerId)).map((p) => p.object_id);
    expect(ids).toHaveLength(2);
    h.near.slowNext(1000);
    const noteId = await noteOf(host);

    // Gone with the call, before any notes are written.
    expect(await piecesOf(ownerId)).toEqual([]);
    for (const id of ids) expect(await inBucket(id)).toBe(false);
    expect(await storedBytes(ownerId)).toBe(0);
    await written(org.api, noteId);
    const note = await org.api.notes.get(noteId);
    expect(note).toMatchObject({ audio: [], kept: { transcript: true, recording: false } });
    expect(note.rooms[0]?.transcript.map((l) => l.text)).toEqual([BLUE, `The printer is ${DESIGN_CANARY} this year.`, 'Right, back to the others.']);
    expect((note.rooms[0]?.transcript[0]?.at ?? -1) >= (note.rooms[0]?.from ?? 0) - 1).toBe(true);
    expect(await audioStatus(org, noteId, 0)).toBe(404);
  });
});

describe('the organizer’s permission to read shared screens', () => {
  it('lets a presenter keep a share for the notes when scheduled so, and shows everyone while it goes', async () => {
    const org = await account(unique('organizer'));
    const { meeting, call } = await held(org, { allowScreens: true });
    expect(call.getSnapshot().capture).toMatchObject({ allowScreens: true, screen: { mode: 'off' } });
    expect(await h.browser().api.calls.card(meeting.code)).toMatchObject({ choices: { allowScreens: true } });
    const { share, keep } = await call.startShare({ notes: true });
    expect(keep).toBe(true);
    expect(call.getSnapshot().capture.screen.mode).toBe('on');
    await call.shareEnded(share);
    expect(call.getSnapshot().capture.screen.mode).toBe('off');
    await call.leave();
  });

  it('refuses to keep a share when scheduled not to, but still lets it be shared', async () => {
    const org = await account(unique('organizer'));
    const { meeting, call } = await held(org, { allowScreens: false });
    expect(call.getSnapshot().capture).toMatchObject({ allowScreens: false, screen: { mode: 'off' } });
    expect(await h.browser().api.calls.card(meeting.code)).toMatchObject({ choices: { allowScreens: false } });
    expect(await fails(call.startShare({ notes: true }))).toEqual(['conflict', 'The organizer keeps shared screens out of these notes.']);
    const plain = await call.startShare({ notes: false });
    expect(plain.keep).toBe(false);
    expect(call.getSnapshot().capture.screen.mode).toBe('off');
    await call.leave();
  });

  it('allows shares in the notes for a meeting scheduled with choices from before the setting existed', async () => {
    const org = await account(unique('organizer'));
    const res = await org.fetch(`${h.baseUrl}/v1/meetings`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Supplier review', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, guests: [], notes: 'on', choices: { keepTranscript: true, keepRecording: true } })
    });
    expect(res.status).toBe(200);
    const { code } = z.object({ code: z.string() }).parse(await res.json());
    const call = await org.api.calls.join(code, { mic: true, cam: false });
    expect(call.getSnapshot().capture.allowScreens).toBe(true);
    expect(await h.browser().api.calls.card(code)).toMatchObject({ choices: { keepTranscript: true, keepRecording: true, allowScreens: true } });
    await call.leave();
  });
});

describe('what a call keeps unless it’s told otherwise', () => {
  it('keeps everything, with every revision, and shared screens stay off until the organizer says', async () => {
    const org = await account(unique('organizer'));
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const call = await org.api.calls.join(c, { mic: true, cam: false });
    expect(call.getSnapshot().capture.screen).toEqual({ mode: 'off', since: null, by: null });
    await call.appendAudio(piece('kept', 0, 0));
    await call.transcribe(speech(SAID, 0, 0), call.ticket.identity);
    const noteId = await noteOf(call);
    const steps = await written(org.api, noteId);
    expect(steps.at(-1)?.steps[1]?.label).toBe('1 min of audio saved, encrypted');
    expect(steps.at(-1)?.steps[2]?.label).toBe('Transcript of 3 lines');
    const note = await org.api.notes.get(noteId);
    expect(note).toMatchObject({ kept: { transcript: true, recording: true }, audio: [{ index: 0 }] });
    expect(note.transcript).toHaveLength(3);
    expect(await piecesOf(org.session.ownerId)).toHaveLength(1);
    const revisions = await revisionsOf(org.session.ownerId, noteId);
    expect(revisions.length).toBeGreaterThan(1);
    expect(revisions.filter((r) => r.text.includes(CANARY)).length).toBeGreaterThan(1);
  });

  it('keeps room recordings whole', async () => {
    const org = await account(unique('organizer'));
    const rec = await org.api.recordings.start({ title: 'In the room' });
    await rec.appendAudio(piece('kept', 0, 0));
    await rec.transcribe(speech(SAID, 0, 0));
    const { pendingNoteId } = await rec.stop();
    await written(org.api, pendingNoteId);
    expect(await org.api.notes.get(pendingNoteId)).toMatchObject({ kept: { transcript: true, recording: true }, audio: [{ index: 0 }] });
    expect((await org.api.notes.get(pendingNoteId)).transcript).toHaveLength(3);
  });

  it('reads a note stopped by the previous release as keeping everything, and writes it from its audio', async () => {
    const org = await account(unique('organizer'));
    const { call } = await held(org, {});
    await call.appendAudio(piece('kept', 0, 0, 90_000));
    await call.transcribe(speech(SAID, 0, 0), call.ticket.identity);
    const plain = await h.secondServer({ NEAR_AI_API_KEY: undefined });
    try {
      const noteId = await leaveOn(plain.baseUrl, org, call);
      // Its job is waiting, on a note as the release before this one sealed it.
      const o = await openOwner(h.deps, org.session.ownerId, undefined);
      await tx(h.pool, async (c) => {
        const cur = await getItem(o, c, 'note', noteId, z.record(z.string(), z.unknown()), 'That note');
        const { keep: _keep, recorded: _recorded, rooms: _rooms, ...older } = cur.manifest;
        await saveRevision(o, c, noteId, cur.revisionId, older);
      });
      expect((await revisionsOf(org.session.ownerId, noteId)).some((r) => r.text.includes('"recorded"'))).toBe(true);
      expect(await org.api.notes.get(noteId)).toMatchObject({ rooms: [], kept: { transcript: true, recording: true } });
      await retryNow(org.session.ownerId);
      const note = await org.api.notes.get(noteId);
      expect(note).toMatchObject({ status: 'ready', rooms: [], kept: { transcript: true, recording: true }, audio: [{ index: 0 }], decisions: [{ text: DECIDED }] });
      expect(note.transcript).toHaveLength(3);
    } finally {
      await plain.close();
    }
  });
});
