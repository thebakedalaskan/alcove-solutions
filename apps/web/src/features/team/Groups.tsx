/*
 * Your groups on the Team page, as tiles with their people standing on the bottom edge. A tile opens where it is, across
 * the column: who's in it, add or take out people, start a call with everyone in it, rename it or delete it. New group is
 * a tile too: it opens to name a group and fill it from the people picker, and a group half made waits on its tile. It
 * all happens in place, with no dialogs. Groups live in your preferences; only a group's name leaves them, on the notes
 * you share with it.
 */
import { MAX_GROUPS, MAX_GROUP_NAME, MAX_GROUP_PEOPLE, NEW_GROUP, errorMessage, type Group, type NoteSummary, type Person, type PersonSuggestion } from '@alcove/api';
import { Avatar, Button, GhostArch, Icon, IconButton, Notice, PickList, Popover, useToast, type PickRow } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useRef, useState, type Ref } from 'react';
import { useCallFlow } from '~/features/calls/flow/context';
import { byEmail, callName, fold, isEmail, listNames, sameEmail, typedIn } from '~/lib/people';
import { accountQueries, useGroups } from '~/features/account/queries';
import { teamQueries } from './queries';
import { groupCalls, groupLine, listed, type Shown } from './data';
import { useOpen, usePop } from './open';

/** Groups listed before "Show all". */
const SHOWN = 8;
/** Faces on a tile, or one fewer with how many more. */
const FACES = 4;
const PRIVATE = 'Only you see your groups. Their names show on notes you share with one.';

/** What's wrong with a name for a group, if anything: it needs one, and one you don't use already. */
function nameProblem(name: string, groups: Group[], self?: string): string | undefined {
  const n = name.trim();
  if (!n) return 'Give the group a name.';
  const same = groups.find((g) => g.id !== self && g.name.trim().toLowerCase() === n.toLowerCase());
  return same ? `You already have a group called ${same.name}.` : undefined;
}
const addresses = (people: Person[]) => people.map((p) => p.email.trim().toLowerCase());

/** A group on its way: kept while you look elsewhere, until it's made or you discard it. */
export interface Draft { name: string; people: Person[] }
export const NO_DRAFT: Draft = { name: '', people: [] };
/** A group half made has something to show for it. */
const begun = (d: Draft) => d.name.trim() !== '' || d.people.length > 0;
/** Whether it can be made as it is. */
export const readyToMake = (d: Draft) => d.name.trim() !== '' && d.people.length > 0;

export function Groups({ open, onOpen, notes, person, shown, draft, onDraft }: {
  /** The group shown open: its ID, or NEW_GROUP while one is being made. */
  open: string | undefined;
  onOpen: (group: string | undefined) => void;
  notes: NoteSummary[];
  /** Anyone in a group, by address, with their name and portrait where the app knows them. */
  person: (email: string) => Person;
  shown: (p: Person) => Shown;
  draft: Draft;
  onDraft: (d: Draft) => void;
}) {
  const qc = useQueryClient();
  const prefs = useQuery(accountQueries.prefs());
  const groups = prefs.data?.groups ?? [];
  const save = useGroups();
  const toast = useToast();
  const h = useId();
  const [all, setAll] = useState(false);
  /** The group just made, closed or opened, whose tile or heading takes the focus once it's there. */
  const [toTile, setToTile] = useState<string | undefined>(undefined);
  const focused = useCallback(() => setToTile(undefined), []);
  /**
   * Focus waiting for New group: after the editor closes, or after a delete, once that group (`gone`) has left the list.
   */
  const [toNew, setToNew] = useState<{ gone?: string | undefined } | null>(null);
  const newRef = useRef<HTMLButtonElement>(null);
  const full = groups.length >= MAX_GROUPS;
  /* With as many groups as there can be, a line under them says so instead. */
  const making = open === NEW_GROUP && !full;

  useEffect(() => {
    if (!toNew || making || (toNew.gone !== undefined && groups.some((g) => g.id === toNew.gone))) return;
    newRef.current?.focus({ preventScroll: true });
    setToNew(null);
  }, [toNew, making, groups]);

  /* Every change starts from the groups as they are now, changes made a moment ago included. Each has its own promise, so its answer is never dropped for a later one's. */
  const change = (how: (now: Group[]) => Group[], done?: () => void) => {
    const now = qc.getQueryData(accountQueries.prefs().queryKey)?.groups ?? groups;
    void save.mutateAsync(how(now)).then(() => done?.(), (e: unknown) => toast(errorMessage(e), { icon: 'x' }));
  };
  const remove = (g: Group) => {
    const at = groups.findIndex((x) => x.id === g.id);
    onOpen(undefined);
    setToNew({ gone: g.id });
    change((now) => now.filter((x) => x.id !== g.id), () => toast(`Deleted ${g.name}.`, {
      icon: 'trash', ms: 5200,
      action: { label: 'Undo', onClick: () => change((now) => (now.some((x) => x.id === g.id) ? now : [...now.slice(0, at), g, ...now.slice(at)])) }
    }));
  };
  /** Leaves the editor: `discard` also forgets what was in it. Either way, focus goes back to New group. */
  const leave = (discard: boolean) => {
    if (discard) onDraft(NO_DRAFT);
    onOpen(undefined);
    setToNew({});
  };

  /* An open group further down the list shows with the rest. */
  const openAt = groups.findIndex((g) => g.id === open);
  const listedGroups = all || openAt >= SHOWN ? groups : groups.slice(0, SHOWN);
  const failed = prefs.isError && !prefs.data;

  return (
    <section className="tp-gs" aria-labelledby={h}>
      <div className="tp-h"><h2 id={h}>Groups</h2></div>
      {failed ? (
        <Notice tone="caution" icon="alert" className="tp-note">
          <span><b>Your groups didn’t load.</b> {errorMessage(prefs.error)}</span>
          <Button size="sm" loading={prefs.isFetching} onClick={() => void prefs.refetch()}>Try again</Button>
        </Notice>
      ) : (
        <div className="tp-gg">
          {listedGroups.map((g) => (open === g.id
            ? <OpenGroup key={g.id} group={g} groups={groups} calls={groupCalls(g, notes)} person={person} shown={shown} change={change} onDelete={() => remove(g)}
              onClose={() => { if (openAt >= SHOWN) setAll(true); setToTile(g.id); onOpen(undefined); }} />
            : <GroupTile key={g.id} group={g} calls={groupCalls(g, notes)} person={person} shown={shown} take={toTile === g.id} onTaken={focused} onOpen={() => onOpen(g.id)} />))}
          {making && (
            <NewGroup groups={groups} draft={draft} onDraft={onDraft} shown={shown} onClose={leave}
              onCreate={(g) => { change((now) => [...now, g]); onDraft(NO_DRAFT); onOpen(g.id); }} />
          )}
          {!making && !full && (begun(draft)
            ? <DraftTile ref={newRef} draft={draft} shown={shown} onOpen={() => onOpen(NEW_GROUP)} onDiscard={() => leave(true)} />
            : <NewTile ref={newRef} onOpen={() => onOpen(NEW_GROUP)} />)}
        </div>
      )}
      {groups.length > SHOWN && openAt < SHOWN && (
        <div className="tp-more"><Button variant="quiet" size="sm" iconRight={all ? 'up' : 'down'} aria-expanded={all} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${groups.length}`}</Button></div>
      )}
      {full && <p className="tp-hint">{MAX_GROUPS} groups, the most you can have. Delete one to make another.</p>}
    </section>
  );
}

/** Someone small: on the bottom edge of a tile, or in a list. */
const Face = ({ person, shown, size }: { person: Person; shown: (p: Person) => Shown; size: number }) =>
  (shown(person).ghost ? <GhostArch size={size} initial={listed(person)} /> : <Avatar person={person} size={size} />);

/** A group, closed: it opens where it is, and the camera calls everyone in it without opening it. */
function GroupTile({ group, calls, person, shown, take, onTaken, onOpen }: {
  group: Group; calls: number; person: (email: string) => Person; shown: (p: Person) => Shown;
  /** It's just been closed, so it takes the focus back. */
  take: boolean; onTaken: () => void; onOpen: () => void;
}) {
  const flow = useCallFlow();
  const open = useRef<HTMLButtonElement>(null);
  const people = group.emails.map(person);
  const faces = people.slice(0, people.length > FACES ? FACES - 1 : FACES);
  useEffect(() => { if (take) { open.current?.focus({ preventScroll: true }); onTaken(); } }, [take, onTaken]);
  return (
    <article className="tp-g">
      <button ref={open} type="button" className="tp-g-o" aria-expanded={false} aria-label={`Open ${group.name}`} onClick={onOpen} />
      <div className="tp-g-t"><b className="ac-clamp-1">{group.name}</b><small className="ac-clamp-1">{groupLine(group, calls)}</small></div>
      <div className="tp-g-b">
        <div className="tp-g-f">
          {faces.map((p) => <span key={p.email} className="tp-mini"><Face person={p} shown={shown} size={34} /></span>)}
          {people.length > faces.length && <span className="tp-more-n">+{people.length - faces.length}</span>}
        </div>
        <IconButton icon="video" size={17} label={`Start a call with ${group.name}`} className="tp-g-c" aria-haspopup="dialog" onClick={() => flow.start({ people, name: group.name })} />
      </div>
    </article>
  );
}

function NewTile({ ref, onOpen }: { ref: Ref<HTMLButtonElement>; onOpen: () => void }) {
  return (
    <article className="tp-g is-new">
      <button ref={ref} type="button" className="tp-g-o" aria-label="New group" onClick={onOpen} />
      <div className="tp-g-t"><b><Icon name="plus" size={16} />New group</b></div>
      <div className="tp-g-b"><div className="tp-g-f" aria-hidden="true">{[0, 1, 2].map((i) => <span key={i} className="tp-mini"><GhostArch size={34} /></span>)}</div></div>
    </article>
  );
}

/** A group half made, waiting on its tile: it opens to carry on, and × throws it away. */
function DraftTile({ ref, draft, shown, onOpen, onDiscard }: { ref: Ref<HTMLButtonElement>; draft: Draft; shown: (p: Person) => Shown; onOpen: () => void; onDiscard: () => void }) {
  const name = draft.name.trim();
  return (
    <article className="tp-g is-draft">
      <button ref={ref} type="button" className="tp-g-o" aria-label={`Keep making ${name || 'this group'}`} onClick={onOpen} />
      <div className="tp-g-t"><b className="ac-clamp-1">{name || 'New group'}</b><small className="ac-clamp-1">{draft.people.length ? listNames(draft.people) : 'Not made yet'}</small></div>
      <div className="tp-g-b">
        <div className="tp-g-f">{draft.people.slice(0, FACES).map((p) => <span key={p.email} className="tp-mini"><Face person={p} shown={shown} size={34} /></span>)}</div>
        <IconButton icon="x" size={17} label="Discard this group" className="tp-g-c" onClick={onDiscard} />
      </div>
    </article>
  );
}

/** A group, open across the column, with everything you can do to it. */
function OpenGroup({ group, groups, calls, person, shown, change, onDelete, onClose }: {
  group: Group; groups: Group[]; calls: number; person: (email: string) => Person; shown: (p: Person) => Shown;
  change: (how: (now: Group[]) => Group[]) => void; onDelete: () => void; onClose: () => void;
}) {
  const flow = useCallFlow();
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const del = usePop(`delete ${group.id}`);
  const box = useRef<HTMLElement>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const pen = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const people = group.emails.map(person);
  const full = group.emails.length >= MAX_GROUP_PEOPLE;

  /* It comes into view however it was opened, from its tile or the address, and takes the focus from the tile it replaced. */
  useEffect(() => {
    box.current?.scrollIntoView({ block: 'nearest' });
    head.current?.focus({ preventScroll: true });
  }, []);
  /* After Enter or Escape in the name, focus goes back to the pen; clicking away leaves it where it went. */
  useEffect(() => { if (!renaming && refocus.current) { refocus.current = false; pen.current?.focus(); } }, [renaming]);

  /* Each change applies to the group as it is now. */
  const edit = (how: (g: Group) => Group) => change((now) => now.map((g) => (g.id === group.id ? how(g) : g)));
  const add = (picked: Person[]) => {
    const fresh = addresses(picked).filter((e) => !group.emails.includes(e));
    const left = fresh.length - (MAX_GROUP_PEOPLE - group.emails.length);
    if (left > 0) toast(`A group holds ${MAX_GROUP_PEOPLE} people, so ${left} of them ${left === 1 ? 'wasn’t' : 'weren’t'} added.`, { icon: 'people', ms: 5200 });
    if (fresh.length && left < fresh.length) edit((g) => ({ ...g, emails: [...new Set([...g.emails, ...fresh])].slice(0, MAX_GROUP_PEOPLE) }));
  };
  const take = (p: Person) => edit((g) => (g.emails.length > 1 ? { ...g, emails: g.emails.filter((e) => !sameEmail({ email: e }, p)) } : g));
  const doneRenaming = (to: string | undefined, focusPen: boolean) => {
    if (to !== undefined && to !== group.name) edit((g) => ({ ...g, name: to }));
    refocus.current = focusPen;
    setRenaming(false);
  };

  return (
    <article ref={box} className="tp-o" aria-label={group.name}>
      <header className="tp-o-h">
        <div className="tp-o-n">
          {renaming
            ? <NameLine name={group.name} problem={(to) => nameProblem(to, groups, group.id)} onDone={doneRenaming} />
            : <><h3 ref={head} tabIndex={-1} className="ac-clamp-1">{group.name}</h3><small>{groupLine(group, calls)}</small></>}
        </div>
        <div className="tp-o-a">
          <Button size="sm" icon="video" aria-haspopup="dialog" className="is-tint" onClick={() => flow.start({ people, name: group.name })}>Start a call</Button>
          <AddPeople name={group.id} title={`Add people to ${group.name}`} skip={group.emails} shown={shown} disabled={full} onDone={add} />
          <IconButton ref={pen} icon="pen" size={17} label={`Rename ${group.name}`} onClick={() => setRenaming(true)} />
          <Popover {...del} label={`Delete ${group.name}`} align="end" caret className="tp-pop is-del"
            anchor={<IconButton icon="trash" size={17} label={`Delete ${group.name}`} />}>
            <button type="button" className="ac-pop-item is-caution" onClick={() => { del.onOpenChange(false); onDelete(); }}>
              <Icon name="trash" size={18} /><span><b className="ac-clamp-2">Delete {group.name}</b><small>Notes you shared with it stay with the people who have them.</small></span>
            </button>
          </Popover>
          <IconButton icon="up" size={17} label={`Close ${group.name}`} onClick={onClose} />
        </div>
      </header>
      <Members people={people} group={group.name} shown={shown} onRemove={group.emails.length > 1 ? take : undefined} onEmptied={() => head.current?.focus({ preventScroll: true })} />
      {full && <p className="tp-hint">{MAX_GROUP_PEOPLE} people, the most a group can have.</p>}
    </article>
  );
}

/**
 * The people in a group, each with an × to take them out (`onRemove`; left out while one person is all it has). An ×
 * goes with its person, so focus moves to the next one's, or to `onEmptied` once there are none left to press.
 */
function Members({ people, group, shown, onRemove, onEmptied }: { people: Person[]; group: string; shown: (p: Person) => Shown; onRemove?: ((p: Person) => void) | undefined; onEmptied: () => void }) {
  const list = useRef<HTMLUListElement>(null);
  const taken = useRef<{ at: number; from: number } | null>(null);
  useEffect(() => {
    const was = taken.current;
    if (!was || people.length === was.from) return;
    taken.current = null;
    const left = list.current?.querySelectorAll('button');
    const next = left?.[Math.min(was.at, left.length - 1)];
    if (next) next.focus({ preventScroll: true }); else onEmptied();
  }, [people.length, onEmptied]);
  return (
    <ul ref={list} className="tp-ms" aria-label={`People in ${group}`}>
      {people.map((p, i) => {
        const about = shown(p).about;
        return (
          <li key={p.email} className="tp-m">
            <Face person={p} shown={shown} size={34} />
            <span className="tp-l-t"><b className="ac-clamp-1">{listed(p)}</b>{about && <small className="ac-clamp-1">{about}</small>}</span>
            {onRemove && <IconButton icon="x" size={15} label={`Take ${listed(p)} out of ${group}`} title={`Take ${callName(p)} out`} onClick={() => { taken.current = { at: i, from: people.length }; onRemove(p); }} />}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A group's name being typed: Enter keeps it (or says what's wrong with it), Escape leaves it as it was,
 * and clicking away keeps it when it's fine. `onDone` gets the new name (or nothing, to keep the old one),
 * and whether focus should go back to the pen: after Enter or Escape, not after clicking away.
 */
function NameLine({ name, problem, onDone }: { name: string; problem: (to: string) => string | undefined; onDone: (to: string | undefined, focusPen: boolean) => void }) {
  const [text, setText] = useState(name);
  const [error, setError] = useState<string | undefined>(undefined);
  const said = useId();
  const closed = useRef(false);
  const close = (to: string | undefined, focusPen: boolean) => { if (closed.current) return; closed.current = true; onDone(to, focusPen); };
  return (
    <>
      <input data-1p-ignore className="tp-name" autoFocus value={text} maxLength={MAX_GROUP_NAME} aria-label="Group name"
        aria-invalid={error !== undefined} aria-describedby={error ? said : undefined}
        onChange={(e) => { setText(e.target.value); setError(undefined); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); const p = problem(text); if (p) setError(p); else close(text.trim(), true); }
          else if (e.key === 'Escape') { e.preventDefault(); close(undefined, true); }
        }}
        onBlur={() => close(problem(text) ? undefined : text.trim(), false)} />
      {error && <small id={said} className="tp-err" role="alert">{error}</small>}
    </>
  );
}

/**
 * A group being made, at the top of the tiles: its name, then its people from the picker. Enter in the name opens the
 * picker until someone's in it, then makes the group. Escape (or looking elsewhere) keeps the draft for next time; ×
 * discards it.
 */
function NewGroup({ groups, draft, onDraft, shown, onClose, onCreate }: {
  groups: Group[]; draft: Draft; onDraft: (d: Draft) => void; shown: (p: Person) => Shown; onClose: (discard: boolean) => void; onCreate: (g: Group) => void;
}) {
  const { open } = useOpen();
  const picking = usePop('add new');
  const [error, setError] = useState<string | undefined>(undefined);
  const said = useId();
  const named = useRef<HTMLInputElement>(null);
  const { name, people } = draft;
  const ready = readyToMake(draft);
  const create = () => {
    const p = nameProblem(name, groups);
    if (p) { setError(p); return; }
    if (!people.length) { picking.onOpenChange(true); return; }
    onCreate({ id: crypto.randomUUID(), name: name.trim(), emails: addresses(people) });
  };
  const add = (picked: Person[]) => onDraft({ name, people: [...people, ...picked.filter((p) => !people.some((h) => sameEmail(h, p)))].slice(0, MAX_GROUP_PEOPLE) });
  return (
    <article className="tp-o" aria-label="New group">
      <header className="tp-o-h">
        <div className="tp-o-n">
          <input data-1p-ignore ref={named} className="tp-name" autoFocus value={name} maxLength={MAX_GROUP_NAME} placeholder="Name it, like Design" aria-label="New group’s name"
            aria-invalid={error !== undefined} aria-describedby={error ? said : undefined}
            onChange={(e) => { onDraft({ name: e.target.value, people }); setError(undefined); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); create(); }
              else if (e.key === 'Escape') { e.preventDefault(); onClose(false); }
            }} />
          {error && <small id={said} className="tp-err" role="alert">{error}</small>}
        </div>
        <div className="tp-o-a">
          <AddPeople name="new" title={name.trim() ? `Add people to ${name.trim()}` : 'Add people to the group'} skip={addresses(people)} shown={shown} disabled={people.length >= MAX_GROUP_PEOPLE} onDone={add} />
          <Button size="sm" variant={ready && open === undefined ? 'primary' : 'secondary'} disabled={!ready} onClick={create}>Create group</Button>
          <IconButton icon="x" size={17} label="Discard this group" onClick={() => onClose(true)} />
        </div>
      </header>
      {people.length > 0
        ? <Members people={people} group={name.trim() || 'the new group'} shown={shown} onEmptied={() => named.current?.focus()}
          onRemove={(p) => { onDraft({ name, people: people.filter((h) => !sameEmail(h, p)) }); if (people.length === 1) named.current?.focus(); }} />
        : <p className="tp-empty"><Icon name="lock" size={15} />{PRIVATE}</p>}
    </article>
  );
}

/** Add people: anyone you could reach, ticked and added together. */
function AddPeople({ name, title, skip, shown, disabled, onDone }: { name: string; title: string; skip: string[]; shown: (p: Person) => Shown; disabled: boolean; onDone: (people: Person[]) => void }) {
  const pop = usePop(`add ${name}`);
  return (
    <Popover {...pop} anchor={<Button size="sm" icon="addUser" disabled={disabled}>Add people</Button>} align="end" caret label={title} className="tp-pop is-list">
      <AddList skip={skip} shown={shown} onDone={(people) => { pop.onOpenChange(false); onDone(people); }} />
    </Popover>
  );
}

const whereFrom = (s: PersonSuggestion, about: string | undefined) =>
  (s.source === 'new' ? 'New to you' : about ?? (s.source === 'team' ? 'On your team' : 'From your calls'));

function AddList({ skip, shown, onDone }: { skip: string[]; shown: (p: Person) => Shown; onDone: (people: Person[]) => void }) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<PersonSuggestion[]>([]);
  const typed = typedIn(query);
  const found = useQuery(teamQueries.people(typed)).data ?? [];
  const inAlready = (p: { email: string }) => skip.some((e) => sameEmail({ email: e }, p));
  const has = (p: { email: string }) => picked.some((x) => sameEmail(x.person, p));
  const matches = (p: Person) => !typed || fold(p.name).includes(fold(typed)) || p.email.toLowerCase().includes(typed);
  const row = (s: PersonSuggestion): PickRow => {
    const about = shown(s.person);
    return { key: s.person.email, name: s.source === 'new' ? s.person.email : listed(s.person), sub: whereFrom(s, about.about), person: s.person, ghost: about.ghost, on: has(s.person) };
  };
  const pool = found.filter((s) => !inAlready(s.person));
  /* A whole address counts as it's typed, whoever it is: the search answers with it too, and finishing takes it, so nobody has to press Enter first. */
  const whole = isEmail(typed);
  const offered: PersonSuggestion | undefined = whole && !inAlready({ email: typed }) && !has({ email: typed })
    ? pool.find((s) => sameEmail(s.person, { email: typed })) ?? { person: byEmail(typed), source: 'new', onAlcove: false } : undefined;
  const rows: PickRow[] = [
    ...(offered ? [{ ...row(offered), on: true, typed: true }] : []),
    ...picked.filter((s) => matches(s.person) && !pool.some((x) => sameEmail(x.person, s.person))).map(row),
    ...pool.filter((s) => s !== offered).map(row)
  ];
  const going = (offered ? [...picked, offered] : picked).map((s) => s.person);
  const done = () => { if (going.length) onDone(going); };
  const toggle = (r: PickRow) => setPicked((now) => {
    if (now.some((x) => sameEmail(x.person, r.person))) return now.filter((x) => !sameEmail(x.person, r.person));
    const s = offered && sameEmail(offered.person, r.person) ? offered : pool.find((x) => sameEmail(x.person, r.person));
    return s ? [...now, s] : now;
  });
  return (
    <PickList label="Name or email" query={query} onQuery={setQuery} address={whole ? typed : undefined} rows={rows} ticks
      none={whole && inAlready({ email: typed }) ? 'They’re in this group already.' : typed ? 'Type their full email address.' : 'Nobody else to add.'}
      onPress={toggle} onFinish={done}
      foot={<>
        <span className="tp-priv"><Icon name="lock" size={14} />Only you see your groups</span>
        <Button variant={going.length ? 'primary' : 'secondary'} size="sm" disabled={!going.length} onClick={done}>{going.length ? `Add ${going.length}` : 'Add'}</Button>
      </>} />
  );
}
