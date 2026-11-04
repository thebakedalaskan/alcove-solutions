/**
 * Moving a place in a live call to another device, and coming back in after a connection drops, end to end: the real
 * API over HTTP via @alcove/api-http (whose call sessions are real MLS clients, so the new device really joins the
 * call's encrypted group with keys it made itself), real Postgres, the object store and the real LiveKit server.
 */
import { AlcoveApiError, MoveClaimSchema, MoveCodeSchema, MoveInSchema, type CallMoveIn, type CallSession, type CallState, type MoveDevice } from '@alcove/api';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ORIGIN, startHarness, type Harness } from './testing/harness';
import { disposeLiveKit, signWebhook } from './testing/livekit';

vi.setConfig({ testTimeout: 60_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });

const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session };
}
const guestBrowser = () => h.browser().api;
const PHONE: MoveDevice = { kind: 'phone', os: 'ios', browser: 'safari' };
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
  return call.getSnapshot();
}
const inGroup = (call: CallSession) => waitFor(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
async function letIn(host: CallSession, who: CallSession) {
  await settle(host, (s) => s.waiting.some((w) => w.id === who.ticket.identity));
  await host.admit(who.ticket.identity);
  await inGroup(who);
}
const latestKeys = (call: CallSession) => call.crypto.getSnapshot().media?.epochs.at(-1)?.keys ?? {};
const keyOf = (call: CallSession) => JSON.stringify(Object.entries(latestKeys(call)).sort(([a], [b]) => a.localeCompare(b)).map(([id, k]) => [id, Buffer.from(k).toString('hex')]));
const asMember = (call: Pick<CallSession, 'ticket'>, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, callId = call.ticket.callId) => fetch(`${h.baseUrl}/v1/live/calls/${callId}${path}`, {
  method, headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-alcove-call': call.ticket.pass }, ...(body === undefined ? {} : { body: JSON.stringify(body) })
});
/** A request a new device makes about a move, with the secret in the body as the app sends it. */
const asDevice = (path: string, body: unknown, f: typeof fetch = fetch) => f(`${h.baseUrl}/v1/moves/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify(body) });
const callRows = async (table: string, callId: string) => (await h.pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE call_id = $1`, [callId])).rows[0]?.n;
/** In a part of the call (`main`, or a breakout room's ID): in its group, with keys to send with. */
const inPlace = (call: CallSession, place: string) => waitFor(() => {
  const s = call.crypto.getSnapshot();
  return s.status === 'in' && s.place === place && Boolean(s.media?.send);
}, `${call.ticket.role} in ${place === 'main' ? 'the main room' : 'a room'}`);
const roomIds = async (host: CallSession) => (await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms.map((r) => r.id) ?? [];
/** Who's in this browser's group for the part of the call it's in, from MLS itself. */
const members = (call: CallSession) => [...call.crypto.getSnapshot().members].sort();
/** A participant ID of the kind a browser makes for itself. */
const freshIdentity = () => `p_${randomBytes(16).toString('base64url')}`;
/** Opens a move's link as a device the test drives by hand: its claim. */
async function claimOf(c: string): Promise<string> {
  const r = await asDevice('claim', { code: c });
  expect(r.status).toBe(200);
  return MoveClaimSchema.parse(await r.json()).claim;
}
/** How long something took, in ms. */
async function timed<T>(f: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const t0 = performance.now();
  const value = await f();
  return { ms: performance.now() - t0, value };
}
/** Waits until the API's own database says the organizer's connection has been gone for at least `seconds`. */
async function goneFor(callId: string, seconds: number): Promise<void> {
  const until = Date.now() + 15_000;
  for (;;) {
    const r = await h.pool.query<{ gone: boolean }>('SELECT now() - host_left_at >= make_interval(secs => $2) AS gone FROM calls WHERE call_id = $1', [callId, seconds]);
    if (r.rows[0]?.gone === true) return;
    if (Date.now() > until) throw new Error('timed out waiting for the organizer’s connection to be gone');
    await sleep(25);
  }
}
async function hook(event: string, roomName: string, identity: string) {
  const body = JSON.stringify({ event, room: { name: roomName }, participant: { identity } });
  return fetch(`${h.baseUrl}/hooks/livekit`, { method: 'POST', headers: { 'content-type': 'application/webhook+json', authorization: await signWebhook(h.deps.cfg, body) }, body });
}

/** Call sessions that came from moves, which the harness doesn't know about: stopped after each test. */
const moved: CallSession[] = [];
const incoming: CallMoveIn[] = [];
afterEach(() => { for (const s of moved.splice(0)) s.close(); for (const m of incoming.splice(0)) m.close(); h.closeCalls(); });
async function open(api: ReturnType<typeof guestBrowser>, c: string) { const m = await api.calls.openMove(c); incoming.push(m); return m; }
async function arrived(m: CallMoveIn): Promise<CallSession> {
  await waitFor(() => m.getSnapshot().session !== null || m.getSnapshot().stage === 'expired', 'the new device in the call');
  const s = m.getSnapshot().session;
  if (!s) throw new Error(`the move ended at ${m.getSnapshot().stage}`);
  moved.push(s);
  return s;
}

describe('moving to another device', () => {
  it('moves a guest as the same person: the old device lets go first, and nobody is in the call twice', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const laptop = await guestBrowser().calls.join(c, { mic: false, cam: true, name: 'Sam' });
    await letIn(host, laptop);
    laptop.setHand(true);
    host.setSpotlight(laptop.ticket.identity);
    await settle(host, (s) => s.spotlight === laptop.ticket.identity && s.participants.some((p) => p.hand));

    const seat = host.getSnapshot().participants.find((p) => p.id === laptop.ticket.identity)?.seat;
    expect(seat).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const out = await laptop.startMove({ mic: false, cam: true });
    const first = out.getSnapshot().code ?? '';
    expect(out.getSnapshot().stage).toBe('open');
    const phoneApi = guestBrowser();
    const there = await open(phoneApi, first);
    // The new device learns the call, who they'll be, and how their microphone and camera were: nothing else.
    expect(there.getSnapshot().move).toMatchObject({ stage: 'claimed', title: host.getSnapshot().title, you: { name: 'Sam', role: 'guest' }, account: 'none', media: { mic: false, cam: true }, joined: null });
    // The code works once.
    expect(code(await guestBrowser().calls.openMove(first).catch((e: unknown) => e))).toBe('not-found');
    await waitFor(() => out.getSnapshot().stage === 'claimed' && out.getSnapshot().code === null, 'the old device told the link was opened');

    await there.ready(PHONE);
    await waitFor(() => out.getSnapshot().stage === 'ready', 'the old device told the new one is ready');
    expect(out.getSnapshot()).toMatchObject({ device: PHONE, sameAccount: false });
    // Nothing comes in until the old device lets go: coming in is refused, and there's no second connection or microphone.
    expect((await asDevice('arrive', { claim: there.claim })).status).toBe(409);
    await there.refresh();
    expect(there.getSnapshot()).toMatchObject({ stage: 'ready', session: null });
    expect((await settle(host, (s) => s.participants.length === 2)).participants).toHaveLength(2);

    // The old device lets go (it stops its microphone and camera and leaves the room), then confirms.
    laptop.close();
    await out.confirm({ mic: false, cam: true });
    expect(out.getSnapshot().stage).toBe('moved');
    const phone = await arrived(there);
    await inGroup(phone);
    expect(phone.ticket.identity).not.toBe(laptop.ticket.identity);
    expect(there.getSnapshot().move.media).toEqual({ mic: false, cam: true });
    // Its answer lost on the way, the phone asks again: the same connection and role, with a new pass, never a second one.
    const askedAgain = await asDevice('arrive', { claim: there.claim });
    expect(askedAgain.status).toBe(200);
    const reissued = MoveInSchema.parse(await askedAgain.json()).joined?.ticket;
    expect(reissued).toMatchObject({ identity: phone.ticket.identity, role: 'guest', callId: phone.ticket.callId });
    expect(reissued?.pass).not.toBe(phone.ticket.pass);

    // The same person, once: their name, their raised hand, the spotlight. The old connection is out of the group.
    const seen = await settle(host, (s) => s.participants.length === 2 && s.participants.some((p) => p.id === phone.ticket.identity));
    expect(seen.participants.map((p) => p.id).sort()).toEqual([host.ticket.identity, phone.ticket.identity].sort());
    // Their seat too, so everyone's own layout keeps them where they were.
    expect(seen.participants.find((p) => p.id === phone.ticket.identity)).toMatchObject({ seat, person: expect.objectContaining({ name: 'Sam' }), hand: true });
    expect(seen.spotlight).toBe(phone.ticket.identity);
    await waitFor(() => !host.crypto.getSnapshot().members.includes(laptop.ticket.identity) && host.crypto.getSnapshot().members.includes(phone.ticket.identity), 'the phone in the group, the laptop out');
    await waitFor(() => keyOf(phone) === keyOf(host), 'the phone on the call’s keys');
    expect(Object.keys(latestKeys(host)).sort()).toEqual([host.ticket.identity, phone.ticket.identity].sort());
    // The laptop's pass brings nobody back: not in place, not into the room, not by joining again.
    expect((await asMember(laptop, 'GET', '/room')).status).toBe(403);
    expect((await asMember(laptop, 'POST', '/mls/back', { generation: host.getSnapshot().generation, keyPackage: 'AAAA' })).status).toBe(409);
    const again = await guestBrowser().calls.join(c, { mic: false, cam: false, name: 'Sam', previous: laptop.ticket.pass });
    expect(again.crypto.getSnapshot().status).toBe('waiting');
    await again.leave();
    await host.leave();
    // Moves go with the call.
    expect(await callRows('call_moves', host.ticket.callId)).toBe(0);
  });

  it('moves the organizer, host powers and the recording, only to a device signed in to the organizer’s account', async () => {
    const email = unique('organizer');
    const org = await account(email);
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const laptop = await org.api.calls.join(c, { mic: true, cam: true });
    await inGroup(laptop);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(laptop, sam);
    laptop.setHand(true);
    await settle(laptop, (s) => s.participants.some((p) => p.isMe && p.hand));
    // The laptop can't record (no microphone, say): everyone sees it.
    await laptop.setUnavailable(['recording']);
    expect((await settle(sam, (s) => s.capture.recording.mode === 'unavailable')).capture.mode).toBe('on');

    const out = await laptop.startMove({ mic: true, cam: false });
    // A device signed in to nobody, or to someone else, can open the link but can't take the organizer's place.
    const phone = h.browser();
    const there = await open(phone.api, out.getSnapshot().code ?? '');
    expect(there.getSnapshot().move).toMatchObject({ you: { role: 'host' }, account: 'needed' });
    expect(code(await there.ready(PHONE).catch((e: unknown) => e))).toBe('forbidden');
    await phone.api.auth.signIn('sso', { email: unique('someone-else') });
    await there.refresh();
    expect(there.getSnapshot().move.account).toBe('other');
    expect(code(await there.ready(PHONE).catch((e: unknown) => e))).toBe('forbidden');
    // Signed in as the organizer: in.
    await phone.api.auth.signIn('sso', { email });
    await there.refresh();
    expect(there.getSnapshot().move.account).toBe('ok');
    await there.ready(PHONE);
    await waitFor(() => out.getSnapshot().stage === 'ready', 'the laptop told the phone is ready');
    expect(out.getSnapshot().sameAccount).toBe(true);

    laptop.close();
    await out.confirm({ mic: true, cam: false });
    // The claim alone, without the organizer's session, never brings anyone in as the organizer.
    expect((await asDevice('arrive', { claim: there.claim })).status).toBe(403);
    const now = await arrived(there);
    await inGroup(now);
    expect(now.ticket.role).toBe('host');
    expect(now.getSnapshot()).toMatchObject({ isOrganizer: true, generation: 1 });
    // What the laptop couldn't capture was its own: the new device says for itself.
    expect(now.getSnapshot().capture).toMatchObject({ mode: 'on', away: false, recording: { mode: 'on' } });
    // Everyone already in rejoins the new device's group without asking, and the organizer's hand stays up.
    await waitFor(() => now.crypto.getSnapshot().members.includes(sam.ticket.identity) && keyOf(sam) === keyOf(now), 'Sam in the new device’s group');
    expect((await settle(sam, (s) => s.participants.some((p) => p.isOrganizer && p.id === now.ticket.identity))).participants.find((p) => p.isOrganizer)?.hand).toBe(true);
    // Host powers went with the organizer: the new device can lock the call; the laptop is told the call went on
    // elsewhere (409, so anything it still had to send stops quietly), and can't send audio either.
    await now.lock(true);
    expect((await settle(now, (s) => s.locked)).locked).toBe(true);
    expect(code(await laptop.lock(false).catch((e: unknown) => e))).toBe('conflict');
    // The recording carries on in a new segment from the new device.
    expect(now.getSnapshot().notes.recording.segment).toBe(1);
    const piece = { data: new Blob([randomBytes(1024)]), segment: 1, seq: 0, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' };
    await now.appendAudio(piece);
    expect(code(await laptop.appendAudio({ ...piece, seq: 1 }).catch((e: unknown) => e))).toBe('conflict');
    expect((await now.leave())?.duration).toBeGreaterThan(0);
  });

  it('keeps notes paused across a move: only the organizer resumes them', async () => {
    const email = unique('organizer');
    const org = await account(email);
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const laptop = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(laptop);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(laptop, sam);
    await laptop.pause();
    expect(laptop.getSnapshot().capture.mode).toBe('paused');

    const out = await laptop.startMove({ mic: true, cam: false });
    const phone = h.browser();
    await phone.api.auth.signIn('sso', { email });
    const there = await open(phone.api, out.getSnapshot().code ?? '');
    await there.ready(PHONE);
    await waitFor(() => out.getSnapshot().stage === 'ready', 'the laptop told the phone is ready');
    laptop.close();
    await out.confirm({ mic: true, cam: false });
    const now = await arrived(there);
    // Still paused on the new device and for everyone: a move resumes nothing, and audio is still refused.
    expect(now.getSnapshot().capture).toMatchObject({ mode: 'paused', away: false, recording: { mode: 'paused', by: { kind: 'organizer' } } });
    expect((await settle(sam, (s) => s.participants.some((p) => p.isOrganizer && p.id === now.ticket.identity))).capture.mode).toBe('paused');
    const piece = { data: new Blob([randomBytes(1024)]), segment: 0, seq: 0, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' };
    expect(code(await now.appendAudio(piece).catch((e: unknown) => e))).toBe('conflict');
    // The organizer resumes from the new device: a new segment, and one gap, the pause, with nothing offline in it.
    await now.resume();
    expect(now.getSnapshot()).toMatchObject({ capture: { mode: 'on' }, notes: { recording: { segment: 1 } } });
    await now.appendAudio({ ...piece, segment: 1 });
    expect(now.getSnapshot().capture.gaps.map((g) => g.kind)).toEqual(['paused']);
    await now.leave();
  });

  it('says nothing is captured while the organizer’s browser is out of the call, and marks the gap when another connection takes over', async () => {
    const email = unique('organizer');
    const org = await account(email);
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const laptop = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(laptop);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(laptop, sam);
    const room = laptop.ticket.roomName;

    // LiveKit says the organizer's connection left: everyone, and the card, are told nothing is captured.
    expect((await hook('participant_left', room, laptop.ticket.identity)).status).toBe(200);
    expect((await settle(sam, (s) => s.capture.away)).capture).toMatchObject({
      mode: 'unavailable', away: true, recording: { mode: 'unavailable' }, transcript: { mode: 'unavailable' }, ai: { mode: 'on' }
    });
    expect((await guestBrowser().calls.card(c)).capture).toMatchObject({ mode: 'unavailable', away: true });
    // The same connection comes back (LiveKit reconnected it): its recording carried on meanwhile, and nothing is marked.
    expect((await hook('participant_joined', room, laptop.ticket.identity)).status).toBe(200);
    expect((await settle(sam, (s) => !s.capture.away)).capture).toMatchObject({ mode: 'on', away: false, gaps: [] });

    // Gone again, and this time the organizer comes back from another device: the time between is a gap.
    expect((await hook('participant_left', room, laptop.ticket.identity)).status).toBe(200);
    await goneFor(laptop.ticket.callId, 1);
    const phone = await (await account(email)).api.calls.join(c, { mic: true, cam: false });
    expect(phone.getSnapshot()).toMatchObject({ capture: { mode: 'on', away: false }, notes: { recording: { segment: 1 } } });
    const [gap, ...more] = phone.getSnapshot().capture.gaps;
    expect(more).toEqual([]);
    expect(gap).toMatchObject({ kind: 'offline', at: 0 });
    expect(Date.parse(gap?.to ?? '') - Date.parse(gap?.from ?? '')).toBeGreaterThanOrEqual(1000);
    // The laptop's tab is told the call went on elsewhere (409), so its late audio stops there quietly.
    const piece = { data: new Blob([randomBytes(1024)]), segment: 0, seq: 0, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' };
    expect(code(await laptop.appendAudio(piece).catch((e: unknown) => e))).toBe('conflict');
    // And the finished note says so where it falls.
    const noteId = (await phone.leave())?.pendingNoteId ?? '';
    expect((await org.api.notes.get(noteId)).gaps.map((g) => g.kind)).toEqual(['offline']);
  });

  it('moves an invited person only to a device signed in to their account, as the same person', async () => {
    const org = await account();
    const invitedEmail = unique('invited');
    const { code: c } = await org.api.calls.startNow({ guests: [invitedEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const priya = await account(invitedEmail);
    const laptop = await priya.api.calls.join(c, { mic: true, cam: true });
    await inGroup(laptop);
    const before = (await settle(host, (s) => s.participants.some((p) => p.id === laptop.ticket.identity))).participants.find((p) => p.id === laptop.ticket.identity)?.seat;
    // Moving needs the account's own session on the device being left too, not only the pass.
    expect((await asMember(laptop, 'POST', '/moves', { media: { mic: true, cam: true } })).status).toBe(403);
    const out = await laptop.startMove({ mic: true, cam: true });
    const phone = h.browser();
    const there = await open(phone.api, out.getSnapshot().code ?? '');
    expect(there.getSnapshot().move).toMatchObject({ you: { role: 'invited' }, account: 'needed' });
    expect(code(await there.ready(PHONE).catch((e: unknown) => e))).toBe('forbidden');
    await phone.api.auth.signIn('sso', { email: invitedEmail });
    await there.refresh();
    await there.ready(PHONE);
    await waitFor(() => out.getSnapshot().stage === 'ready', 'the laptop told the phone is ready');
    laptop.close();
    await out.confirm({ mic: true, cam: true });
    // Coming in needs the account's session again, not only the claim.
    expect((await asDevice('arrive', { claim: there.claim })).status).toBe(403);
    const now = await arrived(there);
    await inGroup(now);
    expect(now.ticket.role).toBe('invited');
    const seen = await settle(host, (s) => s.participants.length === 2 && s.participants.some((p) => p.id === now.ticket.identity));
    expect(seen.participants.find((p) => p.id === now.ticket.identity)).toMatchObject({ seat: before, person: expect.objectContaining({ email: invitedEmail }) });
    await host.leave();
  });

  it('never hands a move someone else’s place: not the organizer’s, not another guest’s, not its own old one', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    const kim = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Kim' });
    await letIn(host, kim);
    // Sam starts a move on Sam's own pass, and drives the "new device" by hand.
    const out = await sam.startMove({ mic: true, cam: false });
    const claim = await claimOf(out.getSnapshot().code ?? '');
    // Naming the organizer's connection, Kim's, or Sam's own: refused, and the move stays where it was.
    for (const identity of [host.ticket.identity, kim.ticket.identity, sam.ticket.identity]) {
      expect((await asDevice('ready', { claim, identity, keyPackage: 'AAAA', device: PHONE })).status).toBe(409);
    }
    expect(MoveInSchema.parse(await (await asDevice('status', { claim })).json()).stage).toBe('claimed');
    // So the old device has nothing to let go to, and nothing comes in.
    expect((await asMember(sam, 'POST', '/moves/confirm', { media: { mic: true, cam: false } })).status).toBe(409);
    expect((await asDevice('arrive', { claim })).status).toBe(409);

    // A new identity, but one that joins the call some other way before the move comes in: the move still can't hand it over.
    const x = freshIdentity();
    expect((await asDevice('ready', { claim, identity: x, keyPackage: 'AAAA', device: PHONE })).status).toBe(200);
    const asked = await fetch(`${h.baseUrl}/v1/calls/${c}/join`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ mic: false, cam: false, name: 'Mallory', identity: x, keyPackage: 'AAAA' })
    });
    expect(asked.status).toBe(200);
    await waitFor(() => out.getSnapshot().stage === 'ready', 'Sam’s old device told the new one is ready');
    // As the app does, the old device stops its call before it lets go (left running, it would come back by itself).
    sam.close();
    await out.confirm({ mic: true, cam: false });
    for (let i = 0; i < 3; i++) {
      const r = await asDevice('arrive', { claim });
      expect(r.status).toBe(409);
      expect(await r.text()).not.toMatch(/"pass"/);
    }
    // Nobody got a pass for a place that wasn't theirs: the organizer and Kim are themselves, and Mallory is someone asking.
    const ids = (v: CallState) => v.participants.map((p) => p.id).sort();
    const s = await settle(host, (v) => JSON.stringify(ids(v)) === JSON.stringify([host.ticket.identity, kim.ticket.identity].sort()));
    expect(ids(s)).toEqual([host.ticket.identity, kim.ticket.identity].sort());
    expect(ids(s)).not.toContain(x);
    expect(s.participants.find((p) => p.isOrganizer)?.id).toBe(host.ticket.identity);
    await host.leave();
  });

  it('answers many requests about one move at once without holding up anything else', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const kim = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Kim' });
    await letIn(host, kim);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    const read = () => timed(async () => (await asMember(host, 'GET', '')).status);

    // Twelve "ready"s on one claim at once, each naming its own identity: one wins, the others are told no, and the
    // organizer's own read of the call meanwhile isn't kept waiting.
    const kimOut = await kim.startMove({ mic: true, cam: false });
    const claim = await claimOf(kimOut.getSnapshot().code ?? '');
    const [readies, during] = await Promise.all([
      Promise.all(Array.from({ length: 12 }, () => asDevice('ready', { claim, identity: freshIdentity(), keyPackage: 'AAAA', device: PHONE }).then((r) => r.status))),
      read()
    ]);
    expect(readies.filter((st) => st === 200)).toHaveLength(1);
    expect(readies.every((st) => st === 200 || st === 409)).toBe(true);
    expect(during.value).toBe(200);
    expect(during.ms).toBeLessThan(2000);
    expect((await asDevice('cancel', { claim })).status).toBe(200);

    // Twelve "arrive"s at once once Sam's old device lets go, beside the new device's own: one connection comes in, every
    // answer that has a ticket has that one, and nothing else waits.
    const out = await sam.startMove({ mic: true, cam: false });
    const there = await open(guestBrowser(), out.getSnapshot().code ?? '');
    await there.ready(PHONE);
    await waitFor(() => out.getSnapshot().stage === 'ready', 'Sam’s old device told the new one is ready');
    sam.close();
    await out.confirm({ mic: true, cam: false });
    const [arrivals, meanwhile] = await Promise.all([
      Promise.all(Array.from({ length: 12 }, async () => {
        const r = await asDevice('arrive', { claim: there.claim });
        return { status: r.status, identity: r.status === 200 ? MoveInSchema.parse(await r.json()).joined?.ticket.identity ?? null : null };
      })),
      read()
    ]);
    expect(arrivals.every((a) => a.status === 200 || a.status === 409)).toBe(true);
    const phone = await arrived(there);
    expect(new Set(arrivals.flatMap((a) => (a.identity ? [a.identity] : [])))).toEqual(new Set(arrivals.some((a) => a.identity) ? [phone.ticket.identity] : []));
    expect(meanwhile.ms).toBeLessThan(2000);
    const s = await settle(host, (v) => v.participants.length === 3 && v.participants.some((p) => p.id === phone.ticket.identity));
    expect(s.participants.filter((p) => p.person.name === 'Sam')).toHaveLength(1);
    await host.leave();
  });

  it('moves someone in a breakout room into that room’s group, once, on its next keys, and never into anyone else’s place', async () => {
    const org = await account();
    const kofiEmail = unique('kofi');
    const { code: c } = await org.api.calls.startNow({ guests: [kofiEmail], notes: 'on' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const laptop = await (await account(kofiEmail)).api.calls.join(c, { mic: true, cam: false });
    await inGroup(laptop);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofiEmail] }, { name: 'Support', emails: [] }], minutes: 10 });
    const [design = ''] = await roomIds(host);
    await inPlace(laptop, design);
    host.visitRoom(design);
    await inPlace(host, design);
    await waitFor(() => keyOf(laptop) === keyOf(host), 'Kofi and the organizer on Design’s keys');
    const roomKeys = keyOf(laptop);

    const out = await laptop.startMove({ mic: true, cam: false });
    const phone = h.browser();
    await phone.api.auth.signIn('sso', { email: kofiEmail });
    const there = await open(phone.api, out.getSnapshot().code ?? '');
    // From a room too, signed in as Kofi: naming the organizer's connection, or Sam's in the main room, is refused.
    for (const identity of [host.ticket.identity, sam.ticket.identity]) {
      expect((await asDevice('ready', { claim: there.claim, identity, keyPackage: 'AAAA', device: PHONE }, phone.fetch)).status).toBe(409);
    }
    await there.ready(PHONE);
    await waitFor(() => out.getSnapshot().stage === 'ready', 'the laptop told the phone is ready');
    laptop.close();
    await out.confirm({ mic: true, cam: false });
    const now = await arrived(there);
    // Straight into Design's group, Kofi once: the laptop's connection taken out of it, the phone's added.
    await inPlace(now, design);
    await waitFor(() => members(host).includes(now.ticket.identity) && !members(host).includes(laptop.ticket.identity), 'Kofi in Design once, on the phone');
    expect(members(host)).toEqual([host.ticket.identity, now.ticket.identity].sort());
    const s = await settle(host, (x) => x.breakouts.open?.rooms[0]?.members.includes(now.ticket.identity) === true && x.participants.filter((p) => p.person.email === kofiEmail).length === 1);
    expect(s.breakouts.open?.rooms[0]?.members.sort()).toEqual([host.ticket.identity, now.ticket.identity].sort());
    // On Design's next keys (the laptop's are no use now), and never in the main room's group.
    await waitFor(() => keyOf(now) === keyOf(host), 'the phone on Design’s keys');
    expect(keyOf(now)).not.toBe(roomKeys);
    expect(members(sam)).not.toContain(now.ticket.identity);
    await host.leave();
  });

  it('moves the organizer while visiting a breakout room: back in that room on the new device, everyone in their own room, nothing resumed', async () => {
    const email = unique('organizer');
    const org = await account(email);
    const kofiEmail = unique('kofi');
    const { code: c } = await org.api.calls.startNow({ guests: [kofiEmail], notes: 'on' });
    const laptop = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(laptop);
    const kofi = await (await account(kofiEmail)).api.calls.join(c, { mic: true, cam: false });
    await inGroup(kofi);
    laptop.openRooms({ rooms: [{ name: 'Design', emails: [kofiEmail] }, { name: 'Support', emails: [] }], minutes: 10 });
    const [design = ''] = await roomIds(laptop);
    await inPlace(kofi, design);
    laptop.visitRoom(design);
    await inPlace(laptop, design);
    await laptop.pauseRoom(design, true);
    expect((await settle(kofi, (x) => x.capture.room?.mode === 'paused')).capture).toMatchObject({ mode: 'on', room: { mode: 'paused' } });

    const out = await laptop.startMove({ mic: true, cam: false });
    const phone = h.browser();
    await phone.api.auth.signIn('sso', { email });
    const there = await open(phone.api, out.getSnapshot().code ?? '');
    await there.ready(PHONE);
    await waitFor(() => out.getSnapshot().stage === 'ready', 'the laptop told the phone is ready');
    laptop.close();
    await out.confirm({ mic: true, cam: false });
    const now = await arrived(there);
    // A new generation of groups: the organizer is back in Design on the new device, and Kofi with it in Design's new group.
    await inPlace(now, design);
    await inPlace(kofi, design);
    await waitFor(() => members(now).includes(kofi.ticket.identity) && keyOf(kofi) === keyOf(now), 'Kofi in the new Design group');
    expect(members(now)).toEqual([now.ticket.identity, kofi.ticket.identity].sort());
    // Nothing resumed: the call's notes still on and Design still paused, as the new device and Kofi both see it.
    expect((await settle(now, (x) => x.capture.room !== null)).capture).toMatchObject({ mode: 'on', room: { mode: 'paused' } });
    expect((await settle(kofi, (x) => x.capture.room?.mode === 'paused')).capture.room?.mode).toBe('paused');
    await now.leave();
  });

  it('works once, runs out, and can be called off from either device', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);

    // A new code makes the one before useless.
    const media = { media: { mic: true, cam: false } };
    const one = MoveCodeSchema.parse(await (await asMember(sam, 'POST', '/moves', media)).json());
    const two = MoveCodeSchema.parse(await (await asMember(sam, 'POST', '/moves', media)).json());
    expect((await asDevice('claim', { code: one.code })).status).toBe(404);
    // A code that ran out opens nothing, and upkeep deletes it.
    await h.pool.query(`UPDATE call_moves SET expires_at = now() - interval '1 second' WHERE call_id = $1`, [sam.ticket.callId]);
    expect((await asDevice('claim', { code: two.code })).status).toBe(404);
    const { maintain } = await import('./maintenance');
    expect((await maintain(h.deps)).moves).toBeGreaterThanOrEqual(1);
    expect(await callRows('call_moves', sam.ticket.callId)).toBe(0);

    // Called off on the old device: the new one is told, and can't carry on.
    const three = await sam.startMove({ mic: true, cam: false });
    const there = await open(guestBrowser(), three.getSnapshot().code ?? '');
    await three.cancel();
    expect(code(await there.ready(PHONE).catch((e: unknown) => e))).toBe('conflict');
    await waitFor(() => there.getSnapshot().stage === 'cancelled', 'the new device told');
    // Called off on the new device: the old one is told.
    const four = await sam.startMove({ mic: true, cam: false });
    const other = await open(guestBrowser(), four.getSnapshot().code ?? '');
    await other.ready(PHONE);
    await waitFor(() => four.getSnapshot().stage === 'ready', 'ready');
    await other.cancel();
    await waitFor(() => four.getSnapshot().stage === 'cancelled', 'the old device told');
    expect((await asMember(sam, 'POST', '/moves/confirm', media)).status).toBe(409);
    // A claim that ran out is gone too.
    const five = await sam.startMove({ mic: true, cam: false });
    const late = await open(guestBrowser(), five.getSnapshot().code ?? '');
    await h.pool.query(`UPDATE call_moves SET expires_at = now() - interval '1 second' WHERE call_id = $1`, [sam.ticket.callId]);
    await late.refresh();
    expect(late.getSnapshot().stage).toBe('expired');
    expect(late.getSnapshot().problem?.requestId).toBeTruthy();
    five.close();
    // Sam never moved: still in, once.
    expect((await settle(host, (s) => s.participants.length === 2)).participants.map((p) => p.id)).toContain(sam.ticket.identity);
    await host.leave();
  });

  it('keeps a move to its own call and person, and ends it for someone removed', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    const lee = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Lee' });
    await letIn(host, lee);
    const out = await sam.startMove({ mic: true, cam: false });
    const there = await open(guestBrowser(), out.getSnapshot().code ?? '');
    await there.ready(PHONE);
    await waitFor(() => out.getSnapshot().stage === 'ready', 'ready');

    // Someone else in the call sees no move of Sam's, and can neither finish nor call it off.
    expect(await (await asMember(lee, 'GET', '/moves')).json()).toEqual({ move: null });
    expect((await asMember(lee, 'POST', '/moves/confirm', { media: { mic: true, cam: false } })).status).toBe(409);
    expect((await asMember(lee, 'DELETE', '/moves')).status).toBe(200);
    expect(out.getSnapshot().stage).toBe('ready');
    // Another call's pass, even another organizer's, gets nowhere near it.
    const other = await account();
    const elsewhere = await other.api.calls.join((await other.api.calls.startNow({})).code, { mic: true, cam: false });
    for (const [method, path] of [['GET', '/moves'], ['POST', '/moves/confirm'], ['DELETE', '/moves']] as const) {
      expect((await asMember(elsewhere, method, path, method === 'POST' ? { media: { mic: true, cam: false } } : undefined, sam.ticket.callId)).status).toBe(401);
    }
    await elsewhere.leave();

    // Removed while moving: the move is over on both devices, and nothing comes in.
    await host.remove(sam.ticket.identity);
    expect((await asMember(sam, 'POST', '/moves/confirm', { media: { mic: true, cam: false } })).status).toBe(403);
    await there.refresh();
    expect(there.getSnapshot().stage).toBe('expired');
    // A removed person can't start one either.
    expect((await asMember(sam, 'POST', '/moves', { media: { mic: true, cam: false } })).status).toBe(403);
    expect((await settle(host, (s) => s.participants.length === 2)).participants.map((p) => p.id).sort()).toEqual([host.ticket.identity, lee.ticket.identity].sort());
    await host.leave();
  });

  it('keeps the code and the claim out of every row and log', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'CANARY-MOVER Sam' });
    await letIn(host, sam);
    const out = await sam.startMove({ mic: true, cam: false });
    const secret = out.getSnapshot().code ?? '';
    const opened = MoveClaimSchema.parse(await (await asDevice('claim', { code: secret })).json());
    expect((await asDevice('ready', { claim: opened.claim, identity: `p_${randomBytes(16).toString('base64url')}`, keyPackage: 'AAAA', device: PHONE })).status).toBe(200);
    const rows = String((await h.pool.query(`SELECT string_agg(row_to_json(x)::text, ' ') AS all FROM call_moves x`)).rows[0]?.all ?? '');
    expect(rows).not.toBe('');
    const logs = h.logs.join('');
    for (const s of [secret, opened.claim, 'CANARY-MOVER']) {
      for (const enc of [s, Buffer.from(s).toString('hex'), Buffer.from(s).toString('base64url')]) {
        expect(rows.includes(enc), `${s} in rows`).toBe(false);
        expect(logs.includes(enc), `${s} in logs`).toBe(false);
      }
    }
    // What the new device says it is never reaches a log.
    expect(logs.includes('"os":"ios"')).toBe(false);
    out.close();
    await host.leave();
  });
});

describe('coming back after a connection drops', () => {
  it('lets someone taken out while their connection was away back in as they are, with fresh keys', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    sam.setHand(true);
    await settle(host, (s) => s.participants.some((p) => p.hand));
    await waitFor(() => keyOf(sam) === keyOf(host), 'the same keys');
    const before = keyOf(host);

    // LiveKit says Sam's connection is gone, and three seconds later it still is: Sam is taken out, and the keys move on.
    expect((await hook('participant_left', host.ticket.roomName, sam.ticket.identity)).status).toBe(200);
    await waitFor(() => !host.crypto.getSnapshot().members.includes(sam.ticket.identity), 'Sam out of the group', 10_000);
    // Sam's browser, still there, comes back in by itself: the same connection, the same person, with the hand still up.
    await waitFor(() => host.crypto.getSnapshot().members.includes(sam.ticket.identity) && keyOf(sam) === keyOf(host), 'Sam back in the group', 15_000);
    expect(keyOf(host)).not.toBe(before);
    expect(sam.crypto.getSnapshot().status).toBe('in');
    const seen = await settle(host, (s) => s.participants.some((p) => p.id === sam.ticket.identity));
    expect(seen.participants.map((p) => p.id).sort()).toEqual([host.ticket.identity, sam.ticket.identity].sort());
    expect(seen.participants.find((p) => p.id === sam.ticket.identity)?.hand).toBe(true);
    await sam.sendChat('back again');
    await waitFor(() => host.crypto.getSnapshot().chat.some((m) => m.text === 'back again'), 'chat after coming back');
    // The time it was out is still time away (#78): catching up finds it, and Sam, a guest with the link, reads what
    // was said before and after it, never during it.
    const w = await sam.catchUpWindow();
    expect(w.away).not.toBeNull();
    expect(w.here).toHaveLength(2);
    const [first, second] = w.here ?? [];
    expect(first?.to).toBeLessThanOrEqual(w.away?.from ?? 0);
    expect(second?.from).toBeGreaterThanOrEqual(w.away?.to ?? Infinity);
    await host.leave();
  });

  it('never lets in the new device of someone removed while their move comes in', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    const out = await sam.startMove({ mic: true, cam: false });
    const claim = await claimOf(out.getSnapshot().code ?? '');
    const x = freshIdentity();
    expect((await asDevice('ready', { claim, identity: x, keyPackage: 'AAAA', device: PHONE })).status).toBe(200);
    await waitFor(() => out.getSnapshot().stage === 'ready', 'Sam’s old device told the new one is ready');
    sam.close();
    await out.confirm({ mic: true, cam: false });

    // The race, made certain: the call's row is held, the organizer's removal of Sam queues for it first, and the new
    // device's arrival (past its own first look, which takes no lock) second. The removal lands in between.
    const waiting = async () => Number((await h.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'")).rows[0]?.n ?? 0);
    const until = async (pred: () => Promise<boolean>, what: string) => { for (let i = 0; !(await pred()); i++) { if (i > 400) throw new Error(`timed out waiting for ${what}`); await sleep(25); } };
    const held = await h.pool.connect();
    let arrival: Response | undefined;
    try {
      await held.query('BEGIN');
      await held.query('SELECT 1 FROM calls WHERE call_id = $1 FOR UPDATE', [host.ticket.callId]);
      const base = await waiting();
      const removing = host.remove(sam.ticket.identity);
      await until(async () => (await waiting()) > base, 'the removal to wait for the call');
      const arriving = asDevice('arrive', { claim });
      await until(async () => (await waiting()) > base + 1, 'the arrival to wait for the call');
      await held.query('COMMIT');
      await removing;
      arrival = await arriving;
    } finally {
      held.release();
    }
    // The move brings nobody in: Sam's place went with Sam.
    expect(arrival?.status).toBe(409);
    const s = await settle(host, (v) => !v.participants.some((p) => p.person.name === 'Sam'));
    expect(s.participants.map((p) => p.id)).not.toContain(x);
    expect(s.waiting.map((wt) => wt.id)).not.toContain(x);
    expect(host.crypto.getSnapshot().members).not.toContain(x);
    await host.leave();
  });

  it('moves someone signed in whom the organizer let in from the link, as the invited person the call made them', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    // Signed in but not on the invite: they ask with their address, and being let in adds them to it (#62).
    const email = unique('priya');
    const priya = await account(email);
    const laptop = await priya.api.calls.join(c, { mic: true, cam: false });
    await letIn(host, laptop);
    expect(laptop.ticket.role).toBe('guest');
    expect((await settle(laptop, (v) => v.role === 'invited')).role).toBe('invited');
    // Their pass still says guest, but the call says invited: moving takes their session, and the new device theirs.
    const out = await laptop.startMove({ mic: true, cam: false });
    const phone = h.browser();
    const there = await open(phone.api, out.getSnapshot().code ?? '');
    expect(there.getSnapshot().move).toMatchObject({ you: { role: 'invited' }, account: 'needed' });
    expect(code(await there.ready(PHONE).catch((e: unknown) => e))).toBe('forbidden');
    await phone.api.auth.signIn('sso', { email });
    await there.refresh();
    await there.ready(PHONE);
    await waitFor(() => out.getSnapshot().stage === 'ready', 'the laptop told the phone is ready');
    laptop.close();
    await out.confirm({ mic: true, cam: false });
    const now = await arrived(there);
    await inGroup(now);
    expect((await settle(now, (v) => v.role === 'invited')).role).toBe('invited');
    const seen = await settle(host, (v) => v.participants.some((p) => p.id === now.ticket.identity));
    expect(seen.participants.filter((p) => p.person.email === email)).toHaveLength(1);
    await host.leave();
  });

  it('brings nobody back who was removed, and keeps someone coming back from a reload out of nothing but a lock', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const browser = guestBrowser();
    const first = await browser.calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, first);
    first.setHand(true);
    host.setSpotlight(first.ticket.identity);
    await settle(host, (s) => s.spotlight === first.ticket.identity);
    // Locked: nobody new gets in, but a reload comes straight back, hand and spotlight and all.
    await host.lock(true);
    expect(code(await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Lee' }).catch((e: unknown) => e))).toBe('forbidden');
    first.closing();
    const again = await browser.calls.join(c, { mic: true, cam: false, name: 'Sam', previous: first.ticket.pass });
    await inGroup(again);
    const seen = await settle(host, (s) => s.participants.some((p) => p.id === again.ticket.identity) && s.participants.length === 2);
    expect(seen.spotlight).toBe(again.ticket.identity);
    expect(seen.participants.find((p) => p.id === again.ticket.identity)?.hand).toBe(true);
    // Removed: their pass can't bring them back in place.
    await host.remove(again.ticket.identity);
    expect((await asMember(again, 'POST', '/mls/back', { generation: host.getSnapshot().generation, keyPackage: 'AAAA' })).status).toBe(403);
    await host.leave();
  });
});
