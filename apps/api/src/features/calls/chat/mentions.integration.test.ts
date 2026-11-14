import { DirectTextSchema, type CallSession } from '@alcove/api';
import { createHttpApi } from '@alcove/api-http';
import { MutationObserver, QueryClient } from '@tanstack/query-core';
import { interactiveWrites, preferenceOptions, readPreferences, type PreferenceChange } from '../../../../../web/src/lib/queryWrites';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cookieFetch, ORIGIN, startHarness, type Harness } from '../../../testing/harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterEach(() => h.closeCalls());
afterAll(async () => { await h?.close(); });
async function until(ready: () => boolean, what: string): Promise<void> {
  const end = Date.now() + 15_000;
  while (!ready()) { if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`); await new Promise((resolve) => setTimeout(resolve, 30)); }
}
async function admit(host: CallSession, guest: CallSession): Promise<void> {
  await until(() => host.getSnapshot().waiting.some((p) => p.id === guest.ticket.identity), 'guest request');
  await host.admit(guest.ticket.identity);
  await until(() => guest.crypto.getSnapshot().status === 'in', 'guest membership');
}
async function pair(a: CallSession, b: CallSession): Promise<void> {
  await until(() => a.direct.getSnapshot().peers.includes(b.ticket.identity) && b.direct.getSnapshot().peers.includes(a.ticket.identity), 'authenticated private audience');
}
async function guests(firstBrowser = h.browser(), secondBrowser = h.browser()) {
  const org = h.browser(); await org.api.auth.signIn('sso', { email: `mentions.${crypto.randomUUID()}@vandelay.example` });
  const { code } = await org.api.calls.startNow({ notes: 'off' });
  const host = await org.api.calls.join(code, { mic: false, cam: false });
  const first = await firstBrowser.api.calls.join(code, { mic: false, cam: false, name: 'Sam' });
  const second = await secondBrowser.api.calls.join(code, { mic: false, cam: false, name: 'Sam' });
  await admit(host, first); await admit(host, second); await pair(first, second);
  return { org, code, host, first, second, firstBrowser, secondBrowser };
}

describe('selected call mentions', () => {
  it('keeps mention preference leaves with their account and preserves another client’s independent choices through a delayed acknowledgement', async () => {
    const email = `mentions.prefs.${crypto.randomUUID()}@vandelay.example`;
    const first = h.browser(); const second = h.browser(); const outsider = h.browser();
    const signed = await first.api.auth.signIn('sso', { email }); await second.api.auth.signIn('sso', { email });
    await outsider.api.auth.signIn('sso', { email: `mentions.other.${crypto.randomUUID()}@vandelay.example` });
    const before = await first.api.account.preferences();
    expect(before.notifications.chatMentions).toBe(true); expect(before.sounds.mentions).toBe(true);
    let reached = false; let claimed = false; let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const held = h.browser({ fetch: async (input, init) => {
      const response = await first.fetch(input, init);
      if (!claimed && init?.method === 'PATCH' && String(input).endsWith('/account/preferences')) { claimed = true; reached = true; await gate; }
      return response;
    } });
    const client = new QueryClient({ defaultOptions: { mutations: interactiveWrites, queries: { retry: false } } });
    const keys = { session: ['session'] as const, prefs: ['prefs'] as const };
    client.setQueryData(keys.session, signed.session); client.setQueryData(keys.prefs, before);
    const options = preferenceOptions(held.api, client, keys, (change: PreferenceChange) => change);
    const pending = new MutationObserver(client, options).mutate({ sounds: { mentions: false }, notifications: { chatMentions: false } });
    try {
      await until(() => reached, 'the confirmed mention preference acknowledgement');
      expect(client.getQueryData<typeof before>(keys.prefs)).toMatchObject({ sounds: { mentions: false }, notifications: { chatMentions: false } });
      const same = await second.api.account.preferences();
      expect(same.notifications.chatMentions).toBe(false); expect(same.sounds.mentions).toBe(false);
      await second.api.account.updatePreferences({ sounds: { ...same.sounds, questions: !before.sounds.questions }, notifications: { ...same.notifications, tagged: !before.notifications.tagged } });
      await client.fetchQuery({ queryKey: keys.prefs, queryFn: () => readPreferences(held.api, client) });
      const expected = { sounds: { mentions: false, questions: !before.sounds.questions, messages: before.sounds.messages }, notifications: { chatMentions: false, tagged: !before.notifications.tagged, replies: before.notifications.replies } };
      expect(client.getQueryData<typeof before>(keys.prefs)).toMatchObject(expected);
      release(); await pending;
      expect(client.getQueryData<typeof before>(keys.prefs)).toMatchObject(expected);
      expect(await first.api.account.preferences()).toMatchObject(expected);
      const other = await outsider.api.account.preferences();
      expect(other.notifications.chatMentions).toBe(true); expect(other.sounds.mentions).toBe(true);
    } finally { release(); await pending; client.clear(); }
  });
  it('keeps matching guest names on stable private identities, rebases whitespace spans and follows exact thread/read state', async () => {
    const { host, first, second } = await guests();
    const text = '   CANARY-MENTION-PRIVATE @Sam   ';
    const start = text.indexOf('@Sam');
    await first.direct.send(second.ticket.identity, text, [{ identity: second.ticket.identity, start, end: start + 4 }]);
    await until(() => second.direct.getSnapshot().messages.length === 1, 'selected private mention');
    const original = second.direct.getSnapshot().messages[0];
    if (!original) throw new Error('No original private mention');
    expect(original.text).toBe(text.trim());
    expect(original.mentions).toEqual([{ identity: second.ticket.identity, start: start - 3, end: start + 1 }]);
    expect(original.text.slice(original.mentions[0]?.start, original.mentions[0]?.end)).toBe('@Sam');
    expect(second.direct.getSnapshot().unreadMentions).toEqual([original.id]);
    expect(first.direct.getSnapshot().unreadMentions).toEqual([]);
    second.direct.read([original.id]);
    await second.refresh();
    expect(second.direct.getSnapshot().unreadMentions).toEqual([]);
    await second.direct.send(first.ticket.identity, '@Sam understood.', [{ identity: first.ticket.identity, start: 0, end: 4 }], { root: original.id, replyTo: original.id });
    await until(() => first.direct.getSnapshot().messages.length === 2, 'private threaded mention');
    const reply = first.direct.getSnapshot().messages.find((m) => m.thread?.root === original.id);
    expect(reply?.mentions).toEqual([{ identity: first.ticket.identity, start: 0, end: 4 }]);
    expect(first.direct.getSnapshot().unreadMentions).toEqual([reply?.id]);
    await first.direct.send(second.ticket.identity, '@Sam is me.', [{ identity: first.ticket.identity, start: 0, end: 4 }]);
    await until(() => second.direct.getSnapshot().messages.length === 3, 'self-mention without recipient attention');
    expect(second.direct.getSnapshot().unreadMentions).toEqual([]);
    expect(host.direct.getSnapshot().messages).toEqual([]);
    const stored = JSON.stringify((await h.pool.query('SELECT * FROM call_private_messages')).rows);
    for (const encoded of ['CANARY-MENTION-PRIVATE', Buffer.from('CANARY-MENTION-PRIVATE').toString('hex'), Buffer.from('CANARY-MENTION-PRIVATE').toString('base64url')]) {
      expect(stored).not.toContain(encoded); expect(h.logs.join('')).not.toContain(encoded);
    }
    await host.leave();
    expect((await h.pool.query('SELECT count(*) FROM call_private_messages')).rows[0]?.count).toBe('0');
    await until(() => first.direct.getSnapshot().unreadMentions.length === 0, 'private mention cleanup');
  });

  it('reauthorizes retained unread history and lets its recipient read a mention after author departure', async () => {
    let offline = false;
    const jar = cookieFetch(ORIGIN);
    const browser = h.browser({ fetch: (input, init) => offline && String(input).includes('/live/calls/') ? Promise.reject(new TypeError('Offline')) : jar(input, init) });
    const { host, first, second } = await guests(h.browser(), browser);
    await first.direct.send(second.ticket.identity, '@Sam can you review?', [{ identity: second.ticket.identity, start: 0, end: 4 }]);
    await until(() => second.direct.getSnapshot().unreadMentions.length === 1, 'unread private mention');
    const id = second.direct.getSnapshot().unreadMentions[0];
    if (!id) throw new Error('No mention');
    offline = true;
    await until(() => !second.direct.getSnapshot().ready, 'private authorization suspended');
    expect(second.direct.getSnapshot().unreadMentions).toEqual([]);
    expect(second.direct.getSnapshot().messages).toHaveLength(1);
    offline = false;
    await until(() => second.direct.getSnapshot().ready && second.direct.getSnapshot().unreadMentions.length === 1, 'same-connection reauthorization');
    expect(second.direct.getSnapshot().unreadMentions).toEqual([id]);
    second.direct.read([id]);
    await second.refresh();
    expect(second.direct.getSnapshot().unreadMentions).toEqual([]);
    await first.direct.send(second.ticket.identity, '@Sam one more question.', [{ identity: second.ticket.identity, start: 0, end: 4 }]);
    await until(() => second.direct.getSnapshot().unreadMentions.length === 1, 'new private mention');
    await host.remove(first.ticket.identity);
    await until(() => !second.direct.getSnapshot().peers.includes(first.ticket.identity), 'author no longer in the audience');
    await until(() => second.direct.getSnapshot().ready, 'remaining recipient authorization');
    const retained = second.direct.getSnapshot().messages.find((m) => m.text === '@Sam one more question.');
    if (!retained) throw new Error('No retained mention');
    expect(second.direct.getSnapshot().unreadMentions).toEqual([retained.id]);
    expect(second.direct.getSnapshot().messages).toHaveLength(2);
    second.direct.read([retained.id]);
    expect(second.direct.getSnapshot().unreadMentions).toEqual([]);
    await host.remove(second.ticket.identity);
    await until(() => second.direct.getSnapshot().messages.length === 0, 'revoked history cleanup');
    expect(second.direct.getSnapshot().unreadMentions).toEqual([]);
    await host.leave();
  });

  it('refuses selected third-party identities and cryptographically authentic forged private mentions without acknowledging them', async () => {
    const { host, first, second } = await guests();
    await expect(first.direct.send(second.ticket.identity, '@Host', [{ identity: host.ticket.identity, start: 0, end: 5 }])).rejects.toMatchObject({ code: 'invalid' });
    await expect(first.direct.send(second.ticket.identity, '@Sam', [{ identity: second.ticket.identity, start: 0, end: 99 }])).rejects.toMatchObject({ code: 'invalid' });
    expect(first.direct.getSnapshot().messages).toEqual([]);
    const real = crypto.subtle.encrypt.bind(crypto.subtle);
    const malicious = vi.spyOn(crypto.subtle, 'encrypt').mockImplementation((algorithm, key, data) => {
      if (typeof algorithm !== 'string' && 'additionalData' in algorithm && ArrayBuffer.isView(algorithm.additionalData) && new TextDecoder().decode(algorithm.additionalData).startsWith('["alcove/private-message/v1"')) {
        const raw: unknown = JSON.parse(new TextDecoder().decode(data));
        const payload = DirectTextSchema.parse(raw);
        if (payload.text === 'Forged @Host') return real(algorithm, key, new TextEncoder().encode(JSON.stringify({ ...payload, mentions: [{ identity: host.ticket.identity, start: 7, end: 12 }] })));
      }
      return real(algorithm, key, data);
    });
    try {
      await first.direct.send(second.ticket.identity, 'Forged @Host');
      await first.direct.send(second.ticket.identity, '@Sam this one is for you.', [{ identity: second.ticket.identity, start: 0, end: 4 }]);
      await until(() => second.direct.getSnapshot().unreadMentions.length === 1, 'valid mention after invalid encrypted payload');
      expect(second.direct.getSnapshot().messages.map((m) => m.text)).toEqual(['@Sam this one is for you.']);
      await until(() => first.direct.getSnapshot().messages.find((m) => m.text === '@Sam this one is for you.')?.state === 'delivered', 'valid receipt');
      expect(first.direct.getSnapshot().messages.find((m) => m.text === 'Forged @Host')?.state).toBe('sent');
      expect(host.direct.getSnapshot().messages).toEqual([]);
      expect(host.direct.getSnapshot().unreadMentions).toEqual([]);
    } finally { malicious.mockRestore(); }
    await host.leave();
  });

  it('keeps failed sends silent and reuses the same encrypted mention across uncertain retries without duplicate attention', async () => {
    let mode: 'before' | 'lost' | 'ok' = 'before'; let paused = false;
    const wire: string[] = [];
    const jar = cookieFetch(ORIGIN);
    const browser = h.browser({ fetch: async (input, init) => {
      const path = String(input);
      if (paused && path.endsWith('/direct/sync')) throw new TypeError('Offline');
      if (path.endsWith('/direct/messages')) {
        if (typeof init?.body === 'string') wire.push(init.body);
        if (mode === 'before') { mode = 'lost'; throw new TypeError('Not sent'); }
        const response = await jar(input, init);
        if (mode === 'lost') { mode = 'ok'; paused = true; throw new TypeError('Successful response lost'); }
        return response;
      }
      return jar(input, init);
    } });
    const { host, first, second } = await guests(browser);
    await first.direct.send(second.ticket.identity, '@Sam retry only this mention.', [{ identity: second.ticket.identity, start: 0, end: 4 }]);
    const failed = first.direct.getSnapshot().messages[0];
    if (!failed) throw new Error('No failed send');
    expect(failed.state).toBe('failed');
    expect(first.direct.getSnapshot().unreadMentions).toEqual([]);
    expect(second.direct.getSnapshot().unreadMentions).toEqual([]);
    await first.direct.retry(failed.id);
    await until(() => second.direct.getSnapshot().unreadMentions.length === 1, 'one accepted mention despite lost response');
    paused = false;
    await until(() => first.direct.getSnapshot().ready, 'sender reauthorization');
    await first.direct.retry(failed.id);
    expect(wire).toHaveLength(3);
    expect(new Set(wire).size).toBe(1);
    expect(second.direct.getSnapshot().unreadMentions).toEqual([failed.id]);
    expect(second.direct.getSnapshot().messages).toHaveLength(1);
    expect((await h.pool.query('SELECT count(*) FROM call_private_messages')).rows[0]?.count).toBe('1');
    second.direct.read([failed.id]); await second.refresh();
    expect(second.direct.getSnapshot().unreadMentions).toEqual([]);
    await host.leave();
  });

  it('keeps original-room retained history readable after a move and preserves its read state on return', async () => {
    const org = h.browser(); const a = h.browser(); const b = h.browser();
    const alice = `mentions.alice.${crypto.randomUUID()}@vandelay.example`; const bob = `mentions.bob.${crypto.randomUUID()}@vandelay.example`;
    await org.api.auth.signIn('sso', { email: `mentions.org.${crypto.randomUUID()}@vandelay.example` });
    await a.api.auth.signIn('sso', { email: alice }); await b.api.auth.signIn('sso', { email: bob });
    const { code } = await org.api.calls.startNow({ guests: [alice, bob], notes: 'off' });
    const host = await org.api.calls.join(code, { mic: false, cam: false });
    const first = await a.api.calls.join(code, { mic: false, cam: false }); const second = await b.api.calls.join(code, { mic: false, cam: false });
    await pair(first, second);
    await first.direct.send(second.ticket.identity, '@Sam only in the original room.', [{ identity: second.ticket.identity, start: 0, end: 4 }]);
    await until(() => second.direct.getSnapshot().unreadMentions.length === 1, 'original-room mention');
    const id = second.direct.getSnapshot().unreadMentions[0];
    if (!id) throw new Error('No mention');
    host.openRooms({ rooms: [{ name: 'Design', emails: [alice] }, { name: 'Support', emails: [bob] }], minutes: 5, board: { mode: 'none', template: 'blank' } });
    await until(() => first.crypto.getSnapshot().place !== 'main' && second.crypto.getSnapshot().place !== 'main' && first.crypto.getSnapshot().place !== second.crypto.getSnapshot().place, 'separate authorized rooms');
    await until(() => !second.direct.getSnapshot().peers.includes(first.ticket.identity), 'old private audience unavailable');
    await until(() => second.direct.getSnapshot().ready, 'current-room recipient authorization');
    expect(second.direct.getSnapshot().unreadMentions).toEqual([id]);
    await expect(first.direct.send(second.ticket.identity, '@Sam no cross-room destination.', [{ identity: second.ticket.identity, start: 0, end: 4 }])).rejects.toMatchObject({ code: 'conflict' });
    second.direct.read([id]);
    expect(second.direct.getSnapshot().unreadMentions).toEqual([]);
    host.closeRooms();
    await until(() => first.crypto.getSnapshot().place === 'main' && second.crypto.getSnapshot().place === 'main', 'main-room return');
    await pair(first, second);
    expect(second.direct.getSnapshot().unreadMentions).toEqual([]);
    await host.leave();
  });

  it('keeps room-thread mentions on exact identities and preserves only the same person’s read receipts across a new connection', async () => {
    const { code, host, first, second, secondBrowser } = await guests();
    await host.sendChat('@Sam start this conversation.', [{ identity: first.ticket.identity, start: 0, end: 4 }]);
    await until(() => first.crypto.getSnapshot().chat.length === 1 && second.crypto.getSnapshot().chat.length === 1, 'room mention');
    const original = first.crypto.getSnapshot().chat[0];
    if (!original) throw new Error('No room original');
    expect(original.mentions[0]?.identity).toBe(first.ticket.identity);
    await first.sendChat('Thread @Sam please review.', [{ identity: second.ticket.identity, start: 7, end: 11 }], { root: original.id, replyTo: original.id });
    await until(() => second.crypto.getSnapshot().chat.some((m) => m.thread?.root === original.id), 'threaded room mention');
    const reply = second.crypto.getSnapshot().chat.find((m) => m.thread?.root === original.id);
    if (!reply) throw new Error('No threaded mention');
    expect(reply.mentions).toEqual([{ identity: second.ticket.identity, start: 7, end: 11 }]);
    await second.readChat([reply.id]);
    expect(second.getSnapshot().chatRead).toContain(reply.id);
    expect(second.getSnapshot().chatRead).not.toContain(original.id);
    second.closing();
    const server = await h.secondServer();
    const api = createHttpApi({ baseUrl: server.baseUrl, fetch: secondBrowser.fetch });
    const again = await api.calls.join(code, { mic: false, cam: false, name: 'Sam', previous: second.ticket.pass });
    try {
      await until(() => again.crypto.getSnapshot().status === 'in', 'replacement same-person membership');
      await again.refresh({ call: true, log: false });
      expect(again.getSnapshot().chatRead).toContain(reply.id);
      expect(again.crypto.getSnapshot().chat.some((m) => m.id === original.id || m.id === reply.id)).toBe(false);
      expect(again.direct.getSnapshot().messages).toEqual([]);
      expect(again.direct.getSnapshot().unreadMentions).toEqual([]);
      await first.refresh();
      expect(first.getSnapshot().chatRead).not.toContain(reply.id);
    } finally { again.close(); await server.close(); }
    await host.leave();
  });
});
