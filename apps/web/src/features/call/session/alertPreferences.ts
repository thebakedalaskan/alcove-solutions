import { NotificationPrefsSchema } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { q, usePreferences } from '~/lib/queries';
import { log } from '~/lib/log';

type AlertPreference = 'replyAlerts' | 'mentionAlerts';
const alog = log.child({ component: 'call-alert-preferences' });
const guestKeys = {
  replyAlerts: { storage: 'alcove.guest.reply-alerts', event: 'alcove-reply-alerts' },
  mentionAlerts: { storage: 'alcove.guest.mention-alerts', event: 'alcove-mention-alerts' }
};
function guestChoice(kind: AlertPreference): boolean {
  try { const raw: unknown = JSON.parse(localStorage.getItem(guestKeys[kind].storage) ?? 'true'); return NotificationPrefsSchema.shape[kind].parse(raw); }
  catch { return true; }
}

/** One owner for call-local visual choices, preserving guest storage keys and signed-in profile preferences. */
export function useCallAlertPreference(kind: AlertPreference) {
  const session = useQuery(q.session());
  const prefs = useQuery({ ...q.prefs(), enabled: Boolean(session.data) });
  const write = usePreferences();
  const toast = useToast();
  const [guest, setGuest] = useState(() => guestChoice(kind));
  useEffect(() => {
    const changed = () => setGuest(guestChoice(kind));
    addEventListener('storage', changed); addEventListener(guestKeys[kind].event, changed);
    return () => { removeEventListener('storage', changed); removeEventListener(guestKeys[kind].event, changed); };
  }, [kind]);
  const ready = session.isSuccess && (!session.data || prefs.isSuccess);
  const enabled = session.data ? prefs.data?.notifications[kind] ?? true : guest;
  const update = (on: boolean) => {
    if (!ready) return;
    if (session.data && prefs.data) write.mutate({ notifications: { [kind]: on } }, { onError: () => toast('Call alerts couldn’t be saved.', { icon: 'x' }) });
    else {
      setGuest(on);
      try { localStorage.setItem(guestKeys[kind].storage, JSON.stringify(on)); dispatchEvent(new Event(guestKeys[kind].event)); }
      catch (error) { alog.debug('call alert choice stays in this tab', { err: error }); }
    }
  };
  return { enabled: ready && enabled, update, ready };
}
