/**
 * Moving a place in a live call to another device, and coming back in after a connection drops, end to end: the real
 * API over HTTP via @alcove/api-http (whose call sessions are real MLS clients, so the new device really joins the
 * call's encrypted group with keys it made itself), real Postgres, the object store and the real LiveKit server.
 */
import { AlcoveApiError, MoveClaimSchema, MoveCodeSchema, type CallMoveIn, type CallSession, type CallState, type MoveDevice } from '@alcove/api';
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
    // Nothing comes in until the old device lets go: no second connection, no second microphone.
    await sleep(300);
    expect(there.getSnapshot().session).toBeNull();
    expect((await settle(host, (s) => s.participants.length === 2)).participants).toHaveLength(2);

    // The old device lets go (it stops its microphone and camera and leaves the room), then confirms.
    laptop.close();
    await out.confirm({ mic: false, cam: true });
    expect(out.getSnapshot().stage).toBe('moved');
    const phone = await arrived(there);
    await inGroup(phone);
    expect(phone.ticket.identity).not.toBe(laptop.ticket.identity);
    expect(there.getSnapshot().move.media).toEqual({ mic: false, cam: true });

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
    const now = await arrived(there);
    await inGroup(now);
    expect(now.ticket.role).toBe('host');
    expect(now.getSnapshot()).toMatchObject({ isOrganizer: true, generation: 1 });
    // Everyone already in rejoins the new device's group without asking, and the organizer's hand stays up.
    await waitFor(() => now.crypto.getSnapshot().members.includes(sam.ticket.identity) && keyOf(sam) === keyOf(now), 'Sam in the new device’s group');
    expect((await settle(sam, (s) => s.participants.some((p) => p.isOrganizer && p.id === now.ticket.identity))).participants.find((p) => p.isOrganizer)?.hand).toBe(true);
    // Host powers went with the organizer: the new device can lock the call, the laptop can't, nor send audio.
    await now.lock(true);
    expect((await settle(now, (s) => s.locked)).locked).toBe(true);
    expect(code(await laptop.lock(false).catch((e: unknown) => e))).toBe('forbidden');
    // The recording carries on in a new segment from the new device.
    expect(now.getSnapshot().notes.recording.segment).toBe(1);
    const piece = { data: new Blob([randomBytes(1024)]), segment: 1, seq: 0, at: 0, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' };
    await now.appendAudio(piece);
    expect(code(await laptop.appendAudio({ ...piece, seq: 1, at: 5 }).catch((e: unknown) => e))).toBe('forbidden');
    expect((await now.leave())?.duration).toBeGreaterThan(0);
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
    const now = await arrived(there);
    await inGroup(now);
    expect(now.ticket.role).toBe('invited');
    const seen = await settle(host, (s) => s.participants.length === 2 && s.participants.some((p) => p.id === now.ticket.identity));
    expect(seen.participants.find((p) => p.id === now.ticket.identity)).toMatchObject({ seat: before, person: expect.objectContaining({ email: invitedEmail }) });
    await host.leave();
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
