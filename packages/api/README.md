# @alcove/api

The contract between the Alcove frontend and its backend. The web app only ever talks to an
`AlcoveApi`, so swapping the mock for the real backend changes one line of configuration.

- `src/types.ts` holds the domain models (meetings, notes, calls, credits).
- `src/client.ts` holds the `AlcoveApi` interface and the live-session interfaces
  (`CallSession`, `RoomRecording`) used for anything that streams.
- Implementations live in `@alcove/api-mock` (in-browser, seeded fixtures) and
  `@alcove/api-http` (REST + WebSocket against the real service).

Rules for implementations:

1. Every method returns plain JSON-serialisable data. No class instances.
2. Errors are thrown as `AlcoveApiError` with a stable `code`.
3. Live sessions push full state snapshots to subscribers. The UI never patches state itself.
