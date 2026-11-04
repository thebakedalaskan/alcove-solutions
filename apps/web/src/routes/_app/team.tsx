/*
 * Team: your company and who in it uses Alcove (the directory where there is one, otherwise the people at
 * your work address you meet with), your groups, notes shared with groups, and your minutes. Nobody else
 * here yet, it asks you to bring them; a personal account has no team, only groups.
 */
import { GroupParamSchema, type NoteSummary, type Person, type Team } from '@alcove/api';
import { ArchThumb, Button, Card, EmptyState, Icon, MinutesCard, coverFor } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { groupShares, knownPeople, meetings } from '~/features/team/data';
import { Groups } from '~/features/team/Groups';
import { RouteError } from '~/features/shell/OfflinePage';
import { FirstHere, InvitePeople, JustYou, NotOnAlcove, PeopleGrid } from '~/features/team/People';
import { useNow } from '~/lib/live';
import { callName, sameEmail } from '~/lib/people';
import { q } from '~/lib/queries';
import { hoursAndMinutes, pastDay } from '~/lib/time';

export const Route = createFileRoute('/_app/team')({
  /** `group`: one of your groups to show open (the side panel's groups link here), or NEW_GROUP to make one. */
  validateSearch: (s: Record<string, unknown>): { group?: string | undefined } => {
    const g = GroupParamSchema.safeParse(s['group']);
    return { group: g.success ? g.data : undefined };
  },
  /*
   * The team is the page: if it doesn't load, the page says why (or that you're offline), with Try again. Your groups
   * and notes load beside it, as Settings' parts do: one that doesn't leaves the rest of the page usable.
   */
  loader: async ({ context: { queryClient: qc } }) => {
    await Promise.all([qc.ensureQueryData(q.team()), Promise.allSettled([qc.ensureQueryData(q.prefs()), qc.ensureQueryData(q.notes())])]);
  },
  errorComponent: RouteError,
  component: TeamPage
});

function TeamPage() {
  const { group } = Route.useSearch();
  const navigate = useNavigate();
  const session = useQuery(q.session()).data;
  const team = useQuery(q.team()).data;
  const prefs = useQuery(q.prefs()).data;
  const notes = useQuery(q.notes()).data ?? [];
  const calls = useQuery(q.upcoming()).data ?? [];
  const calendar = useQuery(q.calendar()).data;
  const now = new Date(useNow(60_000));
  if (!session || team === undefined) return null;

  const me = session.user;
  const events = prefs?.showOtherMeetings === false ? [] : calendar?.events ?? [];
  const meets = meetings(notes, calls, events, now);
  const person = knownPeople(team, notes, calls, events);
  const openGroup = (g: string | undefined) => void navigate({ to: '/team', search: g ? { group: g } : {}, replace: true, resetScroll: false });
  const groups = <Groups open={group} onOpen={openGroup} notes={notes} person={person} />;
  const shared = <SharedWithGroups notes={notes} me={me} now={now} />;

  if (!team) {
    return (
      <>
        <header className="tp-head" style={{ '--d': 0 }}>
          <div><p className="ac-eyebrow">{me.email.slice(me.email.lastIndexOf('@') + 1)} · personal account</p><h1>Team</h1></div>
        </header>
        <div style={{ '--d': 1 }}><JustYou me={me} provider={session.provider} /></div>
        <div className="tp-pair" style={{ '--d': 2 }}>{groups}{shared}</div>
      </>
    );
  }

  // A company directory comes with a demo account, and only a directory gives people titles.
  const directory = session.sample || team.members.some((m) => m.title !== undefined);
  const others = team.members.filter((m) => m.onAlcove).length;
  const head = (lede: string, act?: boolean) => (
    <header className="tp-head" style={{ '--d': 0 }}>
      <div>
        <p className="ac-eyebrow">{team.domain} · {directory ? 'from your company directory' : 'from your calls and calendar'}</p>
        <h1>{team.name}</h1>
        <p className="lede">{lede}</p>
      </div>
      {act && <div className="tp-acts"><InvitePeople team={team} anchor={<Button variant="primary" icon="addUser">Invite people</Button>} /></div>}
    </header>
  );

  if (!others) {
    return (
      <>
        {head(firstLede(team, directory))}
        <div style={{ '--d': 1 }}><FirstHere team={team} directory={directory} me={me} meets={meets} /></div>
        <div className="tp-pair" style={{ '--d': 2 }}>{groups}{shared}</div>
      </>
    );
  }

  const yet = team.members.length - others;
  const inGroups = (prefs?.groups ?? []).filter((g) => g.emails.some((e) => sameEmail({ email: e }, me))).length;
  return (
    <>
      {head(lede(others + 1, yet, directory), team.members.some((m) => !m.onAlcove && !m.invited))}
      <div className="tp-grid" style={{ '--d': 1 }}>
        <div className="tp-main">
          <PeopleGrid me={me} members={team.members} meets={meets} inGroups={inGroups} now={now} />
          <NotOnAlcove team={team} directory={directory} meets={meets} />
        </div>
        <div className="tp-stack">{groups}{shared}<Minutes /></div>
      </div>
    </>
  );
}

/** "14 people use Alcove. 5 more are in your directory." */
function lede(on: number, yet: number, directory: boolean): string {
  const first = `${on} people use Alcove.`;
  if (!yet) return `${first} ${directory ? 'That’s everyone in your directory.' : 'That’s everyone you meet with here.'}`;
  if (directory) return `${first} ${yet} more ${yet === 1 ? 'is' : 'are'} in your directory.`;
  return `${first} ${yet} more you meet with ${yet === 1 ? 'isn’t' : 'aren’t'} on it yet.`;
}
/** "You're the first one here. 18 people from your directory can join." */
function firstLede(team: Team, directory: boolean): string {
  const n = team.members.length;
  if (!n) return `You’re the first one here. Colleagues at ${team.domain} you meet with show up here.`;
  if (directory) return `You’re the first one here. ${n} ${n === 1 ? 'person' : 'people'} from your directory can join.`;
  return `You’re the first one here. ${n} ${n === 1 ? 'colleague' : 'colleagues'} you meet with can join.`;
}

/** Rows shown before "Show all". */
const SHARES = 5;

/**
 * Notes shared with a group, newest share first, from the notes list: who shared each with which of
 * their groups, and when ("Priya shared it with Product · yesterday"). Each opens its note.
 */
function SharedWithGroups({ notes, me, now }: { notes: NoteSummary[]; me: Person; now: Date }) {
  const [all, setAll] = useState(false);
  const shares = groupShares(notes);
  return (
    <Card title="Shared with groups">
      {shares.length > 0 ? (
        <>
          <ul className="tp-shares">
            {(all ? shares : shares.slice(0, SHARES)).map((s) => (
              <li key={`${s.note.id} ${s.by.email} ${s.group}`}>
                <Link to="/notes/$noteId" params={{ noteId: s.note.id }} className="tp-shared">
                  <ArchThumb cover={coverFor(s.note.id)} room={s.note.kind === 'room'} width={26} />
                  <span className="min-w-0">
                    <b className="ac-clamp-1">{s.note.title}</b>
                    <small className="ac-clamp-2">{sameEmail(s.by, me) ? 'You' : callName(s.by)} shared it with {s.group} · {pastDay(s.at, now)}</small>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {shares.length > SHARES && (
            <div className="tp-more"><Button variant="quiet" size="sm" iconRight={all ? 'up' : 'down'} aria-expanded={all} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${shares.length}`}</Button></div>
          )}
        </>
      ) : (
        <EmptyState title="Nothing shared yet">Notes someone shares with a group show up here for everyone in it.</EmptyState>
      )}
    </Card>
  );
}

/** The minutes of notes left, and how many went this month. */
function Minutes() {
  const c = useQuery(q.balance()).data;
  if (!c) return null;
  const used = c.usedThisMonth / c.perMinute;
  return (
    <MinutesCard title="Your minutes" left={hoursAndMinutes(c.balance / c.perMinute)} share={c.balance / Math.max(1, c.granted)}
      used={`${used >= 1 ? `${hoursAndMinutes(used)} used this month.` : 'None used this month.'} Calls without notes are always free.`}>
      <div className="tp-foot"><Link to="/settings" hash="plan" className="lk tp-go">Usage and credits<Icon name="right" size={14} /></Link></div>
    </MinutesCard>
  );
}
