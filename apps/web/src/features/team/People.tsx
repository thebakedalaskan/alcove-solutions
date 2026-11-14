/*
 * Asking people onto your team (the design's 4.1): Invite people, Invite on someone's row or in their popover, Invite all,
 * and the lists of who isn't on it yet. Alcove sends each invitation (invitations/send.ts). On a company page with no team the
 * first one starts the team, free, with you as its admin, so there every Invite opens Invite people with its people ticked,
 * where that's said before anything is sent. While an invitation to you waits there, nothing offers to start another team:
 * Invite people says to join it first, with its Join, and an Invite on a row goes to its card. Someone invited already shows
 * Invited, and picking them sends theirs again when it's yours to send and Alcove would send it now; otherwise it says why.
 * Copy link copies the team's invite link (yours while you're on no team), and beside it the admin, or someone on no team,
 * can make a new one in its place, asked first.
 */
import { errorCode, errorMessage, firstName, type InvitationForYou, type MyTeam, type Person, type Team, type TeamInvitation } from '@alcove/api';
import { Avatar, Button, GhostArch, JoinFirst, PickList, Popover, TeamAsk, useToast, type ButtonVariant, type PickRow } from '@alcove/ui';
import { createContext, useContext, useEffect, useId, useState, type ReactNode } from 'react';
import { log } from '~/lib/log';
import { byEmail, callName, fold, isEmail, sameEmail, typedIn } from '~/lib/people';
import { useInviteLink, useNewInviteLink } from './queries';
import { addressOnly, byMeetings, callLine, listed, type Meets, type Member } from './data';
import { invitationOf, resendable, useSendInvitations } from './invitations/send';
import { resendWaits } from './invitations/words';
import { INVITE, useOpen, usePop } from './open';

const tlog = log.child({ component: 'team' });
const NOBODY: readonly Person[] = [];

/** Said on what waits for the invite link, in the moment before it's here. */
export const LINK_ON_ITS_WAY = 'Getting your invite link';

/** The team's name, or the name inviting will give it: the company's, or, at a personal address, yours. */
export const teamNameFor = (mine: MyTeam | null | undefined, company: Team | null | undefined, me: Person): string =>
  mine?.name ?? company?.name ?? `${firstName(me.name)}’s team`;

/** What inviting does on the Team page, as the page knows it (TeamPage.tsx). */
export interface Inviting {
  me: Person;
  company: Team | undefined;
  /** The team you're on; with none, inviting starts one. */
  mine: MyTeam | null | undefined;
  meets: (email: string) => Meets;
  now: Date;
  /** With no team, the newest invitation to you not put aside: then nothing here starts a team. */
  waiting: InvitationForYou | null;
  /** Goes to that invitation's card, and its Join. */
  toCard: (i: InvitationForYou) => void;
  /** Joins it. */
  join: (i: InvitationForYou) => void;
  /** Inviting is about to start your team: the team's page, which takes this one's place, takes the focus at its name. */
  starting: () => void;
}
export const InvitingContext = createContext<Inviting | null>(null);

/**
 * Copies the invite link and says so, or shows it when the browser won't copy. `team`: the team it joins, while you're on
 * one. `made`: it's a new link just made, so the one before no longer works, which it says either way.
 */
export function useCopyInvite() {
  const toast = useToast();
  return async (link: string, { team, made = false }: { team?: string | undefined; made?: boolean | undefined } = {}) => {
    try {
      await navigator.clipboard.writeText(link);
      toast(made ? 'New invite link copied. The old one no longer works.' : team ? `Invite link copied. Whoever opens it can join ${team}.` : 'Invite link copied. It says it’s from you.', { icon: 'link' });
    } catch (e) {
      tlog.info('invite link shown instead of copied', { err: e, made });
      toast(<>{made ? 'The old link no longer works. Copy the new one: ' : 'Copy this link: '}<b>{link}</b></>, { icon: 'link', ms: 8000 });
    }
  };
}

/**
 * Invite, for `people` (a row's Invite, Invite all): on a team, Alcove sends them their invitations at once, and anyone
 * invited already is sent theirs again when it's yours to send (Resend). On no team it opens Invite people with them ticked
 * (`name` tells its popover from the others on the page), since inviting starts the team; and while an invitation to you
 * waits, it goes to that invitation's card instead. `onSent`: once it has sent.
 */
export function InviteButton({ people, name, variant = 'secondary', size = 'sm', icon = false, className, onSent, children }: {
  people: readonly Person[]; name: string; variant?: ButtonVariant | undefined; size?: 'sm' | 'md' | undefined; icon?: boolean | undefined; className?: string | undefined;
  onSent?: (() => void) | undefined; children: ReactNode;
}) {
  const ctx = useContext(InvitingContext);
  const { send, busy } = useSendInvitations();
  const [going, setGoing] = useState(false);
  const look = { variant, size, className, icon: icon ? 'mail' as const : undefined };
  if (ctx && !ctx.mine) {
    const waiting = ctx.waiting;
    if (waiting) return <Button {...look} onClick={() => ctx.toCard(waiting)}>{children}</Button>;
    return <InvitePeople name={`invite ${name}`} seed={people} anchor={<Button {...look} aria-haspopup="dialog">{children}</Button>} />;
  }
  const mine = ctx?.mine ?? null;
  const again = people.flatMap((p) => { const i = invitationOf(mine, p.email); return i && resendable(i) ? [i] : []; });
  const fresh = people.filter((p) => !invitationOf(mine, p.email));
  return (
    <Button {...look} loading={going} disabled={(busy && !going) || (!fresh.length && !again.length)}
      onClick={() => {
        setGoing(true);
        void send(fresh, again).finally(() => { setGoing(false); onSent?.(); });
      }}>
      {children}
    </Button>
  );
}

/**
 * Invite people: tick people at your company who aren't on the team, or type anyone's whole address. Alcove sends each an
 * invitation. Or copy the invite link. The sky's opens with whoever it's opened for ticked (`inviteWith`); a row's Invite
 * opens its own (`name`, `seed`).
 */
export function InvitePeople({ anchor, name = INVITE, seed }: { anchor: ReactNode; name?: string | undefined; seed?: readonly Person[] | undefined }) {
  const ctx = useContext(InvitingContext);
  const pop = usePop(name);
  const { seed: sky, seeded } = useOpen();
  /* Make a new link? is asked in the list's place; Escape, or Cancel, comes back to the list as it was. */
  const [asking, setAsking] = useState(false);
  const opened = (on: boolean) => { if (!on) setAsking(false); pop.onOpenChange(on); };
  if (!ctx) return anchor;
  return (
    <Popover open={pop.open} onOpenChange={opened} anchor={anchor} align="center" caret label={`Invite people to ${teamNameFor(ctx.mine, ctx.company, ctx.me)}`} className="tp-pop is-list"
      onEscapeKeyDown={(e) => { if (asking) { e.preventDefault(); setAsking(false); } }}>
      <InviteList ctx={ctx} seed={seed ?? (name === INVITE ? sky : NOBODY)} onSeeded={name === INVITE ? seeded : undefined}
        asking={asking} onAsking={setAsking} onClose={() => opened(false)} />
    </Popover>
  );
}

function InviteList({ ctx, seed, onSeeded, asking, onAsking, onClose }: {
  ctx: Inviting; seed: readonly Person[]; onSeeded: (() => void) | undefined; asking: boolean; onAsking: (on: boolean) => void; onClose: () => void;
}) {
  const { me, company, mine, meets, now, waiting } = ctx;
  const { setPicked: showPicked } = useOpen();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Person[]>(() => [...seed]);
  const { send, busy } = useSendInvitations();
  const copy = useCopyInvite();
  const link = useInviteLink().data?.link ?? null;
  const noteId = useId();
  const name = teamNameFor(mine, company, me);
  /* An invitation to you waits and you're on no team: join it first, and nothing here starts another. */
  const holding = !mine && waiting !== null;
  const typed = typedIn(query);
  const whole = isEmail(typed);
  const onTeam = (email: string) => mine?.members.some((m) => sameEmail(m.person, { email })) === true;
  const yours = whole && sameEmail(me, { email: typed });
  const has = (p: { email: string }) => picked.some((x) => sameEmail(x, p));
  /* Whoever it opened for, ticked, stands first, where they're seen; the list doesn't move as you tick anyone else. */
  const [opened] = useState(() => seed.map((p) => p.email.toLowerCase()));
  const first = (m: Member) => (opened.includes(m.person.email.toLowerCase()) ? 0 : 1);
  /* The people at your company who aren't on the team, the ones you meet most first. */
  const meetsMost = byMeetings(meets);
  const colleagues = (company?.members ?? []).filter((m) => !onTeam(m.person.email) && !sameEmail(m.person, me)).sort((a, b) => first(a) - first(b) || meetsMost(a, b));
  const asked = (p: Person): TeamInvitation | undefined => invitationOf(mine, p.email);
  /* Why someone invited can't be picked: it's someone else's to send, or Alcove makes it wait. */
  const why = (p: Person): string | undefined => {
    const i = asked(p);
    if (!i) return undefined;
    if (!i.manage) return `Invited by ${callName(i.invitedBy)}`;
    return resendWaits(i, now.getTime()) ?? undefined;
  };
  const subOf = (m: Member) => [m.title, callLine(meets(m.person.email), now)].filter(Boolean).join(' · ') || undefined;
  const row = (p: Person, sub: string | undefined, ghost: boolean): PickRow => {
    const i = asked(p);
    const resend = i !== undefined && resendable(i);
    return {
      key: p.email, name: listed(p), sub, person: p, ghost, on: has(p), tag: i ? 'Invited' : undefined, unavailable: why(p),
      label: resend ? `Resend ${listed(p)}’s invitation` : i ? listed(p) : `Invite ${listed(p)}`
    };
  };
  const matches = (p: Person) => !typed || fold(p.name).includes(fold(typed)) || p.email.toLowerCase().includes(typed);
  const known = (email: string) => colleagues.some((m) => sameEmail(m.person, { email }));

  /* A whole address counts as it's typed, a colleague's or anyone else's: finishing takes it too, so nobody has to press Enter first. */
  const found = whole && !yours && !onTeam(typed) && !has({ email: typed })
    ? colleagues.find((m) => sameEmail(m.person, { email: typed }))?.person ?? byEmail(typed) : undefined;
  /* One that can't be picked (someone else's invitation, or one that waits) is shown, saying why, and isn't taken. */
  const offered = found && why(found) === undefined ? found : undefined;
  const rows = [
    ...picked.filter((p) => !known(p.email) && matches(p)).map((p) => row(p, 'New to you', true)),
    ...colleagues.filter((m) => matches(m.person)).map((m) => row(m.person, subOf(m), !m.onAlcove))
  ];
  if (found && !known(found.email)) rows.unshift(row(found, 'New to you', true));
  const shown = rows.map((r) => (offered && sameEmail(r.person, offered) ? { ...r, on: true, typed: true } : r));
  const going = offered ? [...picked, offered] : picked;
  const resending = going.filter((p) => asked(p) !== undefined);
  const onlyAgain = going.length > 0 && resending.length === going.length;
  const member = whole ? mine?.members.find((m) => sameEmail(m.person, { email: typed })) : undefined;

  useEffect(() => {
    showPicked(picked.map((p) => p.email));
    return () => showPicked([]);
  }, [picked, showPicked]);
  useEffect(() => { onSeeded?.(); }, [onSeeded]);

  const finish = () => {
    if (!going.length || busy) return;
    const again = going.flatMap((p) => { const i = asked(p); return i ? [i] : []; });
    if (!mine) ctx.starting();
    void send(going.filter((p) => !asked(p)), again);
    onClose();
  };
  if (asking) return <NewLinkAsk team={mine?.name} onKeep={() => onAsking(false)} onMade={onClose} />;
  if (holding && waiting) {
    return (
      <JoinFirst person={waiting.from} title={`${callName(waiting.from)} invited you to ${waiting.team.name}.`} line="Join it, then invite people from its page."
        action={(
          <Button variant="primary" size="sm" autoFocus onClick={() => { onClose(); ctx.join(waiting); }}>
            <span className="ac-clamp-1">Join {waiting.team.name}</span>
          </Button>
        )} />
    );
  }
  /* Only the team's admin makes a new link for it; on no team, it's yours. */
  const renew = !mine || mine.role === 'admin';
  const note = mine ? undefined : `Alcove emails them. This starts ${name}, a free team, with you as its admin.`;
  return (
    <PickList label="Name or email" query={query} onQuery={setQuery} address={whole ? typed : undefined} rows={shown} ticks note={note} noteId={noteId}
      none={yours ? 'That’s you.' : member ? `${member.you ? 'You’re' : `${callName(member.person)} is`} on ${name}.`
        : typed ? 'Nobody here by that name. Type their address.' : !colleagues.length ? 'Type their address.' : 'Everyone here is on the team.'}
      onPress={(r) => setPicked((now) => (now.some((p) => sameEmail(p, r.person)) ? now.filter((p) => !sameEmail(p, r.person)) : [...now, r.person]))}
      onFinish={finish}
      foot={(
        <>
          <span className="tp-pop-fl">
            <Button variant="quiet" size="sm" icon="link" disabled={!link} title={link ? undefined : LINK_ON_ITS_WAY}
              onClick={() => { if (!link) return; onClose(); void copy(link, { team: mine?.name }); }}>Copy link</Button>
            {renew && <Button variant="quiet" size="sm" disabled={!link} onClick={() => onAsking(true)}>New link</Button>}
          </span>
          <Button variant={going.length ? 'primary' : 'secondary'} size="sm" icon="send" disabled={!going.length} loading={busy} onClick={finish}
            aria-describedby={note ? noteId : undefined}>
            {!going.length ? 'Invite' : onlyAgain ? `Resend ${going.length}` : `Invite ${going.length}`}
          </Button>
        </>
      )} />
  );
}

/**
 * Make a new link?, asked in place in the popover: the link that's out there stops working, for everyone who has it. Yes
 * makes it, copies it and says the old one no longer works; Cancel, or Escape, goes back to the list as it was.
 */
function NewLinkAsk({ team, onKeep, onMade }: { team: string | undefined; onKeep: () => void; onMade: () => void }) {
  const renew = useNewInviteLink();
  const copy = useCopyInvite();
  const toast = useToast();
  return (
    <TeamAsk className="tp-ask" title="Make a new link?" text={team ? `${team}’s link stops working, for everyone who has it.` : 'The link you’ve sent stops working.'}
      confirm="Make a new link" keep="Cancel" busy={renew.isPending} onKeep={onKeep}
      onConfirm={() => renew.mutate(undefined, {
        onSuccess: (made) => { onMade(); void copy(made.link, { team, made: true }); },
        onError: (e) => { tlog.info('invite link not made again', { code: errorCode(e) }); toast(errorMessage(e), { icon: 'x' }); }
      })} />
  );
}

/** Someone to invite: their arch (empty while they're not on Alcove yet), who they are, and Invite always in the same place. */
function Row({ member: m, line }: { member: Member; line: string | undefined }) {
  const p = m.person;
  return (
    <li className="tp-r">
      {m.onAlcove ? <Avatar person={p} size={32} /> : <GhostArch size={32} initial={listed(p)} />}
      <b className="ac-clamp-1">{listed(p)}</b>
      <span className="tp-r-s ac-clamp-1">{m.title ?? (addressOnly(p) ? undefined : p.email)}</span>
      <span className="tp-r-m">{line}</span>
      <InviteButton people={[p]} name={p.email}>Invite</InviteButton>
    </li>
  );
}

/** Rows shown before "Show all". */
const ROWS = 5;

/**
 * People at your company to invite (`people`, in the order they stand on the line): on a company page, those not on Alcove
 * yet; on a team's, those not on it yet. Invite all while more than one is there.
 */
export function PeopleToInvite({ title, people, meets, now }: { title: string; people: Member[]; meets: (email: string) => Meets; now: Date }) {
  const [all, setAll] = useState(false);
  const h = useId();
  return (
    <section className="tp-s tp-yet" aria-labelledby={h}>
      <div className="tp-h">
        <h2 id={h}>{title}</h2>
        {people.length > 1 && <InviteButton people={people.map((m) => m.person)} name="all" variant="quiet" icon>Invite all {people.length}</InviteButton>}
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
  const more = people.length - top.length;
  return (
    <section className="tp-s tp-yet" aria-labelledby={h}>
      <div className="tp-h">
        <h2 id={h}>People you meet most</h2>
        {people.length > 1 && <InviteButton people={people.map((m) => m.person)} name="everyone" variant="quiet" icon>Invite everyone</InviteButton>}
      </div>
      {top.length > 0
        ? <ul className="tp-rows">{top.map((m) => <Row key={m.person.email} member={m} line={callLine(meets(m.person.email), now)} />)}</ul>
        : <p className="tp-none">Colleagues at {team.domain} you have calls or meetings with show up here.</p>}
      {more > 0 && <p className="tp-yet-f">{more} more {directory ? 'in your directory' : `at ${team.domain}`}</p>}
    </section>
  );
}
