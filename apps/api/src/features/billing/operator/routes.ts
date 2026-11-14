/*
 * Billing's operator routes (docs: Plans and usage › Support), each registered through operatorRoute() (http/operator.ts),
 * which checks the signed request, the key's scope (for support's commands, by their words: `show` reads, anything else
 * writes) and an action's reason before anything here runs: support's billing commands, as `billing …` takes them, with an
 * account named only by a top-up's reference or its ID (support-commands.ts); what happened to a top-up; and its provider
 * asked about it again now (operator.ts).
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { body } from '../../../http/body';
import type { Env } from '../../../http/context';
import { operatorRoute, type LinesAnswer } from '../../../http/operator';
import type { HttpRuntime } from '../../../http/runtime';
import { checkTopUp, topUpReport, type TopUpAnswer, type TopUpCheckAnswer } from './operator';
import { runSupportCommand, supportScope } from '../support-commands';

/** A billing command, as the words of `billing …`, and an action's reason. */
const BillingCommand = z.object({ words: z.array(z.string().max(320)).min(1).max(10), reason: z.string().optional() });

export function registerBillingOperatorRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { d } = runtime;
  const at = () => new Date().toISOString();

  /* Where an account's plan stands, and adding money to it as support: the lines `billing` prints, with an account named only by an ID. */
  operatorRoute(app, runtime, 'POST', '/v1/operator/billing', supportScope, async (c, op) => {
    const { words } = await body(c, BillingCommand);
    const lines = await runSupportCommand(d, words, { lookup: 'ids', operator: { keyId: op.keyId, reason: op.reason } });
    return c.json({ lines } satisfies LinesAnswer);
  });

  /* What happened to this payment? */
  operatorRoute(app, runtime, 'GET', '/v1/operator/topups/:reference', 'read', async (c, op) =>
    c.json({ ...(await topUpReport(d, c.req.param('reference') ?? '')), instance: op.instance, at: at() } satisfies TopUpAnswer));

  /* Its provider asked about it again now, as the person's own checkout asks. */
  operatorRoute(app, runtime, 'POST', '/v1/operator/topups/:reference/check', 'write', async (c, op) =>
    c.json({ ...(await checkTopUp(d, c.req.param('reference') ?? '')), instance: op.instance, at: at() } satisfies TopUpCheckAnswer));
}
