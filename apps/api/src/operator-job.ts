/*
 * The checks job (infra/confidential-space/README.md › The checks job): what the image runs in place of the server when
 * its environment says ALCOVE_JOB=checks (entrypoint.sh), for an API that won't start. infra/confidential-space/job.sh
 * runs it on a VM of its own, made from the group's template. It takes each start step (start.ts) on its own, as a
 * start would, and carries on past one that fails, then runs the live checks (features/operator/checks.ts) on what it
 * could make. Each step and check is one log line, `operator job step` or `operator job check`, then `operator job
 * done`, saying what a start's `boot step` and `operator checks` say: names, states, codes, counts and times, never a
 * message. It exits 0 when everything passed, 1 when anything failed, and 2 for words that aren't a job.
 *
 * It never listens, migrates, writes or seals. Its connections to the database are read only, which Postgres enforces. The
 * migrations are compared with the image's, never applied; the keys are opened read only (keys/server-keys.ts › openKeys); the
 * bucket is asked about, never made; and the certificate stored is read, never ordered. Inside a TEE it reads the secrets and
 * unwraps the master through the VM's attestation, as a start does.
 */
import { keySource, loadBoot, loadEnv, type Boot } from './platform/config';
import { unb64u } from './keys/crypto';
import { createPool, waitForDatabase } from './platform/db';
import { storedCertificate } from './edge/certificates';
import { opensAccounting } from './features/billing/plans';
import { tlsKey } from './edge/tls-keys';
import { GOOGLE_CLOUD, fromGoogleCloud, type FromGoogleCloud } from './tee/gcp';
import { configureLogging, flushLogs, log } from './platform/log';
import { migrationCheck } from './migrate';
import { openObjectStore } from './platform/objects';
import { runChecks } from './features/operator/checks';
import { failureOf, type BootStep } from './platform/runs';
import { openKeys } from './keys/server-keys';

const jlog = log.child({ component: 'operator-job' });
/** How long the object store has to answer: as long as its live check gives it. */
const ASK_MS = 10_000;
const DAY_MS = 86_400_000;

/** A start's steps, but listening, which the job never does. */
type Step = Exclude<BootStep['step'], 'listening'>;
/** What a step found besides passing: names, states, codes, counts and times. */
type Found = Record<string, string | number | boolean | null | readonly string[]>;
/** What a step made, what it found, and, when what it found would stop a start, a code saying what. */
interface Took<T> { made: T; found?: Found | undefined; wrong?: string | null | undefined }

const since = (t0: number) => Math.round(performance.now() - t0);
/** The TLS key the master makes, which the certificate stored should be for (edge/tls-keys.ts). */
function tlsKeyOf(kmaster: string) {
  const master = unb64u(kmaster, 32);
  try { return tlsKey(master).key; } finally { master.fill(0); }
}

/** Runs the checks job with the environment `env`, as a start would read it: the exit code. */
async function checksJob(env: NodeJS.ProcessEnv): Promise<number> {
  const t0 = performance.now();
  let failed = 0;
  /** Says the job is over: whether everything passed, how many steps and checks failed, and the step it stopped at, if it did. */
  const done = (stopped: Step | null): number => {
    jlog.at(failed ? 'error' : 'info', 'operator job done', { ok: failed === 0, failed, stopped, ms: since(t0) });
    return failed ? 1 : 0;
  };
  /**
   * Takes one start step and says how it went: what it found, or the class and code of its failure as a start says them
   * (failureOf). What it made, or undefined if it failed.
   */
  const step = async <T>(name: Step, run: () => Promise<Took<T>> | Took<T>): Promise<T | undefined> => {
    const s0 = performance.now();
    try {
      const { made, found = {}, wrong = null } = await run();
      if (wrong !== null) failed++;
      jlog.at(wrong === null ? 'info' : 'error', 'operator job step', { step: name, ok: wrong === null, ms: since(s0), errorClass: null, code: wrong, detail: found });
      return wrong === null ? made : undefined;
    } catch (e) {
      failed++;
      jlog.error('operator job step', { step: name, ok: false, ms: since(s0), ...failureOf(e), detail: {} });
      return undefined;
    }
  };

  // What the server reads of the environment first. A setting it can't start with is the configuration's step, and nothing
  // after it can be taken.
  let boot: Boot;
  try {
    boot = loadBoot(env);
  } catch (refused) {
    await step('config', () => { throw refused; });
    return done('config');
  }
  // Inside a TEE: the secrets, the old keys and Cloud KMS, through the VM's attestation, from Google Cloud as production
  // reaches it. Without them there are no settings to go on with: the secrets are among them.
  let tee: FromGoogleCloud | undefined;
  const teeBoot = boot.tee;
  if (teeBoot) {
    tee = await step('google-cloud', async () => {
      const g = await fromGoogleCloud(teeBoot, GOOGLE_CLOUD);
      return { made: g, found: { secrets: Object.keys(g.secrets).length, oldKeys: g.legacy !== undefined } };
    });
    if (!tee) return done('google-cloud');
  }
  const e = await step('config', () => {
    const read = loadEnv(env, tee?.secrets ?? {});
    return { made: read, found: { tee: read.TEE, commit: read.ALCOVE_COMMIT, tls: read.edge !== undefined } };
  });
  if (!e) return done('config');

  const pool = createPool(e.DATABASE_URL, 10, { readOnly: true });
  try {
    // The first connection, waited for as a start waits for it (DATABASE_WAIT_MS).
    await step('database', async () => {
      await waitForDatabase(pool, e.DATABASE_WAIT_MS);
      return { made: null };
    });
    // A start applies the migrations the database hasn't had, and refuses a database that applied one the image doesn't have,
    // a release behind it (`removed`), or one changed since (`changed`), as migrate.ts says it.
    await step('migrations', async () => {
      const m = await migrationCheck(pool);
      const found = { applied: m.applied.count, inImage: m.inImage.count, notApplied: m.notApplied, unknown: m.unknown, changed: m.changed };
      return { made: null, found, wrong: m.refused };
    });
    // Inside a TEE, whether it holds the old master, whether the server keys still carry one, and whether a start would
    // forget it now (RETIRE_LEGACY_KMASTER), which the job never does.
    const opened = await step('keys', async () => {
      const o = await openKeys(pool, keySource(e.keys, tee && { wrapper: tee.wrapper, legacy: tee.legacy, opensAccounting }));
      const found = e.TEE === 'none' ? {} : { oldMaster: o.keys.LEGACY_KMASTER !== undefined, carried: o.carried, retiring: o.retiring };
      return { made: o.keys, found };
    });
    // Asked whether it's there, never made, as a start makes it.
    const objects = openObjectStore(e);
    await step('objects', async () => {
      await objects.ping(AbortSignal.timeout(ASK_MS));
      return { made: null };
    });
    // With TLS_HOSTS, the certificate stored: a start serves it if it will do, for every host and the TLS key the master makes,
    // and orders another first if it won't, which the job never does. Without the keys, whose key it's for isn't known.
    const edge = e.edge;
    if (edge) {
      await step('edge', async () => {
        const c = await storedCertificate(pool, edge.hosts, opened ? tlsKeyOf(opened.KMASTER) : undefined);
        if (!c) return { made: null, found: { stored: false }, wrong: 'none-stored' };
        const found = { stored: true, notAfter: new Date(c.notAfter).toISOString(), daysLeft: Math.floor((c.notAfter - Date.now()) / DAY_MS), hosts: c.hosts, spkiMatches: c.spkiMatches };
        return { made: null, found, wrong: c.unservable };
      });
    }
    // The live checks, with the settings and none of the keys, which they never use: whether or not the keys opened.
    const { keys: _keys, ...keyless } = e;
    for (const c of await runChecks({ cfg: keyless, pool, objects })) {
      if (!c.ok) failed++;
      jlog.at(c.ok ? 'info' : 'warn', 'operator job check', { check: c.name, ok: c.ok, ms: c.ms, code: c.code, detail: c.detail });
    }
    return done(null);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

process.on('unhandledRejection', (e) => jlog.error('unhandled promise rejection', { err: e }));
// Its lines go where a start's go, said as a start says them, and never quieter than info: they're the report.
configureLogging({ level: process.env['LOG_LEVEL'] === 'debug' ? 'debug' : 'info', format: process.env['LOG_FORMAT'] === 'json' ? 'json' : 'pretty', service: 'alcove-job' });
const words = process.argv.slice(2);
let code = 2;
if (words.length === 1 && words[0] === 'checks') {
  code = await checksJob(process.env).catch((e: unknown) => {
    jlog.error('operator job failed', { err: e });
    return 1;
  });
} else {
  process.stderr.write('usage: operator-job checks\n');
}
flushLogs();
process.exit(code);
