/*
 * The people, standing on the horizon. Each opens a popover under their arch with everything about them, so nothing has
 * to sit under every arch: Ring goes straight to the lobby and rings them as you join, Schedule opens at When with them
 * picked, and the notes you both have list in the same popover. Someone not on Alcove yet is an empty arch, with Invite
 * in place of Ring. Past thirteen people the line recedes, and the list of everyone finds whoever's too far away to read.
 */
import { errorMessage, type NoteSummary, type Person, type Team } from '@alcove/api';
import { Avatar, Button, GhostArch, Icon, IconButton, PickList, Popover, PopoverClose, buttonClass, cn, useToast, type PickRow, type TeamArchButton } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import { cloneElement, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useFloodToCall } from '~/features/calls/flow/parts';
import { useCallFlow } from '~/features/shell/context';
import { callName, fold } from '~/lib/people';
import { useStartNow } from '~/lib/queries';
import { noteDay } from '~/lib/time';
import { plural } from '~/lib/words';
import { addressOnly, callLine, listed, notesWith, type Meets } from './data';
import type { Arch, Line, Sun } from './line';
import { personPop, useOpen, usePop } from './open';
import { InviteLink } from './People';

/** What people's popovers read. */
export interface Between { notes: NoteSummary[]; meets: (email: string) => Meets; now: Date; inGroups: number }

/** Rings someone: the call starts, night floods out of the button, and it goes straight to the lobby. */
function useRing() {
  const startNow = useStartNow();
  const toast = useToast();
  const { go, flood } = useFloodToCall();
  const busy = useRef(false);
  const ring = (from: Element, email: string) => {
    if (busy.current) return;
    busy.current = true;
    go(from, async () => (await startNow.mutateAsync({ guests: [email] })).code)
      .catch((e: unknown) => toast(errorMessage(e), { icon: 'x' }))
      .finally(() => { busy.current = false; });
  };
  return { ring, flood };
}
type Ring = (from: Element, email: string) => void;

export function PeopleLine({ line, sun, company, waiting = false, between }: { line: Line; sun: Sun; company: string | undefined; waiting?: boolean | undefined; between: Between }) {
  const { ring, flood } = useRing();
  const row = useRef<HTMLUListElement>(null);
  /* On a phone the line is wider than the window: it starts with you in the middle. */
  useLayoutEffect(() => {
    const r = row.current;
    if (r) r.scrollLeft = (r.scrollWidth - r.clientWidth) / 2;
  }, [line.arches.length]);
  const gap = { '--k': Math.abs(line.gap).toFixed(3) };
  return (
    <>
      <ul ref={row} className={cn('tp-row', line.recedes && 'is-receding', waiting && 'is-waiting')} aria-label={company ? `People at ${company}` : 'Your team'}>
        {line.gap > 0.01 && <li aria-hidden="true" className="tp-gap" style={gap} />}
        {line.arches.map((a) => <Place key={a.key} arch={a} sun={sun} between={between} ring={ring} />)}
        {line.gap < -0.01 && <li aria-hidden="true" className="tp-gap" style={gap} />}
      </ul>
      {flood}
    </>
  );
}

function Place({ arch: a, sun, between, ring }: { arch: Arch; sun: Sun; between: Between; ring: Ring }) {
  const style = { '--k': a.k.toFixed(3), '--haze': a.haze.toFixed(2), '--z': a.z.toFixed(2), '--d': a.d };
  const sunny = sun.inArch === a.key;
  if (!a.person) {
    return <li aria-hidden="true" className={cn('tp-p is-blank', a.far && 'is-far', sunny && 'has-sun')} style={style}><span className="tp-who"><span className="tp-arch"><span className="tp-fig"><GhostArch /></span></span><span className="tp-n" /></span></li>;
  }
  return <Standing arch={a} person={a.person} style={style} sunny={sunny} between={between} ring={ring} />;
}

function Standing({ arch: a, person, style, sunny, between, ring }: { arch: Arch; person: Person; style: Record<`--${string}`, string | number>; sunny: boolean; between: Between; ring: Ring }) {
  const pop = usePop(personPop(person.email));
  const { picked } = useOpen();
  const place = useRef<HTMLLIElement>(null);
  const arch = useRef<HTMLButtonElement>(null);
  const name = listed(person);
  /* On a phone the line slides, so whoever's opened from the list comes into the middle of it. */
  useEffect(() => { if (pop.open) place.current?.scrollIntoView({ inline: 'center', block: 'nearest' }); }, [pop.open]);
  const label = a.me ? `You, ${name}` : a.ghost ? `${name}, not on Alcove yet` : name;
  return (
    <li ref={place} className={cn('tp-p', a.far && 'is-far', pop.open && 'is-on', sunny && 'has-sun', a.me && 'is-me', picked.includes(person.email) && 'is-picked')} style={style}>
      <Popover {...pop} side="bottom" align="center" caret label={name} className="tp-pop is-person"
        anchor={(
          <button ref={arch} type="button" className="tp-who" aria-label={label} title={a.far ? name : undefined}>
            <span className="tp-arch"><span className="tp-fig">{a.ghost ? <GhostArch initial={name} /> : <Avatar person={person} size={Math.round(72 * a.k)} />}</span></span>
            <span className="tp-n">{a.me ? 'You' : callName(person)}</span>
          </button>
        )}>
        {/* The arch takes the focus first: the call's modal hands it back there, and what was pressed is going. */}
        <About arch={a} person={person} between={between} ring={ring} onLeave={() => { arch.current?.focus({ preventScroll: true }); pop.onOpenChange(false); }} />
      </Popover>
    </li>
  );
}

/** Notes listed in a popover before Open in Calls. */
const NOTES = 5;

/** What's in someone's popover: who they are, what you can do, and the notes you both have, a step further in. */
function About({ arch: a, person, between, ring, onLeave }: { arch: Arch; person: Person; between: Between; ring: Ring; onLeave: () => void }) {
  const flow = useCallFlow();
  const [view, setView] = useState<'card' | 'notes' | 'back'>('card');
  const { now, meets, inGroups } = between;
  const m = meets(person.email);
  const shared = a.me ? [] : notesWith(between.notes, person);
  const first = callName(person);
  const close = <PopoverClose asChild><IconButton icon="x" size={16} label="Close" className="tp-pop-x" /></PopoverClose>;

  if (view === 'notes') {
    return (
      <>
        <div className="tp-pop-h">
          <IconButton icon="left" size={16} label="Back" className="tp-pop-back" autoFocus onClick={() => setView('back')} />
          <span className="tp-pop-w"><b className="ac-clamp-1">Notes with {first}</b></span>
          {close}
        </div>
        <div className="tp-pn">
          {shared.slice(0, NOTES).map((n) => (
            <Link key={n.id} to="/calls/$noteId" params={{ noteId: n.id }} className="tp-pn-r"><span className="ac-clamp-1">{n.title}</span><small>{noteDay(n.startedAt, now)}</small></Link>
          ))}
        </div>
        <Link to="/calls" hash={`with=${encodeURIComponent(person.email)}`} className="tp-pop-l is-all"><span>Open in Calls</span><Icon name="right" size={14} className="go" /></Link>
      </>
    );
  }

  const about = a.me ? person.email : a.member?.title ?? (addressOnly(person) ? undefined : person.email);
  /* Anyone who took the invitation up is on Alcove now, whatever you once marked. */
  const invited = a.ghost && a.member?.invited === true;
  const when = a.me ? (inGroups ? `In ${plural(inGroups, 'group')}` : undefined) : invited ? 'Invited' : callLine(m, now);
  const lead = view === 'card';
  return (
    <>
      <div className="tp-pop-h">
        <span className="tp-pop-w"><b className="ac-clamp-1">{listed(person)}</b>{about && <small className="ac-clamp-1">{about}</small>}</span>
        {close}
      </div>
      {when && <p className={cn('tp-when', m.next && !a.me && !invited && 'is-next')}>{when}</p>}
      <div className="tp-pop-a">
        {a.me ? <Link to="/settings" className={buttonClass()}><Icon name="settings" size={18} />Settings</Link> : (
          <>
            {a.ghost
              ? <InviteLink people={[person]} remind={invited} variant="primary" size="md" icon>{invited ? 'Remind' : 'Invite'}</InviteLink>
              : <Button variant="primary" icon="phoneCall" autoFocus={lead} onClick={(e) => { ring(e.currentTarget, person.email); onLeave(); }}>Ring</Button>}
            <Button icon="cal" aria-haspopup="dialog" onClick={() => { onLeave(); flow.start({ people: [person], later: true }); }}>Schedule</Button>
          </>
        )}
      </div>
      {shared.length > 0 && (
        <button type="button" className="tp-pop-l" autoFocus={!lead} onClick={() => setView('notes')}>
          <Icon name="notes" size={18} /><span>Notes you both have</span><b>{shared.length}</b><Icon name="right" size={14} className="go" />
        </button>
      )}
    </>
  );
}

/** Everyone in one list you can search, once the line recedes. Picking someone brings them forward and opens their popover. */
export function AllPeople({ me, team, onFind, anchor }: { me: Person; team: Team; onFind: (email: string) => void; anchor: ReactNode }) {
  const pop = usePop('all');
  const moving = useRef(false);
  return (
    <Popover {...pop} anchor={anchor} align="center" caret label="Everyone at your company" className="tp-pop is-list" onCloseFocus={() => { const m = moving.current; moving.current = false; return m; }}>
      <AllList me={me} team={team} onFind={(email) => { moving.current = true; onFind(email); }} />
    </Popover>
  );
}

function AllList({ me, team, onFind }: { me: Person; team: Team; onFind: (email: string) => void }) {
  const [query, setQuery] = useState('');
  const typed = fold(query.trim());
  const rows: PickRow[] = [
    { key: me.email, name: me.name, sub: 'You', person: me },
    ...team.members.map((m): PickRow => ({
      key: m.person.email, name: listed(m.person), person: m.person, ghost: !m.onAlcove,
      sub: m.onAlcove ? m.title ?? (addressOnly(m.person) ? undefined : m.person.email) : 'Not on Alcove yet'
    }))
  ].filter((r) => !typed || fold(r.name).includes(typed) || r.person.email.toLowerCase().includes(typed)).sort((a, b) => a.name.localeCompare(b.name));
  return <PickList label="Find someone" placeholder="Find someone" query={query} onQuery={setQuery} rows={rows} tall none="Nobody here by that name." onPress={(r) => onFind(r.person.email)} />;
}

/**
 * Someone's popover around an arch that isn't on the company's line: the team's, on a plan (features/team/OnTeam.tsx). It's
 * the same popover, with Ring, Schedule and the notes you both have, and the arch takes the focus back as it closes.
 */
export function PersonPop({ person, me = false, between, anchor }: { person: Person; me?: boolean | undefined; between: Between; anchor: TeamArchButton }) {
  const { ring, flood } = useRing();
  const pop = usePop(personPop(person.email));
  const arch = useRef<HTMLButtonElement>(null);
  const standing: Arch = { key: person.email, person, me, ghost: false, d: 0, k: 1, far: false, haze: 0, z: 1, px: 0 };
  return (
    <>
      <Popover {...pop} side="bottom" align="center" caret label={listed(person)} className="tp-pop is-person" anchor={cloneElement(anchor, { ref: arch })}>
        <About arch={standing} person={person} between={between} ring={ring} onLeave={() => { arch.current?.focus({ preventScroll: true }); pop.onOpenChange(false); }} />
      </Popover>
      {flood}
    </>
  );
}
