/** Browser permission and category choices, shared by Settings and an active call (guests included). */
import { type NotificationPrefs, type Preferences } from '@alcove/api';
import { Button, Segmented, SettingFact, SettingRow, SettingsPart, Switch } from '@alcove/ui';
import { useEffect, useRef, useState } from 'react';
import { useNotificationPreferences } from '~/lib/notification-preferences';
import { askToNotify, useNotifyPermission } from '~/features/shell/notification-permission';
import { Setting, SwitchSetting, useSave } from './save';

type Category = Exclude<keyof NotificationPrefs, 'beforeCall' | 'enabled' | 'replyAlerts'>;
const CALL_CATEGORIES: readonly { key: Category; label: string; help?: string }[] = [
  { key: 'privateMessages', label: 'Private messages', help: 'Messages and replies sent only to you.' },
  { key: 'replies', label: 'Replies in room chat', help: 'Replies in conversations you started or joined.' },
  { key: 'chatMentions', label: 'Mentions in room chat' },
  { key: 'hands', label: 'Raised hands' },
  { key: 'questions', label: 'New questions' },
  { key: 'admissions', label: 'Requests to join when I host' },
  { key: 'timers', label: 'Timer warnings' }
];
const OTHER_CATEGORIES: readonly { key: Category; label: string; help?: string }[] = [
  { key: 'notesReady', label: 'When notes are ready' },
  { key: 'sharedWithYou', label: 'When someone shares notes with you' },
  { key: 'notesRequested', label: 'When someone asks for notes', help: 'In calls you organize.' },
  { key: 'followUpDue', label: 'A follow-up is due', help: 'At 9:00 on the due day.' },
  { key: 'tagged', label: 'Mentions in documents', help: 'Only documents you can open.' }
];
function BrowserPermission({ enabled, onChange, ready, scope, capture }: { enabled: boolean; onChange: (on: boolean) => void; ready: boolean; scope: string; capture: () => () => boolean }) {
  const permission = useNotifyPermission();
  const row = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const context = useRef(scope);
  context.current = scope;
  const version = useRef(0);
  useEffect(() => { version.current++; setBusy(false); return () => { version.current++; }; }, [scope]);
  const enable = async () => {
    const at = version.current;
    const forScope = scope;
    const stillOriginal = capture();
    setBusy(true);
    try {
      const next = permission === 'granted' ? permission : await askToNotify();
      if (version.current !== at || context.current !== forScope || !stillOriginal()) return;
      if (next === 'granted') onChange(true);
    } finally {
      if (version.current === at && context.current === forScope) { setBusy(false); row.current?.focus({ preventScroll: true }); }
    }
  };
  const available = permission !== 'unsupported' && permission !== 'denied';
  return <>
    <SettingRow ref={row} tabIndex={-1} label="Browser notifications"
      help={permission === 'denied' ? 'Blocked or revoked in this browser. Allow notifications in this site’s browser settings. Messages and outstanding actions stay in Alcove.'
        : permission === 'unsupported' ? 'This browser can’t show notifications. Messages and outstanding actions stay in Alcove.'
          : permission === 'default' ? 'Not enabled yet. Alerts work while Alcove stays open and hide names, messages and call details. Your browser asks only after you choose Enable browser notifications.'
            : `${enabled ? 'Allowed.' : 'Allowed by this browser; off in Alcove.'} While Alcove stays open in a tab. Previews hide names, messages and call details. Sounds follow your sound preferences.`}
      control={permission === 'unsupported' ? <SettingFact icon="bellOff">Not available</SettingFact>
        : permission === 'denied' ? <SettingFact icon="bellOff">Blocked</SettingFact>
          : permission === 'granted' && enabled ? <Switch label="Browser notifications" checked disabled={!ready || busy} onChange={onChange} />
            : <Button variant="secondary" size="sm" icon="bell" loading={busy} disabled={!ready || !available} onClick={() => void enable()}>Enable browser notifications</Button>} />
    {enabled && permission !== 'granted' && <SettingRow label="Saved choice" help="You can turn notifications off here without changing browser permission."
      control={<Switch label="Browser notifications" checked disabled={!ready || busy} onChange={onChange} />} />}
  </>;
}
export function NotificationsPart({ prefs }: { prefs: Preferences }) {
  const save = useSave();
  const permission = useNotifyPermission();
  const { ready, scope, capturePermissionIntent } = useNotificationPreferences();
  const n = prefs.notifications;
  const off = permission !== 'granted' || !n.enabled;
  const alert = ({ key, label, help }: { key: Category; label: string; help?: string }) => <SwitchSetting key={key} label={label} help={help} checked={n[key]} disabled={off}
    onChange={(on) => save(label, (now) => ({ notifications: { ...now.notifications, [key]: on } }))} />;
  return <SettingsPart id="notifications" title="Notifications">
    <BrowserPermission capture={capturePermissionIntent} enabled={n.enabled} ready={ready} scope={scope} onChange={(enabled) => save('Browser notifications', (now) => ({ notifications: { ...now.notifications, enabled } }))} />
    {CALL_CATEGORIES.map(alert)}
    <Setting wide off={off} label="Before a call starts" help="For calls you organize."
      control={<Segmented<'1' | '5' | 'off'> label="Remind me before a call" value={n.beforeCall === 0 ? 'off' : n.beforeCall === 1 ? '1' : '5'} disabled={off}
        onChange={(value) => save('Before a call starts', (now) => ({ notifications: { ...now.notifications, beforeCall: value === 'off' ? 0 : value === '1' ? 1 : 5 } }))}
        options={[{ value: '1', label: '1 min' }, { value: '5', label: '5 min' }, { value: 'off', label: 'Off' }]} />} />
    {OTHER_CATEGORIES.map(alert)}
  </SettingsPart>;
}
/** The same master and call categories are reachable from the call's own controls, including guest calls. */
export function CallNotificationControls() {
  const { prefs, update, ready, scope, capturePermissionIntent } = useNotificationPreferences();
  const permission = useNotifyPermission();
  return <div className="set-parts">
    <BrowserPermission capture={capturePermissionIntent} enabled={prefs.enabled} onChange={(enabled) => update({ enabled })} ready={ready} scope={scope} />
    {CALL_CATEGORIES.map(({ key, label, help }) => <SettingRow key={key} label={label} help={help} control={<Switch label={label} checked={prefs[key]} disabled={!ready || !prefs.enabled || permission !== 'granted'} onChange={(on) => update({ [key]: on })} />} />)}
  </div>;
}
