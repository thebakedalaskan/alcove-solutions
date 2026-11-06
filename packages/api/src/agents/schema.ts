/* A person's revocable delegation to an agent. Every permission stays within that person's existing access. */
import { z } from '../shared/zod';

export const AGENT_SCOPES = [
  'notes:read', 'notes:write', 'notes:share', 'notes:delete', 'meetings:read', 'meetings:write', 'calendar:read'
] as const;
export const AgentScopeSchema = z.enum(AGENT_SCOPES);
export type AgentScope = z.infer<typeof AgentScopeSchema>;

/** A permission is listed once; a connection with no permissions is never created. */
export const AgentScopesSchema = z.array(AgentScopeSchema).min(1).max(AGENT_SCOPES.length)
  .refine((scopes) => new Set(scopes).size === scopes.length, 'Choose each permission once.');
export const AgentConnectionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
export const AgentAuthorizationIdSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const AgentOwnerIdSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const AgentConnectionSchema = z.object({
  id: AgentConnectionIdSchema,
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['token', 'oauth']),
  scopes: AgentScopesSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable()
});
export type AgentConnection = z.infer<typeof AgentConnectionSchema>;

export const AgentTokenInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: AgentScopesSchema,
  expiresInDays: z.number().int().min(1).max(90).default(30)
});
export type AgentTokenInput = z.infer<typeof AgentTokenInputSchema>;

/** The bearer appears only in this response. Listing connections never returns it. */
export const AgentTokenResultSchema = z.object({
  connection: AgentConnectionSchema,
  token: z.string().min(43).max(256),
  endpoint: z.url()
});
export type AgentTokenResult = z.infer<typeof AgentTokenResultSchema>;

export const AgentAuthorizationSchema = z.object({
  ownerId: AgentOwnerIdSchema,
  accountEmail: z.email(),
  clientName: z.string().min(1).max(80),
  scopes: AgentScopesSchema,
  expiresAt: z.iso.datetime()
});
export type AgentAuthorization = z.infer<typeof AgentAuthorizationSchema>;

/** Cancel may have no scopes. Allow always chooses at least one of the permissions requested. */
export const AgentDecisionInputSchema = z.object({
  /** The account shown in the preview; switching accounts requires reviewing consent again. */
  ownerId: AgentOwnerIdSchema,
  allow: z.boolean(),
  scopes: z.array(AgentScopeSchema).max(AGENT_SCOPES.length)
}).refine((decision) => (!decision.allow || decision.scopes.length > 0) && new Set(decision.scopes).size === decision.scopes.length,
  'Choose each permission once, and at least one when allowing access.');
export type AgentDecisionInput = z.infer<typeof AgentDecisionInputSchema>;
export const AgentDecisionResultSchema = z.object({ redirectUrl: z.url() });
export type AgentDecisionResult = z.infer<typeof AgentDecisionResultSchema>;

/** A short-lived consent pointer for this tab's sign-in round trip. It carries no credential. */
export const AgentReturnStoredSchema = z.object({ requestId: AgentAuthorizationIdSchema, until: z.number() });
