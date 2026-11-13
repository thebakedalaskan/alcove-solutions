/*
 * The Team page while you're on a team (docs/design/pages.md › Team, on a plan; the canvas's TeamPlan board). The team's
 * name stands in the sky over how many are on it, and its people stand on the horizon, each under their license; pressing
 * someone opens their popover, as on a company's line. On the water: its people as rows, with Remove for the team's admin,
 * asked in place, and at their foot Leave team for a member, or Delete team for the admin once nobody else is on it; then
 * the notes made visible to the team, and the company page's groups and what's shared with them, which stay. Beside them,
 * for the admin: the licenses (Buy licenses opens checkout, and one can be bought whenever it's needed) and invite links.
 * A member without a live license is told first, at the top of the water, why the team's notes and workspaces aren't open.
 */
import { errorMessage, type MyTeam, type NoteSummary, type Person, type TeamMember } from '@alcove/api';
import {
  Button, Evening, LicensesCard, Notice, ShowMore, TeamAsk, TeamFoot, TeamInvite, TeamLine, TeamNotesList, TeamPersonRow, TeamRows, TeamSection, cn,
  useToast, type TeamLicenseTone, type TeamLinePerson, type TeamNote
} from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useRef, useState, type ReactNode } from 'react';
import { useCheckout } from '~/features/plans/checkout';
import { callName } from '~/lib/people';
import { q, useDeleteTeam, useLeaveTeam, useRemoveTeamMember, useSetAutoPurchase } from '~/lib/queries';
import { dayMonth, noteDay } from '~/lib/time';
import { plural, usd } from '~/lib/words';
import { useInvite } from './invite';
import { useOpen } from './open';
import { PersonPop, type Between } from './PeopleLine';

const NO_NOTES: NoteSummary[] = [];
/** The most who stand on the horizon: the rest are an empty arch at the end of the line, and every one of them is a row. */
const ON_THE_LINE = 10;
/** The notes visible to the team listed before Show more. */
const NOTES = 5;

/** A license as the page says it, in one word of tone: live, waiting for one (none was left), ended, or never had one. */
function toneOf(m: TeamMember): TeamLicenseTone {
  if (m.license.state === 'live') return 'live';
  if (m.license.wanted !== null) return 'waiting';
  return m.license.state;
}
const until = (m: TeamMember): string => (m.license.until === null ? '' : dayMonth(new Date(m.license.until)));

/** Under someone's arch: "Until 12 Dec", "Waiting", "Ended", "No license yet". */
function shortLicense(m: TeamMember): string {
  switch (toneOf(m)) {
    case 'live': return until(m) ? `Until ${until(m)}` : 'Licensed';
    case 'waiting': return 'Waiting';
    case 'ended': return 'Ended';
    case 'none': return 'No license yet';
  }
}
/** On someone's row: "Licensed until 12 Dec", "Waiting for a license", "License ended 9 Nov. A new one is taken when they next open Alcove." */
function rowLicense(m: TeamMember): string {
  switch (toneOf(m)) {
    case 'live': return until(m) ? `Licensed until ${until(m)}` : 'Licensed';
    case 'waiting': return 'Waiting for a license';
    case 'ended': return `License ended${until(m) ? ` ${until(m)}` : ''}. A new one is taken when ${m.you ? 'you' : 'they'} next open Alcove.`;
    case 'none': return 'No license yet';
  }
}
/** You first, then the team's admin, then everyone else as the team lists them. */
const inOrder = (members: readonly TeamMember[]): TeamMember[] =>
  [...members].sort((a, b) => Number(b.you) - Number(a.you) || Number(b.role === 'admin') - Number(a.role === 'admin'));
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

export function OnTeam({ team, me, between, now, groups, shared }: {
  team: MyTeam;
  me: Person;
  /** What people's popovers read (the company line's). */
  between: Between;
  now: Date;
  /** The company page's sections, which stay on a team: your groups, and the notes shared with them. */
  groups: ReactNode;
  shared: ReactNode;
}) {
  const toast = useToast();
  const checkout = useCheckout();
  const invite = useInvite();
  const { open } = useOpen();
  const remove = useRemoveTeamMember();
  const leave = useLeaveTeam();
  const del = useDeleteTeam();
  const auto = useSetAutoPurchase();
  const periodDays = useQuery(q.offers()).data?.periodDays;
  const teamNotes = useQuery({ ...q.teamNotes(), enabled: team.licensed });
  const notes = teamNotes.data ?? NO_NOTES;
  const [asking, setAsking] = useState<Asking>(null);
  const [allNotes, setAllNotes] = useState(false);
  /* Where the focus goes back to once a question is answered: the row's Remove, or the foot's button. */
  const removers = useRef(new Map<string, HTMLButtonElement>());
  const footBack = useRef<HTMLButtonElement>(null);
  const focusSoon = (find: () => HTMLElement | null | undefined) => requestAnimationFrame(() => find()?.focus({ preventScroll: true }));

  const admin = team.role === 'admin';
  const people = inOrder(team.members);
  const lead = people.find((m) => m.role === 'admin');
  const leadName = lead ? callName(lead.person) : 'The admin';
  const live = people.filter((m) => m.license.state === 'live').length;
  const waiting = people.filter((m) => toneOf(m) === 'waiting');
  const mine = people.find((m) => m.you);
  const licenses = admin ? team.licenses : null;

  const count = plural(people.length, 'person', 'people');
  const say = licenses
    ? `${count} · ${live} with a license · ${licenses.unconsumed ? `${plural(licenses.unconsumed, 'license')} left` : 'No licenses left'}`
    : `${count} · ${lead?.you ? 'You’re' : `${leadName} is`} its admin`;

  /* The line on the horizon. */
  const byKey = new Map(people.map((m) => [m.id, m]));
  const standing = people.slice(0, ON_THE_LINE).map((m): TeamLinePerson => ({
    key: m.id, person: m.person, name: m.you ? 'You' : callName(m.person), license: shortLicense(m), tone: toneOf(m),
    label: m.you ? `You, ${m.person.name}` : m.person.name
  }));
  const more = people.length - standing.length;

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
        license={rowLicense(m)} tone={toneOf(m)} removeLabel={`Remove ${m.person.name}`}
        onRemove={admin && !m.you && !here ? () => setAsking({ remove: m.id }) : undefined}
        removeRef={(el) => { if (el) removers.current.set(m.id, el); else removers.current.delete(m.id); }}>
        {here && (
          <TeamAsk title={`Take ${first} off ${team.name}?`} text="Their license isn’t refunded. They go back to Free, and notes they made visible to the team stay visible."
            confirm="Take off the team" keep={`Keep ${first}`} busy={remove.isPending}
            onConfirm={() => remove.mutate(m.id, {
              onSuccess: () => { setAsking(null); toast(`${first} is off the team.`, { icon: 'check' }); after(); },
              onError: (e) => toast(errorMessage(e), { icon: 'x' })
            })}
            onKeep={() => { setAsking(null); focusSoon(() => removers.current.get(m.id)); }} />
        )}
      </TeamPersonRow>
    );
  };

  /* Leave team for a member; Delete team for the admin, once nobody else is on it. Each asks in place of the foot. */
  const alone = people.length === 1;
  const keepFoot = () => { setAsking(null); focusSoon(() => footBack.current); };
  const foot = admin ? (
    asking === 'delete' ? (
      <TeamFoot action={(
        <TeamAsk title={`Delete ${team.name}?`} confirm="Delete team" keep="Keep it" busy={del.isPending} onKeep={keepFoot}
          text={`${licenses && licenses.refundableMicroUsd > 0 ? `The licenses nobody took go back to your balance: ${usd(licenses.refundableMicroUsd)}.` : 'There are no licenses left to refund.'} Its workspaces stop being the team’s.`}
          onConfirm={() => del.mutate(undefined, {
            onSuccess: () => toast(`${team.name} is deleted.`, { icon: 'check' }),
            onError: (e) => toast(errorMessage(e), { icon: 'x' })
          })} />
      )} />
    ) : (
      <TeamFoot action={<Button ref={footBack} variant="quiet" size="sm" disabled={!alone} onClick={() => setAsking('delete')}>Delete team</Button>}>
        {alone ? 'Licenses nobody took go back to your balance.' : 'Once nobody else is on it. Licenses nobody took go back to your balance.'}
      </TeamFoot>
    )
  ) : asking === 'leave' ? (
    <TeamFoot action={(
      <TeamAsk title={`Leave ${team.name}?`} text="Your license isn’t refunded. You go back to Free, and notes you made visible to the team stay visible."
        confirm="Leave the team" keep="Stay" busy={leave.isPending} onKeep={keepFoot}
        onConfirm={() => leave.mutate(undefined, {
          onSuccess: () => toast(`You left ${team.name}.`, { icon: 'check' }),
          onError: (e) => toast(errorMessage(e), { icon: 'x' })
        })} />
    )} />
  ) : (
    <TeamFoot action={<Button ref={footBack} variant="quiet" size="sm" onClick={() => setAsking('leave')}>Leave team</Button>}>
      Your license isn’t refunded, and you go back to Free.
    </TeamFoot>
  );

  /*
   * Without a license the team's notes aren't open: a member is told so at the top, so their list isn't shown at all. While
   * they're on their way the section waits to come in, so it never says there are none when there are.
   */
  const showNotes = (team.licensed || admin) && !(team.licensed && teamNotes.isPending);
  const visible = notes.map((n): TeamNote => ({
    id: n.id, title: n.title, by: n.received?.by ?? me, byName: n.received ? callName(n.received.by) : 'you', when: noteDay(n.startedAt, now)
  }));
  const shown = allNotes ? visible : visible.slice(0, NOTES);

  /* One filled button: Buy licenses while someone waits, unless a question or someone's popover has its own. */
  const urgent = waiting.length > 0 && asking === null && open === undefined;
  const autoOn = auto.isPending && auto.variables !== undefined ? auto.variables : licenses?.autoPurchase ?? false;
  const how = `Each is taken as someone next opens Alcove${periodDays === undefined ? '' : `, for ${plural(periodDays, 'day')}`}.`;

  return (
    <Evening moment="team" className="tq" style={{ '--tq-n': standing.length + (more > 0 ? 1 : 0) }}>
      <div className="tq-sky" style={{ '--d': 0 }}>
        <header className="dusk-top"><h1 className="dusk-title">Team</h1></header>
        <section className="tq-hero" aria-labelledby="tq-h">
          <h2 id="tq-h" className="ac-clamp-2">{team.name}</h2>
          <p className="tq-say">{say}</p>
        </section>
        <TeamLine people={standing} more={more} label={`People on ${team.name}`}
          arch={(p, button) => { const m = byKey.get(p.key); return m ? <PersonPop person={m.person} me={m.you} between={between} anchor={button} /> : button; }} />
      </div>
      <div className={cn('tq-water', !licenses && 'is-solo')} style={{ '--d': 1 }}>
        <div className="tq-main">
          {!admin && !team.licensed && (
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
          {showNotes && (
            <TeamNotesList notes={shown}
              link={(n, inside) => <Link to="/calls/$noteId" params={{ noteId: n.id }}>{inside}</Link>}
              empty={teamNotes.isError
                ? { title: 'These didn’t load', line: errorMessage(teamNotes.error), action: <Button size="sm" icon="retry" onClick={() => void teamNotes.refetch()}>Try again</Button> }
                : team.licensed
                  ? { title: 'Nothing visible to the team yet', line: 'On a note you organized, open Share and turn on Visible to team.' }
                  : { title: 'Not open to you yet', line: 'The notes people here make visible open while you have a license.' }}
              foot={visible.length > NOTES + 1 && <ShowMore all={allNotes} more={visible.length - NOTES} onToggle={() => setAllNotes(!allNotes)} className="tq-more" />} />
          )}
          {groups}
          {shared}
        </div>
        {licenses && (
          <aside className="tq-side" aria-label="For the team’s admin">
            <LicensesCard left={licenses.unconsumed} of={licenses.unconsumed + live} warm={waiting.length > 0} urgent={urgent}
              line={waiting.length ? `${waitingFor(waiting)} ${how}` : how}
              onBuy={() => checkout.open({ plan: 'team' }, 'team')}
              auto={autoOn} autoBusy={auto.isPending}
              onAuto={(on) => auto.mutate(on, { onError: (e) => toast(errorMessage(e), { icon: 'x' }) })} />
            <TeamInvite card {...invite} />
          </aside>
        )}
      </div>
    </Evening>
  );
}
