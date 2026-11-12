/*
 * Plans, on the welcome page (the plans spec's doors, 1): the cove at night with the last of the sun on its horizon, Free and
 * Pro on its water as small cards with what each costs and brings, and the two ways in under them: Start free, the sign-in
 * the page already has, and Get Pro, which signs in and then opens Plans with checkout on Pro (lib/afterSignIn.ts carries it
 * through sign-in, wherever Google's way back lands).
 */
import { Button, Icon, cn, type IconName } from '@alcove/ui';
import { returnToPlans } from '~/lib/afterSignIn';
import { forgetSailOut } from '~/lib/sailOut';
import { PLANS_COVE } from './coves';
import { PartHead, Sky } from './Sky';
import type { Auth } from './WaysIn';

/**
 * What Free and Pro cost and bring, as they're said before anyone signs in. The server's offers (GET /v1/plan/offers) are the
 * truth, and they need a session, so these are kept here by hand: change them with the limits they say (docs: Plans and usage
 * › the plans, `plan.*` in apps/api/src/limits.ts). Pro is a month at a time, bought for as many months as you choose.
 */
const PLANS: readonly { name: string; price: string; pro: boolean; facts: readonly (readonly [IconName, string])[] }[] = [
  { name: 'Free', price: '$0', pro: false, facts: [['notes', 'About 5 hours of notes a month'], ['hardDrive', '10 GB of storage']] },
  { name: 'Pro', price: '$20', pro: true, facts: [['notes', 'About 50 hours of notes a month'], ['hardDrive', '100 GB of storage']] }
];

export function PlansScene({ auth }: { auth: Auth }) {
  const locked = auth.busy !== null;
  /* Signing in from here goes to Plans, not Home, so there's no cove to sail out of. */
  const getPro = () => { returnToPlans(); auth.google(); forgetSailOut(); };
  return (
    <Sky moment="plans" className="lp-plans" id="plans" cove={PLANS_COVE} sky={(
      <div className="lp-wrap lp-plans-in">
        <PartHead center id="plans-title" title="Plans">Every feature is on every plan. Pro brings more notes and more room.</PartHead>
      </div>
    )}>
      <span className="lp-plans-sun" aria-hidden="true" />
      <div className="lp-wrap lp-plans-water">
        <ul className="lp-plans-cards" aria-labelledby="plans-title">
          {PLANS.map((p) => (
            <li key={p.name} className={cn('lp-plan', p.pro && 'is-pro')}>
              <h3>{p.name}</h3>
              <p className="lp-plan-price"><b>{p.price}</b><span>a month</span></p>
              <ul className="lp-plan-facts">{p.facts.map(([icon, text]) => <li key={text}><Icon name={icon} size={16} />{text}</li>)}</ul>
            </li>
          ))}
        </ul>
        <div className="lp-plans-go">
          <Button variant="secondary" disabled={locked} onClick={auth.google}>Start free</Button>
          <Button variant="primary" disabled={locked} onClick={getPro}>Get Pro</Button>
        </div>
      </div>
    </Sky>
  );
}
