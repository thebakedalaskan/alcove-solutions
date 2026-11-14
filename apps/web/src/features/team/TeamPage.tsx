/*
 * Team (docs/design/pages.md › Team): one evening, whichever of three views it shows. On a team, the team's (OnTeam.tsx); on
 * none, with a company around you, your company's (Company.tsx); with neither, the invitations to you (Invitations.tsx);
 * with none of those either, there's no Team page: nothing links here, and its address goes Home. The page rises once, as
 * it opens. Switching views in place (joining, a first invitation starting the team, leaving or deleting it) keeps the
 * evening and crossfades: what's left of the last view fades out over the next (leaveFading), the horizon and the sun move
 * to where the next has them, and the focus goes to the next's heading. Inviting works the same from anywhere on it
 * (People.tsx's InvitingContext). `group` is one of your groups to show open (from its tile, or the address), or NEW_GROUP to
 * make one.
 */
import { NEW_GROUP, errorCode, type InvitationForYou, type NoteSummary, type Team, type TeamInvitation } from '@alcove/api';
import { Evening, cn, leaveFading } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useNavigate } from '@tanstack/react-router';
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNow, useOnline } from '~/lib/live';
import { sameEmail } from '~/lib/people';
import { accountQueries } from '~/features/account/queries';
import { callQueries } from '~/features/calls/list/queries';
import { calendarQueries } from '~/features/calls/scheduling/queries';
import { teamLicenses } from '~/features/plans/planState';
import { noteQueries } from '~/features/notes/queries';
import { teamQueries } from './queries';
import { byMeetings, byRecency, knownPeople, meetings, shownOf, type Member } from './data';
import { Company } from './Company';
import { Groups, NO_DRAFT, readyToMake, type Draft } from './Groups';
import { useSteadyInvitations } from './invitations/Invitees';
import { invitationOf } from './invitations/send';
import { useJoining } from './invitations/ToYou';
import { Invitations } from './Invitations';
import { blanks, inLine, lineOf, sunOf, you } from './line';
import { OnTeam } from './OnTeam';
import { useOpen } from './open';
import { InvitingContext, type Inviting } from './People';
import type { Between } from './PeopleLine';
import { SharedWithGroups } from './Shared';
import { horizonOf, inOrder } from './teamLine';

const NO_NOTES: NoteSummary[] = [];
const NOBODY: ReadonlySet<string> = new Set();
const NO_INVITATIONS: InvitationForYou[] = [];
const NO_TEAM_INVITATIONS: TeamInvitation[] = [];
/** How many empty arches wait on the line for the team, and how many stand beside you on the first day. */
const WAITING = 6;
const FIRST_DAY = 4;

/** Who'd been asked when the page opened, so nobody jumps along the line or down the list when you invite them. */
function useAskedBefore(team: Team | null | undefined): ReadonlySet<string> {
  const [asked, setAsked] = useState<ReadonlySet<string> | null>(null);
  if (team && !asked) setAsked(new Set(team.members.filter((m) => m.invited).map((m) => m.person.email)));
  return asked ?? NOBODY;
}

/**
 * The heading the focus goes to as the page becomes another view, once something here says it will (`next`: joining,
 * starting the team, leaving it). `ref` is each view's heading's.
 */
function useHeadingFocus() {
  const want = useRef(false);
  const ref = useCallback((el: HTMLHeadingElement | null) => { if (el && want.current) { want.current = false; el.focus(); } }, []);
  return { ref, next: useCallback(() => { want.current = true; }, []) };
}

/**
 * One view of the page. The first rises with the page; one that takes another's place fades in over what's left of the last
 * (`swap`), which leaves a still copy of the page as it was, fading out, as it goes.
 */
function View({ swap, children }: { swap: boolean; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    return () => {
      const page = el?.closest('.dusk');
      if (page instanceof HTMLElement) leaveFading(page, [':scope > .hz', ':scope > [data-leaving]']);
    };
  }, []);
  return <div ref={box} className={cn('tm-view', swap && 'is-swap')}>{children}</div>;
}

/** The page, inside its people's popovers (`OpenHost`, open.tsx). */
export function TeamPage({ group }: { group: string | undefined }) {
  const navigate = useNavigate();
  const session = useQuery(accountQueries.session()).data;
  /* The loader has tried it; a team that didn't load waits for Try again. */
  const team = useQuery({ ...teamQueries.team(), retryOnMount: false });
  /* The team you're on, if you're on one: then the page is the team's. */
  const mine = useQuery(teamQueries.myTeam()).data;
  /* The invitations to you, read every minute and whenever the window comes back. */
  const invitations = useQuery(teamQueries.invitations());
  const toYou = invitations.data ?? NO_INVITATIONS;
  const prefs = useQuery(accountQueries.prefs()).data;
  const notes = useQuery(noteQueries.notes()).data ?? NO_NOTES;
  const calls = useQuery(callQueries.upcoming()).data ?? [];
  const calendar = useQuery(calendarQueries.calendar()).data;
  const now = new Date(useNow(60_000));
  const online = useOnline();
  const { open } = useOpen();
  const heading = useHeadingFocus();
  const joining = useJoining(mine, heading.next);
  const [draft, setDraft] = useState<Draft>(NO_DRAFT);
  const [forward, setForward] = useState<string | undefined>(undefined);
  const asked = useAskedBefore(team.data);
  /* Who's invited stands on the horizon in the order the page opened with, as the list under it does. */
  const invitedInOrder = useSteadyInvitations(mine?.invitations ?? NO_TEAM_INVITATIONS);
  /* Whether a view has taken another's place since the page opened: from then on, views crossfade rather than rise. */
  const view = mine ? 'team' : team.data === null && mine === null ? 'invited' : 'company';
  const [opened] = useState(view);
  const [swapped, setSwapped] = useState(false);
  if (!swapped && view !== opened) setSwapped(true);
  if (!session) return null;
  /* Nothing to show: no company around you, no team, and nobody has invited you to one. */
  if (team.data === null && mine === null && invitations.data !== undefined && !toYou.length) return <Navigate to="/home" replace />;

  const me = session.user;
  const here = team.data ?? undefined;
  const events = prefs?.showOtherMeetings === false ? [] : calendar?.events ?? [];
  const meets = meetings(notes, calls, events, me.email, now);
  const person = knownPeople(here, notes, calls, events);
  const shown = shownOf(here);
  const between: Between = { notes, meets, now, inGroups: (prefs?.groups ?? []).filter((g) => g.emails.some((e) => sameEmail({ email: e }, me))).length };
  const openGroup = (g: string | undefined) => void navigate({ to: '/team', search: g ? { group: g } : {}, replace: true, resetScroll: false });
  /* With no team, the newest invitation to you not put aside: then nothing on the page starts another team. */
  const waiting = mine ? null : toYou.find((i) => !i.putAside) ?? null;
  const inviting: Inviting = {
    me, company: here, mine, meets, now, waiting,
    toCard: (i) => joining.toJoin(i.id), join: (i) => joining.press(i), starting: heading.next
  };

  const groups = <Groups open={group} onOpen={openGroup} notes={notes} person={person} shown={shown} draft={draft} onDraft={setDraft} />;
  const shared = <SharedWithGroups notes={notes} me={me} now={now} />;
  let look: { className: string; style?: CSSProperties; line?: 'short' | 'long' };
  let body: ReactNode;
  if (mine) {
    /* On your company's team (one you admin, or whose admin is at your company), the colleagues not on it stand further back. */
    const admin = mine.members.find((m) => m.role === 'admin');
    const ours = mine.role === 'admin' || (here?.members ?? []).some((m) => admin !== undefined && sameEmail(m.person, admin.person));
    const colleagues = (ours ? here?.members ?? [] : [])
      .filter((m) => !mine.members.some((x) => sameEmail(x.person, m.person)) && !invitationOf(mine, m.person.email) && !sameEmail(m.person, me))
      .sort(byMeetings(meets));
    const left = mine.role === 'admin' && mine.tier === 'team' ? teamLicenses(mine)?.left ?? null : null;
    const horizon = horizonOf(mine, inOrder(mine.members), invitedInOrder, colleagues, now, left);
    look = { className: 'tq', style: { '--tq-n': horizon.places.toFixed(3) } };
    body = (
      <OnTeam team={mine} me={me} company={here?.name} between={between} now={now} groups={groups} shared={shared} invitations={toYou} joining={joining}
        horizon={horizon} colleagues={colleagues} heading={heading.ref} onGone={heading.next} />
    );
  } else if (view === 'invited') {
    look = { className: 'ti-page' };
    body = (
      <Invitations invitations={toYou} joining={joining} now={now.getTime()} waiting={invitations.isPending} failed={invitations.isError ? invitations.error : null}
        onRetry={() => void invitations.refetch()} heading={heading.ref} />
    );
  } else {
    const members = here?.members ?? [];
    const on = members.filter((m) => m.onAlcove).sort(byRecency(meets));
    const inOrderOfMeets = byMeetings(meets);
    const notYet = (was: boolean) => members.filter((m) => !m.onAlcove && asked.has(m.person.email) === was).sort(inOrderOfMeets);
    const off: Member[] = [...notYet(false), ...notYet(true)];
    const first = !!here && !on.length;
    const trouble = here ? undefined : !online || errorCode(team.error) === 'network' ? 'offline' : team.isError ? 'failed' : undefined;
    const line = lineOf(you(me),
      !here ? (trouble ? [] : blanks(WAITING))
        : first ? (off.length ? inLine([], off.slice(0, FIRST_DAY), undefined) : blanks(2))
          : inLine(on, off, forward));
    const sun = sunOf(line);
    /* One filled button: an open popover has its own, a group ready to be made while its editor's open, and a waiting invitation's Join. */
    const filled = open === undefined && !(group === NEW_GROUP && readyToMake(draft)) && waiting === null;
    look = {
      className: 'tp', line: line.arches.length <= 3 ? 'short' : 'long',
      style: { '--tp-sum': line.width.toFixed(3), '--tp-sun-x': sun.x.toFixed(3), '--tp-sun-r': sun.r.toFixed(3) }
    };
    body = (
      <Company me={me} here={here} line={line} sun={sun} first={first} off={off} directory={session.sample || members.some((m) => m.title !== undefined)}
        trouble={trouble} failed={team.error} onRetry={() => void team.refetch()} between={between} invitations={toYou} joining={joining}
        groups={groups} shared={shared} filled={filled} heading={heading.ref} onFind={setForward} />
    );
  }
  return (
    <InvitingContext.Provider value={inviting}>
      <Evening moment="team" className={cn('tm', look.className)} style={look.style} data-line={look.line}>
        <View key={view} swap={swapped}>{body}</View>
      </Evening>
    </InvitingContext.Provider>
  );
}
