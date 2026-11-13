/*
 * Connections: what Alcove reaches outside itself, set up once and then left alone. Google first, in one panel: the
 * calendar with its switches nested under it, then Drive, one line until it's opened. Agents in a panel of their own:
 * one row that says who's connected and opens Agents, where they're connected and changed. `calendar` and `drive` are how
 * Google sent you back (`?calendar=`, `?drive=` in the address): each says so in its place, and Drive opens.
 */
import type { CalendarConnectResult, DriveConnectResult } from '@alcove/api';
import { Icon, SettingRow, SettingTile, SettingsGroup, SettingsPanel } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { namesInLine } from '~/features/agents/line';
import { q } from '~/lib/queries';
import { joinedSome } from '~/lib/words';
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
      <SettingsPanel id="agents">
        <Agents />
      </SettingsPanel>
    </SettingsGroup>
  );
}

/**
 * Who's connected, in a line: "Claude is connected.", "Claude, Cursor and Weekly digest are connected.", and past three
 * names "and 2 more" (one more is named instead). A name two connections share is said once.
 */
const connected = (names: readonly string[]): string => `${joinedSome(names)} ${names.length === 1 ? 'is' : 'are'} connected.`;

/**
 * Agents: who's connected, in the order they stand on Agents' horizon, and the way there, where they're connected, changed
 * and disconnected. Until the list is in (or if it doesn't come), the row says what agents are for and opens Agents, which
 * says what's wrong there.
 */
function Agents() {
  const connections = useQuery(q.agents()).data;
  const names = connections && namesInLine(connections);
  const none = names?.length === 0;
  return (
    <SettingRow mark={<SettingTile icon="agent" />} label="Agents"
      help={names?.length ? connected(names) : 'Use Alcove from your AI assistant, with only what you allow.'}
      control={<Link to="/agents" className="set-go">{none ? 'Connect an agent' : 'Open Agents'}<Icon name="right" size={14} /></Link>} />
  );
}
