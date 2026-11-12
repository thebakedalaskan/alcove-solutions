/*
 * Deciding on what a call suggests be done. A decision goes with the revision the person saw, never a newer one, and what's
 * become of a suggestion since they saw it is said in words: changed, reviewed by someone else, or theirs only to read. The
 * workspace's Follow-ups page and the note after the call review a fixed batch (FollowUpReview.tsx); the call's Notes panel
 * lists them under its checklist (call/notes/SuggestedFollowUps.tsx). Both decide through this.
 */
import { errorMessage, type FollowUpReview as Review } from '@alcove/api';
import type { FollowUpReviewRow } from '@alcove/ui';
import { useState } from 'react';

/** A suggestion as it's shown: its words, the revision they are, and whether this person may decide on it. */
export interface FollowUpProposal extends Omit<FollowUpReviewRow, 'busy' | 'canReview' | 'status'> { revision: string; allowed: boolean }

/**
 * Where a suggestion someone saw stands now. `deciding`: their decision on it is on its way. `done`: it went through.
 * `failed`: it didn't, and `status` says why; otherwise `status` says why there's nothing to press, if there isn't.
 */
export interface ProposalState { deciding: Review['decision'] | null; canReview: boolean; done: boolean; failed: boolean; status: string | undefined }

/** What a decision came to: `done` once it's taken, and in words, what was done or why it wasn't. */
export interface Decided { done: boolean; text: string }

const keyOf = (proposal: Pick<FollowUpProposal, 'id' | 'revision'>): string => `${proposal.id}:${proposal.revision}`;

/**
 * `proposals` are the suggestions as they are now. `changed` is what a suggestion that changed since it was shown says, as
 * where it's shown has its own way back to the new words. `pending` is every suggestion still to decide, less what this
 * person has decided; `stateOf` takes a suggestion as it was shown; `review` decides on it with the revision that was shown,
 * and resolves to what that came to, or null when there was nothing to decide.
 */
export function useFollowUpReview<P extends FollowUpProposal>(proposals: readonly P[], onReview: (review: Review) => Promise<unknown>, changed: string) {
  const [results, setResults] = useState<ReadonlyMap<string, Decided>>(new Map());
  const [busy, setBusy] = useState<ReadonlyMap<string, Review['decision']>>(new Map());
  const current = new Map(proposals.map((p) => [p.id, p]));
  const pending = proposals.filter((p) => !results.get(keyOf(p))?.done);
  const stateOf = (seen: P): ProposalState => {
    const live = current.get(seen.id);
    const moved = live !== undefined && live.revision !== seen.revision;
    const gone = live === undefined;
    const result = results.get(keyOf(seen));
    const deciding = busy.get(seen.id) ?? null;
    return {
      deciding, done: result?.done === true, failed: result?.done === false,
      canReview: seen.allowed && live?.allowed === true && !moved && !gone && result?.done !== true,
      status: result?.text ?? (deciding ? undefined : gone ? 'Already reviewed by someone else.' : moved ? changed : !seen.allowed || live?.allowed !== true ? 'You can read this suggestion.' : undefined)
    };
  };
  const review = async (seen: P, decision: Review['decision']): Promise<Decided | null> => {
    if (busy.has(seen.id) || !stateOf(seen).canReview) return null;
    setBusy((was) => new Map(was).set(seen.id, decision));
    let outcome: Decided;
    try {
      await onReview({ id: seen.id, revision: seen.revision, decision });
      outcome = { text: decision === 'dismiss' ? 'Dismissed' : seen.target ? 'Change applied' : 'Added', done: true };
    } catch (e) { outcome = { text: errorMessage(e), done: false }; }
    setResults((was) => new Map(was).set(keyOf(seen), outcome));
    setBusy((was) => { const next = new Map(was); next.delete(seen.id); return next; });
    return outcome;
  };
  return { pending, stateOf, review, deciding: busy.size > 0 };
}
