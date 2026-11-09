import { AlcoveApiError, GoogleSignInResultSchema, type GoogleSignInResult } from '@alcove/api';
import { log } from './log';

const glog = log.child({ component: 'google-sign-in' });
export const GOOGLE_REFUSED = {
  cancelled: 'Google sign-in was cancelled.',
  expired: 'That sign-in took too long or started in another tab. Try again.',
  unverified: 'Google hasn’t verified that account’s email address, so Alcove can’t use it.',
  'google-email-required': 'Use a Gmail or Google Workspace account to sign in to Alcove.',
  'invite-only': 'Google sign-up is invite-only. Use a Google account with access to Alcove.',
  unavailable: 'Google sign-in isn’t set up on this server.',
  busy: 'Too many sign-in attempts. Wait a minute and try again.',
  failed: 'Couldn’t sign in with Google. Try again.'
} as const;

export const googleSignInChannel = (popup: string) => `alcove-google-sign-in:${popup}`;

/** Start the arrival where the person can see it, after the popup closes or they return to this tab. */
export function waitForGoogleReturn(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const ready = () => {
      if (!signal.aborted && (document.visibilityState !== 'visible' || !document.hasFocus())) return;
      window.removeEventListener('focus', ready);
      document.removeEventListener('visibilitychange', ready);
      signal.removeEventListener('abort', ready);
      resolve();
    };
    window.addEventListener('focus', ready);
    document.addEventListener('visibilitychange', ready);
    signal.addEventListener('abort', ready, { once: true });
    ready();
  });
}

/**
 * Opens during the button press, before any asynchronous work. The completion page uses a same-origin
 * channel: the app's strict opener policy deliberately severs window.opener on the trip to Google.
 * No credentials travel on the channel; the waiting tab asks the API for its session afterwards.
 */
export function openGoogleSignIn(url: (popup?: string) => string, signal: AbortSignal): Promise<GoogleSignInResult | 'redirecting' | null> {
  const redirect = () => { location.assign(url()); return Promise.resolve('redirecting' as const); };
  if (typeof BroadcastChannel === 'undefined') return redirect();
  const id = crypto.randomUUID();
  let channel: BroadcastChannel;
  try { channel = new BroadcastChannel(googleSignInChannel(id)); }
  catch (e) { glog.debug('popup channel unavailable', { err: e }); return redirect(); }
  const width = Math.min(500, screen.availWidth);
  const height = Math.min(720, screen.availHeight);
  const popup = window.open(url(id), '_blank', `popup,width=${width},height=${height},left=${Math.max(0, screenX + (outerWidth - width) / 2)},top=${Math.max(0, screenY + (outerHeight - height) / 2)}`);
  if (!popup) { channel.close(); return redirect(); }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancel);
      channel.close();
      // This handle can be severed by COOP. Completion closes itself after its acknowledgement.
      popup.close();
    };
    const cancel = () => { cleanup(); resolve(null); };
    const timeout = setTimeout(() => { cleanup(); reject(new AlcoveApiError('unavailable', GOOGLE_REFUSED.expired)); }, 10 * 60_000);
    channel.addEventListener('message', (e: MessageEvent<unknown>) => {
      const result = GoogleSignInResultSchema.safeParse(e.data);
      if (!result.success) return;
      channel.postMessage({ type: 'received' });
      cleanup();
      if (result.data.type === 'refused') reject(new AlcoveApiError('unavailable', GOOGLE_REFUSED[result.data.reason]));
      else resolve(result.data);
    });
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
}
