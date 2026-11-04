/**
 * Host hand-off (docs: Calls and recordings › Host hand-off), end to end: the real API over HTTP via @alcove/api-http
 * (whose call sessions are real MLS clients), real Postgres, the object store, a real LiveKit server and main's fake
 * NEAR AI. When the organizer's connection drops, someone invited hosts in their place: their browser makes and
 * commits every part of the call's MLS group in a new generation, takes the notes in a new segment, and lets people
 * in; the organizer takes the call back by joining again, or leaves it to someone they choose.
 */
import { AlcoveApiError, firstName, type AlcoveApi, type AudioPiece, type CallSession, type CallState, type TranscriptClip } from '@alcove/api';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { HANDOFF_MS, HOST_GRACE_MS, reconcile } from './modules/calls';
import { speechWav } from './testing/fake-near';
import { ORIGIN, startHarness, type Harness } from './testing/harness';
import { connect, disposeLiveKit, participantsDirectly, signWebhook, type TestParticipant } from './testing/livekit';

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
const sendIndex = (call: CallSession) => call.crypto.getSnapshot().media?.send?.index;
const onLatestKey = (call: CallSession) => waitFor(() => sendIndex(call) !== undefined && sendIndex(call) === call.crypto.getSnapshot().media?.epochs.at(-1)?.index, `${call.ticket.role} sending with its new key`);
const notices = (call: CallSession) => call.getSnapshot().notices.map((n) => n.text);
const audio = (marker: string, segment: number, s: number): AudioPiece => {
  const src = Buffer.concat([Buffer.from(marker), randomBytes(2048)]);
  const bytes = new Uint8Array(new ArrayBuffer(src.length));
  bytes.set(src);
  return { data: new Blob([bytes]), segment, seq: s, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' };
};
const speech = (words: string, segment: number, startMs: number): TranscriptClip => ({ data: new Blob([speechWav(words, 4000)], { type: 'audio/wav' }), segment, startMs, durationMs: 4000 });
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

/** Rooms a test connected; disconnected after each test so rooms empty out. */
const open: TestParticipant[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map((p) => p.disconnect().catch(() => undefined))); h.closeCalls(); });
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
    await sleep(2200);
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
    expect(code(await host.appendAudio(audio('late', 0, 1)).catch((e: unknown) => e))).toBe('conflict');
    expect(code(await host.transcribe(speech('Too late to count.', 0, 6000), host.ticket.identity).catch((e: unknown) => e))).toBe('conflict');
    await priya.call.appendAudio(audio('stand-in', 1, 0));
    await priya.call.transcribe(speech('Priya carries on.', 1, 0), sam.ticket.identity);
    await priya.call.transcribe(speech('Priya carries on.', 1, 0), sam.ticket.identity);
    // Catching up says nothing was transcribed only from the drop until Priya hosted: her browser sends what's said since.
    const missed = (await priya.call.catchUp({ kind: 'all' })).read.missed;
    expect(missed).toHaveLength(1);
    expect(missed[0]?.from ?? 0).toBeGreaterThan(droppedAt - 1);
    expect(missed[0]?.to ?? Infinity).toBeLessThan(handedAt + 1);
    expect((missed[0]?.to ?? 0) - (missed[0]?.from ?? 0)).toBeGreaterThanOrEqual(2);

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

    // Priya ends the call: the notes cover all of it, each line once, and go to everyone invited, the organizer included.
    const end = await priya.call.leave();
    const noteId = end?.pendingNoteId ?? '';
    expect(noteId).not.toBe('');
    expect((await written(org.api, noteId)).at(-1)?.ready).toBe(true);
    const note = await org.api.notes.get(noteId);
    expect(note.transcript?.map((l) => l.text)).toEqual(['We start together.', 'Priya carries on.']);
    expect(note.transcript?.map((l) => l.speaker?.name)).toEqual([org.session.user.name, 'Sam']);
    expect((await priya.browser.api.notes.get(noteId)).id).toBe(noteId);
    expect(code(await ana.api.notes.get(noteId).catch((e: unknown) => e))).toBe('not-found');
  });

  it('gives the call back when the organizer joins again: they host in a new generation, and the stand-in’s late commits and audio are refused', async () => {
    const { org, orgName, host, hostRoom, code: c, people: [priya], guest } = await hostedCall(['Priya'], { guest: 'Sam' });
    if (!priya || !guest) throw new Error('Priya and Sam expected');
    await drop(host, hostRoom, true);
    await upkeepAfter(HANDOFF_MS);
    const standing = await settle(priya.call, (x) => x.isHost, 'Priya hosting');

    // The organizer comes back: joining takes the role back at once.
    const back = await org.api.calls.join(c, { mic: true, cam: false });
    expect(back.getSnapshot()).toMatchObject({ isHost: true, isOrganizer: true, host: { id: back.ticket.identity, standIn: false } });
    expect(back.getSnapshot().generation).toBe(standing.generation + 1);
    expect(back.getSnapshot().notices.map((n) => n.text)).toContain(`You’re hosting again. ${priya.name} hosted while you were away.`);
    await inGroup(back);
    // Priya stops hosting and rejoins the organizer's group like everyone else; so does Sam.
    const after = await settle(priya.call, (x) => !x.isHost && x.host.id === back.ticket.identity, 'Priya back to a member');
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
    expect((await asMember(kofi.call, '/actions', { type: 'rooms-open', rooms: [{ name: 'A', emails: [] }, { name: 'B', emails: [] }], minutes: 5 })).status).toBe(403);
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
