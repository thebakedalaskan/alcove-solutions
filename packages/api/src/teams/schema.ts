import { InviteSecretSchema } from '../identity/invite-links';
import { PersonSchema } from '../identity/people';
import { MAX_LICENSE_PERIODS, MicroUsdSchema } from '../plans/schema';
import { IDSchema, ISODateSchema } from '../shared/ids';
import { z } from '../shared/zod';

/* ---------- teams (docs: Plans and usage › Team) ---------- */

/** The admin made the team and keeps its settings, licensed or not; everyone else is a member. */
export const TeamRoleSchema = z.enum(['admin', 'member']);
export type TeamRole = z.infer<typeof TeamRoleSchema>;

/**
 * A member's license: `live` until `until`; `ended` at `until`, and not taken again until they next use Alcove; `none`
 * while they've never had one. `wanted`: when they last needed one and none was left.
 */
export const TeamLicenseSchema = z.object({
  state: z.enum(['live', 'ended', 'none']),
  until: ISODateSchema.nullable(),
  wanted: ISODateSchema.nullable()
});
export type TeamLicense = z.infer<typeof TeamLicenseSchema>;

export const TeamMemberSchema = z.object({
  /** The member's ID on this team: not their account's. */
  id: IDSchema,
  person: PersonSchema,
  role: TeamRoleSchema,
  license: TeamLicenseSchema,
  joinedAt: ISODateSchema,
  you: z.boolean()
});
export type TeamMember = z.infer<typeof TeamMemberSchema>;

/**
 * A team's tier, never stored: `team` while anyone on it has a live license, `free` otherwise. A free team is its people:
 * everyone on it stays on their own plan, and what a team shares (its notes, Ask across them, whole-team workspaces, the
 * pool) opens only with a live license, so upgrading is buying licenses.
 */
export const TeamTierSchema = z.enum(['free', 'team']);
export type TeamTier = z.infer<typeof TeamTierSchema>;

/**
 * Someone asked to join the team and not on it yet, as everyone on it sees it (docs: Plans and usage › Team ›
 * Invitations). `person` is the address as the directory or your calls know it; `you`: you invited them.
 */
export const TeamInvitationSchema = z.object({
  id: IDSchema,
  person: PersonSchema,
  invitedBy: PersonSchema,
  you: z.boolean(),
  /** When they were first invited. */
  madeAt: ISODateSchema,
  /** When it was made, or last sent again: its 30 days run from then. */
  at: ISODateSchema,
  expiresAt: ISODateSchema,
  /** Whether you can Resend or Cancel it: you invited them, or you're the team's admin. */
  manage: z.boolean(),
  /** When Resend can next be pressed; null while it can be now. */
  resendAt: ISODateSchema.nullable(),
  /**
   * Why it can't be resent yet: it was sent too recently (`recent`, once a day at most), or as many times as one team may
   * send it in its 30 days (`most`); null while it can be. Counts only this team's own sends.
   */
  resendWhy: z.enum(['recent', 'most']).nullable(),
  /** How many times this team has sent it in its 30 days. */
  sends: z.number().int().nonnegative()
});
export type TeamInvitation = z.infer<typeof TeamInvitationSchema>;

/** A team as someone not on it may see it, on an invitation: its name, how many are on it, and up to 4 of them. */
export const TeamGlimpseSchema = z.object({ name: z.string(), people: z.number().int().nonnegative(), faces: z.array(PersonSchema).max(4) });
export type TeamGlimpse = z.infer<typeof TeamGlimpseSchema>;

/**
 * An invitation to one of your sign-in addresses, as you see it in the app: who asked, to which team, until when.
 * `putAside`: you pressed Not now, so it's out of your count, and still yours to accept until it runs out.
 */
export const InvitationForYouSchema = z.object({
  id: IDSchema,
  from: PersonSchema,
  team: TeamGlimpseSchema,
  at: ISODateSchema,
  expiresAt: ISODateSchema,
  putAside: z.boolean()
});
export type InvitationForYou = z.infer<typeof InvitationForYouSchema>;

/**
 * What a secret after `/invite#` says to whoever opens it, signed in or not (`POST /v1/team/link/peek`): an invitation's own
 * link, from its email (`invitation`), or an invite link (`link`): a team's, its admin's, or the link of someone on no team.
 * `from` asked (a team's admin, for a team's link); `yours`: it's your own invite link, or your team's, and you're signed in.
 * `team`: the team joining it puts you on, or null for an invite link whose owner is on no team yet, which joining makes
 * (named for them) with them as its admin. Its `faces` are named, never addressed: their `email` is empty.
 */
export const InvitePeekSchema = z.object({
  kind: z.enum(['invitation', 'link']),
  from: PersonSchema,
  yours: z.boolean(),
  team: TeamGlimpseSchema.nullable(),
  /**
   * An invitation's own ID when you're signed in as the person it's to (one of your sign-in addresses), so Not now can put it
   * aside; null for an invite link, signed out, or anyone else holding it.
   */
  invitationId: IDSchema.nullable()
});
export type InvitePeek = z.infer<typeof InvitePeekSchema>;

/** The team you're on, as you see it. Licenses and money are the admin's alone (null for a member). */
export const MyTeamSchema = z.object({
  id: IDSchema,
  name: z.string(),
  /** Your role on it. */
  role: TeamRoleSchema,
  tier: TeamTierSchema,
  /** Whether you have a live license: the team's notes, workspaces and storage are yours only while you do. */
  licensed: z.boolean(),
  members: z.array(TeamMemberSchema),
  /** Who's been asked to join and hasn't yet, newest first: every member sees them. */
  invitations: z.array(TeamInvitationSchema),
  /** The team's storage: `plan.team.storage_bytes` for each live license, shared by everyone licensed. */
  storage: z.object({ usedBytes: z.number().int().nonnegative(), limitBytes: z.number().int().nonnegative() }),
  /** Only for the admin. */
  licenses: z.object({
    /** Bought and not yet taken by anyone. */
    unconsumed: z.number().int().nonnegative(),
    /** What refunding the unconsumed ones would add to your balance. */
    refundableMicroUsd: MicroUsdSchema,
    /** Whether a license is bought from your balance when a member needs one and none is left. */
    autoPurchase: z.boolean()
  }).nullable()
});
export type MyTeam = z.infer<typeof MyTeamSchema>;

export const TeamNameSchema = z.string().trim().min(1).max(120);
export const CreateTeamBodySchema = z.object({ name: TeamNameSchema });
export const RenameTeamBodySchema = z.object({ name: TeamNameSchema });

/** Addresses to invite to your team: whole addresses, any domain, at most 50 at once. */
export const InviteByEmailBodySchema = z.object({ emails: z.array(z.string().trim().toLowerCase().email().max(254)).min(1).max(50) });
/**
 * What inviting did: the team (made for you if you had none), how many were invited or invited again (`invited`), how
 * many were on the team already (`already`), and how many weren't invited because they'd go past today's limit (`over`):
 * the first ones invite, in the order sent, up to what's left of today's.
 */
export const InvitationsMadeSchema = z.object({ team: MyTeamSchema, invited: z.number().int().nonnegative(), already: z.number().int().nonnegative(), over: z.number().int().nonnegative() });
export type InvitationsMade = z.infer<typeof InvitationsMadeSchema>;

/**
 * Joining a team while you're on another: `leave` says you were asked, in place, and want to leave it (or, as its admin
 * alone on it, delete it). Without it, someone on a team is refused with `conflict`, and nothing changes.
 */
export const AcceptInvitationBodySchema = z.object({ leave: z.boolean().default(false) });
/** Joining by a link: an invitation's own (from its email) or someone's invite link, its secret after the `#`. */
export const JoinTeamBodySchema = z.object({ secret: InviteSecretSchema, leave: z.boolean().default(false) });
/**
 * `count` licenses at `microUsdPerLicense` a period, the price the buyer was shown, each for `periods` periods: 1 at a
 * license's price, or a year's (`PlanOffers.team.yearly`) at its lower price. Without `periods`, one.
 */
export const BuyLicensesBodySchema = z.object({
  count: z.number().int().min(1).max(100_000), microUsdPerLicense: MicroUsdSchema.min(0), periods: z.number().int().min(1).max(MAX_LICENSE_PERIODS).default(1),
  /** Sets auto-purchase in the same transaction as the purchase, as checkout's "Buy one for each person who joins later" says; absent: unchanged. */
  autoPurchase: z.boolean().optional()
});
export const AutoPurchaseBodySchema = z.object({ on: z.boolean() });
/** Who sees a workspace made on a team: every licensed member (`team`, "Whole team"), or only the people added (`added`). */
export const TeamAccessSchema = z.enum(['team', 'added']);
export type TeamAccess = z.infer<typeof TeamAccessSchema>;
export const TeamAccessBodySchema = z.object({ access: TeamAccessSchema });
