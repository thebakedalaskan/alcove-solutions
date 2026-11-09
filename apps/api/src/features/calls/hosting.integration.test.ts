/**
 * Host hand-off (docs: Calls and recordings › Host hand-off), end to end: the real API over HTTP via @alcove/api-http
 * (whose call sessions are real MLS clients), real Postgres, the object store, a real LiveKit server and main's fake
 * NEAR AI. When the organizer's connection drops, someone invited hosts in their place: their browser makes and
 * commits every part of the call's MLS group in a new generation, takes the notes in a new segment, and lets people
 * in; the organizer takes the call back by joining again, or leaves it to someone they choose.
 */
import { AlcoveApiError, MoveClaimSchema, firstName, type AlcoveApi, type AudioPiece, type CallMoveIn, type CallSession, type CallState, type MoveDevice, type TranscriptClip } from '@alcove/api';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { HANDOFF_MS, HOST_GRACE_MS, reconcile } from './lifecycle';
import { speechWav } from '../../testing/fake-near';
import { ORIGIN, startHarness, type Harness } from '../../testing/harness';
import { connect, disposeLiveKit, participantsDirectly, signWebhook, type TestParticipant } from '../../testing/livekit';

// Real WebRTC through LiveKit, which a busy CI runner can be slow to set up: every step waits at most 15 s and says
// what it was waiting for.
vi.setConfig({ testTimeout: 120_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });

const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
let seq = 0;
const unique = (who: string) => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
async function account(email: string) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session };
}
const guestBrowser = () => h.browser().api;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, what: string, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}
/** Refreshes until the call's state matches: other people's changes arrive by fetching the call again. */
async function settle(call: CallSession, pred: (s: CallState) => boolean, what: string): Promise<CallState> {
  for (let i = 0; i < 150 && !pred(call.getSnapshot()); i++) { await call.refresh().catch(() => undefined); await sleep(30); }
  if (!pred(call.getSnapshot())) throw new Error(`timed out waiting for ${what}`);
  return call.getSnapshot();
}
const inGroup = (call: CallSession) => waitFor(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
async function letIn(host: CallSession, who: CallSession) {
  await settle(host, (s) => s.waiting.some((w) => w.id === who.ticket.identity), 'the ask');
  await host.admit(who.ticket.identity);
  await inGroup(who);
}
const latestKeys = (call: CallSession) => call.crypto.getSnapshot().media?.epochs.at(-1)?.keys ?? {};
const keyOf = (call: CallSession) => JSON.stringify(Object.entries(latestKeys(call)).sort(([a], [b]) => a.localeCompare(b)).map(([id, k]) => [id, Buffer.from(k).toString('hex')]));
const members = (call: CallSession) => [...call.crypto.getSnapshot().members].sort();
/** In the group of a part of the call (the main room, or a room), holding its keys. */
const inPlace = (call: CallSession, place: string) => waitFor(() => {
  const s = call.crypto.getSnapshot();
  return s.status === 'in' && s.place === place && Boolean(s.media?.send);
}, `${call.ticket.role} in ${place === 'main' ? 'the main room' : 'a room'}`);
/** Who's on the meeting's invite, as its organizer reads it. */
const invite = async (api: AlcoveApi, meetingId: string) => (await api.meetings.get(meetingId)).guests.map((g) => g.email).sort();
const sendIndex = (call: CallSession) => call.crypto.getSnapshot().media?.send?.index;
const onLatestKey = (call: CallSession) => waitFor(() => sendIndex(call) !== undefined && sendIndex(call) === call.crypto.getSnapshot().media?.epochs.at(-1)?.index, `${call.ticket.role} sending with its new key`);
const notices = (call: CallSession) => call.getSnapshot().notices.map((n) => n.text);
const audio = (marker: string, segment: number, s: number): AudioPiece => {
  const src = Buffer.concat([Buffer.from(marker), randomBytes(2048)]);
  const bytes = new Uint8Array(new ArrayBuffer(src.length));
  bytes.set(src);
  return { data: new Blob([bytes]), segment, seq: s, at: s * 5, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' };
};
const speech = (words: string, segment: number, atMs: number): TranscriptClip => ({ data: new Blob([speechWav(words, 4000)], { type: 'audio/wav' }), segment, at: atMs / 1000, durationMs: 4000 });
/** A request about a call with someone's pass and no session, carrying whatever the test wants. */
const asMember = (call: CallSession, path: string, body: unknown) => fetch(`${h.baseUrl}/v1/live/calls/${call.ticket.callId}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-alcove-call': call.ticket.pass }, body: JSON.stringify(body)
});
/** A webhook signed the way LiveKit signs them, posted to the API. */
async function hook(event: string, roomName: string, identity: string) {
  const body = JSON.stringify({ event, room: { name: roomName }, participant: { identity } });
  return fetch(`${h.baseUrl}/hooks/livekit`, { method: 'POST', headers: { 'content-type': 'application/webhook+json', authorization: await signWebhook(h.deps.cfg, body) }, body });
}
const CallRow = z.object({ state: z.string(), host: z.string(), generation: z.coerce.number() });
/** The call's row: whether it's live, which connection hosts, and its MLS generation. */
const callRow = async (callId: string) => CallRow.parse((await h.pool.query('SELECT state, host_identity AS host, mls_generation AS generation FROM calls WHERE call_id = $1', [callId])).rows[0]);
async function written(api: AlcoveApi, noteId: string) { const steps = []; for await (const p of api.notes.progress(noteId)) steps.push(p); return steps; }

/** Waits until the API's own database says the connection that hosts has been gone for at least `seconds`. */
async function goneFor(callId: string, seconds: number): Promise<void> {
  const until = Date.now() + 15_000;
  for (;;) {
    const r = await h.pool.query<{ gone: boolean }>('SELECT now() - host_left_at >= make_interval(secs => $2) AS gone FROM calls WHERE call_id = $1', [callId, seconds]);
    if (r.rows[0]?.gone === true) return;
    if (Date.now() > until) throw new Error('timed out waiting for the host’s connection to be gone');
    await sleep(25);
  }
}

/** Rooms a test connected; disconnected after each test so rooms empty out. */
const open: TestParticipant[] = [];
/** Call sessions that came from moves, which the harness doesn't know about: stopped after each test. */
const moved: CallSession[] = [];
const incoming: CallMoveIn[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((p) => p.disconnect().catch(() => undefined)));
  for (const s of moved.splice(0)) s.close();
  for (const m of incoming.splice(0)) m.close();
  h.closeCalls();
});
const PHONE: MoveDevice = { kind: 'phone', os: 'ios', browser: 'safari' };
async function arrived(m: CallMoveIn): Promise<CallSession> {
  await waitFor(() => m.getSnapshot().session !== null || m.getSnapshot().stage === 'expired', 'the new device in the call');
  const s = m.getSnapshot().session;
  if (!s) throw new Error(`the move ended at ${m.getSnapshot().stage}`);
  moved.push(s);
  return s;
}
/** Into the call's LiveKit room as its browser would be, sending with its own key, or hearing one sender. */
async function joinRoom(call: CallSession, hearing?: CallSession): Promise<TestParticipant> {
  await inGroup(call);
  const p = await connect(await call.room(), hearing ? { hearing: call.crypto, from: hearing.ticket.identity, senderSends: hearing.crypto } : { sending: call.crypto });
  open.push(p);
  return p;
}
/**
 * The host's connection drops: it's gone from LiveKit's room (as LiveKit drops a browser that vanished), and LiveKit
 * says so. Its browser can still be open (pass `closeIt` to stop it, as if the computer slept).
 */
async function drop(call: CallSession, room: TestParticipant, closeIt = false) {
  await room.disconnect();
  if (closeIt) call.close();
  for (let i = 0; i < 200; i++) {
    if (!(await participantsDirectly(h.deps.cfg, call.ticket.roomName)).some((p) => p.identity === call.ticket.identity)) break;
    await sleep(50);
  }
  expect((await hook('participant_left', call.ticket.roomName, call.ticket.identity)).status).toBe(200);
}
/** Upkeep runs once the host has been gone this long (ms). */
const upkeepAfter = (ms: number) => reconcile(h.deps, Date.now() + ms + 1_000);
/** How long a new device has to come in once the device being left has let go (modules/moves.ts). */
const MOVE_RELEASED_MS = 120_000;

/** A call with notes on, its organizer, and invited people (each with an account), everyone in its group and its LiveKit room. */
async function hostedCall(names: string[], o: { notes?: 'on' | 'off'; guest?: string } = {}) {
  const orgEmail = unique('organizer');
  const org = await account(orgEmail);
  const emails = names.map((n) => unique(n.toLowerCase()));
  const { code: c } = await org.api.calls.startNow({ guests: emails, notes: o.notes ?? 'on' });
  const host = await org.api.calls.join(c, { mic: true, cam: false });
  const hostRoom = await joinRoom(host);
  const people: { email: string; name: string; call: CallSession; browser: Awaited<ReturnType<typeof account>>; room: TestParticipant }[] = [];
  for (const email of emails) {
    const browser = await account(email);
    const call = await browser.api.calls.join(c, { mic: true, cam: false });
    people.push({ email, name: firstName(browser.session.user.name), call, browser, room: await joinRoom(call) });
  }
  let guest: { call: CallSession; room: TestParticipant } | null = null;
  if (o.guest) {
    const call = await guestBrowser().calls.join(c, { mic: true, cam: false, name: o.guest });
    await letIn(host, call);
    guest = { call, room: await joinRoom(call) };
  }
  await waitFor(() => people.every((p) => keyOf(p.call) === keyOf(host)) && (!guest || keyOf(guest.call) === keyOf(host)), 'everyone on one set of keys');
  return { org, orgEmail, orgName: firstName(org.session.user.name), host, hostRoom, code: c, people, guest };
}

describe('host hand-off', () => {
  it('keeps the call going when the organizer’s connection drops: someone invited hosts, makes every group, takes the notes, and the old connection’s commits are refused', async () => {
    const { org, orgName, host, hostRoom, code: c, people: [priya], guest } = await hostedCall(['Priya'], { guest: 'Sam' });
    if (!priya || !guest) throw new Error('Priya and Sam expected');
    const sam = guest.call;
    const before = { generation: host.getSnapshot().generation, keys: keyOf(host) };
    await host.appendAudio(audio('organizer', 0, 0));
    await host.transcribe(speech('We start together.', 0, 0), host.ticket.identity);

    // The organizer's connection drops; their tab stays open. Nothing changes at first: a reload comes back by then.
    const secs = () => (Date.now() - Date.parse(host.getSnapshot().startedAt)) / 1000;
    await drop(host, hostRoom);
    const droppedAt = secs();
    await goneFor(host.ticket.callId, 2.1);
    await reconcile(h.deps, Date.now() + HANDOFF_MS / 2);
    expect((await callRow(host.ticket.callId)).host).toBe(host.ticket.identity);
    // Then Priya hosts, in a new generation her browser makes: she's the only committer, at leaf 0 of every group.
    await upkeepAfter(HANDOFF_MS);
    const s = await settle(priya.call, (x) => x.isHost, 'Priya hosting');
    const handedAt = secs();
    expect(s.host).toMatchObject({ id: priya.call.ticket.identity, standIn: true, organizer: { name: org.session.user.name } });
    expect(s.generation).toBe(before.generation + 1);
    expect(await callRow(host.ticket.callId)).toEqual({ state: 'live', host: priya.call.ticket.identity, generation: before.generation + 1 });
    expect(s.isOrganizer).toBe(false);
    // Everyone else rejoins her groups by themselves, on keys none of them held before; the organizer's old connection isn't in them.
    await waitFor(() => keyOf(sam) === keyOf(priya.call) && members(priya.call).join() === [priya.call.ticket.identity, sam.ticket.identity].sort().join(), 'Sam in Priya’s group');
    expect(keyOf(sam)).not.toBe(before.keys);
    expect(members(sam)).not.toContain(host.ticket.identity);
    // Everyone is told who hosts now, Priya in her own words.
    expect(notices(priya.call)).toContain(`${orgName}’s connection dropped, so you’re hosting until ${orgName} is back.`);
    await settle(sam, (x) => x.host.id === priya.call.ticket.identity, 'Sam told');
    expect(notices(sam)).toContain(`${orgName}’s connection dropped, so ${priya.name} is hosting until ${orgName} is back.`);
    // The organizer's open tab learns someone else hosts now: joining again takes the call back.
    await waitFor(() => host.crypto.getSnapshot().status === 'away', 'the organizer’s tab told it’s away');

    // Commits from the old connection are refused as out of date, for its generation and the new one alike (under the
    // call's row lock, with the generation); a member who never hosted can't commit at all.
    const commit = (call: CallSession, generation: number) => asMember(call, '/mls/commits', { generation, group: 'main', epoch: 0, commit: 'AAAA', added: [], removed: [] });
    expect((await commit(host, before.generation)).status).toBe(409);
    expect((await commit(host, s.generation)).status).toBe(409);
    expect((await commit(sam, s.generation)).status).toBe(403);
    // Priya's pass without her session hosts nothing either.
    expect((await asMember(priya.call, '/actions', { type: 'lock', on: true })).status).toBe(403);

    // The notes go on from Priya's browser in a new segment; the organizer's late audio and speech are refused, and a
    // clip sent twice is kept once.
    expect(s.notes.recording.segment).toBe(1);
    // A new recorder starts at the handoff, independently of the older notes-on capture event.
    expect(s.notes).toMatchObject({ segmentStartedAt: expect.any(String) });
    expect(Date.parse(s.notes.segmentStartedAt ?? '')).toBeGreaterThan(Date.parse(s.capture.recording.since ?? ''));
    expect(code(await host.appendAudio(audio('late', 0, 1)).catch((e: unknown) => e))).toBe('conflict');
    expect(code(await host.transcribe(speech('Too late to count.', 0, 6000), host.ticket.identity).catch((e: unknown) => e))).toBe('conflict');
    await priya.call.appendAudio(audio('stand-in', 1, 0));
    await priya.call.transcribe(speech('Priya carries on.', 1, 0), sam.ticket.identity);
    await priya.call.transcribe(speech('Priya carries on.', 1, 0), sam.ticket.identity);

    // Media keeps flowing on her keys: Sam hears Priya.
    const priyaRoom = priya.room;
    const samHearing = await joinRoom(sam, priya.call);
    await priyaRoom.publishTone();
    await onLatestKey(priya.call);
    expect(await samHearing.meanLevelFrom(priya.call.ticket.identity)).toBeGreaterThan(3000);

    // Someone new asking is let in by Priya's browser: their browser checks its group's committer is the one the API names.
    const lee = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Lee' });
    await letIn(priya.call, lee);
    await waitFor(() => keyOf(lee) === keyOf(priya.call), 'Lee on Priya’s keys');
    // Someone signed in and not invited asks too. Priya can let them in, but only the organizer adds anyone to their
    // invite: they're in the call as a guest, without the notes, and the join page says so before they ask.
    const ana = await account(unique('ana'));
    expect((await ana.api.calls.card(c)).you).toBe('guest');
    const anaCall = await ana.api.calls.join(c, { mic: true, cam: false });
    await letIn(priya.call, anaCall);
    expect((await settle(anaCall, (x) => x.participants.some((p) => p.isMe), 'Ana in')).role).toBe('guest');
    // Catching up says nothing was transcribed only from the drop until Priya hosted, and never in her time hosting
    // since: her browser sends what's said.
    const missed = (await priya.call.catchUp({ kind: 'all' })).read.missed;
    expect(missed).toHaveLength(1);
    expect(missed[0]?.from ?? 0).toBeGreaterThan(droppedAt - 1);
    expect(missed[0]?.to ?? Infinity).toBeLessThan(handedAt + 1);
    expect((missed[0]?.to ?? 0) - (missed[0]?.from ?? 0)).toBeGreaterThanOrEqual(2);

    // Priya ends the call: the notes cover all of it, each line once, and go to everyone invited, the organizer included.
    const end = await priya.call.leave();
    const noteId = end?.pendingNoteId ?? '';
    expect(noteId).not.toBe('');
    expect((await written(org.api, noteId)).at(-1)?.ready).toBe(true);
    const note = await org.api.notes.get(noteId);
    expect(note.transcript?.map((l) => l.text)).toEqual(['We start together.', 'Priya carries on.']);
    expect(note.transcript?.map((l) => l.speaker?.name)).toEqual([org.session.user.name, 'Sam']);
    // The stretch no host's browser was in the call is marked where it falls: between the two segments.
    expect(note.gaps.map((g) => g.kind)).toEqual(['offline']);
    expect((await priya.browser.api.notes.get(noteId)).id).toBe(noteId);
    expect(code(await ana.api.notes.get(noteId).catch((e: unknown) => e))).toBe('not-found');
  });

  it('gives the call back when the organizer joins again: they host in a new generation, and the stand-in’s late commits and audio are refused', async () => {
    const { org, orgName, host, hostRoom, code: c, people: [priya], guest } = await hostedCall(['Priya'], { guest: 'Sam' });
    if (!priya || !guest) throw new Error('Priya and Sam expected');
    await drop(host, hostRoom, true);
    await upkeepAfter(HANDOFF_MS);
    const standing = await settle(priya.call, (x) => x.isHost, 'Priya hosting');
    const waiting = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Avery' });
    expect((await settle(priya.call, (x) => x.waiting.length === 1, 'the stand-in seeing the request')).waiting.map((p) => p.id)).toEqual([waiting.ticket.identity]);
    await priya.call.refresh();
    expect(priya.call.getSnapshot().waiting.map((p) => p.id)).toEqual([waiting.ticket.identity]);
    expect((await settle(guest.call, (x) => x.participants.length === 2, 'Sam seeing the current people')).waiting).toEqual([]);

    // The organizer comes back: joining takes the role back at once.
    const back = await org.api.calls.join(c, { mic: true, cam: false });
    expect(back.getSnapshot()).toMatchObject({ isHost: true, isOrganizer: true, host: { id: back.ticket.identity, standIn: false } });
    expect(back.getSnapshot().generation).toBe(standing.generation + 1);
    expect(back.getSnapshot().notices.map((n) => n.text)).toContain(`You’re hosting again. ${priya.name} hosted while you were away.`);
    await inGroup(back);
    // Priya stops hosting and rejoins the organizer's group like everyone else; so does Sam.
    const after = await settle(priya.call, (x) => !x.isHost && x.host.id === back.ticket.identity, 'Priya back to a member');
    expect(after.waiting).toEqual([]);
    expect((await settle(back, (x) => x.waiting.length === 1, 'the organizer seeing the unresolved request')).waiting.map((p) => p.id)).toEqual([waiting.ticket.identity]);
    await expect(priya.call.deny(waiting.ticket.identity)).rejects.toMatchObject({ code: 'conflict' });
    await back.deny(waiting.ticket.identity);
    expect((await settle(back, (x) => x.waiting.length === 0, 'the request handled')).waiting).toEqual([]);
    await priya.call.refresh();
    expect(priya.call.getSnapshot().waiting).toEqual([]);
    expect(after.notices.map((n) => n.text)).toContain(`${orgName} is back and hosting again.`);
    await waitFor(() => keyOf(priya.call) === keyOf(back) && keyOf(guest.call) === keyOf(back), 'everyone in the organizer’s group');
    expect(members(back)).toEqual([back.ticket.identity, priya.call.ticket.identity, guest.call.ticket.identity].sort());
    // Her browser's late commits and audio are out of date now; the notes carry on from the organizer's, in the next segment.
    expect((await asMember(priya.call, '/mls/commits', { generation: standing.generation, group: 'main', epoch: 0, commit: 'AAAA', added: [], removed: [] })).status).toBe(409);
    expect(code(await priya.call.appendAudio(audio('late stand-in', standing.notes.recording.segment, 0)).catch((e: unknown) => e))).toBe('conflict');
    expect(back.getSnapshot().notes.recording.segment).toBe(standing.notes.recording.segment + 1);
    await back.leave();
  });

  it('lets whoever hosts leave and hand the call to someone they choose, never a guest', async () => {
    const { orgName, host, people: [priya, kofi], guest } = await hostedCall(['Priya', 'Kofi'], { guest: 'Sam' });
    if (!priya || !kofi || !guest) throw new Error('Priya, Kofi and Sam expected');
    // Who could take over, best first: invited people in the call, never a guest.
    expect((await settle(host, (x) => x.host.next.length === 2, 'who could host')).host.next).toEqual([priya.call.ticket.identity, kofi.call.ticket.identity]);
    expect(code(await host.handOff(guest.call.ticket.identity).catch((e: unknown) => e))).toBe('conflict');
    // Not anyone else's to do.
    expect(code(await priya.call.handOff(kofi.call.ticket.identity).catch((e: unknown) => e))).toBe('forbidden');

    // The organizer leaves and asks Kofi to host, though Priya came first.
    await host.handOff(kofi.call.ticket.identity);
    const s = await settle(kofi.call, (x) => x.isHost, 'Kofi hosting');
    expect(s.host).toMatchObject({ id: kofi.call.ticket.identity, standIn: true });
    expect(s.notices.map((n) => n.text)).toContain(`${orgName} left the call and asked you to host until ${orgName} is back.`);
    expect((await settle(priya.call, (x) => x.host.id === kofi.call.ticket.identity, 'Priya told')).notices.map((n) => n.text))
      .toContain(`${orgName} left the call. ${kofi.name} is hosting until ${orgName} is back.`);
    await waitFor(() => keyOf(priya.call) === keyOf(kofi.call) && keyOf(guest.call) === keyOf(kofi.call), 'everyone in Kofi’s group');
    expect(members(kofi.call)).not.toContain(host.ticket.identity);

    // Kofi keeps the call running: he locks it and removes Sam, but can't change what the notes capture, open rooms,
    // remove himself, or remove the organizer.
    await kofi.call.lock(true);
    expect(code(await kofi.call.remove(host.ticket.identity).catch((e: unknown) => e))).toBe('invalid');
    expect(code(await kofi.call.setNotes(false).catch((e: unknown) => e))).toBe('forbidden');
    expect(code(await kofi.call.pause().catch((e: unknown) => e))).toBe('forbidden');
    expect((await asMember(kofi.call, '/actions', { type: 'rooms-open', rooms: [{ name: 'A', emails: [] }, { name: 'B', emails: [] }], minutes: 5, board: { mode: 'none', template: 'blank' } })).status).toBe(403);
    expect(code(await kofi.call.remove(kofi.call.ticket.identity).catch((e: unknown) => e))).toBe('invalid');
    await kofi.call.remove(guest.call.ticket.identity);
    await waitFor(() => !members(kofi.call).includes(guest.call.ticket.identity), 'Sam out of the group');

    // Kofi leaves too, choosing Priya; leaving without saying so hands it to whoever's next, and with nobody left to
    // take it, a host can only end the call.
    await kofi.call.handOff(priya.call.ticket.identity);
    const p = await settle(priya.call, (x) => x.isHost, 'Priya hosting');
    expect(p.host.next).toEqual([]);
    expect(code(await priya.call.handOff(kofi.call.ticket.identity).catch((e: unknown) => e))).toBe('conflict');
    const end = await priya.call.leave();
    expect(end?.pendingNoteId).toBeTruthy();
    expect((await callRow(host.ticket.callId)).state).toBe('ended');
  });

  it('keeps the invite the organizer’s while someone stands in, and hands the call only to someone who can host', async () => {
    const { org, host, hostRoom, code: c, people: [priya, kofi] } = await hostedCall(['Priya', 'Kofi']);
    if (!priya || !kofi) throw new Error('Priya and Kofi expected');
    // Dee, signed in and not invited, asks from the link, and the organizer lets her in: that puts her on the invite.
    const deeEmail = unique('dee');
    const dee = await account(deeEmail);
    const deeCall = await dee.api.calls.join(c, { mic: true, cam: false });
    await letIn(host, deeCall);
    const meetingId = host.getSnapshot().meetingId;
    expect(await invite(org.api, meetingId)).toContain(deeEmail);
    await drop(host, hostRoom, true);
    await upkeepAfter(HANDOFF_MS);
    await settle(priya.call, (x) => x.isHost, 'Priya hosting');

    // Ana, signed in and not invited, asks while Priya hosts: Priya lets her in, as a guest, and a guest can't host.
    const ana = await account(unique('ana'));
    const anaCall = await ana.api.calls.join(c, { mic: true, cam: false });
    await letIn(priya.call, anaCall);
    expect(code(await priya.call.handOff(anaCall.ticket.identity).catch((e: unknown) => e))).toBe('conflict');
    // Priya's pass with someone else's session hosts nothing: Kofi's account can't act as her.
    const asKofi = await kofi.browser.fetch(`${h.baseUrl}/v1/live/calls/${priya.call.ticket.callId}/actions`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-alcove-call': priya.call.ticket.pass }, body: JSON.stringify({ type: 'lock', on: true })
    });
    expect(asKofi.status).toBe(403);
    expect(priya.call.getSnapshot().locked).toBe(false);

    // Priya removes Dee: Dee is out of the call, and can't be handed it, but the invite is the organizer's, so she stays on it.
    await priya.call.remove(deeCall.ticket.identity);
    expect(code(await priya.call.handOff(deeCall.ticket.identity).catch((e: unknown) => e))).toBe('conflict');
    expect(await invite(org.api, meetingId)).toContain(deeEmail);

    // The notes go to everyone invited, Dee included; Ana, a guest, doesn't get them.
    await priya.call.transcribe(speech('Dee still gets these.', 1, 0), kofi.call.ticket.identity);
    const end = await priya.call.leave();
    const noteId = end?.pendingNoteId ?? '';
    expect((await written(org.api, noteId)).at(-1)?.ready).toBe(true);
    expect((await dee.api.notes.get(noteId)).id).toBe(noteId);
    expect(code(await ana.api.notes.get(noteId).catch((e: unknown) => e))).toBe('not-found');
  });

  it('hands the call on while breakout rooms are open: the stand-in makes every room’s group, and nobody moves', async () => {
    const { host, hostRoom, people: [priya, kofi, lena] } = await hostedCall(['Priya', 'Kofi', 'Lena']);
    if (!priya || !kofi || !lena) throw new Error('Priya, Kofi and Lena expected');
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofi.email] }, { name: 'Support', emails: [lena.email] }], minutes: 10, board: { mode: 'none', template: 'blank' } });
    const [design = '', support = ''] = (await settle(host, (x) => x.breakouts.open !== null, 'rooms open')).breakouts.open?.rooms.map((r) => r.id) ?? [];
    await inPlace(kofi.call, design);
    await inPlace(lena.call, support);
    await waitFor(() => members(kofi.call).includes(host.ticket.identity) && members(lena.call).includes(host.ticket.identity), 'each room’s group with the organizer');

    // The organizer drops with the rooms open. Priya, in the main room, hosts: her browser makes the main room's group
    // and each room's, each room keeps its people, and nobody's sent anywhere.
    await drop(host, hostRoom, true);
    await upkeepAfter(HANDOFF_MS);
    const s = await settle(priya.call, (x) => x.isHost, 'Priya hosting');
    expect(s.breakouts.open?.rooms.map((r) => r.id)).toEqual([design, support]);
    await waitFor(() => members(kofi.call).join() === [priya.call.ticket.identity, kofi.call.ticket.identity].sort().join()
      && members(lena.call).join() === [priya.call.ticket.identity, lena.call.ticket.identity].sort().join(), 'each room’s group made by Priya');
    await inPlace(kofi.call, design);
    await inPlace(lena.call, support);
    await inPlace(priya.call, 'main');
    expect(members(priya.call)).toEqual([priya.call.ticket.identity]);
    // No key in common between the rooms.
    expect(keyOf(kofi.call)).not.toBe(keyOf(lena.call));

    // She brings everyone back: both rooms close, and everyone is in her main room's group.
    priya.call.closeRooms();
    await inPlace(kofi.call, 'main');
    await inPlace(lena.call, 'main');
    await waitFor(() => members(priya.call).join() === [priya.call.ticket.identity, kofi.call.ticket.identity, lena.call.ticket.identity].sort().join(), 'everyone in the main room’s group');
    expect((await settle(priya.call, (x) => x.breakouts.open === null, 'rooms closed')).breakouts.open).toBeNull();
    await priya.call.leave();
  });

  it('hosts from inside a breakout room when everyone invited is in one: the room keeps a scribe of its own, never the host, and nothing hears the main room until rooms close', async () => {
    const { org, host, hostRoom, people: [kofi, mia, lena], guest } = await hostedCall(['Kofi', 'Mia', 'Lena'], { guest: 'Sam' });
    if (!kofi || !mia || !lena || !guest) throw new Error('Kofi, Mia, Lena and Sam expected');
    const sam = guest.call;
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofi.email, mia.email] }, { name: 'Support', emails: [lena.email] }], minutes: 10, board: { mode: 'none', template: 'blank' } });
    const [design = '', support = ''] = (await settle(host, (x) => x.breakouts.open !== null, 'rooms open')).breakouts.open?.rooms.map((r) => r.id) ?? [];
    await inPlace(kofi.call, design);
    await inPlace(mia.call, design);
    await inPlace(lena.call, support);

    // The organizer drops. Everyone invited is in a room and Sam, a guest, can't host, so Kofi, who came first, hosts
    // from Design, and his browser stays there.
    await drop(host, hostRoom);
    await upkeepAfter(HANDOFF_MS);
    // Kofi hosting starts a new segment and new groups, in the state that says he hosts. Until Mia is back in Design's group the
    // room has no scribe, so what her browser last read says nothing unless it's from this generation.
    const hosting = await settle(kofi.call, (x) => x.isHost, 'Kofi hosting');
    const { segment } = hosting.notes.recording;
    await inPlace(kofi.call, design);
    await inPlace(mia.call, design);
    await inPlace(lena.call, support);
    const taken = (p: Promise<unknown>) => p.then(() => 'taken', (e: unknown) => code(e));
    await settle(mia.call, (x) => x.generation === hosting.generation && x.capture.room?.scribe === mia.call.ticket.identity, 'Mia hearing Design');

    // Design goes on with Mia's browser: whoever hosts is never a room's scribe, and Kofi's voice is heard there like anyone's.
    expect(mia.call.getSnapshot().capture.room).toMatchObject({ id: design, mode: 'on', transcript: { mode: 'on' } });
    expect(await taken(kofi.call.transcribe(speech('From the host’s browser.', segment, 100), mia.call.ticket.identity))).toBe('forbidden');
    expect(await taken(mia.call.transcribe(speech('Kofi hosts, and we carry on.', segment, 200), kofi.call.ticket.identity))).toBe('taken');
    // The main room is only ever heard by whoever hosts, and the connection that hosted before is told it's out of date.
    expect(await taken(mia.call.transcribe(speech('Sam, overheard.', segment, 300), sam.ticket.identity))).toBe('forbidden');
    expect(await taken(host.transcribe(speech('Still here.', segment, 400), sam.ticket.identity))).toBe('conflict');
    expect(await taken(host.transcribe(speech('Still in Design.', segment, 500), mia.call.ticket.identity))).toBe('conflict');

    // His browser can't hear the main room from Design, and says so: Sam is told, and the rooms carry on regardless.
    await kofi.call.setUnavailable(['recording', 'transcript']);
    expect((await settle(sam, (x) => x.capture.mode === 'unavailable', 'Sam told')).capture).toMatchObject({ recording: { mode: 'unavailable' }, transcript: { mode: 'unavailable' } });
    expect((await settle(mia.call, (x) => x.capture.mode === 'unavailable', 'Design told')).capture.room).toMatchObject({ mode: 'on', transcript: { mode: 'on' } });

    // He brings everyone back: his browser hears the main room again, as whoever hosts does.
    kofi.call.closeRooms();
    await inPlace(kofi.call, 'main');
    await kofi.call.setUnavailable([]);
    expect((await settle(sam, (x) => x.capture.mode === 'on', 'Sam told it’s back')).capture.transcript.mode).toBe('on');
    expect(await taken(kofi.call.transcribe(speech('Sam, back in the main room.', segment, 9000), sam.ticket.identity))).toBe('taken');
    const noteId = (await kofi.call.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);
    const note = await org.api.notes.get(noteId);
    expect(note.transcript?.map((l) => l.text)).toEqual(['Sam, back in the main room.']);
    expect(note.rooms.map((r) => [r.name, r.transcript.map((l) => l.text)])).toEqual([['Design', ['Kofi hosts, and we carry on.']], ['Support', []]]);
  });

  it('gives a stand-in nothing of a series’ earlier calls for hosting: what carries over goes by the notes they have', async () => {
    const org = await account(unique('organizer'));
    const { code: first } = await org.api.calls.startNow({ title: 'Board', notes: 'on' });
    const earlier = await org.api.calls.join(first, { mic: true, cam: false });
    await inGroup(earlier);
    await earlier.transcribe(speech('We agreed to CANARY-STANDIN sell the barn.', 0, 0), earlier.ticket.identity);
    await settle(earlier, (x) => x.transcript.length > 0, 'the line');
    const noteId = (await earlier.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);
    const meeting = await org.api.meetings.get((await org.api.notes.get(noteId)).meetingId ?? '');
    const priyaEmail = unique('priya');
    const next = await org.api.meetings.scheduleNext(meeting.id, new Date(Date.parse(meeting.startsAt) + 7 * 86_400_000).toISOString());
    await org.api.meetings.update(next.id, { guests: [priyaEmail] });

    const host = await org.api.calls.join(next.code, { mic: true, cam: false });
    const hostRoom = await joinRoom(host);
    const priya = await account(priyaEmail);
    const inPriya = await priya.api.calls.join(next.code, { mic: true, cam: false });
    await joinRoom(inPriya);
    expect((await org.api.calls.series(next.code))?.decisions.map((d) => d.text)).toEqual(['We agreed to CANARY-STANDIN sell the barn.']);
    await drop(host, hostRoom);
    await goneFor(host.ticket.callId, 2.1);
    await upkeepAfter(HANDOFF_MS);
    await settle(inPriya, (x) => x.isHost, 'Priya hosting');

    const sent = h.near.prompts.length;
    expect(await priya.api.calls.series(next.code)).toBeNull();
    expect(code(await inPriya.askEarlier('What did we decide?', 'Europe/London').catch((e: unknown) => e))).toBe('not-found');
    expect(h.near.prompts.length).toBe(sent);
    await inPriya.leave();
  });

  it('counts a stand-in whose connection dropped as gone from then when the organizer comes back', async () => {
    const { org, host, hostRoom, code: c, people: [priya, kofi] } = await hostedCall(['Priya', 'Kofi']);
    if (!priya || !kofi) throw new Error('Priya and Kofi expected');
    const secs = () => (Date.now() - Date.parse(host.getSnapshot().startedAt)) / 1000;
    await drop(host, hostRoom, true);
    await upkeepAfter(HANDOFF_MS);
    await settle(priya.call, (x) => x.isHost, 'Priya hosting');

    // Priya's connection drops too. Nobody hosts for a while (catching up names stretches of two seconds or more), and
    // the organizer is back before upkeep hands the call on.
    await drop(priya.call, priya.room, true);
    const priyaGoneAt = secs();
    await goneFor(host.ticket.callId, 2.1);
    const back = await org.api.calls.join(c, { mic: true, cam: false });
    // Priya is gone at once, from when LiveKit said so: she isn't left in the call for upkeep to find.
    expect(back.getSnapshot().participants.map((p) => p.id)).not.toContain(priya.call.ticket.identity);
    await inGroup(back);
    await waitFor(() => keyOf(kofi.call) === keyOf(back), 'Kofi in the organizer’s group');
    expect(members(back)).toEqual([back.ticket.identity, kofi.call.ticket.identity].sort());
    // Catching up says nothing was transcribed from her drop until the organizer was back.
    const missed = (await back.catchUp({ kind: 'all' })).read.missed;
    expect(missed.some((m) => m.from > priyaGoneAt - 1 && m.from < priyaGoneAt + 1 && (m.to ?? Infinity) <= secs() + 1)).toBe(true);
    await back.leave();
  });

  it('waits for the host’s move to another device: nobody takes over while it can still arrive, and one that runs out is a host gone like any other', async () => {
    const { orgEmail, host, hostRoom, people: [priya] } = await hostedCall(['Priya']);
    if (!priya) throw new Error('Priya expected');
    const start = (await callRow(host.ticket.callId)).generation;
    // The organizer starts a move; the new device (driven by hand, so it comes in only when told) is ready; the laptop lets go.
    const out = await host.startMove({ mic: true, cam: false });
    const opened = await fetch(`${h.baseUrl}/v1/moves/claim`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ code: out.getSnapshot().code ?? '' }) });
    const { claim } = MoveClaimSchema.parse(await opened.json());
    const phone = await account(orgEmail);
    const ready = await phone.fetch(`${h.baseUrl}/v1/moves/ready`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ claim, identity: `p_${randomBytes(16).toString('base64url')}`, keyPackage: 'AAAA', device: PHONE })
    });
    expect(ready.status).toBe(200);
    await waitFor(() => out.getSnapshot().stage === 'ready', 'the laptop told the phone is ready');
    host.close();
    await hostRoom.disconnect();
    await out.confirm({ mic: true, cam: false });

    // Past the hand-off and the grace alike, the call waits: the new device can still come in, and nobody has to take over.
    await upkeepAfter(HANDOFF_MS);
    await upkeepAfter(HOST_GRACE_MS);
    expect(await callRow(host.ticket.callId)).toEqual({ state: 'live', host: host.ticket.identity, generation: start });
    // It never comes. Once the move has run out, the call is handed on as for any host gone.
    await upkeepAfter(MOVE_RELEASED_MS);
    expect(await callRow(host.ticket.callId)).toEqual({ state: 'live', host: priya.call.ticket.identity, generation: start + 1 });
    await settle(priya.call, (x) => x.isHost, 'Priya hosting');
    await priya.call.leave();
  });

  it('moves a stand-in as it moves the organizer: their new device hosts on in a new generation, and the old one is out of date', async () => {
    const { host, hostRoom, people: [priya, kofi] } = await hostedCall(['Priya', 'Kofi']);
    if (!priya || !kofi) throw new Error('Priya and Kofi expected');
    await drop(host, hostRoom, true);
    await upkeepAfter(HANDOFF_MS);
    const standing = await settle(priya.call, (x) => x.isHost, 'Priya hosting');

    // Priya moves to her phone, signed in to the same account.
    const out = await priya.call.startMove({ mic: true, cam: false });
    const phone = await account(priya.email);
    const there = await phone.api.calls.openMove(out.getSnapshot().code ?? '');
    incoming.push(there);
    await there.ready(PHONE);
    await waitFor(() => out.getSnapshot().stage === 'ready', 'her laptop told the phone is ready');
    priya.call.close();
    await priya.room.disconnect();
    await out.confirm({ mic: true, cam: false });
    // Upkeep waits for her new device, however long it's been: Kofi doesn't take over.
    await upkeepAfter(HANDOFF_MS);

    const now = await arrived(there);
    await inGroup(now);
    expect(now.getSnapshot()).toMatchObject({ isHost: true, isOrganizer: false, host: { id: now.ticket.identity, standIn: true }, generation: standing.generation + 1 });
    expect(await callRow(host.ticket.callId)).toMatchObject({ state: 'live', host: now.ticket.identity });
    // Kofi rejoins her new groups by himself; her old connection isn't in them, and it's out of date.
    await waitFor(() => keyOf(kofi.call) === keyOf(now), 'Kofi in her new device’s group');
    expect(members(now)).toEqual([now.ticket.identity, kofi.call.ticket.identity].sort());
    expect((await asMember(priya.call, '/mls/commits', { generation: standing.generation, group: 'main', epoch: 0, commit: 'AAAA', added: [], removed: [] })).status).toBe(409);
    // Her powers and the notes went with her, in the next segment.
    await now.lock(true);
    expect((await settle(now, (x) => x.locked, 'locked')).locked).toBe(true);
    expect(now.getSnapshot().notes.recording.segment).toBe(standing.notes.recording.segment + 1);
    await now.leave();
  });

  it('ends the call as before when nobody can host: guests can’t, and nor can anyone not in the room', async () => {
    const orgEmail = unique('organizer');
    const org = await account(orgEmail);
    const invitedEmail = unique('lena');
    const { code: c } = await org.api.calls.startNow({ guests: [invitedEmail], notes: 'off' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const hostRoom = await joinRoom(host);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    await joinRoom(sam);
    // Lena is let in, but her browser never reaches the room.
    const lena = await (await account(invitedEmail)).api.calls.join(c, { mic: true, cam: false });
    await inGroup(lena);
    await drop(host, hostRoom, true);
    // Nobody can take over yet, so the call waits for the organizer...
    await upkeepAfter(HANDOFF_MS);
    expect(await callRow(host.ticket.callId)).toMatchObject({ state: 'live', host: host.ticket.identity });
    // ...and ends once they've been gone as long as it always waited.
    await upkeepAfter(HOST_GRACE_MS);
    expect((await callRow(host.ticket.callId)).state).toBe('ended');
    expect(code(await sam.refresh().catch((e: unknown) => e))).toBe('conflict');
  });

  it('never resumes or starts capture because the host changed: paused stays paused, off stays off, and only the organizer changes it', async () => {
    const { org, host, hostRoom, code: c, people: [priya] } = await hostedCall(['Priya']);
    if (!priya) throw new Error('Priya expected');
    await host.pause();
    await drop(host, hostRoom, true);
    await upkeepAfter(HANDOFF_MS);
    const paused = await settle(priya.call, (x) => x.isHost, 'Priya hosting');
    expect(paused.capture.mode).toBe('paused');
    expect(paused.notes.recording.segment).toBe(0);
    // Her browser can't capture while paused, and she can't resume or turn notes on; she can ask, like anyone.
    expect(code(await priya.call.appendAudio(audio('paused', 0, 0)).catch((e: unknown) => e))).toBe('conflict');
    expect(code(await priya.call.resume().catch((e: unknown) => e))).toBe('forbidden');
    expect(code(await priya.call.setNotes(true).catch((e: unknown) => e))).toBe('forbidden');
    await priya.call.requestNotes(true);

    // Back, the organizer finds it paused still, and resuming is theirs.
    const back = await org.api.calls.join(c, { mic: true, cam: false });
    expect(back.getSnapshot().capture.mode).toBe('paused');
    await back.resume();
    expect(back.getSnapshot().notes.recording.segment).toBe(1);
    // Notes off stays off through another hand-off too.
    await back.setNotes(false);
    const backRoom = await joinRoom(back);
    await drop(back, backRoom, true);
    await upkeepAfter(HANDOFF_MS);
    const off = await settle(priya.call, (x) => x.isHost && x.generation > paused.generation + 1, 'Priya hosting again');
    expect(off.capture.mode).toBe('off');
    expect(off.notes.recording.segment).toBe(1);
    expect(code(await priya.call.transcribe(speech('Off the record.', 1, 0), priya.call.ticket.identity).catch((e: unknown) => e))).toBe('conflict');
    await priya.call.leave();
  });

  it('keeps one host through every race: the organizer coming back as upkeep hands off, two upkeeps at once, and a stand-in’s reload', async () => {
    const { org, host, hostRoom, code: c, people: [priya, kofi], guest } = await hostedCall(['Priya', 'Kofi'], { guest: 'Sam' });
    if (!priya || !kofi || !guest) throw new Error('Priya, Kofi and Sam expected');
    const start = (await callRow(host.ticket.callId)).generation;

    // Two upkeeps at once (two servers, or the webhook's timer and the regular run): one hand-off, to the same person.
    await drop(host, hostRoom, true);
    await Promise.all([upkeepAfter(HANDOFF_MS), upkeepAfter(HANDOFF_MS), upkeepAfter(HOST_GRACE_MS)]);
    expect(await callRow(host.ticket.callId)).toEqual({ state: 'live', host: priya.call.ticket.identity, generation: start + 1 });
    await settle(priya.call, (x) => x.isHost, 'Priya hosting');

    // Priya's page reloads: she comes back hosting on her new connection (a locked call too), and nobody else takes over.
    await priya.call.lock(true);
    priya.call.closing();
    const reloaded = await priya.browser.api.calls.join(c, { mic: true, cam: false, previous: priya.call.ticket.pass });
    expect(reloaded.getSnapshot()).toMatchObject({ isHost: true, host: { id: reloaded.ticket.identity, standIn: true } });
    await inGroup(reloaded);
    expect(await callRow(host.ticket.callId)).toMatchObject({ host: reloaded.ticket.identity, generation: start + 2 });
    await waitFor(() => keyOf(kofi.call) === keyOf(reloaded) && keyOf(guest.call) === keyOf(reloaded), 'everyone in her new group');
    expect(members(reloaded)).not.toContain(priya.call.ticket.identity);

    // Her new connection drops, and the organizer comes back at the very moment upkeep hands the call on: whichever goes
    // first, the organizer ends up hosting, and everyone ends up in their group.
    const reloadedRoom = await joinRoom(reloaded);
    await drop(reloaded, reloadedRoom, true);
    const [, back] = await Promise.all([upkeepAfter(HANDOFF_MS), org.api.calls.join(c, { mic: true, cam: false })]);
    await settle(back, (x) => x.isHost && x.host.id === back.ticket.identity, 'the organizer hosting');
    expect((await callRow(host.ticket.callId)).host).toBe(back.ticket.identity);
    await inGroup(back);
    await waitFor(() => keyOf(kofi.call) === keyOf(back) && keyOf(guest.call) === keyOf(back), 'everyone in the organizer’s group');
    expect((await settle(kofi.call, (x) => x.host.id === back.ticket.identity, 'Kofi told')).isHost).toBe(false);
    // Only the organizer's connection commits now: anyone else is refused, as out of date if they hosted a moment ago.
    for (const call of [kofi.call, reloaded]) {
      expect([403, 409]).toContain((await asMember(call, '/mls/commits', { generation: back.getSnapshot().generation, group: 'main', epoch: 0, commit: 'AAAA', added: [], removed: [] })).status);
    }
    await back.leave();
  });

  it('keeps the stand-in’s name and who hosts out of rows and logs, and refuses anyone from another call', async () => {
    const orgEmail = unique('organizer');
    const org = await account(orgEmail);
    const standInEmail = unique('canarystandin');
    const { code: c } = await org.api.calls.startNow({ guests: [standInEmail], notes: 'off' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const hostRoom = await joinRoom(host);
    const standIn = await (await account(standInEmail)).api.calls.join(c, { mic: true, cam: false });
    await joinRoom(standIn);
    // Someone in another call can't be handed this one.
    const other = await account(unique('other'));
    const otherHost = await other.api.calls.join((await other.api.calls.startNow({})).code, { mic: true, cam: false });
    expect(code(await host.handOff(otherHost.ticket.identity).catch((e: unknown) => e))).toBe('conflict');
    // Nor can another call's host hand this one off with their pass.
    const crossed = await other.fetch(`${h.baseUrl}/v1/live/calls/${host.ticket.callId}/hand-off`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-alcove-call': otherHost.ticket.pass }, body: JSON.stringify({ to: standIn.ticket.identity })
    });
    expect(crossed.status).toBe(401);
    expect(await callRow(host.ticket.callId)).toMatchObject({ host: host.ticket.identity });
    await drop(host, hostRoom, true);
    await upkeepAfter(HANDOFF_MS);
    await settle(standIn, (x) => x.isHost, 'the stand-in hosting');
    // Their name is in the sealed notices, and nowhere else the API keeps things.
    const dump = String((await h.pool.query(`SELECT string_agg(row_to_json(x)::text, ' ') AS t FROM calls x WHERE call_id = $1`, [host.ticket.callId])).rows[0]?.t ?? '');
    expect(dump.toLowerCase()).not.toContain('canarystandin');
    expect(h.logs.join('').toLowerCase()).not.toContain('canarystandin');
    await standIn.leave();
    await otherHost.leave();
  });
});
