/*
 * A team's page, and joining one (docs/design/pages.md › Team; the canvas's TeamPlan and Join boards in
 * docs/design/canvas/plans/). The team's name in the sky, with Rename for its admin (TeamRename, in a popover the app
 * opens), over its tier and how many are on it (TeamTier); the team stands on the horizon, each person in their arch, under
 * their license on Team (TeamLine). On the water, what Free means once, with Upgrade or Ask to upgrade (TeamTierNote); its
 * people as rows (TeamPersonRow) in a section (TeamSection) with a foot (TeamFoot), Remove asked in place under a row
 * (TeamAsk), and the notes made visible to the team (TeamNotesList). Beside them, for the admin of a team on Team, the
 * licenses left with Buy licenses and buying one when it's needed (LicensesCard). Joining is one card (JoinCard): on the
 * team's evening of a page of its own (JoinEvening), or on the Team page, where it can ask in place before leaving another
 * team.
 *
 * Every part is stateless: plain data in, handlers out, the words as the app puts them. plans/team-plan.css (`tq-` the
 * page, `tj-` joining).
 */
import { useEffect, useId, useRef, type ComponentPropsWithRef, type ReactElement, type ReactNode, type Ref } from 'react';
import { cn } from '../foundation/cn';
import { Logo } from '../foundation/brand';
import { EmptyState } from '../foundation/empty';
import { Horizon } from '../evening/horizon';
import { Icon, type IconName } from '../foundation/icon';
import { Avatar, Faces, GhostArch, type AvatarPerson } from '../foundation/people';
import { Button, Switch } from '../foundation/primitives';
import { TeamName } from './checkout';

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
  /**
   * Under the name, by its tone: on Team, "Until 12 Dec"; "Waiting", in caution; "Ended", quiet. On a free team, nothing,
   * or "Joined today". Someone invited: "Invited".
   */
  license?: string | undefined;
  tone: TeamLicenseTone;
  /** What their arch is called when it can be pressed: their whole name ("You, Art Vandelay" for you). */
  label?: string | undefined;
  /** Invited and not on the team yet: an empty dashed arch with their initial, as on a company's line. */
  ghost?: boolean | undefined;
  /** Not on the team: a colleague standing further back, after it, smaller and in the evening's haze. */
  back?: boolean | undefined;
}

/** An arch on the line that can be pressed: a button, so whatever opens from it can take it as its anchor. */
export type TeamArchButton = ReactElement<ComponentPropsWithRef<'button'>>;

/**
 * The team on the horizon: everyone in their arch, their name under it and their license under that, standing on the
 * horizon with their names on the water; then whoever's invited, in dashed arches (`ghost`), and at a company the
 * colleagues not on it, standing further back (`back`). `more` people than stand here are an empty arch at the end ("+4").
 * `arch` makes each arch something to press: given who it is and their arch as a button, it returns the button in whatever
 * opens from it, such as their popover. Without it the arches are only pictures.
 */
export function TeamLine({ people, label, more = 0, arch, className }: {
  people: readonly TeamLinePerson[];
  /** What the line is, for screen readers: "People on Vandelay Industries". */
  label: string;
  more?: number | undefined;
  arch?: ((p: TeamLinePerson, button: TeamArchButton) => ReactNode) | undefined;
  className?: string | undefined;
}) {
  /* The team's own people, then the empty arch for the rest of them, then whoever's invited and whoever stands further back. */
  const on = people.findIndex((p) => p.ghost === true || p.back === true);
  const team = on < 0 ? people.length : on;
  return (
    <ul className={cn('tq-line', className)} aria-label={label}>
      {people.slice(0, team).map((p, i) => <Standing key={p.key} p={p} i={i} arch={arch} />)}
      {more > 0 && (
        <li className="tq-who is-more" style={{ '--d': team }}>
          <span className="tq-fig"><GhostArch more={more} size={46} /></span>
          <span className="nm ac-clamp-1">{more} more</span>
        </li>
      )}
      {people.slice(team).map((p, i) => <Standing key={p.key} p={p} i={team + (more > 0 ? 1 : 0) + i} arch={arch} />)}
    </ul>
  );
}

function Standing({ p, i, arch }: { p: TeamLinePerson; i: number; arch?: ((p: TeamLinePerson, button: TeamArchButton) => ReactNode) | undefined }) {
  const said = useId();
  const inside = (
    <>
      <span className="tq-fig">{p.ghost ? <GhostArch initial={p.person.name} size={46} /> : <Avatar person={p.person} size={46} />}</span>
      <span className="nm ac-clamp-1">{p.name}</span>
      {has(p.license) && <span className="lc" id={said}>{p.license}</span>}
    </>
  );
  return (
    <li className={cn('tq-who', `is-${p.tone}`, p.ghost && 'is-ghost', p.back && 'is-back')} style={{ '--d': i }}>
      {arch ? arch(p, <button type="button" className="tq-who-b" aria-label={p.label ?? p.person.name} aria-describedby={has(p.license) ? said : undefined}>{inside}</button>) : inside}
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
 * Someone on the team, as a row: their arch, their name with Admin beside the admin's, and a line under it: their license on
 * Team, in caution while they wait for one and quiet once it has ended; on a free team, when they joined. Remove, for the
 * admin, sits in the row's last column, and what it asks (`children`, a TeamAsk) opens under the row, in place.
 */
export function TeamPersonRow({ person, name, admin = false, line, tone = 'none', onRemove, removeLabel, removeRef, children, className }: {
  person: AvatarPerson;
  /** "Art Vandelay (you)", "Priya Raman". */
  name: string;
  admin?: boolean | undefined;
  /**
   * On Team: "Licensed until 12 Dec", "Waiting for a license", "License ended 9 Nov. A new one is taken when they next open
   * Alcove." On a free team: "Joined today", "Joined 2 Nov".
   */
  line: string;
  /** How the line reads: in caution while they wait for a license, quiet once it ended. */
  tone?: TeamLicenseTone | undefined;
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
        <small className={cn(tone === 'waiting' && 'is-caution', tone === 'ended' && 'is-quiet')}>{line}</small>
      </span>
      {onRemove ? <Button ref={removeRef} variant="quiet" size="sm" aria-label={removeLabel} onClick={onRemove}>Remove</Button> : <span aria-hidden="true" />}
      {children}
    </li>
  );
}

/**
 * Something that can't be undone, asked in place: taking someone off the team, leaving it, deleting it. What it means is
 * said once, and the answer that loses nothing (Keep Maya, Stay) is the filled one, which takes the focus as it opens.
 * Escape answers it too. It comes into view as it opens, clear of a phone's tab bar, where its answers stand one over the
 * other, the one that loses nothing first.
 */
export function TeamAsk({ title, text, confirm, keep, onConfirm, onKeep, busy = false, className }: {
  /** "Remove Maya?" */
  title: string;
  text: ReactNode;
  /** "Remove Maya", in caution. */
  confirm: string;
  /** "Keep Maya", filled. */
  keep: string;
  onConfirm: () => void;
  onKeep: () => void;
  busy?: boolean | undefined;
  className?: string | undefined;
}) {
  const said = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollIntoView({ block: 'nearest' }); }, []);
  return (
    <div ref={box} className={cn('tq-ask', className)} role="group" aria-label={title} aria-describedby={said}
      onKeyDown={(e) => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); onKeep(); } }}>
      <b>{title}</b>
      <p id={said}>{text}</p>
      <div className="row">
        <Button variant="primary" size="sm" autoFocus disabled={busy} onClick={onKeep}>{keep}</Button>
        <Button variant="secondary" size="sm" className="tq-caution" loading={busy} onClick={onConfirm}>{confirm}</Button>
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

/** What buying a license as it's needed is called, wherever it's switched: the Team page, Settings and checkout. */
const AUTO_BUY = 'Buy a license for each person who joins';

/**
 * The team's licenses, for its admin: how many are left of those in use and unused ("2 of 8 left"), a line on them
 * (`warm` while someone is waiting for one), Buy licenses (`urgent` fills it: someone is waiting, and nothing else on the
 * page is asking), and Buy a license for each person who joins: one bought from the balance when someone needs it and none
 * is left. A free team's admin with that on sees it here too, without Buy licenses (its Upgrade is elsewhere).
 */
export function LicensesCard({ left, of, line, warm = false, urgent = false, onBuy, auto, onAuto, autoBusy = false, className }: {
  left: number;
  /** The licenses there are: live ones and those nobody has taken yet. */
  of: number;
  line: ReactNode;
  warm?: boolean | undefined;
  urgent?: boolean | undefined;
  onBuy?: (() => void) | undefined;
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
      {onBuy && <Button variant={urgent ? 'primary' : 'secondary'} onClick={onBuy}>Buy licenses</Button>}
      <div className="tq-sw">
        <span><b>{AUTO_BUY}</b><small>From your balance, when someone needs a license and none is left.</small></span>
        <Switch label={AUTO_BUY} checked={auto} disabled={autoBusy} onChange={onAuto} />
      </div>
    </section>
  );
}

/* ---------- in the sky ---------- */

/** A team's tier: Free, everyone on their own plan, or Team, licensed. */
export type TeamTierName = 'free' | 'team';

/**
 * Under the team's name in the sky: its tier, then how many are on it and what else is worth a glance ("Free · 3 people",
 * "Team · 6 people · 5 with a license · 3 licenses left"). Team's word has the small sun a paid plan has beside it.
 */
export function TeamTier({ tier, children, className }: { tier: TeamTierName; children: ReactNode; className?: string | undefined }) {
  return (
    <p className={cn('tq-say', className)}>
      <span className={cn('tq-tier', `is-${tier}`)}>{tier === 'team' && <i aria-hidden="true" />}{tier === 'team' ? 'Team' : 'Free'}</span>
      {' · '}
      <span>{children}</span>
    </p>
  );
}

/**
 * Renaming the team, inside the popover the admin's pen opens beside its name: the name in TeamName's box, why it was refused
 * if it was, and Rename (filled) with Cancel. Enter renames it; Escape is the popover's.
 */
export function TeamRename({ value, onChange, onSave, onCancel, busy = false, error, className }: {
  value: string;
  onChange: (name: string) => void;
  onSave: () => void;
  onCancel: () => void;
  busy?: boolean | undefined;
  /** Why the name wasn't taken, in the server's words. */
  error?: ReactNode;
  className?: string | undefined;
}) {
  const blank = value.trim() === '';
  return (
    <form className={cn('tq-rename', className)} onSubmit={(e) => { e.preventDefault(); if (!blank && !busy) onSave(); }}>
      <TeamName label="Rename team" hint="Everyone on it sees it" value={value} onChange={onChange} autoFocus />
      {has(error) && <p className="tq-rename-x" role="alert">{error}</p>}
      <div className="row">
        <Button variant="quiet" size="sm" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" size="sm" loading={busy} disabled={blank}>Rename</Button>
      </div>
    </form>
  );
}

/* ---------- on the water, once ---------- */

/**
 * What a free team's tier means, said once at the top of its water: "Vandelay Industries is on Free." (or, for its admin
 * while someone's asked, "Kofi asked you to upgrade.") and what upgrading gives everyone, with what you can do about it at
 * its end: Upgrade for the admin, Ask Priya to upgrade for everyone else, or that they've been asked (`done`, a quiet line
 * in place of the button, said as it changes).
 */
export function TeamTierNote({ title, line, action, done, className }: {
  title: ReactNode;
  line: ReactNode;
  action?: ReactNode;
  /** In the action's place once it's done: "Priya’s been asked". */
  done?: ReactNode;
  className?: string | undefined;
}) {
  const h = useId();
  return (
    <section className={cn('tq-free', className)} aria-labelledby={h}>
      <span className="tq-free-i" aria-hidden="true"><Icon name="people" size={18} /></span>
      <p className="tq-t"><b id={h}>{title}</b><small>{line}</small></p>
      {has(done) ? <p className="tq-free-done" role="status"><Icon name="check" size={16} />{done}</p> : has(action) && <span className="tq-free-a">{action}</span>}
    </section>
  );
}

/* ---------- joining ---------- */

/** What joining gives you, one line each. */
export interface JoinFact { icon: IconName; text: ReactNode }

/**
 * An invitation to a team, or anything about joining one, as one card: the team's people in their arches (whoever is
 * known), a tick once it's done, what it asks or says (in the display face on a page of its own), a line, what joining
 * gives you in a well, what to do, and a quiet foot. Before joining while you're on another team, `ask` (a TeamAsk) takes
 * the place of what to do, in place; `note` is a quiet line over what to do (why you can't join yet), and `problem` what
 * went wrong, in caution, said as it happens. On a page of its own it's the page's heading (`level` 1); on the Team page, a
 * section's (2), its title in the face you read.
 */
export function JoinCard({ faces = [], done = false, title, line, facts = [], actions, ask, note, problem, foot, level = 1, className, ref }: {
  faces?: readonly AvatarPerson[] | undefined;
  done?: boolean | undefined;
  title: ReactNode;
  line?: ReactNode;
  facts?: readonly JoinFact[] | undefined;
  actions?: ReactNode;
  /** Asked in place of `actions`: leaving the team you're on to join this one. */
  ask?: ReactNode;
  /** Over `actions`, quiet: why you can't join yet. */
  note?: ReactNode;
  /** Over `actions`, in caution: what went wrong ("You’re offline…"), announced as it appears. */
  problem?: ReactNode;
  foot?: ReactNode;
  level?: 1 | 2 | undefined;
  className?: string | undefined;
  ref?: Ref<HTMLElement> | undefined;
}) {
  const h = useId();
  const Heading = level === 1 ? 'h1' : 'h2';
  return (
    <section ref={ref} className={cn('tj-card', level === 2 && 'is-inline', className)} aria-labelledby={h}>
      {faces.length > 0 && <span className="tj-faces"><Faces people={[...faces]} size={40} max={5} /></span>}
      {done && <span className="tj-tick"><Icon name="check" size={28} /></span>}
      <Heading id={h} className="tj-title">{title}</Heading>
      {has(line) && <p className="tj-line">{line}</p>}
      {facts.length > 0 && (
        <ul className="tj-facts">
          {facts.map((f, i) => <li key={i}><Icon name={f.icon} size={17} /><span>{f.text}</span></li>)}
        </ul>
      )}
      {has(ask) ? <div className="tj-ask">{ask}</div> : (
        <>
          {has(note) && <p className="tj-note">{note}</p>}
          {has(problem) && <p className="tj-problem" role="alert"><Icon name="alert" size={16} /><span>{problem}</span></p>}
          {has(actions) && <div className="tj-acts">{actions}</div>}
        </>
      )}
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
