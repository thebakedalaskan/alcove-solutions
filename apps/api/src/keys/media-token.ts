/*
 * Media tokens. A picture or a player can't send a header, and a guest has no cookie, so the URL a file is read from
 * carries this instead: who's asking and what for, MAC'd as a call pass is, under a key of its own derived from KMASTER, for
 * 12 hours. It decides nothing: every request brings it to features/workspaces/uploads/media.ts, which asks features/workspaces/access.ts again. It holds
 * only opaque IDs, because it's in a URL, and a call pass never is: a seat is named, and nothing of the pass goes in here.
 */
import { z } from 'zod';
import type { Config } from '../platform/config';
import { b64u, equalBytes, fromUtf8, mac, mediaTokenKey, unb64u, utf8 } from './crypto';

export const MEDIA_TOKEN_MS = 12 * 60 * 60_000;

/** Someone's place in a call: which call, whose it is, and the seat, by the keyed name it has in that call. */
const SeatNameSchema = z.object({ callId: z.string(), organizer: z.string(), seat: z.string() });
export type SeatName = z.infer<typeof SeatNameSchema>;
const MediaTokenSchema = z.object({
  v: z.literal(1),
  /** Who's asking: an account, a seat in a call, or both, for someone signed in and in a call. */
  account: z.string().nullable(),
  seat: SeatNameSchema.nullable(),
  /** What for: one file, through one document. */
  workspaceId: z.string(),
  documentId: z.string(),
  mediaId: z.string(),
  exp: z.number()
});
export type MediaToken = z.infer<typeof MediaTokenSchema>;

const key = (cfg: Config) => mediaTokenKey(unb64u(cfg.KMASTER, 32));

export function issueMediaToken(cfg: Config, t: Omit<MediaToken, 'v' | 'exp'>): string {
  const payload = utf8(JSON.stringify({ v: 1, ...t, exp: Date.now() + MEDIA_TOKEN_MS }));
  return `${b64u(payload)}.${b64u(mac(key(cfg), payload))}`;
}

/** What a token says, if the MAC holds and it hasn't run out; otherwise undefined. */
export function readMediaToken(cfg: Config, token: string): MediaToken | undefined {
  if (token.length > 2000) return undefined;
  const [body, tag, extra] = token.split('.');
  if (!body || !tag || extra !== undefined) return undefined;
  let payload: Uint8Array;
  let sent: Uint8Array;
  try { payload = unb64u(body); sent = unb64u(tag); } catch { return undefined; }
  if (!equalBytes(sent, mac(key(cfg), payload))) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(fromUtf8(payload)); } catch { return undefined; }
  const r = MediaTokenSchema.safeParse(parsed);
  return r.success && r.data.exp > Date.now() ? r.data : undefined;
}
