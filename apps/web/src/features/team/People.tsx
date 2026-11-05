/*
 * Asking people onto Alcove: Invite people, Invite and Remind on someone, and the lists of who hasn't come yet. Alcove
 * sends no email itself: each of these opens your own mail app with an invitation, and marks them invited.
 */
import { errorMessage, type Person, type Team } from '@alcove/api';
import { Button, GhostArch, Icon, Popover, buttonClass, cn, useToast, type ButtonVariant } from '@alcove/ui';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { PickList, type PickRow } from '~/features/people/PickList';
import { log } from '~/lib/log';
import { byEmail, fold, isEmail, sameEmail, someNames } from '~/lib/people';
import { useInviteTeam } from '~/lib/queries';
import { addressOnly, byMeetings, callLine, listed, type Meets, type Member } from './data';
import { useOpen, usePop } from './open';

const tlog = log.child({ component: 'team' });

/** Where people sign in: the address Copy invite link copies, and the one in every invitation. */
const signInPage = () => `${location.origin}/welcome`;

/**
 * An email from your own mail app, to `people`, asking them to sign in to Alcove; `again` for a reminder. Addresses keep
 * their @, everything else is encoded.
 */
function invitation(people: Person[], again = false): string {
  const to = people.map((p) => encodeURIComponent(p.email).replace(/%40/g, '@')).join(',');
  const subject = again ? 'A reminder: join me on Alcove' : 'Join me on Alcove';
  const body = `I use Alcove for our calls and their notes. Sign in with your work account here: ${signInPage()}`;
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
      toast('Invite link copied. It opens the page to sign in.', { icon: 'link' });
    } catch (e) {
      tlog.info('invite link shown instead of copied', { err: e });
      toast(<>Copy this link: <b>{signInPage()}</b></>, { icon: 'link', ms: 8000 });
    }
  };
}

const names = (people: Person[]) => someNames(people, 2);

/** Marks people on your team invited (as their invitation opens in your email) and says so, or why not. */
function useMarkInvited() {
  const invite = useInviteTeam();
  const toast = useToast();
  return (people: Person[], others: Person[] = []) => {
    const opened = () => toast(`Your email opens with an invitation to ${names([...people, ...others])}.`, { icon: 'mail' });
    if (!people.length) { opened(); return; }
    void invite.mutateAsync(people.map((p) => p.email)).then(opened, (e: unknown) => toast(errorMessage(e), { icon: 'x' }));
  };
}

/** A link that opens your email with an invitation to `people` (`remind`: a reminder), and marks them invited. */
export function InviteLink({ people, remind = false, variant = 'secondary', size = 'sm', icon = false, className, children }: {
  people: Person[]; remind?: boolean | undefined; variant?: ButtonVariant | undefined; size?: 'sm' | 'md' | undefined; icon?: boolean | undefined; className?: string | undefined; children: ReactNode;
}) {
  const mark = useMarkInvited();
  const toast = useToast();
  return (
    <a href={invitation(people, remind)} className={cn(buttonClass({ variant, size }), className)} title={OPENS}
      onClick={() => { if (remind) toast(`Your email opens with a reminder to ${names(people)}.`, { icon: 'mail' }); else mark(people); }}>
      {icon && <Icon name="mail" size={16} />}{children}
    </a>
  );
}

/** Invite people: tick colleagues who aren't on Alcove yet, or type anyone's address, and your email opens with an invitation to them. Or copy the link to sign in. */
export function InvitePeople({ team, meets, now, anchor }: { team: Team; meets: (email: string) => Meets; now: Date; anchor: ReactNode }) {
  const pop = usePop('invite');
  return (
    <Popover {...pop} anchor={anchor} align="center" caret label="Invite people" className="tp-pop is-list">
      <InviteList team={team} meets={meets} now={now} onClose={() => pop.onOpenChange(false)} />
    </Popover>
  );
}

function InviteList({ team, meets, now, onClose }: { team: Team; meets: (email: string) => Meets; now: Date; onClose: () => void }) {
  const { setPicked: showPicked } = useOpen();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Person[]>([]);
  const mark = useMarkInvited();
  const copy = useCopyInvite();
  const typed = query.trim().toLowerCase();
  const asked = [...team.members.filter((m) => !m.onAlcove && !m.invited)].sort(byMeetings(meets));
  const known = (email: string) => team.members.some((m) => sameEmail(m.person, { email }));
  const has = (p: Person) => picked.some((x) => sameEmail(x, p));
  const row = (p: Person, sub: string | undefined): PickRow => ({ key: p.email, name: listed(p), sub, person: p, ghost: true, on: has(p) });
  const matches = (p: Person) => !typed || fold(p.name).includes(fold(typed)) || p.email.toLowerCase().includes(typed);

  const rows = [
    ...picked.filter((p) => !known(p.email)).map((p) => row(p, 'New to you')),
    ...asked.filter((m) => matches(m.person)).map((m) => row(m.person, [m.title, callLine(meets(m.person.email), now)].filter(Boolean).join(' · ') || undefined))
  ];
  /* A whole address nobody here has, ready to tick: finishing takes it too, so nobody has to press Enter first. */
  const fresh = isEmail(typed) && !known(typed) && !picked.some((p) => sameEmail(p, { email: typed })) ? byEmail(typed) : undefined;
  if (fresh) rows.unshift(row(fresh, 'New to you'));
  const going = fresh ? [...picked, fresh] : picked;

  useEffect(() => {
    showPicked(picked.map((p) => p.email));
    return () => showPicked([]);
  }, [picked, showPicked]);

  const send = () => {
    if (!going.length) return;
    openEmail(invitation(going));
    mark(going.filter((p) => known(p.email)), going.filter((p) => !known(p.email)));
    onClose();
  };
  return (
    <PickList label="Name or email" query={query} onQuery={setQuery} rows={rows} ticks
      none={typed ? 'Nobody here by that name. Type their address.' : asked.length || !team.members.length ? 'Type their address.' : 'Everyone here has been asked.'}
      onPress={(r) => { setPicked((now) => (now.some((p) => sameEmail(p, r.person)) ? now.filter((p) => !sameEmail(p, r.person)) : [...now, r.person])); if (r.person === fresh) setQuery(''); }}
      onFinish={send}
      foot={<>
        <Button variant="quiet" size="sm" icon="link" onClick={() => { onClose(); void copy(); }}>Copy link</Button>
        <Button variant={going.length ? 'primary' : 'secondary'} size="sm" icon="mail" disabled={!going.length} title={OPENS} onClick={send}>{going.length ? `Invite ${going.length}` : 'Invite'}</Button>
      </>} />
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
      <span className="tp-r-m ac-clamp-1">{m.invited ? <><Icon name="check" size={14} />Invited</> : line}</span>
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
