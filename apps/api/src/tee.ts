/*
 * What's running, for anyone to check before trusting it (docs: privacy-keys-and-sessions › Moving to confidential
 * computing). Outside a TEE the API says so plainly. Inside Google Cloud Confidential Space it hands out a PKI attestation
 * token from the launcher: a JWT, signed under Google's Confidential Space root, saying which signed image runs, on what,
 * with debugging off, whose nonces name the build and the key TLS ends with here. Beside it goes the image's release in
 * Sigstore's public log, which the API looks up itself (`findRelease`), so no browser asks the log: browsers check it against
 * keys they pin, and whoever relays it can only withhold it.
 *
 * Google lets a project ask for only a few tokens a second, so one token serves every caller. Once it's 5 minutes old the next
 * is asked for in the background, while it's still handed out, and never more than one at once; with its token comes the
 * release, looked up again, or kept from before when the log can't be reached. None over 15 minutes old is handed out,
 * well inside the 20 minutes browsers take, with five more for their clocks: with none younger, the API says it can't attest
 * (503) until it has one. After the launcher fails it isn't asked again for a while, 30 seconds and then twice as long each
 * time, up to 5 minutes, so a failing attestation service isn't asked for more.
 */
import type { Attestation, ReleaseEntry } from '@alcove/api';
import { findRelease, productionLog, type ReleaseLog } from '@alcove/api-http/release';
import { request } from 'node:http';
import { z } from 'zod';
import type { Config } from './config';
import type { Deps } from './context';
import { unb64u } from './crypto';
import { tlsKey } from './edge/tlsKeys';
import { UnavailableError } from './errors';
import { log } from './log';

const tlog = log.child({ component: 'attestation' });

/** The launcher's socket, inside the container, where it hands out attestation tokens. */
export const LAUNCHER_SOCKET = '/run/container_launcher/teeserver.sock';
/** A token this old is asked for again, in the background, while it's still handed out. */
const FRESH_MS = 5 * 60_000;
/** The oldest token handed out: browsers take one up to 20 minutes old, allowing their clocks five more. */
const USABLE_MS = 15 * 60_000;
/** The launcher asks Google twice for a token, retrying each a little: this is far longer than it takes. */
const ASK_MS = 20_000;
/** How long looking the release up in the log may take, all its requests together. */
const RELEASE_MS = 20_000;
/** After the launcher fails, how long before it's asked again: at first, and at most. */
const FIRST_BACKOFF_MS = 30_000;
const LONGEST_BACKOFF_MS = 5 * 60_000;
/** Says what the nonces are, so a token asked for anything else isn't taken as one of these (packages/api-http's token.ts checks it). */
const PURPOSE = 'alcove:attestation:v1';

const Claims = z.object({
  iat: z.number(), exp: z.number(),
  submods: z.object({ container: z.object({ image_reference: z.string(), image_digest: z.string() }).optional() }).optional()
});
interface Held { asked: string; token: string; issuedAt: number; expiresAt: number; build: string | undefined; release: ReleaseEntry | null }

export interface Attester { attest(): Promise<Attestation> }

/** What the token says: when it was issued and runs out, in ms, and the image, by its repository and digest. */
function read(token: string): { issuedAt: number; expiresAt: number; image: { repo: string; digest: string } | undefined } {
  const payload = token.split('.')[1];
  let claims: ReturnType<typeof Claims.safeParse> | undefined;
  try { claims = payload === undefined ? undefined : Claims.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))); } catch { claims = undefined; }
  if (!claims?.success) throw new UnavailableError('The launcher’s attestation token doesn’t say when it was issued.');
  const c = claims.data;
  const container = c.submods?.container;
  const at = container?.image_reference.lastIndexOf('@') ?? -1;
  const image = container && at > 0 && container.image_reference.slice(at + 1) === container.image_digest
    ? { repo: container.image_reference.slice(0, at), digest: container.image_digest } : undefined;
  return { issuedAt: c.iat * 1000, expiresAt: c.exp * 1000, image };
}

/** Asks the launcher for a PKI token for `body`: its audience and nonces. The token, or why not. */
function askLauncher(socket: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: socket, path: '/v1/token', method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(ASK_MS) }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8').trim();
        if (res.statusCode === 200) resolve(text);
        // The launcher explains in a line of plain text, such as which check Google's attestation service refused.
        else reject(new UnavailableError('The launcher wouldn’t give an attestation token.', { context: { status: res.statusCode, said: text.slice(0, 200) } }));
      });
    });
    req.on('error', (e) => reject(new UnavailableError('The launcher couldn’t be asked for an attestation token.', { cause: e, context: { socket } })));
    req.end(body);
  });
}

/** Where a server's attester asks: the launcher's socket, and Sigstore's public log. Production's unless a test stands in. */
export interface AttesterOutside { socket: string; log: ReleaseLog }

/** What `d`'s server says it is (its configuration is read as it is at each call), asking the launcher and the log in `outside`. */
export function createAttester(d: Pick<Deps, 'cfg'>, outside: AttesterOutside = { socket: LAUNCHER_SOCKET, log: productionLog() }): Attester {
  let spki: { master: string; sha256: string } | undefined;
  let held: Held | undefined;
  let asking: Promise<Held> | undefined;
  let retryAt = 0;
  let backoff = FIRST_BACKOFF_MS;
  /** The TLS key's hash: worked out once for each master. */
  const spkiOf = (cfg: Config) => {
    if (spki?.master !== cfg.KMASTER) {
      const master = unb64u(cfg.KMASTER, 32);
      spki = { master: cfg.KMASTER, sha256: tlsKey(master).spkiSha256 };
      master.fill(0);
    }
    return spki.sha256;
  };
  /** The image's release for `commit`, looked up again; what was found before for the same build when the log can't say. */
  const releaseFor = async (image: { repo: string; digest: string } | undefined, commit: string): Promise<{ build: string | undefined; release: ReleaseEntry | null }> => {
    if (!image || !/^[0-9a-f]{40}$/.test(commit)) return { build: undefined, release: null };
    const build = `${image.repo}@${image.digest}#${commit}`;
    const t0 = performance.now();
    try {
      const release = await findRelease(outside.log, image.repo, image.digest, commit, AbortSignal.timeout(RELEASE_MS));
      tlog.debug('release found in the public log', { logIndex: release.logIndex, ms: Math.round(performance.now() - t0) });
      return { build, release };
    } catch (e) {
      const kept = held?.build === build ? held.release : null;
      tlog.warn('release not found in the public log', { err: e, kept: kept !== null, ms: Math.round(performance.now() - t0) });
      return { build, release: kept };
    }
  };
  const ask = (asked: string, commit: string): Promise<Held> => {
    if (asking) return asking;
    const now = Date.now();
    if (now < retryAt) return Promise.reject(new UnavailableError('The launcher failed a moment ago; it isn’t asked again yet.', { context: { retryInMs: retryAt - now } }));
    asking = (async (): Promise<Held> => {
      let token: string;
      let t: ReturnType<typeof read>;
      try {
        token = await askLauncher(outside.socket, asked);
        t = read(token);
        // Older than browsers take as soon as it's made: this VM's clock is off from Google's, and asking again won't help.
        const ageMs = Date.now() - t.issuedAt;
        if (ageMs >= USABLE_MS) throw new UnavailableError('The launcher’s token is too old to hand out as soon as it’s made: this VM’s clock may be off.', { context: { ageMs } });
      } catch (e) {
        retryAt = Date.now() + backoff;
        tlog.warn('no attestation token', { err: e, retryInMs: backoff });
        backoff = Math.min(backoff * 2, LONGEST_BACKOFF_MS);
        throw e;
      }
      backoff = FIRST_BACKOFF_MS;
      retryAt = 0;
      const next: Held = { asked, token, issuedAt: t.issuedAt, expiresAt: t.expiresAt, ...(await releaseFor(t.image, commit)) };
      held = next;
      tlog.info('attestation token issued', { issuedAt: new Date(next.issuedAt).toISOString(), expiresAt: new Date(next.expiresAt).toISOString(), release: next.release !== null });
      return next;
    })().finally(() => { asking = undefined; });
    return asking;
  };
  return {
    async attest() {
      const cfg = d.cfg;
      const build = { commit: cfg.ALCOVE_COMMIT };
      if (cfg.TEE === 'none') return { tee: 'none', build };
      const spkiSha256 = spkiOf(cfg);
      const asked = JSON.stringify({ audience: cfg.API_URL, token_type: 'PKI', nonces: [PURPOSE, `spki:${spkiSha256}`, `commit:${cfg.ALCOVE_COMMIT}`] });
      const age = (h: Held) => Date.now() - h.issuedAt;
      const answer = (h: Held): Attestation => ({ tee: 'confidential-space', build, tls: { spkiSha256 }, token: h.token, release: h.release });
      const current = held?.asked === asked && held.expiresAt > Date.now() ? held : undefined;
      if (current && age(current) < USABLE_MS) {
        // Still handed out: once it's 5 minutes old, the next is asked for meanwhile (unless the launcher failed just now).
        if (age(current) >= FRESH_MS) void ask(asked, cfg.ALCOVE_COMMIT).catch(() => undefined);
        return answer(current);
      }
      const next = await ask(asked, cfg.ALCOVE_COMMIT).catch((e: unknown) => {
        throw new UnavailableError('This server can’t attest to itself right now. Try again in a moment.', { cause: e, context: { tee: cfg.TEE } });
      });
      return answer(next);
    }
  };
}
