import { type ID } from '../shared/ids';
import { type Plan, type PlanOffers, type TopUp, type TopUpRoutes } from './schema';
export interface PlansApi {
  /** The account's plan: notes left this period, storage, its balance. */
  plan(): Promise<Plan>;
  /** The plans on offer, what each brings and what Pro costs now. */
  offers(): Promise<PlanOffers>;
  /**
   * Buys `months` of Pro from the balance, after any already bought, at `microUsdPerMonth`, the price the buyer was shown.
   * On Free, Pro starts now with a fresh period and the whole allowance. Refused with nothing charged if the balance is
   * short, `months` is past the most one purchase buys, or the price has changed since.
   */
  buyPro(months: number, microUsdPerMonth: number): Promise<Plan>;
  /** Refunds every month of Pro that hasn't started to the balance. Refused when there's none: a started month isn't refunded. */
  refundPro(): Promise<Plan>;
  /** Turns on or off buying a month from the balance as Pro is about to end. */
  setRenew(renew: boolean): Promise<Plan>;
  /** Stops showing one of the plan's notices. */
  dismissNotice(id: string): Promise<Plan>;
  /** The ways to add money right now, and the amounts offered first. */
  routes(): Promise<TopUpRoutes>;
  /** Opens a top-up for `microUsd` on one of those routes: the amount to send, and an address for that one payment. */
  startTopUp(routeId: string, microUsd: number): Promise<TopUp>;
  /** A top-up as it stands now. */
  topUp(id: ID): Promise<TopUp>;
  /**
   * Cancels a top-up nothing has reached yet: its address stops being shown. A payment sent to it anyway is still
   * added when it arrives. Refused once a payment has reached it.
   */
  cancelTopUp(id: ID): Promise<TopUp>;
  /** Top-ups still open, and the last 10 finished, newest first. */
  topUps(): Promise<TopUp[]>;
}
