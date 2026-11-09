import { DirectTextSchema, type CallSession } from '@alcove/api';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cookieFetch, ORIGIN, startHarness, type Harness } from '../../testing/harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterEach(() => h.closeCalls());
afterAll(async () => { await h?.close(); });
let sequence = 0;
async function account() {
  const b = h.browser();
  const session = (await b.api.auth.signIn('sso', { email: `private.thread.${Date.now()}.${sequence++}@vandelay.example` })).session;
  return { ...b, session };
}
async function until(ready: () => boolean, what: string): Promise<void> {
  const end = Date.now() + 15_000;
  while (!ready()) { if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`); await new Promise((resolve) => setTimeout(resolve, 30)); }
}
async function pair(a: CallSession, b: CallSession): Promise<void> {
  await until(() => a.direct.getSnapshot().peers.includes(b.ticket.identity) && b.direct.getSnapshot().peers.includes(a.ticket.identity), 'authenticated private audience');
}

describe('private conversation threads', () => {
  it('replies to a private original and then a reply with one canonical root, without revealing any thread to the host', async () => {
    const org = await account(); const a = await account(); const b = await account();
    const { code } = await org.api.calls.startNow({ guests: [a.session.user.email, b.session.user.email], notes: 'off' });
    const host = await org.api.calls.join(code, { mic: false, cam: false });
    const alice = await a.api.calls.join(code, { mic: false, cam: false });
    const bob = await b.api.calls.join(code, { mic: false, cam: false });
    await pair(alice, bob);
    await alice.direct.send(bob.ticket.identity, 'Can you share the agenda?');
    await until(() => bob.direct.getSnapshot().messages.length === 1, 'private original');
    const original = bob.direct.getSnapshot().messages[0];
    if (!original) throw new Error('No original');
    const thread = { root: original.id, replyTo: original.id };
    await bob.direct.send(alice.ticket.identity, 'Here is the agenda.', [], thread);
    await until(() => alice.direct.getSnapshot().messages.length === 2, 'private reply');
    const reply = alice.direct.getSnapshot().messages.find((m) => m.text === 'Here is the agenda.');
    expect(reply?.thread).toEqual(thread);
    if (!reply) throw new Error('No reply');
    const nested = { root: original.id, replyTo: reply.id };
    await alice.direct.send(bob.ticket.identity, 'Thank you.', [], nested);
    await until(() => bob.direct.getSnapshot().messages.length === 3, 'reply to a reply');
    expect(bob.direct.getSnapshot().messages.find((m) => m.text === 'Thank you.')?.thread).toEqual(nested);
    expect(host.direct.getSnapshot().messages).toEqual([]);
    expect(host.crypto.getSnapshot().chat).toEqual([]);
    await host.leave();
    expect((await h.pool.query('SELECT count(*) FROM call_private_messages')).rows[0]?.count).toBe('0');
    await until(() => bob.direct.getSnapshot().messages.length === 0, 'thread history cleanup');
  });

  it('refuses invented roots, another private audience, a reply as a new root and the original room after a move', async () => {
    const org = await account(); const a = await account(); const b = await account();
    const { code } = await org.api.calls.startNow({ guests: [a.session.user.email, b.session.user.email], notes: 'off' });
    const host = await org.api.calls.join(code, { mic: false, cam: false });
    const alice = await a.api.calls.join(code, { mic: false, cam: false });
    const bob = await b.api.calls.join(code, { mic: false, cam: false });
    await pair(alice, bob); await pair(alice, host);
    await alice.direct.send(bob.ticket.identity, 'Only this pair.');
    await alice.direct.send(host.ticket.identity, 'A different private audience.');
    await until(() => bob.direct.getSnapshot().messages.length === 1 && host.direct.getSnapshot().messages.length === 1, 'both separate private audiences');
    const original = bob.direct.getSnapshot().messages[0];
    const other = host.direct.getSnapshot().messages[0];
    if (!original || !other) throw new Error('Missing originals');
    await expect(bob.direct.send(alice.ticket.identity, 'Invented root', [], { root: 'unknown', replyTo: original.id })).rejects.toMatchObject({ code: 'not-found' });
    await expect(alice.direct.send(bob.ticket.identity, 'Other peer', [], { root: other.id, replyTo: other.id })).rejects.toMatchObject({ code: 'not-found' });
    await expect(alice.direct.send(host.ticket.identity, 'Never widen the audience', [], { root: original.id, replyTo: original.id })).rejects.toMatchObject({ code: 'not-found' });
    await bob.direct.send(alice.ticket.identity, 'A real reply.', [], { root: original.id, replyTo: original.id });
    await until(() => alice.direct.getSnapshot().messages.length === 3, 'confirmed reply');
    const reply = alice.direct.getSnapshot().messages.find((m) => m.text === 'A real reply.');
    if (!reply) throw new Error('Missing reply');
    await expect(alice.direct.send(bob.ticket.identity, 'No second root', [], { root: reply.id, replyTo: reply.id })).rejects.toMatchObject({ code: 'not-found' });
    host.openRooms({ rooms: [{ name: 'Design', emails: [a.session.user.email, b.session.user.email] }, { name: 'Support', emails: [] }], minutes: 5, board: { mode: 'none', template: 'blank' } });
    await until(() => alice.crypto.getSnapshot().place !== 'main' && alice.crypto.getSnapshot().place === bob.crypto.getSnapshot().place, 'new same-pair room');
    await pair(alice, bob);
    await expect(alice.direct.send(bob.ticket.identity, 'Old room parent', [], { root: original.id, replyTo: original.id })).rejects.toMatchObject({ code: 'not-found' });
    expect((await h.pool.query('SELECT count(*) FROM call_private_messages')).rows[0]?.count).toBe('3');
    await host.leave();
  });

  it('refuses cryptographically authentic forged parent references without granting another conversation, and reads an older encrypted text payload', async () => {
    const org = await account(); const a = await account(); const b = await account();
    const { code } = await org.api.calls.startNow({ guests: [a.session.user.email, b.session.user.email], notes: 'off' });
    const host = await org.api.calls.join(code, { mic: false, cam: false });
    const alice = await a.api.calls.join(code, { mic: false, cam: false });
    const bob = await b.api.calls.join(code, { mic: false, cam: false });
    await pair(alice, bob); await pair(alice, host);
    await alice.direct.send(bob.ticket.identity, 'Original pair message.');
    await alice.direct.send(host.ticket.identity, 'Original different audience.');
    await until(() => bob.direct.getSnapshot().messages.length === 1 && host.direct.getSnapshot().messages.length === 1, 'private originals');
    const original = bob.direct.getSnapshot().messages[0]; const other = host.direct.getSnapshot().messages[0];
    if (!original || !other) throw new Error('Missing originals');
    const real = crypto.subtle.encrypt.bind(crypto.subtle);
    // A malicious sender still uses the real pair key and AEAD; only the application payload is forged.
    const malicious = vi.spyOn(crypto.subtle, 'encrypt').mockImplementation((algorithm, key, data) => {
      if (typeof algorithm !== 'string' && 'additionalData' in algorithm && ArrayBuffer.isView(algorithm.additionalData) && new TextDecoder().decode(algorithm.additionalData).startsWith('["alcove/private-message/v1"')) {
        const raw: unknown = JSON.parse(new TextDecoder().decode(data));
        const payload = DirectTextSchema.parse(raw);
        if (payload.text === 'Forged other audience') return real(algorithm, key, new TextEncoder().encode(JSON.stringify({ ...payload, thread: { root: other.id, replyTo: other.id } })));
        if (payload.text === 'Forged canonical root') return real(algorithm, key, new TextEncoder().encode(JSON.stringify({ ...payload, thread: { root: other.id, replyTo: original.id } })));
        if (payload.text === 'Previous release payload') return real(algorithm, key, new TextEncoder().encode(JSON.stringify({ text: payload.text })));
      }
      return real(algorithm, key, data);
    });
    try {
      await alice.direct.send(bob.ticket.identity, 'Forged other audience');
      await alice.direct.send(bob.ticket.identity, 'Forged canonical root');
      await alice.direct.send(bob.ticket.identity, 'Previous release payload');
      await until(() => bob.direct.getSnapshot().messages.some((m) => m.text === 'Previous release payload'), 'valid historical payload after refused parents');
      expect(bob.direct.getSnapshot().messages.map((m) => m.text)).toEqual(['Original pair message.', 'Previous release payload']);
      expect(bob.direct.getSnapshot().messages.at(-1)?.thread).toBeNull();
      expect(bob.direct.getSnapshot().messages.at(-1)?.mentions).toEqual([]);
      expect(bob.direct.getSnapshot().unreadMentions).toEqual([]);
      await until(() => alice.direct.getSnapshot().messages.find((m) => m.text === 'Previous release payload')?.state === 'delivered', 'historical payload receipt');
      expect(alice.direct.getSnapshot().messages.filter((m) => m.text.startsWith('Forged')).every((m) => m.state === 'sent')).toBe(true);
      expect(host.direct.getSnapshot().messages).toHaveLength(1);
    } finally { malicious.mockRestore(); }
    await host.leave();
  });

  it('retries an uncertain private threaded send with exactly the original ID and ciphertext, without duplicate replies', async () => {
    let lose = false; let paused = false;
    const wire: string[] = [];
    const jar = cookieFetch(ORIGIN);
    const recipient = h.browser({ fetch: async (input, init) => {
      const path = String(input);
      if (paused && path.endsWith('/direct/sync')) throw new TypeError('Offline');
      const response = await jar(input, init);
      if (path.endsWith('/direct/messages')) {
        if (typeof init?.body === 'string') wire.push(init.body);
        if (lose) { lose = false; paused = true; throw new TypeError('Successful reply lost'); }
      }
      return response;
    } });
    const org = await account(); const a = await account();
    const email = `private.retry.${Date.now()}@vandelay.example`;
    await recipient.api.auth.signIn('sso', { email });
    const { code } = await org.api.calls.startNow({ guests: [a.session.user.email, email], notes: 'off' });
    const host = await org.api.calls.join(code, { mic: false, cam: false });
    const alice = await a.api.calls.join(code, { mic: false, cam: false });
    const bob = await recipient.api.calls.join(code, { mic: false, cam: false });
    await pair(alice, bob);
    await alice.direct.send(bob.ticket.identity, 'Original before uncertain reply.');
    await until(() => bob.direct.getSnapshot().messages.length === 1, 'private original');
    const original = bob.direct.getSnapshot().messages[0];
    if (!original) throw new Error('No original');
    const thread = { root: original.id, replyTo: original.id };
    lose = true;
    await bob.direct.send(alice.ticket.identity, 'Only one private reply.', [], thread);
    const failed = bob.direct.getSnapshot().messages.find((m) => m.text === 'Only one private reply.');
    expect(failed?.state).toBe('failed');
    expect(failed?.thread).toEqual(thread);
    if (!failed) throw new Error('No failed reply');
    paused = false;
    await until(() => bob.direct.getSnapshot().ready, 'same audience reauthorization');
    await bob.direct.retry(failed.id);
    expect(wire).toHaveLength(2);
    expect(wire[0]).toBe(wire[1]);
    await until(() => alice.direct.getSnapshot().messages.length === 2 && bob.direct.getSnapshot().messages.find((m) => m.id === failed.id)?.state === 'delivered', 'one acknowledged threaded reply');
    expect(alice.direct.getSnapshot().messages.find((m) => m.id === failed.id)?.thread).toEqual(thread);
    expect((await h.pool.query('SELECT count(*) FROM call_private_messages')).rows[0]?.count).toBe('2');
    expect(host.direct.getSnapshot().messages).toEqual([]);
    await host.leave();
  });
});
