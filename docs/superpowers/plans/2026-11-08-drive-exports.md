# Google Drive call exports implementation plan

**Goal:** Complete [issue #170](https://github.com/thebakedalaskan/the-privacy-suite/issues/170): automatic, explicitly authorized exports of finalized call artifacts to a chosen Google Drive folder.

**Architecture:** `AlcoveApi.drive` is the public contract. Notes own export configuration, the independent Google authorization flow and the durable worker; existing maintenance opens the exporting owner's keys for each job. Google receives readable copies only after authorization and artifact readiness are checked again.

**Constraints:** Forward-only additive migration; existing records remain readable. Integration tests through the real HTTP client, real Postgres and object storage, with Google fixtures only at the provider boundary. No browser or component test suites. No raw credentials, content or destination metadata in logs or database columns. Existing Settings and note-page patterns and Storybook scenarios remain the UI reference.

## Work and verification

- [x] Inspect existing ownership, key access, Google authorization and note finalization.
- [x] Define contracts in `packages/api/src/notes/drive.ts`, compose `AlcoveApi.drive`, and implement schema-parsed HTTP methods in `packages/api-http/src/notes/drive.ts`.
- [x] Implement notes-owned connection, validated folder references, defaults and per-note overrides; add migration `0020_drive_exports.sql`.
- [x] Implement finalized-artifact discovery, durable jobs, pre-generated provider IDs, reconciliation, bounded retries and cleanup. Original retained recording segments export as a ZIP64 archive; finalized notes as Markdown and transcripts as text. Regeneration updates the existing exported file.
- [x] Extend the Google fixture and public API integration flows for consent, folder grants/shared drives, independent connection, artifact readiness, retry/uncertainty, cross-owner and guest refusal, source/destination loss, ciphertext/log leakage and physical deletion.
- [x] Build Settings connection/defaults/job status and note-specific overrides from the existing design kit. Extend Storybook's stand-in and numbered journeys.
- [x] Run structure, test, strict-type and migration guards; all package typechecks, integration tests and builds. Manually inspect phone/wide and light/dark states through Storybook.
- [ ] Independently review the change, resolve findings, open the PR, wait for required checks, squash merge and verify the deployed commit and public health.

## Acceptance risks

- A call ending is not proof of artifact readiness; failed and absent artifacts must never export.
- Consent and source authorization are checked when work runs, after a restart and before a retry.
- A request whose response is lost must reconcile the persisted provider ID rather than create another file.
- A folder removed or made unwritable must fail visibly and never fall back to another destination.
- Private participant notes and unauthorized recording material must not enter a shared export.

## Release evidence

All 1,228 integration tests passed, each once, verified with `scripts/ci-tests.mjs check` over the three full-suite runners and refreshed Drive/guest/account-deletion reports. The 23 Drive and 15 guest flows passed together with no skips. Structure, strict typing, test and migration guards, all seven package typechecks, and API/web/Storybook builds passed. Independent review findings were resolved and re-reviewed. Settings and per-call controls were manually inspected at desktop and phone widths in light and dark, including shared-folder selection.

Drive and Picker APIs, the `drive.file` consent declaration and production/local callbacks have been configured. With the account holder's explicit approval, real Google consent and its folder picker were completed against an isolated local account and made-up call content. All three selected files uploaded to a new private test folder; Google Drive listed the Markdown, transcript and ZIP, and the Markdown opened readably in Google's editor with private sharing intact. Inference in this verification used the test fixture; Google authorization, folder validation and uploads used Google's real service.

Main's presenter timers and participant-leave changes were integrated, preserving their behavior and immutable `0019_timer_presets.sql`. The Drive migration is `0020_drive_exports.sql`; combined Drive/timer/guest/account-deletion and privacy flows, all package typechecks and production builds passed after integration. PR checks, merge and deployment are the remaining release steps.
