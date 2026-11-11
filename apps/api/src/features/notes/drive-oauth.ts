import { DriveFolderIdSchema } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../../context';
import { b64u, equalBytes, id128, openJson, random, sealJson, sha, signInAttemptKey, unb64u, utf8 } from '../../crypto';
import { configured } from '../../google';
import { findOwner, masterKey } from '../../owners';
import { AuthError, UnavailableError } from '../../errors';
import { maybeOne, rows } from '../../db';
import { connection, saveConnection, JobRow, jobState, saveJob } from './drive-state';
import { folder, request, DriveFailure } from './drive-provider';
import { kick } from './drive-worker';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const Attempt = z.object({ state: z.string(), verifier: z.string(), ownerId: z.string(), sessionHash: z.string(), until: z.number() });
const HEADER = { v: 1 as const, kind: 'drive-oauth-attempt', ownerId: '' };
const Endpoints = z.object({ authorization_endpoint: z.string().url(), token_endpoint: z.string().url() });
const Tokens = z.object({ access_token: z.string(), refresh_token: z.string().optional(), scope: z.string().default('') });
const About = z.object({ user: z.object({ emailAddress: z.string().email(), permissionId: z.string() }) });
export const redirectUri = (d: Deps) => `${d.cfg.API_URL.replace(/\/$/, '')}/v1/drive/callback`;
async function endpoints(d: Deps) {
  try {
    const res = await fetch(`${d.cfg.GOOGLE_ISSUER.replace(/\/$/, '')}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new DriveFailure('transient');
    return Endpoints.parse(await res.json());
  } catch { throw new DriveFailure('transient'); }
}
export async function begin(o: Owner): Promise<{ url: string; attempt: string }> {
  if (!o.session) throw new AuthError('Sign in again before connecting Google Drive.');
  if (!configured(o.cfg)) throw new UnavailableError('Google Drive is not set up on this server.');
  const provider = await endpoints(o);
  const a = { state: b64u(random(32)), verifier: b64u(random(32)), ownerId: o.ownerId, sessionHash: b64u(o.session.hash), until: Date.now() + 10 * 60_000 };
  const url = new URL(provider.authorization_endpoint);
  url.search = new URLSearchParams({ client_id: o.cfg.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(o), response_type: 'code', scope: DRIVE_SCOPE, access_type: 'offline', include_granted_scopes: 'false', prompt: 'consent', trigger_onepick: 'true', allow_folder_selection: 'true', mimetypes: 'application/vnd.google-apps.folder', state: a.state, code_challenge: b64u(sha(utf8(a.verifier))), code_challenge_method: 'S256' }).toString();
  return { url: url.toString(), attempt: b64u(sealJson(signInAttemptKey(masterKey(o)), HEADER, a)) };
}
/** The owner was authorized before leaving Alcove. The sealed, expiring cookie and state bind this return to that owner. */
export async function finish(d: Deps, query: Record<string, string>, cookie: string | undefined, currentSessionHash?: Uint8Array): Promise<'connected' | 'cancelled' | 'failed'> {
  if (!cookie || !configured(d.cfg)) return 'failed';
  let a: z.infer<typeof Attempt>;
  try { a = openJson(signInAttemptKey(masterKey(d)), HEADER, unb64u(cookie), Attempt); } catch { return 'failed'; }
  if (a.until < Date.now() || !equalBytes(utf8(query['state'] ?? ''), utf8(a.state))) return 'failed';
  const sessionHash = unb64u(a.sessionHash);
  if (currentSessionHash && !equalBytes(currentSessionHash, sessionHash)) return 'failed';
  const session = await maybeOne(d.pool, z.object({ n: z.number() }), "SELECT 1 AS n FROM sessions WHERE owner_id = $1 AND session_hash = $2 AND expires_at > now() AND last_seen_at > now() - interval '14 days'", [a.ownerId, sessionHash]);
  if (!session) return 'failed';
  if (query['error']) return query['error'] === 'access_denied' ? 'cancelled' : 'failed';
  const code = query['code'];
  const picked = DriveFolderIdSchema.safeParse(query['picked_file_ids']);
  if (!code || !picked.success) return 'failed';
  const owner = await findOwner(d, a.ownerId, undefined);
  if (!owner) return 'failed';
  try {
    const provider = await endpoints(d);
    const res = await fetch(provider.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(d), client_id: d.cfg.GOOGLE_CLIENT_ID, client_secret: d.cfg.GOOGLE_CLIENT_SECRET, code_verifier: a.verifier }), signal: AbortSignal.timeout(8000) });
    if (!res.ok) return 'failed';
    const tokens = Tokens.safeParse(await res.json().catch(() => null));
    if (!tokens.success || !tokens.data.scope.split(/\s+/).includes(DRIVE_SCOPE)) return 'failed';
    const about = await request(owner, tokens.data.access_token, '/drive/v3/about?fields=user(emailAddress,permissionId)');
    if (!about.ok) return 'failed';
    const person = About.safeParse(await about.json().catch(() => null));
    if (!person.success) return 'failed';
    const destination = await folder(owner, tokens.data.access_token, picked.data);
    const stillHere = await maybeOne(d.pool, z.object({ n: z.number() }), "SELECT 1 AS n FROM sessions WHERE owner_id = $1 AND session_hash = $2 AND expires_at > now() AND last_seen_at > now() - interval '14 days'", [a.ownerId, sessionHash]);
    if (!stillHere) return 'failed';
    const previous = await connection(owner);
    const same = previous?.permissionId === person.data.user.permissionId;
    const refreshToken = tokens.data.refresh_token ?? (same ? previous.refreshToken : null);
    if (!refreshToken) return 'failed';
    await saveConnection(owner, { email: person.data.user.emailAddress, permissionId: person.data.user.permissionId, refreshToken, credentialVersion: id128(), generation: same ? previous.generation : id128(), status: 'connected', enabled: same ? previous.enabled : false, formats: previous?.formats ?? ['notes-markdown', 'transcript-text'], destination, enabledAt: same ? previous.enabledAt : new Date().toISOString() });
    const waiting = await rows(owner.pool, JobRow, "SELECT job_id, source_owner_id, note_id, format, state, attempt, state_ciphertext, lease_id FROM drive_export_jobs WHERE owner_id = $1 AND state = 'reconnect'", [owner.ownerId]);
    let resumed = 0;
    for (const job of waiting) {
      const state = jobState(owner, job);
      if (same && state.generation === previous.generation) { await saveJob(owner, job, { ...state, reason: null }, 'pending'); resumed++; }
    }
    // What waited on this connection goes now, in the background: not at the next upkeep.
    if (resumed) kick(d, owner.ownerId);
    return 'connected';
  } finally { owner.root.fill(0); owner.wrapKey.fill(0); }
}
