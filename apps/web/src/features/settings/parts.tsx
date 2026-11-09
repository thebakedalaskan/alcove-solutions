/*
 * Settings' parts, in the order the page shows them: who you are, your notes, recording in the room, the calendar,
 * notifications, how Alcove looks and your minutes. Devices and Privacy have their own files. Each control saves as it
 * changes (save.tsx).
 */
import { errorMessage, type CreditBalance, type NotesLanguage, type NotesSetting, type NotificationPrefs, type Preferences, type Session, type SummaryLength } from '@alcove/api';
import {
  Button, Icon, ProviderMark, Segmented, Select, SettingFact, SettingRow, SettingsPart, SunLine, ThemePreview, useTheme, useToast,
  type SelectOption, type SettingRowProps, type ThemeChoice
} from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { uploads } from '~/features/record/uploads';
import { askToNotify, useNotifyPermission, type NotifyPermission } from '~/features/shell/notify';
import { useLive } from '~/lib/live';
import { calendarConnectUrl, q, useDisconnectCalendar } from '~/lib/queries';
import { hoursAndMinutes, timeZone } from '~/lib/time';
import { plural, sizeLabel } from '~/lib/words';
import { Setting, SwitchSetting, useSave, useSaved } from './save';

/** Who signs people in, and where they change the name and photo Alcove takes from it. */
const PROVIDER = {
  google: { name: 'Google', page: 'https://myaccount.google.com/personal-info' },
  microsoft: { name: 'Microsoft', page: 'https://account.microsoft.com/profile' }
} as const;

/** This browser's time zone as a city and the zone's short name, such as "London · GMT". */
function zoneName(): string {
  const zone = timeZone();
  const city = (zone.split('/').at(-1) ?? zone).replace(/_/g, ' ');
  // The zone's short name in the browser's own language: the one its owner knows ("EST" in the US, "BST" in the UK).
  const short = new Intl.DateTimeFormat(undefined, { timeZone: zone, timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value;
  return short && short !== city ? `${city} · ${short}` : city;
}

export function ProfilePart({ session }: { session: Session }) {
  const team = useQuery(q.team()).data;
  const { provider } = session;
  return (
    <SettingsPart id="profile" title="Profile">
      {provider === 'sso'
        ? <SettingRow label="Name and photo" help="From your company’s sign-in. They update the next time you sign in." control={<SettingFact icon="lock">Single sign-on</SettingFact>} />
        : (
          <SettingRow wide label="Name and photo" help={`From your ${PROVIDER[provider].name} sign-in. They update the next time you sign in.`}
            control={<a href={PROVIDER[provider].page} target="_blank" rel="noreferrer" className="set-go is-ext"><ProviderMark provider={provider} />{PROVIDER[provider].name} account<Icon name="external" size={14} /></a>} />
        )}
      {team && <SettingRow label="Company" control={<Link to="/team" className="set-go"><span className="ac-clamp-1">{team.name}</span><Icon name="right" size={14} /></Link>} />}
      <SettingRow label="Time zone" help="From this computer." control={<SettingFact icon="globe">{zoneName()}</SettingFact>} />
    </SettingsPart>
  );
}

const LANGUAGES: SelectOption<NotesLanguage>[] = [
  { value: 'call', label: 'Same as the call' }, { value: 'en', label: 'English' }, { value: 'es', label: 'Spanish' }, { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' }, { value: 'pt', label: 'Portuguese' }, { value: 'it', label: 'Italian' }, { value: 'nl', label: 'Dutch' },
  { value: 'ja', label: 'Japanese' }, { value: 'zh', label: 'Chinese' }, { value: 'ko', label: 'Korean' }, { value: 'hi', label: 'Hindi' }, { value: 'ar', label: 'Arabic' }
];

export function NotesPart({ prefs }: { prefs: Preferences }) {
  const save = useSave();
  return (
    <SettingsPart id="notes" title="Notes">
      <Setting wide label="Notes for new calls" help="You can still choose for each call when you schedule it."
        control={<Segmented<NotesSetting> label="Notes for new calls" value={prefs.notesDefault} onChange={(v) => save('Notes for new calls', { notesDefault: v })}
          options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />} />
      <SettingRow label="Who gets them" control={<SettingFact icon="lock">Everyone invited, always</SettingFact>} />
      <Setting wide label="Language" saying="Saved for new notes"
        control={<Select<NotesLanguage> label="Notes language" value={prefs.notesLanguage} options={LANGUAGES} onChange={(v) => save('Language', { notesLanguage: v })} />} />
      <Setting wide label="Summary" saying="Saved for new notes"
        control={<Segmented<SummaryLength> label="Summary length" value={prefs.summaryLength} onChange={(v) => save('Summary', { summaryLength: v })}
          options={[{ value: 'short', label: 'Short' }, { value: 'detailed', label: 'Detailed' }]} />} />
    </SettingsPart>
  );
}

export function RecordingPart({ prefs }: { prefs: Preferences }) {
  const save = useSave();
  const kept = useLive(uploads);
  const n = kept.list.length;
  const bytes = kept.list.reduce((all, k) => all + k.bytes, 0);
  return (
    <SettingsPart id="recording" title="Recording in the room">
      <SwitchSetting label="Record without a connection" help="Saved on this device, encrypted, until you’re back online."
        checked={prefs.recordOffline} onChange={(on) => save('Record without a connection', { recordOffline: on })} />
      {/* What waits on this device to upload (Record lists each, with how it stands). */}
      {n > 0
        ? <SettingRow label="On this device" help={`${plural(n, 'recording')}, ${sizeLabel(bytes)}, waiting to upload.`} control={<Link to="/record" className="set-go">See {n === 1 ? 'it' : 'them'}<Icon name="right" size={14} /></Link>} />
        : <SettingRow label="On this device" control={<SettingFact>{kept.read ? 'Nothing waiting' : 'Looking…'}</SettingFact>} />}
    </SettingsPart>
  );
}

export function CalendarPart({ prefs }: { prefs: Preferences }) {
  const calendar = useQuery(q.calendar());
  const disconnect = useDisconnectCalendar();
  const save = useSave();
  const toast = useToast();
  const [going, setGoing] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  // Back from Google, the browser can bring this page back just as it was left.
  useEffect(() => {
    const back = (e: PageTransitionEvent) => { if (e.persisted) setGoing(false); };
    addEventListener('pageshow', back);
    return () => removeEventListener('pageshow', back);
  }, []);
  const cal = calendar.data;
  const google = cal?.source === 'google' && !cal.needsAccess;
  // Busy, a button can't hold focus, and some of them go: it stays on the row rather than falling back to the page.
  const stay = () => row.current?.focus({ preventScroll: true });
  const off = () => disconnect.mutate(undefined, {
    onSuccess: () => toast('Google Calendar is disconnected.', { icon: 'check' }),
    onError: (e) => toast(errorMessage(e), { icon: 'x' }),
    onSettled: stay
  });
  const connect = () => { setGoing(true); location.assign(calendarConnectUrl()); };
  const plain = { mark: <Icon name="cal" />, label: 'Your calendar' };
  const theirs = { mark: <ProviderMark provider="google" />, label: 'Google Calendar' };
  const connection: Pick<SettingRowProps, 'mark' | 'label' | 'help' | 'problem' | 'control'> =
    !cal ? (calendar.isError
      ? { ...plain, help: errorMessage(calendar.error), problem: true, control: <Button variant="secondary" size="sm" icon="retry" loading={calendar.isFetching} onClick={() => void calendar.refetch().then(stay)}>Try again</Button> }
      : { ...plain, control: <SettingFact>Looking…</SettingFact> })
      : cal.source === 'sample' ? { ...plain, label: 'Sample calendar', help: 'A day of calls, placed around when you signed in.', control: <SettingFact>Demo account</SettingFact> }
        : cal.source === 'none' ? { ...plain, help: 'Google Calendar connects when you sign in with Google.', control: <SettingFact>Not connected</SettingFact> }
          : cal.needsAccess ? { ...theirs, help: 'Your meetings show on Home, and the calls you schedule go on it.', control: <Button variant="secondary" size="sm" loading={going} onClick={connect}>{going ? 'Opening Google' : 'Connect'}</Button> }
            : {
              ...theirs,
              control: <div className="set-line"><SettingFact icon="check" tone="yes">Connected</SettingFact><Button variant="quiet" size="sm" loading={disconnect.isPending} onClick={off}>{disconnect.isPending ? 'Disconnecting' : 'Disconnect'}</Button></div>
            };
  return (
    <SettingsPart id="calendar" title="Calendar">
      <SettingRow ref={row} tabIndex={-1} {...connection} />
      <SwitchSetting label="Put calls I schedule on my calendar" help={`${google ? 'Google' : 'Your calendar'} sends everyone invited an invitation.`}
        checked={prefs.addToCalendar} onChange={(on) => save('Put calls I schedule on my calendar', { addToCalendar: on })} />
      <SwitchSetting label="Show my other meetings on Home" checked={prefs.showOtherMeetings} onChange={(on) => save('Show my other meetings on Home', { showOtherMeetings: on })} />
    </SettingsPart>
  );
}

type Remind = '1' | '5' | 'off';
const remindOf = (m: NotificationPrefs['beforeCall']): Remind => (m === 1 ? '1' : m === 5 ? '5' : 'off');
const minutesOf = (r: Remind): NotificationPrefs['beforeCall'] => (r === '1' ? 1 : r === '5' ? 5 : 0);
type Alert = Exclude<keyof NotificationPrefs, 'beforeCall'>;

/** Whether this browser shows Alcove's notifications, and the way to let it. The browser is asked only on a press. */
function BrowserNotifications({ permission }: { permission: NotifyPermission }) {
  const row = useRef<HTMLDivElement>(null);
  const asked = useRef(false);
  // Once the browser answers, the button goes: focus stays on this row rather than falling back to the page.
  useEffect(() => {
    if (!asked.current || permission === 'default') return;
    asked.current = false;
    row.current?.focus();
  }, [permission]);
  const ask = () => { asked.current = true; void askToNotify(); };
  return (
    <SettingRow ref={row} tabIndex={-1} label="Browser notifications"
      help={permission === 'denied' ? 'Allow notifications for this site in your browser’s settings.'
        : permission === 'unsupported' ? 'This browser can’t show them. Chrome, Edge, Firefox and Safari on a computer can.'
          : permission === 'default' ? 'On this device, while Alcove is open in a tab. Your browser asks first.' : 'On this device, while Alcove is open in a tab.'}
      control={permission === 'granted' ? <SettingFact icon="check" tone="yes">Allowed</SettingFact>
        : permission === 'default' ? <Button variant="secondary" size="sm" icon="bell" onClick={ask}>Turn on</Button>
          : permission === 'denied' ? <SettingFact icon="bellOff" tone="no">Blocked</SettingFact> : <SettingFact icon="bellOff">Not available</SettingFact>} />
  );
}

export function NotificationsPart({ prefs }: { prefs: Preferences }) {
  const save = useSave();
  const permission = useNotifyPermission();
  // The choices stay as they're saved, greyed out until the browser shows notifications.
  const off = permission !== 'granted';
  const n = prefs.notifications;
  const alert = (a: Alert, name: string, help?: string | undefined) => (
    <SwitchSetting label={name} help={help} checked={n[a]} disabled={off} onChange={(on) => save(name, { notifications: { [a]: on } })} />
  );
  return (
    <SettingsPart id="notifications" title="Notifications">
      <BrowserNotifications permission={permission} />
      <Setting wide off={off} label="Before a call starts" help="For calls you organize."
        control={<Segmented<Remind> label="Remind me before a call" value={remindOf(n.beforeCall)} disabled={off}
          onChange={(r) => save('Before a call starts', { notifications: { beforeCall: minutesOf(r) } })}
          options={[{ value: '1', label: '1 min' }, { value: '5', label: '5 min' }, { value: 'off', label: 'Off' }]} />} />
      {alert('notesReady', 'When notes are ready')}
      {alert('sharedWithYou', 'When someone shares notes with you')}
      {alert('notesRequested', 'When someone asks for notes', 'In calls you organize, while you’re in another tab or app.')}
      {alert('followUpDue', 'A follow-up is due', 'At 9:00 on the due day.')}
      {alert('tagged', 'When someone tags you', 'In a document you can open, while you’re somewhere else.')}
    </SettingsPart>
  );
}

export function AppearancePart() {
  const { theme, setTheme } = useTheme();
  const saved = useSaved();
  const pick = (t: ThemeChoice) => { if (t !== theme) { setTheme(t); saved('Theme'); } };
  return (
    <SettingsPart id="appearance" title="Appearance" tag="This browser only">
      <Setting wide label="Theme"
        control={<div className="set-eves" role="group" aria-label="Appearance">{(['system', 'light', 'dark'] satisfies ThemeChoice[]).map((t) => <ThemePreview key={t} theme={t} pressed={theme === t} onClick={() => pick(t)} />)}</div>} />
    </SettingsPart>
  );
}

export function PlanPart({ credits }: { credits: CreditBalance }) {
  return (
    <SettingsPart id="plan" title="Plan and credits">
      <SettingRow className="is-left" label="Notes left" control={<span className="set-left">{hoursAndMinutes(credits.balance / credits.perMinute)}</span>}>
        <SunLine share={credits.balance / Math.max(1, credits.granted)} />
      </SettingRow>
      <SettingRow label="Used this month" control={<SettingFact title="Since 00:00 UTC on the 1st">{credits.usedThisMonth > 0 ? hoursAndMinutes(credits.usedThisMonth / credits.perMinute) : 'None yet'}</SettingFact>} />
      <SettingRow label="Calls without notes" control={<SettingFact>Free</SettingFact>} />
    </SettingsPart>
  );
}

/** What stands in for parts that didn't load: the rest of the page, and Sign out, still work. */
export function Unloaded({ id, title, busy, onRetry }: { id?: string | undefined; title: string; busy: boolean; onRetry: () => void }) {
  return (
    <SettingsPart id={id} title={title}>
      <SettingRow label="These didn’t load" help="The rest of the page still works." control={<Button variant="secondary" size="sm" icon="retry" loading={busy} onClick={onRetry}>Try again</Button>} />
    </SettingsPart>
  );
}
