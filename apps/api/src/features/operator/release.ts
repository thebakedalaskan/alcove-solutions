/*
 * What's running, for `operator release` (GET /v1/operator/release): the build, this instance and how its start went, the
 * migrations, the settings, and the clock, the attestation token, the certificate and the caches as this instance last
 * saw them. All of it but the migrations is this instance's memory, so it answers with the database out of reach, and then
 * its migrations say why they couldn't be read. A secret's setting says only whether it's set.
 */
import type pg from 'pg';
import { renewalOf } from '../../edge/certificates';
import { SETTING_NAMES, type Config } from '../../platform/config';
import type { Deps } from '../../platform/context';
import { featureFlagsCache } from '../../platform/feature-flags';
import { limitsCache } from '../../platform/limits';
import { facts } from '../../platform/runs';
import type { ReleaseAnswer } from './wire';
import { within } from './within';

/** When this process started, for an instance that wasn't started by start.ts (a test's). */
const PROCESS_STARTED = Date.now() - Math.round(process.uptime() * 1000);
/** How long the migrations are read for before the answer goes without them. */
const MIGRATIONS_MS = 3_000;
const DAY_MS = 86_400_000;

/**
 * Settings that change behaviour and are public anyway, in the attested environment or the image: their values. The cache
 * and stream timings are among them.
 */
const PUBLIC: Record<string, (cfg: Config) => string | number | boolean | null> = {
  TEE: (c) => c.TEE, WEB_ORIGIN: (c) => c.WEB_ORIGIN, API_URL: (c) => c.API_URL, TLS_HOSTS: (c) => (c.edge ? c.edge.hosts.join(',') : null),
  DEMO_AUTH_ENABLED: (c) => c.DEMO_AUTH_ENABLED, GOOGLE_SIGNUP_MODE: (c) => c.GOOGLE_SIGNUP_MODE,
  NEAR_AI_STT_MODEL: (c) => c.NEAR_AI_STT_MODEL, NEAR_AI_NOTES_MODEL: (c) => c.NEAR_AI_NOTES_MODEL, NEAR_AI_BASE_URL: (c) => c.NEAR_AI_BASE_URL,
  ACME_DIRECTORY: (c) => c.ACME_DIRECTORY, LOG_LEVEL: (c) => c.LOG_LEVEL,
  LIMITS_CACHE_MS: (c) => c.LIMITS_CACHE_MS, FEATURE_FLAGS_CACHE_MS: (c) => c.FEATURE_FLAGS_CACHE_MS, RING_STREAM_SECONDS: (c) => c.RING_STREAM_SECONDS,
  LIVE_PING_MS: (c) => c.LIVE_PING_MS, LIVE_STREAM_MS: (c) => c.LIVE_STREAM_MS, MEDIA_READ_MS: (c) => c.MEDIA_READ_MS
};
const SETTING = /^[A-Z][A-Z0-9_]*$/;

/**
 * Every other setting the server runs with, secrets included, as set or not set: never a value. Those it keeps under
 * another name are said by theirs (the edge's, the operator keys), and the keys it works out from the master (INDEX_KEY,
 * PHOTO_KEY) are said too. What a TEE reads before its configuration, through its attestation (GCP_PROJECT, SECRETS and the
 * like), isn't kept, and is in the attested environment anyway.
 */
function others(cfg: Config): Record<string, 'set' | 'not set'> {
  const said = (v: unknown): 'set' | 'not set' => (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) ? 'not set' : 'set');
  const valueOf = (name: string): unknown => {
    if (name === 'CLOUDFLARE_ZONE') return cfg.edge?.zone;
    if (name === 'CLOUDFLARE_API_TOKEN') return cfg.edge?.token;
    if (name === 'OPERATOR_KEYS') return cfg.operatorKeys;
    const value: unknown = Object.getOwnPropertyDescriptor(cfg, name)?.value;
    return value;
  };
  const names = new Set([...SETTING_NAMES, ...Object.keys(cfg).filter((name) => SETTING.test(name))]);
  return Object.fromEntries([...names].filter((name) => !(name in PUBLIC)).sort().map((name) => [name, said(valueOf(name))]));
}

const iso = (ms: number): string => new Date(ms).toISOString();
const isoOrNull = (ms: number | null): string | null => (ms === null ? null : iso(ms));

/**
 * Reads where a database's migrations stand against the image's, and why a start would refuse it, read only (migrate.ts ›
 * migrationCheck, the verdict a start acts on). The migrations are read beside the build entries, above every feature, so
 * whoever composes the routes (app.ts) hands this in.
 */
export type ReadMigrations = (pool: pg.Pool) => Promise<Omit<Extract<ReleaseAnswer['migrations'], { ok: true }>, 'ok'>>;

/** Where the database's migrations stand, read for a few seconds at most, or why they couldn't be. */
async function migrations(d: Deps, readMigrations: ReadMigrations): Promise<ReleaseAnswer['migrations']> {
  const read = await within('migrations', MIGRATIONS_MS, () => readMigrations(d.pool));
  return read.ok ? { ok: true, ...read.value } : read;
}

/** This instance's release, as `operator release` prints it. */
export async function releaseOf(d: Deps, instance: string, readMigrations: ReadMigrations): Promise<ReleaseAnswer> {
  const now = Date.now();
  const { cfg } = d;
  const startedAt = facts.get('startedAt') ?? PROCESS_STARTED;
  const attestation = facts.get('attestation');
  const clock = facts.get('clock');
  const certificate = facts.get('certificate');
  const cache = (c: { readAt: number | null; okAt: number | null; failures: number } | undefined) => (c ? { readAt: isoOrNull(c.readAt), okAt: isoOrNull(c.okAt), failures: c.failures } : null);
  const daysLeft = certificate ? Math.floor((certificate.notAfter - now) / DAY_MS) : 0;
  return {
    instance,
    at: iso(now),
    build: { commit: cfg.ALCOVE_COMMIT, imageDigest: attestation?.imageDigest ?? null, rekorLogIndex: attestation?.rekorLogIndex ?? null },
    running: { startedAt: iso(startedAt), uptimeS: Math.max(0, Math.round((now - startedAt) / 1000)) },
    boot: facts.get('boot') ?? [],
    migrations: await migrations(d, readMigrations),
    settings: {
      values: Object.fromEntries(Object.entries(PUBLIC).map(([name, read]) => [name, read(cfg)])),
      others: others(cfg),
      operatorKeys: cfg.operatorKeys.map((k) => ({ keyId: k.id, scope: k.scope }))
    },
    clock: clock ? { behindGoogleS: clock.behindGoogleS, roundTripMs: Math.max(0, clock.roundTripMs), at: iso(clock.at) } : null,
    attestation: attestation ? {
      issuedAt: isoOrNull(attestation.issuedAt), expiresAt: isoOrNull(attestation.expiresAt),
      ageS: attestation.issuedAt === null ? null : Math.max(0, Math.round((now - attestation.issuedAt) / 1000)),
      imageDigest: attestation.imageDigest, rekorLogIndex: attestation.rekorLogIndex,
      lastFailure: attestation.lastFailure ? { code: attestation.lastFailure.code, at: iso(attestation.lastFailure.at) } : null,
      nextAskAt: isoOrNull(attestation.nextAskAt)
    } : null,
    // Whether it's due a new one is the edge's own rule, as the edge orders them.
    certificate: certificate ? {
      notAfter: iso(certificate.notAfter), daysLeft, renewal: renewalOf(certificate.notAfter, now),
      hosts: certificate.hosts, storedAt: iso(certificate.storedAt), spkiMatches: certificate.spkiMatches,
      lastCheck: certificate.lastCheck ? { at: iso(certificate.lastCheck.at), ok: certificate.lastCheck.ok, code: certificate.lastCheck.code } : null
    } : null,
    caches: { limits: cache(limitsCache(d.pool)), featureFlags: cache(featureFlagsCache(d.pool)) }
  };
}
