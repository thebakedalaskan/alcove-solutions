import { ClientLogBatchSchema } from '@alcove/api';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import { equalBytes, sha, utf8 } from '../keys/crypto';
import { exec } from '../platform/db';
import { featureFlagsFor } from '../platform/feature-flags';
import { commandName, runFeatureFlagCommand } from '../platform/feature-flag-commands';
import { AuthError, NotFoundError } from '../platform/errors';
import { log } from '../platform/log';
import { inference } from '../inference/inference';
import { indexKey, openOwner } from '../keys/owners';
import { findSession } from '../keys/sessions';
import { clientAddress, type Env } from './context';
import { body } from './body';
import type { HttpRuntime } from './runtime';

const clog = log.child({ component: 'client', source: 'browser' });
const olog = log.child({ component: 'operator' });
/** A feature-flags command, as the words of `feature-flags …`. */
const OperatorCommand = z.object({ words: z.array(z.string().max(320)).min(1).max(100) });



export function registerSystemRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { d } = runtime;
  const { telemetryLimiter, attestLimiter, operatorLimiter } = runtime.limits;
  const { COOKIE } = runtime.context;

  /* The browser's own warnings and errors, so one request ID tells the whole story. Public and rate limited. */
  app.post('/v1/telemetry', async (c) => {
    telemetryLimiter(clientAddress(c), 'telemetry');
    const { entries } = await body(c, ClientLogBatchSchema);
    for (const en of entries) clog.at(en.level, en.msg, { ...en.context, clientAt: en.at });
    return c.json({ received: entries.length });
  });

  // Some front ends keep /healthz for themselves (Cloud Run's did), so /health answers the same.
  app.on('GET', ['/health', '/healthz'], async (c) => {
    await exec(d.pool, 'SELECT 1');
    return c.json({ ok: true, inference: inference(d.cfg).configured ? 'configured' : 'missing', livekit: (await d.livekit.reachable()) ? 'reachable' : 'unreachable', tee: d.cfg.TEE, commit: d.cfg.ALCOVE_COMMIT });
  });

  /* The feature flags on for whoever asks: everything on for them when signed in, and only what's on for everyone when not. */
  app.get('/v1/feature-flags', async (c) => {
    const s = await findSession(d, getCookie(c, COOKIE));
    return c.json({ on: [...(await featureFlagsFor(d, s ? await openOwner(d, s.ownerId, s) : undefined))] });
  });

  /*
   * Switching feature flags, for operators with curl (docs: engineering/feature-flags.md): a command's words in, the lines the
   * command line would print out, with addresses hashed in here. Not part of AlcoveApi. It isn't there until the API has
   * OPERATOR_TOKEN_SHA256, and then takes only the token that's the hash of, compared in constant time.
   */
  app.post('/v1/operator/feature-flags', async (c) => {
    const expected = d.cfg.OPERATOR_TOKEN_SHA256;
    if (expected === undefined) throw new NotFoundError('That isn’t here.', { context: { route: 'operator' } });
    operatorLimiter(clientAddress(c), 'operator');
    const token = /^Bearer (\S+)$/.exec(c.req.header('authorization') ?? '')?.[1] ?? '';
    if (!equalBytes(sha(utf8(token)), Buffer.from(expected, 'hex'))) throw new AuthError('That isn’t an operator’s token.', { level: 'warn' });
    const { words } = await body(c, OperatorCommand);
    let ok = false;
    try {
      const lines = await runFeatureFlagCommand(d.pool, indexKey(d), words);
      ok = true;
      return c.json({ lines });
    } finally {
      // The command's name and whether it ran: never the rest of what was typed, which holds addresses.
      olog.info('operator feature flags', { command: commandName(words), ok });
    }
  });

  /* What's running, for anyone to check before trusting it: outside a TEE it says so; inside, the token that attests to this build. */
  app.get('/v1/attestation', async (c) => {
    attestLimiter(clientAddress(c), 'attestation');
    return c.json(await runtime.attester.attest());
  });
}
