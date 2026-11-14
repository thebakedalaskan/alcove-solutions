import { InviteSecretBodySchema, PeopleSearchBodySchema, PreferencesPatchSchema } from '@alcove/api';
import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import * as account from './account';
import * as profile from '../profile/profile';
import * as people from '../meetings/people';
import * as inviteLinks from '../billing/teams/invite-links';
import { peek } from '../billing/teams/joining';
import { heldNoteIds } from '../notes/access';
import { body } from '../../http/body';
import { clientAddress, type Env } from '../../http/context';
import type { HttpRuntime } from '../../http/runtime';

/**
 * Before sign-in: what a secret after `/invite#` says (features/billing/teams/joining.ts › peek), an invite link's or an
 * invitation's own, for anyone who opens one, and, as the session says when there is one, whether it's the signed-in
 * account's own link or its team's, or an invitation to it (its ID) or to the team it's on. Its secret travels only in the
 * body, and it keeps no receipt.
 */
export function registerAccountPublicRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { d } = runtime;
  const { optionalOwner } = runtime.context;
  const { inviteSecretLimiter } = runtime.limits;

  app.post('/v1/team/link/peek', async (c) => {
    inviteSecretLimiter(clientAddress(c), 'invite secret');
    const { secret } = await body(c, InviteSecretBodySchema);
    return c.json(await peek(d, secret, await optionalOwner(c)));
  });
}

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

  /* The link your Team page copies, your team's or your own: the answer holds a link's secret. */
  app.post('/v1/team/link', async (c) => c.json(await inviteLinks.linkFor(c.get('owner'))));

  /* A new link in place of yours, or your team's as its admin: the one sent before leads nowhere from now on. */
  app.post('/v1/team/link/new', async (c) => c.json(await inviteLinks.renew(c.get('owner'))));
}
