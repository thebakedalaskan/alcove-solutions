/**
 * Pointing at shared screens, end to end: the real API over HTTP via @alcove/api-http (real MLS clients), real Postgres
 * and a real LiveKit server. Who may point is the call's (the organizer's switch, each presenter's own choice); the
 * pointers and marks themselves go from browser to browser as LiveKit data packets, encrypted with each sender's own
 * key from the call's MLS group. Test participants are @livekit/rtc-node rooms joined with the tokens the API hands out,
 * encrypting with those keys as browsers do.
 */
import { AlcoveApiError, CALL_CODECS_LIMITS, CALL_CODECS_TOPIC, CALL_DATA_OVERHEAD, CALL_MARKS_TOPIC, CALL_REACT_TOPIC, CallCodecsMessageSchema, CallReactMessageSchema, ShareMarkMessageSchema, type CallCodecsMessage, type CallSession, type CallState, type ShareMarkMessage } from '@alcove/api';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ORIGIN, startHarness, type Harness } from '../../testing/harness';
import { connect, disposeLiveKit, tokenDirectly, type Keys, type TestParticipant } from '../../testing/livekit';

// Real WebRTC through LiveKit, which a busy CI runner can be slow to set up: every step waits at most 15 s and says
// what it was waiting for.
vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });

const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
async function account(email = unique()) {
  const b = h.browser();
  await b.api.auth.signIn('sso', { email });
  return b;
}
const guestBrowser = () => h.browser().api;
async function waitFor(pred: () => boolean, what: string, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
/** Refreshes until the call's state matches (other people's changes arrive by fetching the call again). */
async function settle(call: CallSession, pred: (s: CallState) => boolean): Promise<CallState> {
  for (let i = 0; i < 100 && !pred(call.getSnapshot()); i++) { await call.refresh(); await new Promise((r) => setTimeout(r, 30)); }
  return call.getSnapshot();
}
const inGroup = (call: CallSession) => waitFor(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
async function letIn(host: CallSession, who: CallSession) {
  await settle(host, (s) => s.waiting.some((w) => w.id === who.ticket.identity));
  await host.admit(who.ticket.identity);
  await inGroup(who);
}
const latestKeys = (call: CallSession) => call.crypto.getSnapshot().media?.epochs.at(-1)?.keys ?? {};
const sendIndex = (call: CallSession) => call.crypto.getSnapshot().media?.send?.index;
const onLatestKey = (call: CallSession) => waitFor(() => sendIndex(call) !== undefined && sendIndex(call) === call.crypto.getSnapshot().media?.epochs.at(-1)?.index, `${call.ticket.role} sending with its new key`);
/** A request about a call with someone's pass, as their browser would send it. */
const asMember = (call: CallSession, body: unknown) => fetch(`${h.baseUrl}/v1/live/calls/${call.ticket.callId}/actions`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-alcove-call': call.ticket.pass }, body: JSON.stringify(body)
});
const othersPoint = (s: CallState, who: CallSession) => s.participants.find((p) => p.id === who.ticket.identity)?.othersPoint;

const open: TestParticipant[] = [];
async function joinRoom(call: CallSession, hearing?: CallSession): Promise<TestParticipant> {
  await inGroup(call);
  const keys: Keys = hearing ? { hearing: call.crypto, from: hearing.ticket.identity, senderSends: hearing.crypto } : { sending: call.crypto };
  const p = await connect(await call.room(), keys);
  open.push(p);
  return p;
}
afterEach(async () => { await Promise.all(open.splice(0).map((p) => p.disconnect().catch(() => undefined))); h.closeCalls(); });

const bytes = (m: ShareMarkMessage) => new TextEncoder().encode(JSON.stringify(m));
/** A pointer or mark sealed by a browser's session, as it sends one. */
async function sealed(by: CallSession, m: ShareMarkMessage): Promise<Uint8Array<ArrayBuffer>> {
  const s = await by.sealData(CALL_MARKS_TOPIC, bytes(m));
  if (!s) throw new Error('no key to seal with');
  return s;
}
/** What arrived on the marks topic, read as a browser reads it: opened by its session with the sender's key, then parsed. */
const marksAt = (p: TestParticipant, by: CallSession) => Promise.all(p.received(CALL_MARKS_TOPIC).map(async (d) => {
  const plain = d.from ? await by.openData(CALL_MARKS_TOPIC, d.from, d.payload) : null;
  let raw: unknown = null;
  try { raw = plain ? JSON.parse(new TextDecoder().decode(plain)) : null; } catch { /* not a message */ }
  const m = ShareMarkMessageSchema.safeParse(raw);
  return { from: d.from, message: m.success ? m.data : null };
}));
/** Sealed data opened by someone's session, as from `sender`, and parsed: the message, or null when it doesn't open. */
async function opened(by: CallSession, sender: CallSession, s: Uint8Array): Promise<ShareMarkMessage | null> {
  const plain = await by.openData(CALL_MARKS_TOPIC, sender.ticket.identity, s);
  if (!plain) return null;
  const m = ShareMarkMessageSchema.safeParse(JSON.parse(new TextDecoder().decode(plain)));
  return m.success ? m.data : null;
}
/** In the group of a part of the call (the main room, or a room), holding its keys and sending with the latest. */
const inPlace = (call: CallSession, place: string) => waitFor(() => {
  const s = call.crypto.getSnapshot();
  const send = s.media?.send;
  return s.status === 'in' && s.place === place && send !== undefined && send !== null && send.index === s.media?.epochs.at(-1)?.index;
}, `${call.ticket.role} in ${place === 'main' ? 'the main room' : 'a room'}`);
const keyOf = (call: CallSession) => JSON.stringify(Object.entries(latestKeys(call)).sort(([a], [b]) => a.localeCompare(b)).map(([id, k]) => [id, Buffer.from(k).toString('hex')]));
/** A LiveKit join token's claims, as LiveKit reads them. */
const ClaimsSchema = z.object({ sub: z.string(), name: z.string().optional(), metadata: z.string().optional(), video: z.record(z.string(), z.unknown()) });
const claimsOf = (token: string) => ClaimsSchema.parse(JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')));

describe('pointing at shared screens', () => {
  it('gives people let in a room token that may send data, with no admin rights and no name', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const guest = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    // Someone still asking has no room, so they can't send anything to it.
    expect(code(await guest.room().catch((e: unknown) => e))).toBe('forbidden');
    await letIn(host, guest);
    for (const who of [host, guest]) {
      const claims = claimsOf((await who.room()).token);
      expect(claims.sub).toBe(who.ticket.identity);
      expect(`${claims.name ?? ''}${claims.metadata ?? ''}`).toBe('');
      expect(claims.video).toEqual({ roomJoin: true, room: who.ticket.roomName, canPublish: true, canSubscribe: true, canPublishData: true });
    }
    await host.leave();
  });

  it('carries pointers and marks from browser to browser, unreadable to anyone without the sender’s key, LiveKit included', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const hostRoom = await joinRoom(host);
    const guest = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, guest);
    // The host sends with its key for the latest epoch, which the guest, just let in, holds.
    await onLatestKey(host);
    const guestRoom = await joinRoom(guest, host);
    // LiveKit holds the API key, so it could put anyone in the room: here, someone with no keys at all, and someone with
    // the guest's own key, which isn't the host's.
    const roomOf = async (identity: string, keys?: Keys) => {
      const p = await connect({ serverUrl: host.ticket.serverUrl, token: await tokenDirectly(h.deps.cfg, host.ticket.roomName, identity), identity }, keys);
      open.push(p);
      return p;
    };
    const keyless = await roomOf('p_nokeysnokeysnokeysnoke');
    const guestsKey = latestKeys(host)[guest.ticket.identity];
    if (!guestsKey) throw new Error('no key for the guest');
    const wrongKey = await roomOf('p_wrongkeywrongkeywrongk', { key: guestsKey, index: sendIndex(host) ?? 0 });
    await hostRoom.waitFor(() => ['p_nokeysnokeysnokeysnoke', 'p_wrongkeywrongkeywrongk', guest.ticket.identity].every((id) => hostRoom.remoteIdentities().includes(id)), 'everyone in the room');
    const { screen } = await hostRoom.publishScreen(false);

    // A mark goes reliably, once. A pointer goes lossy, as browsers send it, so it's sent until it lands.
    const mark: ShareMarkMessage = { t: 'mark', share: screen, seq: 1, id: 'm_firstmark01', kind: 'line', points: [[0.1, 0.2], [0.35, 0.4], [0.5, 0.45]], done: true };
    const markSealed = await sealed(host, mark);
    await hostRoom.sendData(markSealed, CALL_MARKS_TOPIC, true);
    await guestRoom.waitFor(() => guestRoom.received(CALL_MARKS_TOPIC).length > 0, 'the mark');
    const point: ShareMarkMessage = { t: 'point', share: screen, seq: 2, at: [0.625, 0.25] };
    const pointSealed = await sealed(host, point);
    for (let i = 0; i < 40 && guestRoom.received(CALL_MARKS_TOPIC).length < 2; i++) { await hostRoom.sendData(pointSealed, CALL_MARKS_TOPIC, false); await new Promise((r) => setTimeout(r, 50)); }
    expect((await marksAt(guestRoom, guest)).slice(0, 2)).toEqual([{ from: host.ticket.identity, message: mark }, { from: host.ticket.identity, message: point }]);

    // What's sealed carries nothing readable, and opens only as what it is: from its sender, on its topic, unchanged.
    const text = Buffer.from(markSealed).toString('latin1');
    for (const canary of ['m_firstmark01', screen, '0.35', '"line"']) expect(text.includes(canary)).toBe(false);
    expect(await guest.openData(CALL_MARKS_TOPIC, guest.ticket.identity, markSealed)).toBeNull();
    expect(await guest.openData('chat', host.ticket.identity, markSealed)).toBeNull();
    const changed = new Uint8Array(markSealed);
    changed[changed.length - 1] = (changed.at(-1) ?? 0) ^ 1;
    expect(await guest.openData(CALL_MARKS_TOPIC, host.ticket.identity, changed)).toBeNull();

    // Data does reach the others (the server's change push, which carries nothing, arrives in the clear), but nothing of the
    // pointer or the mark: LiveKit encrypts the packet as well, and without the host's key it can't be read.
    const pushed = Promise.all([keyless.nextChange(), wrongKey.nextChange()]);
    await host.setPointing(false);
    await pushed;
    expect(keyless.received(CALL_MARKS_TOPIC)).toEqual([]);
    expect(wrongKey.received(CALL_MARKS_TOPIC)).toEqual([]);
    await host.leave();
  });

  it('carries reactions from browser to browser, sealed to their sender and topic', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const hostRoom = await joinRoom(host);
    const guest = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, guest);
    await onLatestKey(host);
    const guestRoom = await joinRoom(guest, host);
    await hostRoom.waitFor(() => hostRoom.remoteIdentities().includes(guest.ticket.identity), 'the guest in the room');

    const reactSealed = await host.sealData(CALL_REACT_TOPIC, new TextEncoder().encode(JSON.stringify({ r: 'party' })));
    if (!reactSealed) throw new Error('no key to seal with');
    await hostRoom.sendData(reactSealed, CALL_REACT_TOPIC, true);
    await guestRoom.waitFor(() => guestRoom.received(CALL_REACT_TOPIC).length > 0, 'the reaction');
    const arrived = guestRoom.received(CALL_REACT_TOPIC);
    expect(arrived).toHaveLength(1);
    const first = arrived[0];
    if (!first?.from) throw new Error('no sender on the reaction');
    expect(first.from).toBe(host.ticket.identity);
    const plain = await guest.openData(CALL_REACT_TOPIC, first.from, first.payload);
    if (!plain) throw new Error('the reaction did not open');
    expect(CallReactMessageSchema.parse(JSON.parse(new TextDecoder().decode(plain)))).toEqual({ r: 'party' });

    // What's sealed carries nothing readable, and opens only on its own topic, from its sender.
    expect(Buffer.from(reactSealed).toString('latin1').includes('party')).toBe(false);
    expect(await guest.openData(CALL_MARKS_TOPIC, host.ticket.identity, reactSealed)).toBeNull();
    expect(await guest.openData(CALL_REACT_TOPIC, guest.ticket.identity, reactSealed)).toBeNull();
    await host.leave();
  });

  it('carries a browser’s word that it can’t decode VP9, sealed to its sender and topic, within the topic’s limit', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const hostRoom = await joinRoom(host);
    const guest = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, guest);
    await onLatestKey(host);
    const guestRoom = await joinRoom(guest, host);
    await hostRoom.waitFor(() => hostRoom.remoteIdentities().includes(guest.ticket.identity), 'the guest in the room');

    // What a browser that can't decode VP9 says, so that whoever shares a screen as VP9 sends VP8 instead. A browser
    // drops a packet bigger than the topic's limit before opening it, so once sealed it has to fit.
    const message = new TextEncoder().encode(JSON.stringify({ vp9: false } satisfies CallCodecsMessage));
    const said = await host.sealData(CALL_CODECS_TOPIC, message);
    if (!said) throw new Error('no key to seal with');
    expect(said.byteLength).toBeLessThanOrEqual(CALL_CODECS_LIMITS.bytes);
    await hostRoom.sendData(said, CALL_CODECS_TOPIC, true);
    await guestRoom.waitFor(() => guestRoom.received(CALL_CODECS_TOPIC).length > 0, 'the codecs message');
    const arrived = guestRoom.received(CALL_CODECS_TOPIC);
    expect(arrived).toHaveLength(1);
    const first = arrived[0];
    if (!first?.from) throw new Error('no sender on the codecs message');
    expect(first.from).toBe(host.ticket.identity);
    const plain = await guest.openData(CALL_CODECS_TOPIC, first.from, first.payload);
    if (!plain) throw new Error('the codecs message did not open');
    expect(CallCodecsMessageSchema.parse(JSON.parse(new TextDecoder().decode(plain)))).toEqual({ vp9: false });

    // What's sealed carries nothing readable: the seal's own overhead and as many bytes as the message, never the message
    // itself (three bytes like "vp9" turn up in its random ones now and then, the whole message can't). And it opens only on
    // its own topic, from its sender.
    expect(said.byteLength).toBe(CALL_DATA_OVERHEAD + message.byteLength);
    expect(Buffer.from(said).includes(Buffer.from(message))).toBe(false);
    expect(await guest.openData(CALL_REACT_TOPIC, host.ticket.identity, said)).toBeNull();
    expect(await guest.openData(CALL_CODECS_TOPIC, guest.ticket.identity, said)).toBeNull();
    await host.leave();
  });

  it('lets the organizer turn pointing off for everyone and on again, and nobody else', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const guest = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, guest);
    const waiting = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Wes' });
    expect(host.getSnapshot().pointing).toBe(true);
    expect((await settle(guest, (s) => s.participants.length === 2)).pointing).toBe(true);

    // Only the organizer: not someone in the call, nor someone still asking.
    expect((await asMember(guest, { type: 'pointing', on: false })).status).toBe(403);
    expect((await asMember(waiting, { type: 'pointing', on: false })).status).toBe(403);
    expect(code(await guest.setPointing(false).catch((e: unknown) => e))).toBe('forbidden');

    await host.setPointing(false);
    expect(host.getSnapshot().pointing).toBe(false);
    const off = await settle(guest, (s) => !s.pointing);
    expect(off.pointing).toBe(false);
    expect(off.notices.filter((n) => n.text === 'The organizer turned off pointing at shared screens.')).toHaveLength(1);
    // Saying it again changes nothing, and tells nobody again.
    await host.setPointing(false);
    expect((await settle(guest, () => true)).notices.filter((n) => n.text === 'The organizer turned off pointing at shared screens.')).toHaveLength(1);

    await host.setPointing(true);
    expect((await settle(guest, (s) => s.pointing)).pointing).toBe(true);
    await host.leave();
  });

  it('lets each presenter say whether others may point at what they share, and keeps it when they come back', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const browser = guestBrowser();
    const ana = await browser.calls.join(c, { mic: true, cam: false, name: 'Ana' });
    await letIn(host, ana);
    const both = await settle(host, (s) => s.participants.length === 2);
    expect([othersPoint(both, host), othersPoint(both, ana)]).toEqual([true, true]);

    // Ana's own choice, which everyone sees on her: only hers changes.
    await ana.letOthersPoint(false);
    expect(othersPoint(ana.getSnapshot(), ana)).toBe(false);
    const seen = await settle(host, (s) => othersPoint(s, ana) === false);
    expect([othersPoint(seen, host), othersPoint(seen, ana)]).toEqual([true, false]);

    // Her page reloads: the new connection comes with the old one's pass, and her choice comes with her.
    ana.closing();
    const back = await browser.calls.join(c, { mic: true, cam: false, name: 'Ana', previous: ana.ticket.pass });
    await inGroup(back);
    expect(othersPoint(await settle(host, (s) => s.participants.some((p) => p.id === back.ticket.identity)), back)).toBe(false);

    // Someone still asking can't say anything about what they share.
    const waiting = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Wes' });
    expect((await asMember(waiting, { type: 'others-point', on: false })).status).toBe(403);

    await back.letOthersPoint(true);
    expect(othersPoint(await settle(host, (s) => othersPoint(s, back) === true), back)).toBe(true);

    // The organizer's own choice holds when their page reloads, or they come back on another device, as anyone's does.
    await host.letOthersPoint(false);
    host.closing();
    const again = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(again);
    expect(again.ticket.callId).toBe(host.ticket.callId);
    expect(othersPoint(await settle(again, (s) => s.participants.some((p) => p.id === again.ticket.identity)), again)).toBe(false);
    expect(othersPoint(await settle(back, (s) => s.participants.some((p) => p.id === again.ticket.identity)), again)).toBe(false);
    await again.leave();
  });

  it('opens what’s sealed only for the people in its sender’s part of the call when it was sealed', async () => {
    const org = await account();
    const [kofiEmail, miaEmail] = [unique('kofi'), unique('mia')];
    const { code: c } = await org.api.calls.startNow({ guests: [kofiEmail, miaEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const kofi = await (await account(kofiEmail)).api.calls.join(c, { mic: true, cam: false });
    const mia = await (await account(miaEmail)).api.calls.join(c, { mic: true, cam: false });
    await Promise.all([inGroup(kofi), inGroup(mia)]);
    await waitFor(() => keyOf(kofi) === keyOf(host) && keyOf(mia) === keyOf(host), 'everyone on the same keys');
    // The organizer's browser sends with the new keys a moment after it made them.
    await inPlace(host, 'main');
    const before: ShareMarkMessage = { t: 'mark', share: 'TR_sharebeforeyou', seq: 1, id: 'm_beforeyou01', kind: 'ring', points: [[0.5, 0.5]], done: true };
    const sealedBefore = await sealed(host, before);
    expect(await opened(kofi, host, sealedBefore)).toEqual(before);

    // Someone let in afterwards can't open what was sealed before they were in: they never had those keys.
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    expect(await opened(sam, host, sealedBefore)).toBeNull();
    // What's sealed once the organizer sends with the new keys opens for them.
    await inPlace(host, 'main');
    const after: ShareMarkMessage = { t: 'point', share: 'TR_sharebeforeyou', seq: 2, at: [0.25, 0.75] };
    expect(await opened(sam, host, await sealed(host, after))).toEqual(after);

    // In a breakout room, what's sealed opens for the room's people and nobody in another part of the call.
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofiEmail, miaEmail] }, { name: 'Support', emails: [] }], minutes: 5, board: { mode: 'none', template: 'blank' } });
    const design = (await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms[0]?.id ?? '';
    await Promise.all([inPlace(kofi, design), inPlace(mia, design)]);
    await waitFor(() => keyOf(kofi) === keyOf(mia), 'the room on one set of keys');
    await inPlace(kofi, design);
    const inRoom: ShareMarkMessage = { t: 'mark', share: 'TR_sharedinroom', seq: 3, id: 'm_inthisroom1', kind: 'line', points: [[0.1, 0.1], [0.4, 0.3]], done: true };
    const sealedInRoom = await sealed(kofi, inRoom);
    expect(await opened(mia, kofi, sealedInRoom)).toEqual(inRoom);
    expect(await opened(sam, kofi, sealedInRoom)).toBeNull();
    await host.leave();
  });
});
