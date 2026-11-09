/** Replies cross the real HTTP API and MLS clients; metadata stays in encrypted room messages. */
import { type CallChatMessage, type CallSession } from '@alcove/api';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cookieFetch, ORIGIN, startHarness, type Harness } from '../../testing/harness';
import { connect, disposeLiveKit, type TestParticipant } from '../../testing/livekit';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
const connections: TestParticipant[] = [];
afterEach(async () => { await Promise.all(connections.splice(0).map((p) => p.disconnect())); h.closeCalls(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });

async function until(read: () => boolean, what: string): Promise<void> {
  const end = Date.now() + 15_000;
  while (!read()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function start() {
  const organizer = h.browser();
  await organizer.api.auth.signIn('sso', { email: `threads.${crypto.randomUUID()}@tests.example` });
  const { code } = await organizer.api.calls.startNow({ notes: 'off' });
  const host = await organizer.api.calls.join(code, { mic: false, cam: false });
  await until(() => host.crypto.getSnapshot().status === 'in', 'host membership');
  return { organizer, code, host };
}

async function guest(host: CallSession, code: string, name: string, browser = h.browser()) {
  const call = await browser.api.calls.join(code, { mic: false, cam: false, name });
  await until(() => host.getSnapshot().waiting.some((p) => p.id === call.ticket.identity), 'guest request');
  await host.admit(call.ticket.identity);
  await until(() => call.crypto.getSnapshot().status === 'in', 'guest membership');
  return call;
}

async function inRoom(call: CallSession, place: string): Promise<void> { await until(() => call.crypto.getSnapshot().place === place && call.crypto.getSnapshot().status === 'in', 'current room'); }

describe('call conversation threads', () => {
  it('keeps concurrent replies under one encrypted original, including replies to a reply', async () => {
    const { host, code } = await start();
    const sam = await guest(host, code, 'Sam');
    const lee = await guest(host, code, 'Lee');
    const marker = `CANARY-THREAD-${crypto.randomUUID()}`;
    await host.sendChat(`${marker} original`);
    await until(() => [sam, lee].every((c) => c.crypto.getSnapshot().chat.some((m) => m.text.endsWith('original'))), 'original at both readers');
    const original = sam.crypto.getSnapshot().chat.find((m) => m.text === `${marker} original`);
    if (!original) throw new Error('No original message');
    const timelines: CallChatMessage[][] = [];
    const stops = [sam, lee].map((c) => c.crypto.subscribe(() => timelines.push(c.crypto.getSnapshot().chat)));
    await Promise.all([
      sam.sendChat(`${marker} Sam reply`, [], { root: original.id, replyTo: original.id }),
      lee.sendChat(`${marker} Lee reply`, [], { root: original.id, replyTo: original.id })
    ]);
    await until(() => host.crypto.getSnapshot().chat.filter((m) => !m.sending).length === 3, 'both replies');
    const reply = host.crypto.getSnapshot().chat.find((m) => m.text === `${marker} Sam reply`);
    expect(reply?.thread).toEqual({ root: original.id, replyTo: original.id });
    if (!reply) throw new Error('No reply');
    await expect(sam.sendChat('No public fallback', [], { root: original.id, replyTo: 'not-here' })).rejects.toMatchObject({ code: 'not-found' });
    await expect(sam.sendChat('No second root', [], { root: reply.id, replyTo: reply.id })).rejects.toMatchObject({ code: 'not-found' });
    await host.sendChat(`${marker} specific reply`, [], { root: original.id, replyTo: reply.id });
    await until(() => [host, sam, lee].every((c) => c.crypto.getSnapshot().chat.filter((m) => !m.sending).length === 4), 'complete thread');
    for (const c of [host, sam, lee]) {
      const messages = c.crypto.getSnapshot().chat;
      expect(messages.find((m) => m.id === original.id)?.thread).toBeNull();
      expect(messages.filter((m) => m.thread?.root === original.id)).toHaveLength(3);
      expect(messages.find((m) => m.text === `${marker} specific reply`)?.thread).toEqual({ root: original.id, replyTo: reply.id });
    }
    stops.forEach((stop) => stop());
    expect(timelines.length).toBeGreaterThan(0);
    for (const timeline of timelines) {
      const pending = timeline.filter((m) => m.id.startsWith('me:'));
      const confirmed = timeline.filter((m) => !m.id.startsWith('me:')).sort((a, b) => Number(a.id.split(':')[0]) - Number(b.id.split(':')[0]) || Number(a.id.split(':')[1]) - Number(b.id.split(':')[1]));
      expect(timeline.map((m) => m.id)).toEqual([...confirmed, ...pending].map((m) => m.id));
    }
    await sam.readChat([reply.id]);
    expect(sam.getSnapshot().chatRead).toContain(reply.id);
    expect(sam.getSnapshot().chatRead).not.toContain(original.id);
    await sam.refresh();
    expect(sam.getSnapshot().chatRead).toContain(reply.id);
    expect(sam.getSnapshot().chatRead).not.toContain(original.id);
    const rows = await h.pool.query<{ body: string }>('SELECT row_to_json(m)::text AS body FROM call_mls m');
    const stored = rows.rows.map((row) => row.body).join('\n');
    for (const value of [marker, Buffer.from(marker).toString('hex'), Buffer.from(marker).toString('base64'), Buffer.from(marker).toString('base64url')]) {
      expect(stored).not.toContain(value);
      expect(h.logs.join('')).not.toContain(value);
    }
    expect(stored).not.toContain('"replyTo":');
    expect(stored).not.toContain('"root":');
    await host.leave();
  });

  it('also sends a reply to everyone only when asked to, and only from inside a thread', async () => {
    const { host, code } = await start();
    const sam = await guest(host, code, 'Sam');
    await host.sendChat('Original for a reply to everyone');
    await until(() => sam.crypto.getSnapshot().chat.some((m) => m.text === 'Original for a reply to everyone' && !m.sending), 'original at the guest');
    const original = sam.crypto.getSnapshot().chat.find((m) => m.text === 'Original for a reply to everyone');
    if (!original) throw new Error('No original message');
    await sam.sendChat('Also for everyone', [], { root: original.id, replyTo: original.id }, true);
    await sam.sendChat('Only in the thread', [], { root: original.id, replyTo: original.id });
    await until(() => host.crypto.getSnapshot().chat.filter((m) => m.thread?.root === original.id && !m.sending).length === 2, 'both replies at the host');
    for (const c of [host, sam]) {
      const chat = c.crypto.getSnapshot().chat;
      expect(chat.find((m) => m.text === 'Also for everyone')).toMatchObject({ broadcast: true, thread: { root: original.id, replyTo: original.id } });
      expect(chat.find((m) => m.text === 'Only in the thread')).toMatchObject({ broadcast: false, thread: { root: original.id, replyTo: original.id } });
      expect(chat.find((m) => m.id === original.id)).toMatchObject({ broadcast: false, thread: null });
    }
    // Sending to everyone is a choice about a reply: a message that answers nothing can't make it.
    await expect(sam.sendChat('Not a reply', [], null, true)).rejects.toMatchObject({ code: 'invalid' });
    await host.leave();
  });

  it('keeps a late arrival’s original unavailable while allowing replies they are now authorized to read', async () => {
    const { host, code } = await start();
    const sam = await guest(host, code, 'Sam');
    await host.sendChat('CANARY-HIDDEN-ORIGINAL');
    await until(() => sam.crypto.getSnapshot().chat.some((m) => m.text === 'CANARY-HIDDEN-ORIGINAL'), 'original before late arrival');
    const original = sam.crypto.getSnapshot().chat.find((m) => m.text === 'CANARY-HIDDEN-ORIGINAL');
    if (!original) throw new Error('No original');
    const lee = await guest(host, code, 'Lee');
    await sam.sendChat('A reply in the current room', [], { root: original.id, replyTo: original.id });
    await until(() => lee.crypto.getSnapshot().chat.some((m) => m.thread?.root === original.id), 'new reply without old original');
    const reply = lee.crypto.getSnapshot().chat.find((m) => m.thread?.root === original.id);
    expect(lee.crypto.getSnapshot().chat.some((m) => m.id === original.id)).toBe(false);
    expect(lee.crypto.getSnapshot().chat.map((m) => m.text)).not.toContain('CANARY-HIDDEN-ORIGINAL');
    if (!reply) throw new Error('No readable reply');
    await lee.sendChat('Answer to the readable reply', [], { root: original.id, replyTo: reply.id });
    await until(() => host.crypto.getSnapshot().chat.some((m) => m.text === 'Answer to the readable reply'), 'late arrival reply');
    await host.remove(lee.ticket.identity);
    await until(() => lee.crypto.getSnapshot().status === 'removed', 'removed reader');
    await expect(lee.sendChat('No removed reply', [], { root: original.id, replyTo: reply.id })).rejects.toMatchObject({ code: 'forbidden' });
    await host.leave();
  });

  it('keeps a failed reply in its original thread and retries it once without posting a room message', async () => {
    const { host, code } = await start();
    let blocked = false;
    const real = cookieFetch(ORIGIN);
    const browser = h.browser({ fetch: (input, init) => {
      if (blocked && String(input).endsWith('/mls/messages') && init?.method === 'POST') return Promise.reject(new TypeError('The test connection is offline.'));
      return real(input, init);
    } });
    const sam = await guest(host, code, 'Sam', browser);
    await host.sendChat('Original for a retry');
    await until(() => sam.crypto.getSnapshot().chat.length === 1, 'retry original');
    const original = sam.crypto.getSnapshot().chat[0];
    if (!original) throw new Error('No original');
    blocked = true;
    await sam.sendChat('CANARY-FAILED-THREAD', [], { root: original.id, replyTo: original.id });
    await until(() => !sam.crypto.getSnapshot().chat.some((m) => m.sending), 'reply failure');
    const failed = sam.crypto.getSnapshot().chat.find((m) => m.text === 'CANARY-FAILED-THREAD');
    expect(failed).toMatchObject({ failed: true, thread: { root: original.id, replyTo: original.id } });
    expect(host.crypto.getSnapshot().chat).toHaveLength(1);
    if (!failed) throw new Error('No failed reply');
    blocked = false;
    await sam.retryChat(failed.id);
    await until(() => host.crypto.getSnapshot().chat.some((m) => m.text === 'CANARY-FAILED-THREAD'), 'retried reply');
    expect(host.crypto.getSnapshot().chat.filter((m) => m.text === 'CANARY-FAILED-THREAD')).toHaveLength(1);
    expect(host.crypto.getSnapshot().chat.find((m) => m.text === 'CANARY-FAILED-THREAD')?.thread).toEqual({ root: original.id, replyTo: original.id });
    await host.leave();
  });
  it('reconciles a confirmed old-room reply when the sender is moved before its response arrives', async () => {
    let delay = false; let accepted = false; let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const jar = cookieFetch(ORIGIN);
    const a = h.browser({ fetch: async (input, init) => {
      const response = await jar(input, init);
      if (delay && String(input).endsWith('/mls/messages')) { accepted = true; await gate; }
      return response;
    } });
    const email = `thread.review.${crypto.randomUUID()}@vandelay.example`;
    const org = h.browser(); await org.api.auth.signIn('sso', { email: `thread.org.${crypto.randomUUID()}@vandelay.example` });
    await a.api.auth.signIn('sso', { email });
    const { code } = await org.api.calls.startNow({ guests: [email], notes: 'off' });
    const host = await org.api.calls.join(code, { mic: false, cam: false });
    const alice = await a.api.calls.join(code, { mic: false, cam: false });
    await inRoom(alice, 'main');
    await host.sendChat('An original in main.');
    await until(() => alice.crypto.getSnapshot().chat.length === 1, 'main-room original');
    const original = alice.crypto.getSnapshot().chat[0];
    if (!original) throw new Error('No original');
    await alice.readChat([original.id]);
    delay = true;
    try {
      const sending = alice.sendChat('Confirmed reply before the move.', [], { root: original.id, replyTo: original.id });
      await until(() => accepted, 'real provider acceptance');
      await until(() => host.crypto.getSnapshot().chat.some((m) => m.text === 'Confirmed reply before the move.'), 'host receives canonical reply');
      const canonical = host.crypto.getSnapshot().chat.find((m) => m.text === 'Confirmed reply before the move.');
      if (!canonical) throw new Error('No confirmed reply');
      host.openRooms({ rooms: [{ name: 'Design', emails: [email] }, { name: 'Support', emails: [] }], minutes: 5, board: { mode: 'none', template: 'blank' } });
      await until(() => host.getSnapshot().breakouts.open !== null, 'organizer room assignment');
      release(); await sending;
      await until(() => alice.crypto.getSnapshot().place !== 'main' && alice.crypto.getSnapshot().status === 'in', 'moved sender');
      host.moveToRoom(email, null);
      await inRoom(alice, 'main');
      await alice.refresh();
      expect(alice.crypto.getSnapshot().chat.find((m) => m.text === 'Confirmed reply before the move.')).toMatchObject({ id: canonical.id, sending: false, failed: false });
    } finally { release(); }
    await host.leave();
  });

  it('reconciles a lost successful response from only the original sender’s row after a room move', async () => {
    let lose = false; let accepted = false; let paused = false;
    const jar = cookieFetch(ORIGIN);
    const a = h.browser({ fetch: async (input, init) => {
      const path = String(input);
      if (paused && path.includes('/mls?')) throw new TypeError('Offline');
      const response = await jar(input, init);
      if (lose && path.endsWith('/mls/messages')) { accepted = true; lose = false; paused = true; throw new TypeError('Successful response lost'); }
      return response;
    } });
    const email = `thread.lost.${crypto.randomUUID()}@vandelay.example`;
    const org = h.browser(); await org.api.auth.signIn('sso', { email: `thread.org.${crypto.randomUUID()}@vandelay.example` });
    await a.api.auth.signIn('sso', { email });
    const { code } = await org.api.calls.startNow({ guests: [email], notes: 'off' });
    const host = await org.api.calls.join(code, { mic: false, cam: false });
    const alice = await a.api.calls.join(code, { mic: false, cam: false });
    await inRoom(alice, 'main');
    await host.sendChat('Main-room original for a lost reply.');
    await until(() => alice.crypto.getSnapshot().chat.length === 1, 'original');
    const original = alice.crypto.getSnapshot().chat[0];
    if (!original) throw new Error('No original');
    lose = true;
    await alice.sendChat('Accepted once before the move.', [], { root: original.id, replyTo: original.id });
    await until(() => accepted && host.crypto.getSnapshot().chat.some((m) => m.text === 'Accepted once before the move.'), 'confirmed reply with lost response');
    const canonical = host.crypto.getSnapshot().chat.find((m) => m.text === 'Accepted once before the move.');
    if (!canonical) throw new Error('No canonical reply');
    host.openRooms({ rooms: [{ name: 'Design', emails: [email] }, { name: 'Support', emails: [] }], minutes: 5, board: { mode: 'none', template: 'blank' } });
    await until(() => host.getSnapshot().breakouts.open !== null, 'room assignment');
    paused = false;
    await until(() => alice.crypto.getSnapshot().place !== 'main' && alice.crypto.getSnapshot().status === 'in', 'sender in new room');
    expect(alice.crypto.getSnapshot().chat.find((m) => m.text === 'Accepted once before the move.')).toMatchObject({ id: canonical.id, sending: false, failed: false, place: 'main', thread: { root: original.id, replyTo: original.id } });
    expect(alice.crypto.getSnapshot().chat.filter((m) => m.text === 'Accepted once before the move.')).toHaveLength(1);
    expect(host.crypto.getSnapshot().chat.filter((m) => m.text === 'Accepted once before the move.')).toHaveLength(1);
    await host.leave();
  });

  it('does not re-encrypt or retry a failed old-generation reply after host handoff', async () => {
    let blocked = false;
    const jar = cookieFetch(ORIGIN);
    const a = h.browser({ fetch: (input, init) => blocked && String(input).endsWith('/mls/messages') ? Promise.reject(new TypeError('Offline')) : jar(input, init) });
    const email = `thread.generation.${crypto.randomUUID()}@vandelay.example`;
    const nextEmail = `thread.next.${crypto.randomUUID()}@vandelay.example`;
    const org = h.browser(); const next = h.browser();
    await org.api.auth.signIn('sso', { email: `thread.org.${crypto.randomUUID()}@vandelay.example` });
    await a.api.auth.signIn('sso', { email }); await next.api.auth.signIn('sso', { email: nextEmail });
    const { code } = await org.api.calls.startNow({ guests: [email, nextEmail], notes: 'off' });
    const host = await org.api.calls.join(code, { mic: false, cam: false });
    const alice = await a.api.calls.join(code, { mic: false, cam: false });
    const newHost = await next.api.calls.join(code, { mic: false, cam: false });
    await inRoom(alice, 'main'); await inRoom(newHost, 'main');
    await host.sendChat('An original before handoff.');
    await until(() => alice.crypto.getSnapshot().chat.length === 1, 'original');
    const original = alice.crypto.getSnapshot().chat[0];
    if (!original) throw new Error('No original');
    await alice.readChat([original.id]);
    blocked = true;
    await alice.sendChat('Never silently re-encrypt this reply.', [], { root: original.id, replyTo: original.id });
    await until(() => alice.crypto.getSnapshot().chat.some((m) => m.failed), 'failed original-generation reply');
    const failed = alice.crypto.getSnapshot().chat.find((m) => m.failed);
    if (!failed) throw new Error('No failed reply');
    const generation = alice.getSnapshot().generation;
    connections.push(await connect(await newHost.room(), { sending: newHost.crypto }));
    await host.handOff(newHost.ticket.identity);
    await until(() => alice.getSnapshot().generation !== generation && alice.crypto.getSnapshot().status === 'in' && newHost.getSnapshot().isHost, 'new generation');
    await alice.refresh();
    await inRoom(alice, 'main');
    expect(alice.getSnapshot().chatRead).toContain(original.id);
    blocked = false;
    await expect(alice.retryChat(failed.id)).rejects.toMatchObject({ code: 'conflict' });
    await alice.sendChat('A new message in the current generation.');
    await until(() => newHost.crypto.getSnapshot().chat.some((m) => m.text === 'A new message in the current generation.'), 'current-generation message');
    expect(newHost.crypto.getSnapshot().chat.some((m) => m.text === 'Never silently re-encrypt this reply.')).toBe(false);
    await newHost.leave();
  });
});
