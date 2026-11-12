import { StartTopUpBodySchema } from '@alcove/api';
import { Hono } from 'hono';
import * as deposits from './deposits';
import { planOf } from './plan-view';
import { body } from '../../http/body';
import { type Env } from '../../http/context';
import type { HttpRuntime } from '../../http/runtime';



export function registerBillingRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { d } = runtime;
  const { topUpLimiter, topUpCheckLimiter } = runtime.limits;

  /* the plan, and adding money to the balance it's bought with */
  app.get('/v1/plan', async (c) => c.json(await planOf(d, c.get('owner').ownerId)));
  app.get('/v1/plan/routes', async (c) => c.json(await deposits.routes(d)));
  app.post('/v1/plan/top-ups', async (c) => {
    topUpLimiter(c.get('owner').ownerId, 'top-up');
    const { routeId, microUsd } = await body(c, StartTopUpBodySchema);
    return c.json(await deposits.start(d, c.get('owner').ownerId, routeId, microUsd));
  });
  app.post('/v1/plan/top-ups/:id/cancel', async (c) => c.json(await deposits.cancel(d, c.get('owner').ownerId, c.req.param('id'))));
  app.get('/v1/plan/top-ups/:id', async (c) => {
    topUpCheckLimiter(c.get('owner').ownerId, 'top-up-check');
    return c.json(await deposits.get(d, c.get('owner').ownerId, c.req.param('id')));
  });
  app.get('/v1/plan/top-ups', async (c) => c.json(await deposits.list(d, c.get('owner').ownerId)));
}
