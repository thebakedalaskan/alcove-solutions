/*
 * Settings' cards, in the order the page shows them: who you are, your notes, recording in the room, the calendar,
 * notifications, how Alcove looks and your minutes. Devices and Privacy have their own files. Each control saves as
 * it changes (save.tsx).
 */
import { errorMessage, type CreditBalance, type TopUp, type NotesLanguage, type NotesSetting, type NotificationPrefs, type Preferences, type Session, type SignInProvider, type SummaryLength } from '@alcove/api';
import {
  Avatar, Button, Chip, Icon, IconButton, MinutesCard, ProviderMark, Segmented, Select, SettingRow, SettingsCard, Switch, ThemePreview, buttonClass, useTheme, useToast,
  type SelectOption, type ThemeChoice
} from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { uploads } from '~/features/record/uploads';
import { askToNotify, useNotifyPermission, type NotifyPermission } from '~/features/shell/notify';
import { useLive } from '~/lib/live';
import { calendarConnectUrl, q, topUpOpen, useCancelTopUp, useDisconnectCalendar } from '~/lib/queries';
import { hoursAndMinutes, timeZone } from '~/lib/time';
import { plural, sizeLabel } from '~/lib/words';
import { Named, useSave } from './save';
import { AddCreditsSheet, routeName, topUpLine } from './topup';

export const PROVIDER: Record<SignInProvider, string> = { google: 'Google', microsoft: 'Microsoft', sso: 'single sign-on' };
/** Where people change the name and photo Alcove takes from their sign-in. */
const PROFILE_PAGE: Record<'google' | 'microsoft', string> = { google: 'https://myaccount.google.com/personal-info', microsoft: 'https://account.microsoft.com/profile' };

const fact = (icon: 'lock' | 'check' | 'globe', text: string) => <span className="set-fixed"><Icon name={icon} size={15} />{text}</span>;

/** This browser's time zone as a city and the zone's short name, such as "London · GMT". */
function zoneName(): string {
  const zone = timeZone();
  const city = (zone.split('/').at(-1) ?? zone).replace(/_/g, ' ');
  // The zone's short name in the browser's own language: the one its owner knows ("EST" in the US, "BST" in the UK).
  const short = new Intl.DateTimeFormat(undefined, { timeZone: zone, timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value;
  return short && short !== city ? `${city} · ${short}` : city;
}

export function ProfileCard({ session }: { session: Session }) {
  const team = useQuery(q.team()).data;
  const via = PROVIDER[session.provider];
  // Only a directory gives titles; a demo account's team is the demo directory.
  const directory = session.sample || team?.members.some((m) => m.title !== undefined);
  return (
    <SettingsCard id="profile" title="Profile">
      <div className="set-prof">
        <Avatar person={session.user} size={64} />
        <div className="who"><b>{session.user.name}</b><small>{session.user.email}</small></div>
        <span className="set-via">{session.provider === 'sso' ? <Icon name="key" size={15} /> : <ProviderMark provider={session.provider} />}Signed in with {via}</span>
      </div>
      <SettingRow label="Name and photo"
        help={`From your ${session.provider === 'sso' ? 'company’s sign-in' : `${via} account`}. Change them there, and they update here the next time you sign in.`}
        control={session.provider === 'sso' ? null : (
          <a href={PROFILE_PAGE[session.provider]} target="_blank" rel="noreferrer" className={buttonClass({ variant: 'quiet', size: 'sm' })}>{via} account<Icon name="external" size={16} /></a>
        )} />
      {team && (
        <SettingRow label="Company" control={<Link to="/team" className={buttonClass({ variant: 'quiet', size: 'sm' })}>Team<Icon name="right" size={16} /></Link>}
          help={directory ? `${team.name}, from your company directory. Colleagues find you by name.` : `${team.name}: the people at ${team.domain} you have calls and meetings with.`} />
      )}
      <SettingRow label="Time zone" help="Times in Alcove follow your computer’s time zone." control={fact('globe', zoneName())} />
    </SettingsCard>
  );
}

const LANGUAGES: SelectOption<NotesLanguage>[] = [
  { value: 'call', label: 'Same as the call' }, { value: 'en', label: 'English' }, { value: 'es', label: 'Spanish' }, { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' }, { value: 'pt', label: 'Portuguese' }, { value: 'it', label: 'Italian' }, { value: 'nl', label: 'Dutch' },
  { value: 'ja', label: 'Japanese' }, { value: 'zh', label: 'Chinese' }, { value: 'ko', label: 'Korean' }, { value: 'hi', label: 'Hindi' }, { value: 'ar', label: 'Arabic' }
];

export function NotesCard({ prefs }: { prefs: Preferences }) {
  const save = useSave();
  return (
    <SettingsCard id="notes" title="Notes" lead="Each call has notes or doesn’t, set when it’s scheduled. During a call, only the organizer can turn them on.">
      <SettingRow label={<Named>Notes for new calls</Named>} help="You can still choose for each call when you schedule it."
        control={<Segmented<NotesSetting> label="Notes for new calls" value={prefs.notesDefault} onChange={(v) => save('Notes for new calls', { notesDefault: v })}
          options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />} />
      <SettingRow label="Who gets them" help="Everyone invited, when the call ends, even if they couldn’t make it. Anyone who has them can share them on." control={fact('lock', 'Always')} />
      <SettingRow label={<Named>Language</Named>} help="Notes are written in the language of the call unless you pick one."
        control={<Select<NotesLanguage> label="Notes language" value={prefs.notesLanguage} options={LANGUAGES} align="end" onChange={(v) => save('Language', { notesLanguage: v })} />} />
      <SettingRow label={<Named>Summary</Named>} help="How much the summary at the top of your notes says."
        control={<Segmented<SummaryLength> label="Summary length" value={prefs.summaryLength} onChange={(v) => save('Summary', { summaryLength: v })}
          options={[{ value: 'short', label: 'Short' }, { value: 'detailed', label: 'Detailed' }]} />} />
    </SettingsCard>
  );
}

export function RecordingCard({ prefs }: { prefs: Preferences }) {
  const save = useSave();
  const kept = useLive(uploads);
  const n = kept.list.length;
  const bytes = kept.list.reduce((all, k) => all + k.bytes, 0);
  return (
    <SettingsCard id="recording" title="Recording in the room">
      <SettingRow label={<Named>Record without a connection</Named>} help="Recordings save on your device, encrypted, and upload when you’re back online."
        control={<Switch label="Record without a connection" checked={prefs.recordOffline} onChange={(on) => save('Record without a connection', { recordOffline: on })} />} />
      {/* What waits on this device to upload (Record lists each, with how it stands). */}
      <SettingRow label="On this device"
        help={!kept.read ? 'Looking on this device…' : n ? `${plural(n, 'recording')}, ${sizeLabel(bytes)}, ${n === 1 ? 'hasn’t' : 'haven’t'} uploaded yet.` : 'Nothing is waiting to upload.'}
        control={n ? <Link to="/record" className={buttonClass({ variant: 'quiet', size: 'sm' })}>See {n === 1 ? 'it' : 'them'}<Icon name="right" size={16} /></Link> : null} />
    </SettingsCard>
  );
}

export function CalendarCard({ prefs, email }: { prefs: Preferences; email: string }) {
  const calendar = useQuery(q.calendar());
  const disconnect = useDisconnectCalendar();
  const save = useSave();
  const toast = useToast();
  const cal = calendar.data;
  const google = cal?.source === 'google' && !cal.needsAccess;
  const off = () => disconnect.mutate(undefined, {
    onSuccess: () => toast('Google Calendar is disconnected.', { icon: 'check' }),
    onError: (e) => toast(errorMessage(e), { icon: 'x' })
  });
  return (
    <SettingsCard id="calendar" title="Calendar">
      {cal?.source === 'google' && (
        <div className="set-conn">
          <span className="mark"><ProviderMark provider="google" /></span>
          <span className="txt">
            <b>Google Calendar</b>
            <small>{cal.needsAccess ? 'Connect it to see your meetings on Home and put the calls you schedule on it.' : `${email}${prefs.showOtherMeetings ? ' · your meetings show on Home' : ''}`}</small>
          </span>
          {cal.needsAccess
            ? <Button variant="secondary" size="sm" onClick={() => location.assign(calendarConnectUrl())}>Connect</Button>
            : <span className="end"><Chip tone="sun" icon="check">Connected</Chip><Button variant="quiet" size="sm" loading={disconnect.isPending} onClick={off}>Disconnect</Button></span>}
        </div>
      )}
      {cal?.source === 'sample' && (
        <div className="set-conn">
          <span className="mark"><Icon name="cal" size={20} /></span>
          <span className="txt"><b>Sample calendar</b><small>A day of calls, placed around when you signed in</small></span>
          <Chip tone="outline">Demo account</Chip>
        </div>
      )}
      {calendar.isError && !cal && (
        <div className="set-conn">
          <span className="mark"><Icon name="cal" size={20} /></span>
          <span className="txt"><b>Your calendar</b><small>{errorMessage(calendar.error)}</small></span>
          <Button variant="quiet" size="sm" icon="retry" loading={calendar.isFetching} onClick={() => void calendar.refetch()}>Try again</Button>
        </div>
      )}
      <SettingRow label={<Named>Put calls I schedule on my calendar</Named>}
        help={`${google ? 'Google' : 'Your calendar'} sends everyone invited an invitation, and keeps it up to date.`}
        control={<Switch label="Put calls I schedule on my calendar" checked={prefs.addToCalendar} onChange={(on) => save('Put calls I schedule on my calendar', { addToCalendar: on })} />} />
      <SettingRow label={<Named>Show my other meetings on Home</Named>} help="Meetings on Google Meet, Zoom or Teams, with a way to move them to Alcove."
        control={<Switch label="Show my other meetings on Home" checked={prefs.showOtherMeetings} onChange={(on) => save('Show my other meetings on Home', { showOtherMeetings: on })} />} />
    </SettingsCard>
  );
}

type Remind = '1' | '5' | 'off';
const remindOf = (m: NotificationPrefs['beforeCall']): Remind => (m === 1 ? '1' : m === 5 ? '5' : 'off');
const minutesOf = (r: Remind): NotificationPrefs['beforeCall'] => (r === '1' ? 1 : r === '5' ? 5 : 0);
type Alert = Exclude<keyof NotificationPrefs, 'beforeCall'>;
/** The notifications with one of them turned on or off: they're saved together. */
const withAlert = (n: NotificationPrefs, a: Alert, on: boolean): NotificationPrefs => ({
  beforeCall: n.beforeCall,
  notesReady: a === 'notesReady' ? on : n.notesReady,
  sharedWithYou: a === 'sharedWithYou' ? on : n.sharedWithYou,
  notesRequested: a === 'notesRequested' ? on : n.notesRequested,
  followUpDue: a === 'followUpDue' ? on : n.followUpDue
});

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
  const blocked = permission === 'denied' || permission === 'unsupported';
  return (
    <div ref={row} className="set-conn" tabIndex={-1}>
      <span className="mark"><Icon name={blocked ? 'bellOff' : 'bell'} size={20} /></span>
      <span className="txt" aria-live="polite">
        <b>{permission === 'denied' ? 'Browser notifications are blocked' : 'Browser notifications'}</b>
        <small>
          {permission === 'granted' ? 'On in this browser. They show on this device while Alcove is open in a tab.'
            : permission === 'denied' ? 'Your browser blocks them for Alcove. Allow notifications for this site in your browser’s settings.'
              : permission === 'unsupported' ? 'This browser can’t show notifications from a website. Chrome, Edge, Firefox and Safari on a computer can.'
                : 'They show on this device while Alcove is open in a tab. Your browser asks you first.'}
        </small>
      </span>
      {permission === 'granted' ? <Chip tone="sun" icon="check">Allowed</Chip>
        : permission === 'default' ? <Button variant="secondary" size="sm" icon="bell" onClick={ask}>Turn on browser notifications</Button>
          : <Chip tone="outline">{permission === 'denied' ? 'Blocked' : 'Not available'}</Chip>}
    </div>
  );
}

export function NotificationsCard({ prefs }: { prefs: Preferences }) {
  const save = useSave();
  const permission = useNotifyPermission();
  // The choices stay as they're saved, greyed out until the browser shows notifications.
  const off = permission !== 'granted';
  const n = prefs.notifications;
  const row = (a: Alert, name: string, help?: string | undefined) => (
    <SettingRow label={<Named>{name}</Named>} help={help}
      control={<Switch label={name} checked={n[a]} disabled={off} onChange={(on) => save(name, (now) => ({ notifications: withAlert(now.notifications, a, on) }))} />} />
  );
  return (
    <SettingsCard id="notifications" title="Notifications">
      <BrowserNotifications permission={permission} />
      <SettingRow label={<Named>Before a call starts</Named>} help="For calls you organize."
        control={<Segmented<Remind> label="Remind me before a call" value={remindOf(n.beforeCall)} disabled={off}
          onChange={(r) => save('Before a call starts', (now) => ({ notifications: { ...now.notifications, beforeCall: minutesOf(r) } }))}
          options={[{ value: '1', label: '1 min' }, { value: '5', label: '5 min' }, { value: 'off', label: 'Off' }]} />} />
      {row('notesReady', 'When notes are ready')}
      {row('sharedWithYou', 'When someone shares notes with you')}
      {row('notesRequested', 'When someone asks for notes', 'In calls you organize, where only you can turn them on, while you’re in another tab or app.')}
      {row('followUpDue', 'A follow-up is due', 'On the due day of a follow-up you’ve taken on, at 9:00.')}
    </SettingsCard>
  );
}

export function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  return (
    <SettingsCard id="appearance" title="Appearance">
      <div className="set-themes" role="group" aria-label="Appearance">
        {(['system', 'light', 'dark'] satisfies ThemeChoice[]).map((t) => <ThemePreview key={t} theme={t} pressed={theme === t} onClick={() => setTheme(t)} />)}
      </div>
    </SettingsCard>
  );
}

/**
 * Minutes left, and adding credits when the server takes payments. Top-ups still on their way are listed under the
 * balance, each opening the sheet on it, so closing the sheet loses none; one nothing has reached yet can be cancelled
 * from its row.
 */
export function PlanCard({ credits }: { credits: CreditBalance }) {
  const routes = useQuery(q.topUpRoutes());
  // Top-ups on their way show whether or not 1Click answers right now; a server without payments has none to show.
  const open = useQuery(q.topUps()).data?.filter(topUpOpen) ?? [];
  const cancel = useCancelTopUp();
  const toast = useToast();
  const list = useRef<HTMLUListElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  const [sheet, setSheet] = useState<{ open: boolean; topUpId: string | null }>({ open: false, topUpId: null });
  /** Only one nothing has reached, whose address can still be paid, can be cancelled: as in the sheet. */
  const cancellable = (t: TopUp) => t.state === 'waiting' && Date.parse(t.expiresAt) > Date.now();
  /** Cancels a top-up; its row goes, and focus moves to the row after it (or before it), else to Add credits. */
  const cancelRow = (t: TopUp) => {
    const i = open.findIndex((x) => x.id === t.id);
    const near = open[i + 1] ?? open[i - 1];
    cancel.mutate(t.id, {
      onSuccess: () => requestAnimationFrame(() => {
        if (document.activeElement && document.activeElement !== document.body) return;
        const row = near ? list.current?.querySelector<HTMLButtonElement>(`[data-top-up="${near.id}"] .set-conn`) : null;
        (row ?? add.current)?.focus();
      }),
      onError: (e) => toast(errorMessage(e), { icon: 'x' })
    });
  };
  return (
    <MinutesCard id="plan" title="Plan and credits" className="ac-set-card" left={hoursAndMinutes(credits.balance / credits.perMinute)}
      share={credits.balance / Math.max(1, credits.granted)}
      used={credits.usedThisMonth > 0 ? `${hoursAndMinutes(credits.usedThisMonth / credits.perMinute)} used this month` : 'None used this month yet'}>
      {open.length > 0 && (
        <ul ref={list} className="set-topups" aria-label="Payments on their way">
          {open.map((t) => (
            <li key={t.id} data-top-up={t.id} className={cancellable(t) ? 'is-cancellable' : undefined}>
              <button type="button" className="set-conn" onClick={() => setSheet({ open: true, topUpId: t.id })}>
                <span className="mark"><Icon name="coins" size={20} /></span>
                <span className="txt"><b>{t.asked.amount} {routeName(t.route)}</b><small className="ac-clamp-2">{topUpLine(t)}</small></span>
                {!cancellable(t) && <Icon name="chevron" size={18} />}
              </button>
              {cancellable(t) && (
                <IconButton icon="x" label={`Cancel the ${t.asked.amount} ${routeName(t.route)} top-up`}
                  disabled={cancel.isPending && cancel.variables === t.id} onClick={() => cancelRow(t)} />
              )}
            </li>
          ))}
        </ul>
      )}
      {routes.data !== undefined && (
        <SettingRow label="Add credits" help="Pay with a stablecoin from any wallet or exchange."
          control={<Button ref={add} variant="primary" size="sm" icon="plus" onClick={() => setSheet({ open: true, topUpId: null })}>Add credits</Button>} />
      )}
      <SettingRow label="Calls without notes" help="Never use minutes." control={fact('check', 'Free')} />
      <AddCreditsSheet open={sheet.open} topUpId={sheet.topUpId} onOpenChange={(o) => setSheet((s) => ({ ...s, open: o }))} />
    </MinutesCard>
  );
}
