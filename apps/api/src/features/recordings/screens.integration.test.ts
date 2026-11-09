/**
 * Shared screens kept for the notes (docs: Calls and recordings › Shared screens), end to end: the real API over HTTP
 * via @alcove/api-http, real Postgres and the object store. A presenter says whether each share goes in the notes; their
 * browser sends a kept share's video in pieces (here a real WebM that ffmpeg makes from its test pattern, cut into
 * pieces the way MediaRecorder cuts one stream); after the call the pieces are joined into one video that replay can
 * seek, by range, for anyone who has the note. Deleting the note deletes all of it.
 */
import { AlcoveApiError, MAX_SCREEN_FRAMES, NoteSchema, SECONDS_PER_SCREEN_FRAME, type AlcoveApi, type AudioPiece, type CallSession, type CallState, type NoteProgress, type ScreenPiece, type TranscriptClip } from '@alcove/api';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { frames, webmDuration } from './ffmpeg';
import { maintain } from '../../maintenance';
import { joinDue } from './screens';
import { work } from '../notes/writer';
import { NOTES_MODEL, PRICEY_MODEL, UNVERIFIED_VISION_MODEL, VISION_MODEL, speechWav } from '../../testing/fake-near';
import { ORIGIN, startHarness, type Harness } from '../../testing/harness';
import { disposeLiveKit, presentScreen, stopPresenting } from '../../testing/livekit';
import { cut, recordedWebm, type Scene } from '../../testing/video';

vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
/** Twenty seconds of ffmpeg's test pattern as one WebM stream, as a browser records a share, and the same cut into four pieces. */
let video: Uint8Array<ArrayBuffer>;
let pieces: Uint8Array<ArrayBuffer>[];
const MIME = 'video/webm;codecs=vp8';

beforeAll(async () => {
  h = await startHarness();
  video = await recordedWebm(20);
  pieces = cut(video, 4);
});
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
afterEach(async () => { await stopPresenting(); h.closeCalls(); });

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, what: string, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}
async function settle(call: CallSession, pred: (s: CallState) => boolean): Promise<CallState> {
  for (let i = 0; i < 100 && !pred(call.getSnapshot()); i++) { await call.refresh(); await sleep(30); }
  if (!pred(call.getSnapshot())) throw new Error('timed out waiting for the call to change');
  return call.getSnapshot();
}
const inGroup = (call: CallSession) => waitFor(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
async function letIn(host: CallSession, who: CallSession) {
  await settle(host, (s) => s.waiting.some((w) => w.id === who.ticket.identity));
  await host.admit(who.ticket.identity);
  await inGroup(who);
}
async function written(api: AlcoveApi, noteId: string): Promise<NoteProgress[]> {
  const steps: NoteProgress[] = [];
  for await (const p of api.notes.progress(noteId)) steps.push(p);
  return steps;
}
/** Piece `i` of the share's video in `segment`, as the presenter's browser sends it: five seconds each, or `every`, from `offset` seconds into the recording. */
const piece = (share: string, i: number, o: { segment?: number; data?: Uint8Array<ArrayBuffer>; durationMs?: number; every?: number | undefined; offset?: number | undefined } = {}): ScreenPiece =>
  ({ data: new Blob([o.data ?? pieces[i] ?? new Uint8Array(1)]), share, segment: o.segment ?? 0, seq: i, at: (o.offset ?? 0) + i * (o.every ?? 5), durationMs: o.durationMs ?? (o.every ?? 5) * 1000, mimeType: MIME });
const ownerRows = async (table: 'screen_pieces' | 'screen_videos' | 'screen_shares', ownerId: string) =>
  (await h.pool.query<Record<string, unknown>>(`SELECT * FROM ${table} WHERE owner_id = $1`, [ownerId])).rows;
const objectsOf = async (ownerId: string) => (await h.pool.query<{ object_id: string }>(
  'SELECT object_id FROM screen_pieces WHERE owner_id = $1 UNION ALL SELECT object_id FROM screen_videos WHERE owner_id = $1', [ownerId])).rows.map((r) => r.object_id);
const exists = (objectId: string) => h.objects.get(objectId).then(() => 'kept', () => 'gone');
async function* chunked(b: Uint8Array): AsyncGenerator<Uint8Array> { for (let i = 0; i < b.length; i += 65_536) yield b.subarray(i, i + 65_536); }
const NOTES_FIRST = 'Turn on notes first: only then can a share go in them.';
const onStage = new WeakSet<CallSession>();
/**
 * Starts a share the way a browser does: its screen up in the call's room first (LiveKit listing it is what the API
 * checks a share's video against), then said to the call.
 */
async function sharing(call: CallSession, notes: boolean) {
  if (!onStage.has(call)) { onStage.add(call); await presentScreen(call, h.deps.livekit); }
  return call.startShare({ notes });
}

describe('shared screens kept for the notes', () => {
  it('keeps a share its presenter says goes in the notes, refuses pieces of one that doesn’t, and everyone sees which is which', async () => {
    const org = await account(unique('organizer'));
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const guest = await h.browser().api.calls.join(c, { mic: true, cam: false, name: 'Priya Canary-7f3e' });
    await letIn(host, guest);
    expect(host.getSnapshot().capture.screen.mode).toBe('off');

    const yes = await sharing(guest, true);
    expect(yes).toEqual({ share: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), keep: true });
    // Everyone sees the share, and that it's read for the notes; the capture panel says shared screens are on.
    let s = await settle(host, (x) => x.shares.length === 1);
    expect(s.shares).toEqual([{ id: yes.share, participant: guest.ticket.identity, keep: true }]);
    expect(s.capture.screen.mode).toBe('on');

    for (let i = 0; i < 4; i++) await guest.appendScreen(piece(yes.share, i));
    // A piece sent again (its answer was lost) is stored once; a different piece in its place is refused.
    await guest.appendScreen(piece(yes.share, 0));
    expect(await ownerRows('screen_pieces', org.session.ownerId)).toHaveLength(4);
    expect(await fails(guest.appendScreen(piece(yes.share, 0, { durationMs: 4000 })))).toEqual(['conflict', 'A different piece of this shared screen is already stored at that place.']);
    // Only the presenter's own share, and only one that exists.
    expect(await fails(host.appendScreen(piece(yes.share, 4)))).toEqual(['forbidden', 'That isn’t a screen you’re sharing in this call.']);
    expect(await fails(guest.appendScreen(piece('AAAAAAAAAAAAAAAAAAAAAA', 0)))).toEqual(['not-found', 'That share doesn’t exist, or you don’t have access to it.']);
    // Pieces from an earlier part of the recording aren't taken.
    expect(await fails(guest.appendScreen(piece(yes.share, 5, { segment: 1 })))).toEqual(['conflict', 'That video belongs to an earlier part of the recording.']);

    // Sealed: rows hold sizes and places, objects hold ciphertext; who shared is sealed too.
    const shareRows = await ownerRows('screen_shares', org.session.ownerId);
    expect(shareRows).toHaveLength(1);
    expect(Buffer.from(z.instanceof(Buffer).parse(shareRows[0]?.['meta_ciphertext'])).toString('latin1')).not.toContain('Canary-7f3e');
    for (const id of await objectsOf(org.session.ownerId)) {
      const stored = Buffer.from(await h.objects.get(id)).toString('latin1');
      expect(stored).not.toContain('webm');
      expect(stored).not.toContain('libvpx');
    }

    // Sharing again ends the share before it: the new one, said no to, isn't recorded.
    const no = await sharing(guest, false);
    expect(no.keep).toBe(false);
    s = await settle(host, (x) => x.shares.length === 1 && x.shares[0]?.id === no.share);
    expect(s.shares).toEqual([{ id: no.share, participant: guest.ticket.identity, keep: false }]);
    expect(s.capture.screen.mode).toBe('off');
    expect(await fails(guest.appendScreen(piece(no.share, 0)))).toEqual(['forbidden', 'That share doesn’t go in the notes.']);
    // The ended share: a retry of what it stored is fine, and its last piece, arriving just after it ended, is taken.
    await guest.appendScreen(piece(yes.share, 3));
    await guest.appendScreen(piece(yes.share, 4));
    expect(await ownerRows('screen_pieces', org.session.ownerId)).toHaveLength(5);
    await guest.shareEnded(no.share);
    expect((await settle(host, (x) => x.shares.length === 0)).shares).toEqual([]);
    await host.leave();
  });

  it('takes video only while LiveKit lists the presenter’s screen, and their last piece after they leave', async () => {
    const org = await account(unique('organizer'));
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const guest = await h.browser().api.calls.join(c, { mic: true, cam: false, name: 'Tomas' });
    await letIn(host, guest);

    // Said to the call, but never shared in its room: nothing of it goes in the notes, from a guest or the organizer.
    const unseen = await guest.startShare({ notes: true });
    expect(unseen.keep).toBe(true);
    expect(await fails(guest.appendScreen(piece(unseen.share, 0)))).toEqual(['forbidden', 'That isn’t a screen you’re sharing in this call.']);
    const hostUnseen = await host.startShare({ notes: true });
    expect(await fails(host.appendScreen(piece(hostUnseen.share, 0)))).toEqual(['forbidden', 'That isn’t a screen you’re sharing in this call.']);
    expect(await ownerRows('screen_pieces', org.session.ownerId)).toHaveLength(0);

    // Ending an unpublished share must not bypass the media server's check through the late-piece allowance.
    await guest.shareEnded(unseen.share);
    expect(await fails(guest.appendScreen(piece(unseen.share, 0)))).toEqual(['forbidden', 'That isn’t a screen you’re sharing in this call.']);
    expect(await ownerRows('screen_pieces', org.session.ownerId)).toHaveLength(0);

    // Shared in the room: taken. Leaving ends the share, and the piece their browser hands over as they go is taken too.
    const shown = await sharing(guest, true);
    for (let i = 0; i < 2; i++) await guest.appendScreen(piece(shown.share, i));
    await guest.leave();
    await settle(host, (x) => x.shares.every((sh) => sh.id !== shown.share));
    await guest.appendScreen(piece(shown.share, 2));
    expect(await ownerRows('screen_pieces', org.session.ownerId)).toHaveLength(3);
    // Only the tail of that share: someone who left can't send a share that isn't theirs.
    expect(await fails(guest.appendScreen(piece(hostUnseen.share, 1)))).toEqual(['forbidden', 'That isn’t a screen you’re sharing in this call.']);
    await host.leave();
  });

  it('refuses video past what a share could have recorded in the time it has been up', async () => {
    const org = await account(unique('organizer'));
    const host = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    const { share } = await sharing(host, true);
    // Just started, a share may hold 30 seconds' worth (7.5 MB): one big piece fits, a second doesn't.
    const big = () => new Uint8Array(new ArrayBuffer(3_900_000)).fill(7);
    await host.appendScreen(piece(share, 0, { data: big() }));
    expect(await fails(host.appendScreen(piece(share, 1, { data: big() })))).toEqual(['conflict', 'This shared screen has sent more video than it could have recorded.']);
    expect(await ownerRows('screen_pieces', org.session.ownerId)).toHaveLength(1);
    await host.leave();
  });

  it('takes a verified share’s first piece after its screen was unpublished, from another API instance', async () => {
    const org = await account(unique('organizer'));
    const host = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    const presenter = await presentScreen(host, h.deps.livekit);
    const { share } = await host.startShare({ notes: true });
    const track = (await h.deps.livekit.screenShares(presenter.room.name ?? '')).find((x) => x.identity === host.ticket.identity);
    if (!track) throw new Error('the presenter’s screen was not published');
    await presenter.unpublish(track.sid);
    await host.shareEnded(share);
    const other = await h.secondServer();
    try {
      const reply = await fetch(`${other.baseUrl}/v1/live/calls/${host.ticket.callId}/shares/${share}/video`, {
        method: 'POST', headers: {
          origin: ORIGIN, 'x-alcove-call': host.ticket.pass, 'content-type': MIME,
          'x-alcove-segment': '0', 'x-alcove-seq': '0', 'x-alcove-at-ms': '0', 'x-alcove-duration-ms': '5000'
        }, body: pieces[0] ?? new Uint8Array(1)
      });
      expect(reply.status).toBe(200);
      expect(await ownerRows('screen_pieces', org.session.ownerId)).toHaveLength(1);
    } finally { await other.close(); }
    // The previous share's cached publication must never authorize a new share after the track is gone.
    const unseen = await host.startShare({ notes: true });
    await host.shareEnded(unseen.share);
    expect(await fails(host.appendScreen(piece(unseen.share, 0)))).toEqual(['forbidden', 'That isn’t a screen you’re sharing in this call.']);
    await host.leave();
  });

  it('never replays temporary video when the call does not keep its recording, even while inference is unavailable', async () => {
    const org = await account(unique('organizer'));
    const meeting = await org.api.meetings.create({
      title: 'Supplier review', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, guests: [], notes: 'on',
      choices: { keepTranscript: true, keepRecording: false, allowScreens: true }
    });
    const host = await org.api.calls.join(meeting.code, { mic: true, cam: false });
    const { share } = await sharing(host, true);
    for (let i = 0; i < 4; i++) await host.appendScreen(piece(share, i));
    await host.shareEnded(share);
    const configured = h.deps.cfg;
    h.deps.cfg = { ...configured, NEAR_AI_API_KEY: '' };
    try {
      const noteId = (await host.leave())?.pendingNoteId ?? '';
      await h.pool.query(`UPDATE recordings SET ended_at = ended_at - interval '30 seconds' WHERE owner_id = $1`, [org.session.ownerId]);
      await joinDue(h.deps, org.session.ownerId);
      expect((await ownerRows('screen_videos', org.session.ownerId)).length).toBeGreaterThan(0);
      expect((await org.api.notes.get(noteId)).shares).toEqual([]);
      expect((await org.fetch(org.api.notes.screenVideoUrl(noteId, share, 0))).status).toBe(404);
    } finally { h.deps.cfg = configured; }
  });

  it('holds pieces while notes are paused, carries a share into the next segment, and asks for notes before a share can go in them', async () => {
    const org = await account(unique('organizer'));
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await host.pause();
    // Paused: a share can still go in the notes, but nothing is taken until notes resume.
    const share = await sharing(host, true);
    expect(share.keep).toBe(true);
    expect(host.getSnapshot().capture.screen.mode).toBe('paused');
    expect(await fails(host.appendScreen(piece(share.share, 0)))).toEqual(['conflict', 'Notes are paused. Nothing is recorded, transcribed or sent to the AI until the organizer resumes.']);
    await host.resume();
    const segment = host.getSnapshot().notes.recording.segment;
    expect(segment).toBe(1);
    expect(host.getSnapshot().capture.screen.mode).toBe('on');
    await host.appendScreen(piece(share.share, 0, { segment }));
    // Notes off: the share stops going in them, and nothing new can.
    await host.setNotes(false);
    expect(host.getSnapshot().shares).toEqual([{ id: share.share, participant: host.ticket.identity, keep: false }]);
    expect(host.getSnapshot().capture.screen.mode).toBe('off');
    expect(await fails(host.appendScreen(piece(share.share, 1, { segment })))).toEqual(['forbidden', 'That share doesn’t go in the notes.']);
    expect(await fails(host.startShare({ notes: true }))).toEqual(['conflict', NOTES_FIRST]);
    expect((await sharing(host, false)).keep).toBe(false);
    await host.leave();
  });

  it('lets only the organizer choose the model that reads shared screens, starting from their default, and puts it on the note', async () => {
    const org = await account(unique('organizer'));
    await org.api.account.updatePreferences({ model: 'vision/default-model' });
    // Saving another preference leaves the choice as it was.
    await org.api.account.updatePreferences({ summaryLength: 'detailed' });
    expect(await org.api.account.preferences()).toMatchObject({ model: 'vision/default-model', summaryLength: 'detailed' });
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    expect(host.getSnapshot().capture.model).toBe('vision/default-model');
    const guest = await h.browser().api.calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, guest);
    expect(await fails(guest.setModel('vision/other'))).toEqual(['forbidden', 'Only the organizer can do that.']);
    await host.setModel('vision/other');
    expect((await settle(guest, (x) => x.capture.model === 'vision/other')).capture.model).toBe('vision/other');
    const noteId = (await host.leave())?.pendingNoteId ?? '';
    expect((await org.api.notes.get(noteId)).model).toBe('vision/other');
  });

  it('joins a kept share into one video after the call, and replays it whole and by range only to people with the note', async () => {
    const org = await account(unique('organizer'));
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const share = await sharing(host, true);
    for (let i = 0; i < 4; i++) await host.appendScreen(piece(share.share, i));
    await host.shareEnded(share.share);
    const pieceObjects = await objectsOf(org.session.ownerId);
    const noteId = (await host.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);

    const note = await org.api.notes.get(noteId);
    expect(note.shares).toEqual([{
      id: share.share, presenter: { name: org.session.user.name, person: expect.objectContaining({ name: org.session.user.name }) }, label: `${org.session.user.name}’s screen`,
      at: 0, until: 20, segments: [{ segment: 0, at: 0, until: 20 }]
    }]);
    // The pieces are gone, rows and objects; the video is in sealed chunks.
    expect(await ownerRows('screen_pieces', org.session.ownerId)).toEqual([]);
    for (const id of pieceObjects) expect(await exists(id)).toBe('gone');
    const chunks = await ownerRows('screen_videos', org.session.ownerId);
    expect(chunks.length).toBeGreaterThan(0);
    for (const r of chunks) expect(Buffer.from(await h.objects.get(z.string().parse(r['object_id']))).toString('latin1')).not.toContain('webm');

    const url = org.api.notes.screenVideoUrl(noteId, share.share, 0);
    const whole = await org.fetch(url);
    expect(whole.status).toBe(200);
    expect(Object.fromEntries(['content-type', 'accept-ranges', 'cache-control', 'x-content-type-options'].map((k) => [k, whole.headers.get(k)])))
      .toEqual({ 'content-type': 'video/webm', 'accept-ranges': 'bytes', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    const full = new Uint8Array(await whole.arrayBuffer());
    // Seekable: it says how long it runs, and every moment decodes.
    expect(webmDuration(full)).toBeCloseTo(20, 0);
    expect((await frames(chunked(full), 'video/webm', [0, 7.5, 19])).map((f) => f.at)).toEqual([0, 7.5, 19]);

    // Ranges, each opening only what it needs, put together give the same video.
    const part = async (range: string) => {
      const r = await org.fetch(url, { headers: { range } });
      return { status: r.status, contentRange: r.headers.get('content-range'), bytes: new Uint8Array(await r.arrayBuffer()) };
    };
    const head = await part('bytes=0-99');
    expect([head.status, head.contentRange, head.bytes.length]).toEqual([206, `bytes 0-99/${full.length}`, 100]);
    const rest = await part('bytes=100-');
    expect([rest.status, rest.contentRange]).toEqual([206, `bytes 100-${full.length - 1}/${full.length}`]);
    expect(Buffer.concat([head.bytes, rest.bytes]).equals(Buffer.from(full))).toBe(true);
    const tail = await part('bytes=-500');
    expect(Buffer.from(tail.bytes).equals(Buffer.from(full.subarray(full.length - 500)))).toBe(true);
    const beyond = await part(`bytes=${full.length}-`);
    expect([beyond.status, beyond.contentRange]).toEqual([416, `bytes */${full.length}`]);
    expect((await part('bytes=0-1,5-9')).status).toBe(416);

    // Nobody else, and nothing that isn't there.
    const stranger = await account();
    expect((await stranger.fetch(url)).status).toBe(404);
    expect((await h.browser().fetch(url)).status).toBe(401);
    expect((await org.fetch(org.api.notes.screenVideoUrl(noteId, share.share, 1))).status).toBe(404);
    expect((await org.fetch(org.api.notes.screenVideoUrl(noteId, 'not-an-id', 0))).status).toBe(404);

    // Maintenance knows the video's objects are in use, however old.
    await sleep(1100);
    await maintain(h.deps, { orphanAgeMs: 0 });
    const videoObjects = await objectsOf(org.session.ownerId);
    for (const id of videoObjects) expect(await exists(id)).toBe('kept');

    // Deleting the note deletes all of it: rows and objects, and the bytes they counted.
    const stored = async () => Number((await h.pool.query('SELECT stored_bytes FROM owners WHERE owner_id = $1', [org.session.ownerId])).rows[0]?.stored_bytes ?? -1);
    expect(await stored()).toBeGreaterThan(0);
    await org.api.notes.delete(noteId);
    for (const t of ['screen_pieces', 'screen_videos', 'screen_shares'] as const) expect(await ownerRows(t, org.session.ownerId)).toEqual([]);
    for (const id of videoObjects) expect(await exists(id)).toBe('gone');
    expect(await stored()).toBe(0);
    expect((await org.fetch(url)).status).toBe(404);
  });

  it('sends pieces only as raw video from the app, each no bigger than a piece can be', async () => {
    const org = await account(unique('organizer'));
    const host = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    const share = await sharing(host, true);
    const send = (headers: Record<string, string>, body: Uint8Array<ArrayBuffer>) => fetch(`${h.baseUrl}/v1/live/calls/${host.ticket.callId}/shares/${share.share}/video`, {
      method: 'POST', headers: { origin: ORIGIN, 'x-alcove-call': host.ticket.pass, 'x-alcove-segment': '0', 'x-alcove-seq': '0', 'x-alcove-at-ms': '0', 'x-alcove-duration-ms': '5000', ...headers }, body
    });
    expect((await send({ 'content-type': 'image/jpeg' }, pieces[0] ?? new Uint8Array(1))).status).toBe(400);
    expect((await send({ 'content-type': 'video/ogg' }, pieces[0] ?? new Uint8Array(1))).status).toBe(400);
    expect((await send({ 'content-type': MIME }, new Uint8Array(4 * 1024 * 1024 + 2048))).status).toBe(400);
    expect((await send({ 'content-type': MIME, origin: 'https://elsewhere.example' }, pieces[0] ?? new Uint8Array(1))).status).toBe(403);
    expect((await send({ 'content-type': MIME }, pieces[0] ?? new Uint8Array(1))).status).toBe(200);
    expect(await ownerRows('screen_pieces', org.session.ownerId)).toHaveLength(1);
    await host.leave();
  });
});

/** Something said `at` seconds into the recording, for the live transcript. */
const speech = (words: string, at: number, ms: number | undefined = 3000): TranscriptClip => ({ data: new Blob([speechWav(words, ms)], { type: 'audio/wav' }), segment: 0, at, durationMs: ms });
/** Five seconds of the call's audio, number `seq`. */
const audio = (seq: number): AudioPiece => ({ data: new Blob([new Uint8Array(2048)]), segment: 0, seq, at: seq * 5, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' });
const isRead = (c: { system: string }) => c.system.startsWith('You read a frame');
const isPick = (c: { system: string }) => c.system.startsWith('You read the transcript of a meeting in which people shared their screens');
const frameRows = async (ownerId: string) => (await h.pool.query<{ frame_id: string; object_id: string }>('SELECT frame_id, object_id FROM screen_frames WHERE owner_id = $1', [ownerId])).rows;
/** The first log line since `from` with this message, as JSON. */
const logLine = (from: number, msg: string): unknown => {
  const line = h.logs.slice(from).find((l) => l.includes(`"msg":"${msg}"`));
  return line === undefined ? null : JSON.parse(line);
};
const bucket = async () => { const ids = new Set<string>(); for await (const x of h.objects.list()) ids.add(x.id); return ids; };
/**
 * The objects in the bucket since `was` that nothing of this account's stored in its rows refers to: after the notes are
 * saved, the frames not shown are deleted, rows at once and objects just after. Notes of earlier tests can still be
 * finishing (they wait for their shares' last pieces), so whatever another account stores is theirs.
 */
async function leftOver(was: Set<string>, ownerId: string): Promise<string[]> {
  const kept = new Set((await h.pool.query<{ object_id: string }>(
    `SELECT object_id FROM screen_frames WHERE owner_id = $1 UNION ALL SELECT object_id FROM screen_videos WHERE owner_id = $1
     UNION ALL SELECT object_id FROM screen_pieces WHERE owner_id = $1 UNION ALL SELECT object_id FROM recording_pieces WHERE owner_id = $1`, [ownerId])).rows.map((x) => x.object_id));
  const others = async () => new Set((await h.pool.query<{ object_id: string }>(
    `SELECT object_id FROM screen_frames WHERE owner_id <> $1 UNION ALL SELECT object_id FROM screen_videos WHERE owner_id <> $1
     UNION ALL SELECT object_id FROM screen_pieces WHERE owner_id <> $1 UNION ALL SELECT object_id FROM recording_pieces WHERE owner_id <> $1`, [ownerId])).rows.map((x) => x.object_id));
  const stray = async () => { const theirs = await others(); return [...await bucket()].filter((id) => !was.has(id) && !kept.has(id) && !theirs.has(id)); };
  for (let i = 0; i < 40 && (await stray()).length; i++) await sleep(50);
  return stray();
}

/**
 * A call where the organizer shares their screen for the notes (its video in pieces of five seconds, or `every`, from
 * `offset` seconds in), for `seconds` of audio, says `said` ([second, words], each clip `ms` long), maybe chooses the model that reads screens, and leaves; once the notes are written: the note,
 * and what NEAR AI was asked.
 */
async function presented(o: { seconds: number; share: Uint8Array<ArrayBuffer>[]; every?: number | undefined; offset?: number | undefined; said: [number, string][]; ms?: number | undefined; model?: string | undefined; keep?: boolean | undefined }) {
  const org = await account(unique('organizer'));
  const { code: c } = await org.api.calls.startNow({ notes: 'on' });
  const host = await org.api.calls.join(c, { mic: true, cam: false });
  for (let i = 0; i < o.seconds / 5; i++) await host.appendAudio(audio(i));
  const share = await sharing(host, o.keep ?? true);
  if (share.keep) for (const [i, data] of o.share.entries()) await host.appendScreen(piece(share.share, i, { data, every: o.every, offset: o.offset }));
  for (const [at, words] of o.said) await host.transcribe(speech(words, at, o.ms), host.ticket.identity);
  if (o.model !== undefined) await host.setModel(o.model);
  await host.shareEnded(share.share);
  const asked = h.near.chats.length;
  const noteId = (await host.leave())?.pendingNoteId ?? '';
  await written(org.api, noteId);
  return { org, noteId, note: await org.api.notes.get(noteId), chats: h.near.chats.slice(asked), prompts: h.near.prompts.slice(asked) };
}
/** The last notes prompt NEAR AI was sent. */
const lastNotesPrompt = () => h.near.prompts[h.near.instructions.findLastIndex((x) => x.startsWith('You write the notes'))] ?? '';
/** A share's video `seconds` long of still screens (`scenes`), cut into five-second pieces. */
const stills = async (seconds: number, scenes: Scene[]) => cut(await recordedWebm(seconds, { size: '320x180', scenes }), seconds / 5);

/**
 * Notes written again that can't be written, every time (the notes model answers in prose, or everything it's asked
 * does): the job tries three times, and then finishes the note without new notes.
 */
async function rewriteFailing(api: AlcoveApi, ownerId: string, noteId: string, only?: 'notes' | undefined, between?: (() => Promise<void>) | undefined) {
  const job = async () => (await h.pool.query<{ state: string; attempt: number }>('SELECT state, attempt FROM content_jobs WHERE owner_id = $1', [ownerId])).rows[0];
  const dueNow = () => h.pool.query(`UPDATE content_jobs SET lease_until = now() - interval '1 second' WHERE owner_id = $1`, [ownerId]);
  h.near.failNext(10_000, 'prose', only);
  try {
    await api.notes.rewrite(noteId);
    for (let tried = 1; tried <= 2; tried++) {
      for (let i = 0; i < 400; i++) { const j = await job(); if (j && j.state === 'queued' && j.attempt === tried) break; await sleep(50); }
      expect(await job()).toMatchObject({ state: 'queued', attempt: tried });
      await between?.();
      await dueNow();
      await work(h.deps, { ownerId });
    }
    for (let i = 0; i < 400 && (await job()); i++) await sleep(50);
    expect(await job()).toBeUndefined();
  } finally {
    h.near.failNext(0, 'prose');
  }
}

describe('shared screens in the notes', () => {
  let minute: Uint8Array<ArrayBuffer>[];
  beforeAll(async () => { minute = cut(await recordedWebm(60, { size: '320x180' }), 12); });

  it('looks at a shared screen where what was said points at it, with the model chosen, and attaches what matters to its line', async () => {
    const was = await bucket();
    const logsFrom = h.logs.length;
    const r = await presented({
      seconds: 60, share: minute, model: VISION_MODEL,
      said: [[2, 'As you can see the chart is up.'], [9, 'What do you think of these changes?'], [12, 'UNRELATED that was my private inbox, sorry.'], [25, 'As you can see the chart once more.']]
    });
    const [share] = r.note.shares;
    expect(r.note.shares).toHaveLength(1);
    expect(share).toMatchObject({ at: 0, until: 60 });
    const lines = r.note.transcript ?? [];
    // A minute of sharing has room for four frames (one for every fifteen seconds), and four things were said about it:
    // a frame at each, none at the share's start (no room left). The unrelated one never reaches the notes; the others
    // are attached, each on the line said at or before it and lasting until the next.
    expect(r.note.screens.map((m) => [m.at, m.until, m.line])).toEqual([[2, 9, lines[0]?.id], [9, 25, lines[1]?.id], [25, 60, lines[3]?.id]]);
    for (const m of r.note.screens) expect(m.share).toBe(share?.id);
    const at = (s: number) => r.note.screens.find((m) => m.at === s);
    // What the model said each shows, and that nothing was compared with an earlier frame.
    expect(at(2)).toMatchObject({
      cue: 'As you can see the chart is up.', relevance: 'key', title: 'Frame at 00:02', legible: 'clear', shows: 'A test pattern at 00:02', changed: '', presenter: { name: r.org.session.user.name }
    });
    expect(at(9)).toMatchObject({ cue: 'What do you think of these changes?', relevance: 'key', description: 'Frame at 00:09, shown while: What do you think of these changes?', shows: 'A test pattern at 00:09', changed: '' });
    expect(r.note.screens.length).toBeLessThanOrEqual(MAX_SCREEN_FRAMES);
    // The model chosen picked the moments and read every frame, sealed to its own attested key, and the note lists it.
    expect(r.chats.filter(isPick).map((c) => c.model)).toEqual([VISION_MODEL]);
    const reads = r.chats.filter(isRead);
    expect(reads).toHaveLength(4);
    expect(new Set(reads.map((c) => `${c.model} ${c.key ?? ''} ${c.images}`))).toEqual(new Set([`${VISION_MODEL} ${h.near.keys().vision} 1`]));
    expect(r.note.inference.map((e) => e.model)).toContain(VISION_MODEL);
    expect(r.note.inference.map((e) => e.model)).not.toContain(NOTES_MODEL);
    expect(r.note.unencrypted).toEqual([]);
    expect(r.note.model).toBe(VISION_MODEL);
    // The notes were told which screens matter, how each compares with the share's screen before, and each line's number.
    const notesPrompt = lastNotesPrompt();
    expect(notesPrompt).toContain(`[00:02] [screen 1 from ${r.org.session.user.name}, clear, key, first of this share] Frame at 00:02.`);
    expect(notesPrompt).toContain('Shows: A test pattern at 00:02');
    expect(notesPrompt).toContain(`[00:09] [screen 2 from ${r.org.session.user.name}, clear, key, changed a`);
    expect(notesPrompt).toContain(`L1 [00:02] ${r.org.session.user.name}: As you can see the chart is up.`);
    expect(notesPrompt).not.toContain('Frame at 00:12');

    // The frames not attached are gone, rows and objects: what's stored now is the frames shown and the video.
    const rows = await frameRows(r.org.session.ownerId);
    expect(rows.map((x) => x.frame_id).sort()).toEqual(r.note.screens.map((m) => m.id).sort());
    expect(await leftOver(was, r.org.session.ownerId)).toEqual([]);
    const img = await r.org.fetch(r.org.api.notes.screenUrl(r.noteId, at(9)?.id ?? ''));
    expect([img.status, img.headers.get('content-type')]).toEqual([200, 'image/jpeg']);

    expect((await h.browser().fetch(`${h.baseUrl}/v1/models`)).status).toBe(401);

    // The logs say how many, never what was said.
    const logged = h.logs.slice(logsFrom).join('');
    expect(logLine(logsFrom, 'screen moments picked')).toMatchObject({ shares: 1, picked: 4, cued: 4, starts: 0, befores: 0, kept: 4, noteId: r.noteId });
    expect(logLine(logsFrom, 'shared screens read')).toMatchObject({ frames: 4, compared: 0, keyFrames: 3, supporting: 0, unrelated: 1, model: VISION_MODEL });
    expect(logLine(logsFrom, 'notes written')).toMatchObject({ screens: 3, attached: 3 });
    expect(logged).not.toContain('private inbox');
    expect(logged).not.toContain('Frame at');
    expect(logged).not.toContain('A test pattern');

    // Written again with the notes model: every frame is read again, by it, and the notes attach the same ones.
    const asked = h.near.chats.length;
    await r.org.api.notes.rewrite(r.noteId, { model: null });
    await written(r.org.api, r.noteId);
    const again = await r.org.api.notes.get(r.noteId);
    expect(again.model).toBeNull();
    expect(new Set(h.near.chats.slice(asked).filter(isRead).map((c) => `${c.model} ${c.key ?? ''}`))).toEqual(new Set([`${NOTES_MODEL} ${h.near.keys().notes}`]));
    expect(h.near.chats.slice(asked).filter(isRead)).toHaveLength(4);
    expect(again.screens.map((m) => m.at)).toEqual([2, 9, 25]);
    expect(again.screens.every((m) => m.text.includes(`Read by ${NOTES_MODEL}`))).toBe(true);
    expect((await frameRows(r.org.session.ownerId)).map((x) => x.frame_id).sort()).toEqual(again.screens.map((m) => m.id).sort());
    // A model that isn't on offer (it costs more than a model may): the default reads them, and the log says so.
    await r.org.api.notes.rewrite(r.noteId, { model: PRICEY_MODEL });
    await written(r.org.api, r.noteId);
    expect(logLine(logsFrom, 'model unavailable')).toMatchObject({ model: PRICEY_MODEL, instead: NOTES_MODEL });
  });

  it('takes no more frames than one for every fifteen seconds of sharing, the ones pointed at most plainly spread over the call, and one a second at most', async () => {
    const logsFrom = h.logs.length;
    const r = await presented({
      seconds: 60, share: minute, ms: 900,
      said: [
        [0, 'Let me start with the plan.'], [1, 'As you can see the plan is here.'], [10, 'As you can see the budget follows.'], [17, 'The budget is split in two.'],
        [25, 'What do you think of these changes?'], [33, 'Hiring comes after that.'], [41, 'Then the launch dates.'], [50, 'As you can see, step by step.'], [50.3, 'As you can see, the second step.'], [50.6, 'As you can see, the third step.'], [58, 'As you can see the whole plan.']
      ]
    });
    // Cues at 1, 10, 25, 50 (three lines in that second, kept once) and 58: five moments for room for four frames
    // (a minute of sharing), so they're spread over the call, and the one at 25 goes. No frame at the share's start or
    // end, and none to fill a stretch.
    const lines = r.note.transcript ?? [];
    const budget = Math.ceil(59.5 / SECONDS_PER_SCREEN_FRAME);
    expect(budget).toBe(4);
    expect(r.note.screens.map((m) => m.at)).toEqual([1, 10, 50, 58]);
    expect(r.note.screens.map((m) => m.line)).toEqual([1, 2, 7, 10].map((i) => lines[i]?.id));
    expect(r.note.screens.at(-1)?.until).toBe(60);
    const picked = logLine(logsFrom, 'screen moments picked');
    expect(picked).toMatchObject({ picked: 7, cued: 4, starts: 0, befores: 0, kept: 4 });
    expect(picked).not.toHaveProperty('filled');
    expect(r.chats.filter(isRead)).toHaveLength(budget);
    expect(r.prompts.filter((p) => p.includes('taken at [00:50]') && p.includes('Cue: As you can see, step by step.'))).toHaveLength(1);
    // Read by the notes model, nothing chosen.
    expect(new Set(r.chats.filter(isRead).map((c) => c.model))).toEqual(new Set([NOTES_MODEL]));
    // Written again: the same frames, and nothing taken or read again.
    const asked = h.near.chats.length;
    await r.org.api.notes.rewrite(r.noteId);
    await written(r.org.api, r.noteId);
    expect((await r.org.api.notes.get(r.noteId)).screens.map((m) => [m.id, m.at])).toEqual(r.note.screens.map((m) => [m.id, m.at]));
    expect(h.near.chats.slice(asked).filter(isRead)).toEqual([]);
  });

  it('reads at most one frame for every fifteen seconds of sharing, keeping what was pointed at plainly', async () => {
    const logsFrom = h.logs.length;
    // In twenty-second pieces, so the presenter's browser stays within how many it may send a minute.
    const long = cut(await recordedWebm(520, { size: '320x180' }), 26);
    // A line said every fourteen seconds while scrolling, each a moment: more than can be read (and as many lines as a
    // speaker may have transcribed in a minute).
    const said = Array.from({ length: 37 }, (_, i): [number, string] => [i * 14, `Now scroll through part ${i + 1}.`]);
    const r = await presented({ seconds: 520, share: long, every: 20, said: [...said, [255, 'As you can see this chart is the key one.'], [385, 'What do you think of these changes?']] });
    // Every frame is one what was said picked, spread over the call: no room for the share's start. Room for one for
    // every fifteen seconds of the 519.5 the share's video lasts, never more than the most.
    const budget = Math.min(MAX_SCREEN_FRAMES, Math.ceil(519.5 / SECONDS_PER_SCREEN_FRAME));
    expect(budget).toBe(35);
    const picked = logLine(logsFrom, 'screen moments picked');
    expect(picked).toMatchObject({ picked: 39, cued: budget, starts: 0, befores: 0, kept: budget });
    expect(picked).not.toHaveProperty('filled');
    expect(r.chats.filter(isRead)).toHaveLength(budget);
    // What was pointed at plainly is among the frames read, with its cue.
    expect(r.prompts.filter((p) => p.includes('taken at [04:15]') && p.includes('Cue: As you can see this chart is the key one.'))).toHaveLength(1);
    expect(r.prompts.filter((p) => p.includes('taken at [06:25]') && p.includes('Cue: What do you think of these changes?'))).toHaveLength(1);
    // At most one a line, and only frames shown are kept.
    expect(new Set(r.note.screens.map((m) => m.line)).size).toBe(r.note.screens.length);
    expect((await frameRows(r.org.session.ownerId)).map((x) => x.frame_id).sort()).toEqual(r.note.screens.map((m) => m.id).sort());
  }, 240_000);

  it('attaches a screen that doesn’t change once, on the line said when it was first pointed at, however often it is pointed at after', async () => {
    const logsFrom = h.logs.length;
    const still = await stills(40, [{ color: 'red', from: 0 }]);
    const r = await presented({
      seconds: 40, share: still,
      said: [[1, 'Let me share the plan.'], [29, 'As you can see the plan is up.'], [33, 'As you can see it has three parts.'], [36, 'As you can see the dates are set.']]
    });
    const lines = r.note.transcript ?? [];
    expect(r.note.screens.map((m) => [m.at, m.until, m.line])).toEqual([[29, 40, lines[1]?.id]]);
    // Three frames, one at each cue: that's all the room a share of forty seconds has (and none for its start).
    expect(logLine(logsFrom, 'screen moments picked')).toMatchObject({ cued: 3, starts: 0, befores: 0, kept: 3 });
    expect(r.chats.filter(isRead)).toHaveLength(3);
    // The notes read the frames that look the same as the first on one line, without what was read on them.
    const notesPrompt = lastNotesPrompt();
    expect(notesPrompt).toContain(`[00:29] [screen 1 from ${r.org.session.user.name}, clear, key, first of this share] Frame at 00:29.`);
    expect(notesPrompt).toContain('\n[00:33–00:36] [screens 2–3 same as screen 1]\n');
    expect(notesPrompt).not.toContain('Frame at 00:33');
    // Only the frame shown is kept.
    expect((await frameRows(r.org.session.ownerId)).map((x) => x.frame_id)).toEqual(r.note.screens.map((m) => m.id));
  });

  it('attaches a screen again where it changed, but never one that only gives context, by the same rules when the notes can’t be written, and reads notes from before frames were attached to lines', async () => {
    const slides = await stills(40, [{ color: 'red', from: 0 }, { color: 'blue', from: 20 }]);
    const r = await presented({ seconds: 40, share: slides, said: [[1, 'Here is where we start.'], [3, 'As you can see the first slide is up.'], [21, 'As you can see the next slide is up.'], [30, 'That covers the plan.']] });
    const lines = r.note.transcript ?? [];
    // Two cues and the share's start fill the three frames a share of forty seconds has room for. The start, which
    // nothing said points at, only gives context: it isn't attached, and what was read on it never reaches the notes.
    expect(r.chats.filter(isRead)).toHaveLength(3);
    expect(r.note.screens.map((m) => [m.at, m.until, m.line, m.relevance])).toEqual([[3, 21, lines[1]?.id, 'key'], [21, 40, lines[2]?.id, 'key']]);
    const notesPrompt = lastNotesPrompt();
    expect(notesPrompt).toContain(`[00:03] [screen 1 from ${r.org.session.user.name}, clear, key, first of this share] Frame at 00:03.`);
    expect(notesPrompt).toContain(`[00:21] [screen 2 from ${r.org.session.user.name}, clear, key, changed a lot since screen 1] Frame at 00:21.`);
    expect(notesPrompt).not.toContain('Frame at 00:00');
    expect(notesPrompt).not.toContain('Shown at 00:00');

    // A note saved before frames were attached to lines has no line on its screens: it reads as it did, placed by time.
    const res = await r.org.fetch(`${h.baseUrl}/v1/notes/${r.noteId}`);
    const raw = z.record(z.string(), z.unknown()).parse(await res.json());
    const before = z.array(z.record(z.string(), z.unknown())).parse(raw['screens']).map(({ line: _, ...m }) => m);
    expect(NoteSchema.parse({ ...raw, screens: before }).screens.map((m) => [m.at, m.line])).toEqual([[3, null], [21, null]]);

    // Written again, the notes can't be written, every time: the screens are attached by the same rules without the
    // notes model (only the key ones, one a line), and no frame they don't show is kept.
    const ownerId = r.org.session.ownerId;
    await rewriteFailing(r.org.api, ownerId, r.noteId, 'notes');
    const after = await r.org.api.notes.get(r.noteId);
    expect(after.summary).toBe(r.note.summary);
    expect(after.screens.map((m) => [m.id, m.at, m.until, m.line])).toEqual(r.note.screens.map((m) => [m.id, m.at, m.until, m.line]));
    expect((await frameRows(ownerId)).map((x) => x.frame_id).sort()).toEqual(after.screens.map((m) => m.id).sort());
  });

  it('reads a frame together with the screen five seconds before it when what was said is that it changed, and shows only the frame', async () => {
    const was = await bucket();
    const logsFrom = h.logs.length;
    const slides = await stills(40, [{ color: 'red', from: 0 }, { color: 'blue', from: 20 }]);
    const r = await presented({ seconds: 40, share: slides, said: [[1, 'Here is where we start.'], [22, 'It changed now, the new slide is up.']] });
    const lines = r.note.transcript ?? [];
    // The frame at 22, the one at 17 to compare it with, and the share's start in the room left.
    expect(logLine(logsFrom, 'screen moments picked')).toMatchObject({ picked: 1, cued: 1, starts: 1, befores: 1, kept: 3 });
    // Two requests read frames: the start alone, and the change with both images in one request, the earlier one first.
    // The frame before the change is never read on its own.
    const reads = r.chats.filter(isRead);
    expect(reads.map((c) => c.images).sort()).toEqual([1, 2]);
    expect(r.prompts.filter((p) => p.includes('taken at [00:17]'))).toEqual([]);
    const compared = r.prompts.filter((p) => p.includes('Two frames: the screen 5 seconds before, then the frame itself.'));
    expect(compared).toHaveLength(1);
    expect(compared[0]).toContain('taken at [00:22]');
    expect(compared[0]).toContain('Cue: It changed now, the new slide is up.');
    expect(logLine(logsFrom, 'shared screens read')).toMatchObject({ frames: 2, compared: 1 });
    // The note shows the frame, with what changed on it; the frame before and the start aren't among its screens.
    expect(r.note.screens.map((m) => [m.at, m.until, m.line])).toEqual([[22, 40, lines[1]?.id]]);
    expect(r.note.screens[0]).toMatchObject({ relevance: 'key', shows: 'A test pattern at 00:22', changed: 'Changed between the two frames.' });
    expect(lastNotesPrompt()).toContain('Changed: Changed between the two frames.');
    // Their rows and objects are gone once the notes are saved.
    expect((await frameRows(r.org.session.ownerId)).map((x) => x.frame_id)).toEqual(r.note.screens.map((m) => m.id));
    expect(await leftOver(was, r.org.session.ownerId)).toEqual([]);
  });

  it('takes the frame of a change on a share with room for one, not the share’s start nor the screen before it', async () => {
    const logsFrom = h.logs.length;
    const slides = await stills(15, [{ color: 'red', from: 0 }, { color: 'blue', from: 8 }]);
    const r = await presented({ seconds: 15, share: slides, said: [[1, 'Here is where we start.'], [10, 'It changed now, the new slide is up.']] });
    const lines = r.note.transcript ?? [];
    // Fifteen seconds of sharing has room for one frame: the moment's, read alone.
    expect(logLine(logsFrom, 'screen moments picked')).toMatchObject({ picked: 1, cued: 1, starts: 0, befores: 0, kept: 1 });
    expect(r.chats.filter(isRead).map((c) => c.images)).toEqual([1]);
    expect(r.note.screens.map((m) => [m.at, m.line])).toEqual([[10, lines[1]?.id]]);
  });

  it('takes a frame at the start of a share’s video for what was said about it just before the video began', async () => {
    const logsFrom = h.logs.length;
    const r = await presented({ seconds: 60, share: cut(await recordedWebm(15, { size: '320x180' }), 3), offset: 43, said: [[41.5, 'As you can see the chart is up.']] });
    const lines = r.note.transcript ?? [];
    expect(r.note.shares[0]?.at).toBe(43);
    expect(logLine(logsFrom, 'screen moments picked')).toMatchObject({ picked: 1, cued: 1, kept: 1 });
    expect(r.note.screens.map((m) => [m.at, m.cue, m.line])).toEqual([[43, 'As you can see the chart is up.', lines[0]?.id]]);
  });

  it('reads shared screens with the notes model when the model chosen can’t be verified, and writes the notes all the same', async () => {
    const logsFrom = h.logs.length;
    const r = await presented({ seconds: 20, share: pieces, model: UNVERIFIED_VISION_MODEL, said: [[2, 'As you can see the chart is up.']] });
    expect(r.note.summary).not.toBe('');
    expect(r.note.screens).toEqual([expect.objectContaining({ at: 2, legible: 'clear', line: r.note.transcript?.[0]?.id })]);
    // Nothing went to the model that didn't check out: the notes model read every frame, and the log says why.
    expect(r.chats.filter(isRead).length).toBeGreaterThan(0);
    expect(new Set(r.chats.filter(isRead).map((c) => c.model))).toEqual(new Set([NOTES_MODEL]));
    expect(r.chats.some((c) => c.model === UNVERIFIED_VISION_MODEL)).toBe(false);
    expect(logLine(logsFrom, 'model unverified')).toMatchObject({ model: UNVERIFIED_VISION_MODEL, instead: NOTES_MODEL });
  });

  it('keeps the note’s screens until new notes are saved, so notes that can’t be written again lose none of them', async () => {
    const r = await presented({ seconds: 20, share: pieces, said: [[2, 'As you can see the chart is up.'], [12, 'UNRELATED that was my private inbox, sorry.']] });
    const ownerId = r.org.session.ownerId;
    const shown = async (screens: { id: string }[]) => Promise.all(screens.map(async (m) => (await r.org.fetch(r.org.api.notes.screenUrl(r.noteId, m.id))).status));
    expect(new Set(await shown(r.note.screens))).toEqual(new Set([200]));

    // Written again, the notes model answers nothing usable, every time. Between attempts the note shows what it did,
    // every image there.
    await rewriteFailing(r.org.api, ownerId, r.noteId, undefined, async () => {
      expect((await r.org.api.notes.get(r.noteId)).screens).toEqual(r.note.screens);
      expect(new Set(await shown(r.note.screens))).toEqual(new Set([200]));
    });
    // Finished without new notes: every screen it shows still opens, and its frames are all still there.
    const after = await r.org.api.notes.get(r.noteId);
    expect(after.summary).toBe(r.note.summary);
    expect(after.screens.length).toBeGreaterThan(0);
    expect(new Set(await shown(after.screens))).toEqual(new Set([200]));
    const rows = new Set((await frameRows(ownerId)).map((x) => x.frame_id));
    expect(after.screens.every((m) => rows.has(m.id))).toBe(true);
  });

  it('takes a presenter’s last piece for a little while after the call ends, and joins it into the video', async () => {
    const org = await account(unique('organizer'));
    const ownerId = org.session.ownerId;
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    for (let i = 0; i < 4; i++) await host.appendAudio(audio(i));
    const share = await sharing(host, true);
    for (let i = 0; i < 3; i++) await host.appendScreen(piece(share.share, i));
    const noteId = (await host.leave())?.pendingNoteId ?? '';
    // The call is over, and the last piece of the share arrives just after.
    await host.appendScreen(piece(share.share, 3));
    expect(await ownerRows('screen_pieces', ownerId)).toHaveLength(4);
    // Once the tail is over, nothing more is taken.
    await h.pool.query(`UPDATE recordings SET ended_at = ended_at - interval '30 seconds' WHERE owner_id = $1`, [ownerId]);
    expect(await fails(host.appendScreen(piece(share.share, 4)))).toEqual(['not-found', 'That share doesn’t exist, or you don’t have access to it.']);
    expect(await ownerRows('screen_pieces', ownerId)).toHaveLength(4);

    await written(org.api, noteId);
    const note = await org.api.notes.get(noteId);
    expect(note.shares).toMatchObject([{ id: share.share, at: 0, until: 20 }]);
    const full = new Uint8Array(await (await org.fetch(org.api.notes.screenVideoUrl(noteId, share.share, 0))).arrayBuffer());
    expect(webmDuration(full)).toBeCloseTo(20, 0);
    expect(await ownerRows('screen_pieces', ownerId)).toEqual([]);
  });

  it('replays a kept share once the tail is over, before the notes are written, and says so in the note’s progress', async () => {
    const org = await account(unique('organizer'));
    const ownerId = org.session.ownerId;
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    for (let i = 0; i < 4; i++) await host.appendAudio(audio(i));
    const share = await sharing(host, true);
    for (let i = 0; i < 4; i++) await host.appendScreen(piece(share.share, i));
    await host.transcribe(speech('As you can see the chart is up.', 2), host.ticket.identity);
    await host.shareEnded(share.share);
    // The notes model is down for the whole of this, so the notes can't be written.
    h.near.failNext(10_000, 'down', 'notes');
    try {
      const noteId = (await host.leave())?.pendingNoteId ?? '';
      const snapshot = async () => { for await (const p of org.api.notes.progress(noteId)) return p; return undefined; };
      // Within the share's tail, the video isn't joined: it says it's getting ready.
      expect(await snapshot()).toMatchObject({ ready: false, steps: expect.arrayContaining([{ label: 'Getting shared screens ready to replay', done: false }]) });
      expect((await org.api.notes.get(noteId)).shares).toEqual([]);
      await h.pool.query(`UPDATE recordings SET ended_at = ended_at - interval '30 seconds' WHERE owner_id = $1`, [ownerId]);
      await h.pool.query(`UPDATE content_jobs SET lease_until = now() - interval '1 second' WHERE owner_id = $1`, [ownerId]);
      await work(h.deps, { ownerId });
      for (let i = 0; i < 400 && (await ownerRows('screen_pieces', ownerId)).length; i++) await sleep(50);

      // Joined while the notes still wait for their model.
      const p = await snapshot();
      expect(p?.ready).toBe(false);
      expect(p?.steps).toContainEqual({ label: 'Shared screens ready to replay', done: true });
      expect(p?.steps.at(-1)?.done).toBe(false);
      const note = await org.api.notes.get(noteId);
      expect(note.status).not.toBe('ready');
      expect(note.shares).toMatchObject([{ id: share.share, at: 0, until: 20 }]);
      const video = await org.fetch(org.api.notes.screenVideoUrl(noteId, share.share, 0));
      expect(video.status).toBe(200);
      expect(webmDuration(new Uint8Array(await video.arrayBuffer()))).toBeCloseTo(20, 0);
    } finally {
      h.near.failNext(0, 'down');
    }
  });

  it('joins a kept share into video on its own once the tail is over, with no notes service to write notes', async () => {
    const org = await account(unique('organizer'));
    const ownerId = org.session.ownerId;
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    for (let i = 0; i < 4; i++) await host.appendAudio(audio(i));
    const share = await sharing(host, true);
    for (let i = 0; i < 4; i++) await host.appendScreen(piece(share.share, i));
    await host.shareEnded(share.share);
    // The notes service isn't configured for the rest of this: no notes can be written, and replay doesn't wait for them.
    const configured = h.deps.cfg;
    h.deps.cfg = { ...configured, NEAR_AI_API_KEY: '' };
    try {
      const noteId = (await host.leave())?.pendingNoteId ?? '';
      const snapshot = async () => { for await (const p of org.api.notes.progress(noteId)) return p; return undefined; };
      expect(await snapshot()).toMatchObject({ ready: false, steps: expect.arrayContaining([{ label: 'Getting shared screens ready to replay', done: false }]) });
      expect(await ownerRows('screen_pieces', ownerId)).toHaveLength(4);
      // Nothing is told to join: the call ending set a timer for the end of the share's tail, which joins it (no worker, no maintenance run).
      for (let i = 0; i < 1200 && (await ownerRows('screen_pieces', ownerId)).length; i++) await sleep(50);

      expect(await ownerRows('screen_pieces', ownerId)).toEqual([]);
      const p = await snapshot();
      expect(p?.ready).toBe(false);
      expect(p?.steps).toContainEqual({ label: 'Shared screens ready to replay', done: true });
      const note = await org.api.notes.get(noteId);
      expect(note.status).not.toBe('ready');
      expect(note.shares).toMatchObject([{ id: share.share, at: 0, until: 20 }]);
      const video = await org.fetch(org.api.notes.screenVideoUrl(noteId, share.share, 0));
      expect([200, 206]).toContain(video.status);
      expect(webmDuration(new Uint8Array(await video.arrayBuffer()))).toBeCloseTo(20, 0);
    } finally {
      h.deps.cfg = configured;
    }
  });

  it('joins a share that is left in pieces when maintenance runs, and never twice when joins overlap', async () => {
    const org = await account(unique('organizer'));
    const ownerId = org.session.ownerId;
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    for (let i = 0; i < 4; i++) await host.appendAudio(audio(i));
    const share = await sharing(host, true);
    for (let i = 0; i < 4; i++) await host.appendScreen(piece(share.share, i));
    await host.shareEnded(share.share);
    const configured = h.deps.cfg;
    h.deps.cfg = { ...configured, NEAR_AI_API_KEY: '' };
    try {
      const noteId = (await host.leave())?.pendingNoteId ?? '';
      // Within the tail nothing is joined and the soonest end is reported; another account's pieces aren't looked at.
      const early = await joinDue(h.deps, ownerId);
      expect(early.joined).toBe(0);
      expect(early.waitMs).toBeGreaterThan(0);
      expect(await joinDue(h.deps, (await account()).session.ownerId)).toEqual({ joined: 0, waitMs: null });
      expect(await ownerRows('screen_pieces', ownerId)).toHaveLength(4);

      await h.pool.query(`UPDATE recordings SET ended_at = ended_at - interval '30 seconds' WHERE owner_id = $1`, [ownerId]);
      // Maintenance and two more joins start together: the video is joined once.
      const runs = await Promise.all([maintain(h.deps), joinDue(h.deps, ownerId), joinDue(h.deps)]);
      expect(runs.map((r) => ('videos' in r ? r.videos : r.joined)).reduce((a, b) => a + b, 0)).toBe(1);
      expect(await ownerRows('screen_pieces', ownerId)).toEqual([]);
      expect(new Set((await ownerRows('screen_videos', ownerId)).map((r) => `${String(r['share_id'])}/${String(r['segment'])}`)).size).toBe(1);
      // Nothing left to do afterwards.
      expect(await joinDue(h.deps)).toEqual({ joined: 0, waitMs: null });
      expect((await org.fetch(org.api.notes.screenVideoUrl(noteId, share.share, 0))).status).toBe(200);
    } finally {
      h.deps.cfg = configured;
    }
  });

  it('reads nothing of a share its presenter kept out of the notes', async () => {
    const r = await presented({ seconds: 20, share: pieces, keep: false, said: [[2, 'As you can see the chart is up.']] });
    expect(r.note.shares).toEqual([]);
    expect(r.note.screens).toEqual([]);
    expect(r.chats.filter((c) => isRead(c) || isPick(c))).toEqual([]);
    expect(await frameRows(r.org.session.ownerId)).toEqual([]);
  });
});
