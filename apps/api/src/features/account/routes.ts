import { PeopleSearchBodySchema, PreferencesPatchSchema, TeamInviteBodySchema } from '@alcove/api';
import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import * as account from './account';
import * as profile from '../profile/profile';
import * as people from '../meetings/people';
import { heldNoteIds } from '../notes/access';
import { body } from '../../http/body';
import { type Env } from '../../http/context';
import type { HttpRuntime } from '../../http/runtime';



export function registerAccountRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { COOKIE, secure } = runtime.context;



  /* Sign-in photos, fetched by Alcove so a browser never asks the provider for anyone's face. */


  /* account */
  /* Pins are checked against the notes someone has. */
  app.get('/v1/account/preferences', async (c) => { const o = c.get('owner'); return c.json(await profile.preferences(o, () => heldNoteIds(o))); });

  app.patch('/v1/account/preferences', async (c) => { const o = c.get('owner'); return c.json(await profile.updatePreferences(o, await body(c, PreferencesPatchSchema), () => heldNoteIds(o))); });

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
