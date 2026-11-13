/*
 * Plans, on the welcome page (docs/product/user-flows.md 16.13): the cove at night with the last of the sun on its horizon,
 * Free, Pro and Team on its water as small cards with what each costs and brings, and the ways in under them: Start free, the
 * sign-in the page already has; Get Pro, which signs in and then opens Plans with checkout on Pro; and Start a team, which
 * does the same with checkout on Team (features/account/afterSignIn.ts carries either through sign-in, wherever Google's way back lands).
 * All three are secondary: the welcome page's one filled button is its way in, Continue with Google, and the last ask's comes
 * into view with them as the page scrolls on.
 */
import type { CheckoutParam } from '@alcove/api';
import { Button, Icon, cn, type IconName } from '@alcove/ui';
import { returnTo } from '~/features/account/afterSignIn';
import { forgetSailOut } from '~/features/onboarding/sailOut';
import { PLANS_COVE } from './coves';
import { PartHead, Sky } from './Sky';
import type { Auth } from '~/features/account/WaysIn';

/**
 * What Free, Pro and Team cost and bring, as they're said before anyone signs in, in the Plans page's words. The server's
 * offers (GET /v1/plan/offers) are the truth, and they need a session, so these are kept here by hand: change them with the
 * limits they say (docs: Plans and usage › the plans, `plan.*` in apps/api/src/platform/limits.ts). Pro is a month at a time, bought for
 * as many months as you choose; Team is a license for each person, a period (30 days) at a time, each bringing its own notes
 * and adding its storage to the team's.
 */
const PLANS: readonly { name: string; price: string; per: string; pro: boolean; facts: readonly (readonly [IconName, string])[] }[] = [
  { name: 'Free', price: '$0', per: 'a month', pro: false, facts: [['notes', 'About 5 hours of notes a month'], ['hardDrive', '10 GB of storage']] },
  { name: 'Pro', price: '$20', per: 'a month', pro: true, facts: [['notes', 'About 50 hours of notes a month'], ['hardDrive', '100 GB of storage']] },
  { name: 'Team', price: '$40', per: 'a person a month', pro: false, facts: [['notes', 'About 50 hours of notes each'], ['hardDrive', '100 GB each, shared by the team']] }
];

export function PlansScene({ auth }: { auth: Auth }) {
  const locked = auth.busy !== null;
  /* Signing in from here goes to Plans, with checkout open on what was chosen, not Home, so there's no cove to sail out of. */
  const signInFor = (checkout: CheckoutParam) => () => { returnTo({ to: 'plans', checkout }); auth.google(); forgetSailOut(); };
  return (
    <Sky moment="plans" className="lp-plans" id="plans" cove={PLANS_COVE} sky={(
      <div className="lp-wrap lp-plans-in">
        <PartHead center id="plans-title" title="Plans">Every feature is on every plan. Pro and Team bring more notes and more room.</PartHead>
      </div>
    )}>
      <span className="lp-plans-sun" aria-hidden="true" />
      <div className="lp-wrap lp-plans-water">
        <ul className="lp-plans-cards" aria-labelledby="plans-title">
          {PLANS.map((p) => (
            <li key={p.name} className={cn('lp-plan', p.pro && 'is-pro')}>
              <h3>{p.name}</h3>
              <p className="lp-plan-price"><b>{p.price}</b><span>{p.per}</span></p>
              <ul className="lp-plan-facts">{p.facts.map(([icon, text]) => <li key={text}><Icon name={icon} size={16} />{text}</li>)}</ul>
            </li>
          ))}
        </ul>
        <div className="lp-plans-go">
          <Button variant="secondary" disabled={locked} onClick={auth.google}>Start free</Button>
          <Button variant="secondary" disabled={locked} onClick={signInFor('pro')}>Get Pro</Button>
          <Button variant="secondary" disabled={locked} onClick={signInFor('team')}>Start a team</Button>
        </div>
      </div>
    </Sky>
  );
}
