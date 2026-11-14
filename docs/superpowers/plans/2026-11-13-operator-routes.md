# Operator routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give operators signed, audited routes into the enclave: diagnostics, a few narrow actions, a CLI, a checks job
and runbooks, without exposing anyone's content.

**Architecture:** One new server home, `apps/api/src/operator/`, holds the operator's own machinery: keys and signing,
the error ring, background runs, release, checks and work. `http/operator.ts` checks every signed request, and
`operatorRoute()` is how each owner registers its routes. Feature lookups and actions live in their owners
(`features/{billing,account,calls,notes}`). The CLI (`operator-cli.ts`) signs with the same code the server verifies with.

**Tech Stack:** TypeScript (strict), Hono, Postgres (pg), node:crypto Ed25519 and scrypt, zod, Vitest integration
tests via the harness, React and Storybook for the app references, bash for infra.

**Spec:** `docs/superpowers/specs/2026-11-13-operator-routes-design.md`. Read it first. Section numbers below (§n) are
its sections.

## Global Constraints

- Follow `AGENTS.md`, `apps/api/src/features/AGENTS.md`, `docs/engineering/folder-ownership.md` and
  `.claude/skills/strict-typescript/SKILL.md`. That means: no `any`, no `as`, no `!`, no suppressions, `AppError`
  subclasses, `log.child({ component })`, and no `console`.
- Integration tests only, named `*.integration.test.ts`, through the real API over HTTP with real Postgres and the object
  store. No unit, component or browser tests.
- Run tests per file: `cd apps/api && npx vitest run <file>`. Never run the root `pnpm dev`, `pnpm test` or `pnpm check`.
  Never start, stop or recreate Docker services, and never kill a process found by its port.
- Each worktree gets its own `.env`, copied from `.env.example`, with its own `DATABASE_URL`, `TEST_DATABASE_URL` and
  `OBJECTS_BUCKET` (e.g. `alcove_op_t3`, `alcove_op_t3_test`, `alcove-op-t3`) and random `KMASTER`/`KSERVICE`
  (`python3 -c 'import secrets;print(secrets.token_urlsafe(32))'`). Never share a database or bucket with another
  worktree. Run `pnpm install --frozen-lockfile` once.
- Checks before committing: `pnpm --filter @alcove/server typecheck`, `node scripts/check-types.mjs`,
  `node scripts/check-structure.mjs`, `node scripts/check-tests.mjs`, and the touched test files.
- The privacy line (§3). Answers and log lines hold only random IDs, states, codes, counts, sizes, booleans, times and
  durations. Never titles, names, addresses, chat, notes, transcripts, labels, file names, payment addresses or amounts,
  provider error text, or a call's code. A sealed record is opened only inside the API, and only derived counts and
  states come out.
- No backwards compatibility: `OPERATOR_TOKEN_SHA256` is removed everywhere in Task 1.
- Writing: plain, specific sentence-case copy. Examples use made-up people at Vandelay Industries. No real names. No
  local paths in code, docs or commits.
- Commits are signed (already configured) and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  Never push. The coordinator merges every task's branch into `operator/routes`.

## Review Focus

1. **A clock that drifts.** An operator's laptop or the VM may be up to 10 s off. Requests within 60 s pass, and a
   refusal lets the CLI say its clock is off. Task 1 tests 59 s and 61 s skew both ways.
2. **The database down when an operator needs it most.**
   - `release`, `checks`, `errors`, `requests` and `whoami` still answer when Postgres refuses connections: nonces fall
     back to memory for reads.
   - Writes are refused with `unavailable`.
   - Task 3 tests a second server whose pool points at a closed port.
3. **Typed input that isn't what it seems.**
   - A call's join code, a `/join/…` link, an address where an ID goes, or an ID of the wrong kind (a workspace's ID as
     an account) is refused without being echoed or logged.
   - Covered in Tasks 5 and 6, and in the CLI's address parsing.
4. **The same action twice.**
   - A retried credit (the network dropped after the commit) never adds twice: by reference today, by account and
     reason here.
   - A second top-up check, note retry or call end is harmless.
   - Tasks 5 and 6 send each action twice.
5. **Two instances.**
   - A nonce used on one instance is refused on another sharing the database.
   - In-memory answers name their instance.
   - Task 1 tests this with `h.secondServer()`.

---

## File map

| File | Task | Responsibility |
| --- | --- | --- |
| `apps/api/src/operator/keys.ts` | 1 | Key list parsing, key IDs, canonical request, sign/verify, key file seal/open |
| `apps/api/src/http/operator.ts` | 1 | `operatorRoute()`: 404 when unconfigured, limits, signature, time, nonce, scope, reason, audit line |
| `apps/api/src/operator/routes.ts` | 1, 3, 4 | Service-wide operator routes (whoami, feature flags; release, errors, requests, work; checks) |
| `apps/api/src/operator/cli.ts` | 1 | The CLI's shared parts: args, key file, signed transport, printing, `CliCommand` |
| `apps/api/src/operator-cli.ts` | 1 (+ one line per later task) | The CLI entry: the command table |
| `apps/api/src/operator/cli-*.ts` | 3–6 | Each task's CLI commands |
| `apps/api/migrations/0035_operator.sql` | 1 | `operator_nonces`, `operator_credits` |
| `apps/api/src/testing/operator.ts` | 1 | Test keys and signed clients |
| `apps/api/src/operator/recent.ts`, `runs.ts`, `release.ts`, `work.ts`, `wire.ts` | 3 | Ring, runs and facts, release report, work report, answer schemas |
| `apps/api/src/operator/checks.ts` | 4 | Live checks |
| `apps/api/src/features/billing/supportCommands.ts`, `operator-routes.ts` | 5 | Billing commands (CLI and route), top-up lookup and check |
| `apps/api/src/limitCommands.ts` | 5 | Limits commands (CLI and route) |
| `apps/api/src/features/account/operator.ts`, `operator-routes.ts` | 5 | Account lookup, find by address, sign-out |
| `apps/api/src/features/calls/operator.ts`, `operator-routes.ts` | 6 | Call lookup, end a stuck call, close a room left up |
| `apps/api/src/features/notes/operator.ts`, `operator-routes.ts` | 6 | Note writing lookup, retries |
| `apps/api/src/operator-job.ts`, `infra/confidential-space/job.sh` | 7 | The checks job |
| `apps/web/**`, `packages/ui/**`, `apps/storybook/**` | 2 | References in the app |
| `docs/engineering/operating-alcove.md` and doc updates | 9 | Routes, CLI, runbooks |

Waves: Tasks 1 and 2 first, in parallel. Tasks 3, 4, 5 and 6 start from `operator/routes` once Task 1 is merged
in. Then Task 7 (after 3 and 4), Task 8 (after 3–6) and Task 9 (after 3–6).

---

### Task 1: Signed operator requests, the CLI's core, feature flags moved onto them

**Files:**
- Create: `apps/api/src/operator/keys.ts`, `apps/api/src/http/operator.ts`, `apps/api/src/operator/routes.ts`,
  `apps/api/src/operator/cli.ts`, `apps/api/src/operator-cli.ts`, `apps/api/migrations/0035_operator.sql`,
  `apps/api/src/testing/operator.ts`, `apps/api/src/integration/operator-auth.integration.test.ts`
- Modify:
  - `apps/api/src/config.ts`: drop `OPERATOR_TOKEN_SHA256`, add `OPERATOR_KEYS`
  - `apps/api/src/http/system-routes.ts`: the flags route leaves
  - `apps/api/src/http/limits.ts`
  - `apps/api/src/app.ts`: `registerOperatorRoutes` beside `registerSystemRoutes`
  - `apps/api/src/maintenance.ts`: sweep nonces
  - `apps/api/src/testing/harness.ts`: keys on by default
  - `apps/api/src/integration/feature-flags.integration.test.ts`
  - `apps/api/package.json`: `"operator": "tsx src/operator-cli.ts"`, with no `--env-file`
  - `scripts/check-structure.mjs`: `operator` home; `operator-cli.ts`, `limitCommands.ts` and `operator-job.ts` as root
    entries
  - `docs/engineering/folder-ownership.md` and `apps/api/src/features/AGENTS.md`: the operator home and
    `operatorRoute()`
  - `infra/confidential-space/env.sh`: `CS_OPERATOR_KEYS=()`, an empty array with a comment saying how to add a key;
    `OPERATOR_KEYS=…` added to `CS_BUILD_ARGS`; `OPERATOR_TOKEN_SHA256` removed from `CS_TEE_ENV`
  - `apps/api/Dockerfile`: `ARG OPERATOR_KEYS=` and `ENV OPERATOR_KEYS=$OPERATOR_KEYS` in the final stage;
    `OPERATOR_TOKEN_SHA256` out of `allow_env_override`

**Interfaces (produced, used by every later server task):**

```ts
// operator/keys.ts
export type OperatorScope = 'read' | 'write';
export interface OperatorKey { id: string; scope: OperatorScope; publicKey: Uint8Array }   // 32 raw bytes
export function parseOperatorKeys(value: string): OperatorKey[];        // throws Error naming the bad entry; refuses duplicates
export function keyIdOf(publicKey: Uint8Array): string;                // first 16 chars of base64url(SHA-256(publicKey))
export interface SignedParts { audience: string; method: string; path: string; time: number; nonce: string; bodySha256: string }
export function canonical(p: SignedParts): string;                     // 'alcove-operator/v1\n' + fields joined by '\n'
export function bodyHash(body: Uint8Array): string;                    // base64url SHA-256
export function sign(privateKey: KeyObject, p: SignedParts): string;  // base64url Ed25519 signature
export function verify(key: OperatorKey, p: SignedParts, signature: string): boolean;
export function authorization(keyId: string, time: number, nonce: string, signature: string): string;
export function parseAuthorization(header: string | undefined): { keyId: string; time: number; nonce: string; signature: string } | undefined;
export const REASON: RegExp;                                           // /^[A-Za-z0-9_.:#\/-]{3,64}$/
export interface KeyFile { v: 1; keyId: string; publicKey: string; sealed: { salt: string; iv: string; tag: string; ciphertext: string } | null; seed: string | null }
export function makeKeyFile(passphrase: string | null): { file: KeyFile; publicKey: Uint8Array };   // scrypt N=2**17 r=8 p=1, AES-256-GCM over the 32-byte seed
export function openKeyFile(file: unknown, passphrase: () => Promise<string>): Promise<{ keyId: string; privateKey: KeyObject }>;

// http/operator.ts
export interface Operator { keyId: string; scope: OperatorScope; reason: string | undefined; instance: string }
export type ScopeOf = OperatorScope | ((body: unknown) => OperatorScope);
export function operatorRoute(app: Hono<Env>, runtime: HttpRuntime, method: 'GET' | 'POST', path: string, scope: ScopeOf,
  handler: (c: Context<Env>, op: Operator) => Promise<Response>): void;
export const instanceName: () => string;                               // process.env.HOSTNAME or os.hostname()

// testing/operator.ts
export interface SignedClient { keyId: string; get(path: string): Promise<Response>; post(path: string, body: unknown): Promise<Response>;
  raw(o: { method: string; path: string; body?: unknown; time?: number; nonce?: string; audience?: string; tamper?: 'body' | 'path' | 'signature' }): Promise<Response> }
export function makeOperatorKey(scope: OperatorScope): { key: OperatorKey; privateKey: KeyObject };
export function signedClient(baseUrl: string, audience: string, k: { key: OperatorKey; privateKey: KeyObject }): SignedClient;
// harness: h.operator.read and h.operator.write are SignedClients on h.baseUrl; the main server runs with both keys.

// operator/cli.ts
export interface CliContext { call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: unknown; requestId: string; instance: string | undefined }>;
  say(line: string): void; json: boolean; reason: string | undefined; prompt(question: string, hidden: boolean): Promise<string> }
export interface CliCommand { words: readonly string[]; usage: string; run(ctx: CliContext, args: string[]): Promise<number> }
// operator-cli.ts: const COMMANDS: CliCommand[] = [...core, ...diagnostics, ...checks, ...support, ...callsAndNotes];
```

Behaviour that's fixed:

- **The middleware's checks.** Order, values and refusals are exactly §6.4.
  - Address limit 60 a minute, reusing `operatorLimiter`.
  - Then the key's own limit: 120 reads a minute, or 20 writes a minute.
  - Time window ±60 000 ms.
  - Audience: `new URL(cfg.API_URL).origin`.
  - Body cap 64 KiB.
- **Without `operatorKeys`,** every operator route throws `NotFoundError('That isn’t here.')`.
- **Refusals** are `AuthError('That isn’t a signed operator request.', { context: { why } })`, with `why` one of `no-key`,
  `unknown-key`, `stale`, `bad-signature` or `replayed`.
- **Scope.** A write route gets `ForbiddenError` with `why: 'scope'` for a `read` key. On a write route, a missing or
  malformed `reason` in the JSON body is a `ValidationError`.
- **Nonces.**
  - `INSERT INTO operator_nonces (nonce, key_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`; zero rows means `replayed`.
  - If the query throws `LostConnectionError`, `DatabaseBusyError` or a `DatabaseError` with a connection code, a read
    falls back to an in-memory map: 10 000 entries, 2 minutes each, with `nonceIn: 'memory'` on the audit line. A write
    rethrows as `UnavailableError`.
  - `maintain` gets a step `operator nonces` that deletes rows older than 10 minutes.
- **The audit line** is `olog.at(refused ? 'warn' : 'info', 'operator call', { keyId, scope, route: '<METHOD> <path template>', outcome, status, code, ms, reason, nonceIn })`, logged in a `finally`.
- **Migration** `0035_operator.sql`:
  - `CREATE TABLE operator_nonces (nonce text PRIMARY KEY, key_id text NOT NULL, seen_at timestamptz NOT NULL DEFAULT now());`
  - `CREATE INDEX operator_nonces_seen ON operator_nonces (seen_at);`
  - `CREATE TABLE operator_credits (digest bytea PRIMARY KEY, key_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());`
- **Config.**
  - `OPERATOR_KEYS` is optional. `loadEnv` parses it into `operatorKeys: readonly OperatorKey[]` on `Env`/`Config`.
  - A bad entry is a start-up problem naming the entry's position, never its value.
  - `secondServer({ operatorKeys: [] })` turns the routes off.
- **Routes in `operator/routes.ts`.**
  - `GET /v1/operator/whoami` returns `{ keyId, scope, instance, at }`.
  - `POST /v1/operator/feature-flags` takes `{ words, reason? }`; its scope is `read` for `list`, `groups` and
    `group members`, otherwise `write`.
  - Both register through `operatorRoute`.
  - The route keeps its `operator feature flags` line `{ command, ok }`.
- **CLI.**
  - Global options: `--api` (default `ALCOVE_OPERATOR_API`, else `https://api.alcove.solutions`), `--audience` (default:
    `--api`'s origin), `--key` (default `ALCOVE_OPERATOR_KEY`, else `~/.config/alcove/operator-key.json`), `--json` and
    `--reason`.
  - `keygen [--no-passphrase]` writes the key file with mode 0600 in a 0700 directory. It refuses to overwrite one, and
    refuses to run without a TTY unless `--no-passphrase` is given. It prints `Key ID: …`, `Public key: …` and
    `For env.sh: read:<public key>  (or write:<public key>)`, and nothing else.
  - Every call prints `Request <id> on <instance>` to stderr.
  - On a 401 whose `Date` header is more than 60 s from the local clock, it says `Your clock is <n> s off the server's.`
  - Exit codes: 0 when the server answers 2xx, 1 for anything else, 2 for words that aren't a command.
  - Core commands: `keygen`, `whoami`, `feature-flags <words…>`.

- [ ] **Step 1: Write `operator-auth.integration.test.ts`.** One `describe('signed operator requests')` holding:
  - `it('answers whoami for a read and a write key')`: 200, the key IDs, `instance`.
  - `it('refuses every unsigned or broken request with one message')`. For each case: 401, and the body's `message` is
    `That isn’t a signed operator request.`. Cases:
    - no header;
    - unknown key;
    - time −61 s and +61 s, while −59 s passes;
    - wrong audience;
    - path changed;
    - body changed;
    - signature from another key.
  - `it('refuses a replayed nonce on this and another instance')`: the same nonce again on `h.baseUrl`, then on
    `h.secondServer()`'s URL. Both 401.
  - `it('keeps write routes from read keys')`: `feature-flags` `everyone x on` with the read key gives 403.
  - `it('needs a reason on writes')`: no reason, or `"Ann Smith's refund"`, gives 400. `SUP-1182` passes.
  - `it('is not there without keys')`: `secondServer({ operatorKeys: [] })` answers 404 on every operator route.
  - `it('refuses an app session alone')`: a signed-in browser's cookie with no signature gives 401.
  - `it('limits each key')`: the 21st write in a minute gives 503.
  - `it('logs one audit line per call')`: for allowed, refused (with `why`) and failed calls. No body, nonce or
    signature appears in any line.
  - `it('falls back to memory for reads when the database is down')`: a second server with a pool on a closed port.
    `whoami` gives 200 with `nonceIn: 'memory'`; a write gives 503.
  - `it('refuses every registered operator route unsigned')`: iterates `createApp(h.deps).routes` filtered on
    `/v1/operator/`, with placeholders for path parameters, and expects 401 for each. Later tasks' routes are covered
    automatically.
  - `it('runs the CLI end to end')`:
    - `keygen --no-passphrase` with `HOME` set to a temporary directory;
    - then a second server whose `operatorKeys` holds the printed key;
    - then `whoami` and `feature-flags list` against it with `--api` and `--audience`;
    - check the exit codes and the printed lines;
    - check that the key file's mode is `0600`;
    - check that the private seed appears in no output.
- [ ] **Step 2: Run it:** `cd apps/api && npx vitest run src/integration/operator-auth.integration.test.ts`. It must
  fail: there are no routes yet.
- [ ] **Step 3: Implement `operator/keys.ts`, the migration, config, `http/operator.ts`, `operator/routes.ts` and the
  harness keys.** Use `node:crypto`'s `createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' })`,
  `sign(null, …)` and `verify(null, …)`, and `crypto.timingSafeEqual` where bytes are compared. Hono caches the raw body,
  so read it with `c.req.arrayBuffer()` for the hash and let handlers call `body(c, Schema)` after.
- [ ] **Step 4: Move the flags route.** Remove the token route and its `OperatorCommand` from `system-routes.ts`, and
  rewrite `feature-flags.integration.test.ts`'s operator test to use `h.operator.write` and `h.operator.read`. Keep its
  assertions: the lines it says, no address in answers or logs, and the logged commands.
- [ ] **Step 5: Implement the CLI core** (`operator/cli.ts`, `operator-cli.ts`). Hidden prompts use `readline` with
  muted output.
- [ ] **Step 6: Run the tests until they pass.**
  - `npx vitest run src/integration/operator-auth.integration.test.ts src/integration/feature-flags.integration.test.ts`
  - Then typecheck, `check-types`, `check-structure` and `check-tests`.
- [ ] **Step 7: Infra and docs.**
  - env.sh: run `bash infra/confidential-space/env.sh production`; it must print no `OPERATOR_TOKEN_SHA256`.
  - The Dockerfile.
  - The structure policy and `folder-ownership.md`.
- [ ] **Step 8: Commit:** `Operator routes: signed requests, per-operator keys, the CLI's core`.

### Task 2: References people can hand support (app)

**Files:**
- Modify: `apps/web/src/features/shell/OfflinePage.tsx` (`RouteError`), `apps/web/src/features/notes/Call.tsx` (`Missing`),
  `apps/web/src/features/calls/list/Upcoming.tsx` (`AheadMissing`), `apps/web/src/features/plans/paying.tsx`,
  `apps/web/src/features/plans/CheckoutHost.tsx`, and the toast call sites below.
- Create: one shared helper for failure toasts in the app's own lib, e.g. `apps/web/src/lib/failed.tsx`:
  `toastFailure(toast, e: unknown, o?: { ms?: number }): void`. It shows `errorMessage(e)` with `icon: 'x'`, `ms: 8000`,
  and, when `errorRequestId(e)` is set, an `action` "Copy reference" that copies the ID and then toasts "Reference
  copied". Check the toast's `action` slot in `packages/ui` first; add nothing to the kit unless it's missing.
- Stories: `Toast.stories.tsx` (a failure with Copy reference), `RequestRef.stories.tsx`, `OfflineAndErrors.stories.tsx`
  (`DidntLoad*`), `Call.stories.tsx` (`Gone`, `CouldntOpen`, `ACallAheadThatsGone`), `Checkout.stories.tsx`,
  `journeys/16b-checkout.stories.tsx`, `PayingInMotion.stories.tsx`. Give the stand-in's network failure in
  `apps/storybook/src/api/trouble.ts` a request ID too.

**What changes (§10):**
1. `RouteError`, `Missing` and `AheadMissing` show `<RequestRef id=…>` when the error carries a request ID. Use the
   existing `EmptyState`'s `action` slot or `GonePage`'s children.
2. Every `toast(errorMessage(e), { icon: 'x' })` in Settings (`features/settings/save.tsx`), Plans (`Plan.tsx`), Start a
   call (`home/Start.tsx`) and scheduling becomes `toastFailure(toast, e)`.
3. On the Pay step the top-up's reference shows from the start: `PayNow` and `PaySeen` get `<RequestRef id={t.id}
   className="ck-ref" />`, as the failed state has it.
4. Checkout's Done receipt shows all 22 characters of the reference, not the first 8.

No contract change. Nothing new in Settings › You: accounts are found by their address, server side.

- [ ] **Step 1: Make the changes above.**
- [ ] **Step 2: Typecheck:** `pnpm --filter @alcove/web typecheck`, `pnpm --filter @alcove/ui typecheck`,
  `pnpm --filter @alcove/storybook typecheck`, `node scripts/check-types.mjs`, `node scripts/check-structure.mjs`.
- [ ] **Step 3: Check the stories.**
  - Build Storybook: `pnpm --filter @alcove/storybook build`.
  - Screenshot each changed story in light and dark at 390 px and 1440 px into the session's scratchpad. Use a headless
    browser over a static server; this is not a test.
  - Check that nothing overlaps and the reference wraps rather than widening the page.
- [ ] **Step 4: Commit:** `Support references: copy a failure's reference, a top-up's reference from the start`.

### Task 3: Recent errors, background runs, start-up steps, release and work

**Files:**
- Create:
  - `apps/api/src/operator/recent.ts`, `runs.ts`, `release.ts`, `work.ts`, `wire.ts`, `cli-diagnostics.ts`
  - `apps/api/src/integration/operator-diagnostics.integration.test.ts`
  - `apps/api/src/integration/start-up.integration.test.ts`
- Modify:
  - `apps/api/src/log.ts`: feed the ring from `Logger.emit`
  - `start.ts`: boot steps, the first-connection retry, runs for upkeep, rewrap and the run in progress
  - `maintenance.ts`: a run per step
  - `features/billing/deposits.ts` (`startWatching`: run `deposits`)
  - `features/calls/lifecycle.ts` (`startEndingOverdue`: run `overdue-calls`)
  - `edge/certificates.ts`: run `certificates`, and `facts.certificate`
  - `tee.ts` (the attester: `facts.attestation`)
  - `gcp.ts` (`logClockOffset`: `facts.clock`)
  - `features/notes/writer.ts` (`work`: run `notes-writer`)
  - `migrate.ts`: export `migrationStatus(pool, dir?)`, read-only
  - `limits.ts` and `feature-flags.ts`: export their cache state
  - `operator/routes.ts`: the routes
  - `operator-cli.ts`: one import line

**Interfaces (produced):**

```ts
// operator/recent.ts — no import of log.ts
export interface RingLine { at: number; level: 'info' | 'warn' | 'error'; component: string | null; msg: string; requestId: string | null;
  method: string | null; path: string | null; status: number | null; code: string | null; errorClass: string | null;
  upstreamStatus: number | null; what: string | null; ids: Partial<Record<'ownerId' | 'callId' | 'noteId' | 'jobId' | 'depositId' | 'recordingId' | 'grantId', string>> }
export const recent: { record(fields: Record<string, unknown>, level: RingLine['level'], msg: string): void; since(ms: number): RingLine[]; byRequest(id: string): RingLine[]; forId(key: keyof RingLine['ids'], id: string): RingLine[] };
// Kept: warn and error lines, and info lines whose msg is 'request refused'. 5 000 newest.
// Never a line from a logger made with { ring: false }: Logger.child(ctx, o?: { ring?: boolean }), inherited by its children.
// system-routes.ts's telemetry logger (clog) is made with { ring: false }. Its lines carry fields the browser chose, which can
// override component, source and requestId, so the exclusion can't rest on any field.
// IDs only if /^[A-Za-z0-9_-]{8,64}$/; code, errorClass, what only if /^[A-Za-z0-9_.:-]{1,64}$/;
// upstreamStatus from the line's `upstreamStatus` or err.context.upstreamStatus (Task 4 renames those fields).

// operator/runs.ts
export const runs: { begin(name: string): { end(o: { ok: boolean; counts?: Record<string, number>; code?: string }): void }; snapshot(): RunSnapshot[] };
export const facts: { set<K extends keyof Facts>(k: K, v: Facts[K]): void; get<K extends keyof Facts>(k: K): Facts[K] | undefined };
export interface Facts { boot: BootStep[]; startedAt: number; clock: { behindGoogleS: number; roundTripMs: number; at: number };
  attestation: { issuedAt: number | null; expiresAt: number | null; lastFailure: { code: string; at: number } | null; retryAt: number | null };
  certificate: { notAfter: number; storedAt: number; hosts: number; spkiMatches: boolean; lastCheck: { at: number; ok: boolean; code: string | null } } }
export interface BootStep { step: 'config' | 'google-cloud' | 'database' | 'migrations' | 'keys' | 'objects' | 'edge' | 'listening'; ms: number; ok: boolean; code: string | null; tries: number }
```

Behaviour that's fixed:

- **Start-up.**
  - Each step logs `boot step` with `{ step, ms, ok, code, tries }` and is kept in `facts.boot`.
  - The database's first connection is `SELECT 1`, tried again after 1, 2, 4 and 8 s, then every 15 s, until 120 s have
    passed. Each failed try logs `database not answering yet; trying again` at warn with `{ tries, waitMs, code }`.
- **Routes:** `GET /v1/operator/release` (§4.2), `GET /v1/operator/work` (§4.4), `GET /v1/operator/errors?minutes=`
  (1–240, default 60, §4.5) and `GET /v1/operator/requests/:requestId` (§4.5; 404 when this instance holds none). Every
  answer carries `instance` and `at`, and its schema is in `wire.ts`. The CLI parses answers with the same schemas.
- **The work report's queue SQL.** The SQL sketches in this plan's appendix are a starting point. Never select a sealed
  column. Calls' "room gone" uses `d.livekit.existingRooms`, raced against a 5 s timeout.
- **CLI:** `release`, `work`, `errors [--minutes n]` and `request <id>`, printed as aligned text.

- [ ] **Step 1: Write the tests.**
  - `operator-diagnostics.integration.test.ts`:
    - `release`: the harness's commit (`dev`), boot steps all ok, migrations `notApplied: []` and `unknown: []`, every
      secret setting shown as `set` or `not set` and never its value (assert `KMASTER` and `DATABASE_URL` values aren't
      in the body).
    - `errors`: provoke a 404 and a 409 through the app, and a notes failure through the NEAR stand-in. They're counted
      by route, status and code, with the upstream status.
    - `requests/:id`: the provoked request's lines; an unknown ID gives 404.
    - `work`: queue counts after making a call with notes on, and runs for upkeep after `maintain`.
    - The database down: a second server with a dead pool still answers `release`, `errors` and `requests`.
    - The ring keeps no browser line. Send `/v1/telemetry` entries at error level whose context sets
      `component: 'writer'`, `source: 'server'`, `noteId`, `requestId` and `status`, and whose message holds an address.
      None of them appears in `errors`, `requests/:id` or `work`'s finals.
  - `start-up.integration.test.ts`:
    - With a TCP proxy in front of Postgres that closes its first three connections, `startServer(env)` starts, and
      `facts.boot`'s `database` step has `tries` ≥ 4.
    - With a proxy that never forwards, it refuses after the window. Use a shortened window: the retry function takes a
      `windowMs` parameter, and the test passes 3 000.
- [ ] **Step 2: Run them; they should fail.**
- [ ] **Step 3: Implement** `recent.ts`, the `log.ts` hook, `runs.ts` and every loop's run, the boot steps and the retry,
  `release.ts`, `work.ts`, `wire.ts`, the routes and the CLI.
- [ ] **Step 4: Run both files, plus `src/features/notes/home.integration.test.ts` and
  `src/integration/confidential-space.integration.test.ts`** (start-up and attestation are touched). Then typecheck and
  the policy scripts.
- [ ] **Step 5: Commit:** `Operator routes: recent errors, background runs, start-up steps, release and work`.

### Task 4: Live checks from inside, and the upstream status on inference failures

**Files:**
- Create: `apps/api/src/operator/checks.ts`, `cli-checks.ts`,
  `apps/api/src/integration/operator-checks.integration.test.ts`
- Modify:
  - `apps/api/src/inference.ts`:
    - the sealed reply's status goes into the context of `statusError` at :400 and :493, as `upstreamStatus`;
    - :119's `status: res.status` becomes `upstreamStatus`;
    - export `probeNotes(cfg, model: ChatModel)` and `probeSpeech(cfg)`. Both are sealed and fixed, and need no meter.
  - **`upstreamStatus` everywhere.** Every `AppError` context that carries another service's HTTP status names it
    `upstreamStatus`. Find them with `rg -n "status: (res|r|answer|reply)\.status" apps/api/src`: at least `google.ts`,
    `gcp.ts`, `features/billing/oneclick.ts`, `edge/dns.ts` and the Drive and 1Click providers.
  - **`http/middleware.ts`'s `onError`** writes the response's `status: err.status` after spreading `err.context`, so a
    context can never overwrite it.
  - **Tests and docs.** Update any test that asserts those log fields under `status`. Say in
    `docs/engineering/logging-and-errors.md` that `upstreamStatus` is another service's answer.
  - `evidence.ts`: export `verifyFresh(cfg, model, task)`, which never reads or writes the cache.
  - `objects.ts`: `ping(): Promise<void>` (HeadBucket).
  - `features/billing/oneclick.ts`: export `probeTokens(cfg)`, which calls `GET /v0/tokens` uncached.
  - `google.ts`: export `checkGoogle(cfg)`:
    - discovery, then the key set;
    - the token endpoint with a random code (`invalid_grant` means the client is ok);
    - the `Date` header's offset.
  - `livekit.ts`: export `livekitProbe(cfg)` on its own `RoomServiceClient`: 5 s request timeout, no failover.
  - `testing/fake-google.ts`: its token endpoint answers `invalid_grant` for an unknown code with the right client and
    `invalid_client` otherwise.
  - `testing/fake-near.ts`: it can refuse a model's chat with a given status, if it can't already.
  - `operator/routes.ts` and `operator-cli.ts`.

**Behaviour that's fixed (§4.3):**
- `GET /v1/operator/checks` runs every check in parallel, each raced against 10 s.
- One run every 20 s per instance; a request in between gets the last run, with `cached: true`.
- The notes probe's prompt asks for `{"ok":true}`, with `max_tokens: 16`. The speech probe sends 1 s of 16 kHz mono
  silence.
- The probes are logged as `operator probe` with `{ model, status, ms }`.
- Each check is `{ name, ok, ms, code, detail }`, where `code` is a class or code, an HTTP status as a string, or an S3
  error name. Never a provider's message.
- The `google` check's `detail` includes `behindGoogleS`, measured from Google's `Date` header. Task 4 doesn't touch
  `facts`: Task 3 owns them.

- [ ] **Step 1: Write `operator-checks.integration.test.ts`.**
  - Every check is ok against the stand-ins.
  - A second call within 20 s gives `cached: true`.
  - **The worked example:** the NEAR stand-in refuses the notes model's chat with 403. Then:
    - `near-ai:notes` has evidence ok, the probe not ok, and `status` 403;
    - `near-ai:speech` is ok;
    - a notes job written meanwhile logs `notes not written yet` with `err.context.upstreamStatus` 403;
    - an `ask` that fails on it logs the response's `status` as 500 and `upstreamStatus` as 403, never 403 as `status`.
  - The NEAR stand-in times out: `code` is `UnansweredError`, with `timedOut`.
  - Google's client is wrong: the `google` check's `code` is `invalid_client`.
  - No probe's prompt or audio appears in the log.
- [ ] **Step 2: Run it; it should fail.**
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run it, plus `src/features/notes/models.integration.test.ts` and
  `src/features/billing/topups.integration.test.ts`** (touched code). Then typecheck and the policy scripts.
- [ ] **Step 5: Commit:** `Operator routes: live checks from inside, inference failures carry their status`.

### Task 5: Billing, limits and accounts for support

**Files:**
- Create:
  - `apps/api/src/features/billing/supportCommands.ts` and `operator-routes.ts`
  - `apps/api/src/limitCommands.ts`
  - `apps/api/src/features/account/operator.ts` and `operator-routes.ts`
  - `apps/api/src/operator/cli-support.ts`
  - `apps/api/src/features/account/operator.integration.test.ts`
- Modify:
  - `billing-cli.ts` and `limits-cli.ts`: thin wrappers over the commands
  - `features/billing/support.ts`: lookup modes; extended standing
  - `features/billing/support.integration.test.ts`
  - `app.ts`: the registrars
  - `operator/routes.ts`: the limits route
  - `operator-cli.ts`

**Interfaces (produced):**

```ts
// features/billing/supportCommands.ts
export type Lookup = 'ids' | 'ids-and-addresses';     // the route: 'ids'; billing-cli with KMASTER: 'ids-and-addresses'
export function supportScope(words: string[]): OperatorScope;   // show → read, credit → write
export function runSupportCommand(d: Support, words: string[], o: { lookup: Lookup; operator?: { keyId: string; reason: string } }): Promise<string[]>;
// limitCommands.ts
export function limitScope(words: string[]): OperatorScope;     // list → read, set → write
export function runLimitCommand(db: Db, words: string[]): Promise<string[]>;
```

Behaviour that's fixed:

- **Looking an account up.** `'ids'` takes a top-up reference (22 characters) or an account ID (43 characters) that has
  a row in `identities`. A workspace's or team's ID is refused with `No account has that ID.`, the same as a missing one.
  An address is refused with `Name the account by a top-up’s reference or by its ID.` In the CLI, `'ids-and-addresses'`
  finds the account by its address under `indexKey(d)` (owners.ts), never one derived from `KMASTER`.
- **Credits through the route.**
  - At most $1,000. A key's credits through the route are kept in memory per UTC day; the next credit is refused once
    they would pass $2,000.
  - By account ID, the digest is `blindIndex(indexKey(d), 'operator-credit', accountId + '\n' + reason)`. It's inserted
    into `operator_credits` in the credit's own transaction. A conflict gives `ConflictError('That ticket already added
    money to this account. Nothing was added.')`.
  - The CLI keeps its $10,000 maximum, and keeps no digest.
- **`show`'s extra lines (§4.6),** every one a state, code, count or day, never an amount:
  - `Renewal: <code>`
  - `Notices waiting: <kind> <n>, …`
  - `License: <none | member | admin>[ until <day>]`
  - `Notes: <running | stopped>`
  - `Storage: <within | over | in grace>`
  - `Team: <role>; members <n>; licenses <n>; open invites <n>`
- **Top-up routes:**
  - `GET /v1/operator/topups/:reference` (§4.7). Times are rounded down to the hour as ISO strings.
  - `POST /v1/operator/topups/:reference/check` (write). It runs the person's own check for that one top-up:
    `get(d, ownerId, depositId)` in `deposits.ts`, under the watcher's row lock. It throws away what `get` returns,
    which holds the address and amounts, re-reads the state, and answers `{ before, after, watched }`. Never call
    `watch(d)`: it takes up to 20 due top-ups of any account. A top-up that's credited, closed or given up is refused
    with `ConflictError('That top-up isn’t watched any more.')`.
- **Limits:** `POST /v1/operator/limits` takes `{ words, reason? }`, with its scope from `limitScope`. `limits-cli` stops
  logging `typed`, and stops logging a name that isn't a limit.
- **Account routes (§4.6, §5.2):**
  - `GET /v1/operator/accounts/:accountId`.
  - `POST /v1/operator/accounts/find` with `{ email, reason }`. It's write only, limited to 20 a key an hour with
    `rateLimit(20, 3_600_000)` keyed by key ID, and answers `{ found: 0 | 1 | n, accountId? }`. The address is never
    logged: its own line is `account found by address` with `{ found }`.
  - `POST /v1/operator/accounts/:accountId/sessions/end` (write), answering `{ ended: n }`.
- **CLI:**
  - `billing show|credit`, `topup <ref>`, `topup check <ref>`, `account <id>`, `account sign-out <id>`.
  - `account find [<email>]` reads a hidden prompt when the address isn't given.
  - `limits list|set`.

- [ ] **Step 1: Write the tests.**
  - In `support.integration.test.ts`, add `describe('through the operator route')`:
    - `show` by reference and by account ID gives the same lines as the CLI, plus the new ones.
    - Refused: an address; a workspace's ID; a team's ID.
    - A credit by reference adds once.
    - A credit by account and reason: the second is refused 409, and a new reason adds.
    - $1,000.01 is refused.
    - A third $900 credit by the same key on one day is refused.
    - The top-up lookup has no address, memo, amount or provider reference: check the body against the sealed record's
      values.
    - `topup check` on an open top-up credits it once the 1Click stand-in settles; a second check is harmless.
    - Cross-owner: one account's reference credits only that account, and its lookup names none of another's IDs.
    - The CLI still prints what it did, through `runSupportCommand`.
  - In `features/account/operator.integration.test.ts`:
    - The lookup's sessions by provider, keys open, and agents.
    - `find` by address gives the account. Through a read key: 403. The 21st in an hour: 503.
    - The address never appears in any log line, hashed or not (check the blind index's hex and base64url too).
    - `sessions/end` signs the browser out, and agents still work.
    - A workspace's ID is refused.
  - Limits through the route: `list`, then `set` with a reason; the value is in force on the next request; a value out
    of bounds is refused.
- [ ] **Step 2: Run them; they should fail.**
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run** `support.integration.test.ts`, `topups.integration.test.ts`, `plans.integration.test.ts`,
  `features/account/operator.integration.test.ts` and `features/account/notifications.integration.test.ts`. Then
  typecheck and the policy scripts.
- [ ] **Step 5: Commit:** `Operator routes: billing, limits and accounts for support`.

### Task 6: Calls and notes

**Files:**
- Create:
  - `apps/api/src/features/calls/operator.ts`, `operator-routes.ts` and `operator.integration.test.ts`
  - `apps/api/src/features/notes/operator.ts`, `operator-routes.ts` and `operator.integration.test.ts`
  - `apps/api/src/operator/cli-calls.ts`
- Modify:
  - `features/calls/lifecycle.ts`: export `endStuckCall(d, callId): Promise<'ended' | 'not-stuck' | 'not-live'>`, which
    re-checks the signals under the row lock, then calls `endCall`.
  - `app.ts` and `operator-cli.ts`.

**Behaviour that's fixed (§4.8, §4.9, §5):**
- **`GET /v1/operator/calls/:id`.**
  - `:id` must match `^[A-Za-z0-9_-]{22}$`. It's tried as a call ID, then a meeting ID (through `call_codes` or
    `calls.meeting_item_id`), then a note ID (through `recordings.note_item_id`). `matchedAs` says which.
  - Counts come from the sealed state, through `openOwner(d, ownerId, undefined)` and `load`, never by returning its
    fields.
  - LiveKit is asked through `d.livekit`, raced against 5 s. The answer includes `room: { exists, participants,
    publishers } | null`.
  - Signals:
    - `overdue`: past `call.max_seconds`;
    - `hostGone`: host away past `HOST_GRACE_MS`;
    - `roomGone`: live, older than 60 s, and LiveKit doesn't list its room;
    - `noRoom`;
    - `roomLeftUp`: ended within the last hour with its room still listed.
- **`POST /v1/operator/calls/:callId/end`** (write) runs `endStuckCall`. A call that isn't stuck is refused with
  `ConflictError('That call isn’t stuck; nothing was done.')`.
- **`POST /v1/operator/calls/:callId/room/close`** (write) works only when the call has ended. It calls
  `d.livekit.deleteRoom(room)` and answers `{ deleted: boolean }`.
- **`GET /v1/operator/notes/:noteId`** (§4.9). Never select `job_ciphertext`, `state_ciphertext` or `clip_ciphertext`.
  Leave out the ring lines: Task 3 builds the ring in parallel, and the coordinator adds `recent.forId('noteId', …)` to
  the answer after both merge.
- **`POST /v1/operator/notes/:noteId/retry`** (write):
  - `UPDATE content_jobs SET lease_until = now() WHERE … AND (state = 'waiting' OR (state = 'queued' AND lease_until >
    now()))`, then `kick(d, ownerId)`.
  - It's refused while a job is `writing` with a live lease, with `ConflictError('Notes are being written now.')`.
  - It answers `{ before, after }`.
- **`POST /v1/operator/notes/:noteId/exports/retry`** (write): `due_at = now()` for `pending` exports whose lease has run
  out, then the Drive worker's `kick`. It answers `{ retried: n }`.
- **The CLI.** `call`, `call end`, `call room close`, `note`, `note retry` and `note exports retry`. Each takes an ID or
  a pasted `/calls/<id>` or `/calls/upcoming/<id>` address, keeping only the ID. Anything with `/join/` or `/call/` in it
  is refused locally with "That's a join link: its code lets anyone in. Ask for the address of the call's page
  instead.", before anything is sent.

- [ ] **Step 1: Write the tests.**
  - `features/calls/operator.integration.test.ts`:
    - Looking a call up by each kind of ID gives the same `callId`.
    - Counts for a call with two people and a guest; the test LiveKit's room exists, with its participants.
    - A code (`abc-defg-hij`) gives 400.
    - `end` on a healthy call gives 409. On a call made overdue with `h.setLimit('call.max_seconds', 1)`, it ends the
      call, and its note job is queued.
    - `room close` refuses a live call, and closes an ended call's room.
    - Cross-owner: one account's call lookup holds no ID of another account's call.
    - No name, address or title appears in any answer or log line.
  - `features/notes/operator.integration.test.ts`:
    - The lookup for a note being written, and for one written.
    - Retry: the NEAR stand-in refuses evidence, so the job goes `waiting`. The stand-in recovers, `retry` makes it
      due, and the note is written without waiting 300 s.
    - Retry while a writer holds the job gives 409.
    - Exports retry against the Drive stand-in.
    - No transcript words in any answer.
- [ ] **Step 2: Run them; they should fail.**
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run both, plus `calls.integration.test.ts`, `hosting.integration.test.ts` and
  `notes/drive-exports.integration.test.ts`.** Then typecheck and the policy scripts.
- [ ] **Step 5: Commit:** `Operator routes: calls and notes, ending a stuck call, retries`.

### Task 7: The checks job

**Files:**
- Create: `apps/api/src/operator-job.ts`, `infra/confidential-space/job.sh`,
  `apps/api/src/integration/operator-job.integration.test.ts`
- Modify:
  - `apps/api/entrypoint.sh`: with `ALCOVE_JOB=checks`, the proxy as now, then `node dist/operator-job.js checks`
    instead of the server
  - `apps/api/Dockerfile`: `ALCOVE_JOB` allowed in `allow_env_override`
  - `apps/api/package.json`: `src/operator-job.ts` in `build`
  - `infra/confidential-space/env.sh` and `lib.sh`, as needed
  - `infra/confidential-space/README.md`: a section on the job

**Behaviour that's fixed (§7):**
- **What the job does.** `operator-job.ts checks`:
  - It runs each start step on its own, carrying on past a failure: configuration; Google Cloud (identity and secrets);
    the database's first connection; migrations (status only, never applied); keys; the object store; and the
    certificate's status from the database (never ordered).
  - **Keys are opened read-only.** Unwrap the master and check the stored server keys open. Never write or seal anything.
    If `resolveKeys` can write, add a read-only path beside it.
  - Then it runs Task 4's `runChecks` on the deps it could build.
  - It prints one JSON log line per step and check (`operator job step`, `operator job check`), then
    `operator job done` with `{ ok, failed: n }`.
  - It exits 0 when everything passed, 1 otherwise.
  - It never listens, migrates or writes.
- **`job.sh <production|staging> checks [--dry-run]`:**
  1. Reads the group's current instance template.
  2. Creates `alcove-job-<utc time>` from it, with metadata `tee-env-ALCOVE_JOB=checks` and `tee-restart-policy=Never`,
     and outside the load balancer.
  3. Waits for it to stop, for up to 15 minutes.
  4. Prints its `operator job` lines from Cloud Logging, filtered on the instance's ID.
  5. Deletes the VM.
  6. Refuses up front when the C3 quota can't hold another 4 vCPUs.
  - `--dry-run` prints each changing command and runs only the reads.
  - The script follows `lib.sh`'s patterns (`cs_run`, `cs_die`).

- [ ] **Step 1: Write the test.** `operator-job.integration.test.ts` spawns `src/operator-job.ts checks`:
  - with the harness's database, bucket and stand-ins, and `TEE=none`: exit 0, one line per step and check;
  - with a wrong `DATABASE_URL` port: exit 1, the database step failed, and the later checks still ran.
- [ ] **Step 2: Run it; it should fail.**
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Check the infra side.**
  - `bash -n infra/confidential-space/job.sh`.
  - Run `job.sh production checks --dry-run` once with the `alcove` gcloud configuration: it must show only reads. If
    gcloud isn't authorised here, say so and stop.
  - `deploy.sh`'s label check must still pass with env.sh.
- [ ] **Step 5: Commit:** `Operator routes: a one-shot checks job for an API that won't start`.

### Task 8: The privacy sweep over every operator route

**Files:** modify `apps/api/src/integration/flows.integration.test.ts`.

- [ ] **Step 1: Extend the canary test.** After its canary flow, add `it('says nothing private on any operator
  route')`:
  - **Collect the IDs:** the canary account's ID, its calls' and notes' IDs, a top-up opened with the 1Click stand-in,
    and the request IDs of the canary flow's requests.
  - **Call every operator route** with `h.operator.write`:
    - every read route with those IDs;
    - every write route once, where harmless: `topup check`, `note retry`, `exports retry`, `limits set` to its current
      value, `feature-flags list`. `account find` with the canary address, and `sessions/end` last.
  - **Assert** that no canary string, email, name, payment address or amount (the top-up's sealed values) appears in any
    answer or in any log line since the sweep began.
  - **A coverage check:** the set of routes called equals the set of `/v1/operator/*` routes `createApp(h.deps).routes`
    registers, so a new route can't skip the sweep.
- [ ] **Step 2: Run** `npx vitest run src/integration/flows.integration.test.ts -t "privacy"`, or the canary block's
  name. Fix any leak in the route that leaks, not in the test.
- [ ] **Step 3: Commit:** `Operator routes: the privacy test sweeps every operator route`.

### Task 9: Docs and runbooks

**Files:**
- Create: `docs/engineering/operating-alcove.md`.
- Modify:
  - `infra/confidential-space/README.md`: Settings (`OPERATOR_KEYS`, built into the image), Logs (link), the job
  - `docs/engineering/logging-and-errors.md`: the ring, the audit line, references in the app, `boot step`
  - `docs/engineering/feature-flags.md` › In production: signed requests through `operator feature-flags`
  - `docs/engineering/plans-and-usage.md` › Support: the operator route
  - `docs/engineering/deployment-and-acceptance.md`: changing a limit in production
  - `docs/README.md`: the index
  - `docs/engineering/folder-ownership.md`: if Task 1 left anything out

**Content:**
- `operating-alcove.md` holds:
  - who can operate, and how to make and add a key;
  - every route with its input and answer (from the code, not the spec);
  - the CLI;
  - the seven runbooks of §13, with exact commands.
- Every command must run as written. Check each `operator` command against a local server with a test key, and each
  `gcloud` command for read-only flags.
- No real names. No local paths.

- [ ] **Step 1: Write the docs** from the merged code.
- [ ] **Step 2: Check every command and link** (`rg -n '\]\(' docs/engineering/operating-alcove.md`; each target exists).
- [ ] **Step 3: Commit:** `Operator routes: runbooks and docs`.

---

## Appendix: queue SQL sketches (Task 3), from the inventory

```sql
-- notes jobs, joined to their note
SELECT j.state, j.attempt, (j.lease_until IS NULL OR j.lease_until < now()) AS claimable, r.created_at AS queued_at
FROM content_jobs j JOIN revisions r USING (owner_id, revision_id) WHERE j.kind = 'notes';
-- Drive exports
SELECT state, count(*), max(attempt),
  count(*) FILTER (WHERE state IN ('pending','uploading') AND due_at <= now() AND (lease_until IS NULL OR lease_until < now())) AS claimable
FROM drive_export_jobs GROUP BY state;
-- shared screens waiting to be joined
SELECT count(DISTINCT p.recording_id), count(*), coalesce(sum(p.cipher_bytes), 0), min(r.ended_at)
FROM screen_pieces p JOIN screen_shares s USING (owner_id, recording_id, share_id) JOIN recordings r USING (owner_id, recording_id)
WHERE s.keep AND r.state = 'stopped';
-- object deletes
SELECT count(*), count(*) FILTER (WHERE attempts > 0), coalesce(max(attempts), 0), min(queued_at) FROM object_gc;
-- deposits
SELECT count(*) FILTER (WHERE check_after <= now()) AS due, min(check_after) FILTER (WHERE check_after <= now()) AS oldest_due,
  count(*) FILTER (WHERE state IN ('waiting','arriving','short') AND give_up_at > now()) AS open,
  count(*) FILTER (WHERE state IN ('waiting','arriving','short') AND give_up_at < now() - interval '10 min') AS unanswered
FROM deposits WHERE check_after < 'infinity';
SELECT count(*) FROM deposits WHERE state = 'credited' AND check_after < 'infinity';
-- plans and teams
SELECT count(*) FILTER (WHERE due_at <= now()), min(due_at) FILTER (WHERE due_at <= now()) FROM plan_accounts;
-- calls
SELECT count(*) AS live, count(*) FILTER (WHERE started_at <= now() - make_interval(secs => $1)) AS overdue,
  count(*) FILTER (WHERE host_left_at < now() - interval '25 seconds') AS host_gone, count(*) FILTER (WHERE room_name IS NULL) AS no_room
FROM calls WHERE state = 'live';
```
