/*
 * The service-wide operator routes, each registered through operatorRoute() (http/operator.ts), which checks the signed
 * request before anything here runs: who's asking, switching feature flags, and listing and setting limits. What a feature
 * owns, an operator reaches through that feature's own operator routes.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { commandName, featureFlagScope, runFeatureFlagCommand } from '../../platform/feature-flag-commands';
import { body } from '../../http/body';
import { type Env } from '../../http/context';
import { operatorRoute, type LinesAnswer } from '../../http/operator';
import type { HttpRuntime } from '../../http/runtime';
import { limitScope, runLimitCommand } from '../../platform/limit-commands';
import { log } from '../../platform/log';
import { indexKey } from '../../keys/owners';
import { checksAnswer } from './checks';
import { registerDiagnostics } from './diagnostics';
import type { ReadMigrations } from './release';
import type { WhoamiAnswer } from './wire';

const olog = log.child({ component: 'operator' });
/** A feature-flags command, as the words of `feature-flags …`, and an action's reason. */
const FlagCommand = z.object({ words: z.array(z.string().max(320)).min(1).max(100), reason: z.string().optional() });
/** A limits command, as the words of `limits …`, and an action's reason. */
const LimitCommand = z.object({ words: z.array(z.string().max(100)).min(1).max(10), reason: z.string().optional() });

/** `readMigrations`: where the database's migrations stand, for `operator release`, handed in by app.ts (release.ts). */
export function registerOperatorRoutes(app: Hono<Env>, runtime: HttpRuntime, readMigrations: ReadMigrations): void {
  const { d } = runtime;

  /* Does my key work, and what can it do? */
  operatorRoute(app, runtime, 'GET', '/v1/operator/whoami', 'read', async (c, op) =>
    c.json({ keyId: op.keyId, scope: op.scope, instance: op.instance, at: new Date().toISOString() } satisfies WhoamiAnswer));

  /* Which dependency is failing, and how? Every live check at once, at most once every 20 s on an instance (features/operator/checks.ts). */
  operatorRoute(app, runtime, 'GET', '/v1/operator/checks', 'read', async (c, op) => c.json(await checksAnswer(runtime, op.instance)));

  /* What's running, background work, recent errors and one request's lines (diagnostics.ts). */
  registerDiagnostics(app, runtime, readMigrations);

  /*
   * Switching feature flags (docs: engineering/feature-flags.md): a command's words in, the lines the command line would
   * print out, with addresses hashed in here and never said back. Listing flags and groups and counting a group's members
   * reads; asking about an address, and the rest, take a write key (featureFlagScope).
   */
  operatorRoute(app, runtime, 'POST', '/v1/operator/feature-flags', featureFlagScope, async (c) => {
    const { words } = await body(c, FlagCommand);
    let ok = false;
    try {
      const lines = await runFeatureFlagCommand(d.pool, indexKey(d), words);
      ok = true;
      return c.json({ lines } satisfies LinesAnswer);
    } finally {
      // The command's name and whether it ran: never the rest of what was typed, which holds addresses.
      olog.info('operator feature flags', { command: commandName(words), ok });
    }
  });

  /*
   * Limits (docs: engineering/deployment-and-acceptance.md › Changing a limit): the lines `limits list` and `limits set` print.
   * Listing reads; setting changes, within each limit's bounds, and every instance takes it within LIMITS_CACHE_MS.
   */
  operatorRoute(app, runtime, 'POST', '/v1/operator/limits', limitScope, async (c) => {
    const { words } = await body(c, LimitCommand);
    return c.json({ lines: await runLimitCommand(d.pool, words) } satisfies LinesAnswer);
  });
}
