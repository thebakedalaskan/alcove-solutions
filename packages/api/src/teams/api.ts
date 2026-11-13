import { type NoteSummary } from '../notes/schema';
import { type ID } from '../shared/ids';
import { type MyTeam, type TeamInvite, type TeamInvitePeek } from './schema';

export interface TeamsApi {
  /** The team you're on, or null. */
  mine(): Promise<MyTeam | null>;
  /** Makes a team with you as its admin. Refused while you're on one. */
  create(name: string): Promise<MyTeam>;
  /** Admin only: a new one-time link to join. */
  invite(): Promise<TeamInvite>;
  /** Whose team an invite's link joins, before joining. The same `not-found` for a used, expired or made-up link. */
  peek(secret: string): Promise<TeamInvitePeek>;
  /** Joins the team the link is for, and takes a license if one is there. Refused while you're on a team. */
  join(secret: string): Promise<MyTeam>;
  /** Admin only: takes someone off the team. Their license isn't refunded. */
  remove(memberId: ID): Promise<MyTeam>;
  /** A member leaves the team. The admin can't. */
  leave(): Promise<void>;
  /** Admin only, once nobody else is on it: deletes the team and refunds its unconsumed licenses to your balance. */
  delete(): Promise<void>;
  /** Admin only: buys `count` licenses from your balance at `microUsdPerLicense`, the price you were shown. */
  buyLicenses(count: number, microUsdPerLicense: number): Promise<MyTeam>;
  /** Admin only: refunds every unconsumed license to your balance. */
  refundLicenses(): Promise<MyTeam>;
  /** Admin only: buy a license from your balance when a member needs one and none is left. */
  setAutoPurchase(on: boolean): Promise<MyTeam>;
  /** The notes made visible to the team that you can open (a live license needed), newest first. */
  notes(): Promise<NoteSummary[]>;
}
