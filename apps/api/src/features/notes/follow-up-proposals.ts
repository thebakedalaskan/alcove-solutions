import { MAX_FOLLOW_UP_PROPOSALS, isAcceptedFollowUp, isPendingFollowUp, type ActionItem, type FollowUpTarget } from '@alcove/api';
import { id128 } from '../../crypto';

export const actionTarget = (a: ActionItem): FollowUpTarget => ({ id: a.id, revision: a.revision, text: a.text, owner: a.owner?.person?.email ?? null, due: a.due ?? null });
const evidenceKey = (a: ActionItem): string => a.sourceId ?? a.lines.slice().sort().join(' ');
const sameValues = (a: ActionItem, b: ActionItem): boolean => a.text === b.text && (a.owner?.person?.email ?? a.owner?.name ?? null) === (b.owner?.person?.email ?? b.owner?.name ?? null) && (a.due ?? null) === (b.due ?? null);
/** Inference adds immutable proposals around the checklist and its durable review receipts. */
export function mergeActionProposals(was: ActionItem[], fresh: ActionItem[]): ActionItem[] {
  const kept = [...was];
  for (const candidate of fresh) {
    const key = evidenceKey(candidate);
    const same = candidate.changeOf ? was.find((a) => a.id === candidate.changeOf) : undefined;
    const values = was.filter((a) => sameValues(a, candidate));
    const exact = values.length === 1 ? values[0] : values.find((a) => evidenceKey(a) === key && a.sourceVersion === candidate.sourceVersion);
    const sources = key ? was.filter((a) => evidenceKey(a) === key) : [];
    const identities = new Set(sources.map((a) => a.changeOf ?? a.id));
    const oneCandidate = key && fresh.filter((a) => evidenceKey(a) === key).length === 1;
    const source = identities.size === 1 && oneCandidate ? sources.find(isAcceptedFollowUp) ?? sources[0] : undefined;
    // The model's explicit identity wins. Evidence alone cannot identify two different tasks from one utterance.
    const matched = same ?? exact ?? source;
    const corrected = matched !== undefined && matched.sourceVersion !== candidate.sourceVersion;
    if (matched && isPendingFollowUp(matched) && corrected) {
      const at = kept.findIndex((a) => a.id === matched.id);
      kept[at] = { ...candidate, id: matched.id, review: 'suggested', revision: id128(), changeOf: matched.changeOf, target: matched.target };
      continue;
    }
    if (matched && !isAcceptedFollowUp(matched) && !corrected) continue;
    if (matched && sameValues(candidate, matched)) continue;
    if (kept.some((a) => isPendingFollowUp(a) && a.sourceVersion === candidate.sourceVersion && sameValues(a, candidate))) continue;
    const target = matched && isAcceptedFollowUp(matched) ? matched : undefined;
    if (kept.filter((a) => !isAcceptedFollowUp(a)).length >= MAX_FOLLOW_UP_PROPOSALS) continue;
    kept.push({ ...candidate, review: 'suggested', revision: candidate.revision || id128(), changeOf: target?.id ?? null, target: target ? actionTarget(target) : null });
  }
  return kept;
}
