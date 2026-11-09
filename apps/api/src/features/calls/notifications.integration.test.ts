import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type CallSession } from '@alcove/api';
import { startHarness, type Harness } from '../../testing/harness';

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
    await host.resolveQuestion(question, 'answered');
    await until(() => !candidates(host).some((c) => c.category === 'questions'), 'resolved question');
    await host.leave();
    await until(() => !host.notifications.getSnapshot().ready && !candidates(host).length && !candidates(guest).length, 'call notification cleanup');
  });
});
