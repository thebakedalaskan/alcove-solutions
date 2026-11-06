import { z } from '../shared/zod';

/** OAuth protocol inputs stay unknown until these schemas parse them. */
export const AgentClientInputSchema = z.object({
  client_name: z.string().trim().min(1).max(80),
  redirect_uris: z.array(z.string().min(1).max(2048)).min(1).max(10),
  token_endpoint_auth_method: z.literal('none').default('none'),
  grant_types: z.array(z.enum(['authorization_code', 'refresh_token'])).default(['authorization_code', 'refresh_token']),
  response_types: z.array(z.literal('code')).default(['code'])
});
export const AgentAuthorizeInputSchema = z.object({
  response_type: z.literal('code'), client_id: z.string().min(1).max(200), redirect_uri: z.string().min(1).max(2048),
  resource: z.string().min(1).max(2048), scope: z.string().min(1).max(500), state: z.string().max(1024).optional(),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code_challenge_method: z.literal('S256')
});
export const AgentTokenBodySchema = z.object({
  grant_type: z.enum(['authorization_code', 'refresh_token']), client_id: z.string().min(1).max(200),
  resource: z.string().min(1).max(2048), code: z.string().max(200).optional(),
  redirect_uri: z.string().max(2048).optional(), code_verifier: z.string().max(128).optional(),
  refresh_token: z.string().max(200).optional(), scope: z.string().max(500).optional()
});
export const AgentRevokeBodySchema = z.object({ token: z.string().min(1).max(200), client_id: z.string().max(200).optional(), token_type_hint: z.string().max(100).optional() });
