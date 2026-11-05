/*
 * Pick people by name or email: colleagues from your company's directory, people you've had calls
 * with, or any address. The same picker shares notes afterwards (where it offers your groups first), and (offering
 * only people on Alcove) rings someone else in the lobby.
 */
import type { Group, Person, PersonSuggestion } from '@alcove/api';
import { Avatar, Button, Chip, GroupChip, Icon, Popover, cn } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { byEmail, callName, fold, isEmail, sameEmail } from '~/lib/people';
import { q } from '~/lib/queries';

export interface PickerOptions {
  title: string;
  /** The button that finishes, e.g. "Add" or "Share". */
  cta: string;
  note: ReactNode;
  /** Addresses that are already in, so they aren't offered again. */
  skip: string[];
  preset?: Person[] | undefined;
  /** Offer only these people, matched by name or address as you type, instead of anyone you could reach. */
  from?: PersonSuggestion[] | undefined;
  /** Your groups, offered before people until one is chosen: it reaches all of its people at once, under its name. */
  groups?: Group[] | undefined;
  after?: ReactNode;
  /** The people chosen, and the group when one was. */
  onDone: (people: Person[], group?: Group | undefined) => void;
}

export function PeoplePicker({ open, onOpenChange, anchor, align = 'start', side = 'bottom', stage = false, ...o }: PickerOptions & {
  open: boolean; onOpenChange: (open: boolean) => void; anchor: ReactNode; align?: 'start' | 'center' | 'end'; side?: 'top' | 'bottom';
  /** It opens on the night stage. */
  stage?: boolean | undefined;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange} anchor={anchor} align={align} side={side} stage={stage} label={o.title} className="pick-pop">
      <Picker {...o} onDone={(p, g) => { onOpenChange(false); o.onDone(p, g); }} />
    </Popover>
  );
}

const MAX = 5;
/** Under a suggestion's name: their address, or for someone known only by their address, where they come from. */
const origin = (r: PersonSuggestion) =>
  r.source === 'new' ? 'New to you' : r.person.name !== r.person.email ? r.person.email : r.source === 'team' ? 'On your team' : 'From your calls';
/** Groups offered before anything is typed; typing finds any of them. */
const GROUPS_FIRST = 3;

function Picker({ title, cta, note, skip, preset, from, groups, after, onDone }: PickerOptions) {
  const [sel, setSel] = useState<Person[]>(preset ?? []);
  const [group, setGroup] = useState<Group | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [act, setAct] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const team = useQuery(q.team()).data;
  const found = useQuery({ ...q.people(query.trim()), enabled: !from }).data ?? [];

  const typed = query.trim().toLowerCase();
  const taken = (p: { email: string }) => sel.some((s) => sameEmail(s, p)) || skip.some((e) => e.toLowerCase() === p.email.toLowerCase());
  const pool = from ? from.filter((s) => !typed || fold(s.person.name).includes(fold(typed)) || s.person.email.toLowerCase().includes(typed)) : found;
  const rows: PersonSuggestion[] = pool.filter((s) => !taken(s.person));
  if (!from && isEmail(typed) && !taken({ email: typed }) && !rows.some((r) => r.person.email === typed)) rows.unshift({ person: byEmail(typed), source: 'new', onAlcove: false });
  const shown = rows.slice(0, MAX);
  /* Your groups come first, until one is chosen: the ones whose names match what's typed, if anyone in them is new. */
  const fresh = (g: Group) => g.emails.filter((e) => !taken({ email: e })).length;
  const offered = group ? [] : (groups ?? []).filter((g) => fresh(g) > 0 && (!typed || fold(g.name).includes(fold(typed)))).slice(0, typed ? MAX : GROUPS_FIRST);
  const at = Math.min(act, offered.length + shown.length - 1);
  const activeGroup = offered[at];
  const active = shown[at - offered.length];

  useEffect(() => {
    const t = requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(t);
  }, []);

  const add = (p: Person) => {
    if (taken(p)) return;
    setSel((s) => [...s, p]);
    setQuery('');
    setAct(0);
    input.current?.focus();
  };
  const choose = (g: Group) => {
    setGroup(g);
    setQuery('');
    setAct(0);
    input.current?.focus();
  };
  /** Takes the highlighted suggestion: a group or a person. */
  const pick = () => { if (activeGroup) choose(activeGroup); else if (active) add(active.person); };
  /* Finishing takes whatever is typed too, so nobody has to press Enter first. */
  const done = () => {
    const out = query.trim() && active && !taken(active.person) ? [...sel, active.person] : sel;
    if (out.length || group) onDone(out, group);
  };
  const company = team?.name.split(' ')[0];

  return (
    <div className="pick">
      <div className="pick-h"><b>{title}</b></div>
      <div className="pick-field" onClick={() => input.current?.focus()}>
        {group && <GroupChip name={group.name} count={group.emails.length} onRemove={() => { setGroup(undefined); input.current?.focus(); }} />}
        {sel.map((p) => (
          <span key={p.email} className="pick-chip">
            <Avatar person={p} size={20} />{callName(p)}
            <button type="button" aria-label={`Remove ${p.name}`} onClick={(e) => { e.stopPropagation(); setSel((s) => s.filter((x) => !sameEmail(x, p))); input.current?.focus(); }}><Icon name="x" size={12} /></button>
          </span>
        ))}
        <input ref={input} value={query} placeholder={sel.length || group ? 'Add another' : groups?.length ? 'Name, email or group' : 'Name or email'} autoComplete="off" spellCheck={false} aria-label={groups?.length ? 'Name, email or group' : 'Name or email'}
          onChange={(e) => { setQuery(e.target.value); setAct(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setAct((a) => Math.min(offered.length + shown.length - 1, a + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setAct((a) => Math.max(0, a - 1)); }
            else if (e.key === 'Enter') {
              e.preventDefault();
              if (query.trim()) pick();
              else if (sel.length || group) done();
              else pick();
            } else if (!from && (e.key === ',' || e.key === ' ' || e.key === 'Tab') && isEmail(typed)) { e.preventDefault(); add(byEmail(typed)); }
            else if (e.key === 'Backspace' && !query && sel.length) setSel((s) => s.slice(0, -1));
            else if (e.key === 'Backspace' && !query && group) setGroup(undefined);
          }} />
      </div>
      <div className="pick-list" role="listbox" aria-label="Suggestions">
        {offered.map((g, i) => {
          const already = g.emails.length - fresh(g);
          return (
            <button key={g.id} type="button" role="option" aria-selected={g === activeGroup} className={cn('pick-row', g === activeGroup && 'on')} onMouseMove={() => setAct(i)} onClick={() => choose(g)}>
              <span className="pick-hash"><Icon name="hash" size={16} /></span>
              <span className="min-w-0"><b>{g.name}</b><small>{g.emails.length} {g.emails.length === 1 ? 'person' : 'people'}{already ? `, ${already} already ${already === 1 ? 'has' : 'have'} them` : ''}</small></span>
            </button>
          );
        })}
        {shown.length ? shown.map((r, i) => (
          <button key={r.person.email} type="button" role="option" aria-selected={r === active} className={cn('pick-row', r === active && 'on')} onMouseMove={() => setAct(offered.length + i)} onClick={() => add(r.person)}>
            <Avatar person={r.person} size={32} />
            <span className="min-w-0"><b>{r.source === 'new' ? r.person.email : r.person.name}</b><small>{origin(r)}</small></span>
            {r.source === 'team' && company && !from ? <Chip tone="outline">{company}</Chip> : null}
          </button>
        )) : from
          ? <div className="pick-empty"><Icon name="search" size={16} />{query.trim() ? 'Nobody here by that name or address' : 'Nobody else to add'}</div>
          : <div className="pick-empty"><Icon name="mail" size={16} />{query.trim() ? 'Type their full email address' : 'Type an email address'}</div>}
      </div>
      {after}
      <div className="pick-foot">
        <span className="pick-note">{note}</span>
        <Button variant="primary" disabled={!sel.length && !group && !(query.trim() && active)} onClick={done}>{cta}</Button>
      </div>
    </div>
  );
}
