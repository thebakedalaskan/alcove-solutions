import { GoogleSignInPopupIdSchema, SignInBodySchema, type CalendarConnectResult } from '@alcove/api';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { log } from '../../log';
import * as google from '../../google';
import { b64u, unb64u } from '../../crypto';
import { ForbiddenError, GoogleEmailRequiredError, GoogleSignupInviteRequiredError } from '../../errors';
import { openOwner } from '../../owners';
import { findSession, stillOpen } from '../../sessions';
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

  const backToWelcome = (reason: google.Refusal | 'invite-only' | 'google-email-required', popup?: string) => `${d.cfg.WEB_ORIGIN}/welcome?${new URLSearchParams({ ...(popup ? { popup } : {}), signin: reason })}`;
  /* Calendar consent goes back with how it went: to Home when it was started there, otherwise to Calendar settings. */
  const backToCalendar = (result: CalendarConnectResult, back: google.CalendarBack | undefined) =>
    back ? `${d.cfg.WEB_ORIGIN}${back}?calendar=${result}` : `${d.cfg.WEB_ORIGIN}/settings?calendar=${result}#calendar`;

  /* ---------- public: the session and signing in ---------- */
  app.get('/v1/session', async (c) => {
    const s = await findSession(d, getCookie(c, COOKIE));
    return c.json(s ? await account.sessionFor(await openOwner(d, s.ownerId, s)) : null);
  });

  app.post('/v1/auth/sign-in', async (c) => {
    if (!d.cfg.DEMO_AUTH_ENABLED) throw new ForbiddenError('Demo sign-in is unavailable.', { level: 'info' });
    deleteCookie(c, secure ? '__Host-alcove_drive' : 'alcove_drive', { path: '/', secure });
    limiter(clientAddress(c), 'sign-in');
    const r = await account.demoSignIn(d, await body(c, SignInBodySchema));
    deleteCookie(c, ATTEMPT, { path: '/', secure });
    startSession(c, r.sessionId);
    return c.json({ session: await account.sessionFor(r.owner), isNew: r.isNew });
  });

  /* Google: away to Google and back. Both ends are top-level navigations, so both answer with redirects. */
  const allowed = (c: Context) => {
    try { limiter(clientAddress(c), 'sign-in'); return true; } catch { rlog.info('google sign-in refused', { reason: 'busy' }); return false; }
  };

  app.get('/v1/auth/google', async (c) => {
    const consent = c.req.query('consent') === '1';
    if (!consent) deleteCookie(c, secure ? '__Host-alcove_drive' : 'alcove_drive', { path: '/', secure });
    const parsedPopup = GoogleSignInPopupIdSchema.safeParse(c.req.query('popup'));
    const popup = parsedPopup.success ? parsedPopup.data : undefined;
    // ?back=/home: Calendar consent started on Home goes back there, as ?next= says where signing in lands. Any other
    // value goes back to Settings.
    const back = consent && c.req.query('back') === '/home' ? '/home' as const : undefined;
    if (!allowed(c)) return c.redirect(consent ? backToCalendar('failed', back) : backToWelcome('busy', popup), 302);
    if (!google.configured(d.cfg)) return c.redirect(consent ? backToCalendar('failed', back) : backToWelcome('unavailable', popup), 302);
    try {
      const s = consent ? await findSession(d, getCookie(c, COOKIE)) : undefined;
      // Signed out meanwhile: Home and Settings would only send the browser on to the welcome page.
      if (consent && !s) return c.redirect(backToWelcome('expired'), 302);
      if (s && s.provider !== 'google') return c.redirect(backToCalendar('account', back), 302);
      // ?next=/move comes back to a move to this device that was waiting for its owner to sign in here.
      const next = !consent && c.req.query('next') === '/move' ? '/move' as const : undefined;
      const { url, attempt } = await google.begin(d, { calendar: s ? { ownerId: s.ownerId, sessionHash: b64u(s.hash) } : undefined, next, popup: consent ? undefined : popup, back });
      setCookie(c, ATTEMPT, attempt, { httpOnly: true, sameSite: 'Lax', path: '/', secure, maxAge: google.ATTEMPT_MINUTES * 60 });
      return c.redirect(url, 302);
    } catch (e) {
      rlog.warn('google sign-in could not start', { err: e });
      return c.redirect(consent ? backToCalendar('failed', back) : backToWelcome('failed', popup), 302);
    }
  });

  app.get('/v1/auth/google/callback', async (c) => {
    const attempt = google.attemptFor(d, c.req.query(), getCookie(c, ATTEMPT));
    // A late callback from another tab must not erase the current attempt.
    if (attempt) deleteCookie(c, ATTEMPT, { path: '/', secure });
    const popup = attempt?.popup ?? undefined;
    // Only the sealed attempt says where Calendar consent goes back to, never the callback's address.
    const back = attempt?.back;
    if (!allowed(c)) return c.redirect(attempt?.consent ? backToCalendar('failed', back) : backToWelcome('busy', popup), 302);
    try {
      // An in-flight Calendar attempt from before session binding cannot connect or sign in.
      if (attempt?.consent && !attempt.calendar) return c.redirect(backToCalendar('failed', back), 302);
      const r = await google.finish(d, c.req.query(), attempt);
      if (!r.ok) return c.redirect(attempt?.consent ? backToCalendar(r.reason === 'cancelled' ? 'denied' : 'failed', back) : backToWelcome(r.reason, popup), 302);
      if (attempt?.calendar) {
        const { ownerId, sessionHash } = attempt.calendar;
        // Google comes back cross-site, so the Strict session cookie is normally absent.
        const cookie = getCookie(c, COOKIE);
        const current = cookie ? await findSession(d, cookie) : undefined;
        if ((cookie && (!current || b64u(current.hash) !== sessionHash)) || !await stillOpen(d, unb64u(sessionHash))) {
          rlog.info('google calendar connection refused', { reason: 'session-changed' });
          return c.redirect(backToCalendar('failed', back), 302);
        }
        if (!await account.hasIdentity(d, ownerId, r.identity)) {
          rlog.info('google calendar connection refused', { reason: 'different-account' });
          return c.redirect(backToCalendar('account', back), 302);
        }
        if (!r.grant.scopes.some(google.isCalendarEventScope)) return c.redirect(backToCalendar('denied', back), 302);
        const o = await openOwner(d, ownerId, undefined);
        try { return c.redirect(backToCalendar(await calendar.connect(o, r.grant) ? 'connected' : 'failed', back), 302); }
        finally { o.root.fill(0); o.wrapKey.fill(0); }
      }
      const s = await account.signIn(d, { provider: 'google', who: r.identity });
      startSession(c, s.sessionId);
      const next = attempt?.next ?? (s.isNew ? '/ready' : '/home');
      return c.redirect(popup ? `${d.cfg.WEB_ORIGIN}/welcome?${new URLSearchParams({ popup, next })}` : `${d.cfg.WEB_ORIGIN}${next}`, 302);
    } catch (e) {
      if (e instanceof GoogleEmailRequiredError) {
        rlog.info('google sign-in refused', { reason: 'google-email-required' });
        return c.redirect(backToWelcome('google-email-required', popup), 302);
      }
      if (e instanceof GoogleSignupInviteRequiredError) {
        rlog.info('google sign-up refused', { reason: 'invite-only' });
        return c.redirect(backToWelcome('invite-only', popup), 302);
      }
      rlog.error('google sign-in failed', { err: e });
      return c.redirect(attempt?.consent ? backToCalendar('failed', back) : backToWelcome('failed', popup), 302);
    }
  });
}
