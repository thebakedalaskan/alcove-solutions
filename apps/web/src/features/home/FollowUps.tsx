/*
 * Your follow-ups: the ones you took on and haven't done, from every note you have, grouped by when
 * they're due. Ticking one off crosses it out where it is until you leave Home; ticking it again puts it back.
 */
import { errorCode, errorMessage, type OpenAction } from '@alcove/api';
import { Card, Check, EmptyState, cn, useToast } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useUpdateAction } from '~/lib/queries';
import { dayMonth } from '~/lib/time';
import { DUE_GROUPS, dueFrom, dueLabel, dueOf, groupOf, type Due, type DueGroup } from './day';
import { More } from './parts';

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

export function FollowUps({ open: openActions, now }: { open: OpenAction[]; now: number }) {
  const toast = useToast();
  const update = useUpdateAction();
  const today = new Date(now);
  /* Follow-ups ticked or unticked this visit, as they were, so they keep their place after the inbox lets go of them. */
  const [touched, setTouched] = useState<ReadonlyMap<string, OpenAction>>(new Map());
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [all, setAll] = useState(false);
  /* Follow-ups that arrive while you're here (taken on from Waiting on you) rise in. */
  const [first] = useState(() => new Set(openActions.map((a) => `${a.noteId}:${a.id}`)));

  const byKey = new Map<string, OpenAction>(openActions.map((a) => [`${a.noteId}:${a.id}`, a]));
  for (const [key, a] of touched) if (!byKey.has(key)) byKey.set(key, a);
  const todos: Todo[] = [...byKey].map(([key, a]) => { const due = dueOf(a.due, dueFrom(a)); return { key, a, due, group: groupOf(due, today) }; }).sort(order);
  const left = todos.filter((t) => !done.has(t.key)).length;
  const visible = all || todos.length <= FIRST + 1 ? todos : todos.slice(0, FIRST);

  /* Each tick waits for its own answer, so ticking several in a row can't lose one's rollback. */
  const tick = async (t: Todo, on: boolean) => {
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

  return (
    <Card title="Your follow-ups" className="hm-fu" aside={todos.length > 0 ? <span>{left ? `${left} open` : 'All done'}</span> : undefined}>
      {todos.length ? (
        <>
          {DUE_GROUPS.map(({ id, label }) => {
            const rows = visible.filter((t) => t.group === id);
            if (!rows.length) return null;
            return (
              <div key={id} className="hm-fu-group">
                <h4 className="hm-grp">{label}</h4>
                <ul>
                  {rows.map((t) => {
                    const ticked = done.has(t.key);
                    // A day gets a chip, and so do words that fit in one ("Next week", "ASAP"); longer words stay with the note they came from.
                    const said = t.due?.kind === 'words' ? t.due.text : t.due?.words;
                    const chip = t.due && !(said && said.length > 16) ? dueLabel(t.due, today) : undefined;
                    return (
                      <li key={t.key} className={cn('hm-todo', ticked && 'is-done', !first.has(t.key) && !touched.has(t.key) && 'is-new')}>
                        <Check checked={ticked} onChange={(on) => void tick(t, on)} label={`${ticked ? 'Done' : 'Mark done'}: ${t.a.text}`} />
                        <div className="min-w-0">
                          <div className="txt">{t.a.text}</div>
                          <div className="from">
                            <Link to="/notes/$noteId" params={{ noteId: t.a.noteId }} search={{ at: t.a.at }} className="hm-src">{t.a.noteTitle}</Link>
                            {(!t.due || said) && ` · ${dayMonth(new Date(t.a.noteStartedAt))}`}
                            {said && !chip && ` · due ${said.charAt(0).toLowerCase()}${said.slice(1)}`}
                            {ticked && ' · done today'}
                          </div>
                        </div>
                        {chip && <span className={cn('hm-due', chip === 'Today' && 'is-now', t.group === 'overdue' && 'is-late')} title={t.a.due}>{chip}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          {todos.length > FIRST + 1 && <More all={all} more={todos.length - FIRST} onToggle={() => setAll((a) => !a)} />}
        </>
      ) : (
        <EmptyState title="Nothing on your plate" className="hm-empty">When a call ends, what you said you’d do shows up here, with when it’s due.</EmptyState>
      )}
    </Card>
  );
}
