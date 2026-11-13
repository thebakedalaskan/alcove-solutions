/*
 * The notes someone can ask about: theirs, the ones shared with them, and while they're licensed on a team, the team's.
 */
import type { NoteSummary } from '@alcove/api';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { q } from '~/lib/queries';

/** Every note you can ask about: yours and the ones shared with you, then your team's while you're licensed on it. */
export function useAskableNotes(): NoteSummary[] {
  const own = useQuery(q.notes()).data;
  const licensed = useQuery(q.plan()).data?.team?.licensed === true;
  const team = useQuery({ ...q.teamNotes(), enabled: licensed }).data;
  return useMemo(() => {
    const mine = own ?? [];
    return [...mine, ...(licensed ? team ?? [] : []).filter((t) => !mine.some((n) => n.id === t.id))];
  }, [own, team, licensed]);
}
