/*
 * For you: what's yours to answer, and your follow-ups to tick off, as two tabs of one widget. It opens on To answer when
 * anything's there, else on Follow-ups when anything's there, and stays on the tab you pick. Each tab counts what's still
 * open in it; the side panel's Home count is the two together, and pressing it lands here (landing.ts), on the tab where
 * things wait. The first five show, then Show N more. Before your first notes, and once everything's done, it says so with a
 * small drawing.
 */
import { isAcceptedFollowUp, type NoteSummary } from '@alcove/api';
import { Button, EmptyRows, EmptyState, Icon, SmallSunset, Tabs, Widget, cn } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useNoteReader } from '~/features/notes/entries';
import { noteQueries, usePendingActions } from '~/features/notes/queries';
import { TodoRow, useInboxFollowUps } from './FollowUps';
import { FOR_YOU, useLandOnForYou } from './landing';
import { useShowMore } from './parts';
import { AskRow, settling, useWaiting, waitingOf } from './Waiting';

type Tab = 'ask' | 'todo';

export function ForYou({ notes, now }: { notes: readonly NoteSummary[]; now: number }) {
  const inbox = useQuery(noteQueries.inbox());
  const data = inbox.data;
  const waiting = useWaiting(data ? waitingOf(data, notes, now) : []);
  const followUps = useInboxFollowUps(data?.followUps.filter((a) => isAcceptedFollowUp(a) && a.takenOn), now);
  const pending = usePendingActions();
  const readerAs = useNoteReader();
  const id = useId();
  const asks = waiting.shown;
  const todos = followUps.todos;
  /* It opens where something is, once there's anything to go by, and then stays where it is or where you put it. */
  const opening: Tab = asks.length || !todos.length ? 'ask' : 'todo';
  const [tab, setTab] = useState<Tab | undefined>(data ? opening : undefined);
  if (tab === undefined && data) setTab(opening);
  const on = tab ?? 'ask';
  const rows = on === 'ask' ? asks.length : todos.length;
  const show = useShowMore<HTMLUListElement>(rows);
  const openAsks = asks.filter((i) => waiting.outcomeOf(i.key) === undefined).length;
  const openTodos = todos.filter((t) => !t.a.done).length;
  const byId = new Map(notes.map((n) => [n.id, n]));
  /* Landed on from the side panel's count: the tab where things wait, To answer first, with focus on it. */
  const landed = useLandOnForYou(() => {
    const to: Tab = openAsks || !openTodos ? 'ask' : 'todo';
    if (to !== on) { setTab(to); show.close(); }
    return document.getElementById(`${id}-${to}`);
  });

  /*
   * Nothing in this tab. Both empty once notes are written: all caught up, under Home's small sunset. Before any notes are
   * written, what will come (and while the first are being written, whose). After that, the rows drawing, and where the rest is.
   */
  const written = notes.some((n) => n.status === 'ready');
  const writing = written ? undefined : notes.find((n) => n.status !== 'ready');
  const rowsArt = <EmptyRows ticks={on === 'todo'} />;
  const empty = written && !asks.length && !todos.length
    ? <EmptyState className="hm-empty" art={<SmallSunset />} title="You’re all caught up">New ones show up after your calls.</EmptyState>
    : on === 'ask'
      ? !written
        ? <EmptyState className="hm-empty" art={rowsArt} title="Nothing to answer yet">{writing ? `${writing.title}’s notes are being written.` : 'Decisions to confirm and follow-ups from your calls show up here.'}</EmptyState>
        : <EmptyState className="hm-empty" art={rowsArt} title="Nothing to answer">Your follow-ups are in the next tab.</EmptyState>
      : <EmptyState className="hm-empty" art={rowsArt} title={written ? 'No follow-ups' : 'No follow-ups yet'}>What you take on shows up here, with when it’s due.</EmptyState>;

  const count = (n: number) => (n > 0 ? <span className="n">{n}</span> : null);
  const tabs = (
    <Tabs className="hm-tabs" label="For you" id={id} panel={`${id}-panel`} value={on} onChange={(v) => { setTab(v); show.close(); }}
      options={[{ value: 'ask', label: <>To answer{count(openAsks)}</> }, { value: 'todo', label: <>Follow-ups{count(openTodos)}</> }]} />
  );
  return (
    <Widget icon="inbox" title="For you" className="hm-for" id={FOR_YOU} landed={landed} end={tabs}
      body={{ id: `${id}-panel`, role: 'tabpanel', 'aria-labelledby': `${id}-${on}` }} more={show.more}>
      {!data ? inbox.isError ? (
        <EmptyState className="hm-empty" role="status" art={<span className="hm-warn"><Icon name="alert" size={20} /></span>} title="This didn’t load"
          action={<Button variant="secondary" size="sm" loading={inbox.isFetching} onClick={() => void inbox.refetch()}>Try again</Button>} />
      ) : <div className="hm-sk" role="status" aria-label="Loading"><i /><i /><i /><i /></div>
        : !rows ? empty
          : on === 'ask' ? (
            <ul ref={show.list} className={cn('hm-asks', asks.some(settling) && 'has-settle')}>
              {asks.slice(0, show.shown).map((item) => (
                <AskRow key={item.key} item={item} outcome={waiting.outcomeOf(item.key)} busy={waiting.busy.has(item.key)} me={waiting.me} now={now}
                  reader={item.kind === 'decision' ? readerAs(item.d.role) : undefined} note={byId.get(item.kind === 'decision' ? item.d.noteId : item.kind === 'suggestion' ? item.a.noteId : item.n.id)}
                  run={(answer) => void waiting.run(item, answer)} />
              ))}
            </ul>
          ) : (
            <ul ref={show.list} className="hm-todos" aria-label="Your follow-ups">
              {todos.slice(0, show.shown).map((t) => (
                <TodoRow key={t.key} t={t} now={now} syncing={pending.has(t.key)} fresh={followUps.isNew(t.key)} onRisen={followUps.rose}
                  onTick={(done) => void followUps.tick(t, done)} />
              ))}
            </ul>
          )}
    </Widget>
  );
}
