/*
 * Your follow-ups: the ones you took on and haven't done, from every note you have, soonest first. Ticking one off
 * crosses it out where it is until you leave Home; ticking it again puts it back.
 */
import { errorCode, errorMessage, type OpenAction } from '@alcove/api';
import { Check, cn, useToast } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useUpdateAction } from '~/lib/queries';
import { dueFrom, dueLabel, dueOf, groupOf, type Due, type DueGroup } from './day';
import { Moment, More } from './parts';

const FIRST = 6;
const RANK: Record<DueGroup, number> = { overdue: 0, week: 1, later: 2, none: 3 };

interface Todo { key: string; a: OpenAction; due: Due | undefined; group: DueGroup }

/** In group order; dated ones soonest first, then the rest newest note first. */
function order(x: Todo, y: Todo): number {
  if (x.group !== y.group) return RANK[x.group] - RANK[y.group];
  const dx = x.due?.kind === 'day' ? x.due.at.getTime() : Infinity;
  const dy = y.due?.kind === 'day' ? y.due.at.getTime() : Infinity;
  return dx !== dy ? dx - dy : y.a.noteStartedAt.localeCompare(x.a.noteStartedAt);
}

export function FollowUps({ open: openActions, now, onAnswer }: { open: OpenAction[]; now: number; onAnswer: () => void }) {
  const toast = useToast();
  const update = useUpdateAction();
  const today = new Date(now);
  /* Follow-ups ticked or unticked this visit, as they were, so they keep their place after the inbox lets go of them. */
  const [touched, setTouched] = useState<ReadonlyMap<string, OpenAction>>(new Map());
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [all, setAll] = useState(false);
  /* Follow-ups that arrive while you're here (taken on from a tile) rise in. */
  const [first] = useState(() => new Set(openActions.map((a) => `${a.noteId}:${a.id}`)));

  const byKey = new Map<string, OpenAction>(openActions.map((a) => [`${a.noteId}:${a.id}`, a]));
  for (const [key, a] of touched) if (!byKey.has(key)) byKey.set(key, a);
  const todos: Todo[] = [...byKey].map(([key, a]) => { const due = dueOf(a.due, dueFrom(a)); return { key, a, due, group: groupOf(due, today) }; }).sort(order);
  const visible = all || todos.length <= FIRST + 1 ? todos : todos.slice(0, FIRST);

  /* Each tick waits for its own answer, so ticking several in a row can't lose one's rollback. */
  const tick = async (t: Todo, on: boolean) => {
    onAnswer();
    setTouched((m) => new Map(m).set(t.key, t.a));
    const flip = (v: boolean) => setDone((s) => { const n = new Set(s); if (v) n.add(t.key); else n.delete(t.key); return n; });
    flip(on);
    try {
      await update.mutateAsync({ noteId: t.a.noteId, actionId: t.a.id, patch: { done: on } });
    } catch (e) {
      flip(!on);
      // Its note is gone: the follow-up goes with it.
      if (errorCode(e) === 'not-found') setTouched((m) => { const n = new Map(m); n.delete(t.key); return n; });
      toast(errorMessage(e), { icon: 'x' });
    }
  };

  if (!todos.length) return null;
  return (
    <>
      <ul className="hm-list" aria-label="Your follow-ups">
        {visible.map((t) => {
          const ticked = done.has(t.key);
          // A day gets a label, and so do words that fit in one ("Next week", "ASAP"); longer words go under the follow-up.
          const said = t.due?.kind === 'words' ? t.due.text : t.due?.words;
          const long = said && said.length > 16 ? said : undefined;
          const label = t.due && !long ? dueLabel(t.due, today) : undefined;
          return (
            <li key={t.key} className={cn('hm-todo', ticked && 'is-done', !first.has(t.key) && !touched.has(t.key) && 'is-new')}>
              <Check checked={ticked} onChange={(on) => void tick(t, on)} label={`${ticked ? 'Done' : 'Mark done'}: ${t.a.text}`} />
              <span className="hm-todo-b">
                <Link to="/notes/$noteId" params={{ noteId: t.a.noteId }} search={{ at: t.a.at }} className="hm-todo-t ac-clamp-1" title={t.a.text}>{t.a.text}</Link>
                {long && <small className="ac-clamp-1">Due {long.charAt(0).toLowerCase()}{long.slice(1)}</small>}
              </span>
              <Moment noteId={t.a.noteId} noteTitle={t.a.noteTitle} at={t.a.at} />
              <span className={cn('hm-todo-d', label === 'Today' && 'is-now', t.group === 'overdue' && 'is-late')} title={t.a.due}>{label}</span>
            </li>
          );
        })}
      </ul>
      {todos.length > FIRST + 1 && <More all={all} more={todos.length - FIRST} onToggle={() => setAll((a) => !a)} />}
    </>
  );
}
