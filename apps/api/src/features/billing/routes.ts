import { Hono } from 'hono';
import * as billing from './service';
import { type Env } from '../../http/context';
import type { HttpRuntime } from '../../http/runtime';



export function registerBillingRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { d } = runtime;

  /* credits */
  app.get('/v1/credits', async (c) => c.json(await billing.balance(d, c.get('owner').ownerId)));
}
