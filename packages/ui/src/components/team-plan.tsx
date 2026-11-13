/*
 * Team, on a plan, and joining one by its link (docs/design/pages.md › Team; the canvas's TeamPlan and Join boards in
 * docs/design/canvas/plans/). The team stands on the horizon, each person in their arch under their license (TeamLine). On
 * the water, its people as rows (TeamPersonRow) in a section (TeamSection) with a foot (TeamFoot), Remove asked in place
 * under a row (TeamAsk), and the notes made visible to the team (TeamNotesList). Beside them, for the team's admin, the
 * licenses left with Buy licenses and buying one when it's needed (LicensesCard), and a one-time link to invite someone
 * (TeamInvite, which checkout's Done shows too). Not on a team, a quiet row starts one (TeamStartRow). Joining is one card
 * (JoinCard) on the team's evening (JoinEvening).
 *
 * Every part is stateless: plain data in, handlers out, the words as the app puts them. styles/team-plan.css (`tq-` the
 * page, `tj-` joining).
 */
import { useId, type ComponentPropsWithRef, type ReactElement, type ReactNode, type Ref } from 'react';
import { cn } from '../cn';
import { Logo } from './brand';
import { EmptyState } from './empty';
import { Horizon } from './horizon';
import { Icon, type IconName } from './icon';
import { Avatar, Faces, GhostArch, type AvatarPerson } from './people';
import { Button, Switch } from './primitives';

/** Whether there's something to show: not nothing, false or an empty string. */
const has = (x: ReactNode): boolean => x !== undefined && x !== null && x !== false && x !== '';

/**
 * A license as the team's page says it: live until a day (`live`), needed when none was left (`waiting`, in caution),
 * run out (`ended`, quiet), or never had one (`none`).
 */
export type TeamLicenseTone = 'live' | 'waiting' | 'ended' | 'none';

/* ---------- the line on the horizon ---------- */

/** Someone standing on the horizon. */
export interface TeamLinePerson {
  key: string;
  person: AvatarPerson;
  /** Under their arch: "You", or their first name. */
  name: string;
  /** Under the name, by its tone: "Until 12 Dec"; "Waiting", in caution; "Ended", quiet. */
  license: string;
  tone: TeamLicenseTone;
  /** What their arch is called when it can be pressed: their whole name ("You, Art Vandelay" for you). */
  label?: string | undefined;
}

/** An arch on the line that can be pressed: a button, so whatever opens from it can take it as its anchor. */
export type TeamArchButton = ReactElement<ComponentPropsWithRef<'button'>>;

/**
 * The team on the horizon: everyone in their arch, their name under it and their license under that, standing on the
 * horizon with their names on the water. `more` people than stand here are an empty arch at the end ("+4"). `arch` makes
 * each arch something to press: given who it is and their arch as a button, it returns the button in whatever opens from
 * it, such as their popover. Without it the arches are only pictures.
 */
export function TeamLine({ people, label, more = 0, arch, className }: {
  people: readonly TeamLinePerson[];
  /** What the line is, for screen readers: "People on Vandelay Industries". */
  label: string;
  more?: number | undefined;
  arch?: ((p: TeamLinePerson, button: TeamArchButton) => ReactNode) | undefined;
  className?: string | undefined;
}) {
  return (
    <ul className={cn('tq-line', className)} aria-label={label}>
      {people.map((p, i) => <Standing key={p.key} p={p} i={i} arch={arch} />)}
      {more > 0 && (
        <li className="tq-who is-more" style={{ '--d': people.length }}>
          <span className="tq-fig"><GhostArch more={more} size={46} /></span>
          <span className="nm ac-clamp-1">{more} more</span>
        </li>
      )}
    </ul>
  );
}

function Standing({ p, i, arch }: { p: TeamLinePerson; i: number; arch?: ((p: TeamLinePerson, button: TeamArchButton) => ReactNode) | undefined }) {
  const said = useId();
  const inside = (
    <>
      <span className="tq-fig"><Avatar person={p.person} size={46} /></span>
      <span className="nm ac-clamp-1">{p.name}</span>
      <span className="lc" id={said}>{p.license}</span>
    </>
  );
  return (
    <li className={cn('tq-who', `is-${p.tone}`)} style={{ '--d': i }}>
      {arch ? arch(p, <button type="button" className="tq-who-b" aria-label={p.label ?? p.person.name} aria-describedby={said}>{inside}</button>) : inside}
    </li>
  );
}

/* ---------- on the water ---------- */

/** A section on the water: its heading, with a quiet line at its end when it has one, then its rows and a foot. */
export function TeamSection({ title, aside, children, foot, className }: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  foot?: ReactNode;
  className?: string | undefined;
}) {
  const h = useId();
  return (
    <section className={cn('tq-sec', className)} aria-labelledby={h}>
      <div className="tq-h"><h2 id={h}>{title}</h2>{has(aside) && <small>{aside}</small>}</div>
      {children}
      {foot}
    </section>
  );
}

/** The rows of a section, each over a hairline. */
export function TeamRows({ children, label }: { children: ReactNode; label?: string | undefined }) {
  return <ul className="tq-rows" aria-label={label}>{children}</ul>;
}

/**
 * Someone on the team, as a row: their arch, their name with Admin beside the admin's, and their license under it, in
 * caution while they wait for one and quiet once it has ended. Remove, for the admin, sits in the row's last column, and
 * what it asks (`children`, a TeamAsk) opens under the row, in place.
 */
export function TeamPersonRow({ person, name, admin = false, license, tone, onRemove, removeLabel, removeRef, children, className }: {
  person: AvatarPerson;
  /** "Art Vandelay (you)", "Priya Raman". */
  name: string;
  admin?: boolean | undefined;
  /** "Licensed until 12 Dec", "Waiting for a license", "License ended 9 Nov. A new one is taken when they next open Alcove." */
  license: string;
  tone: TeamLicenseTone;
  /** Remove, on everyone else's row for the team's admin; left out while it's being asked. */
  onRemove?: (() => void) | undefined;
  /** What Remove is called for a screen reader: "Remove Maya Chen". */
  removeLabel?: string | undefined;
  /** Where the focus goes back to once the question under the row is answered. */
  removeRef?: Ref<HTMLButtonElement> | undefined;
  children?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <li className={cn('tq-row', has(children) && 'is-asking', className)}>
      <Avatar person={person} size={32} />
      <span className="tq-t">
        <b><span className="ac-clamp-1">{name}</span>{admin && <span className="tq-tag">Admin</span>}</b>
        <small className={cn(tone === 'waiting' && 'is-caution', tone === 'ended' && 'is-quiet')}>{license}</small>
      </span>
      {onRemove ? <Button ref={removeRef} variant="quiet" size="sm" aria-label={removeLabel} onClick={onRemove}>Remove</Button> : <span aria-hidden="true" />}
      {children}
    </li>
  );
}

/**
 * Something that can't be undone, asked in place: taking someone off the team, leaving it, deleting it. What it means is
 * said once, and the answer that loses nothing (Keep Maya, Stay) is the filled one, which takes the focus as it opens.
 * Escape answers it too.
 */
export function TeamAsk({ title, text, confirm, keep, onConfirm, onKeep, busy = false, className }: {
  /** "Take Maya off Vandelay Industries?" */
  title: string;
  text: ReactNode;
  /** "Take off the team", in caution. */
  confirm: string;
  /** "Keep Maya", filled. */
  keep: string;
  onConfirm: () => void;
  onKeep: () => void;
  busy?: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    <div className={cn('tq-ask', className)} role="group" aria-label={title}
      onKeyDown={(e) => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); onKeep(); } }}>
      <b>{title}</b>
      <p>{text}</p>
      <div className="row">
        <Button variant="secondary" size="sm" className="tq-caution" loading={busy} onClick={onConfirm}>{confirm}</Button>
        <Button variant="primary" size="sm" autoFocus disabled={busy} onClick={onKeep}>{keep}</Button>
      </div>
    </div>
  );
}

/** The foot of a section: one quiet thing to do, and what it means beside it. */
export function TeamFoot({ action, children }: { action: ReactNode; children?: ReactNode }) {
  return <div className="tq-foot">{action}{has(children) && <span>{children}</span>}</div>;
}

/* ---------- the notes visible to the team ---------- */

/** A note made visible to the team, as its row says it. */
export interface TeamNote {
  id: string;
  title: string;
  /** Who made it visible. */
  by: AvatarPerson;
  /** Their name in the row's line: "Priya", or "you". */
  byName: string;
  /** "Today", "Yesterday", "Tue 27 Oct". */
  when: string;
}

/**
 * The notes people on the team made visible to it, newest first: who made each visible and when, each opening its note.
 * `link` wraps a row in whatever opens it (the app's link to the note). With none, `empty` says what will show here, or why
 * nothing does, with a way forward when there is one. `foot` goes under the rows: Show more.
 */
export function TeamNotesList({ notes, link, empty, foot, title = 'Visible to the team', aside = 'Notes people here chose to share with everyone licensed', className }: {
  notes: readonly TeamNote[];
  link: (note: TeamNote, row: ReactElement) => ReactNode;
  empty: { title: string; line: ReactNode; action?: ReactNode };
  foot?: ReactNode;
  title?: ReactNode;
  aside?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <TeamSection title={title} aside={notes.length > 0 ? aside : undefined} className={cn('tq-notes', className)} foot={foot}>
      {notes.length > 0 ? (
        <TeamRows>
          {notes.map((n) => (
            <li key={n.id}>
              {link(n, (
                <span className="tq-nr">
                  <Avatar person={n.by} size={26} />
                  <span className="tq-t"><b className="ac-clamp-1">{n.title}</b><small className="ac-clamp-1">Made visible by {n.byName} · {n.when}</small></span>
                  <Icon name="chevron" size={16} />
                </span>
              ))}
            </li>
          ))}
        </TeamRows>
      ) : <EmptyState title={empty.title} art={null} action={empty.action} className="tq-none">{empty.line}</EmptyState>}
    </TeamSection>
  );
}

/* ---------- beside them, for the admin ---------- */

/**
 * The team's licenses, for its admin: how many are left of those in use and unused ("2 of 8 left"), a line on them
 * (`warm` while someone is waiting for one), Buy licenses (`urgent` fills it: someone is waiting, and nothing else on the
 * page is asking), and whether one is bought from the balance when it's needed.
 */
export function LicensesCard({ left, of, line, warm = false, urgent = false, onBuy, auto, onAuto, autoBusy = false, className }: {
  left: number;
  /** The licenses there are: live ones and those nobody has taken yet. */
  of: number;
  line: ReactNode;
  warm?: boolean | undefined;
  urgent?: boolean | undefined;
  onBuy: () => void;
  auto: boolean;
  onAuto: (on: boolean) => void;
  autoBusy?: boolean | undefined;
  className?: string | undefined;
}) {
  const h = useId();
  return (
    <section className={cn('tq-card', className)} aria-labelledby={h}>
      <h2 id={h} className="tq-ct">Licenses</h2>
      <p className="tq-big"><b>{left}</b>{of > 0 ? ` of ${of} left` : ' left'}</p>
      <p className={cn('tq-sub', warm && 'is-warm')}>{line}</p>
      <Button variant={urgent ? 'primary' : 'secondary'} onClick={onBuy}>Buy licenses</Button>
      <div className="tq-sw">
        <span><b>Buy one when it’s needed</b><small>From your balance, when someone needs a license and none is left.</small></span>
        <Switch label="Buy one when it’s needed" checked={auto} disabled={autoBusy} onChange={onAuto} />
      </div>
    </section>
  );
}

/** A link to join the team, just made: the link, and until when it works, in words ("tomorrow 16:12"). */
export interface TeamInviteMade { link: string; until: string }

/**
 * Inviting someone to the team: a one-time link for one person, for a day. Before one's made, Make an invite link; then
 * the link with Copy, until when it works, and Make another. On the Team page it's a card (`card`); in checkout's Done
 * it's a part of the step, with its own words (`title`, `hint`).
 *
 * The app's `useInvite()` (apps/web/src/features/team/invite.ts) makes and copies links, and gives exactly `made`,
 * `making`, `copied`, `onMake` and `onCopy`: `<TeamInvite {...useInvite()} />`.
 */
export interface TeamInviteProps {
  /** The link just made, or null before one is. A new one replaces it. */
  made: TeamInviteMade | null;
  /** A link is being made. */
  making?: boolean | undefined;
  /** Copy was just pressed: it says Copied for a moment. */
  copied?: boolean | undefined;
  onMake: () => void;
  onCopy: () => void;
  /** "Invite people". */
  title?: ReactNode;
  /** What a link does, under the title. */
  hint?: ReactNode;
  /** On a surface of its own, as the Team page's side column has it. */
  card?: boolean | undefined;
  /** Only the link and its buttons, under a heading drawn around it: checkout's Done (`CheckoutDone`'s `invite`). */
  bare?: boolean | undefined;
  className?: string | undefined;
}

export function TeamInvite({ made, making = false, copied = false, onMake, onCopy, title = 'Invite people', hint = 'Each link lets one person join, for a day. They take a license when they next open Alcove.', card = false, bare = false, className }: TeamInviteProps) {
  const h = useId();
  const link = made ? (
    <>
      <div className="tq-link" role="group" aria-label="Link to join the team">
        <code>{made.link.replace(/^https?:\/\//, '')}</code>
        <Button variant="secondary" size="sm" icon={copied ? 'check' : 'copy'} onClick={onCopy}>{copied ? 'Copied' : 'Copy'}</Button>
      </div>
      <p className="tq-hint">Works once, until {made.until}. <button type="button" className="tq-lnk" disabled={making} onClick={onMake}>Make another</button></p>
    </>
  ) : <Button variant="secondary" icon="link" loading={making} onClick={onMake}>Make an invite link</Button>;
  if (bare) return <div className={cn('tq-invite', className)}>{link}</div>;
  return (
    <section className={cn('tq-invite', card && 'tq-card', className)} aria-labelledby={h}>
      <h2 id={h} className="tq-ct">{title}</h2>
      {has(hint) && <p className="tq-sub">{hint}</p>}
      {link}
    </section>
  );
}

/* ---------- not on a team ---------- */

/** A quiet row for starting a team, under a company's page: what a team is, and Start a team. */
export function TeamStartRow({ title = 'A team of your own', line, onStart, className }: {
  title?: ReactNode;
  /** What it brings and costs, in a line. */
  line: ReactNode;
  onStart: () => void;
  className?: string | undefined;
}) {
  const h = useId();
  return (
    <section className={cn('tq-start', className)} aria-labelledby={h}>
      <span className="tq-start-i"><Icon name="people" size={18} /></span>
      <span className="tq-t"><b id={h}>{title}</b><small>{line}</small></span>
      <Button size="sm" onClick={onStart}>Start a team</Button>
    </section>
  );
}

/* ---------- joining by a link ---------- */

/** What joining gives you, one line each. */
export interface JoinFact { icon: IconName; text: ReactNode }

/**
 * Joining a team, as one card: the team's people in their arches (whoever is known), a tick once you've joined, what it
 * asks or says in the display face, a line, what joining gives you in a well, what to do, and a quiet foot.
 */
export function JoinCard({ faces = [], done = false, title, line, facts = [], actions, foot, className }: {
  faces?: readonly AvatarPerson[] | undefined;
  done?: boolean | undefined;
  title: ReactNode;
  line?: ReactNode;
  facts?: readonly JoinFact[] | undefined;
  actions?: ReactNode;
  foot?: ReactNode;
  className?: string | undefined;
}) {
  const h = useId();
  return (
    <section className={cn('tj-card', className)} aria-labelledby={h}>
      {faces.length > 0 && <span className="tj-faces"><Faces people={[...faces]} size={40} max={5} /></span>}
      {done && <span className="tj-tick"><Icon name="check" size={28} /></span>}
      <h1 id={h} className="tj-title">{title}</h1>
      {has(line) && <p className="tj-line">{line}</p>}
      {facts.length > 0 && (
        <ul className="tj-facts">
          {facts.map((f, i) => <li key={i}><Icon name={f.icon} size={17} /><span>{f.text}</span></li>)}
        </ul>
      )}
      {has(actions) && <div className="tj-acts">{actions}</div>}
      {has(foot) && <p className="tj-foot">{foot}</p>}
    </section>
  );
}

/** The team's evening behind a page of its own, with Alcove's mark at its top left and one card in the middle. */
export function JoinEvening({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return (
    <main className={cn('tj', className)}>
      <Horizon moment="team" />
      <span className="tj-bar"><Logo /></span>
      <div className="tj-in">{children}</div>
    </main>
  );
}
