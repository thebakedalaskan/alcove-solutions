/*
 * Starting a team, from a company's Team page while you're on none (docs/design/pages.md › Team): a quiet row on the water
 * that opens checkout on Team, where the team is named and its first licenses bought (features/plans/checkout.tsx).
 */
import { TeamStartRow } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useCheckout } from '~/features/plans/checkout';
import { licenseRuns } from '~/features/plans/purchase';
import { planQueries } from '~/features/plans/queries';
import { plural, usd } from '~/lib/words';

export function StartTeam() {
  const checkout = useCheckout();
  const offers = useQuery(planQueries.offers()).data;
  /* A period's price, and a year's while one is offered: "$40 for 30 days, or $384 for a year". */
  const year = offers?.team.yearly;
  const each = offers
    ? `: ${usd(offers.team.microUsdPerLicense)} for ${plural(offers.periodDays, 'day')}${year ? `, or ${usd(year.microUsdPerLicense * year.periods)} for ${licenseRuns(year.periods, offers.periodDays)}` : ''}`
    : '';
  return (
    <TeamStartRow line={`A license for each person${each}. Share notes and workspaces with everyone on it.`}
      onStart={() => checkout.open({ plan: 'team' }, 'team')} />
  );
}
