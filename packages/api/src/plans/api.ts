import { type ID } from '../shared/ids';
import { type Plan, type TopUp, type TopUpRoutes } from './schema';
export interface PlansApi {
  /** The account's plan: notes left this period, storage, shared workspaces, its balance. */
  plan(): Promise<Plan>;
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
