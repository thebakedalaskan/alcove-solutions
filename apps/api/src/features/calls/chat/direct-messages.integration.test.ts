import { AlcoveApiError, CALL_PASS_HEADER, DirectSendSchema, DirectSyncSchema, type CallSession, type CallState } from '@alcove/api';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cookieFetch, ORIGIN, startHarness, type Harness } from '../../../testing/harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterEach(() => h.closeCalls());
afterAll(async () => { await h?.close(); });
let sequence = 0;
async function account(email = `direct.${Date.now()}.${sequence++}@tests.example`) {
  const b = h.browser();
  await b.api.auth.signIn('sso', { email });
  return b;
}
async function until(ready: () => boolean, what: string): Promise<void> {
  const end = Date.now() + 15_000;
  while (!ready()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 30));
  }
}
async function settle(call: CallSession, ready: (s: CallState) => boolean): Promise<void> {
  for (let n = 0; n < 100 && !ready(call.getSnapshot()); n++) { await call.refresh(); await new Promise((r) => setTimeout(r, 30)); }
  expect(ready(call.getSnapshot())).toBe(true);
}
async function admit(host: CallSession, guest: CallSession): Promise<void> {
  await settle(host, (s) => s.waiting.some((p) => p.id === guest.ticket.identity));
  await host.admit(guest.ticket.identity);
  await until(() => guest.crypto.getSnapshot().status === 'in', 'admitted guest');
}
const apiCode = (e: unknown) => e instanceof AlcoveApiError ? e.code : 'unexpected';
const peers = async (a: CallSession, b: CallSession) => until(() => a.direct.getSnapshot().peers.includes(b.ticket.identity) && b.direct.getSnapshot().peers.includes(a.ticket.identity), 'authenticated pair keys');
const inbox = (by: CallSession) => fetch(`${h.baseUrl}/v1/live/calls/${by.ticket.callId}/direct/sync`, {
  method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', [CALL_PASS_HEADER]: by.ticket.pass }, body: JSON.stringify({ ids: [], after: 0 })
});

describe('private messages inside a call', () => {
  it('offers a recipient-only conversation to admitted guests, apart from room chat', async () => {
    const b = await account();
    const { code } = await b.api.calls.startNow({ notes: 'off' });
    const host = await b.api.calls.join(code, { mic: false, cam: false });
    const guest = await h.browser().api.calls.join(code, { mic: false, cam: false, name: 'Sam' });
    await admit(host, guest);
    expect(host).toHaveProperty('direct');
    expect(guest).toHaveProperty('direct');
    await until(() => host.direct.getSnapshot().peers.includes(guest.ticket.identity) && guest.direct.getSnapshot().peers.includes(host.ticket.identity), 'authenticated private keys');
    await host.direct.send(guest.ticket.identity, 'Only Sam should read this.');
    await until(() => guest.direct.getSnapshot().messages.length === 1, 'private delivery');
    expect(guest.direct.getSnapshot().messages[0]?.text).toBe('Only Sam should read this.');
    expect(guest.crypto.getSnapshot().chat).toEqual([]);
    await until(() => host.direct.getSnapshot().messages[0]?.state === 'delivered', 'recipient acknowledgment');
    await host.leave();
  });

  it('delivers only to the original recipient, never the host, room chat, late arrivals, notes or readable storage', async () => {
    const org = await account();
    const { code } = await org.api.calls.startNow({ notes: 'on' });
    const host = await org.api.calls.join(code, { mic: false, cam: false });
    const alice = await h.browser().api.calls.join(code, { mic: false, cam: false, name: 'Alice' });
    const bob = await h.browser().api.calls.join(code, { mic: false, cam: false, name: 'Bo' });
    await admit(host, alice); await admit(host, bob); await peers(alice, bob);
    const canary = 'CANARY-PRIVATE-DIRECT-ONLY-ALICE-BO';
    await alice.direct.send(bob.ticket.identity, canary);
    await until(() => bob.direct.getSnapshot().messages.some((m) => m.text === canary), 'recipient-only delivery');
    await bob.direct.send(alice.ticket.identity, 'Understood.');
    await until(() => alice.direct.getSnapshot().messages.length === 2, 'private reply');
    const late = await h.browser().api.calls.join(code, { mic: false, cam: false, name: 'Lee' });
    await admit(host, late); await peers(alice, late);
    expect(host.direct.getSnapshot().messages).toEqual([]);
    expect(late.direct.getSnapshot().messages).toEqual([]);
    expect(DirectSyncSchema.parse(await (await inbox(host)).json()).messages).toEqual([]);
    expect(DirectSyncSchema.parse(await (await inbox(late)).json()).messages).toEqual([]);
    for (const call of [host, alice, bob, late]) {
      expect(JSON.stringify(call.getSnapshot())).not.toContain(canary);
      expect(JSON.stringify(call.crypto.getSnapshot().chat)).not.toContain(canary);
    }
    const stored = await h.pool.query('SELECT * FROM call_private_messages');
    expect(stored.rows.length).toBe(2);
    expect(JSON.stringify(stored.rows)).not.toContain(canary);
    expect(h.logs.join('')).not.toContain(canary);
    expect(h.logs.join('')).not.toContain(alice.ticket.identity);
    const result = await host.leave();
    expect((await h.pool.query('SELECT count(*) FROM call_private_messages')).rows[0]?.count).toBe('0');
    if (!result?.pendingNoteId) throw new Error('Call had no note');
    expect(JSON.stringify(await org.api.notes.get(result.pendingNoteId))).not.toContain(canary);
    await until(() => bob.direct.getSnapshot().messages.length === 0, 'call-end history cleanup');
  });

  it('carries a reaction on a private message to its other person alone, as nothing new to read', async () => {
    const org = await account();
    const { code } = await org.api.calls.startNow({ notes: 'off' });
    const host = await org.api.calls.join(code, { mic: false, cam: false });
    const alice = await h.browser().api.calls.join(code, { mic: false, cam: false, name: 'Alice' });
    const bob = await h.browser().api.calls.join(code, { mic: false, cam: false, name: 'Bo' });
    await admit(host, alice); await admit(host, bob); await peers(alice, bob);
    await alice.direct.send(bob.ticket.identity, 'The checklist is ready.');
    await until(() => bob.direct.getSnapshot().messages.some((m) => m.text === 'The checklist is ready.'), 'private message');
    const message = bob.direct.getSnapshot().messages.find((m) => m.text === 'The checklist is ready.');
    if (!message) throw new Error('No private message');
    const reactionsAt = (call: CallSession) => call.direct.getSnapshot().messages.find((m) => m.id === message.id)?.reactions ?? [];
    await bob.direct.react(message.id, 'heart', true);
    expect(reactionsAt(bob)).toEqual([{ reaction: 'heart', by: [bob.ticket.identity] }]);
    await until(() => reactionsAt(alice).length === 1, 'reaction at the sender');
    expect(reactionsAt(alice)).toEqual([{ reaction: 'heart', by: [bob.ticket.identity] }]);
    // A reaction is no message: the conversation still has one, and nothing new to read.
    expect(alice.direct.getSnapshot().messages).toHaveLength(1);
    await alice.direct.react(message.id, 'heart', true);
    await until(() => reactionsAt(bob)[0]?.by.length === 2, 'both reactions at the recipient');
    expect(bob.direct.getSnapshot().messages).toHaveLength(1);
    expect(bob.direct.getSnapshot().unread).toEqual([message.id]);
    await bob.direct.react(message.id, 'heart', false);
    await until(() => reactionsAt(alice)[0]?.by.join() === alice.ticket.identity, 'a reaction taken back');
    await expect(alice.direct.react('not-a-private-message', 'heart', true)).rejects.toMatchObject({ code: 'not-found' });
    // Nobody else's inbox, room chat or call state carries any of it.
    expect(host.direct.getSnapshot().messages).toEqual([]);
    expect(host.crypto.getSnapshot().chat).toEqual([]);
    expect(DirectSyncSchema.parse(await (await inbox(host)).json()).messages).toEqual([]);
    for (const call of [host, alice, bob]) expect(JSON.stringify(call.getSnapshot())).not.toContain('The checklist is ready.');
    await host.leave();
  });

  it('takes a private reaction back here when the relay refuses it, and refuses one once rooms have split the two', async () => {
    let refuse = false;
    const jar = cookieFetch(ORIGIN);
    // Bo's browser asks the relay for a connection that isn't in the call: the relay refuses it, as it does once Alice has gone.
    const bobBrowser = h.browser({ fetch: (input, init) => {
      if (!refuse || !String(input).endsWith('/direct/messages') || typeof init?.body !== 'string') return jar(input, init);
      const sent: unknown = JSON.parse(init.body);
      return jar(input, { ...init, body: JSON.stringify({ ...DirectSendSchema.parse(sent), to: `p_${'A'.repeat(22)}` }) });
    } });
    const org = await account();
    const aliceEmail = `react.alice.${Date.now()}@tests.example`;
    const bobEmail = `react.bob.${Date.now()}@tests.example`;
    const a = await account(aliceEmail);
    await bobBrowser.api.auth.signIn('sso', { email: bobEmail });
    const { code } = await org.api.calls.startNow({ guests: [aliceEmail, bobEmail], notes: 'off' });
    const host = await org.api.calls.join(code, { mic: false, cam: false });
    const alice = await a.api.calls.join(code, { mic: false, cam: false });
    const bob = await bobBrowser.api.calls.join(code, { mic: false, cam: false });
    await peers(alice, bob);
    await alice.direct.send(bob.ticket.identity, 'Can you check the rollout?');
    await until(() => bob.direct.getSnapshot().messages.length === 1, 'private message');
    const message = bob.direct.getSnapshot().messages[0];
    if (!message) throw new Error('No private message');
    const reactionsAt = (call: CallSession) => call.direct.getSnapshot().messages.find((m) => m.id === message.id)?.reactions ?? [];
    refuse = true;
    expect(apiCode(await bob.direct.react(message.id, 'heart', true).catch((e: unknown) => e))).toBe('conflict');
    refuse = false;
    expect(reactionsAt(bob)).toEqual([]);
    await alice.refresh();
    expect(reactionsAt(alice)).toEqual([]);
    host.openRooms({ rooms: [{ name: 'Design', emails: [aliceEmail] }, { name: 'Support', emails: [bobEmail] }], minutes: 5, board: { mode: 'none', template: 'blank' } });
    await until(() => alice.crypto.getSnapshot().place !== 'main' && bob.crypto.getSnapshot().place !== 'main' && alice.crypto.getSnapshot().place !== bob.crypto.getSnapshot().place, 'separate rooms');
    await until(() => !alice.direct.getSnapshot().peers.includes(bob.ticket.identity), 'conversation unavailable');
    // Its history stays here to read, but nothing more reaches across rooms, a reaction included.
    expect(apiCode(await alice.direct.react(message.id, 'heart', true).catch((e: unknown) => e))).toBe('conflict');
    expect(reactionsAt(alice)).toEqual([]);
    expect(DirectSyncSchema.parse(await (await inbox(bob)).json()).messages).toEqual([]);
    await host.leave();
  });

  it('refuses waiting, other-call and removed senders and recipients, without redirecting their conversation', async () => {
    const org = await account();
    const { code } = await org.api.calls.startNow({ notes: 'off' });
    const host = await org.api.calls.join(code, { mic: false, cam: false });
    const alice = await h.browser().api.calls.join(code, { mic: false, cam: false, name: 'Alice' });
    const bob = await h.browser().api.calls.join(code, { mic: false, cam: false, name: 'Bo' });
    expect((await inbox(alice)).status).toBe(403);
    expect(apiCode(await alice.direct.send(host.ticket.identity, 'No admission').catch((e: unknown) => e))).toBe('conflict');
    await admit(host, alice); await admit(host, bob); await peers(alice, bob);
    await alice.direct.send(bob.ticket.identity, 'Keep this history for the active session.');
    await until(() => bob.direct.getSnapshot().messages.length === 1, 'received history');
    const other = await account();
    const second = await other.api.calls.startNow({ notes: 'off' });
    const stranger = await other.api.calls.join(second.code, { mic: false, cam: false });
    expect(apiCode(await alice.direct.send(stranger.ticket.identity, 'Other call').catch((e: unknown) => e))).toBe('conflict');
    const original = DirectSyncSchema.parse(await (await inbox(alice)).json()).messages[0];
    if (!original) throw new Error('No original private envelope');
    const post = (callId: string, pass: string, to: string) => fetch(`${h.baseUrl}/v1/live/calls/${callId}/direct/messages`, {
      method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', [CALL_PASS_HEADER]: pass }, body: JSON.stringify(DirectSendSchema.parse({ ...original, to }))
    });
    expect((await post(alice.ticket.callId, alice.ticket.pass, stranger.ticket.identity)).status).toBe(409);
    expect((await post(stranger.ticket.callId, alice.ticket.pass, stranger.ticket.identity)).status).toBe(401);
    expect((await post(alice.ticket.callId, stranger.ticket.pass, bob.ticket.identity)).status).toBe(401);
    expect((await post(alice.ticket.callId, alice.ticket.pass, host.ticket.identity)).status).toBe(409);
    await host.remove(bob.ticket.identity);
    await until(() => !alice.direct.getSnapshot().peers.includes(bob.ticket.identity), 'removed recipient unavailable');
    expect(apiCode(await alice.direct.send(bob.ticket.identity, 'Removed person').catch((e: unknown) => e))).toBe('conflict');
    expect((await inbox(bob)).status).toBe(403);
    await until(() => bob.direct.getSnapshot().messages.length === 0, 'removed recipient local cleanup');
    const replacement = await h.browser().api.calls.join(code, { mic: false, cam: false, name: 'Bo' });
    await admit(host, replacement); await peers(alice, replacement);
    expect(replacement.direct.getSnapshot().messages).toEqual([]);
    expect(alice.direct.getSnapshot().messages[0]?.to).toBe(bob.ticket.identity);
    expect(alice.direct.getSnapshot().peers).not.toContain(bob.ticket.identity);
    await stranger.leave(); await host.leave();
  });

  it('keeps the original ciphertext and ID when a successful provider response is lost and retried', async () => {
    let fail = true;
    let paused = false;
    const requests: string[] = [];
    const jar = cookieFetch(ORIGIN);
    const sender = h.browser({ fetch: async (input, init) => {
      const path = String(input);
      if (paused && path.endsWith('/direct/sync')) throw new TypeError('Offline');
      const response = await jar(input, init);
      if (path.endsWith('/direct/messages')) {
        if (typeof init?.body === 'string') requests.push(init.body);
        if (fail) { fail = false; paused = true; throw new TypeError('Response lost'); }
      }
      return response;
    } });
    await sender.api.auth.signIn('sso', { email: `retry.${Date.now()}@tests.example` });
    const { code } = await sender.api.calls.startNow({ notes: 'off' });
    const host = await sender.api.calls.join(code, { mic: false, cam: false });
    const guest = await h.browser().api.calls.join(code, { mic: false, cam: false, name: 'Sam' });
    await admit(host, guest); await peers(host, guest);
    await host.direct.send(guest.ticket.identity, 'Retry exactly once in this conversation.');
    expect(host.direct.getSnapshot().messages[0]?.state).toBe('failed');
    const message = host.direct.getSnapshot().messages[0];
    if (!message) throw new Error('No failed message');
    paused = false;
    await until(() => host.direct.getSnapshot().ready, 'reauthorized sender');
    await host.direct.retry(message.id);
    expect(requests.length).toBe(2);
    expect(requests[0]).toBe(requests[1]);
    paused = false;
    await until(() => guest.direct.getSnapshot().messages.length === 1 && host.direct.getSnapshot().messages[0]?.state === 'delivered', 'deduplicated receipt');
    await host.direct.retry(message.id);
    expect(guest.direct.getSnapshot().messages).toHaveLength(1);
    expect((await h.pool.query('SELECT count(*) FROM call_private_messages')).rows[0]?.count).toBe('1');
    await host.leave();
  });

  it('stops old-room delivery, keeps received history local and reauthenticates peers in their new room', async () => {
    const org = await account();
    const aliceEmail = `alice.${Date.now()}@tests.example`;
    const bobEmail = `bob.${Date.now()}@tests.example`;
    const a = await account(aliceEmail); const b = await account(bobEmail);
    const { code } = await org.api.calls.startNow({ guests: [aliceEmail, bobEmail], notes: 'off' });
    const host = await org.api.calls.join(code, { mic: false, cam: false });
    const alice = await a.api.calls.join(code, { mic: false, cam: false });
    const bob = await b.api.calls.join(code, { mic: false, cam: false });
    await peers(alice, bob);
    await alice.direct.send(bob.ticket.identity, 'Only this original room.');
    await until(() => bob.direct.getSnapshot().messages.length === 1, 'initial room delivery');
    host.openRooms({ rooms: [{ name: 'Design', emails: [aliceEmail] }, { name: 'Support', emails: [bobEmail] }], minutes: 5, board: { mode: 'none', template: 'blank' } });
    await until(() => alice.crypto.getSnapshot().place !== 'main' && bob.crypto.getSnapshot().place !== 'main' && alice.crypto.getSnapshot().place !== bob.crypto.getSnapshot().place, 'separate room memberships');
    await until(() => !alice.direct.getSnapshot().peers.includes(bob.ticket.identity), 'old conversation unavailable');
    expect(apiCode(await alice.direct.send(bob.ticket.identity, 'Never cross rooms').catch((e: unknown) => e))).toBe('conflict');
    expect(bob.direct.getSnapshot().messages[0]?.text).toBe('Only this original room.');
    expect(DirectSyncSchema.parse(await (await inbox(bob)).json()).messages).toEqual([]);
    host.closeRooms(); await until(() => alice.crypto.getSnapshot().place === 'main' && bob.crypto.getSnapshot().place === 'main', 'main room restored');
    await peers(alice, bob);
    await bob.direct.send(alice.ticket.identity, 'Back together, new delivery.');
    await until(() => alice.direct.getSnapshot().messages.length === 2, 'new same-room reply');
    expect(bob.direct.getSnapshot().messages.filter((m) => m.text === 'Only this original room.')).toHaveLength(1);
    await host.leave();
  });

  it('reauthorizes temporary reconnects before restoring history and handles simultaneous sends and unread receipts once', async () => {
    let offline = false;
    const jar = cookieFetch(ORIGIN);
    const guestBrowser = h.browser({ fetch: (input, init) => offline && String(input).includes('/live/calls/') ? Promise.reject(new TypeError('Offline')) : jar(input, init) });
    const org = await account();
    const { code } = await org.api.calls.startNow({ notes: 'off' });
    const host = await org.api.calls.join(code, { mic: false, cam: false });
    const guest = await guestBrowser.api.calls.join(code, { mic: false, cam: false, name: 'Sam' });
    await admit(host, guest); await peers(host, guest);
    await Promise.all([host.direct.send(guest.ticket.identity, 'A'), guest.direct.send(host.ticket.identity, 'B')]);
    await until(() => host.direct.getSnapshot().messages.length === 2 && guest.direct.getSnapshot().messages.length === 2, 'simultaneous private messages');
    expect(host.direct.getSnapshot().messages.map((m) => m.id)).toEqual(guest.direct.getSnapshot().messages.map((m) => m.id));
    expect(guest.direct.getSnapshot().unread).toHaveLength(1);
    guest.direct.read(guest.direct.getSnapshot().unread);
    offline = true;
    await until(() => !guest.direct.getSnapshot().ready, 'private history suspended');
    expect(guest.direct.getSnapshot().messages).toHaveLength(2);
    expect(apiCode(await guest.direct.send(host.ticket.identity, 'Wait for current authorization').catch((e: unknown) => e))).toBe('conflict');
    offline = false;
    await until(() => guest.direct.getSnapshot().ready, 'membership rechecked');
    expect(guest.direct.getSnapshot().messages).toHaveLength(2);
    expect(guest.direct.getSnapshot().unread).toEqual([]);
    await guest.direct.send(host.ticket.identity, 'Reauthorized original conversation.');
    await until(() => host.direct.getSnapshot().messages.length === 3, 'reconnected private send');
    await host.leave();
  });

  it('skips permanently invalid bindings and ciphertext without starving a later page or falsely acknowledging them', async () => {
    let paused = false;
    let seen = false;
    let badKey = '';
    let badCiphertext = '';
    const jar = cookieFetch(ORIGIN);
    const b = h.browser({ fetch: async (input, init) => {
      if (paused && String(input).endsWith('/direct/sync')) throw new TypeError('Offline');
      const response = await jar(input, init);
      if (!String(input).endsWith('/direct/sync') || !response.ok) return response;
      const data = DirectSyncSchema.parse(await response.clone().json());
      if (data.messages.some((m) => m.id === badKey || m.id === badCiphertext)) {
        seen = true;
        return new Response(JSON.stringify({ ...data, messages: data.messages.map((m) => m.id === badKey ? { ...m, fromKey: m.toKey } : m.id === badCiphertext ? { ...m, ciphertext: 'A'.repeat(m.ciphertext.length) } : m) }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return response;
    } });
    const org = await account();
    const { code } = await org.api.calls.startNow({ notes: 'off' });
    const host = await org.api.calls.join(code, { mic: false, cam: false });
    const guest = await b.api.calls.join(code, { mic: false, cam: false, name: 'Sam' });
    await admit(host, guest); await peers(host, guest);
    paused = true;
    await until(() => !guest.direct.getSnapshot().ready, 'private relay paused');
    await host.direct.send(guest.ticket.identity, 'Rejected substituted fingerprint.');
    await host.direct.send(guest.ticket.identity, 'Rejected invalid ciphertext.');
    badKey = host.direct.getSnapshot().messages[0]?.id ?? '';
    badCiphertext = host.direct.getSnapshot().messages[1]?.id ?? '';
    await Promise.all(Array.from({ length: 105 }, (_, i) => host.direct.send(guest.ticket.identity, `Authentic later line ${i}`)));
    paused = false;
    await until(() => seen, 'substituted relay response');
    await until(() => guest.direct.getSnapshot().messages.length === 105 && host.direct.getSnapshot().messages.filter((m) => m.state === 'delivered').length === 105, 'later authentic page and receipts');
    expect(guest.direct.getSnapshot().messages.every((m) => m.text.startsWith('Authentic later line '))).toBe(true);
    expect(host.direct.getSnapshot().messages.filter((m) => m.id === badKey || m.id === badCiphertext).every((m) => m.state === 'sent')).toBe(true);
    await host.leave();
  });

  it('keeps an in-flight encryption in its original room when real key preparation finishes after a move', async () => {
    const org = await account();
    const aliceEmail = `gate.alice.${Date.now()}@tests.example`;
    const bobEmail = `gate.bob.${Date.now()}@tests.example`;
    const a = await account(aliceEmail); const b = await account(bobEmail);
    const { code } = await org.api.calls.startNow({ guests: [aliceEmail, bobEmail], notes: 'off' });
    const host = await org.api.calls.join(code, { mic: false, cam: false });
    const alice = await a.api.calls.join(code, { mic: false, cam: false });
    const bob = await b.api.calls.join(code, { mic: false, cam: false });
    await peers(alice, bob);
    const generation = alice.getSnapshot().generation;
    let release = () => {};
    let waiting = false;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const real = crypto.subtle.encrypt.bind(crypto.subtle);
    // Delay the real crypto result only; every key, authentication check and ciphertext remains real.
    const delayed = vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async (algorithm, key, data) => {
      const ciphertext = await real(algorithm, key, data);
      if (typeof algorithm !== 'string' && 'additionalData' in algorithm && ArrayBuffer.isView(algorithm.additionalData) && new TextDecoder().decode(algorithm.additionalData).startsWith('["alcove/private-message/v1"')) { waiting = true; await gate; }
      return ciphertext;
    });
    try {
      const sending = alice.direct.send(bob.ticket.identity, 'Original room draft only.');
      await until(() => waiting, 'private encryption scheduling gate');
      host.openRooms({ rooms: [{ name: 'Design', emails: [aliceEmail, bobEmail] }, { name: 'Support', emails: [] }], minutes: 5, board: { mode: 'none', template: 'blank' } });
      await until(() => alice.crypto.getSnapshot().place !== 'main' && bob.crypto.getSnapshot().place === alice.crypto.getSnapshot().place, 'same peers in a new room');
      await peers(alice, bob);
      release(); await sending;
      const failed = alice.direct.getSnapshot().messages[0];
      expect(failed?.place).toBe('main');
      expect(failed?.generation).toBe(generation);
      expect(failed?.state).toBe('failed');
      if (!failed) throw new Error('No original failed message');
      await alice.direct.retry(failed.id);
      expect((await h.pool.query('SELECT count(*) FROM call_private_messages')).rows[0]?.count).toBe('0');
      expect(bob.direct.getSnapshot().messages).toEqual([]);
    } finally { release(); delayed.mockRestore(); }
    await host.leave();
  });

  it('drains bounded delivery pages without dropping messages, receipts or unread counts', async () => {
    const org = await account();
    const { code } = await org.api.calls.startNow({ notes: 'off' });
    const host = await org.api.calls.join(code, { mic: false, cam: false });
    const guest = await h.browser().api.calls.join(code, { mic: false, cam: false, name: 'Sam' });
    await admit(host, guest); await peers(host, guest);
    await Promise.all(Array.from({ length: 105 }, (_, i) => host.direct.send(guest.ticket.identity, `Private line ${i}`)));
    await until(() => guest.direct.getSnapshot().messages.length === 105 && host.direct.getSnapshot().messages.every((m) => m.state === 'delivered'), 'all private delivery pages and receipts');
    expect(new Set(guest.direct.getSnapshot().messages.map((m) => m.id)).size).toBe(105);
    expect(guest.direct.getSnapshot().unread).toHaveLength(105);
    const page = DirectSyncSchema.parse(await (await inbox(guest)).json());
    expect(page.messages).toHaveLength(100);
    expect(page.more).toBe(true);
    guest.direct.read(guest.direct.getSnapshot().unread);
    await guest.refresh();
    expect(guest.direct.getSnapshot().unread).toEqual([]);
    await host.leave();
  });
});
