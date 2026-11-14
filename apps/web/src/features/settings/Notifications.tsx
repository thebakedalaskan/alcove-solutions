/*
 * Notifications on Settings: the ways in one panel (the browser's own notifications, the sounds and how loud they are, quiet
 * mode, and the reminder before a call), What reaches you in the next. They're the notifications' own controls
 * (features/notifications/Controls.tsx), which a call's own Settings shows too; here each change is kept for the account, and
 * its row says Saved for a moment once it is.
 */
import { Segmented, SettingsGroup, SettingsPanel } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { accountQueries } from '~/features/account/queries';
import { readPrefs } from '~/features/call/media/devices';
import { BrowserNotifications, IN_A_CALL, OUTSIDE_A_CALL, QuietMode, Sounds, WhatReachesYou, type Writes } from '~/features/notifications/Controls';
import { useNotificationPreferences } from '~/features/notifications/preferences';
import { Setting, useSave, useSaveState } from './save';

const BEFORE = [{ value: '1', label: '1 min' }, { value: '5', label: '5 min' }, { value: 'off', label: 'Off' }] satisfies { value: '1' | '5' | 'off'; label: string }[];

/** Notifications on Settings: the ways in one panel, What reaches you in the next. Each change is kept for the account. */
export function NotificationsGroup() {
  const prefs = useQuery(accountQueries.prefs()).data;
  const choices = useNotificationPreferences();
  const save = useSave();
  const saved = useSaveState();
  if (!prefs) return null;
  const writes: Writes = { notify: (label, patch) => save(label, { notifications: patch }), sound: (label, patch) => save(label, { sounds: patch }), saved };
  const n = choices.prefs;
  return (
    <SettingsGroup id="notifications" title="Notifications">
      <SettingsPanel>
        <BrowserNotifications choices={choices} writes={writes} />
        <Sounds sounds={prefs.sounds} ready writes={writes} speaker={() => readPrefs().speaker ?? null} />
        <QuietMode sounds={prefs.sounds} ready writes={writes} />
        <Setting label="Before a call starts" help="A reminder for calls you organize."
          control={<Segmented<'1' | '5' | 'off'> label="Before a call starts" value={n.beforeCall === 0 ? 'off' : n.beforeCall === 1 ? '1' : '5'} options={BEFORE}
            onChange={(value) => writes.notify('Before a call starts', { beforeCall: value === 'off' ? 0 : value === '1' ? 1 : 5 })} />} />
      </SettingsPanel>
      <SettingsPanel title="What reaches you">
        <WhatReachesYou groups={[IN_A_CALL, OUTSIDE_A_CALL]} notifications={n} sounds={prefs.sounds} ready={choices.ready} writes={writes} />
      </SettingsPanel>
    </SettingsGroup>
  );
}
