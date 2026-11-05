/*
 * The people on the Team page: cards for everyone on Alcove (and, filtered, the colleagues invited or not
 * yet), the colleagues not on Alcove yet with Invite, the first-one-here card and the personal-account
 * card. Start a call opens Start a call with that person picked; Notes with lists the notes you both have.
 * Inviting opens your own email with an invitation to them, and marks them invited.
 */
import { errorMessage, type Person, type PersonSuggestion, type SignInProvider, type Team } from '@alcove/api';
import { Avatar, Button, Card, Chip, EmptyState, GhostArch, Icon, IconButton, PersonCard, Segmented, buttonClass, useToast, type ButtonVariant, type Choice } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { PeoplePicker } from '~/features/people/PeoplePicker';
import { useCallFlow } from '~/features/shell/context';
import { log } from '~/lib/log';
import { callName, listNames } from '~/lib/people';
import { useInviteTeam } from '~/lib/queries';
import { addressOnly, byMeetings, callLine, listed, monthLine, type Meets, type Member } from './data';

const tlog = log.child({ component: 'team' });

/** Where people sign in: the address Copy invite link copies, and the one in every invitation. */
const signInPage = () => `${location.origin}/welcome`;

/**
 * An email from your own mail app, to `people` (or to whoever you add, when there's nobody yet), asking
 * them to sign in to Alcove; `again` for a reminder. Addresses keep their @, everything else is encoded.
 */
function invitation(people: Person[], { again = false, work = true }: { again?: boolean; work?: boolean } = {}): string {
  const to = people.map((p) => encodeURIComponent(p.email).replace(/%40/g, '@')).join(',');
  const subject = again ? 'A reminder: join me on Alcove' : 'Join me on Alcove';
  const body = `I use Alcove for our calls and their notes. Sign in${work ? ' with your work account' : ''} here: ${signInPage()}`;
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
const OPENS = 'Opens your email with an invitation';
/** Opens an email in your mail app: as following a link does, without leaving the page. */
function openEmail(href: string) {
  const a = document.createElement('a');
  a.href = href;
  a.click();
}

/** Copies the sign-in page's address, or shows it when the browser won't copy. */
export function useCopyInvite() {
  const toast = useToast();
  return async () => {
    try {
      await navigator.clipboard.writeText(signInPage());
      toast('Invite link copied: it opens the page to sign in to Alcove.', { icon: 'link' });
    } catch (e) {
      tlog.info('invite link shown instead of copied', { err: e });
      toast(<>Copy this link: <b>{signInPage()}</b></>, { icon: 'link', ms: 8000 });
    }
  };
}

/** Marks people invited in Alcove (as their invitation opens in your email) and says so, or why not. A reminder says nothing more. */
function useMarkInvited() {
  const invite = useInviteTeam();
  const toast = useToast();
  return (people: Person[], remind = false) => {
    void invite.mutateAsync(people.map((p) => p.email)).then(
      () => { if (!remind) toast(`Marked ${people.length > 3 ? `${people.length} people` : listNames(people)} as invited.`, { icon: 'mail' }); },
      (e: unknown) => toast(errorMessage(e), { icon: 'x' })
    );
  };
}

/** A button that opens your email with an invitation to `people` (`remind`: a reminder), and marks them invited. */
function InviteLink({ people, remind = false, variant = 'secondary', icon, className, children }: {
  people: Person[]; remind?: boolean | undefined; variant?: ButtonVariant | undefined; icon?: boolean | undefined; className?: string | undefined; children: ReactNode;
}) {
  const mark = useMarkInvited();
  return (
    <a href={invitation(people, { again: remind })} className={className ?? buttonClass({ variant, size: 'sm' })} title={OPENS} onClick={() => mark(people, remind)}>
      {icon && <Icon name="mail" size={16} />}{children}
    </a>
  );
}

/** Invite people: pick colleagues who aren't on Alcove yet (an invitation to them opens in your email), or copy the link to sign in. */
export function InvitePeople({ team, anchor, align = 'end' }: { team: Team; anchor: ReactNode; align?: 'start' | 'end' | undefined }) {
  const [open, setOpen] = useState(false);
  const mark = useMarkInvited();
  const copy = useCopyInvite();
  const from = team.members.filter((m) => !m.onAlcove && !m.invited).map((m): PersonSuggestion => ({ person: m.person, source: 'team', onAlcove: false }));
  return (
    <PeoplePicker open={open} onOpenChange={setOpen} anchor={anchor} align={align} title="Invite people to Alcove" cta="Invite" skip={[]} from={from}
      note={`${OPENS} to sign in with their work account.`}
      after={<div className="pick-have tp-pick-link"><Icon name="link" size={15} /><span>Or send anyone the link to sign in.</span><button type="button" className="lk" onClick={() => void copy()}>Copy link</button></div>}
      onDone={(people) => { openEmail(invitation(people)); mark(people); }} />
  );
}

/** Someone in a list with what you can do at the end: their arch, name and a line about them. */
function PersonRow({ person, about, end }: { person: Person; about?: string | undefined; end: ReactNode }) {
  return (
    <div className="tp-dir">
      <Avatar person={person} size={38} />
      <span className="min-w-0"><b className="ac-clamp-1">{listed(person)}</b>{about ? <small className="ac-clamp-1">{about}</small> : null}</span>
      <div className="tp-dir-acts">{end}</div>
    </div>
  );
}
/** "Engineering · 3 meetings this month" */
const aboutMember = (m: Member, meets: Meets) => [m.title, monthLine(meets)].filter((s) => s !== undefined).join(' · ') || undefined;

type Show = 'on' | 'invited' | 'yet';
/** Cards shown before "Show all". */
const CARDS = 8;

/** Your team as cards: you first, then whoever you've met with most recently. Filter to who's invited or not yet. */
export function PeopleGrid({ me, members, meets, inGroups, now }: { me: Person; members: Member[]; meets: (email: string) => Meets; inGroups: number; now: Date }) {
  const [show, setShow] = useState<Show>('on');
  const [all, setAll] = useState(false);
  const recency = (m: Member) => { const x = meets(m.person.email); return x.next ? Number.MAX_SAFE_INTEGER - new Date(x.next).getTime() : x.last ? new Date(x.last).getTime() : 0; };
  const on = members.filter((m) => m.onAlcove).sort((a, b) => recency(b) - recency(a) || listed(a.person).localeCompare(listed(b.person)));
  const invited = members.filter((m) => !m.onAlcove && m.invited).sort(byMeetings(meets));
  const yet = members.filter((m) => !m.onAlcove && !m.invited).sort(byMeetings(meets));
  const count: Record<Show, number> = { on: on.length + 1, invited: invited.length, yet: yet.length };
  const view: Show = count[show] > 0 ? show : 'on';
  const options = ([
    { value: 'on', label: `On Alcove ${count.on}` },
    { value: 'invited', label: `Invited ${count.invited}` },
    { value: 'yet', label: `Not yet ${count.yet}` }
  ] satisfies Choice<Show>[]).filter((o) => count[o.value] > 0);

  const card = (m: Member) => <MemberCard key={m.person.email} member={m} line={callLine(meets(m.person.email), now)} />;
  const cards = view === 'on'
    ? [
      <PersonCard key="you" person={me} title={me.email} tag="You" last={inGroups ? `In ${inGroups} ${inGroups === 1 ? 'group' : 'groups'}` : undefined}
        actions={<Link to="/settings" className="ac-icon-btn" aria-label="Your settings" title="Your settings"><Icon name="settings" size={17} /></Link>} />,
      ...on.map(card)
    ]
    : (view === 'invited' ? invited : yet).map(card);

  return (
    <section aria-labelledby="tp-people">
      <div className="tp-tools">
        <h3 id="tp-people">People</h3>
        {options.length > 1 && <Segmented<Show> value={view} onChange={(v) => { setShow(v); setAll(false); }} options={options} label="People to show" />}
      </div>
      <div className="tp-ppl">{all ? cards : cards.slice(0, CARDS)}</div>
      {cards.length > CARDS && (
        <div className="tp-more"><Button variant="quiet" size="sm" iconRight={all ? 'up' : 'down'} aria-expanded={all} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${cards.length}`}</Button></div>
      )}
    </section>
  );
}

/**
 * Someone on your team: Start a call (with them picked), the notes you both have, and while they're
 * not on Alcove and not invited, Invite. The notes link names them in the address's fragment, which never
 * leaves the browser, so their address isn't sent to the web host.
 */
function MemberCard({ member: m, line }: { member: Member; line: string }) {
  const flow = useCallFlow();
  const mark = useMarkInvited();
  const name = callName(m.person);
  return (
    <PersonCard person={m.person} title={m.title ?? (addressOnly(m.person) ? undefined : m.person.email)} last={line}
      actions={<>
        <IconButton icon="video" size={17} label={`Start a call with ${name}`} aria-haspopup="dialog" onClick={() => flow.start({ people: [m.person] })} />
        <Link to="/notes" hash={`with=${encodeURIComponent(m.person.email)}`} className="ac-icon-btn" aria-label={`Notes with ${name}`} title={`Notes with ${name}`}><Icon name="notes" size={17} /></Link>
        {!m.onAlcove && !m.invited && (
          <a href={invitation([m.person])} className="ac-icon-btn" aria-label={`Invite ${name} to Alcove`} title={`Invite ${name}: ${OPENS.toLowerCase()}`} onClick={() => mark([m.person])}>
            <Icon name="addUser" size={17} />
          </a>
        )}
      </>} />
  );
}

/** Rows shown before "Show all". */
const ROWS = 5;

/** The colleagues not on Alcove yet: Invite (or Invite all), and for the ones already invited, Remind. Each opens your email. */
export function NotOnAlcove({ team, directory, meets }: { team: Team; directory: boolean; meets: (email: string) => Meets }) {
  const [all, setAll] = useState(false);
  const order = byMeetings(meets);
  const asked = team.members.filter((m) => !m.onAlcove && !m.invited).sort(order);
  const rows = [...asked, ...team.members.filter((m) => !m.onAlcove && m.invited).sort(order)];
  if (!rows.length) return null;
  return (
    <Card title="Not on Alcove yet"
      aside={asked.length > 1 ? <InviteLink people={asked.map((m) => m.person)} icon>Invite all {asked.length}</InviteLink> : undefined}>
      <p className="tp-lead">{directory ? 'From your directory.' : `People at ${team.domain} you meet with.`} Invite opens your email with an invitation to sign in. Anyone you invite to a call gets its notes, whether or not they use Alcove.</p>
      <div className="tp-dirs">
        {(all ? rows : rows.slice(0, ROWS)).map((m) => (
          <PersonRow key={m.person.email} person={m.person} about={aboutMember(m, meets(m.person.email))}
            end={m.invited
              ? <><Chip tone="outline" icon="check">Invited</Chip><InviteLink people={[m.person]} remind variant="quiet">Remind</InviteLink></>
              : <InviteLink people={[m.person]}>Invite</InviteLink>} />
        ))}
      </div>
      {rows.length > ROWS && (
        <div className="tp-more"><Button variant="quiet" size="sm" iconRight={all ? 'up' : 'down'} aria-expanded={all} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</Button></div>
      )}
    </Card>
  );
}

/**
 * Nobody else at your company is on Alcove yet: you in the arch with empty arches for the people you meet
 * most, Invite people and Copy invite link, and those people, each with Invite.
 */
export function FirstHere({ team, directory, me, meets }: { team: Team; directory: boolean; me: Person; meets: (email: string) => Meets }) {
  const copy = useCopyInvite();
  const people = [...team.members].sort(byMeetings(meets));
  const top = people.slice(0, 4);
  const asked = people.filter((m) => !m.invited);
  const more = people.length - top.length;
  return (
    <section className="ac-card tp-wide" aria-label="Bring your team to Alcove">
      <EmptyState className="tp-hero" title="Bring your team to Alcove"
        art={(
          <div className="tp-ghosts" aria-hidden="true">
            <span className="tp-you"><Avatar person={me} size={56} /></span>
            {top.map((m) => <GhostArch key={m.person.email} size={56} initial={listed(m.person)} />)}
          </div>
        )}
        action={<>
          {asked.length > 0 && <InvitePeople team={team} align="start" anchor={<Button variant="primary" icon="addUser">Invite people</Button>} />}
          <Button icon="link" onClick={() => void copy()}>Copy invite link</Button>
        </>}>
        Invite the people you meet with. They sign in with their work account, and notes from the calls you share land with everyone invited.
      </EmptyState>
      <div>
        <div className="tp-rowhead">
          <h3>People you meet most</h3>
          {top.some((m) => meets(m.person.email).month > 0) && <span>From your calendar</span>}
        </div>
        {top.length > 0 ? (
          <div className="tp-dirs">
            {top.map((m) => (
              <PersonRow key={m.person.email} person={m.person} about={aboutMember(m, meets(m.person.email))}
                end={m.invited ? <Chip tone="outline" icon="check">Invited</Chip> : <InviteLink people={[m.person]}>Invite</InviteLink>} />
            ))}
          </div>
        ) : <p className="tp-hint tp-none">Colleagues at {team.domain} you have calls or meetings with show up here.</p>}
        {(more > 0 || asked.length > 1) && (
          <div className="tp-foot">
            <span>{more > 0 ? `${more} more ${directory ? 'in your directory' : `at ${team.domain}`}` : ''}</span>
            {asked.length > 1 && <InviteLink people={asked.map((m) => m.person)} className="lk">Invite everyone</InviteLink>}
          </div>
        )}
      </div>
    </section>
  );
}

const PROVIDER: Record<SignInProvider, string> = { google: 'Google', microsoft: 'Microsoft', sso: 'single sign-on' };

/** A personal account has no team: you, two empty arches, and a way to ask people to join by email. */
export function JustYou({ me, provider }: { me: Person; provider: SignInProvider }) {
  const copy = useCopyInvite();
  return (
    <section className="ac-card tp-solo" aria-label="Your team">
      <EmptyState title="Just you, for now"
        art={<div className="tp-ghosts" aria-hidden="true"><Avatar person={me} size={44} /><GhostArch size={44} /><GhostArch size={44} /></div>}
        action={<>
          <a href={invitation([], { work: false })} className={buttonClass({ size: 'sm' })} title={OPENS}><Icon name="addUser" size={16} />Invite people</a>
          <Button variant="quiet" size="sm" icon="link" onClick={() => void copy()}>Copy invite link</Button>
        </>}>
        You signed in with a personal {PROVIDER[provider]} account, so there’s no company directory. Invite people by email.
      </EmptyState>
    </section>
  );
}
