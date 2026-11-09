/**
 * Shared screens in a call's notes (docs: Calls and recordings › Shared screens), end to end: the real API over HTTP
 * via @alcove/api-http, real Postgres, the object store, a real LiveKit server (presenters publish their screen with
 * @livekit/rtc-node, joined with the tokens the API hands out, as a browser does) and main's fake NEAR AI, which reads
 * what a test wrote into a frame. The organizer turns screen notes on; each presenter's own browser sends frames of
 * its own share; the notes model reads them after the call, sealed to its verified key; the notes point at them.
 */
import { AlcoveApiError, MAX_FRAME_BYTES, type AlcoveApi, type AudioPiece, type CallSession, type CallState, type NoteProgress, type ScreenFrame, type TranscriptClip } from '@alcove/api';
import { createHttpApi } from '@alcove/api-http';
import { randomBytes } from 'node:crypto';
import { request } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { maintain } from '../../maintenance';
import { screenJpeg, speechWav, type ScreenShown } from '../../testing/fake-near';
import { ORIGIN, cookieFetch, startHarness, type Harness } from '../../testing/harness';
import { connect, disposeLiveKit, type TestParticipant } from '../../testing/livekit';

// Presenters share through a real LiveKit server, which a busy CI runner can be slow to set up; every wait says what it waited for.
vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });

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
const open: TestParticipant[] = [];
/** Connects to the call's room the way a browser does, once let in, encrypting what it sends with its own key. */
async function joinRoom(call: CallSession): Promise<TestParticipant> {
  await inGroup(call);
  const p = await connect(await call.room(), { sending: call.crypto });
  open.push(p);
  return p;
}
afterEach(async () => { await Promise.all(open.splice(0).map((p) => p.disconnect().catch(() => undefined))); h.closeCalls(); });
/**
 * Shares a screen, without its sound, the way a browser does, and waits until LiveKit's server lists it, which is what
 * the API checks a frame against. Returns the share's track sid.
 */
async function screenOf(p: TestParticipant): Promise<string> {
  const { screen } = await p.publishScreen(false);
  const room = p.room.name ?? '';
  for (let i = 0; i < 300; i++) {
    if ((await h.deps.livekit.screenShares(room)).some((x) => x.sid === screen)) return screen;
    await sleep(50);
  }
  throw new Error('timed out waiting for LiveKit to list the share');
}

const audio = (segment: number, s: number): AudioPiece => {
  const src = Buffer.concat([Buffer.from('audio'), randomBytes(1024)]);
  const bytes = new Uint8Array(new ArrayBuffer(src.length));
  bytes.set(src);
  return { data: new Blob([bytes]), segment, seq: s, at: s * 5, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' };
};
/** A clip of speech, starting `atMs` milliseconds into its segment. */
const speech = (words: string, segment: number, atMs: number, ms = 4000): TranscriptClip => ({ data: new Blob([speechWav(words, ms)], { type: 'audio/wav' }), segment, at: atMs / 1000, durationMs: ms });
let salt = 0;
/** A frame of a share showing `shown` (nothing legible without it), taken now unless said otherwise. Each is a different image. */
const frameOf = (share: string, shown: ScreenShown | null, o: { takenAt?: number; jpeg?: Uint8Array<ArrayBuffer> } = {}): ScreenFrame =>
  ({ data: new Blob([o.jpeg ?? screenJpeg(shown, 1280, 720, `${salt++}`)], { type: 'image/jpeg' }), share, takenAt: o.takenAt ?? Date.now() });
const CHART: ScreenShown = { title: 'Q3 sign-ups by week', lines: ['Q3 sign-ups by week', 'Launch moves to Nov 18, target 12,000', 'W3 dip: the form was broken'], regions: [{ label: 'Bar chart', box: [0.05, 0.22, 0.67, 0.78] }] };
const CODE: ScreenShown = { title: 'billing/charge.ts', lines: ['export async function charge(account, minutes) {', '  // TODO: refuse or go negative'] };
/** A frame straight to the API with someone's pass, as their browser would send it, with whatever headers and body a test wants. */
const sendFrame = (call: CallSession, body: Uint8Array<ArrayBuffer>, headers: Record<string, string>, callId = call.ticket.callId) => fetch(`${h.baseUrl}/v1/live/calls/${callId}/frames`, {
  method: 'POST', headers: { origin: ORIGIN, 'x-alcove-call': call.ticket.pass, 'content-type': 'image/jpeg', ...headers }, body
});
/**
 * A frame over the size limit, on a connection of its own: the API refuses it from its declared length without
 * reading it, and the connection isn't one a later request shares.
 */
const oversized = (call: CallSession, share: string, bytes: number) => new Promise<number>((resolve, reject) => {
  const body = Buffer.alloc(bytes);
  Buffer.from(screenJpeg(CHART)).copy(body);
  const req = request(`${h.baseUrl}/v1/live/calls/${call.ticket.callId}/frames`, {
    method: 'POST', agent: false,
    headers: { origin: ORIGIN, 'x-alcove-call': call.ticket.pass, 'content-type': 'image/jpeg', 'content-length': String(bytes), 'x-alcove-share': share }
  }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
  req.on('error', reject);
  req.end(body);
});
const act = async (call: CallSession, action: unknown) => (await fetch(`${h.baseUrl}/v1/live/calls/${call.ticket.callId}/actions`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-alcove-call': call.ticket.pass }, body: JSON.stringify(action)
})).status;
async function written(api: AlcoveApi, noteId: string): Promise<NoteProgress[]> {
  const steps: NoteProgress[] = [];
  for await (const p of api.notes.progress(noteId)) steps.push(p);
  return steps;
}
const frames = async (ownerId: string) => (await h.pool.query<{ object_id: string; cipher_bytes: string }>('SELECT object_id, cipher_bytes FROM screen_frames WHERE owner_id = $1', [ownerId])).rows;
const PAUSED = 'Notes are paused. Nothing is recorded, transcribed or sent to the AI until the organizer resumes.';
const OFF = 'Shared screens aren’t read for the notes right now.';
const NOT_YOURS = 'That isn’t a screen you’re sharing in this call.';
const FULL = 'The notes have kept as many shared screens as they can for this call.';

describe('shared screens in the notes', () => {
  it('lets only the organizer have shared screens read, only with notes on, and shows everyone, and anyone asking to join, what’s read', async () => {
    const org = await account(unique('organizer'));
    const invitedEmail = unique('invited');
    const { code: c } = await org.api.calls.startNow({ notes: 'on', guests: [invitedEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    // Off until the organizer says so, whatever notes are doing.
    expect(host.getSnapshot().capture).toMatchObject({ mode: 'on', screen: { mode: 'off', since: null, by: null } });
    const invited = await (await account(invitedEmail)).api.calls.join(c, { mic: true, cam: false });
    await inGroup(invited);
    const guest = await h.browser().api.calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, guest);

    // Nobody but the organizer, and nobody without the call's pass.
    for (const call of [invited, guest]) expect(await act(call, { type: 'screens', on: true })).toBe(403);
    expect(host.getSnapshot().capture.screen.mode).toBe('off');

    // Frames go into the notes, so there have to be notes.
    await host.setNotes(false);
    expect(await fails(host.setScreens(true))).toEqual(['conflict', 'Turn on notes first: shared screens are read for the notes.']);
    await host.setNotes(true);

    await host.setScreens(true);
    let s = host.getSnapshot();
    expect(s.capture.screen).toEqual({ mode: 'on', since: expect.any(String), by: { kind: 'organizer', name: org.session.user.name } });
    expect(s.notices.at(-1)?.text).toBe('The organizer turned on shared screens in the notes. What anyone shares is read for them.');
    // Everyone in the call sees it, with who did it; the card and anyone asking to join see it without a name.
    for (const call of [invited, guest]) expect((await settle(call, (x) => x.capture.screen.mode === 'on')).capture.screen.by).toEqual({ kind: 'organizer', name: org.session.user.name });
    const card = await h.browser().api.calls.card(c);
    expect(card.capture?.screen).toEqual({ mode: 'on', since: expect.any(String), by: { kind: 'organizer' } });
    const waiting = await h.browser().api.calls.join(c, { mic: true, cam: false, name: 'Lee' });
    expect(waiting.getSnapshot().capture.screen).toEqual(card.capture?.screen);
    expect(JSON.stringify(waiting.getSnapshot().capture)).not.toContain(org.session.user.name);

    // Turning it on again changes nothing. A pause holds it with everything else; resuming brings it back.
    await host.setScreens(true);
    await host.pause();
    expect(host.getSnapshot().capture.screen).toEqual({ mode: 'paused', since: expect.any(String), by: { kind: 'organizer', name: org.session.user.name } });
    await host.resume();
    expect(host.getSnapshot().capture.screen.mode).toBe('on');
    // Turning notes off stops it; turning them on again doesn't bring it back: that's the organizer's choice each time.
    await host.setNotes(false);
    expect(host.getSnapshot().capture.screen).toMatchObject({ mode: 'off', by: { kind: 'organizer' } });
    await host.setNotes(true);
    expect(host.getSnapshot().capture.screen.mode).toBe('off');
    await host.setScreens(true);
    await host.setScreens(false);
    s = host.getSnapshot();
    expect(s.capture.screen).toMatchObject({ mode: 'off', since: expect.any(String), by: { kind: 'organizer' } });
    expect(s.notices.at(-1)?.text).toBe('The organizer turned off shared screens in the notes. What was shared before is kept.');
    await host.leave();
  });

  it('takes frames only of the presenter’s own share, only while screen notes are on, and keeps the same frame once', async () => {
    const org = await account(unique('organizer'));
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const host = await org.api.calls.join(c, { mic: true, cam: true });
    const guest = await h.browser().api.calls.join(c, { mic: true, cam: false, name: 'Priya' });
    await letIn(host, guest);
    const hostRoom = await joinRoom(host);
    const guestRoom = await joinRoom(guest);
    const share = await screenOf(guestRoom);
    const camera = await hostRoom.publishCamera();
    expect(share).toMatch(/^TR_/);

    // Before the organizer turns it on, nothing is taken.
    expect(await fails(guest.shareFrame(frameOf(share, CHART)))).toEqual(['conflict', OFF]);
    await host.setScreens(true);
    const first = await guest.shareFrame(frameOf(share, CHART, { jpeg: screenJpeg(CHART, 1280, 720, 'first') }));
    expect(first).toEqual({ id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), duplicate: false });
    // Sent again (its answer was lost): kept once, with the ID it has.
    expect(await guest.shareFrame(frameOf(share, CHART, { jpeg: screenJpeg(CHART, 1280, 720, 'first') }))).toEqual({ id: first.id, duplicate: true });
    expect((await frames(org.session.ownerId)).length).toBe(1);

    // Only the presenter's own share: not someone else's, not a camera, not one that doesn't exist.
    expect(await fails(host.shareFrame(frameOf(share, CHART)))).toEqual(['forbidden', NOT_YOURS]);
    expect(await fails(host.shareFrame(frameOf(camera, CHART)))).toEqual(['forbidden', NOT_YOURS]);
    expect(await fails(guest.shareFrame(frameOf('TR_notarealshare1', CHART)))).toEqual(['forbidden', NOT_YOURS]);
    // Nor from someone still asking to join, who isn't in the call.
    const asking = await h.browser().api.calls.join(c, { mic: true, cam: false, name: 'Lee' });
    expect(await fails(asking.shareFrame(frameOf(share, CHART)))).toEqual(['forbidden', 'Wait until the host lets you in.']);
    // Only JPEGs of a sensible size, with the share named, refused before anything is kept.
    const jpeg = screenJpeg(CHART);
    expect((await sendFrame(guest, jpeg, { 'x-alcove-share': 'not-a-share' })).status).toBe(400);
    expect((await sendFrame(guest, jpeg, {})).status).toBe(400);
    expect((await sendFrame(guest, new Uint8Array(randomBytes(4096)), { 'x-alcove-share': share })).status).toBe(400);
    expect((await sendFrame(guest, screenJpeg(CHART, 32, 32), { 'x-alcove-share': share })).status).toBe(400);
    expect((await sendFrame(guest, screenJpeg(CHART, 5000, 3000), { 'x-alcove-share': share })).status).toBe(400);
    expect((await sendFrame(guest, jpeg, { 'x-alcove-share': share, 'content-type': 'image/png' })).status).toBe(400);
    // A pass for one call can't send frames into another.
    const other = await account();
    const elsewhere = await other.api.calls.join((await other.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    expect((await sendFrame(guest, jpeg, { 'x-alcove-share': share }, elsewhere.ticket.callId)).status).toBe(401);
    await elsewhere.leave();
    expect((await frames(org.session.ownerId)).length).toBe(1);

    // Paused: nothing is taken, whoever sends it, and nothing goes to the AI.
    await host.pause();
    const sent = h.near.calls.length;
    expect(await fails(guest.shareFrame(frameOf(share, CODE)))).toEqual(['conflict', PAUSED]);
    expect(h.near.calls.length).toBe(sent);
    await host.resume();
    // A frame taken while paused (sent late) stays out too; one taken now is kept.
    expect(await fails(guest.shareFrame(frameOf(share, CODE, { takenAt: Date.now() - 4000 })))).toEqual(['conflict', 'That frame was taken before screen notes were on, so it isn’t kept.']);
    expect((await guest.shareFrame(frameOf(share, CODE))).duplicate).toBe(false);
    // Screen notes off, or notes off: nothing more.
    await host.setScreens(false);
    expect(await fails(guest.shareFrame(frameOf(share, CODE)))).toEqual(['conflict', OFF]);
    await host.setNotes(false);
    expect(await fails(guest.shareFrame(frameOf(share, CODE)))).toEqual(['conflict', 'Notes aren’t on right now.']);
    expect((await frames(org.session.ownerId)).length).toBe(2);
    await host.leave();
  });

  it('takes 24 frames a minute from a presenter and none over 1 MiB, keeping nothing it refuses', async () => {
    const org = await account(unique('organizer'));
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const guest = await h.browser().api.calls.join(c, { mic: true, cam: false, name: 'Ade' });
    await letIn(host, guest);
    const share = await screenOf(await joinRoom(guest));
    await host.setScreens(true);
    // Over 1 MiB: refused before it's read, and nothing is kept.
    expect(await oversized(guest, share, MAX_FRAME_BYTES + 1)).toBe(400);
    expect(await frames(org.session.ownerId)).toEqual([]);
    // 24 a minute from one presenter, each kept; the 25th is refused before anything is read or kept.
    for (let i = 0; i < 24; i++) expect((await guest.shareFrame(frameOf(share, CHART))).duplicate).toBe(false);
    expect((await sendFrame(guest, screenJpeg(CHART, 1280, 720, 'one-too-many'), { 'x-alcove-share': share })).status).toBe(503);
    expect((await frames(org.session.ownerId)).length).toBe(24);
    // Someone else's allowance is their own.
    const hostShare = await screenOf(await joinRoom(host));
    expect((await host.shareFrame(frameOf(hostShare, CODE))).duplicate).toBe(false);
    await host.leave();
  });

  it('turns screen notes off for everyone once the notes have kept as many frames as they can', async () => {
    const server = await h.secondServer({ SCREEN_FRAMES_MAX: 2 });
    const api = createHttpApi({ baseUrl: server.baseUrl, fetch: cookieFetch(ORIGIN), callPollMs: 50 });
    const { session } = await api.auth.signIn('sso', { email: unique('organizer') });
    const host = await api.calls.join((await api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    try {
      const share = await screenOf(await joinRoom(host));
      await host.setScreens(true);
      await host.shareFrame(frameOf(share, CHART));
      await host.shareFrame(frameOf(share, CODE));
      // One too many: refused, and screen notes turn off for everyone, saying why.
      expect(await fails(host.shareFrame(frameOf(share, CHART)))).toEqual(['conflict', FULL]);
      const s = await settle(host, (x) => x.capture.screen.mode === 'off');
      expect(s.capture.screen.by).toEqual({ kind: 'organizer', name: session.user.name });
      expect(s.notices.at(-1)?.text).toBe('Shared screens are off: the notes have kept as many as they can for this call. What was shared is kept.');
      // They stay off for this call: the organizer can't turn them on again, and what was kept stays.
      expect(await fails(host.setScreens(true))).toEqual(['conflict', FULL]);
      expect((await frames(session.ownerId)).length).toBe(2);
      await host.leave();
    } finally {
      host.close();
      await server.close();
    }
  });

  it('stops a share where its presenter’s browser says it ended, or where they leave, and refuses frames of a share that’s over', async () => {
    const org = await account(unique('organizer'));
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    // No microphone, so no audio: frames are placed by the call's clock.
    const host = await org.api.calls.join(c, { mic: false, cam: false });
    const guest = await h.browser().api.calls.join(c, { mic: true, cam: false, name: 'Ines' });
    await letIn(host, guest);
    const room = await joinRoom(guest);
    const first = await screenOf(room);
    await host.setScreens(true);
    const a = await guest.shareFrame(frameOf(first, CHART));
    // Taken down without the browser saying so: once what LiveKit said runs out (10 s), its frames are refused.
    await room.unpublish(first);
    await sleep(10_500);
    expect(await fails(guest.shareFrame(frameOf(first, CODE)))).toEqual(['forbidden', NOT_YOURS]);
    // The browser says a share ended: its frames are refused at once, though LiveKit still lists it.
    const second = await screenOf(room);
    const b = await guest.shareFrame(frameOf(second, CODE));
    await sleep(1000);
    await guest.shareEnded(second);
    expect(await fails(guest.shareFrame(frameOf(second, CHART)))).toEqual(['forbidden', NOT_YOURS]);
    await room.unpublish(second);
    // A pause, then a share after it; the presenter leaves while sharing, and the call goes on without them.
    await sleep(1000);
    await host.pause();
    await host.resume();
    const third = await screenOf(room);
    const d = await guest.shareFrame(frameOf(third, CHART));
    await sleep(1500);
    await guest.leave();
    await settle(host, (x) => !x.participants.some((p) => p.id === guest.ticket.identity));
    await sleep(2500);
    const noteId = (await host.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);
    const note = await org.api.notes.get(noteId);
    const [ma, mb, md] = note.screens;
    if (!ma || !mb || !md) throw new Error('expected three screen moments');
    expect([ma.id, mb.id, md.id]).toEqual([a.id, b.id, d.id]);
    // The second stops where its browser said it ended, a second after it was shown; the first, with nothing said, at the pause.
    expect(mb.until - mb.at).toBeGreaterThanOrEqual(0.9);
    expect(mb.until).toBeLessThan(ma.until);
    // After the pause, in order: not placed from the start again.
    expect(md.at).toBeGreaterThanOrEqual(ma.until);
    // The third stops where its presenter left, not at the end of the recording.
    expect(md.until - md.at).toBeGreaterThanOrEqual(1.4);
    expect(md.until).toBeLessThan(note.duration - 2);
  });

  it('keeps what’s shared in a breakout room out of the notes, and takes the main room’s', async () => {
    const org = await account(unique('organizer'));
    const kofiEmail = unique('kofi');
    const { code: c } = await org.api.calls.startNow({ notes: 'on', guests: [kofiEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const kofi = await (await account(kofiEmail)).api.calls.join(c, { mic: true, cam: false });
    await inGroup(kofi);
    const kofiShare = await screenOf(await joinRoom(kofi));
    const hostShare = await screenOf(await joinRoom(host));
    await host.setScreens(true);
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofiEmail] }, { name: 'Support', emails: [] }], minutes: 5, board: { mode: 'none', template: 'blank' } });
    const s = await settle(host, (x) => x.breakouts.open !== null);
    const ROOM = 'What’s shared in a breakout room stays in the room. It isn’t read for the notes.';
    expect(await fails(kofi.shareFrame(frameOf(kofiShare, CHART)))).toEqual(['conflict', ROOM]);
    // The organizer, in the main room, is still in the notes; visiting a room, not.
    expect((await host.shareFrame(frameOf(hostShare, CODE))).duplicate).toBe(false);
    host.visitRoom(s.breakouts.open?.rooms[0]?.id ?? '');
    await settle(host, (x) => x.breakouts.open?.rooms[0]?.members.includes(host.ticket.identity) ?? false);
    expect(await fails(host.shareFrame(frameOf(hostShare, CODE)))).toEqual(['conflict', ROOM]);
    host.closeRooms();
    await settle(host, (x) => x.breakouts.open === null);
    expect((await kofi.shareFrame(frameOf(kofiShare, CHART))).duplicate).toBe(false);
    expect((await frames(org.session.ownerId)).length).toBe(2);
    // Nothing was said, so there are no notes to write; what was on screen is still read and kept.
    const noteId = (await host.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);
    const note = await org.api.notes.get(noteId);
    expect([note.summary, note.transcript]).toEqual(['', []]);
    expect(note.screens.map((m) => [m.title, m.legible, m.presenter?.name])).toEqual([['billing/charge.ts', 'clear', org.session.user.name], ['Q3 sign-ups by week', 'clear', expect.any(String)]]);
  });

  it('places each frame where its presenter was when it was taken: one from the main room just before they left is kept, one from a room stays out', async () => {
    const org = await account(unique('organizer'));
    const kofiEmail = unique('kofi');
    const { code: c } = await org.api.calls.startNow({ notes: 'on', guests: [kofiEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const kofi = await (await account(kofiEmail)).api.calls.join(c, { mic: true, cam: false });
    await inGroup(kofi);
    const kofiShare = await screenOf(await joinRoom(kofi));
    await host.setScreens(true);
    const ROOM = 'What’s shared in a breakout room stays in the room. It isn’t read for the notes.';
    // Kofi takes a frame in the main room, and a second later the rooms open, sending him to Design, before it
    // arrives: it's kept.
    const inMain = Date.now();
    await sleep(1000);
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofiEmail] }, { name: 'Support', emails: [] }], minutes: 5, board: { mode: 'none', template: 'blank' } });
    await settle(host, (x) => x.breakouts.open !== null);
    expect((await kofi.shareFrame(frameOf(kofiShare, CODE, { takenAt: inMain }))).duplicate).toBe(false);
    // One he takes in Design stays out, while he's there and once the rooms have closed.
    const inDesign = Date.now();
    expect(await fails(kofi.shareFrame(frameOf(kofiShare, CHART, { takenAt: inDesign })))).toEqual(['conflict', ROOM]);
    // He stays a while in Design.
    await sleep(1500);
    host.closeRooms();
    await settle(host, (x) => x.breakouts.open === null);
    expect(await fails(kofi.shareFrame(frameOf(kofiShare, CHART, { takenAt: inDesign })))).toEqual(['conflict', ROOM]);
    // Back in the main room, his share is read again: leaving it ended his share there by presenter, not by share.
    expect((await kofi.shareFrame(frameOf(kofiShare, CHART))).duplicate).toBe(false);
    expect((await frames(org.session.ownerId)).length).toBe(2);
    // Call ends are whole seconds, while frames use tenths. Include the confirmed last frame in the recorded
    // duration before ending; otherwise end rounding can clip it and shorten the room gap this flow verifies.
    const startedAt = Date.parse(host.getSnapshot().startedAt);
    const recordedThrough = Math.ceil((Date.now() - startedAt) / 1000);
    await waitFor(() => Math.round((Date.now() - startedAt) / 1000) >= recordedThrough, 'the recording clock to include its last confirmed frame');
    // In the notes, the frame he took before he went stops where he left the main room, not where he came back: what
    // the main room had on screen while he was in Design was nothing of his.
    const noteId = (await host.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);
    const note = await org.api.notes.get(noteId);
    expect(note.screens.map((m) => m.title)).toEqual(['billing/charge.ts', 'Q3 sign-ups by week']);
    const [before, after] = note.screens;
    expect((after?.at ?? 0) - (before?.until ?? 0)).toBeGreaterThanOrEqual(1.4);
  });

  it('reads what was shared with the private notes model, ties each frame to what was said then, and answers from it', async () => {
    const org = await account(unique('organizer'));
    const kofiEmail = unique('kofi');
    const { code: c } = await org.api.calls.startNow({ notes: 'on', guests: [kofiEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const priya = await h.browser().api.calls.join(c, { mic: true, cam: false, name: 'Priya Shah' });
    await letIn(host, priya);
    const priyaShare = await screenOf(await joinRoom(priya));
    const hostShare = await screenOf(await joinRoom(host));
    // A minute of audio, so every line and frame below sits inside the recording.
    for (let i = 0; i < 12; i++) await host.appendAudio(audio(0, i));
    await host.setScreens(true);
    const start = Date.parse(host.getSnapshot().startedAt);
    const now = () => (Date.now() - start) / 1000;

    // Priya shows a chart; what's said about it comes after it, then her next slide, then her share ends.
    const chart = await priya.shareFrame(frameOf(priyaShare, CHART, { jpeg: screenJpeg(CHART, 1280, 720, 'flow-chart') }));
    const l1 = Math.ceil(now()) + 1;
    await host.transcribe(speech('We agreed this chart is right about the W3 dip. // Is the target still 12,000?', 0, l1 * 1000), host.ticket.identity);
    // Her next slide comes once what was said about the chart is behind it.
    await waitFor(() => now() > l1 + 2.5, 'the chart’s stretch of the call');
    const slide = await priya.shareFrame(frameOf(priyaShare, CODE));
    const l3 = Math.ceil(now()) + 1;
    await host.transcribe(speech('Kofi will fix that bug by Friday.', 0, l3 * 1000), host.ticket.identity);
    await waitFor(() => now() > l3 + 0.5, 'the code’s stretch of the call');
    await priya.shareEnded(priyaShare);
    // The organizer's own screen, which nobody can read.
    const blur = await host.shareFrame(frameOf(hostShare, null, { jpeg: screenJpeg(null, 1280, 720, 'flow-blur') }));
    await host.transcribe(speech('That is everything for today.', 0, (Math.ceil(now()) + 2) * 1000), host.ticket.identity);

    const noteId = (await host.leave())?.pendingNoteId ?? '';
    // While the notes are written, the note already shows what was on screen, where it was, not read yet.
    const pending = await org.api.notes.get(noteId);
    expect(pending.screens.map((m) => [m.id, m.legible])).toEqual([[chart.id, 'unread'], [slide.id, 'unread'], [blur.id, 'unread']]);
    await written(org.api, noteId);
    const proposal = (await org.api.notes.get(noteId)).suggestions[0];
    if (!proposal) throw new Error('expected a screen-linked follow-up proposal');
    const note = await org.api.notes.reviewAction(noteId, { id: proposal.id, revision: proposal.revision, decision: 'accept' });
    const [a, b, u] = note.screens;
    if (!a || !b || !u) throw new Error('expected three screen moments');

    // Read, sealed to the verified notes model: it got each image, and nothing went any other way.
    expect(h.near.images.filter((i) => i.salt === 'flow-chart').map((i) => i.marker)).toEqual([JSON.stringify(CHART)]);
    expect(h.near.images.filter((i) => i.salt === 'flow-blur').map((i) => i.marker)).toEqual([null]);
    expect(h.near.calls.filter((x) => x.encryption === 'none')).toEqual([]);
    expect(a).toMatchObject({
      share: priyaShare, presenter: { name: 'Priya Shah' }, width: 1280, height: 720, legible: 'clear', title: 'Q3 sign-ups by week',
      text: 'Q3 sign-ups by week\nLaunch moves to Nov 18, target 12,000\nW3 dip: the form was broken', regions: [{ label: 'Bar chart', x: 0.05, y: 0.22, w: 0.62, h: 0.56 }],
      description: 'Q3 sign-ups by week, shown while: We agreed this chart is right about the W3 dip.'
    });
    expect(b).toMatchObject({ share: priyaShare, title: 'billing/charge.ts', legible: 'clear', regions: [] });
    expect(u).toMatchObject({ share: hostShare, presenter: { name: org.session.user.name }, legible: 'unreadable', title: '', text: '' });
    // Each on screen from when it was shown until its share's next frame, or its share ended.
    expect(a.at).toBeLessThan(l1);
    expect(a.until).toBe(b.at);
    expect(b.at).toBeGreaterThan(l1 + 2);
    expect(b.at).toBeLessThan(l3);
    expect(b.until).toBeGreaterThan(l3);
    expect(b.until).toBeLessThanOrEqual(u.at + 0.1);
    // What was said about a screen points at it: plainly ("this chart", and the part meant) or only maybe ("that").
    expect(note.decisions.map((d) => [d.text, d.screen])).toEqual([['We agreed this chart is right about the W3 dip.', { id: a.id, region: 0, sure: true }]]);
    // What backs it is the line it was said in and the moment of the screen it was about, with the part meant.
    expect(note.decisions[0]?.evidence).toMatchObject({ flags: [], moments: [{ kind: 'line', text: 'We agreed this chart is right about the W3 dip.' }, { kind: 'screen', id: a.id, at: a.at, title: a.title, region: 0, part: a.regions[0]?.label, sure: true }] });
    expect(note.actions.map((x) => [x.text, x.screen])).toEqual([['Fix that bug by Friday', { id: b.id, sure: false }]]);
    expect(note.questions.map((x) => [x.text, x.screen])).toEqual([['Is the target still 12,000?', undefined]]);
    // The notes model read the screens among the lines, where they were shown.
    const prompt = h.near.prompts.at(-1) ?? '';
    expect(prompt).toContain(`[screen 1 from Priya Shah (guest), clear] Q3 sign-ups by week. Reads: Q3 sign-ups by week / Launch moves to Nov 18, target 12,000 / W3 dip: the form was broken Parts: (1) Bar chart`);
    expect(prompt).toContain(`[screen 3 from ${org.session.user.name}, unreadable] Untitled.`);

    // Answers say which screen they come from.
    const parts: unknown[] = [];
    for await (const p of org.api.notes.ask(noteId, 'What did the chart show?')) parts.push(p);
    expect(parts).toEqual([{ type: 'text', text: 'From the call: We agreed this chart is right about the W3 dip.' }, { type: 'cite', noteId, at: l1 }, { type: 'screen', id: a.id, at: a.at }]);

    // The image is the frame Priya's browser sent, for anyone who has the notes, and nobody else.
    const image = await org.fetch(org.api.notes.screenUrl(noteId, a.id));
    expect([image.status, image.headers.get('content-type'), image.headers.get('cache-control')]).toEqual([200, 'image/jpeg', 'no-store']);
    expect(String(Buffer.from(await image.arrayBuffer()))).toContain('Q3 sign-ups by week');
    const kofi = await account(kofiEmail);
    expect((await kofi.api.notes.get(noteId)).screens.map((m) => m.id)).toEqual([a.id, b.id, u.id]);
    expect((await kofi.fetch(kofi.api.notes.screenUrl(noteId, b.id))).status).toBe(200);
    const stranger = await account();
    expect((await stranger.fetch(stranger.api.notes.screenUrl(noteId, a.id))).status).toBe(404);
    // A frame of another note, or an ID that isn't one, isn't found under this one.
    const theirs = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    const theirNote = (await theirs.leave())?.pendingNoteId ?? '';
    expect((await org.fetch(org.api.notes.screenUrl(theirNote, a.id))).status).toBe(404);
    expect((await org.fetch(org.api.notes.screenUrl(noteId, 'not-an-id'))).status).toBe(404);
  });

  it('deletes every frame with its note: rows, objects and what was read on them', async () => {
    const org = await account(unique('organizer'));
    const host = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    const share = await screenOf(await joinRoom(host));
    await host.appendAudio(audio(0, 0));
    await host.setScreens(true);
    await host.shareFrame(frameOf(share, CHART));
    await host.shareFrame(frameOf(share, CODE));
    await host.transcribe(speech('We agreed this chart is right.', 0, 1000), host.ticket.identity);
    const noteId = (await host.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);
    const ids = (await org.api.notes.get(noteId)).screens.map((m) => m.id);
    expect(ids).toHaveLength(2);
    const kept = await frames(org.session.ownerId);
    expect(kept).toHaveLength(2);
    // Maintenance knows a note's frames are in use, however old.
    await sleep(1100);
    await maintain(h.deps, { orphanAgeMs: 0 });
    for (const f of kept) expect(await h.objects.get(f.object_id).then(() => 'kept', () => 'gone')).toBe('kept');
    const stored = async () => Number((await h.pool.query('SELECT stored_bytes FROM owners WHERE owner_id = $1', [org.session.ownerId])).rows[0]?.stored_bytes ?? -1);
    const audioBytes = Number((await h.pool.query('SELECT coalesce(sum(cipher_bytes), 0)::bigint AS n FROM recording_pieces WHERE owner_id = $1', [org.session.ownerId])).rows[0]?.n ?? 0);
    const before = await stored();

    await org.api.notes.delete(noteId);
    expect(await frames(org.session.ownerId)).toEqual([]);
    for (const f of kept) expect(await h.objects.get(f.object_id).then(() => 'kept', () => 'gone')).toBe('gone');
    // Stored bytes go down by the audio and the frames, together.
    expect(await stored()).toBe(before - audioBytes - kept.reduce((n, f) => n + Number(f.cipher_bytes), 0));
    expect((await org.fetch(org.api.notes.screenUrl(noteId, ids[0] ?? ''))).status).toBe(404);
  });

  it('deletes every frame of an account’s calls when the account is deleted, written up or still going, and closes the room of the one going', async () => {
    const org = await account(unique('organizer'));
    // A call whose notes are written, with what was on its shared screen...
    const ended = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    const endedShare = await screenOf(await joinRoom(ended));
    await ended.appendAudio(audio(0, 0));
    await ended.setScreens(true);
    await ended.shareFrame(frameOf(endedShare, CHART));
    await ended.transcribe(speech('We agreed this chart is right.', 0, 1000), ended.ticket.identity);
    await written(org.api, (await ended.leave())?.pendingNoteId ?? '');
    // ...and a call still going, with a frame of its own, in its LiveKit room.
    const live = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    const liveShare = await screenOf(await joinRoom(live));
    await live.setScreens(true);
    await live.shareFrame(frameOf(liveShare, CODE));
    const kept = await frames(org.session.ownerId);
    expect(kept).toHaveLength(2);
    expect((await h.deps.livekit.existingRooms([live.ticket.roomName])).size).toBe(1);

    await org.api.account.delete();
    // Not a row of a frame is left, nor an image, and the call that was going is over: its room is closed, which takes everyone out.
    expect(await frames(org.session.ownerId)).toEqual([]);
    for (const f of kept) expect(await h.objects.get(f.object_id).then(() => 'kept', () => 'gone')).toBe('gone');
    expect((await h.deps.livekit.existingRooms([live.ticket.roomName])).size).toBe(0);
    expect(h.logs.some((l) => l.includes('"msg":"account deleted"') && l.includes(org.session.ownerId) && l.includes('"frames":2') && l.includes('"rooms":1'))).toBe(true);
  });

  it('keeps frames, and what was read on them, sealed: nothing readable in rows, objects, logs or on the wire', async () => {
    const org = await account(unique('organizer'));
    const host = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    const share = await screenOf(await joinRoom(host));
    await host.appendAudio(audio(0, 0));
    await host.setScreens(true);
    const secret: ScreenShown = { title: 'CANARY-SCREEN-TITLE board deck', lines: ['CANARY-SCREEN-TEXT acquisition price 41M'], regions: [{ label: 'CANARY-SCREEN-PART', box: [0.1, 0.1, 0.5, 0.5] }] };
    const jpeg = screenJpeg(secret, 1280, 720, 'canary');
    await host.shareFrame(frameOf(share, secret, { jpeg }));
    await host.transcribe(speech('We agreed this slide is final.', 0, 1000), host.ticket.identity);
    const noteId = (await host.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);
    const note = await org.api.notes.get(noteId);
    // The notes model read it, and the notes describe it: the canaries are in the note, for whoever has it.
    expect(note.screens[0]).toMatchObject({ title: 'CANARY-SCREEN-TITLE board deck', regions: [{ label: 'CANARY-SCREEN-PART' }] });
    expect(note.screens[0]?.description).toContain('CANARY-SCREEN-TITLE');

    const encodings = (s: string) => [s, Buffer.from(s).toString('hex'), Buffer.from(s).toString('base64').slice(0, 12), Buffer.from(s).toString('base64url').slice(0, 12)];
    const canaries = ['CANARY-SCREEN-TITLE', 'CANARY-SCREEN-TEXT', 'CANARY-SCREEN-PART', 'acquisition price', Buffer.from(jpeg.slice(0, 24)).toString('base64')];
    const dump = await h.pool.query(`SELECT string_agg(t, ' ') AS all FROM (
      SELECT row_to_json(x)::text AS t FROM screen_frames x UNION ALL SELECT row_to_json(x)::text FROM revisions x UNION ALL
      SELECT row_to_json(x)::text FROM calls x UNION ALL SELECT row_to_json(x)::text FROM items x UNION ALL
      SELECT row_to_json(x)::text FROM recording_pieces x UNION ALL SELECT row_to_json(x)::text FROM content_jobs x UNION ALL
      SELECT row_to_json(x)::text FROM operations x UNION ALL SELECT row_to_json(x)::text FROM object_gc x) q`);
    const rowsText = String(dump.rows[0]?.all ?? '');
    expect(rowsText).not.toBe('');
    for (const canary of canaries) for (const enc of encodings(canary)) expect(rowsText.includes(enc), `${canary} as ${enc} in rows`).toBe(false);
    for await (const obj of h.objects.list()) {
      const bytes = Buffer.from(await h.objects.get(obj.id));
      for (const canary of canaries) for (const enc of encodings(canary)) expect(bytes.includes(Buffer.from(enc)), `${canary} in ${obj.id}`).toBe(false);
      expect(bytes.includes(Buffer.from(jpeg.slice(0, 40))), `the raw frame in ${obj.id}`).toBe(false);
    }
    // NEAR AI's model saw it; nothing on the wire to NEAR AI could read it.
    expect(h.near.images.some((i) => i.marker?.includes('CANARY-SCREEN-TEXT'))).toBe(true);
    const wire = Buffer.concat(h.near.received.map((r) => r.body));
    for (const canary of canaries) for (const enc of encodings(canary)) expect(wire.includes(Buffer.from(enc)), `${canary} as ${enc} on the wire to NEAR AI`).toBe(false);
    expect(h.near.calls.filter((x) => x.encryption === 'none')).toEqual([]);
    // Nor in the logs, at debug level for the whole run.
    const logs = h.logs.join('');
    for (const canary of canaries) for (const enc of encodings(canary)) expect(logs.includes(enc), `${canary} as ${enc} in logs`).toBe(false);
    expect(logs).toContain('shared screens read');
  });
});
