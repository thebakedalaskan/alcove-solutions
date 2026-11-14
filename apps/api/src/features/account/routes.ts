import { InviteSecretBodySchema, PeopleSearchBodySchema, PreferencesPatchSchema, TeamInviteBodySchema } from '@alcove/api';
import { Hono } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import * as account from './account';
import * as profile from '../profile/profile';
import * as people from '../meetings/people';
import * as inviteLinks from '../meetings/invite-links';
import { heldNoteIds } from '../notes/access';
import { findSession } from '../../keys/sessions';
import { body } from '../../http/body';
import { clientAddress, type Env } from '../../http/context';
import { rateLimit } from '../../http/limits';
import type { HttpRuntime } from '../../http/runtime';

/**
 * Before sign-in: who an invite link is from (features/meetings/invite-links.ts), for anyone who opens one, and whether it's
 * the signed-in account's own, which the session says, if there is one. Its secret travels only in the body, and it keeps no
 * receipt.
 */
export function registerAccountPublicRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { d } = runtime;
  const { COOKIE } = runtime.context;
  /** Per client address, as it's public. A link's secret is 256 random bits, so this only keeps it calm. */
  const opening = rateLimit(60, 60_000);

  app.post('/v1/team/link/peek', async (c) => {
    opening(clientAddress(c), 'invite link');
    const { secret } = await body(c, InviteSecretBodySchema);
    return c.json(await inviteLinks.peek(d, secret, (await findSession(d, getCookie(c, COOKIE)))?.ownerId));
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

  app.post('/v1/team/invites', async (c) => c.json(await people.inviteToTeam(c.get('owner'), (await body(c, TeamInviteBodySchema)).emails)));

  /* Your own invite link, and saying your account was made from someone's: the answer, or the body, holds a link's secret. */
  app.post('/v1/team/link', async (c) => c.json(await inviteLinks.mine(c.get('owner'))));

  /* A new link in place of yours: the one you've sent leads nowhere from now on. */
  app.post('/v1/team/link/new', async (c) => c.json(await inviteLinks.renew(c.get('owner'))));

  /* Nothing to say back: whether it counted is the link's sender's to see. */
  app.post('/v1/team/link/joined', async (c) => {
    await inviteLinks.joined(c.get('owner'), (await body(c, InviteSecretBodySchema)).secret);
    return c.body(null, 204);
  });
}
