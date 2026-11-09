import { type ID } from '../shared/ids';
import { type CreditBalance, type TopUp, type TopUpRoutes } from './schema';
export interface CreditsApi {
  balance(): Promise<CreditBalance>;
  /** The ways to pay for credits right now, and how many credits a USD buys at each size of payment. */
  routes(): Promise<TopUpRoutes>;
  /** Opens a top-up for `credits` on one of those routes: the amount to send, and an address for that one payment. */
  startTopUp(routeId: string, credits: number): Promise<TopUp>;
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
