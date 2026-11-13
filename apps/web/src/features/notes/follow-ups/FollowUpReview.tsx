import type { FollowUpReview as Review } from '@alcove/api';
import { FollowUpSuggestions, type FollowUpReviewRow } from '@alcove/ui';
import { useState } from 'react';
import { useFollowUpReview, type FollowUpProposal } from './useFollowUpReview';

/** Opening takes a snapshot, so new inference cannot change the words under a reviewer's pointer. */
export function FollowUpReview({ proposals, onReview }: { proposals: readonly FollowUpProposal[]; onReview: (review: Review) => Promise<unknown> }) {
  const [batch, setBatch] = useState<readonly FollowUpProposal[] | null>(null);
  const { pending, stateOf, review } = useFollowUpReview(proposals, onReview, 'Changed since you opened this. Close and review it again.');
  const rows = batch?.map((p): FollowUpReviewRow => {
    const { deciding, canReview, status } = stateOf(p);
    return { ...p, busy: deciding !== null, canReview, status };
  }) ?? null;
  return <FollowUpSuggestions count={pending.length} rows={rows} waiting={batch ? pending.filter((p) => !batch.some((b) => b.id === p.id && b.revision === p.revision)).length : 0}
    onOpen={() => { setBatch(pending); }} onClose={() => setBatch(null)} onReview={(id, decision) => { const row = batch?.find((p) => p.id === id); if (row) void review(row, decision); }} />;
}
