import { errorMessage, type FollowUpReview as Review } from '@alcove/api';
import { FollowUpSuggestions, type FollowUpReviewRow } from '@alcove/ui';
import { useState } from 'react';

export interface FollowUpProposal extends Omit<FollowUpReviewRow, 'busy' | 'canReview' | 'status'> { revision: string; allowed: boolean }
const keyOf = (proposal: Pick<FollowUpProposal, 'id' | 'revision'>): string => `${proposal.id}:${proposal.revision}`;

/** Opening takes a snapshot, so new inference cannot change the words under a reviewer's pointer. */
export function FollowUpReview({ proposals, onReview }: { proposals: readonly FollowUpProposal[]; onReview: (review: Review) => Promise<unknown> }) {
  const [batch, setBatch] = useState<readonly FollowUpProposal[] | null>(null);
  const [results, setResults] = useState<ReadonlyMap<string, { text: string; done: boolean }>>(new Map());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const current = new Map(proposals.map((p) => [p.id, p]));
  const pending = proposals.filter((p) => !results.get(keyOf(p))?.done);
  const review = async (id: string, decision: Review['decision']) => {
    const row = batch?.find((p) => p.id === id);
    if (!row || busy.has(id) || !row.allowed || current.get(id)?.allowed !== true || current.get(id)?.revision !== row.revision || results.get(keyOf(row))?.done) return;
    setBusy((was) => new Set(was).add(id));
    try {
      await onReview({ id, revision: row.revision, decision });
      setResults((was) => new Map(was).set(keyOf(row), { text: decision === 'dismiss' ? 'Dismissed' : row.target ? 'Change applied' : 'Added', done: true }));
    } catch (e) { setResults((was) => new Map(was).set(keyOf(row), { text: errorMessage(e), done: false })); }
    finally { setBusy((was) => { const next = new Set(was); next.delete(id); return next; }); }
  };
  const rows = batch?.map((p): FollowUpReviewRow => {
    const live = current.get(p.id);
    const changed = live !== undefined && live.revision !== p.revision;
    const gone = live === undefined;
    const result = results.get(keyOf(p));
    return { ...p, busy: busy.has(p.id), canReview: p.allowed && live?.allowed === true && !changed && !gone && !result?.done,
      status: result?.text ?? (busy.has(p.id) ? undefined : gone ? 'Already reviewed by someone else.' : changed ? 'Changed since you opened this. Close and review it again.' : !p.allowed || !live?.allowed ? 'You can read this suggestion.' : undefined) };
  }) ?? null;
  return <FollowUpSuggestions count={pending.length} rows={rows} waiting={batch ? pending.filter((p) => !batch.some((b) => b.id === p.id && b.revision === p.revision)).length : 0}
    onOpen={() => { setBatch(pending); }} onClose={() => setBatch(null)} onReview={(id, decision) => { void review(id, decision); }} />;
}
