/*
 * Starting a team, from a company's Team page while you're on none (docs/design/pages.md › Team): a quiet row on the water
 * that opens checkout on Team, where the team is named and its first licenses bought (features/plans/checkout.tsx).
 */
import { TeamStartRow } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useCheckout } from '~/features/plans/checkout';
import { q } from '~/lib/queries';
import { plural, usd } from '~/lib/words';

export function StartTeam() {
  const checkout = useCheckout();
  const offers = useQuery(q.offers()).data;
  const each = offers ? `: ${usd(offers.team.microUsdPerLicense)} for ${plural(offers.periodDays, 'day')}` : '';
  return (
    <TeamStartRow line={`A license for each person${each}. Share notes and workspaces with everyone on it.`}
      onStart={() => checkout.open({ plan: 'team' }, 'team')} />
  );
}
