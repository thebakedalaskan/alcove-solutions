/*
 * You: your name and photo as your sign-in gives them, your company and your time zone; then how Alcove looks, in this
 * browser. Choosing a theme changes the whole page at once.
 */
import type { Session } from '@alcove/api';
import { Icon, ProviderMark, SettingFact, SettingRow, SettingsGroup, SettingsPanel, THEMES, ThemePreview, useTheme, type ThemeChoice } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { q } from '~/lib/queries';
import { timeZone } from '~/lib/time';
import { Setting, useSaved } from './save';

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

export function YouGroup({ session }: { session: Session }) {
  // Someone at a personal address has no team, so no company to open.
  const team = useQuery(q.team()).data;
  const { theme, setTheme } = useTheme();
  const saved = useSaved();
  const pick = (t: ThemeChoice) => { if (t !== theme) { setTheme(t); saved('Theme'); } };
  const { provider } = session;
  return (
    <SettingsGroup id="you" title="You">
      <SettingsPanel>
        {provider === 'sso'
          ? <SettingRow label="Name and photo" help="From your company’s sign-in." control={<SettingFact icon="lock">Single sign-on</SettingFact>} />
          : (
            <SettingRow label="Name and photo" help={`From your ${PROVIDER[provider].name} sign-in.`}
              control={<a href={PROVIDER[provider].page} target="_blank" rel="noreferrer" className="set-go is-ext"><ProviderMark provider={provider} />{PROVIDER[provider].name} account<Icon name="external" size={14} /></a>} />
          )}
        {team && <SettingRow label="Company" control={<Link to="/team" className="set-go"><span className="ac-clamp-1">{team.name}</span><Icon name="right" size={14} /></Link>} />}
        <SettingRow label="Time zone" help="From this computer." control={<SettingFact icon="globe">{zoneName()}</SettingFact>} />
      </SettingsPanel>
      <SettingsPanel title="Appearance" tag={<><Icon name="laptop" size={15} />This browser</>}>
        <Setting wide label="Theme"
          control={<div className="set-eves" role="group" aria-label="Appearance">{THEMES.map((t) => <ThemePreview key={t} theme={t} pressed={theme === t} onClick={() => pick(t)} />)}</div>} />
      </SettingsPanel>
    </SettingsGroup>
  );
}
