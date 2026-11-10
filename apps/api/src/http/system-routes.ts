import { ClientLogBatchSchema } from '@alcove/api';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { exec } from '../db';
import { featureFlagsFor } from '../feature-flags';
import { ValidationError } from '../errors';
import { log } from '../log';
import { inference } from '../inference';
import { findSession } from '../sessions';
import { attest } from '../tee';
import { clientAddress, type Env } from './context';
import { body } from './body';
import type { HttpRuntime } from './runtime';

const clog = log.child({ component: 'client', source: 'browser' });



export function registerSystemRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { d } = runtime;
  const { telemetryLimiter, attestLimiter } = runtime.limits;
  const { COOKIE } = runtime.context;

  /* The browser's own warnings and errors, so one request ID tells the whole story. Public and rate limited. */
  app.post('/v1/telemetry', async (c) => {
    telemetryLimiter(clientAddress(c), 'telemetry');
    const { entries } = await body(c, ClientLogBatchSchema);
    for (const en of entries) clog.at(en.level, en.msg, { ...en.context, clientAt: en.at });
    return c.json({ received: entries.length });
  });

  // Cloud Run's front end keeps /healthz for itself, so /health answers the same.
  app.on('GET', ['/health', '/healthz'], async (c) => {
    await exec(d.pool, 'SELECT 1');
    return c.json({ ok: true, inference: inference(d.cfg).configured ? 'configured' : 'missing', livekit: (await d.livekit.reachable()) ? 'reachable' : 'unreachable', tee: d.cfg.TEE, commit: d.cfg.ALCOVE_COMMIT });
  });

  /* The feature flags on for whoever asks: everything on for them when signed in, and only what's on for everyone when not. */
  app.get('/v1/feature-flags', async (c) => {
    const s = await findSession(d, getCookie(c, COOKIE));
    return c.json({ on: [...(await featureFlagsFor(d, s ? { ownerId: s.ownerId } : undefined))] });
  });

  /* What's running, for anyone to check before trusting it: outside a TEE it says so; inside, a fresh TDX quote binds the caller's nonce to this build. */
  app.get('/v1/attestation', async (c) => {
    attestLimiter(clientAddress(c), 'attestation');
    const nonce = c.req.query('nonce') ?? '';
    if (!/^[0-9a-f]{64}$/.test(nonce)) throw new ValidationError('Ask with a nonce: 32 random bytes, as lowercase hex.');
    return c.json(await attest(d.cfg, nonce));
  });
}
