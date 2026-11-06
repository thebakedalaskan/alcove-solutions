# Stack and Provider Setup

[MVP guide](../README.md) · [Roadmap](../delivery/roadmap.md) · [Stack and setup](stack-and-provider-setup.md)

> **Note (November 2026):** written for the earlier desktop design (documents, chat, a meeting bot). The product is now Alcove, private calls with built-in notes; see [docs/README.md](../README.md). Provider details here (NEAR AI, Phala, 1Click, R2) remain the reference. Speech is no longer a local engine: Alcove transcribes and writes notes with NEAR AI Cloud, as described in [Notes and inference](../engineering/notes-and-inference.md).


This is the concrete implementation register for the MVP. Engineering pages use these profile IDs; this page names the selected providers and packages. Primary-source research was checked on 1–2 November 2026. These are candidate pins, not a tested lockfile. No software build, deployment, paid request, transaction or meeting was performed by this documentation work.

## Core stack

| Profile | Selected candidate | Primary source and precise scope |
| --- | --- | --- |
| `CL01` | Tauri 2: Rust crate 2.12.5, tauri-build 2.7.4, API/CLI 2.12.4 | [Rust crate](https://crates.io/api/v1/crates/tauri/2.12.5), [build crate](https://crates.io/api/v1/crates/tauri-build/2.7.4), [API package](https://registry.npmjs.org/@tauri-apps/api/2.12.4), [CLI package](https://registry.npmjs.org/@tauri-apps/cli/2.12.4). Published component patch versions differ; actual compatibility is untested. |
| `CLUI01` | React/React DOM 19.3.1, TypeScript 7.0.2, Vite 8.3.5, React plugin 6.1.2 | [React](https://registry.npmjs.org/react/19.3.1), [DOM](https://registry.npmjs.org/react-dom/19.3.1), [TypeScript](https://registry.npmjs.org/typescript/7.0.2), [Vite](https://registry.npmjs.org/vite/8.3.5), [plugin](https://registry.npmjs.org/@vitejs/plugin-react/6.1.2). Bundled desktop assets only. |
| `CL-MAC` | macOS 15+ arm64 reference installation; Rust 1.90.0 and Xcode 26.1.1/Swift 6.2.1 candidate build tools | [Rust release](https://blog.rust-lang.org/2025/09/18/Rust-1.90.0/), [Apple tool requirements](https://developer.apple.com/xcode/system-requirements). Runtime minimum and build-host requirements differ; record the actual tested machine/tool tuple. |
| `R01` | TypeScript ESM, Node.js 24.22.1, Fastify 5.12.7, pg 8.23.1 | [Node archive](https://nodejs.org/en/download/archive/v24.22.1), [Fastify](https://registry.npmjs.org/fastify/5.12.7), [pg](https://registry.npmjs.org/pg/8.23.1). This Node candidate meets the inspected inference package's explicit minimum. |
| `D01` | PostgreSQL 17.11 | [Version policy](https://www.postgresql.org/support/versioning/), [transactions](https://www.postgresql.org/docs/17/transaction-iso.html), [row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html). Ordinary transactional correctness is assumed; SQL is not an anti-host-rollback authority. |
| `O01` | S3-compatible ciphertext objects; Cloudflare R2 deployment candidate | [API compatibility](https://developers.cloudflare.com/r2/api/s3/api/), [consistency](https://developers.cloudflare.com/r2/reference/consistency/). Verify the actual write/read/delete/backup paths; compatibility is a subset. |
| `L01` | SQLite 3.54.1 with application encryption; rusqlite 0.41.1 | [SQLite releases](https://www.sqlite.org/download.html), [FTS5](https://www.sqlite.org/fts5.html), [native binding](https://crates.io/api/v1/crates/rusqlite/0.41.1). Explicitly select/verify the engine; the binding's default bundled engine need not match. |
| `N01` | ProseMirror model 1.25.12, state 1.4.4, view 1.42.9 | [Model](https://registry.npmjs.org/prosemirror-model/1.25.12), [state](https://registry.npmjs.org/prosemirror-state/1.4.4), [view](https://registry.npmjs.org/prosemirror-view/1.42.9), [model documentation](https://prosemirror.net/docs/ref/#model). Use fixed full JSON revisions and application validation. No CRDT dependency is selected. |
| `PEX01` | Python 3.13.18 with pypdf 6.21.4 for text PDF extraction | [Python release directory](https://www.python.org/ftp/python/3.13.18/), [pypdf metadata](https://pypi.org/pypi/pypdf/6.21.4/json), [extraction limits](https://pypdf.readthedocs.io/en/stable/user/extract-text.html). TXT/MD use strict text decoding. Scanned PDF OCR and general office parsers are outside this parser profile. |
| `E02` | intfloat/multilingual-e5-base revision `d128750597153bb5987e10b1c3493a34e5a4502a`; sentence-transformers 6.2.0, transformers 5.22.1, torch 2.15.0 | [Model card](https://huggingface.co/intfloat/multilingual-e5-base), [publisher metadata](https://huggingface.co/api/models/intfloat/multilingual-e5-base), [embedding package](https://pypi.org/pypi/sentence-transformers/6.2.0/json), [transformers](https://pypi.org/pypi/transformers/5.22.1/json), [torch](https://pypi.org/pypi/torch/2.15.0/json). Choose CPU artifacts compatible with the confidential image, freeze weights/tokenizer and run a dimension/prefix fixture. No job-time downloads. |

`I01` selects **NEAR AI Cloud**, `@nearai/inference-sdk` **0.2.1**, source commit `8c66d8e2fdea4e99b277201a9ea5e05ea8295ff1`. Initial `I01M` model candidate: `z-ai/glm-5.3-flash`. Use the stock prepared E2EE helper, a buffered response and an in-memory response-decryption closure. Actual supported model/parameters/pricing and encrypted response route must be checked at build. See [Source evidence](source-evidence.md) for the exact public exports, API contracts and proof limits.

`C01` selects **Phala Cloud Intel TDX / dstack** for the confidential API and a separate confidential meeting VM. `P01` selects **NEAR Intents 1Click** for credit top-ups ([1Click as built](#1click-as-built)). These are accepted provider trust boundaries. Their supported interfaces still need correct implementation and actual integration evidence.

## Meeting and speech stack

| Profile | Exact selection | Candidate pin and primary source |
| --- | --- | --- |
| M01 browser | Ordinary Google Chrome stable for Linux amd64 | `google-chrome-stable=156.0.8078.79-1`; [official apt package index](https://dl.google.com/linux/chrome/deb/dists/stable/main/binary-amd64/Packages). Recorded package SHA-256 `be1a1e161419f5c8272432f6860912550d8e29985e925913fa800493a0d0c955`; verify signed repository metadata and actual bytes during build. |
| M01 controller | `puppeteer-core` | `25.16.0`; [release](https://github.com/puppeteer/puppeteer/releases/tag/puppeteer-core-v25.16.0), [launch API](https://pptr.dev/api/puppeteer.launchoptions). Its published browser roll differs slightly from the apt patch; test compatibility with the selected ordinary browser. |
| M01 display | X.Org Xvfb | `xorg-server 21.1.25`; [official archive](https://xorg.freedesktop.org/releases/individual/xserver/xorg-server-21.1.25.tar.xz). Use authenticated Unix display access and `-nolisten tcp`; no host display mount. |
| A02 audio | PulseAudio and libpulse | `17.0`; [release archive](https://www.freedesktop.org/software/pulseaudio/releases/), [pinned stream header](https://github.com/pulseaudio/pulseaudio/blob/v17.0/src/pulse/stream.h), [asynchronous API](https://www.freedesktop.org/software/pulseaudio/doxygen/async.html). |
| A02 codec | FFmpeg native libraries | `8.1.3`; [downloads](https://ffmpeg.org/download.html), [source tag](https://github.com/FFmpeg/FFmpeg/tree/n8.1.3), [send/receive codec API](https://ffmpeg.org/doxygen/8.0/group__lavc__encdec.html). Baseline needs FLAC encoding/decoding and resampling, not a general network-capable media service. |
| S02 speech | whisper.cpp, CPU-only | `v1.9.5`, commit `d1be6fde11ac6e0407606b4e42fe72d34add8037`; [release](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.5), [exact native header](https://github.com/ggml-org/whisper.cpp/blob/d1be6fde11ac6e0407606b4e42fe72d34add8037/include/whisper.h). |
| S02 model | `ggerganov/whisper.cpp`, `ggml-large-v3-turbo.bin` | Revision `5359861c739e955e79d9a303bcbc70fb988958b1`; metadata size `1624555275` bytes; SHA-256 `1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69`; [pinned tree](https://huggingface.co/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1), [metadata](https://huggingface.co/api/models/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1?recursive=false). Verify downloaded bytes, model license and exact parser compatibility. |

The meeting VM runs the ordinary browser, isolated audio daemon, native recorder and local CPU speech engine. Reference sizing is 8 vCPU / 16 GiB; capacity and transcription latency must be measured. The single supported route is a guest-enabled Google Meet with explicit owner consent, visible participant and host admission.

## Confidential runtime and build tooling

| Profile | Concrete MVP candidate | Primary reference and remaining build check |
| --- | --- | --- |
| C01 | Phala Cloud Intel TDX and dstack 0.6.1 candidate | [dstack 0.6.1 release](https://github.com/Dstack-TEE/dstack/releases/tag/v0.6.1). Hosted OS/KMS availability and current advisories must be checked before deployment; this source tag is not a hosted machine measurement. |
| C01 SDK | `@phala/dstack-sdk` package 0.6.0 from dstack v0.6.1 source | [Tagged package manifest](https://raw.githubusercontent.com/Dstack-TEE/dstack/v0.6.1/sdk/js/package.json). Resolve source commit, package build and actual integrity; do not substitute an unrelated registry package by matching a label. |
| C01 verifier | `@phala/dcap-qvl` 0.7.0 | [Maintainer release](https://github.com/Phala-Network/dcap-qvl/releases/tag/v0.7.0). Configure accepted TCB/collateral policy and test the page-02 evidence binding. |
| C01 deploy tooling | `phala` 1.1.22; `@phala/cloud` 0.4.0 | [CLI publisher record](https://registry.npmjs.org/phala/1.1.22), [SDK publisher record](https://registry.npmjs.org/@phala%2fcloud/0.4.0). CLI executable is `phala`; SDK and in-guest dstack SDK have different responsibilities. |
| Build containers | Docker Buildx 0.38.1 and BuildKit 0.34.1 | [Buildx release](https://github.com/docker/buildx/releases/tag/v0.38.1), [BuildKit release](https://github.com/moby/buildkit/releases/tag/v0.34.1). Lock actual driver, base-image, frontend and builder digests. |

`WAL01` selects Sender's desktop browser extension through Wallet Selector 10.1.4 at source commit `b532bcd7bacbe3027f7392b3ac8eb002ddacc19d`, using the native app's temporary loopback bridge and exact `signMessage` payload. Package/API, wallet-signing return checks and final outcome contracts are in [Source evidence](source-evidence.md); actual selected wallet/route compatibility remains Not run.

### 1Click as built

Credit top-ups call 1Click's REST API directly (`apps/api/src/payments/oneclick.ts`, no SDK) at `ONECLICK_BASE_URL`
(default `https://1click.chaindefuser.com`), sending `X-API-Key: ONECLICK_API_KEY` (the partner JWT from
partners.near-intents.org) when it is set, and `User-Agent: alcove-api`, with a 15 s timeout. Top-ups are off unless
`TREASURY_INTENTS_ACCOUNT` is set. Without the key 1Click still quotes and swaps the same way, adding its own fee
(about 0.013% on USDC on Base when checked on 6 November 2026, against 0.01% with a key); a key that is set but wrong is
refused (401), which makes top-ups unavailable.

- `GET /v0/tokens`: intersected with the allowlist of USDC and USDT asset IDs, each with its decimals pinned (checked
  5 November 2026 and again 6 November: 18 for the BNB Chain stablecoins, 6 for the rest), cached for 10 minutes; a
  route listed with other decimals isn't offered and is logged at error. A failure is remembered for 30 s.
- `POST /v0/quote`: `swapType: FLEX_INPUT` (any deposit from the quote's `minAmountIn` up is swapped in full),
  `depositType: ORIGIN_CHAIN`, `originAsset` the route's asset, `amount` the price of the credits chosen in the
  token's smallest unit (the response's `amountIn` must equal it and its `minAmountIn` be within 1.5% below it, its
  `quoteRequest` must repeat what was asked, and its `deadline` be between 1 hour and 7 days away, or the top-up is
  refused as unavailable and logged at error; `amountIn` and `minAmountIn` are kept; a `depositAddress` handed out
  before is refused the same way),
  `destinationAsset` USDC on NEAR (`nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`),
  `recipient` and `refundTo` the treasury with `recipientType` and `refundType` `INTENTS`, `slippageTolerance: 100`,
  `deadline` 24 hours ahead (1Click sets its own, later one: 3 days out when checked on 6 November 2026; the
  response's `deadline` is the one used), `dry: false`. The whole response, signature included, is kept sealed for disputes.
- `GET /v0/status?depositAddress=…` (and `depositMemo`): the status; while open, `swapDetails.depositedAmount` when
  it's there (what arrived so far, shown on a `short` deposit); on `SUCCESS` or `REFUNDED` the `swapDetails`
  (`depositedAmount`, `amountOut`, `refundedAmount`, `intentHashes`) that are credited. The status's `quoteResponse`
  must be this deposit's quote: its `quote.depositAddress` and `depositMemo` ours, its `quoteRequest` the treasury as
  `recipient` and `refundTo` (both `INTENTS`), the route's `originAsset` and USDC on NEAR as `destinationAsset`.
  `depositedAmount` and `refundedAmount` are read in the token's pinned decimals and `amountOut` in USDC's 6; each
  above 0 must come with, and equal, 1Click's own `…Formatted` value (`depositedAmountFormatted` always, the
  `amountOutFormatted` of a `SUCCESS`, the `refundedAmountFormatted` of a `REFUNDED`). `amountOut` plus
  `refundedAmount` must be at least 98.5% of `depositedAmount`, which must be above 0 and at most 8,000 USD; the first
  intent hash may settle one deposit only. If any of this fails nothing is credited, it's logged at error once, and
  the deposit stays `arriving` until it fails at the deadline and reaches support. A status Alcove doesn't know
  keeps the deposit as it is until the deadline, where it fails.
- **No webhook.** Alcove polls: every 10 s for a deposit's first 15 minutes, every minute until 2 hours, then every
  5 minutes (a cancelled one every 5 minutes throughout) until 24 hours after its address expires, when it's asked a
  last time (6 hours later, once, if it can't answer then, and hourly after that until it does); a minute after an
  error. A failed, expired or cancelled deposit is asked hourly until 30 days after its address expired, and is
  credited if 1Click settles it then. A `SUCCESS` or `REFUNDED` whose `swapDetails` don't read counts as still
  arriving. A quote's `depositMemo` may be missing, null or empty: all mean no memo.
- **Fees** (checked against live quotes, 5 November 2026): 0.01% on stablecoin pairs with a partner key (without one
  1Click adds 0.25%), taken out of what reaches the treasury; Alcove absorbs it, crediting by what was sent. Withdrawing from the Intents balance costs
  a flat 0.004615 USDC each time, so the treasury withdraws in batches
  ([Payments and usage › Treasury runbook](../engineering/payments-and-usage.md#treasury-runbook)).

## Setup order and required configuration

| Step | Configure and record | Completion evidence |
| --- | --- | --- |
| 1. Reference desktop | macOS 15+ arm64 reference machine; actual Rust, Xcode, native bridge, key-store, bundled UI and signing configuration | Installed artifact digest and tested desktop/tool tuple |
| 2. Provider accounts | C01 confidential-compute account; I01 supplier account and manually funded usable capacity; P01 partner key and the treasury's NEAR Intents account | Access check without exposing secrets; confirmed supplier capacity and the treasury account |
| 3. Build lock | Workspace/package/native lockfiles, base-image references, model revisions, actual digests and immutable API/meeting images | Successful builds and dependency/native/model manifest |
| 4. Ciphertext stores | Private D01 database and O01 bucket; scoped credentials; daily backup with seven-day retention | Write/read/conditional/delete/restore checks; no public bucket or content logging |
| 5. C01 deployment | API and meeting application IDs, accepted OS/node/instance configuration, measurements, verified channel/key binding, distinct service-seal paths | Actual attestation and permitted secret bootstrap; invalid evidence rejected |
| 6. Sign-in and keys | Google and Microsoft OAuth clients and the OIDC SSO configuration; `KMASTER` released only to the attested API VM | Verified sign-in, session expiry, cross-owner and ciphertext tests |
| 7. I01 route | Canonical model ID, approved endpoint, SDK/source integrity, request/receipt handling, supplier funding and deadlines | Actual protected request, cited usable answer and truthful expense/verification state |
| 8. P01 top-ups | `TREASURY_INTENTS_ACCOUNT` (and `ONECLICK_API_KEY` for the lower fee); the allowlisted routes still listed in `/v0/tokens` | Real supported SUCCESS outcome linked to its top-up; once-only credit and retry checks |
| 9. Meet route | Guest-enabled meeting permission, visible attendee name, actual browser/media egress, frozen source selectors and local speech image | Host-admitted actual remote audio, stop/leave, timed encrypted transcript and import |
| 10. Release rehearsal | The linked engineering acceptance checklist and MVP task dependencies | Real purchase → documents → paid chat → actual meeting → cross-source answer → private receipt/storage inspection |

Credits are bought at the tiers in [Payments and usage › Pricing](../engineering/payments-and-usage.md#pricing): 10 USDC buys 10,000 credits. Retail credits remain separate from supplier funding.

Secrets belong in native protected storage or the verified confidential bootstrap/service seal. Never paste provider credentials, wallet material, content or private accounting into Notion, build arguments, ordinary environment files or logs. Exact deployment, native cryptography, media build and provider recipes are in [Source evidence](source-evidence.md).

## Implement against the contracts

Use [Deployment and acceptance](../engineering/deployment-and-acceptance.md) for repository/build order, runbooks and the demo evidence gates. Use [Build plan](../delivery/build-plan.md) and [MVP tasks](../delivery/tasks.md) to assign work. Source documentation does not mark a task complete; all implementation and live-provider evidence starts **Not run**.
