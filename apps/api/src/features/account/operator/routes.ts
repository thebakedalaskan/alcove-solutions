/*
 * The account's operator routes, each registered through operatorRoute() (http/operator.ts), which checks the signed request,
 * the key's scope and an action's reason before anything here runs: why an account can't sign in, and its agents; finding an
 * account by the address it signs in with; and signing it out everywhere (operator.ts). An account's ID goes in the path, and
 * an address only ever in the body.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { body } from '../../../http/body';
import type { Env } from '../../../http/context';
import { rateLimit } from '../../../http/limits';
import { operatorRoute } from '../../../http/operator';
import type { HttpRuntime } from '../../../http/runtime';
import { accountReport, findAccount, signOutEverywhere, type AccountAnswer, type AccountFound, type SignedOut } from './operator';

/** An address to find an account by, and the action's reason. Only its length is checked: it's never said back. */
const Find = z.object({ email: z.string().trim().min(3).max(320), reason: z.string() });

export function registerAccountOperatorRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { d } = runtime;
  const at = () => new Date().toISOString();
  /**
   * Finding accounts by address, for each key: 20 an hour on each instance. Any write key can turn an address into an account's
   * ID, and follow it through the logs, so few, and each one audited under its key and reason.
   */
  const finding = rateLimit(20, 3_600_000);

  /* Why can't this account sign in, and what do its agents hold? */
  operatorRoute(app, runtime, 'GET', '/v1/operator/accounts/:accountId', 'read', async (c, op) =>
    c.json({ ...(await accountReport(d, c.req.param('accountId') ?? '')), instance: op.instance, at: at() } satisfies AccountAnswer));

  /* Which account signs in with this address? The address is in the body, never a URL, and is never logged, hashed or not. */
  operatorRoute(app, runtime, 'POST', '/v1/operator/accounts/find', 'write', async (c, op) => {
    finding(op.keyId, 'operator finds');
    const { email } = await body(c, Find);
    return c.json({ ...(await findAccount(d, email)), instance: op.instance, at: at() } satisfies AccountFound);
  });

  /* Sign it out everywhere, at the person's request. */
  operatorRoute(app, runtime, 'POST', '/v1/operator/accounts/:accountId/sessions/end', 'write', async (c, op) =>
    c.json({ ended: await signOutEverywhere(d, c.req.param('accountId') ?? ''), instance: op.instance, at: at() } satisfies SignedOut));
}
