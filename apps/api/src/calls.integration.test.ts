/**
 * Group calls on LiveKit, end to end: the real API over HTTP via @alcove/api-http, real Postgres, the
 * object store, a real LiveKit server (docker-compose.yml) and main's fake Google and NEAR AI. Participants
 * are @livekit/rtc-node rooms joined with the tickets the API hands out, so media and data travel for real.
 */
import { AlcoveApiError, type AudioPiece, type CallSession, type CallState, type TranscriptClip } from '@alcove/api';
import { DisconnectReason } from '@livekit/rtc-node';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { speechWav } from './testing/fake-near';
import { startHarness, type Harness } from './testing/harness';
import { connect, disposeLiveKit, type TestParticipant } from './testing/livekit';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });

const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
const message = (e: unknown) => (e instanceof AlcoveApiError ? e.message : '');
let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
/** A fresh account: single sign-on signs in whoever's work email is typed. */
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session };
}
/** A browser with no account. */
const guestBrowser = () => h.browser().api;
const audioBytes = (marker: string) => { const src = Buffer.concat([Buffer.from(marker), randomBytes(2048)]); const out = new Uint8Array(new ArrayBuffer(src.length)); out.set(src); return out; };
const piece = (bytes: Uint8Array<ArrayBuffer>, segment: number, s: number): AudioPiece => ({ data: new Blob([bytes]), segment, seq: s, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' });
const speech = (words: string, segment: number, startMs: number, ms = 4000): TranscriptClip => ({ data: new Blob([speechWav(words, ms)], { type: 'audio/wav' }), segment, startMs, durationMs: ms });
/** Refreshes until the call's state matches (other people's changes arrive by refetching). */
async function settle(call: CallSession, pred: (s: CallState) => boolean): Promise<CallState> {
  for (let i = 0; i < 100 && !pred(call.getSnapshot()); i++) { await call.refresh(); await new Promise((r) => setTimeout(r, 30)); }
  return call.getSnapshot();
}
const encodings = (s: string) => [s, Buffer.from(s).toString('hex'), Buffer.from(s).toString('base64').slice(0, 12), Buffer.from(s).toString('base64url').slice(0, 12)];
async function expectNotInRows(tables: string[], canaries: string[]) {
  const dump = await h.pool.query(`SELECT string_agg(t, ' ') AS all FROM (${tables.map((t) => `SELECT row_to_json(x)::text AS t FROM ${t} x`).join(' UNION ALL ')}) q`);
  const text = String(dump.rows[0]?.all ?? '');
  for (const canary of canaries) for (const enc of encodings(canary)) expect(text.includes(enc), `${canary} as ${enc}`).toBe(false);
}

/** Rooms a test connected; disconnected after each test so rooms empty out. */
const open: TestParticipant[] = [];
async function joinRoom(call: CallSession): Promise<TestParticipant> { const p = await connect(call.ticket); open.push(p); return p; }
afterEach(async () => { await Promise.all(open.splice(0).map((p) => p.disconnect().catch(() => undefined))); });

describe('calls on LiveKit', () => {
  it('reports LiveKit reachable in the health check', async () => {
    expect(await (await fetch(`${h.baseUrl}/health`)).json()).toMatchObject({ livekit: 'reachable' });
  });
});

describe('chat', () => {
  it('saves chat from everyone and tells the room', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const guest = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    const hostRoom = await joinRoom(host);
    await joinRoom(guest);
    const told = hostRoom.nextNudge();
    await guest.sendChat('CANARY-CHAT hi');
    await told;
    const s = await settle(host, (x) => x.chat.length === 1);
    expect(s.chat).toEqual([expect.objectContaining({ text: 'CANARY-CHAT hi', isMe: false, from: expect.objectContaining({ name: 'Sam' }) })]);
    await expectNotInRows(['calls'], ['CANARY-CHAT']);
    await host.leave();
  });

  it('gives late joiners and rejoiners the chat so far, in order', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const first = guestBrowser();
    const sam = await first.calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await host.sendChat('one');
    await sam.sendChat('two');
    await host.sendChat('three');
    const late = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Lee' });
    expect(late.getSnapshot().chat.map((m) => m.text)).toEqual(['one', 'two', 'three']);
    const again = await first.calls.join(c, { mic: true, cam: false, name: 'Sam' });
    expect(again.getSnapshot().chat.map((m) => m.text)).toEqual(['one', 'two', 'three']);
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
    await host.lock(false);
    expect((await guestBrowserApi.calls.join(c, { mic: true, cam: false, name: 'Sam' })).ticket.role).toBe('guest');
    await host.leave();
  });
});

describe('joining by link', () => {
  it('refuses everyone but the organizer until the organizer has joined', async () => {
    const org = await account();
    const invitedEmail = unique('invited');
    const { code: c } = await org.api.calls.startNow({ guests: [invitedEmail] });
    const guest = guestBrowser();
    expect(await guest.calls.card(c)).toMatchObject({ hostHere: false, status: 'scheduled', organizerName: org.session.user.name, locked: false });
    const early = await guest.calls.join(c, { mic: true, cam: false, name: 'Sam' }).catch((e: unknown) => e);
    expect([code(early), message(early)]).toEqual(['conflict', 'Waiting for the host to start the call.']);
    const invited = await account(invitedEmail);
    expect(code(await invited.api.calls.join(c, { mic: true, cam: false }).catch((e: unknown) => e))).toBe('conflict');

    const host = await org.api.calls.join(c, { mic: true, cam: false });
    expect(host.ticket.role).toBe('host');
    expect(await guest.calls.card(c)).toMatchObject({ hostHere: true, status: 'live' });
    await host.leave();
  });

  it('lets invited people in with their account and guests in with a name', async () => {
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
    const guestRoom = await joinRoom(guest);
    await hostRoom.waitFor(() => hostRoom.remoteIdentities().length === 2, 'two others in the room');
    const s = await settle(host, (x) => x.participants.length === 3);
    expect(s.participants.map((p) => `${p.person.name}|${p.isOrganizer}|${p.isMe}`).sort()).toEqual(
      [`${org.session.user.name}|true|true`, `${invited.session.user.name}|false|false`, 'Sam|false|false'].sort()
    );
    await hostRoom.publishTone();
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
    expect(code(await first.appendAudio(piece(audioBytes('late'), 0, 1)).catch((e: unknown) => e))).toBe('conflict');
    await second.appendAudio(piece(audioBytes('second-device'), 1, 0));
    await second.leave();
  });

  it('lets a guest catch up and ask with their pass, and refuses passes for other calls', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({ notes: 'off' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const guest = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    expect(code(await guest.catchUp().catch((e: unknown) => e))).toBe('conflict');

    host.setNotes(true);
    await settle(host, (x) => x.notes.status === 'on');
    await host.appendAudio(piece(audioBytes('catch'), 0, 0));
    await host.transcribe(speech('We should move the launch. // Can we afford the delay?', 0, 0));
    expect(await guest.catchUp()).toMatchObject({ lines: 2 });
    expect(await guest.askSoFar('What should move?')).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text' })]));
    expect(code(await guest.transcribe(speech('Not mine to send.', 0, 5000)).catch((e: unknown) => e))).toBe('forbidden');

    const otherOrg = await account();
    const otherCall = await otherOrg.api.calls.join((await otherOrg.api.calls.startNow({})).code, { mic: true, cam: false });
    const r = await fetch(`${h.baseUrl}/v1/live/calls/${otherCall.ticket.callId}`, { headers: { 'x-alcove-call': guest.ticket.pass } });
    expect(r.status).toBe(401);
    await otherCall.leave();
    await host.leave();
  });

  it('validates guest names and keeps them and passes out of rows and logs', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const guest = guestBrowser();
    for (const name of [undefined, '   ', 'x'.repeat(61)]) {
      expect(code(await guest.calls.join(c, { mic: true, cam: false, ...(name === undefined ? {} : { name }) }).catch((e: unknown) => e))).toBe('invalid');
    }
    const g = await guest.calls.join(c, { mic: true, cam: false, name: '  CANARY-NAME Ada  ' });
    const hostRoom = await joinRoom(host);
    await joinRoom(g);
    await hostRoom.waitFor(() => hostRoom.room.remoteParticipants.get(g.ticket.identity)?.name === 'CANARY-NAME Ada', 'the trimmed guest name in LiveKit');
    await expectNotInRows(['calls', 'call_codes'], ['CANARY-NAME', c]);
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
