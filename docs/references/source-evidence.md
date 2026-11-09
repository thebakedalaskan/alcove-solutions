# Source Evidence

[MVP guide](../README.md) · [Roadmap](../delivery/roadmap.md) · [Stack and setup](stack-and-provider-setup.md)

> **Note (November 2026):** written for the earlier desktop design (documents, chat, a meeting bot). The product is now Alcove, private calls with built-in notes; see [docs/README.md](../README.md). Provider details here (NEAR AI, Phala, 1Click, R2) remain the reference. Speech is no longer a local engine: Alcove transcribes and writes notes with NEAR AI Cloud, as described in [Notes and inference](../engineering/notes-and-inference.md).


Primary sources for the selected MVP stack and integration contracts. Research was checked on 1–2 November 2026. This page records what the sources support and what the implementation still has to demonstrate. It is not evidence that this application has been built or that any confidential deployment, live meeting or payment has run.

The concrete profile/version table and account setup checklist are in [Stack and provider setup](stack-and-provider-setup.md).

## Desktop and CS01 primitives

Tauri's [capabilities](https://v2.tauri.app/security/capabilities/) and [CSP](https://v2.tauri.app/security/csp/) documentation support the bounded native bridge and bundled renderer design. They do not prove that an arbitrary plugin, unsafe native command, or compromised webview cannot expose secrets. The reference app must test its actual configured origin and permission scopes.

Apple's [keychain accessibility](https://developer.apple.com/documentation/security/restricting-keychain-item-accessibility), [when-unlocked this-device-only](https://developer.apple.com/documentation/security/ksecattraccessiblewhenunlockedthisdeviceonly), and [user-presence access](https://developer.apple.com/documentation/localauthentication/accessing-keychain-items-with-face-id-or-touch-id) support the selected native key-item design. macOS accessibility behavior requires the data-protection keychain configuration. [Secure Enclave key documentation](https://developer.apple.com/documentation/security/protecting-keys-with-the-secure-enclave) does not make software Ed25519 seeds hardware-native; the MVP describes them as protected native key-store values.

`CS01` uses [RFC 8785 canonical JSON](https://www.rfc-editor.org/rfc/rfc8785.html), [RFC 8032 Ed25519](https://www.rfc-editor.org/rfc/rfc8032.html), [RFC 7748 X25519](https://www.rfc-editor.org/rfc/rfc7748.html), [RFC 5869 HKDF](https://www.rfc-editor.org/rfc/rfc5869.html), and [RFC 9180 HPKE](https://www.rfc-editor.org/rfc/rfc9180.html). XChaCha20-Poly1305 is the selected maintained AEAD construction; it is not represented as a final IETF Standards Track RFC. Challenge signatures, record headers, exporter contexts, sequencing, and lifetime policy are new application protocol work and need interoperability/negative tests.

| Runtime | Candidate cryptographic packages |
| --- | --- |
| Service | `canonicalize` 5.1.0; `@noble/curves`, `@noble/ciphers`, `@noble/hashes` 2.4.0; `@hpke/core` 1.8.0 and `@hpke/dhkem-x25519` 1.7.0. [Canonicalizer release](https://github.com/erdtman/canonicalize/releases), [curves release](https://github.com/paulmillr/noble-curves/releases/tag/2.4.0), [ciphers](https://github.com/paulmillr/noble-ciphers/releases/tag/2.4.0), [hashes](https://github.com/paulmillr/noble-hashes/releases/tag/2.4.0), [HPKE releases](https://github.com/dajiaji/hpke-js/releases). Strict Ed25519 sets `zip215:false`; duplicate-aware parsing precedes canonicalization. |
| Native `CLCRYPTO01` | Rust `hpke` 0.14.1, `ed25519-dalek` 3.0.0, `chacha20poly1305` 0.11.0, `sha2` 0.11.1, `hkdf` 0.13.0, `getrandom` 0.4.3, `serde_jcs` 0.2.0, `zeroize` 1.9.1. [HPKE](https://docs.rs/crate/hpke/0.14.1), [signature](https://docs.rs/crate/ed25519-dalek/3.0.0), [AEAD](https://docs.rs/crate/chacha20poly1305/0.11.0), [SHA](https://docs.rs/crate/sha2/0.11.1), [HKDF](https://docs.rs/crate/hkdf/0.13.0), [randomness](https://crates.io/api/v1/crates/getrandom/0.4.3), [canonicalization](https://crates.io/api/v1/crates/serde_jcs/0.2.0), [zeroization](https://crates.io/api/v1/crates/zeroize/1.9.1). Select the classical HPKE suite explicitly and test strict rejection semantics across implementations. |

Zeroizing buffers reduce secret retention but cannot prove whole-process memory erasure. Published package versions do not remove the need for transitive dependency, license, and native target checks.

## Accepted confidential application provider

`C01` selects Phala Cloud Intel TDX with dstack source release 0.6.1. [dstack releases](https://github.com/Dstack-TEE/dstack/releases) document the selected security release. The [tagged SDK manifest](https://raw.githubusercontent.com/Dstack-TEE/dstack/v0.6.1/sdk/js/package.json) contains package version 0.6.0; registry equivalence is not assumed. Resolve an authenticated matching artifact or build the reviewed source with actual provenance. The verifier candidate is [dcap-qvl 0.7.0](https://github.com/Phala-Network/dcap-qvl/releases/tag/v0.7.0).

[Get Attestation](https://docs.phala.com/phala-cloud/attestation/get-attestation) accepts report data up to 64 bytes; the application therefore explicitly computes the 64-byte SHA-512 binding. [Verify Your Application](https://docs.phala.com/phala-cloud/attestation/verify-your-application) and [Chain of Trust](https://docs.phala.com/phala-cloud/attestation/chain-of-trust) support checking actual platform/configuration/application evidence. [Get a Deterministic Key](https://docs.phala.com/phala-cloud/key-management/get-a-key) returns raw key bytes to approved code; the service seal is not claimed nonexportable to that code. The deployment/provider/KMS remains an accepted trust boundary. Exact hosted versions, measurements, policy and seal behavior must be demonstrated on the actual demo deployment.

## Mandatory encrypted text inference

`I01` selects NEAR AI Cloud with `@nearai/inference-sdk` 0.2.1 at source commit `8c66d8e2fdea4e99b277201a9ea5e05ea8295ff1`. The [pinned package manifest](https://github.com/nearai/inference-sdk/blob/8c66d8e2fdea4e99b277201a9ea5e05ea8295ff1/js/package.json) requires Node `>=24.22.1`. The initial `I01M` canonical-model candidate was `z-ai/glm-5.3-flash` (the app now defaults to `deepseek-ai/DeepSeek-V4.1-Flash-1017`), as used in the [official JavaScript guide](https://docs.near.ai/cloud/inference-sdk/javascript); its availability, actual supported parameters/tokenizer/pricing and compatible encrypted response route must be checked at build.

Use the [E2EE protocol](https://docs.near.ai/cloud/guides/e2ee-chat-completions), [model attestation contract](https://docs.near.ai/cloud/verification/cloud-api/model-attestations), [response-signature contract](https://docs.near.ai/cloud/verification/cloud-api/response-signatures), [model catalog](https://docs.near.ai/cloud/models), and [versioned verification guide](https://github.com/nearai/inference-sdk/blob/8c66d8e2fdea4e99b277201a9ea5e05ea8295ff1/js/docs/verification-guide.md). These establish supported field encryption and evidence handling, not complete provider-fleet inventory, exclusive key ownership, semantic answer correctness, or arbitrary-endpoint E2EE. Current response kinds are `provider_tee` and `gateway`; verify each according to its own upstream message contract. A gateway receipt is accepted under the MVP provider-trust assumption and never presented as provider-TEE/model execution proof.

`I01D` is a thin supported-helper adapter. The pinned [public exports](https://github.com/nearai/inference-sdk/blob/8c66d8e2fdea4e99b277201a9ea5e05ea8295ff1/js/src/public.ts), [prepared type](https://github.com/nearai/inference-sdk/blob/8c66d8e2fdea4e99b277201a9ea5e05ea8295ff1/js/src/types/e2ee.ts), and [request helper](https://github.com/nearai/inference-sdk/blob/8c66d8e2fdea4e99b277201a9ea5e05ea8295ff1/js/src/core/e2ee-request.ts) show `prepareE2eeChatRequest` returning an encrypted request and decryption closure, not a public durable private-key export. The MVP uses that closure in memory and accepts explicit `answer_lost` after a crash. It does not require a vendored cryptographic patch or pretend a lost key can be recovered from ciphertext.

The [transport helper source](https://github.com/nearai/inference-sdk/blob/8c66d8e2fdea4e99b277201a9ea5e05ea8295ff1/js/src/node/attestation-client.ts), [cloud API source](https://github.com/nearai/inference-sdk/blob/8c66d8e2fdea4e99b277201a9ea5e05ea8295ff1/js/src/core/cloud-api.ts), and [verification types](https://github.com/nearai/inference-sdk/blob/8c66d8e2fdea4e99b277201a9ea5e05ea8295ff1/js/src/types/verification.ts) are the precise implementation starting points for actual TLS binding, fresh preflight, canonical models, receipt lookup and exact-byte verification. Retain source-license notices; do not import unstable private installed-package paths.

Provider-side [prompt caching](https://docs.near.ai/cloud/guides/prompt-caching) and [usage reporting](https://docs.near.ai/cloud/guides/usage-reporting) are separate trust and financial contracts. They are not proof of zero retention or zero expense after a failed answer. The payment and meeting sections below record their separate source contracts. No live paid request, transaction, recording, installation or deployment has been performed by this documentation work.

## Meeting media build and capture details

Build `whisper.cpp` at that exact commit, CPU-only with `GGML_CUDA=OFF`, `GGML_VULKAN=OFF`, `GGML_METAL=OFF`, `GGML_NATIVE=OFF`, static library and upstream tests enabled. The target CPU options still need an explicit build lock. Ship the verified model in the image; never fetch models in a private run. The model's size and upstream metadata are not evidence of memory use, inference speed or transcription quality in the selected confidential VM.

Build FFmpeg with networking/autodetection/programs disabled and only required libraries, the FLAC encoder/decoder/muxer/demuxer and selected PCM support. Application code provides bounded in-memory/described-file AVIO and rejects additional URL opens. Record the actual configure output and libraries in the release manifest. A complete FLAC stream is produced per chunk; the native API source and actual build determine correctness, not a filename extension.

Launch the ordinary browser with `headless:false`, `pipe:true`, an explicit executable and per-run private profile. Preserve its sandbox; do not add `--no-sandbox`, an externally reachable debugging port or TLS bypass. Inspect resolved default arguments to ensure playback is not muted. [Chrome enterprise policies](https://chromeenterprise.google/policies/) supply actual policy names; verify the effective configuration for the pinned browser.

The private audio daemon loads only Unix native protocol and the null-sink modules needed for `meet_remote` playback and a separate `meet_silence` microphone. It has no TCP/RTP/Bluetooth or host hardware modules. Set `PULSE_SINK=meet_remote`, `PULSE_SOURCE=meet_silence.monitor`; capture `meet_remote.monitor` explicitly with libpulse. `pa_stream_peek` holes are missing frames; the monitor's clock is guest playback, not the remote sender's capture clock.

## Actual source meeting boundary

[Google Meet guest joining](https://support.google.com/meet/answer/9303069?hl=en) supports the ordinary participant mechanism subject to organizer/account/administrator settings. It does not promise unattended automation compatibility. The MVP must prove its own visible guest admission and rendered remote audio in a guest-enabled call. [Meet encryption guidance](https://support.google.com/meet/answer/12387251?hl=en) describes the source service's media boundary; do not describe ordinary scheduled meetings as provider-blind merely because our attendee is confidential.

[Meet network requirements](https://knowledge.workspace.google.com/admin/meet/prepare-your-network-for-meet-meetings-and-live-streams?hl=en) describe signaling and media routes, including UDP 3478 and 19302–19309 and TCP/UDP 443. Freeze and test the exact egress policy needed for the supported guest journey; do not assume browser proxy settings fully mediate WebRTC. Source-service JavaScript/telemetry stays within its accepted source boundary and must never receive the owner's vault or recording keys.

[Meet release notes](https://developers.google.com/workspace/meet/release-notes) announced the Media API deprecation and permanent endpoint shutdown on 15 January 2027 in the reviewed 28 October entry. The ordinary browser route does not depend on that preview. The [REST overview](https://developers.google.com/workspace/meet/api/guides/overview) does not provide a replacement generic bot-join/raw-audio API. No hosted bot SaaS is included.

## P01 private payment integration

P01 is Confidential Intents through NEAR Intents 1Click, origin `https://1click.chaindefuser.com`. [Confidential swaps](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/confidential-swaps) distinguishes the embedded `CONFIDENTIAL_INTENTS` deposit/recipient/refund types from a foreign-chain confidentiality flag. [Private-network architecture](https://docs.near-intents.org/integration/market-makers/confidential-intents) describes its operator/validator boundary. The MVP accepts that boundary and does not claim cryptographic exclusion of every operator.

Reviewed build candidates are `@defuse-protocol/one-click-sdk-typescript@0.1.26` and `@defuse-protocol/intents-sdk@0.94.0`: [1Click package metadata](https://registry.npmjs.org/@defuse-protocol%2fone-click-sdk-typescript), [Intents package metadata](https://registry.npmjs.org/@defuse-protocol%2fintents-sdk). Pin transitive integrity and an API-schema snapshot at implementation. The 1Click quote-verifier requires the documented field serialization; do not rebuild a signature scheme from a brief description.

| Integration step | Primary source and actual field boundary |
| --- | --- |
| Partner/merchant authentication | [Authentication](https://docs.near-intents.org/integration/distribution-channels/1click-api/authentication): partner `X-API-Key` differs from owner bearer sessions. Access/refresh credential custody belongs inside C01. |
| Merchant authentication if needed | [Authenticate signed data](https://docs.near-intents.org/api-reference/user-auth/authenticate-user-with-signed-data): `POST /v0/auth/authenticate` with `{signedData}`; empty signed intents authenticate, not spend. Use the actual timestamped nonce builder and account key authority. |
| Exact asset setup | [Token catalog](https://docs.near-intents.org/api-reference/oneclick/get-supported-tokens): `assetId`, `decimals`, chain and symbol. Pick and test one same-asset private route, then freeze the actual asset ID/precision; price fields are not settlement amounts. |
| Executable quote | [Quote schema](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote): exact input atomic amount, private route types, recipient/refund destination and deadline; response includes deposit address and possible memo. |
| Payload generation | [Generate intent](https://docs.near-intents.org/api-reference/oneclick/generate-an-intent-for-signing): `{type:"swap_transfer",standard:"nep413",signerId,depositAddress}`; response `{intent,correlationId}`. No documented `depositMemo` generation request field. |
| Signature submission | [Submit intent](https://docs.near-intents.org/api-reference/oneclick/submit-a-signed-intent), [signed execution guide](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/signed-intent-execution): preserve exact signing payload and standard-dependent encoding; response `intentHash` differs from correlation ID. |
| Quote signature | [Quote verification](https://docs.near-intents.org/integration/distribution-channels/1click-api/verify-quote-signature): `verifyQuoteSignature()` authenticates documented covered fields. It is not a guarantee that arbitrary outer status/actual amounts are signed. |
| Final execution | [Status schema](https://docs.near-intents.org/api-reference/oneclick/check-swap-execution-status): stored address/memo lookup; `SUCCESS` and `swapDetails` actual atomic amounts. Test original quote/recipient/asset linkage and final amount semantics for the chosen route. |
| Conditional history lookup | [History](https://docs.near-intents.org/api-reference/account/get-transaction-history): invite-only; supports deposit filters and formatted amounts. Use only if needed by the selected provider outcome contract. Do not invent a globally unique merchant receipt event or atomic net field from the example. |
| Fees and real testing | [Fees](https://docs.near-intents.org/resources/fees), [quickstart](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/introduction): actual route quote controls fees; the guide says there is no testnet. This document did not authorize or execute a value transfer. |

## WAL01 desktop wallet signing bridge

WAL01 selects the **Sender desktop browser extension**, using `@near-wallet-selector/core` and `@near-wallet-selector/sender` **10.1.4**, as the one reference signing candidate. The reviewed repository commit is `b532bcd7bacbe3027f7392b3ac8eb002ddacc19d`; package versions were read from that commit, not inferred from a generic latest tag. The [pinned adapter setup](https://github.com/near/wallet-selector/blob/b532bcd7bacbe3027f7392b3ac8eb002ddacc19d/packages/sender/README.md) documents `setupWalletSelector` with `setupSender`. Build locks must record actual package tarball integrity and the tested installed extension version before qualification.

The [pinned Sender adapter](https://github.com/near/wallet-selector/blob/b532bcd7bacbe3027f7392b3ac8eb002ddacc19d/packages/sender/src/lib/sender.ts) detects `window.near.isSender` and forwards `signMessage` to the injected wallet, returning its `response` or rejecting an error. The [pinned interface](https://github.com/near/wallet-selector/blob/b532bcd7bacbe3027f7392b3ac8eb002ddacc19d/packages/sender/src/lib/injected-sender.ts) defines that response; [core types](https://github.com/near/wallet-selector/blob/b532bcd7bacbe3027f7392b3ac8eb002ddacc19d/packages/core/src/lib/wallet/wallet.types.ts) define the `message`, `recipient`, 32-byte nonce, optional callback/state and returned account/public-key/signature fields. Use `signMessage`, not the adapter's unsupported `signNep413Message` method.

[NEP-413](https://github.com/near/NEPs/blob/master/neps/nep-0413.md) specifies the signing structure, prefix, SHA-256 step and full-access account key requirement. Its optional callback URL is inside the signed payload. Therefore preserve the provider's exact optional-field presence and use the extension's Promise response; do not append an app return URL to the generated intent. The product's one-use loopback return described in Payments is our local transport, not an upstream intent field. The wallet itself remains the owner's signing boundary; no wallet key or transaction-access key is requested by the product.

Source inspection proves interface availability only. Real approval from the chosen installed extension, loopback-origin permissions, selected mainnet account, exact nonce and signature encodings, and provider acceptance remain **Not run** and must be demonstrated before the payment journey passes.

## I01 supplier cost and funding boundary

[Costs by request IDs](https://docs.near.ai/api-reference/billing/get-costs-by-request-ids) documents `POST https://cloud-api.near.ai/v1/billing/costs`, body `{requestIds:[...]}`, response `requests:[{requestId,costNanoUsd}]` and warnings. The identity is `inference-id` or the documented response-body-ID derivation, not transport `x-request-id`. Unknown IDs can produce zero with a warning; delayed or uncertain expense remains unknown.

[Usage reporting](https://docs.near.ai/cloud/guides/usage-reporting) documents read-only organization reporting tokens and paginated `GET /v1/organizations/{org_id}/usage/export`. Preserve stable row identity and avoid counting both aggregate cost lookup and its detailed rows. [Cloud terms](https://near.ai/terms-of-service) and the [API index](https://docs.near.ai/llms.txt) are setup references for an ordinary supported operator supplier account; they do not establish a private merchant-balance automatic top-up API. Manual prefunding is acceptable for this MVP, and its actual confirmed provider capacity is checked separately from customer credits.

All real-route receipts, wallet fixtures, browser-admission recordings, compiled/model digests, throughput results, confidentiality checks and paid request reconciliation are **Not run** in this documentation task.

## Exact confidential deployment recipe

The repository `deploy:render` validates the candidate and produces compose files containing only immutable image references, nonsecret configuration and explicit security policies. These CLI commands are the documented adapter mapping for an operator implementing `deploy:apply`; they were not executed. Authentication is established on the trusted deployment workstation through the supported login/profile path, not by putting a token in command arguments. The [authentication reference](https://docs.phala.com/phala-cloud/phala-cloud-cli/auth) directs callers to `phala login` and `phala status`.

```sh
phala --version
phala status
phala instance-types cpu --json
phala os-images --json

phala deploy --name "$MVP_C01_NAME" \
  --compose "$MVP_C01_COMPOSE_PATH" \
  --kms phala --image "$MVP_C01_OS_IMAGE" \
  --instance-type "$MVP_C01_INSTANCE_TYPE" --node-id "$MVP_C01_NODE_ID" \
  --disk-size "$MVP_C01_DISK_SIZE" \
  --pre-launch-script "$MVP_C01_PRELAUNCH_PATH" \
  --no-dev-os --no-public-logs --no-public-sysinfo --wait

phala deploy --cvm-id "$MVP_C01_APP_ID" \
  --compose "$MVP_C01_COMPOSE_PATH" \
  --kms phala --image "$MVP_C01_OS_IMAGE" \
  --instance-type "$MVP_C01_INSTANCE_TYPE" --node-id "$MVP_C01_NODE_ID" \
  --disk-size "$MVP_C01_DISK_SIZE" \
  --pre-launch-script "$MVP_C01_PRELAUNCH_PATH" \
  --no-dev-os --no-public-logs --no-public-sysinfo --wait
```

The first deploy creates an application; the second shows an explicit update of its observed ID. Run the applicable operation separately for API and meeting-worker applications. Variables above are nonsecret references resolved by the release renderer, never real values supplied by this document. Check the pinned executable's help/output schema before applying: [deploy reference](https://docs.phala.com/phala-cloud/phala-cloud-cli/deploy), [instance inventory](https://docs.phala.com/phala-cloud/phala-cloud-cli/instance-types), [OS inventory](https://docs.phala.com/phala-cloud/phala-cloud-cli/os-images.md). Inventory is account-specific and the instance command is documented as unstable. Capture the accepted OS, application, configuration and observed measurement; successful deployment is not sufficient to release a secret.

## Key and credential bootstrap mapping

Only the C01 service supervisor mounts `/var/run/dstack.sock`; contained parsers, speech children and the source browser must not inherit that socket or related open descriptors. The SDK's `DstackClient.getKey(path)` derives an application-specific key used to seal the permitted service material. Choose distinct versioned paths for API accounting/provider secrets and meeting run-wrapper state. Derivation output never enters a log or ordinary host file. Changing a derivation path is not revocation of a previously exposed root. These interfaces are described by [Phala key derivation](https://docs.phala.com/phala-cloud/key-management/get-a-key).

`getQuote(reportData)` accepts at most 64 bytes. The MVP computes the exact page-02 binding bytes and verifies returned quote/event log/configuration plus its accepted application policy before sending private material; it does not use an empty report-data demo endpoint. [Attestation interface](https://docs.phala.com/phala-cloud/attestation/get-attestation).

The encrypted environment facility encrypts client-side and updates the complete set. `@phala/cloud` exposes `updateCvmEnvs`; its stock convenience API does not replace the application's recipient-verification step. The bootstrap script must verify and bind the exact recipient or use the application's attested encrypted bootstrap and seal inside the guest. Do not pass secrets through `phala deploy -e KEY=value`, a plaintext `.env`, build args or infrastructure state. The provider expressly documents plaintext retention in Terraform auto-encryption state. [Encrypted environment documentation](https://docs.phala.com/phala-cloud/cvm/set-secure-environment-variables).

Routine application/operator interfaces expose only sealed envelopes and content-free results. The trusted bootstrap and approved-release administrator can affect which code receives a key; their role, plus provider KMS behavior, is an accepted MVP assumption. The implementation must not advertise resistance to those trusted actors becoming malicious.

## Build, installation and storage validation sources

Use the frozen workspace install and explicitly reviewed native build steps. [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci) documents lockfile-consistent installation. Build production inputs without unreviewed install scripts, then run required reviewed native generation in a build stage. [Build secrets](https://docs.docker.com/build/building/secrets/) and [build provenance](https://docs.docker.com/build/metadata/attestations/slsa-provenance/) explain why provider credentials must not be build arguments. Build outputs record actual sources and hashes; they need not imply an independently reproduced build.

For the reference native artifact, configure the existing macOS signing identity from protected key-store access and build the bundled payload. The controlled packaging job may invoke the project's pinned `tauri build --target aarch64-apple-darwin --bundles app,dmg`; actual signing/notarization credentials and outputs are private. Tauri documents the Developer ID identity and notarization choices in [macOS signing](https://v2.tauri.app/distribute/sign/macos/) and the bundle in [macOS application distribution](https://v2.tauri.app/distribute/macos-application-bundle/). A local development signature is not evidence of notarized distribution; record which signed artifact was actually installed for the demo.

D01 backup verification uses the selected engine's supported mechanisms: [base backup](https://www.postgresql.org/docs/17/app-pgbasebackup.html), [backup verification](https://www.postgresql.org/docs/17/app-pgverifybackup.html) and [continuous archiving](https://www.postgresql.org/docs/17/continuous-archiving.html). Ordinary restore assumes trusted store administration. Seven-day retention and one daily snapshot are project choices requiring actual expiry evidence. O01 [lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/) and [limits](https://developers.cloudflare.com/r2/platform/limits/) must be checked against immutable referenced chunks and their actual configured cleanup behavior; provider ETags do not replace application authentication hashes.

## Evidence still to produce

The implementation must generate actual build locks/digests, tested desktop/native seal behavior, C01 inventory and verified app/key evidence, scoped secret bootstrap results, ciphertext storage/private-bucket checks, supplier prefunding and capacity evidence, canary inspections, real P01 SUCCESS plus once-only credit, actual protected paid chat debit and actual authorized Google Meet audio/transcript. These are the finite MVP delivery gates. Source documentation supports the chosen interfaces; it does not complete any gate.
