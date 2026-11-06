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
