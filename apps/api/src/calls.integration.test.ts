/**
 * Group calls on LiveKit, end to end: the real API over HTTP via @alcove/api-http, real Postgres, the
 * object store, a real LiveKit server (docker-compose.yml) and main's fake Google and NEAR AI. Participants
 * are @livekit/rtc-node rooms joined with the tickets the API hands out, so media and data travel for real.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './testing/harness';
import { disposeLiveKit } from './testing/livekit';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });

describe('calls on LiveKit', () => {
  it('reports LiveKit reachable in the health check', async () => {
    expect(await (await fetch(`${h.baseUrl}/health`)).json()).toMatchObject({ livekit: 'reachable' });
  });
});
