import { AcceptInvitationBodySchema, AutoPurchaseBodySchema, BuyLicensesBodySchema, CreateTeamBodySchema, InviteByEmailBodySchema, JoinTeamBodySchema, MailStopBodySchema, RenameTeamBodySchema, type MyTeam } from '@alcove/api';
import { Hono, type Context } from 'hono';
import * as teams from './teams';
import * as invitations from './invitations';
import * as joining from './joining';
import { me } from '../../profile/profile';
import { log } from '../../../platform/log';
import { stopMail } from '../../../platform/mail';
import { body } from '../../../http/body';
import { clientAddress, type Env } from '../../../http/context';
import type { HttpRuntime } from '../../../http/runtime';

const mlog = log.child({ component: 'mail' });

/**
 * A team as a receipt keeps it (http/receipts.ts), for a retry to answer with: the answer's shape, by IDs, roles, times and
 * counts, with nobody's name or address and not the team's name, as a meeting's receipt keeps it without its documents
 * (features/meetings/routes.ts). Whoever's on the team, and whoever's invited, can leave it or be taken off within a
 * receipt's day, and one filed under someone mustn't name them for it. A retry, rare as it is, answers with this; the app
 * reads the team again for its names.
 */
const asKept = (t: MyTeam): MyTeam => ({
  ...t, name: '',
  members: t.members.map((m) => ({ ...m, person: { id: m.id, name: '', email: '' } })),
  invitations: t.invitations.map((i) => ({ ...i, person: { id: i.id, name: '', email: '' }, invitedBy: { id: '', name: '', email: '' } }))
});
/** Answers with the team as it is now, keeping its receipt as `asKept` has it. */
const teamAnswer = (c: Context<Env>, t: MyTeam) => { c.set('receipt', JSON.stringify(asKept(t))); return c.json(t); };

/*
 * A team (docs: Plans and usage › Team), as its admin and members use it, and its invitations. `GET /v1/team` and the
 * `/v1/team/link…` routes are the people directory's (features/account/routes.ts), so a team's own are under `/v1/team/`
 * with names of their own. A secret after `/invite#` travels only in bodies, never in a URL; joining by one shares the peek's
 * budget for each client address, and its receipt keeps the team as `asKept` has it, as inviting, sending again, cancelling,
 * accepting and renaming do. Putting an invitation aside keeps none (http/receipts.ts): it's theirs alone to know.
 */
export function registerTeamRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { d } = runtime;
  const { inviteSecretLimiter } = runtime.limits;

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
  app.put('/v1/team/name', async (c) => teamAnswer(c, await teams.rename(c.get('owner'), (await body(c, RenameTeamBodySchema)).name)));
  app.delete('/v1/team/mine', async (c) => {
    await teams.deleteTeam(c.get('owner'));
    return c.json({ deleted: true });
  });

  /* invitations: made by anyone on the team, seen in the app by whoever they're to */
  app.post('/v1/team/invitations', async (c) => {
    const { emails } = await body(c, InviteByEmailBodySchema);
    const o = c.get('owner');
    const made = await joining.invite(o, await me(o), emails);
    c.set('receipt', JSON.stringify({ ...made, team: asKept(made.team) }));
    return c.json(made);
  });
  app.get('/v1/team/invitations', async (c) => c.json(await invitations.forYou(c.get('owner'))));
  app.post('/v1/team/invitations/:id/resend', async (c) => {
    const o = c.get('owner');
    await invitations.resend(o, c.req.param('id'));
    return teamAnswer(c, await teams.requireTeam(o, o.ownerId));
  });
  app.delete('/v1/team/invitations/:id', async (c) => {
    const o = c.get('owner');
    await invitations.cancel(o, c.req.param('id'));
    return teamAnswer(c, await teams.requireTeam(o, o.ownerId));
  });
  app.post('/v1/team/invitations/:id/accept', async (c) => {
    const { leave } = await body(c, AcceptInvitationBodySchema);
    const o = c.get('owner');
    return teamAnswer(c, await joining.acceptInvitation(o, await me(o), c.req.param('id'), leave));
  });
  app.post('/v1/team/invitations/:id/put-aside', async (c) => {
    await invitations.putAside(c.get('owner'), c.req.param('id'));
    return c.json({ putAside: true });
  });
  app.post('/v1/team/join', async (c) => {
    inviteSecretLimiter(clientAddress(c), 'invite secret');
    const { secret, leave } = await body(c, JoinTeamBodySchema);
    const o = c.get('owner');
    return teamAnswer(c, await joining.joinBySecret(o, await me(o), secret, leave));
  });
  app.post('/v1/team/upgrade-ask', async (c) => {
    await teams.askToUpgrade(c.get('owner'));
    return c.json({ asked: true });
  });

  app.delete('/v1/team/members/:id', async (c) => c.json(await teams.remove(c.get('owner'), c.req.param('id'))));
  app.post('/v1/team/leave', async (c) => {
    await teams.leave(c.get('owner'));
    return c.json({ left: true });
  });
  app.post('/v1/team/licenses', async (c) => {
    const { count, microUsdPerLicense, periods, autoPurchase } = await body(c, BuyLicensesBodySchema);
    return c.json(await teams.buyLicenses(c.get('owner'), count, microUsdPerLicense, periods, autoPurchase ?? null));
  });
  app.post('/v1/team/licenses/refund', async (c) => c.json(await teams.refundLicenses(c.get('owner'))));
  app.put('/v1/team/auto-purchase', async (c) => c.json(await teams.setAutoPurchase(c.get('owner'), (await body(c, AutoPurchaseBodySchema)).on)));
}

/** A stop token, from a mail app's one-click POST (in the URL, RFC 8058) or the app's page (in the body). Null: none that reads. */
async function stopTokenOf(c: Context<Env>): Promise<string | null> {
  const inUrl = MailStopBodySchema.shape.token.safeParse(c.req.query('token'));
  if (inUrl.success) return inUrl.data;
  if (!(c.req.header('content-type') ?? '').toLowerCase().startsWith('application/json')) return null;
  const inBody = MailStopBodySchema.safeParse(await c.req.json().catch(() => null));
  return inBody.success ? inBody.data.token : null;
}

/**
 * Before sign-in: stopping Alcove's invitation emails, from the link in an email's foot (the app's `/stop-email` page sends
 * the token in the body) or a mail app's one-click unsubscribe (RFC 8058: a POST to the email's List-Unsubscribe URL, with the
 * token in it). Whatever the token, the answer is the same, and only what came of it is logged: a token names nobody, but
 * it's still kept out of every log line, as every query string is. A GET of the same URL, as a mail app that opens it in a
 * browser sends, goes on to that page, with the token where no server sees it; nothing is stopped by a GET.
 */
export function registerTeamPublicRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { d } = runtime;
  const { mailStopLimiter } = runtime.limits;

  app.post('/v1/mail/stop', async (c) => {
    mailStopLimiter(clientAddress(c), 'mail stop');
    const token = await stopTokenOf(c);
    mlog.info('mail stop asked', { outcome: token === null ? 'refused' : await stopMail(d, token) });
    return c.body(null, 204);
  });
  app.get('/v1/mail/stop', async (c) => {
    mailStopLimiter(clientAddress(c), 'mail stop');
    const token = MailStopBodySchema.shape.token.safeParse(c.req.query('token'));
    return c.redirect(`${d.cfg.WEB_ORIGIN}/stop-email${token.success ? `#${token.data}` : ''}`, 303);
  });
}
