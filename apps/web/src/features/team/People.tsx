/*
 * Asking people onto Alcove: Invite people, Invite and Remind on someone, and the lists of who hasn't come yet. Alcove
 * sends no email itself: each of these opens your own mail app with an invitation, and marks them invited. Every
 * invitation carries your own invite link, whose page says it's from you (features/team/Invited.tsx), and so does Copy
 * link: until the link is here, they wait. Beside Copy link, a new link takes the place of the one you've sent, asked first.
 */
import { errorCode, errorMessage, type Person, type Team } from '@alcove/api';
import { Button, GhostArch, Icon, IconButton, PickList, Popover, TeamAsk, buttonClass, cn, useToast, type ButtonVariant, type PickRow } from '@alcove/ui';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useTeamAtThirdInvite } from '~/features/plans/teamDoor';
import { log } from '~/lib/log';
import { byEmail, callName, fold, isEmail, sameEmail, someNames, typedIn } from '~/lib/people';
import { useInviteLink as useOwnLink, useInviteTeam, useNewInviteLink } from './queries';
import { addressOnly, byMeetings, callLine, listed, type Meets, type Member } from './data';
import { useOpen, usePop } from './open';

const tlog = log.child({ component: 'team' });

/**
 * Your own invite link, once it's here (null until then): the address Copy invite link copies, and the one in every
 * invitation.
 */
const useInviteLink = (): string | null => useOwnLink().data?.link ?? null;

/**
 * An email from your own mail app, to `people`, asking them onto Alcove with your invite link; `again` for a reminder.
 * Addresses keep their @, everything else is encoded.
 */
function invitation(people: Person[], link: string, again = false): string {
  const to = people.map((p) => encodeURIComponent(p.email).replace(/%40/g, '@')).join(',');
  const subject = again ? 'A reminder: join me on Alcove' : 'Join me on Alcove';
  const body = `I use Alcove for our calls and their notes. Sign in with your work account here: ${link}`;
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
const OPENS = 'Opens your email with an invitation';
/** Said on what waits for your invite link, in the moment before it's here. */
export const LINK_ON_ITS_WAY = 'Getting your invite link';
/** Opens an email in your mail app: as following a link does, without leaving the page. */
function openEmail(href: string) {
  const a = document.createElement('a');
  a.href = href;
  a.click();
}

/**
 * Copies your invite link and says so, or shows it when the browser won't copy. `made`: it's a new link just made, so the
 * one before no longer works, which it says either way.
 */
export function useCopyInvite() {
  const toast = useToast();
  return async (link: string, made = false) => {
    try {
      await navigator.clipboard.writeText(link);
      toast(made ? 'New invite link copied. The old one no longer works.' : 'Invite link copied. It says it’s from you.', { icon: 'link' });
    } catch (e) {
      tlog.info('invite link shown instead of copied', { err: e, made });
      toast(<>{made ? 'The old link no longer works. Copy the new one: ' : 'Copy this link: '}<b>{link}</b></>, { icon: 'link', ms: 8000 });
    }
  };
}

const names = (people: Person[]) => someNames(people, 2);

/**
 * Marks people on your team invited (as their invitation opens in your email) and says so, or why not. An invite that makes
 * three of you, while you're on no team, offers Team beside it, once (features/plans/teamDoor.ts).
 */
function useMarkInvited() {
  const invite = useInviteTeam();
  const toast = useToast();
  const third = useTeamAtThirdInvite();
  return (people: Person[], others: Person[] = []) => {
    const offer = third(people.length + others.length);
    const opened = () => {
      toast(`Your email opens with an invitation to ${names([...people, ...others])}.`, { icon: 'mail' });
      offer();
    };
    if (!people.length) { opened(); return; }
    void invite.mutateAsync(people.map((p) => p.email)).then(opened, (e: unknown) => toast(errorMessage(e), { icon: 'x' }));
  };
}

/**
 * A link that opens your email with an invitation to `people` (`remind`: a reminder), and marks them invited. Until your
 * invite link is here it's the same button, waiting, so no invitation goes without it.
 */
export function InviteLink({ people, remind = false, variant = 'secondary', size = 'sm', icon = false, className, children }: {
  people: Person[]; remind?: boolean | undefined; variant?: ButtonVariant | undefined; size?: 'sm' | 'md' | undefined; icon?: boolean | undefined; className?: string | undefined; children: ReactNode;
}) {
  const mark = useMarkInvited();
  const toast = useToast();
  const link = useInviteLink();
  const said = <>{icon && <Icon name="mail" size={16} />}{children}</>;
  if (!link) return <Button variant={variant} size={size} className={className} disabled title={LINK_ON_ITS_WAY}>{said}</Button>;
  return (
    <a href={invitation(people, link, remind)} className={cn(buttonClass({ variant, size }), className)} title={OPENS}
      onClick={() => { if (remind) toast(`Your email opens with a reminder to ${names(people)}.`, { icon: 'mail' }); else mark(people); }}>
      {said}
    </a>
  );
}

/** Invite people: tick colleagues who aren't on Alcove yet, or type anyone's address, and your email opens with an invitation to them. Or copy your invite link. */
export function InvitePeople({ me, team, meets, now, anchor }: { me: Person; team: Team; meets: (email: string) => Meets; now: Date; anchor: ReactNode }) {
  const pop = usePop('invite');
  return (
    <Popover {...pop} anchor={anchor} align="center" caret label="Invite people" className="tp-pop is-list">
      <InviteList me={me} team={team} meets={meets} now={now} onClose={() => pop.onOpenChange(false)} />
    </Popover>
  );
}

function InviteList({ me, team, meets, now, onClose }: { me: Person; team: Team; meets: (email: string) => Meets; now: Date; onClose: () => void }) {
  const { setPicked: showPicked } = useOpen();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Person[]>([]);
  const mark = useMarkInvited();
  const copy = useCopyInvite();
  const link = useInviteLink();
  /* Make a new link? is asked in the list's place, which comes back as it was. */
  const [asking, setAsking] = useState(false);
  const typed = typedIn(query);
  const whole = isEmail(typed);
  const asked = [...team.members.filter((m) => !m.onAlcove && !m.invited)].sort(byMeetings(meets));
  const member = (email: string) => team.members.find((m) => sameEmail(m.person, { email }));
  const known = (email: string) => member(email) !== undefined;
  const yours = whole && sameEmail(me, { email: typed });
  const has = (p: { email: string }) => picked.some((x) => sameEmail(x, p));
  const row = (p: Person, sub: string | undefined): PickRow => ({ key: p.email, name: listed(p), sub, person: p, ghost: true, on: has(p) });
  const matches = (p: Person) => !typed || fold(p.name).includes(fold(typed)) || p.email.toLowerCase().includes(typed);

  /* A whole address counts as it's typed, a colleague's or anyone else's: finishing takes it too, so nobody has to press Enter first. */
  const offered = whole && !yours && !has({ email: typed }) ? asked.find((m) => sameEmail(m.person, { email: typed }))?.person ?? (known(typed) ? undefined : byEmail(typed)) : undefined;
  const rows = [
    ...picked.filter((p) => !known(p.email) && matches(p)).map((p) => row(p, 'New to you')),
    ...asked.filter((m) => matches(m.person)).map((m) => row(m.person, [m.title, callLine(meets(m.person.email), now)].filter(Boolean).join(' · ') || undefined))
  ];
  if (offered && !known(offered.email)) rows.unshift(row(offered, 'New to you'));
  const shown = rows.map((r) => (offered && sameEmail(r.person, offered) ? { ...r, on: true, typed: true } : r));
  const going = offered ? [...picked, offered] : picked;
  const someone = whole ? member(typed) : undefined;

  useEffect(() => {
    showPicked(picked.map((p) => p.email));
    return () => showPicked([]);
  }, [picked, showPicked]);

  const send = () => {
    if (!going.length || !link) return;
    openEmail(invitation(going, link));
    mark(going.filter((p) => known(p.email)), going.filter((p) => !known(p.email)));
    onClose();
  };
  if (asking) return <NewLinkAsk onKeep={() => setAsking(false)} onMade={onClose} />;
  return (
    <PickList label="Name or email" query={query} onQuery={setQuery} address={whole ? typed : undefined} rows={shown} ticks
      none={yours ? 'That’s you.' : someone ? `${callName(someone.person)} ${someone.onAlcove ? 'is on Alcove' : 'has been asked'}.`
        : typed ? 'Nobody here by that name. Type their address.' : !team.members.length ? 'Type their address.' : team.members.every((m) => m.onAlcove) ? 'Everyone here is on Alcove.' : 'Everyone here has been asked.'}
      onPress={(r) => setPicked((now) => (now.some((p) => sameEmail(p, r.person)) ? now.filter((p) => !sameEmail(p, r.person)) : [...now, r.person]))}
      onFinish={send}
      foot={<>
        <span className="tp-pop-fl">
          <Button variant="quiet" size="sm" icon="link" disabled={!link} title={link ? undefined : LINK_ON_ITS_WAY} onClick={() => { if (!link) return; onClose(); void copy(link); }}>Copy link</Button>
          <IconButton icon="retry" size={16} label="Make a new link" disabled={!link} onClick={() => setAsking(true)} />
        </span>
        <Button variant={going.length ? 'primary' : 'secondary'} size="sm" icon="mail" disabled={!going.length || !link} title={link ? OPENS : LINK_ON_ITS_WAY} onClick={send}>{going.length ? `Invite ${going.length}` : 'Invite'}</Button>
      </>} />
  );
}

/**
 * Make a new link?, asked in place in the popover: the link you've sent stops working, and who joined from it stays listed.
 * Yes makes it, copies it and says the old one no longer works; Cancel, or Escape, goes back to the list as it was.
 */
function NewLinkAsk({ onKeep, onMade }: { onKeep: () => void; onMade: () => void }) {
  const renew = useNewInviteLink();
  const copy = useCopyInvite();
  const toast = useToast();
  return (
    <TeamAsk className="tp-ask" title="Make a new link?" text="The link you’ve sent stops working. People who joined from it stay listed."
      confirm="Make a new link" keep="Cancel" busy={renew.isPending} onKeep={onKeep}
      onConfirm={() => renew.mutate(undefined, {
        onSuccess: (made) => { onMade(); void copy(made.link, true); },
        onError: (e) => { tlog.info('invite link not made again', { code: errorCode(e) }); toast(errorMessage(e), { icon: 'x' }); }
      })} />
  );
}

/** Someone not on Alcove yet, with Invite or Remind always in the same place. */
function Row({ member: m, line }: { member: Member; line: string | undefined }) {
  const p = m.person;
  return (
    <li className={cn('tp-r', m.invited && 'is-invited')}>
      <GhostArch size={32} initial={listed(p)} />
      <b className="ac-clamp-1">{listed(p)}</b>
      <span className="tp-r-s ac-clamp-1">{m.title ?? (addressOnly(p) ? undefined : p.email)}</span>
      <span className="tp-r-m">{m.invited ? <><Icon name="check" size={14} />Invited</> : line}</span>
      <InviteLink people={[p]} remind={m.invited} variant={m.invited ? 'quiet' : 'secondary'}>{m.invited ? 'Remind' : 'Invite'}</InviteLink>
    </li>
  );
}

/** Rows shown before "Show all". */
const ROWS = 5;

/** The colleagues not on Alcove yet (`people`, in the order they stand on the line), with Invite all while more than one hasn't been asked. */
export function NotOnAlcove({ people, meets, now }: { people: Member[]; meets: (email: string) => Meets; now: Date }) {
  const [all, setAll] = useState(false);
  const h = useId();
  const left = people.filter((m) => !m.invited);
  return (
    <section className="tp-s tp-yet" aria-labelledby={h}>
      <div className="tp-h">
        <h2 id={h}>Not on Alcove yet</h2>
        {left.length > 1 && <InviteLink people={left.map((m) => m.person)} variant="quiet" icon>Invite all {left.length}</InviteLink>}
      </div>
      <ul className="tp-rows">
        {(all ? people : people.slice(0, ROWS)).map((m) => <Row key={m.person.email} member={m} line={callLine(meets(m.person.email), now)} />)}
      </ul>
      {people.length > ROWS && (
        <div className="tp-more"><Button variant="quiet" size="sm" iconRight={all ? 'up' : 'down'} aria-expanded={all} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${people.length}`}</Button></div>
      )}
    </section>
  );
}

/** How many of the people you meet most show on your first day. */
const TOP = 4;

/** Nobody else at your company is on Alcove yet: the people you meet most, each with Invite, and Invite everyone. */
export function PeopleYouMeet({ team, people, directory, meets, now }: { team: Team; people: Member[]; directory: boolean; meets: (email: string) => Meets; now: Date }) {
  const h = useId();
  const top = people.slice(0, TOP);
  const left = people.filter((m) => !m.invited);
  const more = people.length - top.length;
  return (
    <section className="tp-s tp-yet" aria-labelledby={h}>
      <div className="tp-h">
        <h2 id={h}>People you meet most</h2>
        {left.length > 1 && <InviteLink people={left.map((m) => m.person)} variant="quiet" icon>Invite everyone</InviteLink>}
      </div>
      {top.length > 0
        ? <ul className="tp-rows">{top.map((m) => <Row key={m.person.email} member={m} line={callLine(meets(m.person.email), now)} />)}</ul>
        : <p className="tp-none">Colleagues at {team.domain} you have calls or meetings with show up here.</p>}
      {more > 0 && <p className="tp-yet-f">{more} more {directory ? 'in your directory' : `at ${team.domain}`}</p>}
    </section>
  );
}
