# Server feature ownership

Read root `AGENTS.md`, `docs/engineering/folder-ownership.md`, `docs/engineering/privacy-keys-and-sessions.md`
and `docs/engineering/logging-and-errors.md`.

- Choose `account`, `agents`, `meetings`, `calls`, `notes`, `recordings`, `workspaces` or `billing` as the owner.
  Add a distinct owner only with an updated map, these rules and the structure policy. Never recreate `modules/`.
- Feature HTTP registration belongs with the feature. `app.ts` composes registrars and shared HTTP infrastructure;
  it contains no feature handlers. Preserve registration order around public, guest-readable, signed-in and
  operation-receipt phases. Shared rate-limit budgets must remain the same app-scoped instances.
- A module exposes coherent behavior with explicit dependencies. Keep persistence/state, participant access,
  MLS relay, notes/insights, room-board lifecycle and capture cleanup with their actual owners. Import those
  files directly rather than forwarding every export through a service or folder index.
- Colocate complete API/client integration flows here as `*.integration.test.ts`. Cross-feature/service-wide
  suites belong in `src/integration`; reusable fixtures belong in `src/testing`. Preserve assertions, real
  Postgres/object-store usage and CI timing keys when moving a suite.
- Shared database, crypto, ownership/session, object store, logging, inference/attestation and worker machinery
  keep deliberate shared homes. Do not duplicate them per feature or hide them in an undifferentiated utils folder.
- Moving source never changes SQL scope, persisted headers/key labels, schema defaults, migrations, physical
  deletion, safe logging/error contexts, authorization or receipt behavior. Re-read the privacy rules for any change
  that stores data. Preserve worker URLs and server/migrate/limits/document-worker build outputs.
- Run the full `pnpm check` for a completed stage and record the moved/extracted-file map.
- Check graph indexing exclusions before concluding coverage is absent: `src/integration` can be skipped by the
  index. The Vitest/CI recursive source discovery and actual suites are authoritative for coverage.

- Agent grants, OAuth and MCP tools belong in `agents`, including its `mcp/` implementation and integration suites.
  Preserve the public OAuth/MCP registration phase and each tool's scope/owner enforcement; never colocate them under calls.
- A new feature shown to some people first goes behind a feature flag: `requireFeatureFlag(await featureFlagsFor(d, owner), name)` in each of
  its handlers ([docs/engineering/feature-flags.md](../../../../docs/engineering/feature-flags.md)).
