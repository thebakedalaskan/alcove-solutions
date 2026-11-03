import { errorMessage, type NotesSetting, type SignInProvider, type Team } from '@alcove/api';
import { Avatar, Button, Chip, Icon, Meter, ProviderMark, Segmented, useTheme, useToast, type ThemeChoice } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { calendarConnectUrl, q, useInviteTeam, usePreferences, useSignOut } from '~/lib/queries';
import { hoursAndMinutes } from '~/lib/time';

export const Route = createFileRoute('/_app/account')({
  loader: ({ context: { queryClient: qc } }) => Promise.all([qc.ensureQueryData(q.prefs()), qc.ensureQueryData(q.balance()), qc.ensureQueryData(q.team())]),
  component: Account
});

const SIGN_IN: Record<SignInProvider, string> = { google: 'Google', microsoft: 'Microsoft', sso: 'single sign-on' };

function Account() {
  const session = useQuery(q.session()).data;
  const prefs = useQuery(q.prefs()).data;
  const credits = useQuery(q.balance()).data;
  const team = useQuery(q.team()).data ?? null;
  const calendar = useQuery(q.calendar()).data;
  const setPrefs = usePreferences();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const toast = useToast();
  const { theme, setTheme } = useTheme();
  if (!session) return null;
  const via = SIGN_IN[session.provider];
  const out = () => signOut.mutate(undefined, { onSuccess: () => void navigate({ to: '/welcome', replace: true }), onError: (e) => toast(errorMessage(e), { icon: 'x' }) });
  return (
    <>
      <div className="head" style={{ '--d': 0 }}>
        <div><h1>Account</h1></div>
        <Button variant="secondary" icon="signOut" loading={signOut.isPending} onClick={out}>Sign out</Button>
      </div>
      <div className="acct" style={{ '--d': 1 }}>
        <div className="hcol">
          <section className="card pane">
            <h3>Profile</h3>
            <div className="prof">
              <Avatar person={session.user} size={64} />
              <div className="min-w-0"><b>{session.user.name}</b><small>{session.user.email}</small></div>
              <span className="via">{session.provider === 'sso' ? <Icon name="key" size={15} /> : <ProviderMark provider={session.provider} />}Signed in with {via}</span>
            </div>
            {calendar?.source === 'google' && (
              <div className="pk">
                <span className="ic"><Icon name="cal" size={20} /></span>
                <span className="min-w-0"><b>Google Calendar</b><small>{calendar.needsAccess ? 'Alcove can’t see your calendar yet' : 'Your meetings show on Home; calls you schedule go on it, with invitations'}</small></span>
                {calendar.needsAccess
                  ? <Button variant="secondary" size="sm" icon="cal" onClick={() => location.assign(calendarConnectUrl())}>Connect</Button>
                  : <Chip tone="accent" icon="check">Connected</Chip>}
              </div>
            )}
            {session.sample && (
              <div className="pk">
                <span className="ic"><Icon name="cal" size={20} /></span>
                <span className="min-w-0"><b>Sample calendar</b><small>A day of calls, placed around when you signed in</small></span>
                <Chip tone="quiet">Demo account</Chip>
              </div>
            )}
          </section>
          <section className="card pane">
            <h3>Notes for new calls</h3>
            <p className="lead">You can still choose for each call when you schedule it.</p>
            <Segmented<NotesSetting> className="mt-4" label="Notes for new calls" value={prefs?.notesDefault ?? 'on'}
              onChange={(v) => setPrefs.mutate({ notesDefault: v }, { onError: (e) => toast(errorMessage(e), { icon: 'x' }) })}
              options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
          </section>
          {credits && (
            <section className="card pane">
              <h3>Credits</h3>
              <div className="big-num">{hoursAndMinutes(credits.balance / credits.perMinute)}<small>of notes left</small></div>
              <Meter value={credits.balance / Math.max(1, credits.granted)} />
              <div className="foot"><p>Calls without notes are always free.</p></div>
            </section>
          )}
          <section className="card pane">
            <h3>Appearance</h3>
            <Segmented<ThemeChoice> className="mt-4" label="Appearance" value={theme} onChange={setTheme}
              options={[{ value: 'system', label: 'Match system' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
          </section>
        </div>
        <div className="hcol">
          {team && <TeamPane team={team} />}
          <section className="card pane">
            <h3>Privacy</h3>
            <p className="lead">Notes are written privately. Alcove can’t read them.</p>
            <div className="ledger">
              <div><b><Icon name="server" size={17} />Alcove knows</b><ul><li>Your name, email and photo</li><li>When calls happen</li><li>Who was invited</li></ul></div>
              <div className="no"><b><Icon name="lock" size={17} />Alcove can’t read</b><ul><li>What was said</li><li>Your notes and summaries</li><li>The audio</li></ul></div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function TeamPane({ team }: { team: Team }) {
  const invite = useInviteTeam();
  const toast = useToast();
  return (
    <section className="card pane">
      <h3>Your team</h3>
      <p className="lead">People at {team.domain}, from your company’s directory.</p>
      <div className="team-list">
        {team.members.map((m) => (
          <div key={m.person.email} className="pk">
            <Avatar person={m.person} size={40} />
            <span className="min-w-0"><b>{m.person.name}</b><small>{m.person.email}</small></span>
            {m.onAlcove ? <Chip>On Alcove</Chip>
              : m.invited ? <Chip tone="quiet" icon="check">Invited</Chip>
                : <Button variant="secondary" size="sm" icon="mail" loading={invite.isPending && invite.variables.includes(m.person.email)}
                  onClick={() => invite.mutate([m.person.email], { onSuccess: () => toast(`${m.person.name.split(' ')[0] ?? m.person.name} is invited`, { icon: 'mail' }), onError: (e) => toast(errorMessage(e), { icon: 'x' }) })}>Invite</Button>}
          </div>
        ))}
      </div>
    </section>
  );
}
