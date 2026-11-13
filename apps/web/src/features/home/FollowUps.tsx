/*
 * Follow-ups, in For you: the ones you took on and haven't done, from every note you have, soonest first. Ticking one off
 * crosses it out where it is until you leave Home; ticking it again puts it back.
 */
import { errorCode, errorMessage, type OpenAction } from '@alcove/api';
import { Check, cn, useToast } from '@alcove/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { log } from '~/lib/log';
import { noteQueries, useUpdateAction } from '~/features/notes/queries';
import { dueFrom, dueLabel, dueOf, groupOf, type Due, type DueGroup } from '~/features/notes/follow-ups/due';

const RANK: Record<DueGroup, number> = { overdue: 0, week: 1, later: 2, none: 3 };

export interface Todo { key: string; a: OpenAction; due: Due | undefined; group: DueGroup }

/** In group order; dated ones soonest first, then the rest newest note first. */
function order(x: Todo, y: Todo): number {
  if (x.group !== y.group) return RANK[x.group] - RANK[y.group];
  const dx = x.due?.kind === 'day' ? x.due.at.getTime() : Infinity;
  const dy = y.due?.kind === 'day' ? y.due.at.getTime() : Infinity;
  return dx !== dy ? dx - dy : y.a.noteStartedAt.localeCompare(x.a.noteStartedAt);
}

const keyOf = (a: OpenAction) => `${a.noteId}:${a.id}`;

/**
 * Your follow-ups as they stand this visit: `open` from the inbox (undefined until it answers), with those ticked or
 * unticked here kept where they were, and the ticking. `isNew` says one arrived while you were here (taken on from To
 * answer), so it rises in, once: `rose` says it has.
 */
export function useInboxFollowUps(open: OpenAction[] | undefined, now: number) {
  const toast = useToast();
  const update = useUpdateAction();
  const client = useQueryClient();
  const today = new Date(now);
  /* Follow-ups ticked or unticked this visit, as they were, so they keep their place after the inbox lets go of them. */
  const [touched, setTouched] = useState<ReadonlyMap<string, OpenAction>>(new Map());
  const turns = useRef(new Map<string, number>());
  /* What was there when the inbox first answered: what arrives after that rises in, and only the once. */
  const [there, setThere] = useState<ReadonlySet<string> | undefined>(() => (open ? new Set(open.map(keyOf)) : undefined));
  if (!there && open) setThere(new Set(open.map(keyOf)));
  const risen = useRef(new Set<string>());

  const byKey = new Map<string, OpenAction>((open ?? []).map((a) => [keyOf(a), a]));
  for (const [key, a] of touched) if (!byKey.has(key)) byKey.set(key, a);
  const todos: Todo[] = [...byKey].map(([key, a]) => { const due = dueOf(a.due, dueFrom(a)); return { key, a, due, group: groupOf(due, today) }; }).sort(order);

  /* Each tick waits for its own answer, so ticking several in a row can't lose one's rollback. */
  const tick = async (t: Todo, on: boolean) => {
    const turn = (turns.current.get(t.key) ?? 0) + 1;
    turns.current.set(t.key, turn);
    // Keep completed rows in place for this visit. The inbox projection owns their pending/rollback state.
    setTouched((m) => new Map(m).set(t.key, { ...t.a, done: on }));
    try {
      const note = await update.mutateAsync({ noteId: t.a.noteId, actionId: t.a.id, patch: { done: on } });
      const confirmed = [...note.actions, ...note.rooms.flatMap((room) => room.actions)].find((a) => a.id === t.a.id);
      if (turns.current.get(t.key) === turn && confirmed) setTouched((m) => new Map(m).set(t.key, { ...t.a, done: confirmed.done }));
    } catch (e) {
      if (turns.current.get(t.key) !== turn) return;
      setTouched((m) => new Map(m).set(t.key, t.a));
      // Its note is gone: the follow-up goes with it.
      if (errorCode(e) === 'not-found') setTouched((m) => { const n = new Map(m); n.delete(t.key); return n; });
      toast(errorMessage(e), { icon: 'x' });
      // A lost acknowledgement may have saved the tick. Inbox omits completed work, so read its actual note before
      // deciding how this visit's retained row should look. A later press still owns the row if this read is slow.
      if (errorCode(e) !== 'not-found') try {
        const note = await client.fetchQuery({ ...noteQueries.note(t.a.noteId), staleTime: 0 });
        const found = [...note.actions, ...note.rooms.flatMap((room) => room.actions)].find((a) => a.id === t.a.id);
        if (found && turns.current.get(t.key) === turn) setTouched((m) => new Map(m).set(t.key, { ...t.a, done: found.done }));
      } catch (readError) { log.child({ component: 'follow-ups' }).warn('couldn’t reconcile a follow-up after its write failed', { err: readError, noteId: t.a.noteId, actionId: t.a.id }); }
    }
  };
  const isNew = (key: string) => there !== undefined && !there.has(key) && !touched.has(key) && !risen.current.has(key);
  const rose = useCallback((key: string) => { risen.current.add(key); }, []);
  return { todos, tick, isNew, rose };
}

/** Words that fit the day's column ("Next week", "ASAP"); longer ones go after the call it came from (in the day's place on a phone). */
const DAY_WORDS = 16;

/**
 * One follow-up: the box to tick, its words in one line (opening the note at the moment they were said), the call it came
 * from, and the day it's due at the right: Today in the warm colour of now, late in caution. Saving says so in the day's place.
 * One that's `fresh` as it appears rises in, and says so (`onRisen`), so it doesn't again.
 */
export function TodoRow({ t, now, syncing, fresh, onRisen, onTick }: {
  t: Todo; now: number; syncing: boolean; fresh: boolean; onRisen: (key: string) => void; onTick: (on: boolean) => void;
}) {
  const [rising] = useState(fresh);
  useEffect(() => { if (rising) onRisen(t.key); }, [rising, onRisen, t.key]);
  const today = new Date(now);
  const ticked = t.a.done;
  const said = t.due?.kind === 'words' ? t.due.text : t.due?.words;
  const long = said && said.length > DAY_WORDS ? said : undefined;
  const day = t.due && !long ? dueLabel(t.due, today) : undefined;
  const from = long ? `${t.a.noteTitle} · Due ${long.charAt(0).toLowerCase()}${long.slice(1)}` : t.a.noteTitle;
  return (
    <li data-row aria-busy={syncing} className={cn('hm-todo', ticked && 'is-done', rising && 'is-new')}>
      <Check checked={ticked} onChange={onTick} label={`${ticked ? 'Done' : 'Mark done'}: ${t.a.text}`} />
      <Link to="/calls/$noteId" params={{ noteId: t.a.noteId }} search={{ at: t.a.at }} className="hm-todo-t ac-clamp-1" title={t.a.text}>{t.a.text}</Link>
      <span className="hm-todo-src ac-clamp-1" title={from}>{from}</span>
      {syncing ? <span className="hm-todo-due" role="status">Saving…</span>
        : <span className={cn('hm-todo-due', day === 'Today' && 'is-now', t.group === 'overdue' && 'is-late')} title={t.a.due}>{day ?? (long && <span className="hm-todo-long ac-clamp-1">{long}</span>)}</span>}
    </li>
  );
}
