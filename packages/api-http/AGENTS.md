# Browser client ownership

Read root rules and `docs/engineering/folder-ownership.md`.

- `index.ts` exposes the deliberate public exports and composes `createHttpApi`. Request/response parsing and
  NDJSON belong in `transport`; feature factories return the existing feature interface from `AlcoveApi`.
- Call-session polling, MLS/keys and cleanup belong in `calls`; workspace/document streams and media in
  `workspaces`. Preserve lazy document imports and one owner for timers, cancellation and subscriptions.
- This package depends on contracts and browser libraries, never app internals or visuals. Every response still
  parses through the existing contract schema. Keep safe diagnostic paths and request-ID error propagation.
- Import internal owning files directly. No folder barrels, old-path forwarding files, extra public internal
  exports or a second implementation hidden behind a compatibility flag.
- Structural moves preserve method behavior, headers, errors, timing, state snapshots and cleanup. Validate
  through the real API/client integration suite; no isolated client/function tests.

- Agent-connection management belongs in `src/agents`, composed by the root factory like the other feature APIs.
- Checking the server belongs in `src/trust`: the attestation call and `verifyServer`, which the app, Storybook's
  stand-in and CI's `infra/confidential-space/verify-server.ts` all run. It runs in browsers and Node alike, so it uses
  only WebCrypto, `fetch` and zod, and its trust anchors (`pins.ts`) are options a caller can replace, never a flag.
  `verifyServer` fetches nothing: the release's entry in Sigstore's public log comes with the attestation. Finding that
  entry (`findRelease`) is in `trust/release.ts`, which the API imports as `@alcove/api-http/release`, the one entry
  besides `index.ts`: keep that file to the log, its checks and its pins, so the API takes nothing else of the client.
