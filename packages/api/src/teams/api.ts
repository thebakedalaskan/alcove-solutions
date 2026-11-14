import { type NoteSummary } from '../notes/schema';
import { type ID } from '../shared/ids';
import { type InvitationForYou, type InvitationsMade, type MyTeam } from './schema';

/**
 * Teams (docs: Plans and usage › Team). A team is free to start, and anyone, at any address, can be on it; licenses are what
 * share its notes, workspaces and storage. One team for each account.
 */
export interface TeamsApi {
  /** The team you're on, or null. */
  mine(): Promise<MyTeam | null>;
  /** Makes a team, free, with you as its admin. Refused while you're on one. */
  create(name: string): Promise<MyTeam>;
  /** Admin only: renames the team. */
  rename(name: string): Promise<MyTeam>;
  /**
   * Invites these addresses to your team: Alcove emails each one, and someone already on Alcove sees it in the app too.
   * Makes your team first if you're on none (named for your company, or for you), with you as its admin. Anyone on it
   * already is counted as `already`; anyone invited is invited again. Refused past today's limit, and for your own address.
   */
  invite(emails: string[]): Promise<InvitationsMade>;
  /** Emails an invitation again and starts its 30 days again: whoever invited them or the admin, once a day at most. */
  resendInvitation(id: ID): Promise<MyTeam>;
  /** Cancels an invitation, so its link stops working: whoever invited them or the admin. */
  cancelInvitation(id: ID): Promise<MyTeam>;
  /** The invitations to your sign-in addresses that haven't run out, newest first, put aside or not. */
  invitations(): Promise<InvitationForYou[]>;
  /**
   * Accepts an invitation to one of your addresses: you're on its team from now. On a team already, `leave` (asked first,
   * in place) leaves it, or deletes it if you're its admin alone on it; without it that's `conflict`. An admin with others
   * on their team can't.
   */
  acceptInvitation(id: ID, leave?: boolean | undefined): Promise<MyTeam>;
  /** Not now: puts an invitation aside for you, out of your count. Nobody is told. */
  putInvitationAside(id: ID): Promise<void>;
  /**
   * Joins the team a secret after `/invite#` leads to: an invitation's own link (used up by joining) or someone's invite link
   * (their team, made for them then if they're on none). `leave` as for `acceptInvitation`.
   */
  join(secret: string, leave?: boolean | undefined): Promise<MyTeam>;
  /** A member of a free team asks its admin to upgrade it: the admin is told once, at most every 7 days for each member. */
  askToUpgrade(): Promise<void>;
  /** Admin only: takes someone off the team. Their license isn't refunded. */
  remove(memberId: ID): Promise<MyTeam>;
  /** A member leaves the team. The admin can't. */
  leave(): Promise<void>;
  /** Admin only, once nobody else is on it: deletes the team and refunds its unconsumed licenses to your balance. */
  delete(): Promise<void>;
  /**
   * Admin only: buys `count` licenses from your balance at `microUsdPerLicense` a period, the price you were shown, each
   * for `periods` periods (1, the default, at a license's price; a year's, `PlanOffers.team.yearly.periods`, at its lower
   * price). It costs `count` × `periods` × `microUsdPerLicense`. `autoPurchase`, when given, sets auto-purchase in the same
   * transaction.
   */
  buyLicenses(count: number, microUsdPerLicense: number, periods?: number | undefined, autoPurchase?: boolean | undefined): Promise<MyTeam>;
  /** Admin only: refunds every unconsumed license to your balance. */
  refundLicenses(): Promise<MyTeam>;
  /** Admin only: buy a license from your balance when a member needs one and none is left. */
  setAutoPurchase(on: boolean): Promise<MyTeam>;
  /** The notes made visible to the team that you can open (a live license needed), newest first. */
  notes(): Promise<NoteSummary[]>;
}
