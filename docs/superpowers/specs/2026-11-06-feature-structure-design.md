# Feature ownership overhaul

Implement issue #144 against main `04e377b9c44899c817d9c8f9b4f696441662a8fa`. The user authorized starting the overhaul and explicitly requested agent rules that prevent the structure drifting back.

The goal is locality: a maintainer can find a feature's implementation, contracts, client code and integration coverage, and entry points compose coherent behavior. Use the existing pnpm/Turborepo, TypeScript, React, Hono and integration-test stack. The target map and ongoing rules are in `docs/engineering/folder-ownership.md`, written before any source moves.

Preserve package roles, runtime behavior, routes and public exports, contract schemas, sealed record/header/key formats, migrations and all stored data. Keep owner/room checks, rate and body limits, request logging, physical deletion, LiveStore ownership and the existing query layer. No database resets, compatibility shims, arbitrary file-size targets, new dependencies or new isolated/browser tests. Existing historical migrations never change. The user's supplied rules also prohibit adding Storybook files or tests; existing Storybook consumers must continue to compile.

Deliver source organization and substantive extractions together: web media/notes/room/capture lifecycle; server feature routes and call state/MLS/notes responsibilities; client transport/session/feature implementations and feature-owned contracts. Keep worker and deployment entry paths stable. Colocate feature integration suites and preserve CI timing/discovery.

Add root and scoped agent instructions plus an automated structure policy wired to local checks and CI. Enforce objective ownership/package/entrypoint rules; leave responsibility quality to review. Preserve the full strength of existing test/type/privacy enforcement.

Validate the unmodified baseline separately, then run `pnpm check` for the completed source stage, check every old import/path consumer, compare discovered integration cases, review all extracted behavior for semantic equivalence, and manually inspect affected composition when practical. Report limits accurately. No merge, deployment or issue closure is part of this work.
