/*
 * What this browser makes of the server it talks to: what the API says it runs on, checked here with `checkServer` (lib/api.ts,
 * the one place the app decides which server it trusts), and the words for it that the side panel, the call and Settings show.
 */
import { errorCode, type Attestation, type Trust } from '@alcove/api';
import { queryOptions } from '@tanstack/react-query';
import { api, checkServer } from './api';
import { log } from './log';

export const trustKey = ['trust'] as const;

const trustLog = log.child({ component: 'trust' });
/** Why a server that couldn't be asked isn't verified: whatever it said before no longer counts. */
const UNASKED = 'Alcove’s server couldn’t be asked what it runs on.';
/** What the API says it runs on, asked twice before giving up, a second apart: one dropped request doesn't count against it. */
async function attestation(): Promise<Attestation | undefined> {
  for (let tries = 1; ; tries++) {
    try {
      return await api.trust.attestation();
    } catch (e) {
      if (tries >= 2) {
        trustLog.warn('the server couldn’t be asked what it runs on', { code: errorCode(e) });
        return undefined;
      }
      await new Promise((go) => { setTimeout(go, 1000); });
    }
  }
}
/**
 * What the API says it runs on, checked in this browser (`checkServer`: its token, then its release in Sigstore's public
 * log, as the server hands it on). A check that doesn't pass blocks nothing; it's logged with its reason, so the server's log
 * shows it too. A server that can't be asked isn't verified, so a check that passed before never stays on screen for it.
 */
async function checkTrust(): Promise<Trust> {
  let t = await askAndCheck();
  // A check that took more than a minute was most likely paused (a computer asleep mid-check): the token it was handed has aged
  // meanwhile, so the server is asked again, once, before anything is said about it.
  if (t.trust.state === 'unverified' && t.ms > SLEPT_MS) t = await askAndCheck();
  // A server that couldn't be asked was said already (`attestation`).
  if (t.trust.state === 'unverified' && t.trust.reason !== UNASKED) trustLog.warn('the server’s attestation didn’t check out', { reason: t.trust.reason, commit: t.trust.commit, digest: t.trust.digest ?? null, ms: t.ms });
  return t.trust;
}
/** A check that takes longer than this, start to finish, was paused rather than slow. */
const SLEPT_MS = 60_000;
/** Asks the server what it runs on and checks it, and how long that took. */
async function askAndCheck(): Promise<{ trust: Trust; ms: number }> {
  const t0 = Date.now();
  const a = await attestation();
  const trust: Trust = a ? await checkServer(a) : { state: 'unverified', reason: UNASKED, commit: 'unknown', at: Date.now() };
  return { trust, ms: Date.now() - t0 };
}

/** Checked when the app opens (the side panel and the call both show it), then every ten minutes. */
export const trustQuery = () => queryOptions({ queryKey: trustKey, queryFn: checkTrust, staleTime: 10 * 60_000, refetchInterval: 10 * 60_000 });

/** When this browser's check of the server passed, or null: only then is it verified. */
export const verifiedAt = (t: Trust | undefined): number | null => (t?.state === 'verified' ? t.at : null);
/** Why this browser's check of a server in a TEE didn't pass, or null: it passed, it's still to come, or there's no TEE. */
export const unverifiedBecause = (t: Trust | undefined): string | null => (t?.state === 'unverified' ? `Not verified. ${t.reason}` : null);
/**
 * The promise in the product's own words, verified only when this browser's check of the server passes. No caveats
 * (docs/design/principles.md › Copy): the engineering docs say what's built, and a check that fails says why only where
 * the check's details are (`unverifiedBecause`).
 */
export const trustLine = (t: Trust | undefined): string => (verifiedAt(t) === null ? 'Confidential compute' : 'Confidential compute · verified');
