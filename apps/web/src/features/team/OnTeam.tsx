/*
 * The Team page while you're on a team (docs/design/pages.md › Team, a team's page; the canvas's TeamPlan board), inside the
 * page's one evening (TeamPage.tsx). The team's name stands in the sky, with the admin's Rename beside it, over its tier and
 * how many are on it ("Free · 3 people"), then Invite people; its people stand on the horizon (each under their license on
 * Team), then whoever's invited, in dashed arches, and on your company's team the colleagues not on it, further back (the
 * page works out who: teamLine.ts). Pressing someone opens their popover, as on a company's line. On the water: an
 * invitation to another team first, if there is one; on Free, what Free means, once, with the page's one Upgrade for the
 * admin (Tier.tsx), once someone else is on it; its people as rows, with Remove for the admin, asked in place, and at their
 * foot Leave team for a member, or Delete team for the admin once nobody else is on it; who's invited
 * (invitations/Invitees.tsx); at a company, the colleagues not on it yet, to invite; the notes made visible to the team; and
 * your groups and what's shared with them, which stay. Beside them, for the admin of a team on Team (or one buying a license
 * for each person who joins), its licenses. A member of a team on Team without a live license is told first why its notes
 * and workspaces aren't open; on a free team nobody hears about licenses at all.
 */
import { errorMessage, type InvitationForYou, type MyTeam, type NoteSummary, type Person, type TeamMember } from '@alcove/api';
import {
  Button, LicensesCard, Notice, ShowMore, TeamAsk, TeamFoot, TeamLine, TeamNotesList, TeamPersonRow, TeamRows, TeamSection, TeamTier, cn, useToast,
  type TeamNote
} from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useRef, useState, type ReactNode, type Ref } from 'react';
import { useCheckout } from '~/features/plans/checkout';
import { teamLicenses } from '~/features/plans/planState';
import { callName } from '~/lib/people';
import { planQueries } from '~/features/plans/queries';
import { teamQueries, useDeleteTeam, useLeaveTeam, useRemoveTeamMember, useSetAutoPurchase } from './queries';
import { noteDay } from '~/lib/time';
import { plural, usd } from '~/lib/words';
import type { Member } from './data';
import { Invitees } from './invitations/Invitees';
import { InvitationNotesFor, PutAside, type Joining } from './invitations/ToYou';
import { useOpen } from './open';
import { InvitePeople, PeopleToInvite } from './People';
import { PersonPop, type Between } from './PeopleLine';
import { Rename } from './Rename';
import { inOrder, rowLine, toneOf, type TeamHorizon } from './teamLine';
import { Tier } from './Tier';

const NO_NOTES: NoteSummary[] = [];
/** The notes visible to the team listed before Show more. */
const NOTES = 5;

/** Who's waiting for a license, as the licenses say it: "Aiko is waiting for one.", "You and Aiko are each waiting for one." */
function waitingFor(waiting: readonly TeamMember[]): string {
  const names = waiting.map((m) => (m.you ? 'You' : callName(m.person)));
  const [one] = names;
  if (names.length === 1 && one !== undefined) return `${one === 'You' ? 'You’re' : `${one} is`} waiting for one.`;
  const who = names.length === 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
  return `${who} are each waiting for one.`;
}

/** What's asked in place: taking someone off the team (their member ID), leaving it, or deleting it. One at a time. */
type Asking = { remove: string } | 'leave' | 'delete' | null;

export function OnTeam({ team, me, between, now, groups, shared, invitations, joining, horizon, colleagues, company, heading, onGone }: {
  team: MyTeam;
  me: Person;
  /** What people's popovers read (the company line's). */
  between: Between;
  now: Date;
  /** The company page's sections, which stay on a team: your groups, and the notes shared with them. */
  groups: ReactNode;
  shared: ReactNode;
  /** The invitations to you, to other teams. */
  invitations: readonly InvitationForYou[];
  joining: Joining;
  /** Who stands on the horizon (teamLine.ts). */
  horizon: TeamHorizon;
  /** At a company, on your company's team: the colleagues not on it and not invited, to invite. */
  colleagues: readonly Member[];
  /** The company's name, where there is one. */
  company: string | undefined;
  /** The team's name, which takes the focus when the page becomes the team's. */
  heading: Ref<HTMLHeadingElement>;
  /** You're off the team (you left it, or deleted it): the page is about to be another. */
  onGone: () => void;
}) {
  const toast = useToast();
  const checkout = useCheckout();
  const { open } = useOpen();
  const remove = useRemoveTeamMember();
  const leave = useLeaveTeam();
  const del = useDeleteTeam();
  const auto = useSetAutoPurchase();
  const offers = useQuery(planQueries.offers()).data;
  const periodDays = offers?.periodDays;
  const teamNotes = useQuery({ ...teamQueries.teamNotes(), enabled: team.licensed });
  const notes = teamNotes.data ?? NO_NOTES;
  const [asking, setAsking] = useState<Asking>(null);
  const [allNotes, setAllNotes] = useState(false);
  /* Where the focus goes back to once a question is answered: the row's Remove, or the foot's button. */
  const removers = useRef(new Map<string, HTMLButtonElement>());
  const footBack = useRef<HTMLButtonElement>(null);
  const focusSoon = (find: () => HTMLElement | null | undefined) => requestAnimationFrame(() => find()?.focus({ preventScroll: true }));

  const free = team.tier === 'free';
  const admin = team.role === 'admin';
  const people = inOrder(team.members);
  const lead = people.find((m) => m.role === 'admin');
  const leadName = lead ? callName(lead.person) : 'The admin';
  const mine = people.find((m) => m.you);
  /* The admin's licenses: on Team, and on Free while a license is bought for each person who joins, which spends money. */
  const licenses = admin && team.licenses && (!free || team.licenses.autoPurchase) ? team.licenses : null;
  /* How many are left of how many, and who's waiting, in the page's order: the same count Settings › Plan and checkout say. */
  const counts = licenses ? teamLicenses(team) : null;
  const waiting = inOrder(counts?.waiting ?? []);

  const count = plural(people.length, 'person', 'people');
  const say = free ? count
    : admin && counts ? `${count} · ${counts.live} with a license · ${counts.left ? `${plural(counts.left, 'license')} left` : 'No licenses left'}`
      : `${count} · ${lead?.you ? 'You’re' : `${leadName} is`} its admin`;

  /* Taking someone off, asked under their row. */
  const row = (m: TeamMember, i: number) => {
    const first = callName(m.person);
    const here = asking !== null && typeof asking === 'object' && asking.remove === m.id;
    /* Once they're off, the focus goes to the next row's Remove, or the one before, or the foot. */
    const after = () => {
      const others = people.filter((o) => !o.you && o.id !== m.id);
      const next = others.find((o) => people.indexOf(o) > i) ?? others.at(-1);
      focusSoon(() => (next ? removers.current.get(next.id) : footBack.current));
    };
    return (
      <TeamPersonRow key={m.id} person={m.person} name={m.you ? `${m.person.name} (you)` : m.person.name} admin={m.role === 'admin'}
        line={rowLine(m, team, now, counts?.left ?? null)} tone={free ? 'none' : toneOf(m)} removeLabel={`Remove ${m.person.name}`}
        onRemove={admin && !m.you && !here ? () => setAsking({ remove: m.id }) : undefined}
        removeRef={(el) => { if (el) removers.current.set(m.id, el); else removers.current.delete(m.id); }}>
        {here && (
          <TeamAsk title={`Remove ${first}?`}
            text={`They leave the team, and its invite link changes, so share the new one with anyone still to join.${free ? '' : ' Their license isn’t refunded.'}`}
            confirm={`Remove ${first}`} keep={`Keep ${first}`} busy={remove.isPending}
            onConfirm={() => remove.mutate(m.id, {
              onSuccess: () => { setAsking(null); toast(`${first} is off the team.`, { icon: 'check' }); after(); },
              onError: (e) => { setAsking(null); toast(errorMessage(e), { icon: 'x' }); focusSoon(() => removers.current.get(m.id)); }
            })}
            onKeep={() => { setAsking(null); focusSoon(() => removers.current.get(m.id)); }} />
        )}
      </TeamPersonRow>
    );
  };

  /* Leave team for a member; Delete team for the admin, once nobody else is on it. Each asks in place of the foot. */
  const alone = people.length === 1;
  const keepFoot = () => { setAsking(null); focusSoon(() => footBack.current); };
  const refundable = team.licenses?.refundableMicroUsd ?? 0;
  const gone = (said: string) => ({
    onSuccess: () => { onGone(); toast(said, { icon: 'check' }); },
    onError: (e: unknown) => { toast(errorMessage(e), { icon: 'x' }); keepFoot(); }
  });
  const foot = admin ? (
    asking === 'delete' ? (
      <TeamFoot action={(
        <TeamAsk title={`Delete ${team.name}?`} confirm="Delete team" keep="Keep it" busy={del.isPending} onKeep={keepFoot}
          text={`${refundable > 0 ? `The licenses nobody took go back to your balance: ${usd(refundable)}.` : free ? 'Its invitations stop working.' : 'There are no licenses left to refund.'} Its workspaces stop being the team’s.`}
          onConfirm={() => del.mutate(undefined, gone(`${team.name} is deleted.`))} />
      )} />
    ) : (
      <TeamFoot action={<Button ref={footBack} variant="quiet" size="sm" disabled={!alone} onClick={() => setAsking('delete')}>Delete team</Button>}>
        {free ? (alone ? 'Its invitations stop working.' : 'Once nobody else is on it.') : alone ? 'Licenses nobody took go back to your balance.' : 'Once nobody else is on it. Licenses nobody took go back to your balance.'}
      </TeamFoot>
    )
  ) : asking === 'leave' ? (
    <TeamFoot action={(
      <TeamAsk title={`Leave ${team.name}?`}
        text={free ? 'Your plan doesn’t change. Anyone you invited isn’t invited any more.' : 'Your license isn’t refunded. You go back to Free, and notes you made visible to the team stay visible.'}
        confirm="Leave the team" keep="Stay" busy={leave.isPending} onKeep={keepFoot}
        onConfirm={() => leave.mutate(undefined, gone(`You left ${team.name}.`))} />
    )} />
  ) : (
    <TeamFoot action={<Button ref={footBack} variant="quiet" size="sm" onClick={() => setAsking('leave')}>Leave team</Button>}>
      {free ? 'Your plan doesn’t change.' : 'Your license isn’t refunded, and you go back to Free.'}
    </TeamFoot>
  );

  /*
   * Without a license the team's notes aren't open: a member of a team on Team is told so at the top, so their list isn't
   * shown at all. On Free it says what they'd hold once it's upgraded. While they're on their way the section waits to come
   * in, so it never says there are none when there are.
   */
  const showNotes = free || ((team.licensed || admin) && !(team.licensed && teamNotes.isPending));
  const visible = notes.map((n): TeamNote => ({
    id: n.id, title: n.title, by: n.received?.by ?? me, byName: n.received ? callName(n.received.by) : 'you', when: noteDay(n.startedAt, now)
  }));
  const shown = allNotes ? visible : visible.slice(0, NOTES);

  /* An invitation to another team waiting on you takes the filled button: it's what waits on you here. */
  const invited = invitations.some((i) => !i.putAside);
  /* One filled button: Buy licenses while someone waits, unless a question or someone's popover has its own. */
  const urgent = waiting.length > 0 && asking === null && open === undefined && !invited && !free;
  const quiet = asking !== null || open !== undefined || invited || urgent;
  /*
   * On Free, Invite people is the filled one until someone else is on the team, then the admin's Upgrade, beside what
   * upgrading gives. While the admin is alone, Free isn't explained at all: inviting is the thing to do.
   */
  const explain = free && !(admin && alone);
  const upgradeFilled = explain && admin && !quiet;
  const inviteFilled = !quiet && !upgradeFilled;
  const autoOn = auto.isPending && auto.variables !== undefined ? auto.variables : licenses?.autoPurchase ?? false;
  // A license runs a period from when it's taken, or a year's periods when it was bought for a year.
  const how = free
    ? 'None bought now. While this is on, one is bought from your balance for each person who opens Alcove without one.'
    : `Each is taken as someone next opens Alcove${periodDays === undefined ? '' : `, for ${plural(periodDays, 'day')}${offers?.team.yearly ? ', or a year if bought for one' : ''}`}.`;

  return (
    <>
      <div className="tq-sky" style={{ '--d': 0 }}>
        <header className="dusk-top"><h1 className="dusk-title">Team</h1></header>
        <section className="tq-hero" aria-labelledby="tq-h">
          <div className="tq-name">
            <h2 ref={heading} id="tq-h" tabIndex={-1} className="ac-clamp-2">{team.name}</h2>
            {admin && <Rename team={team} />}
          </div>
          <TeamTier tier={team.tier}>{say}</TeamTier>
          <div className="tq-acts">
            <InvitePeople anchor={<Button variant={inviteFilled ? 'primary' : 'secondary'} icon="addUser">Invite people</Button>} />
          </div>
        </section>
        <TeamLine people={horizon.people} more={horizon.more} label={`People on ${team.name}`}
          arch={(p, button) => {
            const s = horizon.who.get(p.key);
            if (!s) return button;
            if (s.kind === 'member') return <PersonPop person={s.member.person} me={s.member.you} between={between} anchor={button} />;
            if (s.kind === 'invited') return <PersonPop person={s.invitation.person} invited between={between} anchor={button} />;
            return <PersonPop person={s.colleague.person} colleague={s.colleague} between={between} anchor={button} />;
          }} />
      </div>
      <div className={cn('tq-water', !counts && 'is-solo')} style={{ '--d': 1 }}>
        <div className="tq-main">
          <InvitationNotesFor invitations={invitations} joining={joining} lead={asking === null && open === undefined} />
          {explain && <Tier team={team} lead={upgradeFilled} />}
          {!free && !admin && !team.licensed && (
            <Notice tone="caution" icon="alert" className="tq-wait">
              You don’t have a license on {team.name} yet, so the notes and workspaces the team shares aren’t open to you.
              {mine?.license.wanted === null
                ? ' One is yours the next time you open Alcove, if one is left.'
                : ` ${leadName} has been told, and one is yours the next time you open Alcove after they buy more.`}
            </Notice>
          )}
          <TeamSection title={`People on ${team.name}`} className="tq-people" foot={foot}>
            <TeamRows>{people.map(row)}</TeamRows>
          </TeamSection>
          <Invitees team={team} now={now.getTime()} />
          {colleagues.length > 0 && <PeopleToInvite title={`At ${company ?? team.name}, not on the team yet`} people={[...colleagues]} meets={between.meets} now={now} />}
          {showNotes && (
            <TeamNotesList notes={free ? [] : shown}
              link={(n, inside) => <Link to="/calls/$noteId" params={{ noteId: n.id }}>{inside}</Link>}
              empty={free
                ? { title: 'These open on Team', line: `Notes people make visible to the team, and its whole-team workspaces, open to everyone on it once ${team.name} is upgraded.` }
                : teamNotes.isError
                  ? { title: 'These didn’t load', line: errorMessage(teamNotes.error), action: <Button size="sm" icon="retry" onClick={() => void teamNotes.refetch()}>Try again</Button> }
                  : team.licensed
                    ? { title: 'Nothing visible to the team yet', line: 'On a note you organized, open Share and turn on Visible to team.' }
                    : { title: 'Not open to you yet', line: 'The notes people here make visible open while you have a license.' }}
              foot={!free && visible.length > NOTES + 1 && <ShowMore all={allNotes} more={visible.length - NOTES} onToggle={() => setAllNotes(!allNotes)} className="tq-more" />} />
          )}
          {groups}
          {shared}
          <PutAside invitations={invitations} joining={joining} now={now.getTime()} />
        </div>
        {counts && licenses && (
          <aside className="tq-side" aria-label="For the team’s admin">
            <LicensesCard left={counts.left} of={counts.of} warm={waiting.length > 0} urgent={urgent}
              line={waiting.length ? `${waitingFor(waiting)} ${how}` : how}
              onBuy={free ? undefined : () => checkout.open({ plan: 'team' }, 'team')}
              auto={autoOn} autoBusy={auto.isPending}
              onAuto={(on) => auto.mutate(on, { onError: (e) => toast(errorMessage(e), { icon: 'x' }) })} />
          </aside>
        )}
      </div>
    </>
  );
}
