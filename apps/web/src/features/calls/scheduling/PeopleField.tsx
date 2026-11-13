/*
 * Who a call is with: one field of tokens, however they came, and pressing or typing in it opens the people under it as a
 * popover. Typing finds people, groups and the whole company; a group adds everyone in it; a pasted list is read at once and
 * stays one token; everyone counts once. Before anything's typed the people you're often with are listed (on your own, the
 * people you've met); once someone's in, Add someone else, without anyone already in. Someone from outside, whose calendar
 * can't be read, says on their token where they are, once you've said.
 */
import { MAX_GUESTS, type Group, type Person, type PersonSuggestion, type Team } from '@alcove/api';
import { Avatar, Faces, FlowNote, GhostArch, Icon, PersonToken, Popover, SchedField, SchedListHead, SchedListNote, SchedNote, SchedPersonOption, SchedPop, SchedRow, SchedTimes, cn } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { byEmail, callName, fold, isEmail, sameEmail } from '~/lib/people';
import { q } from '~/lib/queries';
import { readAddresses, unreadLine, type Unread } from './addresses';
import { PLACES, placeLine } from './places';
import { guestsOf, personFrom, reaches, withList, type Guests, type Token } from '../flow/draft';

/** Rows offered before anything is typed, and at most while typing. */
const OFFERED = 5;

/** A row under the field. */
type Offer =
  | { kind: 'group'; id: string; group: Group; people: Person[] }
  | { kind: 'everyone'; id: string; label: string; people: Person[] }
  | { kind: 'person'; id: string; found: PersonSuggestion };

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

/** What a token is called: someone's first name, or the group's or list's. */
export function tokenName(t: Token): string {
  if (t.kind === 'person') return t.person.name === t.person.email ? t.person.email : callName(t.person);
  return t.kind === 'list' ? 'Pasted list' : t.name;
}

/**
 * Where a guest from outside is, as you've said: on their token, Where? until you have. Only for showing their times
 * ("12:30 for Jonas"); it's kept nowhere.
 */
export interface Whereabouts {
  email: string; zone: string | null; at: Date;
  open: boolean; onOpenChange: (open: boolean) => void; onPick: (zone: string) => void;
}

export function PeopleField({ value, onChange, me, where, label = 'Add people' }: {
  value: Guests; onChange: (g: Guests) => void; me: string | undefined;
  where?: Whereabouts | undefined;
  label?: string | undefined;
}) {
  const { tokens, unread } = value;
  const list = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  /* Adding someone: the list under the field is open while the field is pressed into or has focus. */
  const [adding, setAdding] = useState(false);
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

  const offers = useMemo<Offer[]>(() => {
    const whole = everyoneOf(team);
    const isIn = (id: string) => tokens.some((t) => t.id === id);
    const term = fold(typed);
    const company: Offer[] = whole && !isIn('everyone') && (!term || fold(whole.label).includes(term)) ? [{ kind: 'everyone', id: 'everyone', ...whole }] : [];
    /* A group is offered while anyone in it isn't in yet. */
    const teams: Offer[] = (groups ?? [])
      .map((group) => ({ kind: 'group' as const, id: `group:${group.id}`, group, people: group.emails.map(directory) }))
      .filter((o) => o.people.some((p) => !reaches(tokens, p.email) && !(me && sameEmail(p, { email: me }))) && (!term || fold(o.group.name).includes(term)))
      .slice(0, typed ? OFFERED : 2);
    const rows: Offer[] = (address && stale ? [] : found ?? [])
      .filter((s) => s.person.email !== me && !reaches(tokens, s.person.email))
      .map((s) => ({ kind: 'person', id: s.person.email, found: s }));
    /* A whole address means that address, first, whatever the search has found or hasn't yet. */
    const exact = rows.find((o) => o.id.toLowerCase() === typed.toLowerCase());
    const people: Offer[] = address && !reaches(tokens, typed)
      ? [exact ?? { kind: 'person', id: typed, found: { person: byEmail(typed.toLowerCase()), source: 'new', onAlcove: false } }, ...rows.filter((o) => o !== exact)]
      : rows;
    return [...people.slice(0, Math.max(0, OFFERED - teams.length - company.length)), ...teams, ...company];
  }, [groups, found, stale, address, tokens, team, typed, me, directory]);

  const write = (next: Partial<Guests>) => onChange({ tokens, unread, ...next });
  const clear = () => { setQuery(''); setActive(-1); setHeld(null); input.current?.focus({ preventScroll: true }); };
  /* A group adds everyone in it, each their own token; the whole company stays one. */
  const take = (o: Offer) => {
    if (o.kind === 'group') {
      const fresh = o.people.filter((p, i, all) => !reaches(tokens, p.email) && !(me && sameEmail(p, { email: me })) && all.findIndex((x) => sameEmail(x, p)) === i);
      write({ tokens: [...tokens, ...fresh.map((person): Token => ({ kind: 'person', id: person.email.toLowerCase(), person }))] });
    } else if (o.kind === 'everyone') write({ tokens: [...tokens, { kind: 'everyone', id: o.id, name: o.label, people: o.people }] });
    else write({ tokens: [...tokens, { kind: 'person', id: o.id.toLowerCase(), person: o.found.person }] });
    clear();
  };
  const drop = (id: string) => { write({ tokens: tokens.filter((t) => t.id !== id) }); setHeld(null); input.current?.focus({ preventScroll: true }); };

  /* It opens as the field's pressed into, or typed in. A pasted list ends it until someone types. */
  const listing = (adding || !!typed) && (!!typed || !tokens.some((t) => t.kind === 'list'));
  const shown = listing ? offers : [];
  /* The row Enter takes: the one the arrows lit, or the first match for what's typed. While a search runs that's only a whole address. */
  const lit = stale && !address ? undefined : active >= 0 ? shown[active] : typed ? shown[0] : undefined;
  const none = !offers.length ? (!typed && !tokens.length ? 'Type someone’s email address to add them.' : typed && !address ? 'Nobody by that name yet. Type their full email address to add them.' : null) : null;
  const open = listing && (shown.length > 0 || none !== null);

  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key !== 'Backspace') setHeld(null);
    if (e.key === 'ArrowDown' && shown.length) { e.preventDefault(); setActive((a) => Math.min(shown.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp' && shown.length) { e.preventDefault(); setActive((a) => Math.max(typed ? 0 : -1, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (lit) take(lit); }
    else if (e.key === 'Escape' && (typed || adding)) { setQuery(''); setActive(-1); setAdding(false); }
    else if ((e.key === ',' || e.key === ';' || e.key === ' ' || e.key === 'Tab') && address) {
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
      <SchedRow icon="people">
        <SchedPop open={open} onClose={() => { setAdding(false); setActive(-1); }} label="People to add" className="is-people"
          anchor={(
            /* Pressing anywhere in the field puts the cursor in it, as a text box would; the tokens are its content. */
            <SchedField open={open} onPress={() => { setAdding(true); input.current?.focus(); }}>
              {tokens.map((t) => <TokenView key={t.id} t={t} held={t.id === held} where={t.kind === 'person' && where && sameEmail(t.person, where) ? where : undefined} onRemove={() => drop(t.id)} />)}
              <input ref={input} type="text" value={query} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-label={label} enterKeyHint="next"
                placeholder={tokens.length ? 'Add someone' : 'Add people'}
                role="combobox" aria-expanded={open} aria-controls={open ? list : undefined} aria-autocomplete="list"
                aria-activedescendant={open && lit ? `${list}-${shown.indexOf(lit)}` : undefined}
                onChange={(e) => { setQuery(e.target.value); setActive(e.target.value.trim() ? 0 : -1); setHeld(null); }} onKeyDown={keys} onPaste={paste}
                onFocus={() => setAdding(true)} onBlur={() => { setAdding(false); setHeld(null); }} />
            </SchedField>
          )}>
          <SchedListHead>{typed ? 'People and groups' : tokens.length ? 'Add someone else' : team ? 'Often with you' : 'People you’ve met'}</SchedListHead>
          <div id={list} role="listbox" aria-label="People to add">
            {shown.map((o, i) => <OfferRow key={o.id} o={o} id={`${list}-${i}`} on={o === lit} team={team} onPick={() => take(o)} />)}
          </div>
          {none && <SchedListNote>{none}</SchedListNote>}
        </SchedPop>
        <p className="sr-only" role="status">{heldToken ? `${tokenName(heldToken)} selected. Press Backspace again to remove it.` : ''}</p>
      </SchedRow>
      {over && <SchedNote><FlowNote icon="people">A call can invite {MAX_GUESTS} people at most, and this is {guests.length}. {tokens.some((t) => t.kind === 'list') ? 'Remove the pasted list and paste a shorter one to go on.' : 'Remove a group or some people to go on.'}</FlowNote></SchedNote>}
      {flag && (
        <SchedNote>
          <FlowNote icon="mail" actions={(
            <>
              {flag.fix && <button type="button" className="lk" onClick={() => applyFix(flag, flag.fix ?? '')}>Use it</button>}
              <button type="button" className="lk" onClick={() => write({ unread: unread.filter((u) => u !== flag) })}>Leave out</button>
            </>
          )}>{unreadLine(flag)}{unread.length > 1 ? ` ${unread.length - 1} more after this.` : ''}</FlowNote>
        </SchedNote>
      )}
    </>
  );
}

function TokenView({ t, held, where, onRemove }: { t: Token; held: boolean; where?: Whereabouts | undefined; onRemove: () => void }) {
  const name = tokenName(t);
  if (t.kind !== 'person') return <PersonToken people={t.people} label={name} count={t.people.length} held={held} removeLabel={`Remove ${name}`} onRemove={onRemove} />;
  return <PersonToken people={[t.person]} label={name} title={t.person.email} held={held} removeLabel={`Remove ${name}`} onRemove={onRemove} place={where && <Where who={callName(t.person)} where={where} />} />;
}

/** On an outside guest's token: where they are, or Where? until you've said, which lists the places. */
function Where({ who, where }: { who: string; where: Whereabouts }) {
  const place = PLACES.find((p) => p.zone === where.zone);
  const label = `Where ${who} is`;
  return (
    <Popover open={where.open} onOpenChange={where.onOpenChange} label={label} align="start" className="sc-pop is-list"
      anchor={(
        <button type="button" className={cn('sc-where', !place && 'is-unsaid')} aria-label={place ? `${label}: ${place.name}` : label}
          title={place ? placeLine(place, where.at) : undefined} onClick={(e) => e.stopPropagation()}>{place?.name ?? 'Where?'}</button>
      )}>
      <SchedTimes label={label} options={PLACES.map((p) => ({ value: p.zone, label: p.name }))} value={where.zone} near={PLACES[0]?.zone} autoFocus
        onPick={(zone) => { where.onOpenChange(false); where.onPick(zone); }} />
    </Popover>
  );
}

/** Someone invited, as a call being moved shows them: who, and what they've said. Nothing here changes. */
export const FixedToken = ({ person, state }: { person: Person; state: string }) => <PersonToken people={[person]} label={callName(person)} title={person.email} state={state} />;

function OfferRow({ o, id, on, team, onPick }: { o: Offer; id: string; on: boolean; team: Team | null | undefined; onPick: () => void }) {
  const face = o.kind === 'person'
    ? o.found.onAlcove || o.found.source !== 'new' ? <Avatar person={o.found.person} size={26} /> : <GhostArch size={24} initial={o.found.person.email} />
    : o.kind === 'group' ? <Faces people={o.people.slice(0, 2)} size={24} max={2} /> : <span className="sc-tile"><Icon name="building" size={16} /></span>;
  const title = o.kind === 'person' ? (o.found.source === 'new' ? o.found.person.email : o.found.person.name) : o.kind === 'group' ? o.group.name : o.label;
  const sub = o.kind === 'person' ? subFor(o.found, team) : o.kind === 'group' ? `Group · ${o.people.length} ${o.people.length === 1 ? 'person' : 'people'}` : `${o.people.length} people`;
  return <SchedPersonOption id={id} face={face} title={title} sub={sub} lit={on} onPick={onPick} />;
}
