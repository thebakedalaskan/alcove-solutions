/** One sealed account preference model; guests deliberately opt in using the same validated local shape. */
import { DEFAULT_NOTIFICATION_PREFERENCES, NotificationPrefsSchema, errorMessage, type NotificationPrefs } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { log } from './log';
import { q, usePreferences } from './queries';

const KEY = 'alcove.guest.notifications';
const nlog = log.child({ component: 'notification-preferences' });
function guestPrefs(): NotificationPrefs {
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
  const save = usePreferences();
  const toast = useToast();
  const [guest, setGuest] = useState(guestPrefs);
  useEffect(() => {
    const changed = () => setGuest(guestPrefs());
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
      save.mutate({ notifications: { ...now.notifications, ...patch } }, { onError: (e) => toast(`Couldn’t save notifications. ${errorMessage(e)}`, { icon: 'x' }) });
    } else {
      if (nowSession !== null) return;
      const next = NotificationPrefsSchema.parse({ ...guestPrefs(), ...patch });
      setGuest(next);
      try { localStorage.setItem(KEY, JSON.stringify(next)); dispatchEvent(new Event('alcove-guest-notifications')); }
      catch (e) { nlog.debug('guest notification choices stay in this tab', { err: e }); }
    }
  };
  return { prefs: account ? profile.data?.notifications ?? DEFAULT_NOTIFICATION_PREFERENCES : guest, update,
    scope: account?.ownerId ?? 'guest', ownerId: account?.ownerId ?? null,
    ready: !session.isPending && !session.isError && (!account || Boolean(profile.data)) };
}
