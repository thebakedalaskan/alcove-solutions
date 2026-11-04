/*
 * Your groups on the Team page: each with how many people are in it and how many calls you've had with
 * them. Open one to see who's in it, add or take out people, start a call with everyone in it, rename it
 * or delete it. "New group" names one and fills it from the people picker. It all happens in place, in
 * the card: no dialogs. Groups live in your preferences; only a group's name leaves them, on the notes
 * you share with it.
 */
import { MAX_GROUPS, MAX_GROUP_NAME, MAX_GROUP_PEOPLE, NEW_GROUP, errorMessage, type Group, type NoteSummary, type Person } from '@alcove/api';
import { Avatar, Button, Card, EmptyState, Faces, Icon, IconButton, Popover, cn, useToast } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { PeoplePicker } from '~/features/people/PeoplePicker';
import { useOpenComposer } from '~/features/shell/context';
import { sameEmail } from '~/lib/people';
import { q, useGroups } from '~/lib/queries';
import { addressOnly, groupCalls, groupLine, listed } from './data';

/** Groups listed before "Show all". */
const SHOWN = 8;
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
interface Draft { name: string; people: Person[] }
const EMPTY: Draft = { name: '', people: [] };

export function Groups({ open, onOpen, notes, person }: {
  /** The group shown open: its ID, or NEW_GROUP while one is being made. */
  open: string | undefined;
  onOpen: (group: string | undefined) => void;
  notes: NoteSummary[];
  /** Anyone in a group, by address, with their name and portrait where the app knows them. */
  person: (email: string) => Person;
}) {
  const qc = useQueryClient();
  const groups = useQuery(q.prefs()).data?.groups ?? [];
  const save = useGroups();
  const toast = useToast();
  const [all, setAll] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  /** The group just made, which takes the focus from the editor; cleared once it has. */
  const [made, setMade] = useState<string | undefined>(undefined);
  const focused = useCallback(() => setMade(undefined), []);
  /**
   * Focus waiting for New group (in the card's head, or its empty state once the last group is gone): after
   * the editor closes, or after a delete, once that group (`gone`) has left the list.
   */
  const [toNew, setToNew] = useState<{ gone?: string | undefined } | null>(null);
  const newRef = useRef<HTMLButtonElement>(null);
  const full = groups.length >= MAX_GROUPS;
  /* With as many groups as there can be, the card's foot says so instead. */
  const making = open === NEW_GROUP && !full;

  useEffect(() => {
    if (!toNew || making || (toNew.gone !== undefined && groups.some((g) => g.id === toNew.gone))) return;
    newRef.current?.focus({ preventScroll: true });
    setToNew(null);
  }, [toNew, making, groups]);

  /* Every change starts from the groups as they are now, changes made a moment ago included. Each has its own promise, so its answer is never dropped for a later one's. */
  const change = (how: (now: Group[]) => Group[], done?: () => void) => {
    const now = qc.getQueryData(q.prefs().queryKey)?.groups ?? groups;
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
    if (discard) setDraft(EMPTY);
    onOpen(undefined);
    setToNew({});
  };

  /* An open group further down the list shows with the rest. */
  const openAt = groups.findIndex((g) => g.id === open);
  const shown = all || openAt >= SHOWN ? groups : groups.slice(0, SHOWN);
  const newButton = <Button ref={newRef} variant="quiet" size="sm" icon="plus" disabled={full} onClick={() => onOpen(NEW_GROUP)}>New group</Button>;

  return (
    <Card title="Groups" aside={groups.length > 0 && !making ? newButton : undefined} className="tp-groups">
      {making && (
        <NewGroup groups={groups} draft={draft} onDraft={setDraft} onClose={leave}
          onCreate={(g) => { change((now) => [...now, g]); setDraft(EMPTY); setMade(g.id); onOpen(g.id); }} />
      )}
      {groups.length > 0 && (
        <ul className="tp-grps">
          {shown.map((g) => (
            <li key={g.id}>
              <GroupRow group={g} groups={groups} calls={groupCalls(g, notes)} person={person} open={open === g.id}
                made={made === g.id} onFocused={focused}
                onToggle={() => onOpen(open === g.id ? undefined : g.id)} change={change} onDelete={() => remove(g)} />
            </li>
          ))}
        </ul>
      )}
      {groups.length > SHOWN && openAt < SHOWN && (
        <div className="tp-more"><Button variant="quiet" size="sm" iconRight={all ? 'up' : 'down'} aria-expanded={all} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${groups.length}`}</Button></div>
      )}
      {groups.length > 0 ? (
        <div className="tp-foot"><span>{full ? `${MAX_GROUPS} groups, the most you can have. Delete one to make another.` : 'Invite a whole group to a call, or share notes with all of them at once.'}</span></div>
      ) : !making && (
        <EmptyState title="No groups yet" art={<span className="tp-ic is-big"><Icon name="hash" size={22} /></span>}
          action={<Button ref={newRef} size="sm" icon="plus" onClick={() => onOpen(NEW_GROUP)}>New group</Button>}>
          Make one to invite a whole team to a call, or to share notes with all of them at once.
        </EmptyState>
      )}
    </Card>
  );
}

/** One group: its row opens and closes it; open, it lists its people and what you can do with it. */
function GroupRow({ group, groups, calls, person, open, made, onFocused, onToggle, change, onDelete }: {
  group: Group; groups: Group[]; calls: number; person: (email: string) => Person; open: boolean;
  /** Made a moment ago in the new-group editor, which had the focus. */
  made: boolean;
  onFocused: () => void;
  onToggle: () => void; change: (how: (now: Group[]) => Group[]) => void; onDelete: () => void;
}) {
  const openComposer = useOpenComposer();
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [picking, setPicking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const body = useId();
  const box = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const people = group.emails.map(person);
  const full = group.emails.length >= MAX_GROUP_PEOPLE;

  /* Opened from elsewhere (the side panel), the group comes into view; just made, it takes the editor's focus. */
  useEffect(() => {
    if (!open) return;
    box.current?.scrollIntoView({ block: 'nearest' });
    if (made) { row.current?.focus({ preventScroll: true }); onFocused(); }
  }, [open, made, onFocused]);
  /* After Enter or Escape in the name, focus goes back to the group's row; clicking away leaves it where it went. */
  useEffect(() => { if (!renaming && refocus.current) { refocus.current = false; row.current?.focus(); } }, [renaming]);

  /* Each change applies to the group as it is now. */
  const edit = (how: (g: Group) => Group) => change((now) => now.map((g) => (g.id === group.id ? how(g) : g)));
  const add = (picked: Person[]) => {
    const fresh = addresses(picked).filter((e) => !group.emails.includes(e));
    const left = fresh.length - (MAX_GROUP_PEOPLE - group.emails.length);
    if (left > 0) toast(`A group holds ${MAX_GROUP_PEOPLE} people, so ${left} of them ${left === 1 ? 'wasn’t' : 'weren’t'} added.`, { icon: 'people', ms: 5200 });
    if (fresh.length && left < fresh.length) edit((g) => ({ ...g, emails: [...new Set([...g.emails, ...fresh])].slice(0, MAX_GROUP_PEOPLE) }));
  };
  const take = (p: Person) => edit((g) => (g.emails.length > 1 ? { ...g, emails: g.emails.filter((e) => !sameEmail({ email: e }, p)) } : g));
  const doneRenaming = (to: string | undefined, focusRow: boolean) => {
    if (to !== undefined && to !== group.name) edit((g) => ({ ...g, name: to }));
    refocus.current = focusRow;
    setRenaming(false);
  };

  return (
    <div ref={box} className={cn('tp-grp', open && 'is-open')}>
      {renaming ? (
        <NameLine name={group.name} problem={(to) => nameProblem(to, groups, group.id)} onDone={doneRenaming} />
      ) : (
        <button ref={row} type="button" className="tp-grp-row" aria-expanded={open} aria-controls={open ? body : undefined} onClick={onToggle}>
          <span className="tp-ic"><Icon name="hash" size={17} /></span>
          <span className="min-w-0"><b className={open ? 'ac-clamp-2' : 'ac-clamp-1'}>{group.name}</b><small>{groupLine(group, calls)}</small></span>
          <Faces people={people} size={24} max={3} />
        </button>
      )}
      {open && (
        <div id={body} className="tp-grp-body">
          <Members people={people} group={group.name} onRemove={group.emails.length > 1 ? take : undefined} />
          <div className="tp-grp-acts">
            <PeoplePicker open={picking} onOpenChange={setPicking} title={`Add people to ${group.name}`} cta="Add" skip={group.emails} note={PRIVATE} onDone={add}
              anchor={<Button size="sm" icon="addUser" disabled={full}>Add people</Button>} />
            <span className="sp" />
            <IconButton icon="video" size={17} label={`Start a call with ${group.name}`} aria-haspopup="dialog" onClick={() => openComposer({ people })} />
            <IconButton icon="pen" size={17} label={`Rename ${group.name}`} onClick={() => setRenaming(true)} />
            <Popover open={deleting} onOpenChange={setDeleting} label={`Delete ${group.name}`} align="end" className="w-[300px]"
              anchor={<IconButton icon="trash" size={17} label={`Delete ${group.name}`} />}>
              <button type="button" className="ac-pop-item is-caution" onClick={() => { setDeleting(false); onDelete(); }}>
                <Icon name="trash" size={18} /><span><b className="ac-clamp-2">Delete {group.name}</b><small>It’s gone from your groups. Notes you shared with it stay with the people who have them.</small></span>
              </button>
            </Popover>
          </div>
          {full && <p className="tp-hint">{MAX_GROUP_PEOPLE} people, the most a group can have.</p>}
        </div>
      )}
    </div>
  );
}

/** The people in a group, each with an × to take them out (`onRemove`; left out while one person is all it has). */
function Members({ people, group, onRemove }: { people: Person[]; group: string; onRemove?: ((p: Person) => void) | undefined }) {
  return (
    <ul className="tp-mems" aria-label={`People in ${group}`}>
      {people.map((p) => (
        <li key={p.email} className="tp-mem">
          <Avatar person={p} size={28} />
          <span className="min-w-0"><b className="ac-clamp-1">{listed(p)}</b>{!addressOnly(p) && <small className="ac-clamp-1">{p.email}</small>}</span>
          {onRemove && <IconButton icon="x" size={15} label={`Take ${listed(p)} out of ${group}`} onClick={() => onRemove(p)} />}
        </li>
      ))}
    </ul>
  );
}

/**
 * A group's name being typed: Enter keeps it (or says what's wrong with it), Escape leaves it as it was,
 * and clicking away keeps it when it's fine. `onDone` gets the new name (or nothing, to keep the old one),
 * and whether focus should go back to the group's row: after Enter or Escape, not after clicking away.
 */
function NameLine({ name, problem, onDone }: { name: string; problem: (to: string) => string | undefined; onDone: (to: string | undefined, focusRow: boolean) => void }) {
  const [text, setText] = useState(name);
  const [error, setError] = useState<string | undefined>(undefined);
  const said = useId();
  const closed = useRef(false);
  const close = (to: string | undefined, focusRow: boolean) => { if (closed.current) return; closed.current = true; onDone(to, focusRow); };
  return (
    <div className="tp-grp-row is-edit">
      <span className="tp-ic"><Icon name="hash" size={17} /></span>
      <span className="min-w-0">
        <input className="tp-grp-name" autoFocus value={text} maxLength={MAX_GROUP_NAME} aria-label="Group name"
          aria-invalid={error !== undefined} aria-describedby={error ? said : undefined}
          onChange={(e) => { setText(e.target.value); setError(undefined); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); const p = problem(text); if (p) setError(p); else close(text.trim(), true); }
            else if (e.key === 'Escape') { e.preventDefault(); close(undefined, true); }
          }}
          onBlur={() => close(problem(text) ? undefined : text.trim(), false)} />
        {error && <small id={said} className="tp-err" role="alert">{error}</small>}
      </span>
    </div>
  );
}

/**
 * A group being made, at the top of the card: its name, then its people from the picker. Enter in the
 * name opens the picker until someone's in it, then makes the group. Escape (or looking elsewhere) keeps
 * the draft for next time; × discards it.
 */
function NewGroup({ groups, draft, onDraft, onClose, onCreate }: {
  groups: Group[]; draft: Draft; onDraft: (d: Draft) => void; onClose: (discard: boolean) => void; onCreate: (g: Group) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const said = useId();
  const { name, people } = draft;
  const create = () => {
    const p = nameProblem(name, groups);
    if (p) { setError(p); return; }
    if (!people.length) { setPicking(true); return; }
    onCreate({ id: crypto.randomUUID(), name: name.trim(), emails: addresses(people) });
  };
  const add = (picked: Person[]) => onDraft({ name, people: [...people, ...picked.filter((p) => !people.some((h) => sameEmail(h, p)))].slice(0, MAX_GROUP_PEOPLE) });
  return (
    <div className="tp-grp is-open is-new">
      <div className="tp-grp-row is-edit has-x">
        <span className="tp-ic"><Icon name="hash" size={17} /></span>
        <span className="min-w-0">
          <input className="tp-grp-name" autoFocus value={name} maxLength={MAX_GROUP_NAME} placeholder="Name it, like Design" aria-label="New group’s name"
            aria-invalid={error !== undefined} aria-describedby={error ? said : undefined}
            onChange={(e) => { onDraft({ name: e.target.value, people }); setError(undefined); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); create(); }
              else if (e.key === 'Escape') { e.preventDefault(); onClose(false); }
            }} />
          {error && <small id={said} className="tp-err" role="alert">{error}</small>}
        </span>
        <IconButton icon="x" size={17} label="Discard this group" onClick={() => onClose(true)} />
      </div>
      <div className="tp-grp-body">
        {people.length > 0
          ? <Members people={people} group={name.trim() || 'the new group'} onRemove={(p) => onDraft({ name, people: people.filter((h) => !sameEmail(h, p)) })} />
          : <p className="tp-hint">{PRIVATE}</p>}
        <div className="tp-grp-acts">
          <PeoplePicker open={picking} onOpenChange={setPicking} title={name.trim() ? `Add people to ${name.trim()}` : 'Add people to the group'} cta="Add"
            skip={addresses(people)} note={PRIVATE} onDone={add}
            anchor={<Button size="sm" icon="addUser" disabled={people.length >= MAX_GROUP_PEOPLE}>Add people</Button>} />
          <span className="sp" />
          <Button size="sm" disabled={!name.trim() || !people.length} onClick={create}>Create group</Button>
        </div>
      </div>
    </div>
  );
}
