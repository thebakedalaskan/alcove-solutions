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

/** Where an agent reaches Alcove (its MCP address), for a signed-in person to copy before any token exists. */
export const AgentEndpointSchema = z.object({ endpoint: z.url() });
export type AgentEndpoint = z.infer<typeof AgentEndpointSchema>;

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
  /** The name the agent gave itself when it registered: anyone can choose it, so consent never treats it as proof. */
  clientName: z.string().min(1).max(80),
  /** Where allowing sends the browser back to, and with it the agent's code: the host of its registered callback. */
  redirectHost: z.string().min(1).max(300),
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

/** Changing a connection after it's made: what it can do, another 30 days, or both. */
export const AgentUpdateInputSchema = z.object({
  scopes: AgentScopesSchema.optional(),
  renew: z.literal(true).optional()
}).refine((input) => input.scopes !== undefined || input.renew !== undefined, 'Change what it can do, or keep it longer.');
export type AgentUpdateInput = z.infer<typeof AgentUpdateInputSchema>;

/** Every tool an agent can call over MCP, by name: what the activity log records. */
export const AGENT_TOOLS = [
  'list_notes', 'get_note', 'ask_note', 'ask_notes', 'get_inbox', 'get_personal_notes', 'propose_decision', 'update_decision', 'propose_action',
  'update_action', 'update_question', 'correct_transcript', 'rewrite_note', 'add_personal_note', 'edit_personal_note', 'remove_personal_note',
  'share_note', 'delete_note', 'list_meetings', 'get_meeting', 'find_people', 'schedule_call', 'update_call', 'cancel_call', 'answer_call',
  'schedule_next_call', 'start_call', 'get_calendar', 'get_availability'
] as const;
export const AgentToolSchema = z.enum(AGENT_TOOLS);
export type AgentTool = z.infer<typeof AgentToolSchema>;

export const AgentActivityIdSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
/**
 * One thing an agent did, for its owner alone. The record keeps only the tool, the IDs it touched and a count; a title
 * is read when the list is, from what the owner can still open, so it's null once that's gone.
 */
export const AgentActivitySchema = z.object({
  id: AgentActivityIdSchema,
  connectionId: AgentConnectionIdSchema,
  at: z.iso.datetime(),
  tool: AgentToolSchema,
  noteId: z.string().max(64).nullable(),
  noteTitle: z.string().nullable(),
  meetingId: z.string().max(64).nullable(),
  meetingTitle: z.string().nullable(),
  meetingStartsAt: z.iso.datetime().nullable(),
  /** How many it found or listed, where that's what it did. */
  count: z.number().int().min(0).nullable()
});
export type AgentActivity = z.infer<typeof AgentActivitySchema>;
/** A page of activity, newest first. `next` is an opaque cursor for the page after, or null at the end. */
export const AgentActivityPageSchema = z.object({ items: z.array(AgentActivitySchema), next: z.string().max(200).nullable() });
export type AgentActivityPage = z.infer<typeof AgentActivityPageSchema>;
export const AgentActivityQuerySchema = z.object({ before: z.string().max(200).optional(), limit: z.number().int().min(1).max(100).default(40) });
export type AgentActivityQuery = z.input<typeof AgentActivityQuerySchema>;
