/*
 * For you: what needs an answer, then your follow-ups to tick off, under one heading. The count is what's still
 * open, the same as the side panel's.
 */
import { isAcceptedFollowUp, type Inbox, type NoteSummary } from '@alcove/api';
import { EmptyState } from '@alcove/ui';
import { useId, useState } from 'react';
import { openCount } from './day';
import { FollowUps } from './FollowUps';
import { Waiting, waitingOf } from './Waiting';

export function ForYou({ inbox, notes, now }: { inbox: Inbox; notes: readonly NoteSummary[]; now: number }) {
  const h = useId();
  /* What was answered this visit stays on screen, saying so, so the empty state waits until the next visit. */
  const [answered, setAnswered] = useState(false);
  const items = waitingOf(inbox, notes, now);
  const open = inbox.followUps.filter((a) => isAcceptedFollowUp(a) && a.takenOn);
  const count = openCount(inbox, notes, now);
  const onAnswer = () => setAnswered(true);
  return (
    <section className="hm-panel" aria-labelledby={h}>
      <div className="hm-panel-h"><h2 id={h}>For you{count > 0 && <span className="n">{count}</span>}</h2></div>
      <Waiting items={items} onAnswer={onAnswer} />
      <FollowUps open={open} now={now} onAnswer={onAnswer} />
      {!count && !answered && <EmptyState title="Nothing needs you" className="hm-empty">Decisions to confirm and follow-ups show up here after your calls.</EmptyState>}
    </section>
  );
}
