/*
 * Google Calendar, first in Connections: the connection on one row, and, once there's a calendar, its two switches nested
 * under it. Connect goes straight to Google, which asks for access; Google sends you back here with `?calendar=` saying
 * how it went, which the row says under it.
 */
import { errorMessage, type CalendarConnectResult, type Preferences } from '@alcove/api';
import { Button, Icon, ProviderMark, SettingFact, SettingNote, SettingRow, buttonClass, useToast, type SettingRowProps } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { calendarConnectUrl, q, useDisconnectCalendar } from '~/lib/queries';
import { SwitchSetting, useSave } from './save';

/** What Google's way back said, as the row says it. */
const CALENDAR_RESULT = {
  connected: 'Google Calendar connected. Your meetings can show on Home, and Google can send invitations for calls you schedule.',
  denied: 'Calendar access wasn’t granted. You can still schedule calls and share the link yourself.',
  account: 'Choose the Google account you used to sign in to Alcove.',
  failed: 'Google Calendar couldn’t be connected. Try again when you’re ready.'
} satisfies Record<CalendarConnectResult, string>;

/**
 * The calendar's connection, and what it does once there is one. `prefs` is missing while preferences can't be read.
 * `result` is how Google sent you back, if it just did.
 */
export function GoogleCalendar({ prefs, result }: { prefs: Preferences | undefined; result?: CalendarConnectResult | undefined }) {
  const calendar = useQuery(q.calendar());
  const email = useQuery(q.session()).data?.user.email;
  const disconnect = useDisconnectCalendar();
  const save = useSave();
  const toast = useToast();
  const row = useRef<HTMLDivElement>(null);
  const cal = calendar.data;
  const google = cal?.source === 'google' && !cal.needsAccess;
  // Busy, a button can't hold focus, and some of them go: it stays on the row rather than falling back to the page.
  const stay = () => row.current?.focus({ preventScroll: true });
  const off = () => disconnect.mutate(undefined, {
    onSuccess: () => toast('Google Calendar is disconnected.', { icon: 'check' }),
    onError: (e) => toast(errorMessage(e), { icon: 'x' }),
    onSettled: stay
  });
  const plain = { mark: <Icon name="cal" />, label: 'Your calendar' };
  const theirs = { mark: <ProviderMark provider="google" />, label: 'Google Calendar' };
  const connection: Pick<SettingRowProps, 'mark' | 'label' | 'help' | 'problem' | 'control'> =
    !cal ? (calendar.isError
      ? { ...plain, help: errorMessage(calendar.error), problem: true, control: <Button variant="secondary" size="sm" icon="retry" loading={calendar.isFetching} onClick={() => void calendar.refetch().then(stay)}>Try again</Button> }
      : { ...plain, control: <SettingFact>Looking…</SettingFact> })
      : cal.source === 'sample' ? { ...plain, label: 'Sample calendar', help: 'A day of calls, placed around when you signed in.', control: <SettingFact>Demo account</SettingFact> }
        : cal.source === 'none' ? { ...plain, help: 'Connect Google Calendar from an Alcove account that uses Google sign-in.', control: <SettingFact>Not connected</SettingFact> }
          : cal.needsAccess ? { ...theirs, help: 'Alcove reads your events and adds the calls you schedule.', control: <a href={calendarConnectUrl()} className={buttonClass({ size: 'sm' })}>Connect</a> }
            : {
              ...theirs,
              help: email,
              control: <div className="set-line"><SettingFact icon="check" tone="yes">Connected</SettingFact><Button variant="quiet" size="sm" loading={disconnect.isPending} onClick={off}>{disconnect.isPending ? 'Disconnecting' : 'Disconnect'}</Button></div>
            };
  // The switches only mean something once there's a calendar to put calls on and read meetings from.
  const switches = prefs !== undefined && (google || cal?.source === 'sample');
  return (
    <>
      <SettingRow ref={row} id="calendar" tabIndex={-1} {...connection} />
      {/* Connected is said only while Google really is. */}
      {result && (result !== 'connected' || google) && (
        <SettingNote tone={result === 'connected' ? 'info' : 'caution'} icon={result === 'connected' ? 'check' : undefined}>{CALENDAR_RESULT[result]}</SettingNote>
      )}
      {switches && (
        <>
          <SwitchSetting sub label="Put calls I schedule on my calendar"
            help={cal?.source === 'sample' ? 'Your sample calendar stands in for Google Calendar.' : 'When Google Calendar is connected, Google sends the invitations.'}
            checked={prefs.addToCalendar} onChange={(on) => save('Put calls I schedule on my calendar', { addToCalendar: on })} />
          <SwitchSetting sub label="Show my other meetings on Home" checked={prefs.showOtherMeetings} onChange={(on) => save('Show my other meetings on Home', { showOtherMeetings: on })} />
          {/* Upcoming's own count does the same: these are among the other meetings, so they come and go with them. */}
          {prefs.showOtherMeetings && (
            <SwitchSetting sub label="Show my own events on Home" help="Events with nobody else on them, such as a focus block."
              checked={prefs.showSoloEvents} onChange={(on) => save('Show my own events on Home', { showSoloEvents: on })} />
          )}
        </>
      )}
    </>
  );
}
