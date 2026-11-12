/*
 * Team: your company, standing on the horizon. Everyone stands in the arch they're known by, you in the middle and the
 * low sun behind them to the left, and each opens a popover with everything about them. Under the water: your groups,
 * the people not on Alcove yet (the directory where there is one, otherwise the people at your work address you meet
 * with), and notes shared with groups. Nobody else here yet, it asks you to bring them, and Start a team makes a team of
 * your own (features/team/OurTeam.tsx). On a team, the line is the team's people under their licenses, with its people, its
 * licenses and the notes visible to it on the water. Someone on their own sees only Start a team.
 */
import { GroupParamSchema, NEW_GROUP, errorCode, errorMessage, type NoteSummary, type Team } from '@alcove/api';
import { Button, Evening, Icon, cn } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { byMeetings, byRecency, knownPeople, meetings, shownOf, type Member } from '~/features/team/data';
import { Groups, NO_DRAFT, readyToMake, type Draft } from '~/features/team/Groups';
import { AllPeople, PeopleLine, type Between } from '~/features/team/PeopleLine';
import { blanks, inLine, lineOf, sunOf, you } from '~/features/team/line';
import { OpenHost, personPop, useOpen } from '~/features/team/open';
import { InvitePeople, NotOnAlcove, PeopleYouMeet, useCopyInvite } from '~/features/team/People';
import { SharedWithGroups } from '~/features/team/Shared';
import { asDirectory, InviteMade, NoLicense, StartTeam, TeamMembers, TeamNotes, teamLine, useInvite } from '~/features/team/OurTeam';
import { useNow, useOnline } from '~/lib/live';
import { sameEmail } from '~/lib/people';
import { q } from '~/lib/queries';

export const Route = createFileRoute('/_app/team')({
  /** `group`: one of your groups to show open (from its tile, or the address), or NEW_GROUP to make one. */
  validateSearch: (s: Record<string, unknown>): { group?: string | undefined } => {
    const g = GroupParamSchema.safeParse(s['group']);
    return { group: g.success ? g.data : undefined };
  },
  /*
   * The team gets a moment, so it comes up with the page, and no longer: from your calendar it can take seconds, and
   * empty arches wait on the line until it's here. Your groups and notes load beside it, as Settings' parts do: if the
   * team or one of them doesn't load, the page says so where it would have been and the rest stays usable.
   */
  loader: async ({ context: { queryClient: qc } }) => {
    if (!navigator.onLine) return;
    await Promise.race([
      Promise.allSettled([qc.ensureQueryData(q.team()), qc.ensureQueryData(q.myTeam()), qc.ensureQueryData(q.prefs()), qc.ensureQueryData(q.notes())]),
      new Promise((r) => setTimeout(r, 1200))
    ]);
  },
  component: () => <OpenHost><TeamPage /></OpenHost>
});

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

function TeamPage() {
  const { group } = Route.useSearch();
  const navigate = useNavigate();
  const session = useQuery(q.session()).data;
  /* The loader has tried it; a team that didn't load waits for Try again. */
  const team = useQuery({ ...q.team(), retryOnMount: false });
  const mine = useQuery(q.myTeam()).data;
  const teamNotes = useQuery({ ...q.teamNotes(), enabled: !!mine?.licensed }).data ?? NO_NOTES;
  const invite = useInvite();
  const prefs = useQuery(q.prefs()).data;
  const notes = useQuery(q.notes()).data ?? NO_NOTES;
  const calls = useQuery(q.upcoming()).data ?? [];
  const calendar = useQuery(q.calendar()).data;
  const now = new Date(useNow(60_000));
  const online = useOnline();
  const { open, setOpen } = useOpen();
  const copy = useCopyInvite();
  const [draft, setDraft] = useState<Draft>(NO_DRAFT);
  const [forward, setForward] = useState<string | undefined>(undefined);
  const asked = useAskedBefore(team.data);
  if (!session) return null;
  if (team.data === null && mine === null) return <OnTheirOwn />;

  const me = session.user;
  // On a team, its people stand on the line; otherwise the company's directory.
  const here = mine ? asDirectory(mine) : team.data ?? undefined;
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
  const first = !mine && !!here && !on.length;
  const trouble = here ? undefined : !online || errorCode(team.error) === 'network' ? 'offline' : team.isError ? 'failed' : undefined;

  const line = lineOf(you(me),
    !here ? (trouble ? [] : blanks(WAITING))
      : first ? (off.length ? inLine([], off.slice(0, FIRST_DAY), undefined) : blanks(2))
        : inLine(on, off, forward));
  const sun = sunOf(line);
  /* One filled button: an open popover has its own, and so does a group ready to be made, while its editor's open. */
  const filled = open === undefined && !(group === NEW_GROUP && readyToMake(draft)) && invite.made === null;

  const groups = <Groups open={group} onOpen={openGroup} notes={notes} person={person} shown={shown} draft={draft} onDraft={setDraft} />;
  const shared = <SharedWithGroups notes={notes} me={me} now={now} />;

  return (
    <Evening moment="team" className="tp" data-line={line.arches.length <= 3 ? 'short' : 'long'}
      style={{ '--tp-sum': line.width.toFixed(3), '--tp-sun-x': sun.x.toFixed(3), '--tp-sun-r': sun.r.toFixed(3) }}>
      <div className="tp-sky" style={{ '--d': 0 }}>
        <header className="dusk-top"><h1 className="dusk-title">Team</h1></header>
        <section className="tp-hero" aria-labelledby="tp-h">
          <h2 id="tp-h" className="ac-clamp-2">{first ? 'Bring your team to Alcove' : here?.name ?? (trouble === 'offline' ? 'You’re offline' : trouble === 'failed' ? 'Your team didn’t load' : 'Your team')}</h2>
          {mine && <p className="tp-line">{teamLine(mine)}</p>}
          {trouble && <p className="tp-why"><Icon name={trouble === 'offline' ? 'wifiOff' : 'alert'} size={18} />{trouble === 'offline' ? 'Your team shows here when you’re back.' : errorMessage(team.error)}</p>}
          <div className="tp-acts">
            {mine?.role === 'admin' && <Button variant={filled ? 'primary' : 'secondary'} size="lg" icon="addUser" loading={invite.making} onClick={invite.invite}>Invite</Button>}
            {!mine && here && <InvitePeople me={me} team={here} meets={meets} now={now} anchor={<Button variant={filled ? 'primary' : 'secondary'} size="lg" icon="addUser">Invite people</Button>} />}
            {first && <Button size="lg" icon="link" onClick={() => void copy()}>Copy invite link</Button>}
            {mine === null && here && <StartTeam />}
            {here && line.recedes && (
              <AllPeople me={me} team={here} onFind={(email) => { setForward(email); setOpen(() => personPop(email)); }}
                anchor={<Button size="lg" icon="people">All {line.n} people</Button>} />
            )}
            {trouble && <Button variant="primary" size="lg" icon="retry" onClick={() => void team.refetch()}>Try again</Button>}
          </div>
          {invite.made && <InviteMade made={invite.made} onDone={invite.done} />}
        </section>
        <PeopleLine line={line} sun={sun} company={here?.name} waiting={!here && !trouble} between={between} />
      </div>
      <div className={cn('tp-grid', first && 'is-first', mine && 'is-team')} style={{ '--d': 1 }}>
        {mine && <NoLicense team={mine} />}
        {mine && <TeamMembers team={mine} />}
        {mine && <TeamNotes team={mine} notes={teamNotes} now={now} />}
        {first && here && <PeopleYouMeet team={here} people={off} directory={session.sample || members.some((m) => m.title !== undefined)} meets={meets} now={now} />}
        {groups}
        {!mine && off.length > 0 && !first && <NotOnAlcove people={off} meets={meets} now={now} />}
        {shared}
      </div>
    </Evening>
  );
}

/** Someone on their own, with no company and no team: Start a team is the page. */
function OnTheirOwn() {
  return (
    <Evening moment="team" className="tp" data-line="short">
      <div className="tp-sky" style={{ '--d': 0 }}>
        <header className="dusk-top"><h1 className="dusk-title">Team</h1></header>
        <section className="tp-hero" aria-labelledby="tp-h">
          <h2 id="tp-h" className="ac-clamp-2">A team of your own</h2>
          <p className="tp-line">Start a team, buy a license for each person, and invite them with a link.</p>
          <div className="tp-acts"><StartTeam /></div>
        </section>
      </div>
    </Evening>
  );
}
