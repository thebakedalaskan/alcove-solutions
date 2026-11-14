/*
 * Invitations on the Team page (docs/design/pages.md › Team): the cards for invitations to you, one under another
 * (InvitationCards, holding JoinCard from plans/team-plan.tsx); an invitation to another team said at the top of your own
 * team's water (InvitationNote); an invitation as a row (InvitationRow): someone asked to join your team, on its Invited
 * list, or one of yours put aside, with Join still there; and Invite people while one to you waits (JoinFirst). Each asks in
 * place what it needs to (a TeamAsk under the row, or in the note's place). Stateless: plain data in, handlers out, the
 * words as the app puts them. team/invitations.css (`ti-`).
 */
import type { ReactNode, Ref } from 'react';
import { cn } from '../foundation/cn';
import { Avatar, GhostArch, type AvatarPerson } from '../foundation/people';

/** Whether there's something to show: not nothing, false or an empty string. */
const has = (x: ReactNode): boolean => x !== undefined && x !== null && x !== false && x !== '';

/**
 * The cards for the invitations to you, newest first, one under another, with what's been put aside after them. A column of
 * flex, so one folding away (foldAway) takes its gap with it.
 */
export function InvitationCards({ label, children, className, ref }: { label: string; children: ReactNode; className?: string | undefined; ref?: Ref<HTMLDivElement> | undefined }) {
  return <div ref={ref} className={cn('ti-cards', className)} role="group" aria-label={label}>{children}</div>;
}

/**
 * An invitation, as a row: whoever it's about in their arch (`ghost`: someone not on the team yet, an empty arch with their
 * initial), what it is (`title`), and under it when it was sent or until when it lasts, in a line. What you can do sits at
 * the row's end (Resend and Cancel, or Join); what that asks (`children`, a TeamAsk) opens under the row, in place.
 */
export function InvitationRow({ person, ghost = false, title, line, actions, children, className }: {
  person: AvatarPerson;
  ghost?: boolean | undefined;
  /** "Lena Fischer", or "Jonas invited you to join Weber Design". */
  title: ReactNode;
  /** "Invited by Priya · 26 days ago · Runs out in 4 days", "Put aside · Runs out on 14 Dec". */
  line: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <li className={cn('ti-row', has(children) && 'is-asking', className)}>
      {ghost ? <GhostArch size={32} initial={person.name} /> : <Avatar person={person} size={32} />}
      <span className="ti-t">
        <b className="ac-clamp-1">{title}</b>
        <small>{line}</small>
      </span>
      {has(actions) ? <span className="ti-a">{actions}</span> : <span aria-hidden="true" />}
      {children}
    </li>
  );
}

/**
 * Invite people, while an invitation to you waits and you're on no team: inviting would start another team, so it says to
 * join that one first, in who invited you's arch ("Priya invited you to Vandelay Industries.", "Join it, then invite people
 * from its page."), with its Join (`action`) at the foot.
 */
export function JoinFirst({ person, title, line, action, className }: { person: AvatarPerson; title: ReactNode; line: ReactNode; action: ReactNode; className?: string | undefined }) {
  return (
    <div className={cn('ti-first', className)}>
      <Avatar person={person} size={34} />
      <p className="ti-t"><b>{title}</b><small>{line}</small></p>
      <div className="ti-first-a">{action}</div>
    </div>
  );
}

/**
 * An invitation to another team, said once at the top of your team's water: who sent it in their arch, what it is
 * ("Jonas invited you to join Weber Design."), and Join and Not now at its end. Before joining, what that asks (`ask`, a
 * TeamAsk: leaving the team you're on) takes their place; `note` says why you can't join yet.
 */
export function InvitationNote({ person, title, line, actions, ask, note, className, ref }: {
  person: AvatarPerson;
  title: ReactNode;
  line?: ReactNode;
  actions?: ReactNode;
  ask?: ReactNode;
  note?: ReactNode;
  className?: string | undefined;
  ref?: Ref<HTMLElement> | undefined;
}) {
  return (
    <section ref={ref} className={cn('ti-note', className)} aria-label="An invitation">
      <Avatar person={person} size={34} />
      <p className="ti-t"><b>{title}</b>{has(line) && <small>{line}</small>}{has(note) && <small className="ti-why">{note}</small>}</p>
      {!has(ask) && has(actions) && <span className="ti-a">{actions}</span>}
      {has(ask) && <div className="ti-ask">{ask}</div>}
    </section>
  );
}
