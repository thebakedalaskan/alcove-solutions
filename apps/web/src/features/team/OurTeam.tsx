/*
 * The team you're on (docs: Plans and usage › Team), on the Team page: its people with their licenses, and for its admin
 * Invite (a one-time link, shown once, to copy), Remove on someone's row (asked in place), the licenses left and Delete team
 * once nobody else is on it; for a member, Leave team. Below, the notes made visible to the team, each opening its note.
 * Someone not on a team starts one here. A refusal says what the server says: its words are written for people.
 */
import { errorMessage, firstName, type MyTeam, type NoteSummary, type Team, type TeamInvite, type TeamMember } from '@alcove/api';
import { Avatar, Button, CopyField, Icon, Notice, useToast } from '@alcove/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { useId, useRef, useState, type FormEvent } from 'react';
import { useCreateTeam, useDeleteTeam, useLeaveTeam, useRemoveTeamMember, useTeamInvite } from '~/lib/queries';
import { callName } from '~/lib/people';
import { dayMonth, hm, pastDay, shortDay } from '~/lib/time';
import { capital } from '~/lib/words';

/** A member's license, as their row says it: "Licensed until 12 Dec", "License ended", "Waiting for a license". */
export function licenseLine(m: TeamMember): string {
  if (m.license.state === 'live' && m.license.until !== null) return `Licensed until ${dayMonth(new Date(m.license.until))}`;
  if (m.license.wanted !== null) return 'Waiting for a license';
  return m.license.state === 'ended' ? 'License ended' : 'No license yet';
}
const roleWord = (m: TeamMember) => (m.role === 'admin' ? 'Admin' : 'Member');
const licensesWord = (n: number) => `${n} ${n === 1 ? 'license' : 'licenses'}`;
/** The team's admin, by first name, or "the admin". */
export const adminOf = (t: MyTeam): string => { const a = t.members.find((m) => m.role === 'admin'); return a ? firstName(a.person.name) : 'the admin'; };

/**
 * The team as the page's line of people stands it: everyone on it but you, each under their license. The line and the
 * popovers read a company's directory; a team is one, with its people all on Alcove.
 */
export function asDirectory(t: MyTeam): Team {
  return {
    name: t.name, domain: '',
    members: t.members.filter((m) => !m.you).map((m) => ({ person: m.person, title: licenseLine(m), onAlcove: true, invited: false }))
  };
}

/** What a team's head says under its name: how many people, and for its admin, the licenses left. */
export function teamLine(t: MyTeam): string {
  const people = `${t.members.length} ${t.members.length === 1 ? 'person' : 'people'}`;
  return t.licenses ? `${people} · ${licensesWord(t.licenses.unconsumed)} left` : people;
}

/** Invite: a new link each time, shown once with Copy, which works once until it runs out. */
export function useInvite() {
  const make = useTeamInvite();
  const toast = useToast();
  const [made, setMade] = useState<TeamInvite | null>(null);
  const invite = () => make.mutate(undefined, { onSuccess: setMade, onError: (e) => toast(errorMessage(e), { icon: 'x' }) });
  return { made, invite, making: make.isPending, done: () => setMade(null) };
}

/** The link just made, to copy: it isn't shown again. */
export function InviteMade({ made, onDone }: { made: TeamInvite; onDone: () => void }) {
  const until = new Date(made.expiresAt);
  return (
    <div className="tp-inv" role="status">
      <p><b>Send this link to one person.</b> It works once, until {shortDay(until)} at {hm(until)}, and isn’t shown again.</p>
      <CopyField value={made.link} label="Link to join the team" />
      <Button variant="quiet" size="sm" onClick={onDone}>Done</Button>
    </div>
  );
}

/** The team's people, with their licenses; the admin removes someone from their row, asked in place. */
export function TeamMembers({ team }: { team: MyTeam }) {
  const h = useId();
  const remove = useRemoveTeamMember();
  const toast = useToast();
  const [asking, setAsking] = useState<string | null>(null);
  const admin = team.role === 'admin';
  const asked = (m: TeamMember) => remove.mutate(m.id, {
    onSuccess: () => { setAsking(null); toast(`${callName(m.person)} is off the team.`, { icon: 'check' }); },
    onError: (e) => toast(errorMessage(e), { icon: 'x' })
  });
  return (
    <section className="tp-s tp-yet tp-tm" aria-labelledby={h}>
      <div className="tp-h"><h2 id={h}>People on {team.name}</h2></div>
      <ul className="tp-rows">
        {team.members.map((m) => (
          <li key={m.id}>
            <div className="tp-r">
              <Avatar person={m.person} size={32} />
              <b className="ac-clamp-1">{m.you ? 'You' : m.person.name}</b>
              <span className="tp-r-s">{roleWord(m)}</span>
              <span className={m.license.state === 'live' ? 'tp-r-m' : 'tp-r-m is-off'}>
                <Icon name={m.license.state === 'live' ? 'check' : m.license.wanted !== null ? 'clock' : 'info'} size={14} />
                <span className="ac-clamp-1">{licenseLine(m)}</span>
              </span>
              {admin && !m.you && asking !== m.id
                ? <Button variant="secondary" size="sm" onClick={() => setAsking(m.id)} aria-label={`Remove ${m.person.name}`}>Remove</Button>
                : <span />}
            </div>
            {asking === m.id && (
              <div className="tp-ask" role="group" aria-label={`Remove ${m.person.name}?`}>
                <p>Remove {firstName(m.person.name)} from the team? Their license isn’t refunded, and they go back to Free. Notes they made visible to the team stay visible.</p>
                <div className="tp-ask-a">
                  <Button variant="quiet" size="sm" disabled={remove.isPending} onClick={() => setAsking(null)}>Keep {firstName(m.person.name)}</Button>
                  <Button variant="secondary" size="sm" loading={remove.isPending} onClick={() => asked(m)}>Remove</Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {team.licenses && (
        <p className="tp-yet-f">
          {licensesWord(team.licenses.unconsumed)} left. Someone without a live license takes one when they next open Alcove. <Link to="/settings" hash="plan" className="tp-a">Buy licenses in Settings</Link>
        </p>
      )}
      <TeamLeave team={team} />
    </section>
  );
}

/** Leave team for a member; Delete team for the admin once nobody else is on it. Each asks in place. */
function TeamLeave({ team }: { team: MyTeam }) {
  const leave = useLeaveTeam();
  const del = useDeleteTeam();
  const toast = useToast();
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const back = useRef<HTMLButtonElement>(null);
  const admin = team.role === 'admin';
  if (admin && team.members.length > 1) return null;
  const refund = team.licenses?.refundableMicroUsd ?? 0;
  const go = () => {
    const done = () => { toast(admin ? `${team.name} is deleted.` : `You left ${team.name}.`, { icon: 'check' }); void navigate({ to: '/team', replace: true }); };
    const failed = (e: unknown) => toast(errorMessage(e), { icon: 'x' });
    if (admin) del.mutate(undefined, { onSuccess: done, onError: failed });
    else leave.mutate(undefined, { onSuccess: done, onError: failed });
  };
  const what = admin ? 'Delete team' : 'Leave team';
  if (!asking) return <div className="tp-leave"><Button ref={back} variant="quiet" size="sm" icon={admin ? 'trash' : 'signOut'} onClick={() => setAsking(true)}>{what}</Button></div>;
  return (
    <div className="tp-ask" role="group" aria-label={`${what}?`}>
      <p>{admin
        ? `Delete ${team.name}? ${refund > 0 ? 'The licenses nobody took go back to your balance.' : 'Nobody else is on it.'}`
        : `Leave ${team.name}? Your license isn’t refunded, and you go back to Free. Notes you made visible to the team stay visible.`}</p>
      <div className="tp-ask-a">
        <Button variant="quiet" size="sm" disabled={leave.isPending || del.isPending} onClick={() => { setAsking(false); requestAnimationFrame(() => back.current?.focus()); }}>{admin ? 'Keep it' : 'Stay'}</Button>
        <Button variant="secondary" size="sm" loading={leave.isPending || del.isPending} onClick={go}>{what}</Button>
      </div>
    </div>
  );
}

/** Without a license: why the team's notes and workspaces aren't open, and who to ask. */
export function NoLicense({ team }: { team: MyTeam }) {
  if (team.licensed || team.role === 'admin') return null;
  return <Notice tone="caution" icon="people" className="tp-nolic">You don’t have a team license, so the team’s notes and workspaces aren’t open to you. Ask {adminOf(team)} to buy more.</Notice>;
}

/** The notes made visible to the team, newest first, each opening its note. */
export function TeamNotes({ team, notes, now }: { team: MyTeam; notes: NoteSummary[]; now: Date }) {
  const h = useId();
  return (
    <section className="tp-s tp-sh tp-tn" aria-labelledby={h}>
      <div className="tp-h"><h2 id={h}>Visible to the team</h2></div>
      {!team.licensed ? <p className="tp-none">With a team license, notes made visible to {team.name} show up here.</p>
        : notes.length > 0 ? (
          <ul className="tp-rows">
            {notes.map((n) => {
              const by = n.received?.by;
              return (
                <li key={n.id}>
                  <Link to="/notes/$noteId" params={{ noteId: n.id }} className="tp-nr">
                    {by ? <Avatar person={by} size={26} /> : <Icon name="notes" size={20} />}
                    <span className="tp-nr-t"><b className="ac-clamp-1">{n.title}</b><small className="ac-clamp-1">{by ? `From ${callName(by)}` : 'Yours'}</small></span>
                    <span className="tp-nr-w">{capital(pastDay(n.startedAt, now))}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : <p className="tp-none">Nobody has made a note visible to the team yet. On a note you organized, turn on Visible to team.</p>}
    </section>
  );
}

/** Start a team: a quiet way in, then its name in place. You're its admin, and buy its licenses in Settings › Plan. */
export function StartTeam() {
  const create = useCreateTeam();
  const toast = useToast();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const to = name.trim();
    if (!to || create.isPending) return;
    setRefused(null);
    create.mutate(to, {
      onSuccess: (t) => { setNaming(false); setName(''); toast(`${t.name} is made. Buy licenses in Settings › Plan, then invite people.`, { icon: 'check' }); },
      onError: (err) => setRefused(errorMessage(err))
    });
  };
  if (!naming) return <Button size="lg" icon="people" onClick={() => { setNaming(true); requestAnimationFrame(() => field.current?.focus()); }}>Start a team</Button>;
  return (
    <form className="tp-start" onSubmit={submit}>
      <input ref={field} className="tp-name" type="text" aria-label="Name the team" placeholder="Name the team" value={name} maxLength={120} autoComplete="off"
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setNaming(false); setName(''); } }} />
      <Button type="submit" size="lg" loading={create.isPending} disabled={!name.trim()}>Make it</Button>
      <Button variant="quiet" size="lg" onClick={() => { setNaming(false); setName(''); setRefused(null); }}>Not now</Button>
      {refused !== null && <p className="tp-err" role="alert">{refused}</p>}
    </form>
  );
}
