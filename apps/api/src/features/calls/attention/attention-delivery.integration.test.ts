/** Real call flows with delayed HTTP delivery: queues must not regress, and lost nudges must recover. */
import { type CallSession } from '@alcove/api';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cookieFetch, ORIGIN, startHarness, type Harness } from '../../../testing/harness';
import { disposeLiveKit } from '../../../testing/livekit';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterEach(() => { h.closeCalls(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });

async function until(predicate: () => boolean, what: string, timeoutMs = 15_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
const admitted = (call: CallSession) => until(() => call.crypto.getSnapshot().status === 'in', 'call admission');

describe('attention delivered through the live HTTP client', () => {
  it('keeps a confirmed hand raised when an older state response arrives afterwards', async () => {
    // Removing the revision check would make the delayed pre-raise GET lower the hand again.
    const transport = cookieFetch(ORIGIN);
    let delayNextState = false;
    let captured = false;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const browser = h.browser({ callPollMs: 60_000, fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      const shouldDelay = delayNextState && method === 'GET' && /\/v1\/live\/calls\/[^/]+$/.test(url.pathname);
      if (shouldDelay) delayNextState = false;
      const response = await transport(input, init);
      if (shouldDelay) { captured = true; await gate; }
      return response;
    } });
    await browser.api.auth.signIn('sso', { email: 'delivery-order@vandelay.industries' });
    const { code } = await browser.api.calls.startNow({ notes: 'off' });
    const call = await browser.api.calls.join(code, { mic: false, cam: false });
    await admitted(call);
    await call.refresh();
    delayNextState = true;
    const oldRead = call.refresh({ call: true, log: false });
    try {
      await until(() => captured, 'old state response');
      await call.setHand(true);
      const raised = call.getSnapshot();
      expect(raised.attention.hands).toHaveLength(1);
      expect(raised.participants.find((p) => p.isMe)?.hand).toBe(true);
      release?.();
      await oldRead;
      expect(call.getSnapshot().revision).toBeGreaterThanOrEqual(raised.revision);
      expect(call.getSnapshot().attention.hands).toEqual(raised.attention.hands);
      expect(call.getSnapshot().participants.find((p) => p.isMe)?.hand).toBe(true);
    } finally { release?.(); }
    await call.leave();
  });

  it('recovers a hand and question without a media nudge or an open document', async () => {
    // These clients do not connect LiveKit media and cannot receive its nudges; only periodic HTTP recovery can update the guest.
    const owner = h.browser();
    const guest = h.browser({ callPollMs: 30 });
    await owner.api.auth.signIn('sso', { email: 'delivery-host@vandelay.industries' });
    const { code } = await owner.api.calls.startNow({ notes: 'off' });
    const host = await owner.api.calls.join(code, { mic: false, cam: false });
    await admitted(host);
    const other = await guest.api.calls.join(code, { mic: false, cam: false, name: 'Elena' });
    await until(() => host.getSnapshot().waiting.some((w) => w.id === other.ticket.identity), 'waiting request');
    await host.admit(other.ticket.identity);
    await admitted(other);
    await host.setHand(true);
    await host.postQuestion('DeliveryQuestion0001', 'When will the next review begin?');
    await until(() => other.getSnapshot().attention.hands.length === 1 && other.getSnapshot().attention.questions.length === 1, 'attention without a nudge');
    expect(other.getSnapshot().attention.questions[0]?.text).toBe('When will the next review begin?');
    await host.setHand(false);
    await until(() => other.getSnapshot().attention.hands.length === 0, 'lowered hand without a nudge');
    await host.leave();
  });

  it('recovers missed attention while log-only chat activity keeps resetting the keys timer', async () => {
    const owner = h.browser();
    const guest = h.browser({ callPollMs: 80 });
    await owner.api.auth.signIn('sso', { email: 'delivery-chat@vandelay.industries' });
    const { code } = await owner.api.calls.startNow({ notes: 'off' });
    const host = await owner.api.calls.join(code, { mic: false, cam: false });
    await admitted(host);
    const other = await guest.api.calls.join(code, { mic: false, cam: false, name: 'Elena' });
    await until(() => host.getSnapshot().waiting.some((w) => w.id === other.ticket.identity), 'waiting request');
    await host.admit(other.ticket.identity);
    await admitted(other);
    let done = false;
    const activity = (async () => {
      while (!done) {
        await other.refresh({ call: false, log: true });
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    })();
    try {
      await host.setHand(true);
      await until(() => other.getSnapshot().attention.hands.length === 1, 'attention during chat activity', 2_000);
      expect(other.getSnapshot().attention.hands[0]?.participantId).toBe(host.ticket.identity);
    } finally { done = true; await activity; }
    await host.leave();
  });
});
