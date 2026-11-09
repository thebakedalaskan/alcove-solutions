/*
 * Connections: what Alcove reaches outside itself, set up once and then left alone. Google first, in one panel: the
 * calendar with its two switches nested under it, then Drive, one line until it's opened. Agents in a panel of their own.
 * `calendar` and `drive` are how Google sent you back (`?calendar=`, `?drive=` in the address): each says so in its place,
 * and Drive opens.
 */
import type { CalendarConnectResult, DriveConnectResult } from '@alcove/api';
import { SettingsGroup, SettingsPanel } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { AgentsPanel } from '~/features/agents/Settings';
import { q } from '~/lib/queries';
import { GoogleCalendar } from './Calendar';
import { GoogleDrive } from './DriveExports';

export function ConnectionsGroup({ calendar, drive }: { calendar?: CalendarConnectResult | undefined; drive?: DriveConnectResult | undefined }) {
  const prefs = useQuery(q.prefs()).data;
  return (
    <SettingsGroup id="connections" title="Connections">
      <SettingsPanel>
        <GoogleCalendar prefs={prefs} result={calendar} />
        <GoogleDrive result={drive} />
      </SettingsPanel>
      <AgentsPanel />
    </SettingsGroup>
  );
}
