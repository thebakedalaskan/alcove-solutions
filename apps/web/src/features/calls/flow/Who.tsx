/*
 * Who: one field that holds everyone, however they came. Typing finds people, groups and the whole company; a pasted
 * list is read at once and stays one token; a group, the company and a list can overlap, and everyone counts once.
 */
import { MAX_GUESTS, type Group, type Person, type PersonSuggestion, type Team } from '@alcove/api';
import { Avatar, FlowBody, FlowNote, Icon, PersonToken, QuadFaces, cn } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { byEmail, callName, fold, isEmail, sameEmail } from '~/lib/people';
import { q } from '~/lib/queries';
import { readAddresses, unreadLine, type Unread } from '../scheduling/addresses';
import { guestsOf, personFrom, reaches, withList, type Guests, type Token } from './draft';

/** Rows offered before anything is typed, and at most while typing. */
const OFFERED = 5;

/** A row under the field. */
type Offer =
  | { kind: 'group'; id: string; group: Group; people: Person[] }
  | { kind: 'everyone'; id: string; label: string; people: Person[] }
  | { kind: 'person'; id: string; found: PersonSuggestion };

function tokenFor(o: Offer): Token {
  if (o.kind === 'group') return { kind: 'group', id: o.id, name: o.group.name, people: o.people };
  if (o.kind === 'everyone') return { kind: 'everyone', id: o.id, name: o.label, people: o.people };
  return { kind: 'person', id: o.id.toLowerCase(), person: o.found.person };
}

/** Anyone whose address we know, for groups, which hold only addresses. */
function useDirectory(): (email: string) => Person {
  const team = useQuery(q.team()).data;
  const known = useQuery(q.people('')).data;
  return useMemo(() => {
    const people = new Map<string, Person>();
    for (const s of known ?? []) people.set(s.person.email.toLowerCase(), s.person);
    for (const m of team?.members ?? []) people.set(m.person.email.toLowerCase(), m.person);
    return (email: string) => people.get(email.toLowerCase()) ?? byEmail(email);
  }, [team, known]);
}

/** The people of the company, under what can honestly be said of them: only a directory knows who everyone is. */
function everyoneOf(team: Team | null | undefined): { label: string; people: Person[] } | null {
  if (!team?.members.length) return null;
  const company = team.name.split(' ')[0] ?? team.name;
  const directory = team.members.some((m) => m.title);
  return { label: directory ? `Everyone at ${company}` : `Everyone you meet at ${company}`, people: team.members.map((m) => m.person) };
}

/** Under a person's name: what they do at the company, or their address. */
function subFor(s: PersonSuggestion, team: Team | null | undefined): string {
  if (s.source === 'new') return 'New to you';
  const title = team?.members.find((m) => sameEmail(m.person, s.person))?.title;
  return title ?? (s.person.name !== s.person.email ? s.person.email : s.source === 'team' ? 'On your team' : 'From your calls');
}

export function Who({ value, onChange, me, back, onNext, foot, heading = 'Who’s it with?' }: {
  value: Guests; onChange: (g: Guests) => void; me: string | undefined; back: boolean;
  /** Moves on, with whoever was still being typed taken in. */
  onNext: (g: Guests) => void;
  /** The foot. `next` is the way on; `over` says the list is too long to go on with. */
  foot: (o: { next: () => void; over: boolean }) => ReactNode;
  heading?: string | undefined;
}) {
  const { tokens, unread } = value;
  const list = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  /* The token the first Backspace selected: the second takes it, so a pasted list can't go at one press. */
  const [held, setHeld] = useState<string | null>(null);
  const team = useQuery(q.team()).data;
  const groups = useQuery(q.prefs()).data?.groups;
  const typed = query.trim();
  const search = useQuery(q.people(typed));
  const found = search.data;
  /* The rows are still the last search's: they stay in view, but they don't answer what's typed now. */
  const stale = search.isPlaceholderData;
  const address = isEmail(typed);
  const directory = useDirectory();
  const guests = useMemo(() => guestsOf(tokens, me), [tokens, me]);
  const over = guests.length > MAX_GUESTS;

  useEffect(() => {
    /* A phone's keyboard would cover the list before anyone has read it. */
    if (matchMedia('(hover: hover)').matches) input.current?.focus({ preventScroll: true });
  }, []);

  const offers = useMemo<Offer[]>(() => {
    const whole = everyoneOf(team);
    const isIn = (id: string) => tokens.some((t) => t.id === id);
    const term = fold(typed);
    const company: Offer[] = whole && !isIn('everyone') && (!term || fold(whole.label).includes(term)) ? [{ kind: 'everyone', id: 'everyone', ...whole }] : [];
    const teams: Offer[] = (groups ?? [])
      .filter((g) => !isIn(`group:${g.id}`) && (!term || fold(g.name).includes(term)))
      .slice(0, typed ? OFFERED : 2)
      .map((group) => ({ kind: 'group', id: `group:${group.id}`, group, people: group.emails.map(directory) }));
    const rows: Offer[] = (address && stale ? [] : found ?? [])
      .filter((s) => s.person.email !== me && !reaches(tokens, s.person.email))
      .map((s) => ({ kind: 'person', id: s.person.email, found: s }));
    /* A whole address means that address, first, whatever the search has found or hasn't yet. */
    const exact = rows.find((o) => o.id.toLowerCase() === typed.toLowerCase());
    const people: Offer[] = address && !reaches(tokens, typed)
      ? [exact ?? { kind: 'person', id: typed, found: { person: byEmail(typed.toLowerCase()), source: 'new', onAlcove: false } }, ...rows.filter((o) => o !== exact)]
      : rows;
    return [...teams, ...people.slice(0, Math.max(0, OFFERED - teams.length - company.length)), ...company];
  }, [groups, found, stale, address, tokens, team, typed, me, directory]);

  const write = (next: Partial<Guests>) => onChange({ tokens, unread, ...next });
  const clear = () => { setQuery(''); setActive(-1); setHeld(null); input.current?.focus({ preventScroll: true }); };
  const take = (o: Offer) => { write({ tokens: [...tokens, tokenFor(o)] }); clear(); };
  const drop = (id: string) => { write({ tokens: tokens.filter((t) => t.id !== id) }); setHeld(null); input.current?.focus({ preventScroll: true }); };

  /* After a pasted list, what's being offered stops being the point, until someone types. */
  const shown = typed || !tokens.some((t) => t.kind === 'list') ? offers : [];
  /* The row Enter takes: the one the arrows lit, or the first match for what's typed. While a search runs that's only a whole address. */
  const lit = stale && !address ? undefined : active >= 0 ? shown[active] : typed ? shown[0] : undefined;
  const next = () => {
    /* Something typed that isn't anyone yet stays here, where the line under the field says what it needs. */
    if (typed && !lit) { input.current?.focus(); return; }
    if (!over) onNext({ tokens: lit ? [...tokens, tokenFor(lit)] : tokens, unread });
  };

  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key !== 'Backspace') setHeld(null);
    if (e.key === 'ArrowDown' && shown.length) { e.preventDefault(); setActive((a) => Math.min(shown.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp' && shown.length) { e.preventDefault(); setActive((a) => Math.max(typed ? 0 : -1, a - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (lit) take(lit);
      else if (!typed) next();
    } else if ((e.key === ',' || e.key === ';' || e.key === ' ' || e.key === 'Tab') && address) {
      e.preventDefault();
      if (!reaches(tokens, typed)) write({ tokens: [...tokens, { kind: 'person', id: typed.toLowerCase(), person: byEmail(typed.toLowerCase()) }] });
      clear();
    } else if (e.key === 'Backspace' && !query && !e.repeat) {
      /* Holding Backspace to clear what was typed stops at the field's edge. */
      const last = tokens.at(-1);
      if (last) { if (held === last.id) drop(last.id); else setHeld(last.id); }
    }
  };

  /* Anything with an address in it is read; a word or two just goes in the field, to search with. */
  const paste = (e: ClipboardEvent<HTMLInputElement>) => {
    const read = readAddresses(e.clipboardData.getData('text'));
    if (!read.addresses.length && !read.unread.some((u) => u.raw.includes('@'))) return;
    e.preventDefault();
    const incoming = read.addresses.filter((a) => a.email !== me?.toLowerCase() && !reaches(tokens, a.email));
    const [only] = incoming;
    const flagged = [...unread, ...read.unread.filter((u) => !unread.some((x) => x.raw === u.raw))];
    if (only && read.addresses.length === 1) write({ tokens: [...tokens, { kind: 'person', id: only.email, person: personFrom(only) }], unread: flagged });
    else write({ tokens: incoming.length ? withList(tokens, incoming.map(personFrom)) : tokens, unread: flagged });
    clear();
  };

  const [flag] = unread;
  const heldToken = tokens.find((t) => t.id === held);
  const applyFix = (u: Unread, email: string) => write({ unread: unread.filter((x) => x !== u), tokens: reaches(tokens, email) ? tokens : withList(tokens, [byEmail(email)]) });

  return (
    <>
      <FlowBody back={back}>
        <h2>{heading}</h2>
        {/* Pressing anywhere in the field puts the cursor in it, as a text box would; the tokens are its content. */}
        <div className="cf-field" onClick={() => input.current?.focus()}>
          {tokens.map((t) => <TokenView key={t.id} t={t} held={t.id === held} onRemove={() => drop(t.id)} />)}
          <input ref={input} type="text" value={query} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-label="Add people" enterKeyHint="next"
            placeholder={tokens.length ? 'Add someone else' : `${team ? 'Name, email or group' : 'Name or email'}. You can paste a list.`}
            role="combobox" aria-expanded={shown.length > 0} aria-controls={list} aria-autocomplete="list"
            aria-activedescendant={lit ? `${list}-${shown.indexOf(lit)}` : undefined}
            onChange={(e) => { setQuery(e.target.value); setActive(e.target.value.trim() ? 0 : -1); setHeld(null); }} onKeyDown={keys} onPaste={paste} onBlur={() => setHeld(null)} />
        </div>
        <p className="sr-only" role="status">{heldToken ? `${tokenName(heldToken)} selected. Press Backspace again to remove it.` : ''}</p>
        {over && <FlowNote icon="people">A call can invite {MAX_GUESTS} people at most, and this is {guests.length}. {tokens.some((t) => t.kind === 'list') ? 'Remove the pasted list and paste a shorter one to go on.' : 'Remove a group or some people to go on.'}</FlowNote>}
        {flag && (
          <FlowNote icon="mail" actions={(
            <>
              {flag.fix && <button type="button" className="lk" onClick={() => applyFix(flag, flag.fix ?? '')}>Use it</button>}
              <button type="button" className="lk" onClick={() => write({ unread: unread.filter((u) => u !== flag) })}>Leave out</button>
            </>
          )}>{unreadLine(flag)}{unread.length > 1 ? ` ${unread.length - 1} more after this.` : ''}</FlowNote>
        )}
        {shown.length > 0 && !typed && <div className="cf-k">{team ? 'Often with you' : 'People you’ve met'}</div>}
        <div id={list} role="listbox" aria-label="People to add" className="cf-list">
          {shown.map((o, i) => <OfferRow key={o.id} o={o} id={`${list}-${i}`} on={o === lit} team={team} onPick={() => take(o)} />)}
        </div>
        {!offers.length && !typed && !tokens.length && <p className="cf-sub">Type someone’s email address to add them.</p>}
        {!offers.length && typed && !address && <p className="cf-sub">Nobody by that name yet. Type their full email address to add them.</p>}
      </FlowBody>
      {foot({ next, over })}
    </>
  );
}

/** What a token is called. */
function tokenName(t: Token): string {
  if (t.kind === 'person') return t.person.name === t.person.email ? t.person.email : callName(t.person);
  return t.kind === 'list' ? 'Pasted list' : t.name;
}

function TokenView({ t, held, onRemove }: { t: Token; held: boolean; onRemove: () => void }) {
  const label = tokenName(t);
  if (t.kind === 'person') return <PersonToken people={[t.person]} label={label} title={t.person.email} held={held} removeLabel={`Remove ${t.person.name}`} onRemove={onRemove} />;
  return <PersonToken people={t.people} label={label} count={t.people.length} held={held} removeLabel={`Remove ${label}`} onRemove={onRemove} />;
}

function OfferRow({ o, id, on, team, onPick }: { o: Offer; id: string; on: boolean; team: Team | null | undefined; onPick: () => void }) {
  const face = o.kind === 'person'
    ? <Avatar person={o.found.person} size={36} />
    : o.kind === 'group' ? <QuadFaces people={o.people} /> : <span className="cf-tile"><Icon name="building" size={18} /></span>;
  const title = o.kind === 'person' ? (o.found.source === 'new' ? o.found.person.email : o.found.person.name) : o.kind === 'group' ? o.group.name : o.label;
  const sub = o.kind === 'person' ? subFor(o.found, team) : o.kind === 'group' ? `Group · ${o.people.length} ${o.people.length === 1 ? 'person' : 'people'}` : `${o.people.length} people`;
  return (
    <button type="button" id={id} role="option" aria-selected={on} tabIndex={-1} className={cn('cf-row', on && 'on')} onClick={onPick}>
      <span className="cf-face">{face}</span>
      <span className="min-w-0"><b className="ac-clamp-1">{title}</b><small className="ac-clamp-1">{sub}</small></span>
      <span className="plus"><Icon name="plus" size={17} /></span>
    </button>
  );
}
