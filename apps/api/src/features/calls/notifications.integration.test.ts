import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type CallSession } from '@alcove/api';
import { cookieFetch, ORIGIN, startHarness, type Harness } from '../../testing/harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterEach(() => h.closeCalls());
afterAll(async () => { await h?.close(); });
async function until(ready: () => boolean, why: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!ready()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${why}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
const candidates = (call: CallSession) => call.notifications.getSnapshot().candidates;

describe('authorized browser notification candidates', () => {
  it('offers pending admission only to the host, withdraws it on admission, and reconciles hands and questions without content', async () => {
    const browser = h.browser();
    await browser.api.auth.signIn('sso', { email: `notifier.${Date.now()}@tests.example` });
    const { code } = await browser.api.calls.startNow({ notes: 'off' });
    const host = await browser.api.calls.join(code, { cam: false, mic: false });
    const guest = await h.browser().api.calls.join(code, { cam: false, mic: false, name: 'Sam' });
    await until(() => candidates(host).some((c) => c.category === 'admissions'), 'authorized host admission candidate');
    expect(guest.notifications.getSnapshot()).toMatchObject({ ready: false, candidates: [] });
    const admission = candidates(host).find((c) => c.category === 'admissions');
    expect(admission?.destination.target).toEqual({ type: 'admission', identity: guest.ticket.identity });
    expect(JSON.stringify(admission)).not.toContain('Sam');
    await host.admit(guest.ticket.identity);
    await until(() => host.notifications.getSnapshot().ready && guest.notifications.getSnapshot().ready && !candidates(host).some((c) => c.category === 'admissions'), 'admission reconciled');
    await guest.setHand(true);
    await until(() => candidates(host).some((c) => c.category === 'hands'), 'raised hand');
    expect(candidates(guest).some((c) => c.category === 'hands')).toBe(false);
    await host.clearHands();
    await until(() => !candidates(host).some((c) => c.category === 'hands'), 'handled hand');
    const question = randomBytes(16).toString('base64url');
    await guest.postQuestion(question, 'CANARY-PRIVATE-NOTIFICATION-QUESTION');
    await until(() => candidates(host).some((c) => c.category === 'questions'), 'authorized question');
    expect(JSON.stringify(candidates(host))).not.toContain('CANARY');
    const prefs = await browser.api.account.preferences();
    expect(host.notifications.eligible(prefs.notifications)).toEqual([]);
    const on = await browser.api.account.updatePreferences({ notifications: { ...prefs.notifications, enabled: true, questions: true } });
    expect(host.notifications.eligible(on.notifications).map((candidate) => candidate.category)).toEqual(['questions']);
    const off = await browser.api.account.updatePreferences({ notifications: { ...on.notifications, enabled: false } });
    expect(host.notifications.eligible(off.notifications)).toEqual([]);
    expect(candidates(host).some((candidate) => candidate.category === 'questions')).toBe(true);
    await host.resolveQuestion(question, 'answered');
    await until(() => !candidates(host).some((c) => c.category === 'questions'), 'resolved question');
    await host.leave();
    await until(() => !host.notifications.getSnapshot().ready && !candidates(host).length && !candidates(guest).length, 'call notification cleanup');
  });
  it('projects private unread only for the intended current recipient and withdraws it on read or removal', async () => {
    const browser = h.browser();
    await browser.api.auth.signIn('sso', { email: `private-notifier.${Date.now()}@tests.example` });
    const { code } = await browser.api.calls.startNow({ notes: 'off' });
    const host = await browser.api.calls.join(code, { cam: false, mic: false });
    const alice = await h.browser().api.calls.join(code, { cam: false, mic: false, name: 'Alice' });
    const bob = await h.browser().api.calls.join(code, { cam: false, mic: false, name: 'Bo' });
    await until(() => host.getSnapshot().waiting.length === 2, 'two admitted peers');
    await host.admit(alice.ticket.identity); await host.admit(bob.ticket.identity);
    await until(() => alice.direct.getSnapshot().peers.includes(bob.ticket.identity) && bob.direct.getSnapshot().peers.includes(alice.ticket.identity), 'authenticated private peers');
    await alice.direct.send(bob.ticket.identity, 'CANARY-PRIVATE-NOTIFICATION-MESSAGE');
    await until(() => candidates(bob).some((c) => c.category === 'privateMessages'), 'recipient private candidate');
    expect(candidates(host).some((c) => c.category === 'privateMessages')).toBe(false);
    expect(candidates(alice).some((c) => c.category === 'privateMessages')).toBe(false);
    expect(JSON.stringify(candidates(bob))).not.toContain('CANARY');
    const first = candidates(bob).find((c) => c.category === 'privateMessages');
    expect(first?.destination.connection).toBe(bob.ticket.identity);
    bob.direct.read(bob.direct.getSnapshot().unread);
    await until(() => !candidates(bob).some((c) => c.category === 'privateMessages'), 'read private alert withdrawn');
    await alice.direct.send(bob.ticket.identity, 'Second unread private message.');
    await until(() => candidates(bob).some((c) => c.category === 'privateMessages'), 'second private candidate');
    await host.remove(bob.ticket.identity);
    await until(() => !bob.notifications.getSnapshot().ready && !candidates(bob).length, 'removed recipient cleanup');
    await host.leave();
  });

  it('suspends candidates during a whole-API outage and resumes only after the original connection is authorized', async () => {
    let offline = false;
    const jar = cookieFetch(ORIGIN);
    const receiver = h.browser({ fetch: (input, init) => offline && String(input).includes('/v1/live/calls/') ? Promise.reject(new TypeError('Offline')) : jar(input, init) });
    const browser = h.browser();
    await browser.api.auth.signIn('sso', { email: `outage-notifier.${Date.now()}@tests.example` });
    const { code } = await browser.api.calls.startNow({ notes: 'off' });
    const host = await browser.api.calls.join(code, { cam: false, mic: false });
    const guest = await receiver.api.calls.join(code, { cam: false, mic: false, name: 'Sam' });
    await until(() => host.getSnapshot().waiting.length === 1, 'waiting recipient');
    await host.admit(guest.ticket.identity);
    await until(() => guest.notifications.getSnapshot().ready, 'original connection authorized');
    await host.sendChat('@Sam', [{ identity: guest.ticket.identity, start: 0, end: 4 }]);
    await until(() => candidates(guest).some((candidate) => candidate.category === 'chatMentions'), 'canonical mention candidate');
    const original = candidates(guest).find((candidate) => candidate.category === 'chatMentions');
    expect(original?.destination.target.type).toBe('chat');
    offline = true;
    await until(() => !guest.notifications.getSnapshot().ready, 'outage suspended');
    expect(candidates(guest)).toEqual([]);
    offline = false;
    await until(() => guest.notifications.getSnapshot().ready, 'relay and call reauthorized');
    expect(candidates(guest).find((candidate) => candidate.category === 'chatMentions')?.destination).toEqual(original?.destination);
    expect(candidates(guest).find((candidate) => candidate.category === 'chatMentions')?.fresh).toBe(false);
    expect(guest.crypto.getSnapshot().chat.some((message) => message.mentions.some((mention) => mention.identity === guest.ticket.identity))).toBe(true);
    await host.leave();
  });

  it('selects only relevant original room-thread replies and removes them after the exact reply is read', async () => {
    const browser = h.browser();
    await browser.api.auth.signIn('sso', { email: `replies-notifier.${Date.now()}@tests.example` });
    const { code } = await browser.api.calls.startNow({ notes: 'off' });
    const host = await browser.api.calls.join(code, { cam: false, mic: false });
    const guest = await h.browser().api.calls.join(code, { cam: false, mic: false, name: 'Sam' });
    const bystander = await h.browser().api.calls.join(code, { cam: false, mic: false, name: 'Bo' });
    await until(() => host.getSnapshot().waiting.length === 2, 'two thread peers');
    await host.admit(guest.ticket.identity); await host.admit(bystander.ticket.identity);
    await until(() => guest.crypto.getSnapshot().status === 'in' && bystander.crypto.getSnapshot().status === 'in', 'room keys');
    await host.sendChat('CANARY-PRIVATE-NOTIFICATION-ROOT');
    const root = host.crypto.getSnapshot().chat.find((message) => message.isMe && !message.sending);
    if (!root) throw new Error('No canonical original');
    await until(() => guest.crypto.getSnapshot().chat.some((message) => message.id === root.id), 'same canonical original');
    await guest.sendChat('CANARY-PRIVATE-NOTIFICATION-REPLY', [], { root: root.id, replyTo: root.id });
    await until(() => candidates(host).some((candidate) => candidate.category === 'replies'), 'relevant original reply');
    const reply = candidates(host).find((candidate) => candidate.category === 'replies');
    expect(reply?.destination.target.type).toBe('thread');
    expect(JSON.stringify(reply)).not.toContain('CANARY');
    expect(candidates(bystander).some((candidate) => candidate.category === 'replies')).toBe(false);
    if (reply?.destination.target.type !== 'thread') throw new Error('No exact thread destination');
    expect(reply.destination.target.root).toBe(root.id);
    await host.readChat([reply.destination.target.message]);
    await until(() => !candidates(host).some((candidate) => candidate.category === 'replies'), 'exact reply read');
    await host.leave();
  });

  it('does not manufacture a fresh old reply when someone first joins an existing thread', async () => {
    const browser = h.browser();
    await browser.api.auth.signIn('sso', { email: `joining-thread.${Date.now()}@tests.example` });
    const { code } = await browser.api.calls.startNow({ notes: 'off' });
    const host = await browser.api.calls.join(code, { cam: false, mic: false });
    const guest = await h.browser().api.calls.join(code, { cam: false, mic: false, name: 'Sam' });
    await until(() => host.getSnapshot().waiting.length === 1, 'thread guest waiting');
    await host.admit(guest.ticket.identity);
    await until(() => guest.notifications.getSnapshot().ready, 'thread guest authorized');
    await guest.sendChat('An existing conversation.');
    const root = guest.crypto.getSnapshot().chat.find((message) => message.isMe && !message.sending);
    if (!root) throw new Error('No original conversation');
    await guest.sendChat('An old reply before the host took part.', [], { root: root.id, replyTo: root.id });
    await until(() => host.crypto.getSnapshot().chat.some((message) => message.thread?.root === root.id), 'old reply observed');
    expect(candidates(host).some((candidate) => candidate.category === 'replies')).toBe(false);
    await host.sendChat('Joining now.', [], { root: root.id, replyTo: root.id });
    expect(candidates(host).filter((candidate) => candidate.category === 'replies').every((candidate) => !candidate.fresh)).toBe(true);
    await guest.sendChat('A new reply after the host joined.', [], { root: root.id, replyTo: root.id });
    await until(() => candidates(host).some((candidate) => candidate.category === 'replies' && candidate.fresh), 'new relevant reply');
    expect(candidates(host).filter((candidate) => candidate.category === 'replies' && candidate.fresh)).toHaveLength(1);
    await host.leave();
  });

});
