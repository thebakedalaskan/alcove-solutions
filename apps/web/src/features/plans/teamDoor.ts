/*
 * Team at the third invite (docs/product/user-flows.md 16.21, the canvas's Doors board, door 8): the invite always goes, and
 * when it makes three of you at your company while you're on no team, Team is offered once, beside the invite's own toast,
 * with See Team, which opens checkout on Team. "Of you" is you, everyone on Alcove and everyone invited. The price is the
 * server's (GET /v1/plan/offers).
 */
import type { Team } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { log } from '~/lib/log';
import { accountQueries } from '~/features/account/queries';
import { teamQueries } from '~/features/team/queries';
import { planQueries } from './queries';
import { usd } from '~/lib/words';
import { useCheckout } from './checkout';
import { offerOnce } from './teamOffer';
import { perPeriod } from './words';

const plog = log.child({ component: 'plan-doors' });

/** You, everyone at your company on Alcove, and everyone invited. */
const ofYou = (team: Team | null | undefined): number => 1 + (team?.members.filter((m) => m.onAlcove || m.invited).length ?? 0);

/**
 * For an invite to `count` people, counted as it's pressed: what to do once it has gone, which offers Team when it made three
 * of you (from fewer), you're on no team, and Team hasn't been offered to this account here before.
 */
export function useTeamAtThirdInvite(): (count: number) => () => void {
  const qc = useQueryClient();
  const toast = useToast();
  const { open } = useCheckout();
  return useCallback((count) => {
    const before = ofYou(qc.getQueryData(teamQueries.team().queryKey));
    const now = before + count;
    return () => {
      const session = qc.getQueryData(accountQueries.session().queryKey);
      if (before >= 3 || now < 3 || !session || qc.getQueryData(teamQueries.myTeam().queryKey) !== null || !offerOnce(session.ownerId)) return;
      const say = (price: string | null) => {
        plog.info('offered Team at an invite', { people: now });
        toast(`That makes ${now} of you. ${price ? `Put everyone on one plan: Team, ${price}.` : 'Team puts everyone on one plan.'}`, {
          icon: 'addUser', ms: 12_000, topic: 'team-offer', action: { label: 'See Team', onClick: () => open({ plan: 'team' }, 'team') }
        });
      };
      void qc.ensureQueryData(planQueries.offers()).then(
        (o) => say(`${usd(o.team.microUsdPerLicense)} a person ${perPeriod(o.periodDays)}`),
        (e: unknown) => { plog.info('Team offered without its price', { err: e }); say(null); }
      );
    };
  }, [qc, toast, open]);
}
