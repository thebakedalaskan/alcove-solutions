import { GoogleSignInPopupIdSchema, SignInBodySchema } from '@alcove/api';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { log } from '../../log';
import * as google from '../../google';
import { openOwner } from '../../owners';
import { findSession } from '../../sessions';
import * as account from './account';
import * as calendar from '../meetings/calendar';
import { clientAddress, type Env } from '../../http/context';
import { body } from '../../http/body';
import type { HttpRuntime } from '../../http/runtime';

const rlog = log.child({ component: 'http' });



export function registerAuthRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { d } = runtime;
  const { limiter } = runtime.limits;
  const { secure, COOKIE, startSession } = runtime.context;

  /* Carries the sealed sign-in attempt to Google and back. Lax, because Google's redirect back is a cross-site navigation. */
  const ATTEMPT = secure ? '__Host-alcove_google' : 'alcove_google';

  const backToWelcome = (reason: google.Refusal, popup?: string) => `${d.cfg.WEB_ORIGIN}/welcome?${new URLSearchParams({ ...(popup ? { popup } : {}), signin: reason })}`;

  /* ---------- public: the session and signing in ---------- */
  app.get('/v1/session', async (c) => {
    const s = await findSession(d, getCookie(c, COOKIE));
    return c.json(s ? await account.sessionFor(await openOwner(d, s.ownerId, s)) : null);
  });

  app.post('/v1/auth/sign-in', async (c) => {
    deleteCookie(c, secure ? '__Host-alcove_drive' : 'alcove_drive', { path: '/', secure });
    limiter(clientAddress(c), 'sign-in');
    const r = await account.demoSignIn(d, await body(c, SignInBodySchema));
    startSession(c, r.sessionId);
    return c.json({ session: await account.sessionFor(r.owner), isNew: r.isNew });
  });

  /* Google: away to Google and back. Both ends are top-level navigations, so both answer with redirects. */
  const allowed = (c: Context) => {
    try { limiter(clientAddress(c), 'sign-in'); return true; } catch { rlog.info('google sign-in refused', { reason: 'busy' }); return false; }
  };

  app.get('/v1/auth/google', async (c) => {
    deleteCookie(c, secure ? '__Host-alcove_drive' : 'alcove_drive', { path: '/', secure });
    const parsedPopup = GoogleSignInPopupIdSchema.safeParse(c.req.query('popup'));
    const popup = parsedPopup.success ? parsedPopup.data : undefined;
    if (!allowed(c)) return c.redirect(backToWelcome('busy', popup), 302);
    if (!google.configured(d.cfg)) return c.redirect(backToWelcome('unavailable', popup), 302);
    try {
      // ?consent=1 asks Google again, e.g. to connect the calendar of the account already signed in.
      const consent = c.req.query('consent') === '1';
      const s = consent ? await findSession(d, getCookie(c, COOKIE)) : undefined;
      const hint = s ? (await account.profile(await openOwner(d, s.ownerId, s))).email : undefined;
      // ?next=/move comes back to a move to this device that was waiting for its owner to sign in here.
      const next = c.req.query('next') === '/move' ? '/move' as const : s ? '/home' as const : undefined;
      const { url, attempt } = await google.begin(d, { consent, hint, next, popup });
      setCookie(c, ATTEMPT, attempt, { httpOnly: true, sameSite: 'Lax', path: '/', secure, maxAge: google.ATTEMPT_MINUTES * 60 });
      return c.redirect(url, 302);
    } catch (e) {
      rlog.warn('google sign-in could not start', { err: e });
      return c.redirect(backToWelcome('failed', popup), 302);
    }
  });

  app.get('/v1/auth/google/callback', async (c) => {
    const attempt = getCookie(c, ATTEMPT);
    deleteCookie(c, ATTEMPT, { path: '/', secure });
    const popup = google.popupFor(d, c.req.query(), attempt);
    if (!allowed(c)) return c.redirect(backToWelcome('busy', popup), 302);
    try {
      const r = await google.finish(d, c.req.query(), attempt);
      if (!r.ok) return c.redirect(backToWelcome(r.reason, popup), 302);
      const s = await account.signIn(d, r.identity, 'google');
      const conn = await calendar.connect(s.owner, r.grant);
      startSession(c, s.sessionId);
      const next = r.next ?? (s.isNew ? '/ready' : '/home');
      // Google sends a refresh token only the first time someone agrees. If it remembered an earlier
      // yes, ask once more, explicitly, so the calendar keeps working after this hour.
      if (r.grant.scopes.includes(google.CALENDAR_SCOPE) && !conn.refreshToken && !r.consented) {
        const again = await google.begin(d, { consent: true, hint: r.identity.email, next, popup });
        setCookie(c, ATTEMPT, again.attempt, { httpOnly: true, sameSite: 'Lax', path: '/', secure, maxAge: google.ATTEMPT_MINUTES * 60 });
        return c.redirect(again.url, 302);
      }
      return c.redirect(popup ? `${d.cfg.WEB_ORIGIN}/welcome?${new URLSearchParams({ popup, next })}` : `${d.cfg.WEB_ORIGIN}${next}`, 302);
    } catch (e) {
      rlog.error('google sign-in failed', { err: e });
      return c.redirect(backToWelcome('failed', popup), 302);
    }
  });
}
