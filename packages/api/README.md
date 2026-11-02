# @alcove/api

The contract between the Alcove frontend and its backend. The web app only ever talks to an
`AlcoveApi`; every type here is a zod schema, so the client validates everything the server sends.

- `src/types.ts` holds the domain models (meetings, notes, calls, credits) as zod schemas.
- `src/wire.ts` holds HTTP-only shapes shared by client and server (passkey ceremonies, call actions).
- `src/client.ts` holds the `AlcoveApi` interface and the live-session interfaces
  (`CallSession`, `RoomRecording`) used for anything that streams.
- The implementation is `@alcove/server` (apps/api); the browser client is
  `@alcove/api-http` (REST, NDJSON streams and raw audio uploads).

Rules for implementations:

1. Every method returns plain JSON-serialisable data. No class instances.
2. Errors are thrown as `AlcoveApiError` with a stable `code`.
3. Live sessions push full state snapshots to subscribers. The UI never patches state itself.
