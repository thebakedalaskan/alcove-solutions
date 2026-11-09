/** One sealed account preference model; guests deliberately opt in using the same validated local shape. */
import { DEFAULT_NOTIFICATION_PREFERENCES, NotificationPrefsSchema, errorMessage, type NotificationPrefs, type Session } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { log } from './log';
import { announceNotificationPreferences, notificationPreferenceIntent, watchNotificationPreferences } from './notification-preference-channel';
import { accountGeneration } from './signedOut';
import { q, usePreferences } from './queries';

const KEY = 'alcove.guest.notifications';
const identityOf = (session: Session | null | undefined) => session ? `${session.ownerId}:${session.createdAt}` : session === null ? 'guest' : 'unknown';
const nlog = log.child({ component: 'notification-preferences' });
export function guestNotificationPreferences(): NotificationPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw === null ? null : NotificationPrefsSchema.safeParse(JSON.parse(raw));
    return parsed?.success ? parsed.data : DEFAULT_NOTIFICATION_PREFERENCES;
  } catch { return DEFAULT_NOTIFICATION_PREFERENCES; }
}
export function useNotificationPreferences() {
  const session = useQuery(q.session());
  const account = session.data;
  const profile = useQuery({ ...q.prefs(), enabled: Boolean(account) });
  const qc = useQueryClient();
  const identity = useRef({ key: identityOf(account), revision: 0 });
  const trackIdentity = () => {
    const key = identityOf(qc.getQueryData(q.session().queryKey));
    if (key !== identity.current.key) identity.current = { key, revision: identity.current.revision + 1 };
  };
  useEffect(() => {
    trackIdentity();
    return qc.getQueryCache().subscribe((event) => { if (event.query.queryKey.length === 1 && event.query.queryKey[0] === 'session') trackIdentity(); });
  }, [qc]);
  const capturePermissionIntent = () => {
    trackIdentity();
    const before = qc.getQueryData(q.session().queryKey);
    const key = identityOf(before);
    const revision = identity.current.revision;
    const generation = before ? accountGeneration(before.ownerId) : null;
    return () => {
      trackIdentity();
      return key !== 'unknown' && identity.current.key === key && identity.current.revision === revision
        && (!before || (generation !== null && accountGeneration(before.ownerId) === generation));
    };
  };
  const save = usePreferences();
  const toast = useToast();
  const [guest, setGuest] = useState(guestNotificationPreferences);
  const [intentVersion, refreshIntent] = useState(0);
  useEffect(() => {
    const refresh = () => refreshIntent((version) => version + 1);
    const stop = watchNotificationPreferences((signal) => {
      if (signal.phase !== 'pending' && signal.ownerId !== null && qc.getQueryData(q.session().queryKey)?.ownerId === signal.ownerId) void qc.invalidateQueries({ queryKey: q.prefs().queryKey, exact: true });
    });
    addEventListener('alcove-notification-preferences', refresh);
    return () => { removeEventListener('alcove-notification-preferences', refresh); stop(); };
  }, [qc]);
  useEffect(() => {
    const changed = () => setGuest(guestNotificationPreferences());
    addEventListener('storage', changed); addEventListener('alcove-guest-notifications', changed);
    return () => { removeEventListener('storage', changed); removeEventListener('alcove-guest-notifications', changed); };
  }, []);
  const update = (patch: Partial<NotificationPrefs>) => {
    if (session.isPending || session.isError) return;
    const nowSession = qc.getQueryData(q.session().queryKey);
    if (account) {
      if (nowSession?.ownerId !== account.ownerId) return;
      const now = qc.getQueryData(q.prefs().queryKey);
      if (!now) return;
      save.mutate({ notifications: patch }, { onError: (e) => toast(`Couldn’t save notifications. ${errorMessage(e)}`, { icon: 'x' }) });
    } else {
      if (nowSession !== null) return;
      const next = NotificationPrefsSchema.parse({ ...guestNotificationPreferences(), ...patch });
      setGuest(next);
      announceNotificationPreferences(null, patch);
      try { localStorage.setItem(KEY, JSON.stringify(next)); dispatchEvent(new Event('alcove-guest-notifications')); }
      catch (e) { nlog.debug('guest notification choices stay in this tab', { err: e }); }
    }
  };
  const prefs = useMemo(() => ({ ...(account ? profile.data?.notifications ?? DEFAULT_NOTIFICATION_PREFERENCES : guest), ...notificationPreferenceIntent(account?.ownerId ?? null) }), [account, profile.data?.notifications, guest, intentVersion]);
  return { prefs, update,
    scope: `${identityOf(account)}:${identity.current.revision}`, capturePermissionIntent, ownerId: account?.ownerId ?? null,
    ready: !session.isPending && !session.isError && (!account || Boolean(profile.data)) };
}
