/*
 * Team: your company, standing on the horizon. Everyone stands in the arch they're known by, you in the middle and the
 * low sun behind them to the left, and each opens a popover with everything about them. Under the water: your groups,
 * the people not on Alcove yet (the directory where there is one, otherwise the people at your work address you meet
 * with), and notes shared with groups. Nobody else here yet, it asks you to bring them. Someone on their own has no team,
 * so no Team page: nothing links here, and its address goes Home. On a team the page is the team's (OnTeam.tsx), with your
 * groups still on its water; on none, a quiet row starts one (StartTeam.tsx). `group` is one of your groups to show open
 * (from its tile, or the address), or NEW_GROUP to make one.
 */
import { NEW_GROUP, errorCode, errorMessage, type NoteSummary, type Team } from '@alcove/api';
import { Button, Evening, Icon, cn } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useNow, useOnline } from '~/lib/live';
import { sameEmail } from '~/lib/people';
import { accountQueries } from '~/features/account/queries';
import { callQueries } from '~/features/calls/list/queries';
import { calendarQueries } from '~/features/calls/scheduling/queries';
import { noteQueries } from '~/features/notes/queries';
import { teamQueries } from './queries';
import { byMeetings, byRecency, knownPeople, meetings, shownOf, type Member } from './data';
import { Groups, NO_DRAFT, readyToMake, type Draft } from './Groups';
import { blanks, inLine, lineOf, sunOf, you } from './line';
import { OnTeam } from './OnTeam';
import { personPop, useOpen } from './open';
import { InvitePeople, NotOnAlcove, PeopleYouMeet, useCopyInvite } from './People';
import { AllPeople, PeopleLine, type Between } from './PeopleLine';
import { SharedWithGroups } from './Shared';
import { StartTeam } from './StartTeam';

const NO_NOTES: NoteSummary[] = [];
const NOBODY: ReadonlySet<string> = new Set();
/** How many empty arches wait on the line for the team, and how many stand beside you on the first day. */
const WAITING = 6;
const FIRST_DAY = 4;

/** Who'd been asked when the page opened, so nobody jumps along the line or down the list when you invite them. */
function useAskedBefore(team: Team | null | undefined): ReadonlySet<string> {
  const [asked, setAsked] = useState<ReadonlySet<string> | null>(null);
  if (team && !asked) setAsked(new Set(team.members.filter((m) => m.invited).map((m) => m.person.email)));
  return asked ?? NOBODY;
}

/** The page, inside its people's popovers (`OpenHost`, open.tsx). */
export function TeamPage({ group }: { group: string | undefined }) {
  const navigate = useNavigate();
  const session = useQuery(accountQueries.session()).data;
  /* The loader has tried it; a team that didn't load waits for Try again. */
  const team = useQuery({ ...teamQueries.team(), retryOnMount: false });
  /* The team you're on, if you're on one: then the page is the team's. */
  const mine = useQuery(teamQueries.myTeam()).data;
  const prefs = useQuery(accountQueries.prefs()).data;
  const notes = useQuery(noteQueries.notes()).data ?? NO_NOTES;
  const calls = useQuery(callQueries.upcoming()).data ?? [];
  const calendar = useQuery(calendarQueries.calendar()).data;
  const now = new Date(useNow(60_000));
  const online = useOnline();
  const { open, setOpen } = useOpen();
  const copy = useCopyInvite();
  const [draft, setDraft] = useState<Draft>(NO_DRAFT);
  const [forward, setForward] = useState<string | undefined>(undefined);
  const asked = useAskedBefore(team.data);
  if (!session) return null;
  if (team.data === null && mine === null) return <Navigate to="/home" replace />;

  const me = session.user;
  const here = team.data ?? undefined;
  const events = prefs?.showOtherMeetings === false ? [] : calendar?.events ?? [];
  const meets = meetings(notes, calls, events, me.email, now);
  const person = knownPeople(here, notes, calls, events);
  const shown = shownOf(here);
  const between: Between = { notes, meets, now, inGroups: (prefs?.groups ?? []).filter((g) => g.emails.some((e) => sameEmail({ email: e }, me))).length };
  const openGroup = (g: string | undefined) => void navigate({ to: '/team', search: g ? { group: g } : {}, replace: true, resetScroll: false });

  const members = here?.members ?? [];
  const on = members.filter((m) => m.onAlcove).sort(byRecency(meets));
  const inOrder = byMeetings(meets);
  const notYet = (was: boolean) => members.filter((m) => !m.onAlcove && asked.has(m.person.email) === was).sort(inOrder);
  const off: Member[] = [...notYet(false), ...notYet(true)];
  const first = !!here && !on.length;
  const trouble = here ? undefined : !online || errorCode(team.error) === 'network' ? 'offline' : team.isError ? 'failed' : undefined;

  const line = lineOf(you(me),
    !here ? (trouble ? [] : blanks(WAITING))
      : first ? (off.length ? inLine([], off.slice(0, FIRST_DAY), undefined) : blanks(2))
        : inLine(on, off, forward));
  const sun = sunOf(line);
  /* One filled button: an open popover has its own, and so does a group ready to be made, while its editor's open. */
  const filled = open === undefined && !(group === NEW_GROUP && readyToMake(draft));

  const groups = <Groups open={group} onOpen={openGroup} notes={notes} person={person} shown={shown} draft={draft} onDraft={setDraft} />;
  const shared = <SharedWithGroups notes={notes} me={me} now={now} />;
  if (mine) return <OnTeam team={mine} me={me} between={between} now={now} groups={groups} shared={shared} />;

  return (
    <Evening moment="team" className="tp" data-line={line.arches.length <= 3 ? 'short' : 'long'}
      style={{ '--tp-sum': line.width.toFixed(3), '--tp-sun-x': sun.x.toFixed(3), '--tp-sun-r': sun.r.toFixed(3) }}>
      <div className="tp-sky" style={{ '--d': 0 }}>
        <header className="dusk-top"><h1 className="dusk-title">Team</h1></header>
        <section className="tp-hero" aria-labelledby="tp-h">
          <h2 id="tp-h" className="ac-clamp-2">{first ? 'Bring your team to Alcove' : here?.name ?? (trouble === 'offline' ? 'You’re offline' : trouble === 'failed' ? 'Your team didn’t load' : 'Your team')}</h2>
          {trouble && <p className="tp-why"><Icon name={trouble === 'offline' ? 'wifiOff' : 'alert'} size={18} />{trouble === 'offline' ? 'Your team shows here when you’re back.' : errorMessage(team.error)}</p>}
          <div className="tp-acts">
            {here && <InvitePeople me={me} team={here} meets={meets} now={now} anchor={<Button variant={filled ? 'primary' : 'secondary'} size="lg" icon="addUser">Invite people</Button>} />}
            {first && <Button size="lg" icon="link" onClick={() => void copy()}>Copy invite link</Button>}
            {here && line.recedes && (
              <AllPeople me={me} team={here} onFind={(email) => { setForward(email); setOpen(() => personPop(email)); }}
                anchor={<Button size="lg" icon="people">All {line.n} people</Button>} />
            )}
            {trouble && <Button variant="primary" size="lg" icon="retry" onClick={() => void team.refetch()}>Try again</Button>}
          </div>
        </section>
        <PeopleLine line={line} sun={sun} company={here?.name} waiting={!here && !trouble} between={between} />
      </div>
      <div className={cn('tp-grid', first && 'is-first')} style={{ '--d': 1 }}>
        {first && here && <PeopleYouMeet team={here} people={off} directory={session.sample || members.some((m) => m.title !== undefined)} meets={meets} now={now} />}
        {groups}
        {off.length > 0 && !first && <NotOnAlcove people={off} meets={meets} now={now} />}
        {shared}
        {mine === null && here && <StartTeam />}
      </div>
    </Evening>
  );
}
