import { PeopleSearchBodySchema, PreferencesSchema, SoundPreferencesSchema, TeamInviteBodySchema } from '@alcove/api';
import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import * as account from './account';
import * as people from './people';
import { body } from '../../http/body';
import { type Env } from '../../http/context';
import type { HttpRuntime } from '../../http/runtime';



export function registerAccountRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { COOKIE, secure } = runtime.context;



  /* Sign-in photos, fetched by Alcove so a browser never asks the provider for anyone's face. */


  /* account */
  app.get('/v1/account/preferences', async (c) => c.json(await account.preferences(c.get('owner'))));

  app.patch('/v1/account/preferences', async (c) => c.json(await account.updatePreferences(c.get('owner'), await body(c, PreferencesSchema.partial().extend({ sounds: SoundPreferencesSchema.optional() })))));

  /* Every session goes with the account; this browser's cookie goes too. */
  app.delete('/v1/account', async (c) => {
    await account.deleteAccount(c.get('owner'));
    deleteCookie(c, COOKIE, { path: '/', secure });
    return c.json({ deleted: true });
  });

  /* people: search terms travel in the body, never the URL */
  app.post('/v1/people/search', async (c) => c.json(await people.search(c.get('owner'), (await body(c, PeopleSearchBodySchema)).query)));

  app.get('/v1/team', async (c) => c.json(await people.team(c.get('owner'))));

  app.post('/v1/team/invites', async (c) => c.json(await people.inviteToTeam(c.get('owner'), (await body(c, TeamInviteBodySchema)).emails)));
}
