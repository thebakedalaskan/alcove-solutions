import { AutoPurchaseBodySchema, BuyLicensesBodySchema, CreateTeamBodySchema, TeamSecretBodySchema } from '@alcove/api';
import { Hono } from 'hono';
import * as teams from './teams';
import { me } from '../account/account';
import { body } from '../../http/body';
import { type Env } from '../../http/context';
import type { HttpRuntime } from '../../http/runtime';

/*
 * A team (docs: Plans and usage › Team), as its admin and members use it. `GET /v1/team` and `POST /v1/team/invites` are
 * the people directory's (features/account/routes.ts), so a team's own are under `/v1/team/` with names of their own. An
 * invite's secret travels only in bodies, never in a URL, and keeps no receipt (http/receipts.ts).
 */
export function registerTeamRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { d } = runtime;

  app.post('/v1/session/visit', async (c) => {
    await teams.visit(d, c.get('owner').ownerId);
    return c.json({ visited: true });
  });
  app.get('/v1/team/mine', async (c) => c.json(await teams.mine(d, c.get('owner').ownerId)));
  app.post('/v1/team/new', async (c) => {
    const { name } = await body(c, CreateTeamBodySchema);
    const o = c.get('owner');
    return c.json(await teams.create(o, await me(o), name));
  });
  app.delete('/v1/team/mine', async (c) => {
    await teams.deleteTeam(c.get('owner'));
    return c.json({ deleted: true });
  });
  app.post('/v1/team/invite', async (c) => c.json(await teams.invite(c.get('owner'))));
  app.post('/v1/team/peek', async (c) => c.json(await teams.peek(d, (await body(c, TeamSecretBodySchema)).secret)));
  app.post('/v1/team/join', async (c) => {
    const { secret } = await body(c, TeamSecretBodySchema);
    const o = c.get('owner');
    return c.json(await teams.join(o, await me(o), secret));
  });
  app.delete('/v1/team/members/:id', async (c) => c.json(await teams.remove(c.get('owner'), c.req.param('id'))));
  app.post('/v1/team/leave', async (c) => {
    await teams.leave(c.get('owner'));
    return c.json({ left: true });
  });
  app.post('/v1/team/licenses', async (c) => {
    const { count, microUsdPerLicense, periods } = await body(c, BuyLicensesBodySchema);
    return c.json(await teams.buyLicenses(c.get('owner'), count, microUsdPerLicense, periods));
  });
  app.post('/v1/team/licenses/refund', async (c) => c.json(await teams.refundLicenses(c.get('owner'))));
  app.put('/v1/team/auto-purchase', async (c) => c.json(await teams.setAutoPurchase(c.get('owner'), (await body(c, AutoPurchaseBodySchema)).on)));
}
