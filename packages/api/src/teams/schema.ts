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

/** The team you're on, as you see it. Licenses and money are the admin's alone (null for a member). */
export const MyTeamSchema = z.object({
  id: IDSchema,
  name: z.string(),
  /** Your role on it. */
  role: TeamRoleSchema,
  /** Whether you have a live license: the team's notes, workspaces and storage are yours only while you do. */
  licensed: z.boolean(),
  members: z.array(TeamMemberSchema),
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

/** A one-time link to join a team. Only the admin makes one; it's shown once and works once, until `expiresAt`. */
export const TeamInviteSchema = z.object({ link: z.string().url(), expiresAt: ISODateSchema });
export type TeamInvite = z.infer<typeof TeamInviteSchema>;
/** What an invite's link says before it's used: whose team it is. */
export const TeamInvitePeekSchema = z.object({ name: z.string(), admin: PersonSchema, expiresAt: ISODateSchema });
export type TeamInvitePeek = z.infer<typeof TeamInvitePeekSchema>;

export const TeamNameSchema = z.string().trim().min(1).max(120);
export const CreateTeamBodySchema = z.object({ name: TeamNameSchema });
/** The secret from an invite's link (after its `#`). */
export const TeamSecretBodySchema = z.object({ secret: z.string().min(16).max(200) });
/**
 * `count` licenses at `microUsdPerLicense` a period, the price the buyer was shown, each for `periods` periods: 1 at a
 * license's price, or a year's (`PlanOffers.team.yearly`) at its lower price. Without `periods`, one.
 */
export const BuyLicensesBodySchema = z.object({ count: z.number().int().min(1).max(100_000), microUsdPerLicense: MicroUsdSchema.min(0), periods: z.number().int().min(1).max(MAX_LICENSE_PERIODS).default(1) });
export const AutoPurchaseBodySchema = z.object({ on: z.boolean() });
/** Who sees a workspace made on a team: every licensed member (`team`, "Whole team"), or only the people added (`added`). */
export const TeamAccessSchema = z.enum(['team', 'added']);
export type TeamAccess = z.infer<typeof TeamAccessSchema>;
export const TeamAccessBodySchema = z.object({ access: TeamAccessSchema });
