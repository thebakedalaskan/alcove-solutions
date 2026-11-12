import { BuyHoursBodySchema, BuyProBodySchema, RenewBodySchema, StartTopUpBodySchema } from '@alcove/api';
import { Hono } from 'hono';
import * as deposits from './deposits';
import { offersOf, planOf } from './plan-view';
import { buyHours, buyPro, dismissNotice, refundPro, setRenew } from './plans';
import { body } from '../../http/body';
import { type Env } from '../../http/context';
import type { HttpRuntime } from '../../http/runtime';



export function registerBillingRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { d } = runtime;
  const { topUpLimiter, topUpCheckLimiter } = runtime.limits;

  /* the plan, buying Pro and more notes from the balance, and adding money to the balance */
  app.get('/v1/plan', async (c) => c.json(await planOf(d, c.get('owner').ownerId)));
  app.get('/v1/plan/offers', async (c) => c.json(await offersOf(d)));
  app.post('/v1/plan/pro', async (c) => {
    const { months, microUsdPerMonth } = await body(c, BuyProBodySchema);
    await buyPro(d, c.get('owner').ownerId, months, microUsdPerMonth);
    return c.json(await planOf(d, c.get('owner').ownerId));
  });
  app.post('/v1/plan/hours', async (c) => {
    const { packs, microUsdPerPack } = await body(c, BuyHoursBodySchema);
    await buyHours(d, c.get('owner').ownerId, packs, microUsdPerPack);
    return c.json(await planOf(d, c.get('owner').ownerId));
  });
  app.post('/v1/plan/pro/refund', async (c) => {
    await refundPro(d, c.get('owner').ownerId);
    return c.json(await planOf(d, c.get('owner').ownerId));
  });
  app.put('/v1/plan/renew', async (c) => {
    const { renew } = await body(c, RenewBodySchema);
    await setRenew(d, c.get('owner').ownerId, renew);
    return c.json(await planOf(d, c.get('owner').ownerId));
  });
  app.post('/v1/plan/notices/:id/dismiss', async (c) => {
    await dismissNotice(d, c.get('owner').ownerId, c.req.param('id'));
    return c.json(await planOf(d, c.get('owner').ownerId));
  });
  app.get('/v1/plan/routes', async (c) => c.json(await deposits.routes(d)));
  app.post('/v1/plan/top-ups', async (c) => {
    topUpLimiter(c.get('owner').ownerId, 'top-up');
    const { routeId, microUsd, buys } = await body(c, StartTopUpBodySchema);
    return c.json(await deposits.start(d, c.get('owner').ownerId, routeId, microUsd, buys));
  });
  app.post('/v1/plan/top-ups/:id/cancel', async (c) => c.json(await deposits.cancel(d, c.get('owner').ownerId, c.req.param('id'))));
  app.get('/v1/plan/top-ups/:id', async (c) => {
    topUpCheckLimiter(c.get('owner').ownerId, 'top-up-check');
    return c.json(await deposits.get(d, c.get('owner').ownerId, c.req.param('id')));
  });
  app.get('/v1/plan/top-ups', async (c) => c.json(await deposits.list(d, c.get('owner').ownerId)));
}
