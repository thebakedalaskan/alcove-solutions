/** One sealed account preference model; guests deliberately opt in using the same validated local shape. */
import { DEFAULT_NOTIFICATION_PREFERENCES, NotificationPrefsSchema, errorMessage, type NotificationPrefs, type Session } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { log } from './log';
import { announceNotificationPreferences, notificationPreferenceIntent, watchNotificationPreferences } from './notification-preference-channel';
import { accountGeneration } from './signedOut';
import { q, usePreferences } from './queries';

const KEY = 'alcove.guest.notifications';
const identityOf = (session: Session | null | undefined) => session ? `${session.ownerId}:${session.createdAt}` : session === null ? 'guest' : 'unknown';
const nlog = log.child({ component: 'notification-preferences' });
/**
 * What the previous release stored for a guest's call toasts: switches under keys of their own, on when absent or
 * unreadable. Its guest record's `replyAlerts` and `mentionAlerts` were only ever the defaults, so these are what count.
 */
const PREVIOUS = { replies: 'alcove.guest.reply-alerts', chatMentions: 'alcove.guest.mention-alerts' } as const;
function previousSwitch(raw: string | null): boolean {
  if (raw === null) return true;
  try { const value: unknown = JSON.parse(raw); return typeof value === 'boolean' ? value : true; } catch { return true; }
}
export function guestNotificationPreferences(): NotificationPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    const stored: unknown = raw === null ? null : JSON.parse(raw);
    const replySwitch = localStorage.getItem(PREVIOUS.replies);
    const mentionSwitch = localStorage.getItem(PREVIOUS.chatMentions);
    const record = typeof stored === 'object' && stored !== null ? stored : null;
    if (replySwitch === null && mentionSwitch === null && !(record && ('replyAlerts' in record || 'mentionAlerts' in record))) {
      const parsed = record ? NotificationPrefsSchema.safeParse(record) : null;
      return parsed?.success ? parsed.data : DEFAULT_NOTIFICATION_PREFERENCES;
    }
    // Once: the previous release's switches fold into the Alert ticks they became (in place of its record's own copies,
    // or over the defaults with no record), the record is written in the current shape, and the old keys go.
    const replyAlerts = previousSwitch(replySwitch);
    const mentionAlerts = previousSwitch(mentionSwitch);
    const parsed = record ? NotificationPrefsSchema.safeParse({ ...record, replyAlerts, mentionAlerts }) : null;
    const folded = parsed?.success ? parsed.data : { ...DEFAULT_NOTIFICATION_PREFERENCES, replies: replyAlerts, chatMentions: mentionAlerts };
    try {
      localStorage.setItem(KEY, JSON.stringify(folded));
      localStorage.removeItem(PREVIOUS.replies); localStorage.removeItem(PREVIOUS.chatMentions);
    } catch (e) { nlog.debug('guest call alert choices not moved yet', { err: e }); }
    return folded;
  } catch { return DEFAULT_NOTIFICATION_PREFERENCES; }
}
/** The last settled choice each query client read the account's preferences again for. */
const refreshedFor = new WeakMap<QueryClient, string>();
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
      if (signal.phase === 'pending' || signal.ownerId === null || qc.getQueryData(q.session().queryKey)?.ownerId !== signal.ownerId) return;
      // Every instance hears the same settled choice: the first reads the preferences again, the rest leave it be.
      const settled = `${signal.nonce}:${signal.phase}`;
      if (refreshedFor.get(qc) === settled) return;
      refreshedFor.set(qc, settled);
      void qc.invalidateQueries({ queryKey: q.prefs().queryKey, exact: true });
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
