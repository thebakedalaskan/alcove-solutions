# Alcove in Confidential Space (Google Cloud TDX) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything in Alcove that can see plaintext runs inside Google Cloud Confidential Space on Intel TDX. Keys exist only there, TLS ends there, the web app is served from there, and the app checks the attestation before it trusts the server. Production data is carried over, never reset.

**Architecture:** One container image, holding the API and the web app's static files, runs in Confidential Space VMs (c3-standard-4, TDX). They're a managed instance group behind a regional external passthrough load balancer with a static IP.
- **The master key.** A random master is made inside the workload. It's wrapped by a Cloud KMS key that only attested, signed builds can use, through Workload Identity Federation, and stored wrapped in Postgres.
- **The server-keys bundle.** Sealed under that master, it lets existing data keep opening. Root keys are re-wrapped into `owners.root_envelope_v2`. The blind-index key and `KSERVICE` are carried over. The old master is held only until the switch is confirmed.
- **TLS** ends in the container, with a key derived from the master and Let's Encrypt certificates kept in Postgres.
- **The token.** The API hands out a Google-signed attestation token carrying the browser's nonce, the TLS key and the build.
- **The app's check.** It verifies the token, and checks that the image's signature is in Sigstore's public log (Rekor).
- **Feature flags** move to an operator route, replacing the Cloud Run job that held `KMASTER`.

We first chose dstack on GCP and dropped it. Its key service accepts a GCP VM only on one hard-coded firmware value, and seals each node's root key to it, so a Google firmware update can lose every key for good. Its only upgrade path also deletes the VM, and each build waits 15–25 minutes for Base to finalize.

**Tech Stack:** TypeScript (Node 24, Hono with `@hono/node-server` over HTTP/2, zod, pg, @noble/*), Vitest integration tests, Confidential Space (the launcher's attestation token API), Cloud KMS, Workload Identity Federation, Secret Manager, Artifact Registry, cosign, Compute Engine MIG with a passthrough load balancer, Let's Encrypt (ACME dns-01 through Cloudflare), cosign with Rekor (Sigstore's public log), GitHub Actions.

**Spec:** The decisions below, made with the user on 2026-11-12. Also `docs/engineering/privacy-keys-and-sessions.md`, sections "Moving to confidential computing" and "Production requirements". The Confidential Space facts are in the runbook, which Task 6 copies into `infra/confidential-space/README.md`.

## Decisions

1. **The platform.** Confidential Space on Intel TDX: c3-standard-4 in `us-central1`, a managed instance group behind a regional external passthrough load balancer with a reserved static IP. Updates are rolling, with max surge 1 and max unavailable 0.
2. **The master.** It's 32 random bytes made inside the workload the first time it starts on a database, wrapped with the Cloud KMS key `alcove-master` (key ring `alcove`, `us-central1`), and stored wrapped as `server_keys` row `master`. Encrypt and decrypt are granted only to a Workload Identity Federation principal set, conditioned on the attestation: the Confidential Space production image, `STABLE` support, TDX, debugging off, and an image signed by CI's key.
3. **Build approval: a public log, no wallet.**
   - CI signs each image with cosign, using the Cloud KMS key `alcove-image-signing`, with the annotation `commit=<sha>`. cosign records that signature in Sigstore's public transparency log (Rekor), which no one can rewrite.
   - The key policy only releases the master to images signed with that key.
   - The app refuses a server whose image has no Rekor entry signed with our key for the commit it reports. Rekor answers browsers directly (CORS `*`, checked 2026-11-12).
   - There's no blockchain or wallet. The Base wallet made earlier was deleted, unfunded.
4. **No reset.** The master wraps root keys from now on. The blind-index key and `KSERVICE` are carried over, sealed in `server_keys` row `bundle`. The old master is carried only until the user confirms the switch, then retired. In production the old keys are read once from Secret Manager (`alcove-kmaster`, `alcove-kservice`), never from env.
5. **Root keys stay.** Each account's root key is unchanged. Re-encrypting everything is out of scope, and the docs say so.
6. **What stays outside the VM.** Postgres, R2 and LiveKit only ever hold ciphertext, so they stay where they are. So do the migrations job and the `limits` CLI, which need no keys and stay on Cloud Run Jobs.
7. **The web app and TLS.**
   - The API container serves the web app on the apex domain and the API on `api.`. It moves off Cloudflare Pages.
   - TLS ends in the container: Node over HTTP/2, with HTTP/1.1 allowed. Its key is derived from the master, so it's the same on every instance and every deploy.
   - Certificates come from Let's Encrypt over ACME dns-01, through a Cloudflare token kept in Secret Manager. They're stored in Postgres, since they're public. One instance renews, holding an advisory lock.
   - DNS stays at Cloudflare as DNS-only, never proxied.
8. **Secrets and env.** Provider secrets come from Secret Manager at startup, through the VM's service account. Env carries only names and flags, because Confidential Space puts env in the attestation token's claims.
9. **Feature flags** move behind an operator-only route inside the VM, and the Cloud Run job `alcove-feature-flags` is deleted.
10. **Staging** runs the same image on a clone of the production database. It gets its own bucket (GCS through S3 interop), never production's, and demo sign-in. It's deleted afterwards.
11. **Confirmation.** The production switch, and deleting the old keys, happen only after the user confirms.

## Global Constraints

- Follow the AGENTS.md rules:
  - strict TypeScript: no `any`, no `as`, no `!`, no suppressions;
  - integration tests only (`*.integration.test.ts`), through the real HTTP API with real Postgres and object store;
  - no `console.*`;
  - throw `AppError` subclasses with `context`;
  - logs carry IDs, codes and counts, never content or keys;
  - migrations only add (tables, nullable columns, indexes), and merged migrations are never edited;
  - stored schemas get `.default(...)` for new fields and are never `.strict()`;
  - nothing readable goes in a column or a log;
  - new stored data gets a record kind, a header and a canary in the leakage test;
  - docs stay true to the code in the same change;
  - a contract change updates the server, `@alcove/api-http`, the app and Storybook's stand-in together.
- Never run root `pnpm test`, `pnpm check` or `pnpm dev` from a worktree. In `apps/api`, run `node scripts/check-tests.mjs` (from the repo root) and `pnpm exec vitest run <files>`. Root `pnpm typecheck` is fine.
- Never reset a database. Never touch production or cloud resources from a task: provisioning is the lead's (Ops).
- The next migration is `0029`.

## Review Focus

1. Refuse to start when `LEGACY_KMASTER` is wrong, or missing on a database that has accounts. Never seal a fresh bundle over existing accounts, because everyone would be locked out (Task 1 test).
2. Two TEE instances starting at once, as in a blue/green deploy, must end with one bundle (Task 1 test).
3. An account the old Cloud Run API created after the bulk re-wrap ran must still open in the TEE, through the lazy path (Task 1 test).
4. Retiring the old master while any account still lacks `root_envelope_v2` must refuse (Task 1 test).
5. Someone mid-sign-in at the switch: an attempt sealed under the old master fails with a retryable 4xx, never a 500 (Task 1 test).

---

### Task 1: Server keys, and carrying accounts into the TEE

Built for Confidential Space, not dstack: there's no key service that derives keys, so the master is made inside the TEE and kept wrapped by Cloud KMS. Task 3 supplies the real Cloud KMS wrapper and fetches the old keys from Secret Manager; until then the API refuses to start inside a TEE.

**Files:**
- Create: `apps/api/migrations/0029_tee_keys.sql`, which:
  - adds `owners.root_envelope_v2 bytea` (nullable);
  - sets `owners.root_envelope` to `DROP NOT NULL`;
  - creates `server_keys (id text PRIMARY KEY CHECK (id IN ('master', 'bundle')), record bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`.
- Create: `apps/api/src/serverKeys.ts`: the master and the bundle, key resolution at startup, and the bulk re-wrap. It's shared key infrastructure at the API's root, so `scripts/check-structure.mjs` and `docs/engineering/folder-ownership.md` name it.
- Create: `apps/api/src/testing/fake-kms.ts`: a test `KeyWrapper` that wraps under a fixed key of its own with XChaCha20-Poly1305 (`sealBinary`), so what it wraps is real ciphertext and one with another key can't unwrap it.
- Modify: `apps/api/src/crypto.ts`: an envelope `keyVersion`, `deriveIndexKey`, `blindIndex` taking the index key, and `serverKeysKey`.
- Modify: `apps/api/src/config.ts`: `TEE` is `none` or `confidential-space`, `DSTACK_SOCKET` is gone, `RETIRE_LEGACY_KMASTER`, the new `Config` fields, and `loadConfig` taking the pool, the key wrapper and the old keys.
- Modify: `apps/api/src/tee.ts`: dstack's key derivation (`teeKeys`, `GetKey`) is gone. Its attestation is left as it was, on a fixed guest-agent socket, for Task 3 to replace.
- Modify: `apps/api/src/server.ts`: the pool and the migrations before the keys; the bulk re-wrap after listening. It passes no wrapper and no old keys yet, so inside a TEE it refuses to start until Task 3.
- Modify: `apps/api/src/owners.ts`: `createOwner` and `findOwner` per the rules below, plus `indexKey(d)`, `legacyMasterKey(d)`, `sealRoot` and `openRoot`.
- Modify: every `blindIndex(masterKey(…), …)` call site (33, in 15 files, tests included), to `blindIndex(indexKey(…), …)`; `emailHash` takes the index key.
- Modify: `apps/api/src/feature-flags-cli.ts`, to `blindIndex(deriveIndexKey(kmaster), …)`.
- Modify: `apps/api/src/testing/harness.ts`, so `secondServer` resolves keys through `resolveKeys` when it's given `TEE: 'confidential-space'`, with `fakeKms()` and the old keys it's given (`legacy`), and returns the `cfg` it runs with.
- Test: `apps/api/src/integration/tee-keys.integration.test.ts` (new). The existing TEE test in `apps/api/src/integration/flows.integration.test.ts` now checks the key refusals and the resolved keys; its dstack attestation assertions are gone (Task 3 replaces that test). The leakage test seals server keys and checks their canaries. `scripts/ci-test-times.json` has the new file.
- Docs:
  - `docs/engineering/privacy-keys-and-sessions.md`: the key inventory; the records table (kind `server-keys`); the blind-index key; "Moving to confidential computing", replacing step 3 "Reset storage" with this import; production requirement 5.
  - `docs/engineering/data-and-storage.md`: the tables. `docs/engineering/feature-flags.md`: the hash's key. `.env.example`: `TEE`, `RETIRE_LEGACY_KMASTER`.

**Interfaces:**
- Produces:
  - `type Config = Omit<Env, 'KMASTER' | 'KSERVICE'> & { KMASTER: string; KSERVICE: string; INDEX_KEY: string; LEGACY_KMASTER: string | undefined }`. Every key is base64url of 32 bytes. `KMASTER` is the current master: it wraps `root_envelope_v2` and derives the call-pass, media-token, photo-token and sign-in-attempt keys. Task 5 derives the TLS key from it too.
  - `loadConfig(env: NodeJS.ProcessEnv, overrides: Partial<Record<keyof Env, string>>, pool: pg.Pool, wrapper: KeyWrapper | undefined, legacy: LegacyKeys | undefined): Promise<Config>`.
  - In `serverKeys.ts`:
    - `interface KeyWrapper { wrap(plaintext: Uint8Array): Promise<Uint8Array>; unwrap(ciphertext: Uint8Array): Promise<Uint8Array> }`;
    - `interface LegacyKeys { kmaster: string; kservice: string }`;
    - `resolveKeys(e: KeySettings, pool: pg.Pool, wrapper: KeyWrapper | undefined, legacy: LegacyKeys | undefined): Promise<Pick<Config, 'KMASTER' | 'KSERVICE' | 'INDEX_KEY' | 'LEGACY_KMASTER'>>`, where `KeySettings = Pick<Env, 'TEE' | 'KMASTER' | 'KSERVICE' | 'RETIRE_LEGACY_KMASTER'>`, so an `Env` will do;
    - `rewrapOwners(d: Pick<Deps, 'cfg' | 'pool'>, opts?: { batch?: number }): Promise<{ rewrapped: number; failed: number; remaining: number }>`.
  - `fakeKms(name?: string): KeyWrapper` in `testing/fake-kms.ts`. The same name is the same key.
  - In `crypto.ts`:
    - `deriveIndexKey(kmaster: Uint8Array): Uint8Array`, which is `derive(kmaster, empty salt, 'alcove/index/v1')`, unchanged from today;
    - `blindIndex(indexKey: Uint8Array, purpose, value): Uint8Array`, which is `hmac(sha256, indexKey, purpose ‖ 0 ‖ value)`;
    - `serverKeysKey(kmaster: Uint8Array): Uint8Array`, which is `derive(kmaster, empty salt, 'alcove/server-keys/v1')`.
  - `sealKey(wrapKey, ownerId, scopeId, key, keyVersion: '1' | '2')` and `openKey(wrapKey, ownerId, scopeId, envelope, keyVersion: '1' | '2')`. The header binds `keyVersion`, so a `'1'` envelope never opens as a `'2'`. Revision and recording envelopes stay `'1'`.
  - In `owners.ts`: `indexKey(d: Pick<Deps, 'cfg'>): Uint8Array` and `legacyMasterKey(d: Pick<Deps, 'cfg'>): Uint8Array | undefined`. `masterKey(d)` stays, and is the current master. `sealRoot(master, ownerId, root, keyVersion)` and `openRoot(master, ownerId, envelope, keyVersion, check)` wrap and open a root, with the root check.

**Rules the code follows:**
- **Env.**
  - `TEE` is `none` (the default) or `confidential-space`.
  - `RETIRE_LEGACY_KMASTER` is a boolean, default false, accepted only inside a TEE.
  - `KMASTER` and `KSERVICE` are still refused inside a TEE.
  - There are no `LEGACY_*` env vars. Confidential Space puts env values in the attestation token's claims, so the old keys reach `resolveKeys` as an argument. Task 3 fetches them from Secret Manager; tests pass them.
- **`TEE=none`.** `KMASTER` and `KSERVICE` come from the env, as today. `INDEX_KEY = deriveIndexKey(KMASTER)` and `LEGACY_KMASTER = KMASTER`, so local data keeps working and `createOwner` dual-writes. The old keys, if given, are ignored.
- **`TEE=confidential-space`.** Without a wrapper, refuse. Old keys must be 32 bytes, base64url each; with `RETIRE_LEGACY_KMASTER`, refuse them.
  - **The master.** Row `master` holds the wrapper's ciphertext of the master, as Cloud KMS returns it. With no row: if row `bundle` exists, refuse, since a new master could never open it. Otherwise make 32 random bytes in the TEE, wrap them, `INSERT … ON CONFLICT (id) DO NOTHING`, and re-read. Unwrap whatever is stored, so instances racing end with one master. If it won't unwrap, or wrapping fails, refuse (`KeyError`).
  - **The bundle.** Row `bundle` is a sealed record of kind `server-keys`, with header `{v:1, kind:'server-keys', ownerId:'', id:'bundle'}`, under `serverKeysKey(master)`. Its body is `{ indexKey, kservice, legacyKmaster: string | null }`.
  - **No bundle, old keys given.** Verify the old master first: on up to 5 owners that have `root_envelope`, it opens the envelope and the root check matches. If any fails, refuse ("The old KMASTER doesn’t open this database’s accounts"). Then seed `{ indexKey: deriveIndexKey(old master), kservice: old KSERVICE, legacyKmaster: old master }`.
  - **No bundle, no old keys, no owners.** Seed fresh: `{ indexKey: deriveIndexKey(master), kservice: 32 random bytes made in the TEE, legacyKmaster: null }`. The check for owners is repeated under `LOCK TABLE owners IN SHARE MODE` in the inserting transaction, so no account is made meanwhile.
  - **No bundle, no old keys, owners exist.** Refuse ("This database has accounts but no server keys: start once with the old KMASTER and KSERVICE they were made under").
  - **Inserting.** Insert with `ON CONFLICT (id) DO NOTHING`, then re-read. Whatever is stored wins.
  - **Bundle exists.** If it doesn't open under the master, refuse. Old keys given must equal what's carried. Old keys given when none is carried, because it was retired or there never was one, are refused.
  - **`RETIRE_LEGACY_KMASTER`.** Under the same lock, refuse while `COUNT(*) WHERE root_envelope_v2 IS NULL` is greater than 0 (a `ConflictError` that says "still"). Otherwise reseal the bundle with `legacyKmaster: null` and log it. Already retired, it does nothing.
- **`createOwner`.** Writes `root_envelope_v2`, version `'2'`, under the master. It also writes `root_envelope`, version `'1'`, under the legacy master while one is held, and NULL otherwise.
- **`findOwner`.**
  - With v2, open it under the master.
  - With no v2, but v1 and a held legacy master: open v1, check the root, then `UPDATE … SET root_envelope_v2 = $2 WHERE owner_id = $1 AND root_envelope_v2 IS NULL`. This is the lazy re-wrap. It runs on its own pooled connection, not awaited, once per owner per instance at a time, and a failure is logged at warn with the `ownerId`. The request may hold the owner's row in its transaction, so nothing it does waits on the re-wrap.
  - Otherwise throw `IntegrityError` ("This account’s key can’t be opened here."), which answers 403 `key-unavailable`. The root check applies on every path.
- **The bulk re-wrap.** `rewrapOwners` loops over batches of rows `WHERE root_envelope_v2 IS NULL AND root_envelope IS NOT NULL ORDER BY owner_id`, paging by `owner_id` so a failed owner isn't read again. The server starts it in the background after listening, whenever a legacy master is held, and logs `owners rewrapped` with `{ rewrapped, failed, remaining }`, at warn if any failed. A failed owner is logged at warn with its `ownerId` only.
- **Outside a TEE on a carried database.** This release must never run with `TEE=none` against a database a TEE carries over. It would write `root_envelope_v2` under the old master, which the TEE can't open and never re-wraps. So the deploy must stop running this release on Cloud Run. The previous release may keep serving there until the switch.

- [x] **Step 1: Write the failing tests** in `tee-keys.integration.test.ts`. Use the harness, `fakeKms()`, `resolveKeys` directly, and `h.secondServer({ TEE: 'confidential-space', legacy })`.
  - `seals fresh server keys only on a database with no accounts, and instances starting at once agree on them`:
    - On a database with no owners, two `resolveKeys` with no old keys in `Promise.all` agree.
    - There are two `server_keys` rows. `KMASTER` is what the wrapper unwraps from row `master`, and `INDEX_KEY` derives from it. `KSERVICE` is new, and there's no old master.
    - A TEE server makes an account with only `root_envelope_v2`, which signs in again.
  - `carries accounts made before the TEE into it`:
    1. Sign a browser in with fake Google, schedule a call inviting `guest@vandelay.test`, and note the account's credit balance.
    2. `UPDATE owners SET root_envelope_v2 = NULL` and `DELETE FROM server_keys`.
    3. Start the TEE server with the harness `KMASTER` and `KSERVICE` as the old keys.
    4. Expect: the same user signs in there and gets the same `ownerId`; the call lists with its guest and is found by its code; the balance is unchanged.
    5. Call `rewrapOwners` until `remaining === 0`, then expect `SELECT COUNT(*) … root_envelope_v2 IS NULL` to be 0.
    6. Someone who signs up on the release before after that (only the old envelope) signs in on the TEE server, and is re-wrapped lazily (Review Focus 3).
    7. Restart without the old keys. Expect the old master still held, and the user still signs in, the call still opens, the balance still reads.
  - `refuses to start on accounts it can’t open`:
    - With no bundle and no old keys on a database with owners, expect a rejection with `/old KMASTER/`.
    - With a random old master, expect a rejection with `/doesn’t open/`, and no `bundle` row.
    - Once sealed, expect another old `KSERVICE` to be rejected with `/aren’t the ones/`.
  - `a master wrapped for another key can’t be opened`:
    - Another wrapper: `/doesn’t unwrap/`.
    - Another master in row `master`: `/weren’t sealed under this master/`.
    - No `master` row beside a `bundle`: `/their master isn’t/`, and none is made.
  - `two instances starting at once agree on one bundle`: run two `resolveKeys` with the same old keys in `Promise.all`. Expect equal results, one `master` row and one `bundle` row.
  - `retires the old master only once every account has moved`:
    - With one owner's v2 set to NULL, expect `RETIRE_LEGACY_KMASTER=true` to reject with `/still/`.
    - After `rewrapOwners`, expect it to resolve with `LEGACY_KMASTER === undefined`. Started again, there's still none, and old keys are refused with `/retired/`.
    - Expect an account created after that to have `root_envelope IS NULL` and still sign in.
    - An account with only `root_envelope` after retirement is refused with `key-unavailable`, not a 500.
  - `a sign-in begun before the switch fails cleanly`: begin a Google sign-in on the harness server, and finish it on the TEE server. The callback is a top-level navigation and always answers with a redirect, never a 4xx. So expect a 302 to `/welcome?signin=expired`, whose message says to try again. Expect no session, no error-level log line, and a retry that signs in.
- [x] **Step 2: Run them and see them fail.** `pnpm exec vitest run src/integration/tee-keys.integration.test.ts` (in `apps/api`). Expect failures on the missing `resolveKeys` and the missing column.
- [x] **Step 3: Implement** the migration, crypto, config, tee, `serverKeys`, `fake-kms`, owners, call-site, server and harness changes, per the rules above.
- [x] **Step 4: Update** the existing TEE test in `flows.integration.test.ts` to `loadConfig(env, overrides, pool, wrapper, legacy)`. The harness database has accounts, so pass the old keys. Add leakage canaries: the master, the bundle's index key and `KSERVICE`, and the old master never appear in any column or log line, as hex, base64 or base64url.
- [x] **Step 5: Run.**
  - `node scripts/check-tests.mjs` (from the repo root);
  - `pnpm exec vitest run src/integration/tee-keys.integration.test.ts`;
  - `pnpm exec vitest run src/integration/flows.integration.test.ts -t "TEE|leak|privacy at rest|confidential computing"` (the leakage test's name doesn't say "leak");
  - the whole API suite, since blind indexes changed in every feature;
  - `pnpm typecheck` at the root.

  Expect all to pass.
- [x] **Step 6: Update the docs**, as listed in Files.
- [x] **Step 7: Commit.** `git commit -m "Server keys: carry accounts into the TEE without a reset"`

### Task 2: An operator route for feature flags

**Files:**
- Create: `apps/api/src/featureFlagCommands.ts`, holding the CLI's commands as one function. Check `docs/engineering/folder-ownership.md` for its owner, and move it if the map says so.
- Modify: `apps/api/src/feature-flags-cli.ts`, into a thin wrapper that prints the lines.
- Modify: the HTTP composition, to mount the route, wherever routes are mounted.
- Modify: `apps/api/src/config.ts`, adding `OPERATOR_TOKEN_SHA256`: optional, 64 lowercase hex characters.
- Test: the feature flags' integration suite (`grep -rl featureFlag apps/api/src --include='*.integration.test.ts'`).
- Docs: `docs/engineering/feature-flags.md`, replacing "In production" and the paragraph at the end about the confidential VM.

**Interfaces:**
- Consumes: `indexKey(d)` and `blindIndex` from Task 1.
- Produces: `runFeatureFlagCommand(db: Db, indexKey: Uint8Array, words: string[]): Promise<string[]>`, which returns the lines the CLI prints today, byte for byte.
- The route is `POST /v1/operator/feature-flags`, with header `Authorization: Bearer <token>` and body `{ words: string[] }`: 1–100 words, each at most 320 characters. It answers 200 with `{ lines: string[] }`.
  - It's not part of `AlcoveApi`: only operators call it, with curl.
  - It answers 404 while `OPERATOR_TOKEN_SHA256` is unset, and 401 when the SHA-256 of the token doesn't match, compared in constant time.
  - It allows 30 requests a minute per address.
  - It logs `operator feature flags` with `{ command: words[0], ok }` and nothing else.

- [ ] **Step 1: Write the failing test** `switches flags through the operator route`:
  - unset: expect 404;
  - a wrong token: expect 401;
  - the right token with `['everyone', <a test flag>, 'on']`: expect a signed-in browser's `featureFlags.on()` to include it;
  - `['group','create','staff']`, `['group','add','staff','ann@vandelay.test']` and `['grant', <flag>, 'group', 'staff']`: expect that person's browser to have it;
  - expect no response line, and no log line, to contain `ann@vandelay.test`.
- [ ] **Step 2: Run it and see it fail** (404 or route missing).
- [ ] **Step 3: Implement** `runFeatureFlagCommand` by moving the CLI's logic, then the route and the config.
- [ ] **Step 4: Run** the suite and `pnpm typecheck`. Expect them to pass.
- [ ] **Step 5: Update the docs and commit.** `git commit -m "Feature flags: switched through an operator route inside the API"`

### Task 3: The Confidential Space backend: keys from Cloud KMS, secrets, and the attestation token

The facts about Confidential Space are in the runbook that Task 6 adds as `infra/confidential-space/README.md`. Until then, the lead gives implementers its path.

**Files:**
- Modify: `apps/api/src/tee.ts`. Replace dstack with Confidential Space.
- Create: `apps/api/src/gcp.ts`. It holds:
  - the metadata-server token for the VM's service account;
  - the Secret Manager `access` call;
  - the STS token exchange from the launcher's attestation token file;
  - the Cloud KMS `encrypt` and `decrypt` calls.

  All of these are plain `fetch`, with zod parsing every response.
- Modify: `apps/api/src/config.ts`, `apps/api/src/server.ts`, `packages/api/src/trust/schema.ts`, the trust route, `packages/api-http` (trust parsing), and `apps/storybook/src/api/standin.ts`.
- Create: test fakes `apps/api/src/testing/fake-gcp.ts`, which covers the metadata server, Secret Manager, STS and Cloud KMS on one HTTP server, plus a fake launcher token socket that signs JWTs with a test key.
- Delete: `apps/api/src/testing/fake-dstack.ts` and every dstack-only path. Keep `dstack-images.ts`, which verifies NEAR AI's models.
- Test: `apps/api/src/integration/confidential-space.integration.test.ts`. Remove the old dstack TEE test from `flows.integration.test.ts`.
- Docs: in `privacy-keys-and-sessions.md`, rewrite "Moving to confidential computing" and "How a client checks the server". Update the key inventory too.

**Interfaces:**
- Consumes (Task 1): `resolveKeys(e, pool, wrapper: KeyWrapper | undefined, legacy: { kmaster: string; kservice: string } | undefined)` and `interface KeyWrapper { wrap(p: Uint8Array): Promise<Uint8Array>; unwrap(c: Uint8Array): Promise<Uint8Array> }`.
- New env, used only with `TEE=confidential-space`. Each value is a name, never a secret:
  - `GCP_PROJECT`;
  - `KMS_MASTER_KEY` (`projects/…/locations/us-central1/keyRings/alcove/cryptoKeys/alcove-master`);
  - `WIF_PROVIDER` (`projects/<number>/locations/global/workloadIdentityPools/alcove/providers/confidential-space`);
  - `SECRETS`: comma-separated `ENV_NAME=secret-name`, for example `DATABASE_URL=alcove-database-url,OBJECTS_ACCESS_KEY=…`. Each is fetched at startup and applied before `loadConfig`;
  - `LEGACY_SECRETS`: `kmaster-secret,kservice-secret`. Optional, and present only until retirement.
- Produces `cloudKmsWrapper(cfg): KeyWrapper` and `attestationToken(nonces: string[]): Promise<string>`. The second asks the launcher's socket for a PKI token (`token_type` per the runbook), with audience = `API_URL`, and nonces `[nonce, tlsSpkiSha256Hex, commit]`.
- Contract: the `AttestationSchema` variants become:
  - `{ tee: 'none', nonce, build: { commit } }`;
  - `{ tee: 'confidential-space', nonce, build: { commit }, tls: { spkiSha256: string }, token: string }`.

  The dstack variant is deleted. `GET /v1/attestation?nonce=<64 hex>` keeps its rate limit.

- [ ] **Step 1: Write the failing test**, `boots in Confidential Space with its master from Cloud KMS and attests to the browser's nonce`. Use the fakes. Expect:
  1. The server starts with `TEE=confidential-space`. Its secrets come from the fake Secret Manager, and none of them appear in env or in any log line.
  2. `server_keys` holds a `master` row equal to the fake KMS's ciphertext.
  3. A browser's `trust.attestation(nonce)` returns a token whose verified claims carry `eat_nonce` ⊇ `[nonce, tls.spkiSha256, commit]`.
  4. A restart reuses the same master: an account made before it still signs in.
  5. With the fake KMS refusing (an unattested principal), startup fails with a `KeyError` naming the key, not a crash loop of 500s.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement**, per the interfaces and the runbook's endpoints.
- [ ] **Step 4: Run** this test, `tee-keys`, the TEE and leakage parts of `flows`, and `pnpm typecheck`. Expect them to pass.
- [ ] **Step 5: Update the docs and commit.**

### Task 4: The app checks the server before it trusts it

**Files:**
- Modify: `apps/web/src/lib/queries.ts`. `checkTrust` moves to a new `apps/web/src/lib/trust.ts`.
- Modify: the UI that shows trust today. Find it with `grep -rn verifiedAt apps/web/src`.
- Modify: the Storybook stand-in and stories.
- Modify: `apps/web/scripts/csp.mjs`, so `connect-src` allows `https://rekor.sigstore.dev`.
- Docs: `docs/product/user-flows.md` and `docs/design/pages.md`, where they describe the trust state.

**Interfaces:**
- Consumes: the Task 3 contract.
- Produces: `verifyServer(a: Attestation, nonce: string, expect: { audience: string; imageRepo: string; releases: ReleaseLookup }): Promise<Trust>`. `Trust` is `{ state: 'verified' | 'unverified' | 'none'; reason?: string; commit: string; at: number }`.
  - **Checks, all required for `verified`:**
    - The PKI token's certificate chain verifies to Google's Confidential Space root, pinned in the bundle (PEM from the runbook), and the JWT signature verifies with WebCrypto.
    - `iss` and `aud`, the API origin, are as expected, and `exp` is in the future.
    - `eat_nonce` contains this nonce, `tls.spkiSha256` and `build.commit`.
    - `hwmodel` is `GCP_INTEL_TDX` and `swname` is `CONFIDENTIAL_SPACE`.
    - `dbgstat` is `disabled-since-boot`, and `support_attributes` includes `STABLE`.
    - The image reference is in `imageRepo`.
    - Rekor has an entry for this image signed with our key, for the same commit.
  - **Reading the release.** `ReleaseLookup` rebuilds cosign's simple-signing payload for `(imageRepo, digest, commit)` byte for byte, and looks its SHA-256 up in Rekor (`POST /api/v1/index/retrieve`, then `GET /api/v1/log/entries/{uuid}`). It accepts an entry only when all of these hold:
    - its signature verifies with our signing key's public key (pinned in the bundle);
    - its signed entry timestamp verifies with Rekor's public key (pinned);
    - its inclusion proof checks out.
- **Where it gates.** Sign-in, and anything that sends audio or a screen (the notes capture start), wait for `verified`. `unverified` shows a caution with the reason and Try again, and sends nothing. `none` is local development only: a `tee: 'none'` answer is accepted only when the app was built with `VITE_ALCOVE_ALLOW_UNATTESTED=true`, which only dev and Storybook set.
- **Copy.** Plain, with no caveats ("Checking Alcove's server…", "Alcove's server couldn't be checked: <reason>").
- **Dependencies.** Add one X.509 library (`@peculiar/x509` at an exact version at least two weeks old) and no other.

- [ ] **Step 1: Storybook scenarios first.** Add Checking, Verified, Couldn't check (each reason), and Not in a TEE (dev), in light and dark, on phone and wide. Add the journey from sign-in.
- [ ] **Step 2: Implement `verifyServer`** and wire the gates.
- [ ] **Step 3: Check it.** No unit tests: the API's integration test from Task 3 covers the server side. Run `pnpm typecheck` and the web build. In Storybook, check every scenario on both themes and both widths.
- [ ] **Step 4: Update the docs and commit.**

### Task 5: TLS inside the container, and the web app served by the API

**Files:**
- Create: `apps/api/migrations/0030_tls_certificates.sql`, a table `tls_certificates (id text PRIMARY KEY CHECK (id = 'current'), chain_pem text NOT NULL, not_after timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`. A certificate is public, and Certificate Transparency logs publish it anyway.
- Create: `apps/api/src/edge/` (check folder-ownership for its name):
  - `tlsKeys.ts`: `tlsKey(master: Uint8Array): { privateKeyPem: string; spkiSha256: string }`, a P-256 key from `HKDF(master, '', 'alcove/tls/v1')` reduced mod n, and `acmeAccountKey(master)` the same way with `'alcove/acme-account/v1'`;
  - `acme.ts`: ACME dns-01 through the Cloudflare API, with `acme-client` at an exact version at least two weeks old. One instance renews, under `pg_try_advisory_lock`, when the certificate has fewer than 30 days left. It checks every 12 hours.
  - `static.ts`: serves the web app's files baked into the image at `WEB_DIR`, with the same rules Cloudflare Pages applied. The file if it exists, then `{path}/index.html`, then `{path}.html`, else `/index.html` with 200. The headers come from `_headers`, plus the CSP that `csp.mjs` writes.
  - `listen.ts`: HTTP/2 with HTTP/1.1 allowed on `HTTPS_PORT`, by default 443. Plain HTTP on `HTTP_PORT`, by default 80, answers `/health` and redirects everything else to https. Routing goes by host: `api.` to the API, `www.` to a 301 for the apex, the apex to static.
- Modify: `apps/api/src/server.ts`, which listens through `listen.ts` when `TLS_HOSTS` is set (comma-separated hostnames) and keeps today's plain listener otherwise. Modify `config.ts` (`TLS_HOSTS`, `WEB_DIR`, `ACME_DIRECTORY`, `CLOUDFLARE_ZONE`, and the Cloudflare token through `SECRETS`) and `apps/api/Dockerfile` (build the web app, run `precache.mjs` and `csp.mjs`, copy `dist/client` to `/app/web`, and let node bind 80 and 443 per the runbook).
- Modify: `tee.ts`, so the attestation's `tls.spkiSha256` comes from `tlsKey(master)`.
- Test: `apps/api/src/edge/edge.integration.test.ts`. It runs a fake ACME directory (Pebble-like, in-process) and a fake Cloudflare DNS API in the test's fakes. Expect:
  - the certificate is issued once and stored;
  - a second instance reuses it, and doesn't order another;
  - the TLS key's SPKI equals the attestation's;
  - static routes match the Pages rules (deep link, asset cache headers, CSP present);
  - `www` redirects, and HTTP redirects except `/health`.

- [ ] **Step 1: Write the failing test.** **Step 2: Run it and see it fail.** **Step 3: Implement.** **Step 4: Run** it plus `pnpm typecheck`, and expect them to pass. **Step 5: Update the docs** (`system-architecture.md` and `privacy-keys-and-sessions.md` › What is still visible, where Cloudflare no longer sees page loads), **and commit.**

### Task 6: Infrastructure, the release contract and the deploy

**Files:**
- Create: `infra/confidential-space/README.md`, the runbook, trimmed to what we use.
- Create: `infra/confidential-space/setup.sh`, idempotent gcloud with an explicit `--project` throughout. It sets up:
  - the KMS key ring `alcove`, the symmetric key `alcove-master` and the asymmetric signing key `alcove-image-signing` (`EC_SIGN_P256_SHA256`);
  - the Workload Identity pool and provider, with the attestation condition from Decision 2, and the KMS bindings for that principal set;
  - the runtime service account `alcove-cs` (Secret Manager accessor on exactly the secrets in `SECRETS`, Cloud SQL client, log writer, Artifact Registry reader);
  - the static IP, firewall rules (80 and 443 from anywhere; Google's health-check ranges), the HTTP health check on port 80 `/health`, the regional backend service and forwarding rules for 80 and 443;
  - the instance template and the MIG `alcove-api`.

  `setup.sh staging` makes the same with a `-staging` suffix and its own IP.
- Create: `infra/confidential-space/deploy.sh <image@digest> <env>`, which makes a new instance template and runs a rolling update (surge 1, unavailable 0), then waits until the group is stable.
- Create: `infra/confidential-space/verify-server.ts <origin>`, which runs the same checks as Task 4's `verifyServer` (sharing its code: put that code in `packages/api` or a small shared module, whichever the folder map allows). CI runs it after every deploy.
- Modify: `.github/workflows/deploy.yml`:
  1. build and push the image;
  2. `cosign sign --key gcpkms://…/alcove-image-signing -a commit=<sha> --tlog-upload=true` (cosign at a pinned version);
  3. `cosign verify` against Rekor;
  4. the `alcove-migrate` job (keyless, unchanged);
  5. `deploy.sh`;
  6. `verify-server.ts`.

  Remove the Cloud Run API deploy, the flags job and the Pages publish. Remove `deploy.yml`'s Pages-only variables from the docs too.
- Modify: `infra/README.md`, `docs/engineering/deployment-and-acceptance.md`, `docs/engineering/logging-and-errors.md` (where logs land) and AGENTS.md (the web app's hosting line).

- [ ] **Step 1: Shellcheck and dry-run.** Run `shellcheck infra/confidential-space/*.sh`. Run `bash -n`. Run `setup.sh --dry-run`, which prints every gcloud command without running it. Run `verify-server.ts` against a local server started with the fakes.
- [ ] **Step 2: Lint the workflow** with `actionlint` if available. Otherwise check it carefully by hand against the old one.
- [ ] **Step 3: Update the docs and commit.**

### Task 7: Docs sweep (lead)

Update the product overview's status table, `system-architecture.md`, `deployment-and-acceptance.md`, `logging-and-errors.md` (where logs go now), AGENTS.md (the web app's hosting), and `infra/README.md`.

## Ops (lead only, in order)

- **O1.** Create the signing key, and pin its public key in the app.
- **O2.** Run `setup.sh` for production and staging, once the quota allows.
- **O3.** Staging:
  1. Clone `alcove-db` to `alcove-db-staging`.
  2. Deploy the branch's image to the staging MIG, with `LEGACY_SECRETS`, demo sign-in and the staging bucket.
  3. Point `staging.` and `api.staging.` at the staging IP (Cloudflare, DNS-only).
  4. Expect `owners rewrapped` with `failed: 0, remaining: 0`, a verified attestation from `verify-server.ts`, and a smoke flow (sign in, schedule, call, notes).
  5. Delete the clone and the staging resources.
- **O4.** Ask the user, then switch production:
  1. Merge, so the deploy brings up the production MIG with `LEGACY_SECRETS`.
  2. Wait for `remaining: 0`.
  3. Move the Cloudflare records for the apex, `www` and `api` to the static IP, DNS-only.
  4. Check `verify-server.ts` against production.
  5. Scale Cloud Run's `alcove-api` to zero.
- **O5.** After the user confirms:
  1. Deploy with `RETIRE_LEGACY_KMASTER=true` and no `LEGACY_SECRETS`.
  2. Delete `alcove-kmaster` and `alcove-kservice` from Secret Manager.
  3. Delete the Cloud Run service, the flags job and the Pages project.
  4. Plan the follow-up migration that drops `owners.root_envelope`.

## Changes from the Confidential Space runbook (these override the tasks above where they differ)

1. **The load balancer.** It's a regional external **proxy** Network Load Balancer (Envoy) with the PROXY protocol (v1), not a passthrough one. The Confidential Space production image has no guest agent to add a route for a passthrough VIP.
   - The container stays unprivileged, in the default root mode with host networking.
   - The edge listener parses the PROXY v1 line before TLS. It sets `x-forwarded-for` to exactly that client address, replacing anything the client sent, so `clientAddress()` in `apps/api/src/http/context.ts` keeps working unchanged.
   - The health check is plain HTTP on port 80, `/health`, and must answer 200 with no redirect.
   - The backend service's timeout is 3600 s, so live streams aren't cut after the default idle time.
2. **The attestation token is shared, not per browser.** Google allows 5 attestation requests a second per project per region, and each token costs two.
   - The API holds one PKI token, refreshed when it's 10 minutes old. Tokens last an hour.
   - Its nonces are `spki:<base64url SHA-256 of the TLS key's DER SubjectPublicKeyInfo>` and `commit:<40 hex>`, plus `alcove:attestation:v1`. Each is 10–74 bytes. Match them by prefix, not position.
   - The audience is `API_URL`.
   - `GET /v1/attestation` takes no nonce.
   - Contract (owned by Task 4):
     - `{ tee: 'none', build: { commit } }`;
     - `{ tee: 'confidential-space', build: { commit }, tls: { spkiSha256 }, token }`, where `spkiSha256` is base64url;
     - in api-http, `trust.attestation(): Promise<Attestation>`.
   - The browser requires `iat` within the last 20 minutes and `exp` in the future.
3. **What the browser checks.**
   - The PKI chain: `x5c[2]` must equal the pinned root, compared by SHA-256 of the DER `14:8B:29:38:…:6C:39`, valid until 2034-01-16. Then leaf → intermediate → root, then RS256 with the leaf.
   - The claims:
     - `iss` is `https://confidentialcomputing.googleapis.com`;
     - `aud` is the API origin;
     - `swname` is `CONFIDENTIAL_SPACE`;
     - `dbgstat` is `disabled-since-boot`;
     - `hwmodel` is `GCP_INTEL_TDX`;
     - `STABLE` is in `submods.confidential_space.support_attributes`;
     - `submods.container.image_reference` starts with `us-central1-docker.pkg.dev/alcove-solutions/alcove/api@`;
     - `image_signatures` contains our key.
   - The commit nonce is self-asserted, so Rekor is what maps digest to commit: the entry must be signed by our key, for that digest, with `commit=<sha>`.
   - What isn't covered: a browser can't see its own TLS key, so `spki:` is checked by `verify-server.ts` (CI) and by Certificate Transparency. The CAA record pins issuance to Let's Encrypt with our ACME account URI. The account key is derived inside the TEE, so only the TEE can get certificates. Application-layer encryption to a key from the TEE is the documented next step, not part of this change.
4. **The app stays the same.** No new gates or screens. The existing trust state (`verifiedAt` and the "hardware verified" copy) becomes the full check. A failed check shows the existing unverified state and blocks nothing.
5. **Secrets.** Provider secrets are read from Secret Manager with the **attested federated identity** (the WIF principal set), not the VM's service account. The VM's service account keeps only image pull, log writing and the Cloud SQL client. `SECRETS` env carries names only, and no secret goes in Dockerfile `ENV`, because all env appears in claims, and the launcher logs claims on every refresh.
6. **Signing.** Use cosign **v2** (pinned). The launcher only reads legacy `sha256-<digest>.sig` signatures. The KMS policy condition is on `image_signatures` in the provider's attribute condition, untested. If that fails in staging, fall back to an image-digest condition that CI updates on each deploy.
7. **The MIG is zonal** (`us-central1-a`), so `maxSurge=1` works. A monthly scheduled workflow rolls the MIG onto the newest Confidential Space image. Google cuts off tokens for old images (GCP-2026-071).
8. **Pinned files**, for implementers to copy into the repo where the folder map says:
   - our signing key's public key (`alcove-image-signing`, Cloud KMS `us-central1/alcove`);
   - Rekor's public key;
   - the Confidential Space root CA.

   The lead hands their paths over.

## After review (these override everything above where they differ)

1. **The release comes from the API.** No browser asks Rekor: the API looks its own release up (`findRelease` in
   `@alcove/api-http/release`, from its token's image digest and its commit), checks it, keeps it, and looks again with
   each token. `/v1/attestation`'s Confidential Space answer gains `release` (the entry's body, times, log ID and index,
   signed entry timestamp and inclusion proof with its checkpoint), and `verifyServer` checks it offline, exactly as it
   checked a fetched one. Rekor is gone from the CSP and from "What leaves the browser".
2. **Root keys.** Outside a TEE only `root_envelope` is written and read, under `KMASTER`. Inside one, a
   `root_envelope_v2` that doesn't open falls back to `root_envelope` while the old master is held, and is wrapped again;
   the bulk pass does the same, and retiring refuses while any such account is left. A master is made again over
   accounts wrapped under a lost one only when every one of them has its old envelope and the old keys are given.
3. **The old master is used only while `LEGACY_SECRETS` is set**, which the attestation shows: started without it, the TEE
   ignores what the bundle carries.
4. **`SECRETS` may name only** `DATABASE_URL`, `OBJECTS_ACCESS_KEY`, `OBJECTS_SECRET_KEY`, `LIVEKIT_API_KEY`,
   `LIVEKIT_API_SECRET`, `NEAR_AI_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_SIGNUP_TESTERS` and
   `CLOUDFLARE_API_TOKEN`.
5. **The bundle carries the photo token key** beside the index key: photos' URLs are kept in notes. The other keys the
   master makes seal or sign nothing that's kept.
6. **The carried `KSERVICE` must open billing** before it's sealed.
7. **Feature flags hash addresses under `flag-email`**, a purpose of their own, and check the signed-in person's address
   from their opened profile.
8. **The edge** streams files 64 KiB at a time, caches hashed `/assets/*` for a year, arms Node's HTTP/1.1 header and
   request timeouts and a 2-minute idle timeout, and matches `_headers` patterns across line breaks.
9. **The attestation token** is asked for again once it's 5 minutes old and never handed out at 15; the launcher is given
   30 seconds, doubling to 5 minutes, after it fails. `verifyServer` allows its clock skew on the token's age, requires the
   purpose nonce, and requires project number `745505907878`. The app shows a server it can't ask as not verified.
