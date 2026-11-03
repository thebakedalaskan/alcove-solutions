/*
 * Pick people by name or email: colleagues from your company's directory, people you've had calls
 * with, or any address. The same picker invites people to a call and shares notes afterwards.
 */
import type { Person, PersonSuggestion } from '@alcove/api';
import { Avatar, Button, Chip, Icon, Popover, cn } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { isEmail } from '~/lib/parse';
import { byEmail, callName, sameEmail } from '~/lib/people';
import { q } from '~/lib/queries';

export interface PickerOptions {
  title: string;
  /** The button that finishes, e.g. "Add" or "Share". */
  cta: string;
  note: ReactNode;
  /** Addresses that are already in, so they aren't offered again. */
  skip: string[];
  preset?: Person[] | undefined;
  /** Typed in to start with, e.g. a name that still needs an address. */
  query?: string | undefined;
  after?: ReactNode;
  onDone: (people: Person[]) => void;
}

export function PeoplePicker({ open, onOpenChange, anchor, align = 'start', side = 'bottom', ...o }: PickerOptions & {
  open: boolean; onOpenChange: (open: boolean) => void; anchor: ReactNode; align?: 'start' | 'center' | 'end'; side?: 'top' | 'bottom';
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange} anchor={anchor} align={align} side={side} label={o.title} className="pick-pop">
      <Picker {...o} onDone={(p) => { onOpenChange(false); o.onDone(p); }} />
    </Popover>
  );
}

const MAX = 5;

function Picker({ title, cta, note, skip, preset, query: initial, after, onDone }: PickerOptions) {
  const [sel, setSel] = useState<Person[]>(preset ?? []);
  const [query, setQuery] = useState(initial ?? '');
  const [act, setAct] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const team = useQuery(q.team()).data;
  const found = useQuery(q.people(query.trim())).data ?? [];

  const typed = query.trim().toLowerCase();
  const taken = (p: { email: string }) => sel.some((s) => sameEmail(s, p)) || skip.some((e) => e.toLowerCase() === p.email.toLowerCase());
  const rows: PersonSuggestion[] = found.filter((s) => !taken(s.person));
  if (isEmail(typed) && !taken({ email: typed }) && !rows.some((r) => r.person.email === typed)) rows.unshift({ person: byEmail(typed), source: 'new', onAlcove: false });
  const shown = rows.slice(0, MAX);
  const active = shown[Math.min(act, shown.length - 1)];

  useEffect(() => {
    const t = requestAnimationFrame(() => { input.current?.focus({ preventScroll: true }); if (initial) input.current?.select(); });
    return () => cancelAnimationFrame(t);
  }, [initial]);

  const add = (p: Person) => {
    if (taken(p)) return;
    setSel((s) => [...s, p]);
    setQuery('');
    setAct(0);
    input.current?.focus();
  };
  /* Finishing takes whatever is typed too, so nobody has to press Enter first. */
  const done = () => {
    const out = query.trim() && active && !taken(active.person) ? [...sel, active.person] : sel;
    if (out.length) onDone(out);
  };
  const company = team?.name.split(' ')[0];

  return (
    <div className="pick">
      <div className="pick-h"><b>{title}</b></div>
      <div className="pick-field" onClick={() => input.current?.focus()}>
        {sel.map((p) => (
          <span key={p.email} className="pick-chip">
            <Avatar person={p} size={20} />{callName(p)}
            <button type="button" aria-label={`Remove ${p.name}`} onClick={(e) => { e.stopPropagation(); setSel((s) => s.filter((x) => !sameEmail(x, p))); input.current?.focus(); }}><Icon name="x" size={12} /></button>
          </span>
        ))}
        <input ref={input} value={query} placeholder={sel.length ? 'Add another' : 'Name or email'} autoComplete="off" spellCheck={false} aria-label="Name or email"
          onChange={(e) => { setQuery(e.target.value); setAct(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setAct((a) => Math.min(shown.length - 1, a + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setAct((a) => Math.max(0, a - 1)); }
            else if (e.key === 'Enter') {
              e.preventDefault();
              if (query.trim()) { if (active) add(active.person); }
              else if (sel.length) done();
              else if (active) add(active.person);
            } else if ((e.key === ',' || e.key === ' ' || e.key === 'Tab') && isEmail(typed)) { e.preventDefault(); add(byEmail(typed)); }
            else if (e.key === 'Backspace' && !query && sel.length) setSel((s) => s.slice(0, -1));
          }} />
      </div>
      <div className="pick-list" role="listbox" aria-label="Suggestions">
        {shown.length ? shown.map((r, i) => (
          <button key={r.person.email} type="button" role="option" aria-selected={r === active} className={cn('pick-row', r === active && 'on')} onMouseMove={() => setAct(i)} onClick={() => add(r.person)}>
            <Avatar person={r.person} size={32} />
            <span className="min-w-0"><b>{r.source === 'new' ? r.person.email : r.person.name}</b><small>{r.source === 'new' ? 'New to you' : r.person.email}</small></span>
            {r.source === 'team' && company ? <Chip tone="outline">{company}</Chip> : null}
          </button>
        )) : <div className="pick-empty"><Icon name="mail" size={16} />{query.trim() ? 'Type their full email address' : 'Type an email address'}</div>}
      </div>
      {after}
      <div className="pick-foot">
        <span className="pick-note">{note}</span>
        <Button variant="primary" disabled={!sel.length && !(query.trim() && active)} onClick={done}>{cta}</Button>
      </div>
    </div>
  );
}
