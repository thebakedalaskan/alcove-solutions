/*
 * Call passes. Joining a call hands back a pass that authorizes that person's requests for that call only:
 * organizer, invited people and guests alike, so guests need no account. It's a MAC'd JSON payload under a
 * key derived from KMASTER, sent in the x-alcove-call header, never in a URL, never logged.
 */
import { CallRoleSchema } from '@alcove/api';
import { z } from 'zod';
import type { Config } from './config';
import { b64u, callPassKey, equalBytes, fromUtf8, mac, unb64u, utf8 } from './crypto';

export const CALL_PASS_HEADER = 'x-alcove-call';
const LIFETIME_MS = 12 * 60 * 60_000;

const CallPassSchema = z.object({
  v: z.literal(1),
  callId: z.string(),
  /** The call's organizer: their keys are opened for the request. */
  ownerId: z.string(),
  /** This person's LiveKit identity. */
  identity: z.string(),
  role: CallRoleSchema,
  name: z.string(),
  exp: z.number()
});
export type CallPass = z.infer<typeof CallPassSchema>;

const key = (cfg: Config) => callPassKey(unb64u(cfg.KMASTER, 32));

export function issuePass(cfg: Config, p: Omit<CallPass, 'v' | 'exp'>): string {
  const payload = utf8(JSON.stringify({ v: 1, ...p, exp: Date.now() + LIFETIME_MS }));
  return `${b64u(payload)}.${b64u(mac(key(cfg), payload))}`;
}

/** The pass, if the MAC holds and it hasn't expired; otherwise undefined. */
export function readPass(cfg: Config, token: string | undefined): CallPass | undefined {
  if (!token || token.length > 2000) return undefined;
  const [body, tag, extra] = token.split('.');
  if (!body || !tag || extra !== undefined) return undefined;
  let payload: Uint8Array;
  let sent: Uint8Array;
  try { payload = unb64u(body); sent = unb64u(tag); } catch { return undefined; }
  if (!equalBytes(sent, mac(key(cfg), payload))) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(fromUtf8(payload)); } catch { return undefined; }
  const r = CallPassSchema.safeParse(parsed);
  return r.success && r.data.exp > Date.now() ? r.data : undefined;
}
