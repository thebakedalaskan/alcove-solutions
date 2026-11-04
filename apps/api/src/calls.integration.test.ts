/**
 * Group calls on LiveKit, end to end and end-to-end encrypted: the real API over HTTP via @alcove/api-http
 * (whose call sessions are real MLS clients), real Postgres, the object store, a real LiveKit server
 * (docker-compose.yml) and main's fake Google and NEAR AI. Participants are @livekit/rtc-node rooms joined with
 * the tokens the API hands out, encrypting media with keys from the call's MLS group, so media travels for real.
 */
import { AlcoveApiError, CallMlsSchema, type AlcoveApi, type AudioPiece, type CallSession, type CallState, type TranscriptClip, type TranscriptLine } from '@alcove/api';
import type { ClientEvent } from '@alcove/api-http';
import { DisconnectReason, EncryptionType, TrackKind, TrackSource } from '@livekit/rtc-node';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { speechWav } from './testing/fake-near';
import { ORIGIN, startHarness, type Harness } from './testing/harness';
import { connect, deleteRoomDirectly, disposeLiveKit, participantsDirectly, signWebhook, tokenDirectly, type TestParticipant } from './testing/livekit';

// Calls here use real WebRTC through LiveKit, which a busy CI runner can be slow to set up. Every step waits at most
// 15 s and says what it was waiting for, so a test gets 90 s: slow steps can add up, and a stuck one still fails.
vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });

const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
const message = (e: unknown) => (e instanceof AlcoveApiError ? e.message : '');
let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
/** A fresh account: single sign-on signs in whoever's work email is typed. */
async function account(email = unique(), o: Parameters<Harness['browser']>[0] = {}) {
  const b = h.browser(o);
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session };
}
/** A browser with no account. */
const guestBrowser = () => h.browser().api;
const audioBytes = (marker: string) => { const src = Buffer.concat([Buffer.from(marker), randomBytes(2048)]); const out = new Uint8Array(new ArrayBuffer(src.length)); out.set(src); return out; };
const piece = (bytes: Uint8Array<ArrayBuffer>, segment: number, s: number): AudioPiece => ({ data: new Blob([bytes]), segment, seq: s, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' });
/** A clip of speech in `language` (Whisper sure of it unless `sure` is false), said just now unless `heardAt` (by performance.now()) says when it began. */
const speech = (words: string, segment: number, startMs: number, ms = 4000, language = 'en', sure = true, heardAt?: number): TranscriptClip =>
  ({ data: new Blob([speechWav(words, ms, language, sure)], { type: 'audio/wav' }), segment, startMs, durationMs: ms, ...(heardAt === undefined ? {} : { heardAt }) });
async function waitFor(pred: () => boolean, what: string, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
/** Refreshes until the call's state matches (other people's changes arrive by refetching). */
async function settle(call: CallSession, pred: (s: CallState) => boolean): Promise<CallState> {
  for (let i = 0; i < 100 && !pred(call.getSnapshot()); i++) { await call.refresh(); await new Promise((r) => setTimeout(r, 30)); }
  return call.getSnapshot();
}
/** In the call's MLS group: let in, and holding the group's keys. */
const inGroup = (call: CallSession) => waitFor(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
/** The organizer lets someone in who asked. */
async function letIn(host: CallSession, who: CallSession) {
  await settle(host, (s) => s.waiting.some((w) => w.id === who.ticket.identity));
  await host.admit(who.ticket.identity);
  await inGroup(who);
}
/** The latest epoch's keys as this browser holds them (one per member), to compare across browsers. */
const latestKeys = (call: CallSession) => call.crypto.getSnapshot().media?.epochs.at(-1)?.keys ?? {};
const keyOf = (call: CallSession) => JSON.stringify(Object.entries(latestKeys(call)).sort(([a], [b]) => a.localeCompare(b)).map(([id, k]) => [id, Buffer.from(k).toString('hex')]));
const senderKey = (call: CallSession, sender: string) => Buffer.from(latestKeys(call)[sender] ?? []).toString('hex');
const sendIndex = (call: CallSession) => call.crypto.getSnapshot().media?.send?.index;
/** Sending with its key for the latest epoch: a moment after every change (so everyone has the new keys first). */
const onLatestKey = (call: CallSession) => waitFor(() => sendIndex(call) !== undefined && sendIndex(call) === call.crypto.getSnapshot().media?.epochs.at(-1)?.index, `${call.ticket.role} sending with its new key`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** For a browser that rarely checks on its own: has it read the log until `pred` holds. */
async function readLog(call: CallSession, pred: () => boolean, what: string) {
  for (let i = 0; i < 100 && !pred(); i++) { await call.refresh({ call: false, log: true }); await sleep(30); }
  if (!pred()) throw new Error(`timed out waiting for ${what}`);
}
/** A request about a call with someone's pass, as their browser would send one, carrying whatever the test wants. */
const asMember = (call: CallSession, method: 'GET' | 'POST', path: string, body?: unknown) => fetch(`${h.baseUrl}/v1/live/calls/${call.ticket.callId}${path}`, {
  method, headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-alcove-call': call.ticket.pass }, ...(body === undefined ? {} : { body: JSON.stringify(body) })
});
const chatOf = (call: CallSession) => call.crypto.getSnapshot().chat.map((m) => m.text);
const encodings = (s: string) => [s, Buffer.from(s).toString('hex'), Buffer.from(s).toString('base64').slice(0, 12), Buffer.from(s).toString('base64url').slice(0, 12)];
async function expectNotInRows(tables: string[], canaries: string[]) {
  const dump = await h.pool.query(`SELECT string_agg(t, ' ') AS all FROM (${tables.map((t) => `SELECT row_to_json(x)::text AS t FROM ${t} x`).join(' UNION ALL ')}) q`);
  const text = String(dump.rows[0]?.all ?? '');
  for (const canary of canaries) for (const enc of encodings(canary)) expect(text.includes(enc), `${canary} as ${enc}`).toBe(false);
}

/** Rooms a test connected; disconnected after each test so rooms empty out. */
const open: TestParticipant[] = [];
/**
 * Connects to the call's room the way a browser does: once let in, with its token, encrypting what it sends with
 * its own send key. To hear someone, a test participant holds its own key for that sender instead (rtc-node holds one).
 */
async function joinRoom(call: CallSession, hearing?: CallSession): Promise<TestParticipant> {
  await inGroup(call);
  const p = await connect(await call.room(), hearing ? { hearing: call.crypto, from: hearing.ticket.identity, senderSends: hearing.crypto } : { sending: call.crypto });
  open.push(p);
  return p;
}
afterEach(async () => { await Promise.all(open.splice(0).map((p) => p.disconnect().catch(() => undefined))); h.closeCalls(); });

describe('calls on LiveKit', () => {
  it('reports LiveKit reachable in the health check', async () => {
    expect(await (await fetch(`${h.baseUrl}/health`)).json()).toMatchObject({ livekit: 'reachable' });
  });
});

describe('end-to-end encryption', () => {
  it('makes the call’s keys in the browsers: everyone in it holds the same media key, and the server never sees it', async () => {
    const org = await account();
    const invitedEmail = unique('invited');
    const { code: c } = await org.api.calls.startNow({ guests: [invitedEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    // Invited people are let in by the organizer's browser without anyone asking; anyone else asks.
    const inv = await (await account(invitedEmail)).api.calls.join(c, { mic: true, cam: false });
    await inGroup(inv);
    const guest = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    expect(guest.crypto.getSnapshot().status).toBe('waiting');
    await letIn(host, guest);
    await waitFor(() => keyOf(host) === keyOf(guest) && keyOf(inv) === keyOf(host), 'everyone on the same key');

    const members = [host.ticket.identity, inv.ticket.identity, guest.ticket.identity].sort();
    for (const call of [host, inv, guest]) expect([...call.crypto.getSnapshot().members].sort()).toEqual(members);
    // One key per sender, so no two senders ever encrypt with the same key.
    const keys = members.map((id) => senderKey(host, id));
    expect(keys.every((k) => k.length === 64)).toBe(true);
    expect(new Set(keys).size).toBe(3);
    // Not in any row, log line, or anywhere the API keeps things: only the browsers ever had them.
    for (const key of keys) {
      await expectNotInRows(['calls', 'call_mls', 'call_codes'], [key.slice(0, 24)]);
      const logs = h.logs.join('');
      for (const enc of [key.slice(0, 24), Buffer.from(key, 'hex').toString('base64url').slice(0, 16)]) expect(logs.includes(enc)).toBe(false);
    }
    await host.leave();
  });

  it('keeps chat between the people in the call: unreadable to the server, and to anyone who joins later', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const guest = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, guest);

    await guest.sendChat('CANARY-CHAT hi');
    await host.sendChat('CANARY-REPLY hello');
    await waitFor(() => chatOf(host).length === 2 && chatOf(guest).length === 2, 'chat both ways');
    expect(host.crypto.getSnapshot().chat).toEqual([
      expect.objectContaining({ text: 'CANARY-CHAT hi', isMe: false, from: guest.ticket.identity }),
      expect.objectContaining({ text: 'CANARY-REPLY hello', isMe: true, from: host.ticket.identity })
    ]);
    await expectNotInRows(['calls', 'call_mls'], ['CANARY-CHAT', 'CANARY-REPLY']);
    expect(h.logs.join('').includes('CANARY-CHAT')).toBe(false);

    // Someone let in later gets the keys from then on: earlier chat is there but can't be read.
    const late = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Lee' });
    await letIn(host, late);
    await waitFor(() => late.crypto.getSnapshot().missedChat, 'the late joiner told about earlier chat');
    expect(chatOf(late)).toEqual([]);
    await guest.sendChat('after Lee joined');
    await waitFor(() => chatOf(late).includes('after Lee joined'), 'new chat for the late joiner');
    await host.leave();
  });

  it('keeps media from anyone without the call’s key, LiveKit included', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const hostRoom = await joinRoom(host);
    const guest = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, guest);
    await waitFor(() => keyOf(host) === keyOf(guest), 'the same keys');
    const guestRoom = await joinRoom(guest, host);
    await hostRoom.publishTone();
    // Someone just let in hears the others once they've moved to the new keys (a moment after letting them in).
    await onLatestKey(host);
    expect(await guestRoom.meanLevelFrom(host.ticket.identity)).toBeGreaterThan(3000);

    // LiveKit holds the API key, so it could put someone in the room; without the MLS group's keys it gets nothing it can decode.
    const index = sendIndex(host) ?? 0;
    const listen = async (identity: string, key: Uint8Array) => {
      const p = await connect({ serverUrl: host.ticket.serverUrl, token: await tokenDirectly(h.deps.cfg, host.ticket.roomName, identity), identity }, { key, index });
      open.push(p);
      return p.meanLevelFrom(host.ticket.identity);
    };
    expect(await listen('p_outsideroutsideroutsid', randomBytes(32))).toBeLessThan(300);
    // And each sender has its own key: the guest's key doesn't open the organizer's frames.
    expect(await listen('p_wrongsenderwrongsender', latestKeys(host)[guest.ticket.identity] ?? randomBytes(32))).toBeLessThan(300);
    await host.leave();
  });

  it('moves the keys on when someone leaves or is removed, so they can’t follow what comes after', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    const lee = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Lee' });
    await letIn(host, lee);
    await waitFor(() => keyOf(sam) === keyOf(host) && keyOf(lee) === keyOf(host), 'one key');
    const before = keyOf(host);

    await host.remove(sam.ticket.identity);
    await waitFor(() => !host.crypto.getSnapshot().members.includes(sam.ticket.identity), 'Sam out of the group');
    await waitFor(() => keyOf(lee) === keyOf(host) && keyOf(host) !== before, 'a new key without Sam');
    expect(keyOf(sam)).toBe(before);
    await host.sendChat('only for those still here');
    await waitFor(() => chatOf(lee).includes('only for those still here'), 'Lee reads it');
    expect(chatOf(sam)).not.toContain('only for those still here');

    // Leaving moves them on too.
    const afterSam = keyOf(host);
    await lee.leave();
    await waitFor(() => !host.crypto.getSnapshot().members.includes(lee.ticket.identity) && keyOf(host) !== afterSam, 'a new key without Lee');
    await host.leave();
  });

  it('lets only the organizer’s browser let people in, and gives nobody waiting or turned away a room', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    await host.transcribe(speech('CANARY-SAID something private.', 0, 0), host.ticket.identity);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });

    // Waiting: the organizer sees who's asking; Sam sees only what's captured, and gets no room and nothing said.
    expect((await settle(host, (s) => s.waiting.length === 1)).waiting).toEqual([expect.objectContaining({ id: sam.ticket.identity, person: expect.objectContaining({ name: 'Sam' }) })]);
    expect(sam.getSnapshot()).toMatchObject({ participants: [], transcript: [], waiting: [], capture: { mode: 'on', gaps: [], requests: [] } });
    expect(code(await sam.room().catch((e: unknown) => e))).toBe('forbidden');
    for (const attempt of [() => sam.catchUp(), () => sam.askSoFar('What was said?'), () => sam.sendChat('hello?')]) {
      const e = await attempt().catch((x: unknown) => x);
      if (e !== undefined) expect(code(e)).toBe('forbidden');
    }
    // Nobody but the organizer's current connection can commit to the group or turn anyone away.
    const r = await fetch(`${h.baseUrl}/v1/live/calls/${sam.ticket.callId}/mls/commits`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-alcove-call': sam.ticket.pass },
      body: JSON.stringify({ generation: 0, epoch: 0, commit: 'AAAA', added: [], removed: [] })
    });
    expect(r.status).toBe(403);
    expect(code(await sam.deny(sam.ticket.identity).catch((e: unknown) => e))).toBe('forbidden');

    // Turned away: they stay out.
    await host.deny(sam.ticket.identity);
    await waitFor(() => sam.crypto.getSnapshot().status === 'denied', 'Sam turned away');
    expect(code(await sam.room().catch((e: unknown) => e))).toBe('forbidden');
    expect((await settle(host, (s) => s.waiting.length === 0)).waiting).toEqual([]);
    await host.leave();
  });

  it('lets someone back in without asking when they come back from a reload', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const browser = guestBrowser();
    const first = await browser.calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, first);
    // The page reloads: it closes (telling the server this connection has gone), and a new connection comes with the
    // pass of the old one.
    first.closing();
    const again = await browser.calls.join(c, { mic: true, cam: false, name: 'Sam', previous: first.ticket.pass });
    await inGroup(again);
    await waitFor(() => !host.crypto.getSnapshot().members.includes(first.ticket.identity), 'the old connection out of the group');
    expect(host.crypto.getSnapshot().members).toContain(again.ticket.identity);
    expect((await settle(host, (s) => s.participants.length === 2)).participants.map((p) => p.id).sort()).toEqual([host.ticket.identity, again.ticket.identity].sort());
    await host.leave();
  });

  it('keeps the call going when the organizer’s page closes, so a reload comes back to it', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    host.closing();
    await new Promise((r) => setTimeout(r, 500));
    expect(await callState(host.ticket.callId)).toBe('live');
    const back = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(back);
    expect(back.ticket.callId).toBe(host.ticket.callId);
    await back.leave();
  });

  it('keeps everyone in their seat when they come back, so each viewer’s own layout keeps them in place', async () => {
    const org = await account();
    const invitedEmail = unique('invited');
    const { code: c } = await org.api.calls.startNow({ guests: [invitedEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const invited = await account(invitedEmail);
    const inv = await invited.api.calls.join(c, { mic: true, cam: false });
    await inGroup(inv);
    const samsBrowser = guestBrowser();
    const sam = await samsBrowser.calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    const kimsBrowser = guestBrowser();
    const kim = await kimsBrowser.calls.join(c, { mic: true, cam: false, name: 'Kim' });
    await letIn(host, kim);
    const seats = (s: CallState) => Object.fromEntries(s.participants.map((p) => [p.id, p.seat]));
    const has = (s: CallState, ...ids: string[]) => ids.every((id) => s.participants.some((p) => p.id === id));
    // Everyone sees the same seats, one each: the organizer, someone invited and a guest agree. They're random:
    // nothing like a name or an address.
    const byKim = seats(await settle(kim, (s) => s.participants.length === 4));
    expect(seats(await settle(host, (s) => s.participants.length === 4))).toEqual(byKim);
    expect(seats(await settle(inv, (s) => s.participants.length === 4))).toEqual(byKim);
    expect(new Set(Object.values(byKim)).size).toBe(4);
    for (const seat of Object.values(byKim)) expect(seat).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const seatOf = (call: CallSession) => byKim[call.ticket.identity];
    // Sam's page reloads: a new connection, in the same seat.
    sam.closing();
    const samAgain = await samsBrowser.calls.join(c, { mic: true, cam: false, name: 'Sam', previous: sam.ticket.pass });
    await inGroup(samAgain);
    const reloaded = await settle(kim, (s) => has(s, samAgain.ticket.identity) && !has(s, sam.ticket.identity));
    expect(samAgain.ticket.identity).not.toBe(sam.ticket.identity);
    expect(seats(reloaded)[samAgain.ticket.identity]).toBe(seatOf(sam));
    // Kim's own page reloads: she still sees everyone where they were, herself included.
    kim.closing();
    const kimAgain = await kimsBrowser.calls.join(c, { mic: true, cam: false, name: 'Kim', previous: kim.ticket.pass });
    await inGroup(kimAgain);
    const kimSees = seats(await settle(kimAgain, (s) => has(s, kimAgain.ticket.identity, samAgain.ticket.identity, host.ticket.identity, inv.ticket.identity)));
    expect(kimSees[host.ticket.identity]).toBe(seatOf(host));
    expect(kimSees[inv.ticket.identity]).toBe(seatOf(inv));
    expect(kimSees[samAgain.ticket.identity]).toBe(seatOf(sam));
    expect(kimSees[kimAgain.ticket.identity]).toBe(seatOf(kim));
    // The organizer comes in from another device: still the organizer's seat.
    const phone = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(phone);
    const moved = await settle(kimAgain, (s) => has(s, phone.ticket.identity) && !has(s, host.ticket.identity));
    expect(seats(moved)[phone.ticket.identity]).toBe(seatOf(host));
    // Someone new sits somewhere new.
    const lee = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Lee' });
    await letIn(phone, lee);
    expect(new Set(Object.values(seats(await settle(kimAgain, (s) => s.participants.length === 5)))).size).toBe(5);
    // In another call the organizer and the invited person both sit elsewhere.
    const other = await org.api.calls.startNow({ guests: [invitedEmail] });
    const elsewhere = await org.api.calls.join(other.code, { mic: true, cam: false });
    await inGroup(elsewhere);
    const invElsewhere = await invited.api.calls.join(other.code, { mic: true, cam: false });
    await inGroup(invElsewhere);
    const there = seats(await settle(elsewhere, (s) => s.participants.length === 2));
    expect(there[elsewhere.ticket.identity]).toBeTruthy();
    expect(there[elsewhere.ticket.identity]).not.toBe(seatOf(host));
    expect(there[invElsewhere.ticket.identity]).toBeTruthy();
    expect(there[invElsewhere.ticket.identity]).not.toBe(seatOf(inv));
    await elsewhere.leave();
    await phone.leave();
  });

  it('starts a new group when the organizer’s connection changes, and everyone already in rejoins it', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const laptop = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(laptop);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(laptop, sam);
    const oldKey = keyOf(sam);

    const phone = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(phone);
    expect(phone.getSnapshot().generation).toBe(1);
    // Sam's browser rejoins the phone's group by itself: no asking again.
    await waitFor(() => phone.crypto.getSnapshot().members.includes(sam.ticket.identity) && keyOf(sam) === keyOf(phone), 'Sam in the new group');
    expect(keyOf(sam)).not.toBe(oldKey);
    expect(code(await laptop.lock(true).catch((e: unknown) => e))).toBe('forbidden');
    await phone.leave();
  });

  it('never tells LiveKit anyone’s name', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const hostRoom = await joinRoom(host);
    const guest = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'CANARY-NAME Ada' });
    await letIn(host, guest);
    await joinRoom(guest);
    await hostRoom.waitFor(() => hostRoom.remoteIdentities().includes(guest.ticket.identity), 'the guest in the room');
    const known = await participantsDirectly(h.deps.cfg, host.ticket.roomName);
    expect(known.map((p) => p.identity).sort()).toEqual([host.ticket.identity, guest.ticket.identity].sort());
    expect(known.map((p) => `${p.name}${p.metadata}`)).toEqual(['', '']);
    expect(hostRoom.room.remoteParticipants.get(guest.ticket.identity)?.name ?? '').toBe('');
    await host.leave();
  });
});

describe('breakout rooms, each with its own keys', () => {
  /** A call with the organizer and invited people (each with an account), everyone in the main room's group. */
  async function roomsCall(names: string[], o: { notes?: 'on' | 'off' } = {}) {
    const org = await account();
    const emails = names.map((n) => unique(n.toLowerCase()));
    const { code: c } = await org.api.calls.startNow({ guests: emails, ...(o.notes ? { notes: o.notes } : {}) });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const people: { email: string; call: CallSession; browser: Awaited<ReturnType<typeof account>> }[] = [];
    for (const email of emails) {
      const browser = await account(email);
      const call = await browser.api.calls.join(c, { mic: true, cam: false });
      await inGroup(call);
      people.push({ email, call, browser });
    }
    return { org, host, code: c, people };
  }
  /** An action as the organizer's browser sends it: its pass together with its own session. */
  const asOrganizer = (org: Awaited<ReturnType<typeof account>>, host: CallSession, body: unknown) => org.fetch(`${h.baseUrl}/v1/live/calls/${host.ticket.callId}/actions`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-alcove-call': host.ticket.pass }, body: JSON.stringify(body)
  });
  /** Any request as the organizer's browser sends it: its pass together with its own session. */
  const asOrganizerAt = (org: Awaited<ReturnType<typeof account>>, host: CallSession, method: 'GET' | 'POST', path: string, body?: unknown) => org.fetch(`${h.baseUrl}/v1/live/calls/${host.ticket.callId}${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-alcove-call': host.ticket.pass }, ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  /** In the group of a part of the call (the main room, or a room), holding its keys. */
  const inPlace = (call: CallSession, place: string) => waitFor(() => {
    const s = call.crypto.getSnapshot();
    return s.status === 'in' && s.place === place && Boolean(s.media?.send);
  }, `${call.ticket.role} in ${place === 'main' ? 'the main room' : 'a room'}`);
  const roomIds = async (host: CallSession) => (await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms.map((r) => r.id) ?? [];
  const members = (call: CallSession) => [...call.crypto.getSnapshot().members].sort();
  const hex = (k: Uint8Array | undefined) => Buffer.from(k ?? []).toString('hex');
  /** Chat that's in the log, not only on its sender's screen. */
  const logged = (call: CallSession, text: string) => waitFor(() => call.crypto.getSnapshot().chat.some((m) => m.text === text && !m.id.startsWith('me:')), `“${text}” in the log`);
  /** Listens to `sender` with one key at one index, as someone LiveKit (which holds the API key) let into the room. */
  const listen = async (call: CallSession, sender: string, key: Uint8Array, index: number) => {
    const identity = `p_${randomBytes(16).toString('base64url')}`;
    const p = await connect({ serverUrl: call.ticket.serverUrl, token: await tokenDirectly(h.deps.cfg, call.ticket.roomName, identity), identity }, { key, index });
    open.push(p);
    return p.meanLevelFrom(sender);
  };

  it('gives each room its own keys: nobody in one room can read or hear another, LiveKit included', async () => {
    const { host, code: c, people: [kofi, lena] } = await roomsCall(['Kofi', 'Lena']);
    if (!kofi || !lena) throw new Error('two people expected');
    const guest = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, guest);
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofi.email] }, { name: 'Support', emails: [lena.email] }], minutes: 10 });
    const [design = '', support = ''] = await roomIds(host);
    await inPlace(kofi.call, design);
    await inPlace(lena.call, support);
    // Each room's group is its people and the organizer, which commits for every group; the guest stays in the main room's.
    await waitFor(() => members(kofi.call).length === 2 && members(lena.call).length === 2, 'each room’s group');
    expect(members(kofi.call)).toEqual([host.ticket.identity, kofi.call.ticket.identity].sort());
    expect(members(lena.call)).toEqual([host.ticket.identity, lena.call.ticket.identity].sort());
    await waitFor(() => members(guest).length === 2, 'the main room’s group without them');
    expect(members(guest)).toEqual([host.ticket.identity, guest.ticket.identity].sort());
    // No key in common: each part of the call's keys come from its own group, the organizer's included.
    await waitFor(() => keyOf(guest) === keyOf(host), 'the main room on one set of keys');
    const design1 = Object.values(latestKeys(kofi.call)).map(hex);
    for (const k of [...Object.values(latestKeys(lena.call)), ...Object.values(latestKeys(guest))]) expect(design1).not.toContain(hex(k));
    expect(senderKey(kofi.call, host.ticket.identity)).not.toBe(senderKey(lena.call, host.ticket.identity));

    // Chat stays in its room. The organizer, in the main room, doesn't get it either.
    await kofi.call.sendChat('CANARY-DESIGN for Design only');
    await lena.call.sendChat('CANARY-SUPPORT for Support only');
    await guest.sendChat('for the main room');
    await logged(kofi.call, 'CANARY-DESIGN for Design only');
    await logged(lena.call, 'CANARY-SUPPORT for Support only');
    await waitFor(() => chatOf(host).includes('for the main room'), 'the main room’s chat');
    for (const call of [host, guest, lena.call, kofi.call]) await call.refresh();
    expect(chatOf(lena.call)).toEqual(['CANARY-SUPPORT for Support only']);
    expect(chatOf(kofi.call)).toEqual(['CANARY-DESIGN for Design only']);
    expect(chatOf(guest)).toEqual(['for the main room']);
    expect(chatOf(host)).toEqual(['for the main room']);
    // The organizer gets a room's chat only once it's there, and the room sees it come in.
    host.visitRoom(design);
    await inPlace(host, design);
    expect((await settle(kofi.call, (s) => s.breakouts.open?.rooms[0]?.members.includes(host.ticket.identity) === true)).breakouts.open?.rooms[0]?.members).toContain(host.ticket.identity);
    await kofi.call.sendChat('welcome to Design');
    await waitFor(() => chatOf(host).includes('welcome to Design'), 'the organizer in Design’s chat');
    expect(chatOf(host)).not.toContain('CANARY-DESIGN for Design only');
    expect(host.crypto.getSnapshot().chat.find((m) => m.text === 'welcome to Design')?.place).toBe(design);
    await host.sendChat('the organizer, in Design');
    await waitFor(() => chatOf(kofi.call).includes('the organizer, in Design'), 'Design reads the organizer');
    await lena.call.refresh();
    expect(chatOf(lena.call)).not.toContain('the organizer, in Design');
    // A room member can't post into another room's chat, nor anyone into a room they're not in.
    const lenaLog = CallMlsSchema.parse(await (await asMember(lena.call, 'GET', '/mls?after=0')).json());
    expect((await asMember(lena.call, 'POST', '/mls/messages', { generation: lenaLog.generation, group: design, epoch: 1, message: 'AAAA' })).status).toBe(400);
    expect((await asMember(guest, 'POST', '/mls/messages', { generation: lenaLog.generation, group: support, epoch: 1, message: 'AAAA' })).status).toBe(400);
    // Nothing readable reached the server.
    await expectNotInRows(['calls', 'call_mls'], ['CANARY-DESIGN', 'CANARY-SUPPORT']);
    expect(h.logs.join('').includes('CANARY-DESIGN')).toBe(false);

    // Media: the organizer, visiting Design, hears Kofi with Design's keys.
    const kofiRoom = await joinRoom(kofi.call);
    await kofiRoom.publishTone();
    const hostRoom = await joinRoom(host, kofi.call);
    await onLatestKey(kofi.call);
    expect(await hostRoom.meanLevelFrom(kofi.call.ticket.identity)).toBeGreaterThan(3000);
    // Lena holds no key for Kofi: none of hers opens his frames. Neither does a random one, LiveKit's only way in.
    const index = sendIndex(kofi.call) ?? 0;
    for (const key of [...Object.values(latestKeys(lena.call)), randomBytes(32)]) expect(await listen(kofi.call, kofi.call.ticket.identity, key, index)).toBeLessThan(300);
    await host.leave();
  });

  it('moves someone’s keys with them: the old room’s keys move on without them, and they’re in the new room’s', async () => {
    const { org, host, people: [kofi, mia, lena] } = await roomsCall(['Kofi', 'Mia', 'Lena']);
    if (!kofi || !mia || !lena) throw new Error('three people expected');
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofi.email, mia.email] }, { name: 'Support', emails: [lena.email] }], minutes: 10 });
    const [design = '', support = ''] = await roomIds(host);
    await inPlace(kofi.call, design);
    await inPlace(mia.call, design);
    await inPlace(lena.call, support);
    await waitFor(() => members(mia.call).length === 3 && keyOf(kofi.call) === keyOf(mia.call), 'Design on one set of keys');
    const before = latestKeys(kofi.call);
    const held = Object.values(before).map(hex);

    host.moveToRoom(kofi.email, support);
    await inPlace(kofi.call, support);
    await waitFor(() => keyOf(kofi.call) === keyOf(lena.call) && members(lena.call).includes(kofi.call.ticket.identity), 'Kofi on Support’s keys');
    expect(members(kofi.call)).toEqual([host.ticket.identity, kofi.call.ticket.identity, lena.call.ticket.identity].sort());
    // Design moved on without him: nothing Mia holds now is a key Kofi had.
    await waitFor(() => !members(mia.call).includes(kofi.call.ticket.identity) && keyOf(mia.call) !== JSON.stringify(Object.entries(before).sort(([a], [b]) => a.localeCompare(b)).map(([id, k]) => [id, hex(k)])), 'Design’s keys moved on');
    for (const k of Object.values(latestKeys(mia.call))) expect(held).not.toContain(hex(k));
    // Design's chat no longer reaches him; Support's does.
    await mia.call.sendChat('Design, after Kofi left');
    await logged(mia.call, 'Design, after Kofi left');
    await lena.call.sendChat('welcome to Support, Kofi');
    await waitFor(() => chatOf(kofi.call).includes('welcome to Support, Kofi'), 'Support’s chat for Kofi');
    await kofi.call.refresh();
    expect(chatOf(kofi.call)).not.toContain('Design, after Kofi left');
    // Mia keeps talking in Design on its new keys: the key Kofi had for her doesn't open them, hers does.
    const miaRoom = await joinRoom(mia.call);
    await miaRoom.publishTone();
    await onLatestKey(mia.call);
    const index = sendIndex(mia.call) ?? 0;
    const own = mia.call.crypto.getSnapshot().media?.send?.key ?? randomBytes(32);
    expect(await listen(mia.call, mia.call.ticket.identity, before[mia.call.ticket.identity] ?? randomBytes(32), index)).toBeLessThan(300);
    expect(await listen(mia.call, mia.call.ticket.identity, own, index)).toBeGreaterThan(3000);
    // Only people invited can be moved, only into a room this call has open, and only by the organizer.
    expect((await asOrganizer(org, host, { type: 'rooms-move', email: 'stranger@elsewhere.example', roomId: design })).status).toBe(400);
    expect((await asOrganizer(org, host, { type: 'rooms-move', email: mia.email, roomId: 'AAAAAAAAAAAAAAAAAAAAAA' })).status).toBe(400);
    expect((await asOrganizer(org, host, { type: 'rooms-rename', roomId: 'AAAAAAAAAAAAAAAAAAAAAA', name: 'Theirs' })).status).toBe(400);
    expect((await asMember(lena.call, 'POST', '/actions', { type: 'rooms-move', email: lena.email, roomId: design })).status).toBe(403);
    expect((await asMember(lena.call, 'POST', '/actions', { type: 'rooms-rename', roomId: support, name: 'Ours' })).status).toBe(403);
    await host.leave();
  });

  it('brings everyone back on fresh keys when the rooms close, sends a reload straight back to its room, and keeps what’s said in a room in it', async () => {
    const { org, host, code: c, people: [kofi, lena] } = await roomsCall(['Kofi', 'Lena'], { notes: 'on' });
    if (!kofi || !lena) throw new Error('two people expected');
    await host.transcribe(speech('We start together.', 0, 0), host.ticket.identity);
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofi.email] }, { name: 'Support', emails: [lena.email] }], minutes: 10 });
    const [design = '', support = ''] = await roomIds(host);
    await inPlace(kofi.call, design);
    await inPlace(lena.call, support);
    host.renameRoom(design, 'CANARY-ROOMNAME');
    await settle(host, (s) => s.breakouts.open?.rooms[0]?.name === 'CANARY-ROOMNAME');

    // The organizer visits Design: what's said there is Design's alone, in the transcript, captions and catching up.
    host.visitRoom(design);
    await inPlace(host, design);
    const inDesign = performance.now();
    await host.transcribe(speech('CANARY-HEARD only for Design.', 0, 5000), host.ticket.identity);
    const said = (call: CallSession) => call.getSnapshot().transcript.map((l) => l.text);
    await settle(kofi.call, (s) => s.transcript.length > 0);
    expect(said(kofi.call)).toEqual(['CANARY-HEARD only for Design.']);
    expect(said(host)).toEqual(['CANARY-HEARD only for Design.']);
    await lena.call.refresh();
    expect(said(lena.call)).toEqual([]);
    expect(await kofi.call.catchUp()).toMatchObject({ lines: 1 });
    expect(await lena.call.catchUp()).toMatchObject({ lines: 0 });
    // The organizer's last words in Design, begun while it was there and still on their way when it went back, stay in
    // Design: they're placed where it was when it began saying them, not where it is when they arrive.
    host.visitRoom(null);
    await inPlace(host, 'main');
    await host.transcribe(speech('CANARY-HEARD still in Design.', 0, 9000, 4000, 'en', true, inDesign), host.ticket.identity);
    expect(said(host)).toEqual(['We start together.']);
    host.visitRoom(design);
    await inPlace(host, design);
    await settle(host, (s) => s.transcript.length === 2);
    expect(said(host)).toEqual(['CANARY-HEARD only for Design.', 'CANARY-HEARD still in Design.']);
    // While the room is open its lines are kept, sealed: nothing said there, nor its name, is readable in any row.
    const clips = await h.pool.query<{ n: string }>('SELECT count(*)::text AS n FROM transcript_clips WHERE note_item_id = $1', [host.getSnapshot().notes.noteId]);
    expect(Number(clips.rows[0]?.n ?? 0)).toBeGreaterThanOrEqual(3);
    await expectNotInRows(['calls', 'call_mls', 'transcript_clips'], ['CANARY-ROOMNAME', 'CANARY-HEARD']);

    // A reload in Design goes straight back into Design's group, without counting Kofi twice.
    const again = await kofi.browser.api.calls.join(c, { mic: true, cam: false, previous: kofi.call.ticket.pass });
    await inPlace(again, design);
    await waitFor(() => members(host).includes(again.ticket.identity) && !members(host).includes(kofi.call.ticket.identity), 'Kofi in Design once');
    expect(members(host)).toEqual([host.ticket.identity, again.ticket.identity].sort());
    const s = await settle(host, (x) => x.participants.filter((p) => p.person.email === kofi.email).length === 1 && x.breakouts.open?.rooms[0]?.members.includes(again.ticket.identity) === true);
    expect(s.breakouts.open?.rooms[0]?.members.sort()).toEqual([host.ticket.identity, again.ticket.identity].sort());

    // The rooms close: everyone back in the main room's group, on keys that are new to all of them.
    const roomKey = latestKeys(again);
    host.closeRooms();
    for (const call of [host, again, lena.call]) await inPlace(call, 'main');
    await waitFor(() => members(host).length === 3 && keyOf(again) === keyOf(host) && keyOf(lena.call) === keyOf(host), 'everyone on the main room’s keys');
    expect(members(host)).toEqual([host.ticket.identity, again.ticket.identity, lena.call.ticket.identity].sort());
    for (const k of Object.values(latestKeys(host))) expect(Object.values(roomKey).map(hex)).not.toContain(hex(k));
    // The rooms' MLS logs and what was heard in them are gone; only the main room's lines go on, and into the notes.
    expect((await h.pool.query('SELECT count(*)::int AS n FROM call_mls WHERE call_id = $1 AND grp = ANY($2::text[])', [host.ticket.callId, [design, support]])).rows[0]?.n).toBe(0);
    await settle(host, (x) => x.breakouts.open === null);
    expect(said(host)).toEqual(['We start together.']);
    await expectNotInRows(['calls', 'call_mls', 'transcript_clips'], ['CANARY-ROOMNAME', 'CANARY-HEARD']);
    expect(h.logs.join('').includes('CANARY-ROOMNAME') || h.logs.join('').includes('CANARY-HEARD')).toBe(false);
    // Once the rooms are closed there's nothing to commit to in them.
    expect((await asOrganizer(org, host, { type: 'rooms-rename', roomId: design, name: 'Late' })).status).toBe(409);
    const end = await host.leave();
    const noteId = end?.pendingNoteId ?? '';
    await written(org.api, noteId);
    expect((await org.api.notes.get(noteId)).transcript?.map((l) => l.text)).toEqual(['We start together.']);
  });

  it('gives each room its own capture: a room the organizer pauses takes nothing, the rest of the call carries on, and only that room is told', async () => {
    const { host, people: [kofi, lena] } = await roomsCall(['Kofi', 'Lena'], { notes: 'on' });
    if (!kofi || !lena) throw new Error('two people');
    await settle(host, (x) => x.capture.mode === 'on');
    await host.appendAudio(piece(audioBytes('rooms'), 0, 0));
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofi.email] }, { name: 'Support', emails: [lena.email] }], minutes: 10 });
    const [design = '', support = ''] = await roomIds(host);
    await inPlace(kofi.call, design);
    await inPlace(lena.call, support);
    // Each room says what's captured in it, beside the call's own: on, like the call, and never recorded.
    const opened = await settle(kofi.call, (x) => x.capture.room?.id === design);
    expect(opened.capture.mode).toBe('on');
    expect(opened.capture.room).toMatchObject({ mode: 'on', recording: { mode: 'off' }, transcript: { mode: 'on', by: { kind: 'schedule' } }, gaps: [] });
    expect(host.getSnapshot().capture.room).toBeNull();

    // The organizer pauses Design from inside it: Design is told and shows it, Support and the call's notes carry on.
    host.visitRoom(design);
    await inPlace(host, design);
    await host.pauseRoom(design, true);
    const paused = await settle(kofi.call, (x) => x.capture.room?.mode === 'paused');
    expect(paused.capture.mode).toBe('on');
    expect(paused.capture.room?.transcript).toMatchObject({ mode: 'paused', by: { kind: 'organizer' } });
    expect(paused.capture.room?.recording.mode).toBe('off');
    expect(paused.notices.map((n) => n.text)).toContain('The organizer paused notes in this room. Nothing said here is transcribed or sent to the AI until they resume.');
    expect(host.getSnapshot().breakouts.open?.rooms.map((r) => r.paused)).toEqual([true, false]);
    await lena.call.refresh();
    expect(lena.call.getSnapshot().capture.room).toMatchObject({ id: support, mode: 'on' });
    expect(lena.call.getSnapshot().notices.some((n) => n.text.includes('in this room'))).toBe(false);
    // Nothing said in Design is taken: its speech, captions, catching up and questions are refused, whoever sends them.
    const refused = await host.transcribe(speech('CANARY-PAUSED said in Design.', 0, 3000), kofi.call.ticket.identity).catch((e: unknown) => e);
    expect(code(refused)).toBe('conflict');
    expect(refused instanceof Error ? refused.message : '').toContain('paused in this room');
    expect(code(await kofi.call.catchUp().catch((e: unknown) => e))).toBe('conflict');
    expect(code(await kofi.call.askSoFar('What did we decide?').catch((e: unknown) => e))).toBe('conflict');
    expect(code(await kofi.call.translate(['x'], 'fr').catch((e: unknown) => e))).toBe('conflict');
    // Support's is, and the recording goes on: the call's notes are still on.
    await host.transcribe(speech('Support is going fine.', 0, 3000), lena.call.ticket.identity);
    await settle(lena.call, (x) => x.transcript.some((l) => l.text === 'Support is going fine.'));
    await host.appendAudio(piece(audioBytes('rooms'), 0, 1));
    // Only the organizer pauses a room, and only a room of this call that's open.
    expect(code(await kofi.call.pauseRoom(design, false).catch((e: unknown) => e))).toBe('forbidden');
    expect(code(await host.pauseRoom('not-a-room', true).catch((e: unknown) => e))).toBe('invalid');

    // Carrying on in Design: it's taken again, the room is told, and the pause shows as a gap in its transcript.
    await host.pauseRoom(design, false);
    const resumed = await settle(kofi.call, (x) => x.capture.room?.mode === 'on');
    expect(resumed.notices.map((n) => n.text)).toContain('The organizer resumed notes in this room. Everyone here can see that.');
    expect(resumed.capture.room?.gaps.map((g) => ({ kind: g.kind, open: g.to === null }))).toEqual([{ kind: 'paused', open: false }]);
    await host.transcribe(speech('Design again.', 0, 6000), kofi.call.ticket.identity);
    const again = await settle(kofi.call, (x) => x.transcript.some((l) => l.text === 'Design again.'));
    expect(again.transcript.map((l) => l.text)).not.toContain('CANARY-PAUSED said in Design.');

    // Pausing the whole call holds every room, and a room can't be paused on its own meanwhile. Resuming the call
    // carries on in Support, but not in Design, which was paused on its own first.
    await host.pauseRoom(design, true);
    await host.pause();
    expect((await settle(lena.call, (x) => x.capture.room?.mode === 'paused')).capture.mode).toBe('paused');
    await settle(kofi.call, (x) => x.capture.mode === 'paused');
    expect(code(await host.transcribe(speech('Support while paused.', 0, 9000), lena.call.ticket.identity).catch((e: unknown) => e))).toBe('conflict');
    expect(code(await host.pauseRoom(support, true).catch((e: unknown) => e))).toBe('conflict');
    // Capture times are kept in tenths of a second, and a pause that ends in the tenth it began leaves no gap: let this
    // one last long enough to measure, or a fast run resumes in the same tenth and Support has nothing to show.
    await new Promise((r) => setTimeout(r, 300));
    await host.resume();
    const support2 = await settle(lena.call, (x) => x.capture.mode === 'on' && x.capture.room?.mode === 'on');
    expect(support2.capture.room?.gaps.map((g) => g.to === null)).toEqual([false]);
    const design2 = await settle(kofi.call, (x) => x.capture.mode === 'on');
    expect(design2.capture.room?.mode).toBe('paused');
    expect(design2.capture.room?.gaps.map((g) => g.to === null)).toEqual([false, true]);

    // Closing the rooms takes their capture with them: everyone is back under the call's.
    host.closeRooms();
    const back = await settle(kofi.call, (x) => x.breakouts.open === null);
    expect(back.capture.room).toBeNull();
    expect(back.capture.mode).toBe('on');
  });

  it('adds someone sent to another room even when their key package for it arrives before the organizer’s browser takes them out of the old one', async () => {
    // The organizer's browser reads the log only when told to here, so the test decides what it finds there first.
    const org = await account(unique(), { callPollMs: 600_000 });
    const kofiEmail = unique('kofi');
    const { code: c } = await org.api.calls.startNow({ guests: [kofiEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const kofi = await (await account(kofiEmail)).api.calls.join(c, { mic: true, cam: false });
    const steer = async (pred: () => boolean, what: string) => {
      for (const until = Date.now() + 15_000; !pred(); await sleep(25)) {
        if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
        await host.refresh();
      }
    };
    const settled = (place: string) => () => { const k = kofi.crypto.getSnapshot(); return k.status === 'in' && k.place === place && Boolean(k.media?.send); };
    await steer(settled('main'), 'Kofi in the main room');
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofiEmail] }, { name: 'Support', emails: [] }], minutes: 5 });
    const [design = '', support = ''] = await roomIds(host);
    await steer(settled(design), 'Kofi in Design');

    // Kofi is sent to Support. His browser sends its key package for Support's group at once, while the organizer's
    // browser hasn't yet read that he's going, let alone taken him out of Design's group.
    const packages = async () => Number((await h.pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM call_mls WHERE call_id = $1 AND kind = 'keypackage' AND party = $2`, [host.ticket.callId, kofi.ticket.identity])).rows[0]?.n ?? 0);
    const before = await packages();
    expect((await asOrganizer(org, host, { type: 'rooms-move', email: kofiEmail, roomId: support })).status).toBe(200);
    for (const until = Date.now() + 15_000; (await packages()) === before; await sleep(25)) if (Date.now() > until) throw new Error('timed out waiting for Kofi’s key package');
    const log = CallMlsSchema.parse(await (await asOrganizerAt(org, host, 'GET', '/mls?after=0')).json());
    expect(log.groups.find((g) => g.id === design)?.departed).toEqual([kofi.ticket.identity]);
    expect(log.groups.find((g) => g.id === support)?.pending).toEqual([]);
    // Then the organizer's browser catches up: Kofi out of Design's group, and into Support's with the key package that came first.
    await steer(settled(support), 'Kofi in Support');
    const now = CallMlsSchema.parse(await (await asOrganizerAt(org, host, 'GET', '/mls?after=0')).json());
    expect(now.groups.filter((g) => g.pending.length > 0 || g.departed.length > 0)).toEqual([]);
    await host.leave();
  });

  it('refuses another call’s rooms wherever a room is named, and commits that add someone from another room or go to a closed one', async () => {
    const a = await roomsCall(['Kofi', 'Lena'], { notes: 'on' });
    const b = await roomsCall(['Maya']);
    const [kofi, lena] = a.people;
    const [maya] = b.people;
    if (!kofi || !lena || !maya) throw new Error('three people');
    a.host.openRooms({ rooms: [{ name: 'Design', emails: [kofi.email] }, { name: 'Support', emails: [lena.email] }], minutes: 5 });
    b.host.openRooms({ rooms: [{ name: 'Theirs', emails: [maya.email] }, { name: 'Other', emails: [] }], minutes: 5 });
    const [design = '', support = ''] = await roomIds(a.host);
    const [theirs = ''] = await roomIds(b.host);
    await inPlace(kofi.call, design);
    await inPlace(lena.call, support);
    await inPlace(maya.call, theirs);
    // Every room action naming the other call's room, a real one, is refused, and changes nothing there.
    for (const body of [
      { type: 'rooms-move', email: kofi.email, roomId: theirs }, { type: 'rooms-rename', roomId: theirs, name: 'Mine now' },
      { type: 'rooms-visit', roomId: theirs }, { type: 'rooms-pause', roomId: theirs, paused: true }
    ]) expect((await asOrganizer(a.org, a.host, body)).status).toBe(400);
    await b.host.refresh();
    expect(b.host.getSnapshot().breakouts.open?.rooms.map((r) => ({ name: r.name, paused: r.paused, members: r.members }))).toEqual([{ name: 'Theirs', paused: false, members: [maya.call.ticket.identity] }, { name: 'Other', paused: false, members: [] }]);
    // Nor does anything go into its group from this call: no commit, no chat.
    const log = CallMlsSchema.parse(await (await asOrganizerAt(a.org, a.host, 'GET', '/mls?after=0')).json());
    const commit = (group: string, added: string[]) => asOrganizerAt(a.org, a.host, 'POST', '/mls/commits', {
      generation: log.generation, group, epoch: log.groups.find((g) => g.id === group)?.epoch ?? 1, commit: 'AAAA', ...(added.length ? { welcome: 'AAAA' } : {}), added, removed: []
    });
    expect((await commit(theirs, [])).status).toBe(409);
    expect((await asMember(kofi.call, 'POST', '/mls/messages', { generation: log.generation, group: theirs, epoch: 1, message: 'AAAA' })).status).toBe(400);
    // Speech from someone in the other call is nobody's in this one.
    expect(code(await a.host.transcribe(speech('Not from this call.', 0, 0), maya.call.ticket.identity).catch((e: unknown) => e))).toBe('invalid');
    // In this call, a commit adding someone who is in another room's group is refused: Kofi isn't waiting for Support's.
    expect((await commit(support, [kofi.call.ticket.identity])).status).toBe(400);
    await kofi.call.refresh();
    expect(kofi.call.crypto.getSnapshot().place).toBe(design);
    // And once the rooms close, a commit for one of them is refused: its group went with it.
    a.host.closeRooms();
    await inPlace(kofi.call, 'main');
    const after = CallMlsSchema.parse(await (await asOrganizerAt(a.org, a.host, 'GET', '/mls?after=0')).json());
    expect((await asOrganizerAt(a.org, a.host, 'POST', '/mls/commits', { generation: after.generation, group: design, epoch: 1, commit: 'AAAA', added: [], removed: [] })).status).toBe(409);
    await a.host.leave();
    await b.host.leave();
  });

  it('keeps the rooms when the organizer reconnects: everyone rejoins their own room on new keys, the organizer is back where it was, and earlier chat stays behind', async () => {
    const { org, host, code: c, people: [kofi, lena] } = await roomsCall(['Kofi', 'Lena'], { notes: 'on' });
    if (!kofi || !lena) throw new Error('two people');
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofi.email] }, { name: 'Support', emails: [lena.email] }], minutes: 10 });
    const [design = '', support = ''] = await roomIds(host);
    await inPlace(kofi.call, design);
    await inPlace(lena.call, support);
    host.visitRoom(design);
    await inPlace(host, design);
    await kofi.call.sendChat('CANARY-EARLIER in Design');
    await logged(host, 'CANARY-EARLIER in Design');
    await host.transcribe(speech('Design, before the reload.', 0, 2000), kofi.call.ticket.identity);
    const kofiKey = senderKey(kofi.call, kofi.call.ticket.identity);
    const lenaKey = senderKey(lena.call, lena.call.ticket.identity);

    // The organizer's page reloads: a new connection, so new groups for every part of the call.
    const again = await org.api.calls.join(c, { mic: true, cam: false });
    await inPlace(again, design);
    await waitFor(() => members(kofi.call).includes(again.ticket.identity) && !members(kofi.call).includes(host.ticket.identity), 'Kofi in Design’s new group');
    await waitFor(() => members(lena.call).includes(again.ticket.identity) && !members(lena.call).includes(host.ticket.identity), 'Lena in Support’s new group');
    await inPlace(kofi.call, design);
    await inPlace(lena.call, support);
    expect(members(kofi.call)).toEqual([again.ticket.identity, kofi.call.ticket.identity].sort());
    expect(members(lena.call)).toEqual([again.ticket.identity, lena.call.ticket.identity].sort());
    expect(senderKey(kofi.call, kofi.call.ticket.identity)).not.toBe(kofiKey);
    expect(senderKey(lena.call, lena.call.ticket.identity)).not.toBe(lenaKey);
    // The rooms are as they were, the organizer back in the one it was visiting.
    const s = await settle(again, (x) => x.breakouts.open?.rooms[0]?.members.includes(again.ticket.identity) === true);
    expect(s.breakouts.open?.rooms.map((r) => [...r.members].sort())).toEqual([[again.ticket.identity, kofi.call.ticket.identity].sort(), [lena.call.ticket.identity]]);
    // Chat from before is in no log the new connection can read; what was said in Design is still Design's alone.
    expect(chatOf(again)).not.toContain('CANARY-EARLIER in Design');
    expect(Number((await h.pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM call_mls WHERE call_id = $1 AND generation = 0 AND kind <> 'keypackage'`, [host.ticket.callId])).rows[0]?.n ?? -1)).toBe(0);
    expect((await settle(again, (x) => x.transcript.length === 1)).transcript.map((l) => l.text)).toEqual(['Design, before the reload.']);
    await lena.call.refresh();
    expect(lena.call.getSnapshot().transcript).toEqual([]);
    // Chat after the reload reaches Design, and only Design.
    await again.sendChat('after the reload, in Design');
    await waitFor(() => chatOf(kofi.call).includes('after the reload, in Design'), 'Design reads the organizer again');
    await lena.call.refresh();
    expect(chatOf(lena.call)).not.toContain('after the reload, in Design');
    await again.leave();
  });

  it('closes rooms whose time is up whether or not anyone says so, and brings everyone back on new keys', async () => {
    const { host, people: [kofi, lena] } = await roomsCall(['Kofi', 'Lena']);
    if (!kofi || !lena) throw new Error('two people');
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofi.email] }, { name: 'Support', emails: [lena.email] }], minutes: 1 });
    const [design = '', support = ''] = await roomIds(host);
    await inPlace(kofi.call, design);
    await inPlace(lena.call, support);
    await kofi.call.sendChat('CANARY-EXPIRED in Design');
    await logged(kofi.call, 'CANARY-EXPIRED in Design');
    const designKey = senderKey(kofi.call, kofi.call.ticket.identity);
    // The minute is up (the call started a while ago), and nobody closes the rooms: they're closed all the same.
    await h.pool.query(`UPDATE calls SET started_at = started_at - interval '2 minutes' WHERE call_id = $1`, [host.ticket.callId]);
    await inPlace(kofi.call, 'main');
    await inPlace(lena.call, 'main');
    await inPlace(host, 'main');
    await waitFor(() => members(host).length === 3 && keyOf(kofi.call) === keyOf(host) && keyOf(lena.call) === keyOf(host), 'everyone in the main room’s group');
    expect(members(kofi.call)).toEqual([host.ticket.identity, kofi.call.ticket.identity, lena.call.ticket.identity].sort());
    expect(senderKey(kofi.call, kofi.call.ticket.identity)).not.toBe(designKey);
    const s = await settle(host, (x) => x.breakouts.open === null);
    expect(s.breakouts.held.map((h2) => h2.rooms.map((r) => r.name))).toEqual([['Design', 'Support']]);
    // The rooms' log went with them: Design's chat is gone from the server.
    expect(Number((await h.pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM call_mls WHERE call_id = $1 AND grp = ANY($2::text[])`, [host.ticket.callId, [design, support]])).rows[0]?.n ?? -1)).toBe(0);
    await host.leave();
  });
});

describe('keeping in step', () => {
  it('reads past anything in the log it can’t use: junk, replays and mislabelled chat stop nobody', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    await sam.sendChat('a real message');
    await waitFor(() => chatOf(host).includes('a real message'), 'the real message');
    // Anyone in the call can post anything as chat: not an MLS message, a real one again, one claiming an earlier epoch.
    const log = CallMlsSchema.parse(await (await asMember(sam, 'GET', '/mls?after=0')).json());
    const real = log.items.find((i) => i.kind === 'message')?.body ?? '';
    expect(real).not.toBe('');
    const epoch = log.groups.find((g) => g.id === 'main')?.epoch ?? 0;
    for (const junk of [{ epoch, message: 'AAAA' }, { epoch, message: real }, { epoch: 0, message: real }]) {
      expect((await asMember(sam, 'POST', '/mls/messages', { generation: log.generation, group: 'main', ...junk })).status).toBe(200);
    }
    // Everyone carries on: chat, and letting someone else in.
    await host.sendChat('still talking');
    await waitFor(() => chatOf(sam).includes('still talking'), 'chat after the junk');
    const lee = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Lee' });
    await letIn(host, lee);
    await waitFor(() => keyOf(lee) === keyOf(host) && keyOf(sam) === keyOf(host), 'everyone on the new keys');
    expect(chatOf(host).filter((t) => t === 'a real message')).toHaveLength(1);
    for (const call of [host, sam, lee]) expect(call.crypto.getSnapshot().status).toBe('in');
    await host.leave();
  });

  it('gives someone just let in the chat sent straight after, once, and keeps them in step after it', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    const lee = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Lee' });
    await settle(host, (s) => s.waiting.some((w) => w.id === lee.ticket.identity));
    await host.admit(lee.ticket.identity);
    // Sent before Lee's browser has seen its welcome.
    await host.sendChat('welcome, Lee');
    await sam.sendChat('hi Lee');
    await inGroup(lee);
    await waitFor(() => chatOf(lee).includes('welcome, Lee') && chatOf(lee).includes('hi Lee'), 'chat from just after the welcome');
    await sleep(500);
    expect(chatOf(lee).filter((t) => t === 'welcome, Lee')).toHaveLength(1);
    // And everything after: someone leaving moves the keys on for Lee too, and later chat arrives.
    await sam.leave();
    await waitFor(() => !lee.crypto.getSnapshot().members.includes(sam.ticket.identity) && keyOf(lee) === keyOf(host), 'Lee follows Sam leaving');
    await host.sendChat('later');
    await waitFor(() => chatOf(lee).includes('later'), 'later chat');
    expect(lee.crypto.getSnapshot().status).toBe('in');
    await host.leave();
  });

  it('lets people in and keeps everyone in step however long the log gets', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    // Kim's browser checks only when told to.
    const kim = await h.browser({ callPollMs: 600_000 }).api.calls.join(c, { mic: true, cam: false, name: 'Kim' });
    await settle(host, (s) => s.waiting.some((w) => w.id === kim.ticket.identity));
    await host.admit(kim.ticket.identity);
    await readLog(kim, () => kim.crypto.getSnapshot().status === 'in', 'Kim in the group');
    // More chat than the API sends at once.
    for (let i = 0; i < 60; i++) { await host.sendChat(`h${i}`); await sam.sendChat(`s${i}`); }
    // One look reads all of it, a page at a time.
    await kim.refresh({ call: false, log: true });
    expect(chatOf(kim)).toHaveLength(120);
    // Someone let in now reads none of it (they couldn't decrypt it): they're straight in, and told there was chat before.
    const lee = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Lee' });
    await letIn(host, lee);
    await waitFor(() => lee.crypto.getSnapshot().missedChat, 'Lee told about earlier chat');
    expect(chatOf(lee)).toEqual([]);
    await host.sendChat('for Lee too');
    await waitFor(() => chatOf(lee).includes('for Lee too'), 'chat for Lee');
    await host.leave();
  });

  it('doesn’t add anyone who stopped asking or was turned away, and lets the next person in', async () => {
    const refused: string[] = [];
    const onEvent = (e: ClientEvent) => { if (e.msg === 'a commit was refused') refused.push(String(e.context['code'])); };
    const org = await account(unique(), { onEvent });
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    // Sam asks, then gives up; the organizer clicks an old "Let in".
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await settle(host, (s) => s.waiting.some((w) => w.id === sam.ticket.identity));
    await sam.leave();
    await settle(host, (s) => s.waiting.length === 0);
    await host.admit(sam.ticket.identity);
    // Kim asks and is turned away; the organizer clicks an old "Let in".
    const kim = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Kim' });
    await settle(host, (s) => s.waiting.some((w) => w.id === kim.ticket.identity));
    await host.deny(kim.ticket.identity);
    await host.admit(kim.ticket.identity);
    const lee = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Lee' });
    await letIn(host, lee);
    expect([...host.crypto.getSnapshot().members].sort()).toEqual([host.ticket.identity, lee.ticket.identity].sort());
    expect(kim.crypto.getSnapshot().status).toBe('denied');
    expect(refused).toEqual([]);
    await host.leave();
  });

  it('takes an ask back when the tab asking closes', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await settle(host, (s) => s.waiting.some((w) => w.id === sam.ticket.identity));
    sam.closing();
    expect((await settle(host, (s) => s.waiting.length === 0)).waiting).toEqual([]);
    await host.leave();
  });

  it('makes anyone who stopped asking ask again: their pass doesn’t let them in', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const browser = guestBrowser();
    const sam = await browser.calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await settle(host, (s) => s.waiting.some((w) => w.id === sam.ticket.identity));
    await sam.leave();
    await settle(host, (s) => s.waiting.length === 0);
    // The same tab asks again with its old pass, as a reload would: Sam still has to be let in.
    const again = await browser.calls.join(c, { mic: true, cam: false, name: 'Sam', previous: sam.ticket.pass });
    expect((await settle(host, (s) => s.waiting.some((w) => w.id === again.ticket.identity))).waiting.map((w) => w.id)).toEqual([again.ticket.identity]);
    await new Promise((r) => setTimeout(r, 1000));
    expect(again.crypto.getSnapshot().status).toBe('waiting');
    expect(host.crypto.getSnapshot().members).not.toContain(again.ticket.identity);
    await host.leave();
  });

  it('takes out anyone let in who never reaches the room, once they’ve had time to get there', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await joinRoom(host);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    await joinRoom(sam);
    // Kim's browser dies while asking, so nothing tells the server, and the organizer lets Kim in.
    const kim = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Kim' });
    await settle(host, (s) => s.waiting.some((w) => w.id === kim.ticket.identity));
    kim.close();
    await host.admit(kim.ticket.identity);
    await waitFor(() => host.crypto.getSnapshot().members.includes(kim.ticket.identity), 'Kim in the group');
    const { reconcile, ARRIVAL_MS } = await import('./modules/calls');
    await reconcile(h.deps, Date.now() + ARRIVAL_MS / 2);
    expect(host.crypto.getSnapshot().members).toContain(kim.ticket.identity);
    await reconcile(h.deps, Date.now() + ARRIVAL_MS + 1_000);
    await waitFor(() => !host.crypto.getSnapshot().members.includes(kim.ticket.identity), 'Kim out of the group');
    expect((await settle(host, (s) => s.participants.length === 2)).participants.map((p) => p.id).sort()).toEqual([host.ticket.identity, sam.ticket.identity].sort());
    expect(host.crypto.getSnapshot().members).toContain(sam.ticket.identity);
    await host.leave();
  });

  it('removes every connection of someone removed, and lets a pass bring someone back only once', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const browser = guestBrowser();
    const first = await browser.calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, first);
    // A reload comes back with the last pass and gets straight in; a duplicated tab carries the same pass, and has to ask.
    const again = await browser.calls.join(c, { mic: true, cam: false, name: 'Sam', previous: first.ticket.pass });
    await inGroup(again);
    const twice = await browser.calls.join(c, { mic: true, cam: false, name: 'Sam', previous: first.ticket.pass });
    expect(twice.crypto.getSnapshot().status).toBe('waiting');
    await twice.leave();
    // The connection whose place was taken is told it's out, and stops checking.
    await waitFor(() => first.crypto.getSnapshot().status === 'removed', 'the old connection told it’s out');
    // Removing Sam removes the person: every pass of theirs stops working, and none brings them back.
    await host.remove(again.ticket.identity);
    await waitFor(() => !host.crypto.getSnapshot().members.includes(again.ticket.identity), 'Sam out of the group');
    for (const call of [first, again]) expect((await asMember(call, 'GET', '')).status).toBe(403);
    for (const pass of [first.ticket.pass, again.ticket.pass]) {
      const back = await browser.calls.join(c, { mic: true, cam: false, name: 'Sam', previous: pass });
      expect(back.crypto.getSnapshot().status).toBe('waiting');
      await back.leave();
    }
    await host.leave();
  });

  it('stops checking on the call once someone is out of it', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const asked: string[] = [];
    const sam = await h.browser({ onEvent: (e) => { if (e.msg === 'request' || e.msg === 'request failed') asked.push(String(e.context['path'])); } }).api.calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    await host.remove(sam.ticket.identity);
    await waitFor(() => sam.crypto.getSnapshot().status === 'removed', 'Sam told they were removed');
    const n = asked.length;
    await sleep(1500);
    expect(asked.length).toBe(n);
    await host.leave();
  });

  it('keeps everyone waiting when the organizer’s connection changes', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const laptop = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(laptop);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await settle(laptop, (s) => s.waiting.some((w) => w.id === sam.ticket.identity));
    const phone = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(phone);
    expect((await settle(phone, (s) => s.waiting.length === 1)).waiting.map((w) => w.id)).toEqual([sam.ticket.identity]);
    await phone.admit(sam.ticket.identity);
    await inGroup(sam);
    await waitFor(() => keyOf(sam) === keyOf(phone), 'Sam in the phone’s group');
    await phone.leave();
  });

  it('keeps someone in when LiveKit says they left but they’re still in the room', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await joinRoom(host);
    const guest = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, guest);
    await joinRoom(guest);
    expect((await hook('participant_left', host.ticket.roomName, guest.ticket.identity)).status).toBe(200);
    await sleep(4500);
    expect(host.crypto.getSnapshot().members).toContain(guest.ticket.identity);
    expect((await settle(host, (s) => s.participants.length === 2)).participants).toHaveLength(2);
    await host.leave();
  });

  it('moves the keys on every few minutes even when nobody comes or goes', async () => {
    const org = await account(unique(), { callRekeyMs: 400 });
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    await waitFor(() => keyOf(sam) === keyOf(host), 'the same keys');
    const before = keyOf(host);
    await waitFor(() => keyOf(host) !== before && keyOf(sam) === keyOf(host), 'new keys, with the same people');
    expect([...sam.crypto.getSnapshot().members].sort()).toEqual([host.ticket.identity, sam.ticket.identity].sort());
    await host.leave();
  });

  it('sends with the previous key for a moment after someone leaves, so nobody misses a beat', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const hostRoom = await joinRoom(host);
    // Kim's browser checks only when told to, so it can lag behind a change.
    const kim = await h.browser({ callPollMs: 600_000 }).api.calls.join(c, { mic: true, cam: false, name: 'Kim' });
    await settle(host, (s) => s.waiting.some((w) => w.id === kim.ticket.identity));
    await host.admit(kim.ticket.identity);
    await readLog(kim, () => kim.crypto.getSnapshot().status === 'in', 'Kim in the group');
    const lee = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Lee' });
    await letIn(host, lee);
    await readLog(kim, () => keyOf(kim) === keyOf(host), 'Kim on the keys with Lee');
    const kimRoom = await joinRoom(kim, host);
    await hostRoom.publishTone();
    await onLatestKey(host);
    expect(await kimRoom.meanLevelFrom(host.ticket.identity, 1000)).toBeGreaterThan(3000);
    const before = sendIndex(host);
    // Lee leaves; the keys move on without Lee, and Kim's browser hasn't caught up yet.
    await lee.leave();
    await waitFor(() => !host.crypto.getSnapshot().members.includes(lee.ticket.identity), 'Lee out of the group');
    expect(sendIndex(host)).toBe(before);
    expect(await kimRoom.meanLevelFrom(host.ticket.identity, 1000)).toBeGreaterThan(3000);
    // Kim catches up within that moment, so when the organizer moves to its new key, Kim has it.
    await kim.refresh({ call: false, log: true });
    await waitFor(() => sendIndex(host) !== before, 'the organizer on its new key', 10_000);
    expect(await kimRoom.meanLevelFrom(host.ticket.identity, 1000)).toBeGreaterThan(3000);
    await host.leave();
  });
});

/** Whether `identity`'s published tracks are muted, as `viewer` sees them. */
const mutedAt = (viewer: TestParticipant, identity: string) => [...(viewer.room.remoteParticipants.get(identity)?.trackPublications.values() ?? [])].map((t) => t.muted);

describe('host controls', () => {
  it('lets the organizer mute, remove and lock, and nobody else', async () => {
    const org = await account();
    const invitedEmail = unique('invited');
    const { code: c } = await org.api.calls.startNow({ guests: [invitedEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const hostRoom = await joinRoom(host);
    const guestBrowserApi = guestBrowser();
    const guest = await guestBrowserApi.calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, guest);
    const guestRoom = await joinRoom(guest);
    const sid = await guestRoom.publishTone();
    await hostRoom.waitFor(() => mutedAt(hostRoom, guest.ticket.identity).length === 1, 'the guest’s track');

    await host.mute(guest.ticket.identity, sid);
    await hostRoom.waitFor(() => mutedAt(hostRoom, guest.ticket.identity)[0] === true, 'the guest muted');

    await host.lock(true);
    const invited = await account(invitedEmail);
    const refused = await invited.api.calls.join(c, { mic: true, cam: false }).catch((e: unknown) => e);
    expect([code(refused), message(refused)]).toEqual(['forbidden', 'The host has locked this call.']);
    expect(code(await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Lee' }).catch((e: unknown) => e))).toBe('forbidden');
    expect((await guestBrowser().calls.card(c)).locked).toBe(true);

    for (const attempt of [() => guest.lock(false), () => guest.mute(host.ticket.identity, 'TR_x'), () => guest.remove(host.ticket.identity)]) {
      expect(code(await attempt().catch((e: unknown) => e))).toBe('forbidden');
    }

    await host.remove(guest.ticket.identity);
    expect(await guestRoom.disconnectReason()).toBe(DisconnectReason.PARTICIPANT_REMOVED);
    // Their pass goes with them: no more reading the call, chatting or catching up.
    for (const attempt of [() => guest.refresh(), () => guest.room(), () => guest.catchUp()]) {
      expect(code(await attempt().catch((e: unknown) => e))).toBe('forbidden');
    }
    await host.lock(false);
    const back = await guestBrowserApi.calls.join(c, { mic: true, cam: false, name: 'Sam' });
    expect(back.ticket.role).toBe('guest');
    // Removed people ask again: their old pass doesn't let them straight back in.
    expect(back.crypto.getSnapshot().status).toBe('waiting');
    await host.leave();
    // Once it's over, only the organizer can still read the call.
    expect(code(await back.refresh().catch((e: unknown) => e))).toBe('conflict');
  });

  it('never tells a guest anyone’s email address', async () => {
    const org = await account();
    const invitedEmail = unique('invited');
    const { code: c } = await org.api.calls.startNow({ notes: 'on', guests: [invitedEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const invited = await (await account(invitedEmail)).api.calls.join(c, { mic: true, cam: false });
    await inGroup(invited);
    await host.transcribe(speech('Hello everyone.', 0, 0), host.ticket.identity);
    const guest = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, guest);
    const seen = await settle(guest, (s) => s.participants.length === 3 && s.transcript.length > 0);
    // Signed-in people see each other's addresses; a guest with only the link sees names.
    expect(JSON.stringify(seen)).not.toContain('@');
    expect(JSON.stringify(await settle(invited, (s) => s.participants.length === 3))).toContain(org.session.user.email);
    await host.leave();
  });

  it('gives host powers only to the organizer’s current connection', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const laptop = await org.api.calls.join(c, { mic: true, cam: false });
    const phone = await org.api.calls.join(c, { mic: true, cam: false });
    await joinRoom(phone);
    for (const attempt of [() => laptop.lock(true), () => laptop.deny('p_nobodynobodynobodynob')]) {
      expect(code(await attempt().catch((e: unknown) => e))).toBe('forbidden');
    }
    expect(await callState(phone.ticket.callId)).toBe('live');
    expect((await phone.leave())?.duration).toBeGreaterThan(0);
  });
});

/** Every progress step of a note until it's written. */
async function written(api: AlcoveApi, noteId: string) { const steps = []; for await (const p of api.notes.progress(noteId)) steps.push(p); return steps; }
const callState = async (callId: string) => String((await h.pool.query('SELECT state FROM calls WHERE call_id = $1', [callId])).rows[0]?.state);
/** A webhook signed the way LiveKit signs them, posted to the API. */
async function hook(event: string, roomName: string, identity?: string) {
  const body = JSON.stringify({ event, room: { name: roomName }, ...(identity ? { participant: { identity } } : {}) });
  return fetch(`${h.baseUrl}/hooks/livekit`, { method: 'POST', headers: { 'content-type': 'application/webhook+json', authorization: await signWebhook(h.deps.cfg, body) }, body });
}

describe('ending', () => {
  it('ends the call for everyone when the organizer leaves, and runs the normal ending', async () => {
    const org = await account();
    const invitedEmail = unique('invited');
    const { code: c } = await org.api.calls.startNow({ notes: 'on', guests: [invitedEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await joinRoom(host);
    const invited = await account(invitedEmail);
    const inv = await invited.api.calls.join(c, { mic: true, cam: false });
    const invRoom = await joinRoom(inv);
    await host.appendAudio(piece(audioBytes('ending'), 0, 0));
    await host.transcribe(speech('We agreed to ship on Friday.', 0, 0), host.ticket.identity);

    const end = await host.leave();
    expect(end?.pendingNoteId).toBeTruthy();
    expect(await invRoom.disconnectReason()).toBe(DisconnectReason.ROOM_DELETED);
    // The call's MLS log goes with it.
    expect((await h.pool.query('SELECT count(*)::int AS n FROM call_mls WHERE call_id = $1', [host.ticket.callId])).rows[0]?.n).toBe(0);
    const noteId = end?.pendingNoteId ?? '';
    expect((await written(org.api, noteId)).at(-1)?.ready).toBe(true);
    expect((await invited.api.notes.get(noteId)).id).toBe(noteId);
  });

  it('keeps the call going when someone other than the organizer leaves, and takes them out of the group', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await joinRoom(host);
    const guest = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, guest);
    const guestRoom = await joinRoom(guest);
    await guestRoom.disconnect();
    expect((await hook('participant_left', host.ticket.roomName, guest.ticket.identity)).status).toBe(200);
    await waitFor(() => !host.crypto.getSnapshot().members.includes(guest.ticket.identity), 'the guest out of the group');
    expect((await settle(host, (s) => s.participants.length === 1)).participants.map((p) => p.id)).toEqual([host.ticket.identity]);
    const { reconcile } = await import('./modules/calls');
    await reconcile(h.deps, Date.now() + 60_000);
    expect(await callState(host.ticket.callId)).toBe('live');
    await host.leave();
  });

  it('doesn’t end the call when the organizer reconnects within the grace period', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const first = await org.api.calls.join(c, { mic: true, cam: false });
    expect((await hook('participant_left', first.ticket.roomName, first.ticket.identity)).status).toBe(200);
    const again = await org.api.calls.join(c, { mic: true, cam: false });
    await joinRoom(again);
    const { reconcile } = await import('./modules/calls');
    await reconcile(h.deps, Date.now() + 60_000);
    expect(await callState(again.ticket.callId)).toBe('live');
    await again.leave();
  });

  it('ends the call when the organizer’s connection is gone for good', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const guest = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, guest);
    expect((await hook('participant_left', host.ticket.roomName, host.ticket.identity)).status).toBe(200);
    const { reconcile } = await import('./modules/calls');
    expect(await reconcile(h.deps, Date.now() + 30_000)).toBeGreaterThanOrEqual(1);
    expect(await callState(host.ticket.callId)).toBe('ended');
    expect(code(await guest.refresh().catch((e: unknown) => e))).toBe('conflict');
  });

  it('ends the call when the organizer never reaches the room', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const { reconcile } = await import('./modules/calls');
    expect(await reconcile(h.deps)).toBe(0);
    expect(await reconcile(h.deps, Date.now() + 30_000)).toBeGreaterThanOrEqual(1);
    expect(await callState(host.ticket.callId)).toBe('ended');
  });

  it('ends the call when LiveKit says its room finished', async () => {
    const org = await account();
    const host = await org.api.calls.join((await org.api.calls.startNow({})).code, { mic: true, cam: false });
    expect((await hook('room_finished', host.ticket.roomName)).status).toBe(200);
    expect(await callState(host.ticket.callId)).toBe('ended');
  });

  it('rejects a forged webhook', async () => {
    const org = await account();
    const host = await org.api.calls.join((await org.api.calls.startNow({})).code, { mic: true, cam: false });
    const body = JSON.stringify({ event: 'room_finished', room: { name: host.ticket.roomName } });
    const r = await fetch(`${h.baseUrl}/hooks/livekit`, { method: 'POST', headers: { 'content-type': 'application/webhook+json', authorization: 'Bearer not-a-jwt' }, body });
    expect(r.status).toBe(401);
    expect(await callState(host.ticket.callId)).toBe('live');
    await host.leave();
  });

  it('ends calls whose room is gone during upkeep', async () => {
    const org = await account();
    const host = await org.api.calls.join((await org.api.calls.startNow({})).code, { mic: true, cam: false });
    await h.pool.query(`UPDATE calls SET started_at = now() - interval '2 minutes' WHERE call_id = $1`, [host.ticket.callId]);
    await deleteRoomDirectly(h.deps.cfg, host.ticket.roomName);
    const { maintain } = await import('./maintenance');
    expect((await maintain(h.deps)).calls).toBeGreaterThanOrEqual(1);
    expect(await callState(host.ticket.callId)).toBe('ended');
  });
});

describe('joining by link', () => {
  it('refuses everyone but the organizer until the organizer has joined', async () => {
    const org = await account();
    const invitedEmail = unique('invited');
    const { code: c } = await org.api.calls.startNow({ guests: [invitedEmail] });
    const guest = guestBrowser();
    expect(await guest.calls.card(c)).toMatchObject({ hostHere: false, organizerName: org.session.user.name, locked: false });
    const early = await guest.calls.join(c, { mic: true, cam: false, name: 'Sam' }).catch((e: unknown) => e);
    expect([code(early), message(early)]).toEqual(['conflict', 'Waiting for the host to start the call.']);
    const invited = await account(invitedEmail);
    expect(code(await invited.api.calls.join(c, { mic: true, cam: false }).catch((e: unknown) => e))).toBe('conflict');

    const host = await org.api.calls.join(c, { mic: true, cam: false });
    expect(host.ticket.role).toBe('host');
    expect(await guest.calls.card(c)).toMatchObject({ hostHere: true });
    await host.leave();
  });

  it('lets invited people in with their account and guests once the organizer lets them in', async () => {
    const org = await account();
    const invitedEmail = unique('invited');
    const { code: c } = await org.api.calls.startNow({ guests: [invitedEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const invited = await account(invitedEmail);
    const inv = await invited.api.calls.join(c, { mic: true, cam: false });
    const guest = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    expect([host.ticket.role, inv.ticket.role, guest.ticket.role]).toEqual(['host', 'invited', 'guest']);

    const hostRoom = await joinRoom(host);
    await joinRoom(inv);
    await letIn(host, guest);
    const guestRoom = await joinRoom(guest, host);
    await hostRoom.waitFor(() => hostRoom.remoteIdentities().length === 2, 'two others in the room');
    const s = await settle(host, (x) => x.participants.length === 3);
    expect(s.participants.map((p) => `${p.person.name}|${p.isOrganizer}|${p.isMe}`).sort()).toEqual(
      [`${org.session.user.name}|true|true`, `${invited.session.user.name}|false|false`, 'Sam|false|false'].sort()
    );
    await waitFor(() => keyOf(guest) === keyOf(host), 'one key');
    await hostRoom.publishTone();
    await onLatestKey(host);
    expect(await guestRoom.meanLevelFrom(host.ticket.identity)).toBeGreaterThan(3000);
    await host.leave();
  });

  it('lets one organizer connection in at a time, and continues the recording on a new segment', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const first = await org.api.calls.join(c, { mic: true, cam: false });
    const firstRoom = await joinRoom(first);
    await first.appendAudio(piece(audioBytes('first-device'), 0, 0));

    const second = await org.api.calls.join(c, { mic: true, cam: false });
    expect(second.ticket.identity).not.toBe(first.ticket.identity);
    expect(await firstRoom.disconnectReason()).toBe(DisconnectReason.PARTICIPANT_REMOVED);
    expect(second.getSnapshot().notes.recording.segment).toBe(1);
    // The replaced connection is no longer the organizer's: its late audio is refused.
    expect(code(await first.appendAudio(piece(audioBytes('late'), 0, 1)).catch((e: unknown) => e))).toBe('forbidden');
    await second.appendAudio(piece(audioBytes('second-device'), 1, 0));
    await second.leave();
  });

  it('lets a guest catch up and ask once let in, and refuses passes for other calls', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({ notes: 'off' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const guest = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    expect(code(await guest.catchUp().catch((e: unknown) => e))).toBe('forbidden');
    await letIn(host, guest);
    expect(code(await guest.catchUp().catch((e: unknown) => e))).toBe('conflict');

    host.setNotes(true);
    await settle(host, (x) => x.capture.mode === 'on');
    await host.appendAudio(piece(audioBytes('catch'), 0, 0));
    await host.transcribe(speech('We should move the launch. // Can we afford the delay?', 0, 0), host.ticket.identity);
    expect(await guest.catchUp()).toMatchObject({ lines: 2 });
    expect(await guest.askSoFar('What should move?')).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text' })]));
    expect(code(await guest.transcribe(speech('Not mine to send.', 0, 5000), guest.ticket.identity).catch((e: unknown) => e))).toBe('forbidden');

    const otherOrg = await account();
    const otherCall = await otherOrg.api.calls.join((await otherOrg.api.calls.startNow({})).code, { mic: true, cam: false });
    const r = await fetch(`${h.baseUrl}/v1/live/calls/${otherCall.ticket.callId}`, { headers: { 'x-alcove-call': guest.ticket.pass } });
    expect(r.status).toBe(401);
    await otherCall.leave();
    await host.leave();
  });

  it('transcribes everyone the organizer hears, each line under whoever said it, live, in catch-up and in the notes', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    host.setNotes(true);
    await settle(host, (x) => x.capture.mode === 'on');
    await host.appendAudio(piece(audioBytes('everyone'), 0, 0));
    // The organizer's browser hears its own microphone and Sam's, each on its own: both may start at once, and a
    // retried clip is kept once.
    await host.transcribe(speech('Shall we start with the budget?', 0, 0), host.ticket.identity);
    await host.transcribe(speech('Yes, the budget first.', 0, 0), sam.ticket.identity);
    await host.transcribe(speech('Yes, the budget first.', 0, 0), sam.ticket.identity);
    const organizer = host.getSnapshot().participants.find((p) => p.isOrganizer)?.person.name ?? '';
    const said = (ls: TranscriptLine[]) => ls.map((l) => `${l.speaker?.name ?? '?'}: ${l.text}`).sort();
    const both = [`${organizer}: Shall we start with the budget?`, 'Sam: Yes, the budget first.'];
    expect(said((await settle(sam, (x) => x.transcript.length === 2)).transcript)).toEqual(both);
    // Sam, a guest, sees the organizer as guests see everyone: a name and an arch, no email.
    expect(sam.getSnapshot().transcript.find((l) => l.speaker?.name === organizer)?.speaker?.person?.email).toBe('');
    // Catching up reads who said what, a guest marked as one.
    await sam.catchUp();
    expect(h.near.prompts.at(-1)).toContain('Sam (guest): Yes, the budget first.');
    expect(h.near.prompts.at(-1)).toContain(`${organizer}: Shall we start with the budget?`);

    // Only someone in the call can be named: nobody still asking or turned away, nobody from another call.
    const refused = async (speaker: string) => code(await host.transcribe(speech('Who said this?', 0, 9000), speaker).catch((e: unknown) => e));
    const kim = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Kim' });
    await settle(host, (x) => x.waiting.some((w) => w.id === kim.ticket.identity));
    expect(await refused(kim.ticket.identity)).toBe('invalid');
    await host.deny(kim.ticket.identity);
    await settle(host, (x) => x.waiting.length === 0);
    expect(await refused(kim.ticket.identity)).toBe('invalid');
    const other = await account();
    const elsewhere = await other.api.calls.join((await other.api.calls.startNow({})).code, { mic: true, cam: false });
    expect(await refused(elsewhere.ticket.identity)).toBe('invalid');
    await elsewhere.leave();
    expect(await refused('p_nobodynobodynobodynobo')).toBe('invalid');
    // Someone who has just left: their last words, still on the way, are kept under their name.
    await sam.leave();
    await settle(host, (x) => !x.participants.some((p) => p.id === sam.ticket.identity));
    await host.transcribe(speech('See you all next week.', 0, 11_000), sam.ticket.identity);

    const noteId = (await host.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);
    expect(said((await org.api.notes.get(noteId)).transcript ?? [])).toEqual([...both, 'Sam: See you all next week.'].sort());
  });

  it('keeps what’s said in a breakout room to the people there when it was said, under the room’s name, and out of the notes', async () => {
    const org = await account();
    const kofiEmail = unique('kofi');
    const { code: c } = await org.api.calls.startNow({ guests: [kofiEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const kofi = await (await account(kofiEmail)).api.calls.join(c, { mic: true, cam: false });
    await inGroup(kofi);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    host.setNotes(true);
    await settle(host, (x) => x.capture.mode === 'on');
    await host.appendAudio(piece(audioBytes('rooms'), 0, 0));
    await host.transcribe(speech('Before the rooms.', 0, 0), host.ticket.identity);
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofiEmail] }, { name: 'Support', emails: [] }], minutes: 5 });
    const design = (await settle(host, (x) => x.breakouts.open !== null)).breakouts.open?.rooms.find((r) => r.name === 'Design')?.id ?? '';
    host.visitRoom(design);
    await settle(host, (x) => x.breakouts.open?.rooms.find((r) => r.id === design)?.members.includes(host.ticket.identity) ?? false);
    // In Design: the organizer, visiting, and Kofi, who was sent there. Sam, a guest, stays in the main room.
    await host.transcribe(speech('Design starts with the colours.', 0, 4000), host.ticket.identity);
    await host.transcribe(speech('Blue for the buttons.', 0, 4000), kofi.ticket.identity);
    // The organizer goes back; a clip of Kofi's still on its way is kept where Kofi was.
    host.visitRoom(null);
    await settle(host, (x) => !(x.breakouts.open?.rooms.some((r) => r.members.includes(host.ticket.identity)) ?? true));
    await host.transcribe(speech('And green for links.', 0, 8000), kofi.ticket.identity);
    // Whisper is told the words said before a clip only in the same part of the call: none of Design's go with a
    // main-room clip, and none of the main room's with Design's, so it can't say them back into the other.
    const told = () => h.near.transcriptions.at(-1) ?? { language: null, prompt: null };
    await host.transcribe(speech('Sam, how is support going?', 0, 8000), host.ticket.identity);
    expect(told().language).toBe('en');
    expect(told().prompt).not.toMatch(/colours|buttons|green/);
    await host.transcribe(speech('Grey for the borders.', 0, 10_000), kofi.ticket.identity);
    expect(told().prompt).toContain('And green for links.');
    expect(told().prompt).not.toContain('support');
    const where = (ls: TranscriptLine[]) => ls.map((l) => `${l.text} @ ${l.room?.name ?? 'main'}`).sort();
    const inDesignLines = ['And green for links. @ Design', 'Blue for the buttons. @ Design', 'Design starts with the colours. @ Design', 'Grey for the borders. @ Design'];
    // Everyone reads the part of the call they're in: Kofi Design's, Sam and the organizer (back) the main room's.
    expect(where((await settle(kofi, (x) => x.transcript.length === 4)).transcript)).toEqual(inDesignLines);
    expect(where((await settle(host, (x) => x.transcript.length === 2)).transcript)).toEqual(['Before the rooms. @ main', 'Sam, how is support going? @ main']);
    expect(where((await settle(sam, (x) => x.transcript.length === 2)).transcript)).toEqual(['Before the rooms. @ main', 'Sam, how is support going? @ main']);
    // Sam doesn't read Design: not in catching up, or captions in another language.
    expect(await sam.catchUp()).toMatchObject({ lines: 2 });
    const blue = (await settle(kofi, (x) => x.transcript.length === 4)).transcript.find((l) => l.text === 'Blue for the buttons.')?.id ?? '';
    expect(await sam.translate([blue], 'fr')).toEqual([]);
    // Rooms that have run out are closed, whatever is stored: what's said after is the main room's, Kofi's main room
    // again, but not what the main room said while he was away.
    await h.pool.query(`UPDATE calls SET started_at = started_at - interval '6 minutes' WHERE call_id = $1`, [host.ticket.callId]);
    await host.transcribe(speech('Back together now.', 0, 12_000), kofi.ticket.identity);
    expect(told().prompt?.endsWith('Sam, how is support going?')).toBe(true);
    expect(told().prompt).not.toMatch(/colours|buttons|green|borders/);
    expect(where((await settle(sam, (x) => x.transcript.length === 3)).transcript)).toEqual(['Back together now. @ main', 'Before the rooms. @ main', 'Sam, how is support going? @ main']);
    expect(where((await settle(kofi, (x) => x.transcript.length === 2)).transcript)).toEqual(['Back together now. @ main', 'Before the rooms. @ main']);

    // The notes have the main room's lines, and nothing said in a room.
    const noteId = (await host.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);
    expect(where((await org.api.notes.get(noteId)).transcript ?? [])).toEqual(['Back together now. @ main', 'Before the rooms. @ main', 'Sam, how is support going? @ main']);
  });

  it('asks Whisper what each person speaks before sending their clips in the call’s language', async () => {
    const org = await account();
    const [anaEmail, kofiEmail] = [unique('ana'), unique('kofi')];
    const { code: c } = await org.api.calls.startNow({ notes: 'on', guests: [anaEmail, kofiEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    await settle(host, (x) => x.capture.mode === 'on');
    const from = h.near.transcriptions.length;
    const sent = () => h.near.transcriptions.slice(from).map((t) => t.language);
    // The organizer's clips settle the call on English, and theirs go in it.
    const english = ['We should look at the launch plan first.', 'The beta went out to forty customers.', 'Most of them finished onboarding within a day.', 'Kofi sends the new screens on Wednesday.'];
    for (const [i, words] of english.entries()) await host.transcribe(speech(words, 0, i * 4000), host.ticket.identity);
    expect(sent()).toEqual([null, null, null, 'en']);
    const kofi = await (await account(kofiEmail)).api.calls.join(c, { mic: true, cam: false });
    const ana = await (await account(anaEmail)).api.calls.join(c, { mic: true, cam: false });
    await Promise.all([inGroup(kofi), inGroup(ana)]);
    // Kofi's English is heavily accented: his first clip goes without English, and Whisper, at length, isn't sure what
    // it is. That's how it hears accented speech, so his next clips go in English like everyone's.
    await host.transcribe(speech('We could ship the new cards on Monday.', 0, 16_000, 4000, 'de', false), kofi.ticket.identity);
    await host.transcribe(speech('Then the design review can wait.', 0, 20_000), kofi.ticket.identity);
    expect(sent().slice(4)).toEqual([null, 'en']);
    // Ana speaks Spanish. A short hello says too little, so her next clip goes without English too, and is heard as
    // Spanish; while it's among the newest clips, nobody's clip goes in one language.
    await host.transcribe(speech('Hola a todos.', 0, 24_000, 2000, 'es'), ana.ticket.identity);
    await host.transcribe(speech('Perdón, llego tarde. ¿Ya empezamos con el presupuesto?', 0, 26_000, 4000, 'es'), ana.ticket.identity);
    await host.transcribe(speech('Yes, we just started on the budget.', 0, 30_000), host.ticket.identity);
    await host.transcribe(speech('El presupuesto de marketing sube un diez por ciento.', 0, 34_000, 4000, 'es'), ana.ticket.identity);
    expect(sent().slice(6)).toEqual([null, null, null, null]);
    await host.leave();
  });

  it('validates guest names and keeps them and passes out of rows and logs', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const guest = guestBrowser();
    for (const name of [undefined, '   ', '\n\t ', 'x'.repeat(61)]) {
      expect(code(await guest.calls.join(c, { mic: true, cam: false, ...(name === undefined ? {} : { name }) }).catch((e: unknown) => e))).toBe('invalid');
    }
    // A name is one line: a line break can't make a guest's words read as someone else's in the notes.
    const g = await guest.calls.join(c, { mic: true, cam: false, name: '  CANARY-NAME\n[00:00]   Ada\u2028  ' });
    expect((await settle(host, (s) => s.waiting.length === 1)).waiting[0]?.person.name).toBe('CANARY-NAME [00:00] Ada');
    await expectNotInRows(['calls', 'call_codes', 'call_mls'], ['CANARY-NAME', c]);
    const logs = h.logs.join('');
    expect(logs.includes('CANARY-NAME')).toBe(false);
    expect(logs.includes(g.ticket.pass)).toBe(false);
    expect(logs.includes(host.ticket.pass)).toBe(false);
    await host.leave();
  });

  it('answers not-found for unknown codes', async () => {
    const guest = guestBrowser();
    expect(code(await guest.calls.card('zzz-zzzz-zzz').catch((e: unknown) => e))).toBe('not-found');
    expect(code(await guest.calls.join('zzz-zzzz-zzz', { mic: true, cam: false, name: 'Sam' }).catch((e: unknown) => e))).toBe('not-found');
  });
});

describe('devices', () => {
  it('lets someone in whose browser allows no microphone or camera, and they hear everyone', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const hostRoom = await joinRoom(host);
    await hostRoom.publishTone();
    // Pre-join found nothing it may use (blocked, or nothing plugged in): the browser joins with both off and asks.
    const guest = await guestBrowser().calls.join(c, { mic: false, cam: false, name: 'Sam' });
    await letIn(host, guest);
    await waitFor(() => keyOf(host) === keyOf(guest), 'the same keys');
    const guestRoom = await joinRoom(guest, host);

    // LiveKit forwards the organizer's encrypted audio to them, and they hold the organizer's key to read it.
    const audioFrom = (p: TestParticipant, identity: string) => [...(p.room.remoteParticipants.get(identity)?.trackPublications.values() ?? [])].filter((t) => t.kind === TrackKind.KIND_AUDIO && t.track !== undefined);
    await guestRoom.waitFor(() => audioFrom(guestRoom, host.ticket.identity).length === 1, 'the organizer’s audio reaching them');
    expect(senderKey(guest, host.ticket.identity)).toBe(senderKey(host, host.ticket.identity));
    // And everyone sees them in the call.
    const seen = await settle(host, (s) => s.participants.some((p) => p.id === guest.ticket.identity));
    expect(seen.participants.find((p) => p.id === guest.ticket.identity)?.person.name).toBe('Sam');
    await host.leave();
  });
});

describe('screen sharing', () => {
  it('lets two people share at once, each picture and its sound encrypted, and one leaving takes only their share', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const hostRoom = await joinRoom(host);
    const ana = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Ana' });
    await letIn(host, ana);
    const bo = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Bo' });
    await letIn(host, bo);
    const [anaRoom, boRoom] = await Promise.all([joinRoom(ana), joinRoom(bo)]);

    // Both share at once with the tokens the API gave them: the grant lets a second screen, and its sound, through.
    const [anas, bos] = await Promise.all([anaRoom.publishScreen(true), boRoom.publishScreen(true)]);
    // The organizer receives all four, each encrypted end to end.
    const shared = (who: CallSession) => [...(hostRoom.room.remoteParticipants.get(who.ticket.identity)?.trackPublications.values() ?? [])]
      .filter((t) => (t.source === TrackSource.SOURCE_SCREENSHARE || t.source === TrackSource.SOURCE_SCREENSHARE_AUDIO) && t.track !== undefined);
    await hostRoom.waitFor(() => shared(ana).length === 2 && shared(bo).length === 2, 'both shares, picture and sound');
    for (const t of [...shared(ana), ...shared(bo)]) expect(t.encryptionType).toBe(EncryptionType.GCM);
    expect(shared(ana).map((t) => t.sid).sort()).toEqual([anas.screen, anas.sound].sort());
    expect(shared(bo).map((t) => t.sid).sort()).toEqual([bos.screen, bos.sound].sort());

    // Ana leaving takes her share with her, and only hers.
    await ana.leave();
    await anaRoom.disconnect();
    await hostRoom.waitFor(() => shared(ana).length === 0, 'Ana’s share gone');
    expect(shared(bo).map((t) => t.sid).sort()).toEqual([bos.screen, bos.sound].sort());
    await host.leave();
  });

  it('takes a removed presenter’s share from everyone at once, gives them no way back to it, and keeps nothing anyone shared', async () => {
    // Earlier pictures of a share live only in each viewer's browser (docs: The call screen › Looking closer at a share),
    // and they go when the share leaves the room. This is the server's half: removal takes the share out of every room.
    const objectIds = async () => { const ids = new Set<string>(); for await (const o of h.objects.list()) ids.add(o.id); return ids; };
    const before = await objectIds();
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const hostRoom = await joinRoom(host);
    const ana = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Ana' });
    await letIn(host, ana);
    const bo = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Bo' });
    await letIn(host, bo);
    const [anaRoom, boRoom] = await Promise.all([joinRoom(ana), joinRoom(bo)]);
    const bos = (await Promise.all([anaRoom.publishScreen(true), boRoom.publishScreen(true)]))[1];
    /** The share (picture and sound) `who` sends, as `p` receives it. */
    const sharedTo = (p: TestParticipant, who: CallSession) => [...(p.room.remoteParticipants.get(who.ticket.identity)?.trackPublications.values() ?? [])]
      .filter((t) => (t.source === TrackSource.SOURCE_SCREENSHARE || t.source === TrackSource.SOURCE_SCREENSHARE_AUDIO) && t.track !== undefined).map((t) => t.sid ?? '').sort();
    await hostRoom.waitFor(() => sharedTo(hostRoom, ana).length === 2 && sharedTo(hostRoom, bo).length === 2, 'both shares reaching the organizer');
    await boRoom.waitFor(() => sharedTo(boRoom, ana).length === 2, 'Ana’s share reaching Bo');

    // The organizer removes Ana while she shares: her share leaves every room at once, and Bo's carries on.
    await host.remove(ana.ticket.identity);
    expect(await anaRoom.disconnectReason()).toBe(DisconnectReason.PARTICIPANT_REMOVED);
    await hostRoom.waitFor(() => sharedTo(hostRoom, ana).length === 0, 'Ana’s share gone for the organizer');
    await boRoom.waitFor(() => sharedTo(boRoom, ana).length === 0, 'Ana’s share gone for Bo');
    expect(sharedTo(hostRoom, bo)).toEqual([bos.screen, bos.sound ?? ''].sort());
    // Her pass gets her no new way into the room, so nothing anyone shares reaches her again.
    expect(code(await ana.room().catch((e: unknown) => e))).toBe('forbidden');
    // Without screen notes, shares go from browser to browser through LiveKit, encrypted: the API kept nothing of them.
    expect([...await objectIds()].filter((id) => !before.has(id))).toEqual([]);
    await host.leave();
  });
});
