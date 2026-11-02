# Deployment and acceptance

[MVP guide](../README.md) · [Tasks](../delivery/tasks.md) · [Stack and setup](../references/stack-and-provider-setup.md)

This is the implementation runbook for the single-owner desktop MVP. It has not been executed. Required repository scripts below are work to implement; the existence of a command in this page is not evidence that an application, image or deployment exists. Exact suppliers, candidate versions, CLI recipes and primary sources live in [Stack and Provider Setup](../references/stack-and-provider-setup.md). Implementation uses the API and key contracts in engineering pages 01–06 without introducing another protocol.

The release must deliver one installed desktop client, encrypted files and editable pages, cited contextual chat, one qualified authorized M01 meeting, and one real P01 prepaid purchase followed by a charged chat. C01, I01 and P01 are accepted provider trust boundaries. Supported attestation, channel and key checks remain mandatory; the demo does not require proving safety against a malicious trusted provider or malicious database rollback.

## 1. Repository and build outputs

Use one repository with these responsibilities. File names are required implementation interfaces, not files already created by this specification.

| Path | Responsibility |
| --- | --- |
| `apps/desktop/` | Bundled UI, library/editor/chat/meeting/balance screens and typed native bridge; no remotely supplied application JavaScript |
| `apps/desktop/src-native/` | Installation identity, native seal, cryptography, encrypted local draft/journal and channel verification |
| `apps/edge/` | Opaque encrypted transport, bounded ciphertext upload and content-free health checks |
| `services/confidential-api/` | Owner authentication, documents, protected extraction/retrieval, chat, billing and bounded job dispatch modules |
| `services/meeting-worker/` | One-run attendee supervisor, source browser, private software audio sink, recorder and encrypted recording spool |
| `packages/contracts/` | Canonical request/result/failure schemas, bounds and generated client types from engineering pages 02–06 |
| `packages/native-crypto/` | Shared protocol vectors and native cryptographic adapter; no UI key export |
| `packages/editor-schema/` | Shared bounded structured-document node/mark validation and source locator rules |
| `packages/provider-adapters/` | Fixed C01, I01, P01, D01 and O01 adapters; no arbitrary destination supplied by a model |
| `infra/images/`, `infra/compose/`, `infra/policies/` | Locked images, local and C01 deployment definitions, parser/browser/network policies |
| `infra/migrations/`, `infra/config/` | Reviewed transactional schema migrations; local and demo configuration schemas |
| `scripts/`, `tests/` | Operational entrypoints, isolated fixtures, contract/integration/leakage and real-demo suites |

Produce three immutable server images: `opaque-edge`, `confidential-api` and `meeting-worker`. The API image includes selected document/extraction/embedding binaries and model artifacts. It runs constrained children, not arbitrary shell tools. The meeting image includes the exact source browser, controller, software display/audio components, recorder and S02 speech binary/model. No package, browser, model or tokenizer download occurs at boot or in response to owner content. Produce one bundled signed desktop artifact for the reference platform. Installation signing and native key behavior must be checked on the actual demo machine.

`release.json` records source revision, dependency-lock hashes, actual desktop/image digests, native/model artifact hashes, configuration-policy hash and supported platform tuple. `environment.json` records environment ID, C01 application and OS identifiers, accepted release reference, public origin, D01/O01 namespaces, provider-route/profile identifiers and secret-envelope generations. These files contain no credentials, owner material, meeting URLs or content. Missing actual artifact hashes prevent marking a candidate ready; copied example hashes are invalid.

## 2. Environment and resource profile

Keep `local`, `ci` and `demo` distinct. Local/CI use synthetic owners, provider fixtures and separate trust roots; they cannot enable paid provider routes. Demo uses actual C01 and provider accounts. A release report identifies which environment produced every result. An emulated attestation or fixture receipt is always labelled as such.

The starting capacity is deliberately one owner and one active meeting, with one heavy extraction or speech job at a time. These are sizing proposals to benchmark, not observed performance or promised provider SKUs.

| Unit | Starting envelope | Durable storage and scope |
| --- | --- | --- |
| Opaque edge | 1 instance, 1 vCPU, 1 GiB RAM | No plaintext persistence; bounded ciphertext buffers only |
| C01 confidential API | 1 instance, 8 vCPU, 16 GiB RAM | 40 GiB encrypted spool; 2 GiB bounded protected scratch; one heavy parser/embedding child; remaining memory budget includes model and OS headroom |
| C01 meeting worker | 1 separate VM per active run, 8 vCPU, 16 GiB RAM | 20 GiB physical ciphertext disk with page-05 per-run cap, bounded 1 GiB private browser/audio scratch; S02 gets six threads and at most 8 GiB; no historical vault key |
| D01 | 1 database instance, 2 vCPU, 4 GiB RAM | 20 GiB initial volume, ciphertext application payloads and transactional metadata |
| O01 | 1 private bucket | Immutable encrypted files, revisions, recording chunks and artifacts; no public endpoint |

Map each C01 envelope to an available supported SKU and record actual node/OS/application selection before deployment. A failed memory or real-time speech benchmark is resolved by explicitly changing this profile and rerunning the affected test. It is never resolved by moving speech or extraction to an ordinary host.

Disable guest swap, hibernation, core dumps, debugger servers, public logs and automatic crash uploads. Use a read-only image, non-root process users, dropped capabilities, process/file limits and no container-engine socket or host filesystem mounts. Private scratch is guest memory with explicit capacity limits; ciphertext may spool to persistent storage. Parser and speech children receive only their scoped inputs over restricted pipes/descriptors, have no network, and exit after the job. Browser isolation preserves the browser sandbox; launching without it is a failed build configuration. No owner desktop microphone or screen-recording permission is required for the attendee route. The desktop needs selected-file access and native key-store access; the meeting worker uses its own virtual display and audio route inside C01.

## 3. Configuration, secrets and first boot

Nonsecret configuration is schema-checked and included in the accepted deployment: `APP_ENV`, `SERVICE_ROLE`, `PUBLIC_ORIGIN`, `RELEASE_FILE`, `POLICY_FILE`, `DB_ENDPOINT`, `OBJECT_ENDPOINT`, `OBJECT_BUCKET`, provider profile IDs, permitted model ID and finite job limits. Configure hostnames explicitly; owner content cannot select endpoints. Runtime credentials are not environment values in checked-in files, image layers, ordinary hosting dashboards or infrastructure state.

Acquire these capabilities before enabling demo routes: C01 deployment/KMS account and quota; D01 restricted runtime and migration roles; O01 scoped bucket credential; I01 inference and available reporting access with funded capacity; P01 merchant/session access and configured supported asset/route; domain/TLS administration; reference-platform signing capability; and an authorized guest-enabled test meeting with a host able to admit the visible attendee. Record account references and scope in `infra/access.json`, never credential values. P01 merchant-history access is needed only if the selected provider contract requires it for the documented settlement lookup.

Bootstrap follows a fixed sequence:

1. Build locked artifacts; render exact deployment bytes with explicit OS, image digests and policies. Review the rendered C01 app configuration, supported key-release policy and access settings.
2. Deploy the empty C01 API and worker applications using their separate application identities. Verify actual attestation using the supported C01 verifier, expected application/measurement/configuration and the endpoint-key binding specified in page 02. Reject wrong application, image, role, key binding, invalid collateral or prohibited debug configuration.
3. On the trusted bootstrap workstation, verify the intended attested recipient before sending any credential. Transfer the complete scoped secret set over the authenticated encrypted bootstrap path. Retain only encrypted envelopes and generation references outside C01. Do not use command-line arguments, shell history, temporary plaintext files or infrastructure-variable mechanisms that preserve plaintext.
4. Inside C01, derive the application seal under the accepted application policy and seal service credentials, accounting secrets and protected restart material. The API and meeting applications use distinct seal namespaces. Routine operational interfaces manage encrypted envelopes and expose no plaintext retrieval. The trusted bootstrap/release administrator and provider key policy remain explicit trust assumptions. The worker receives only run-scoped control/recording material, never the owner vault root or merchant/inference credentials.
5. Apply reviewed D01 migrations with a temporary migration role, then remove that role from the runtime. Verify O01 private-access and immutable-write behavior. Start content-free health checks and synthetic channels before owner onboarding.
6. The installed desktop creates and locally seals its installation identity and vault key; setup pins its exported public identity for this single-owner deployment. It releases the vault key only to the verified API over the page-02 attested channel for active indexing/chat. No persistent general vault root is inserted into D01 or server secret storage.

The accepted provider's key-management and operator-control assumptions are recorded, including which provider or trusted bootstrap actor could defeat them. A direct encrypted bootstrap is required; it is not a claim that the provider cannot change its own trust boundary. A new image or key-affecting policy needs an explicit updated accepted configuration and repeated channel/key negative tests. No automatic mutable-tag update is allowed.

## 4. Persistence, network and paid admission

D01 stores ciphertext content, index payloads, transcripts and private payment metadata; plaintext columns are limited to the opaque identifiers, counters, states, timestamps and transactional uniqueness/lease fields specified in pages 03 and 06. Use separate runtime roles for content and accounting tables; accounting code receives opaque action IDs, units and costs, not content keys. O01 object names are random opaque identifiers. Backups contain ciphertext and encrypted service envelopes. Database encryption alone is insufficient: application encryption occurs before bytes leave C01 or the client.

The edge exposes only `GET /mvp/v1/runtime?nonce=...`, `POST /mvp/v1/session/open`, `POST /mvp/v1/channel`, `POST /mvp/v1/session/close` and aggregate `GET /healthz`. Private document, meeting and billing method strings remain inside encrypted channel bodies; file ciphertext uses that bounded transport. Enforce page-02 frame/aggregate limits and page-03 object/chunk limits at allocation and ingress; do not invent different proxy limits. Log only random request IDs, coarse route/status classes, duration/size buckets and error codes. Disable bodies, query strings, headers containing credentials, filenames, source URLs, model prompts and response snippets in every proxy and application logger. No public plaintext download or temporary preview URL exists.

Use ordinary validated TLS in addition to the application encrypted channel. C01 egress is constrained to configured D01/O01, supported verification metadata and explicit I01/P01 destinations. Parsers and speech children have no egress. The meeting VM permits only its source-meeting network and authenticated run-control/ciphertext-storage paths; it exposes no remote debugging or generic fetch proxy. Qualify the real source signaling/media route, including source redirects and reconnect behavior, while acknowledging that the source provider supplies live page code and already knows the meeting.

The owner credit ledger and the operator's supplier funds are different balances. Before a paid action, page 06's admission transaction reserves the bounded retail maximum and checks configured supplier capacity minus committed or uncertain exposure. An operator manually prefunds the supplier through its supported procurement flow, records the receipt/balance reference securely and configures a conservative capacity ceiling. Stale, exhausted or unknown capacity stops new paid work. It does not erase an owner credit balance or turn an uncertain provider cost into zero.

Persist the action identity and send-start transition before an external paid request. Disable automatic paid retries in client libraries, agents and proxies. Reconcile uncertain attempts read-only under their original identity. A purchase SUCCESS credits exactly once under page 06's unique settlement constraints; usage settles the actual supported debit separately from supplier cost. A meeting reserves its session/audio cap before join and capture. Stop, timeout and resource exhaustion finalize already captured encrypted chunks and report partial/unknown states honestly.

## 5. Required scripts and operational order

| Repository command | Required behavior |
| --- | --- |
| `npm run doctor -- --environment local` | Report exact tools, platform/key capability, memory/disk and missing prerequisites without fetching secrets |
| `npm run deps:verify` | Validate frozen package/native/model inputs and actual hashes; reject mutable or missing artifacts |
| `npm run contracts:check` | Generate and compare typed schemas, primitive vectors, bounds and package boundaries |
| `npm run local:up` / `npm run local:down` | Start/stop this repository's loopback-only fixture resources, preserving local encrypted drafts |
| `npm run local:seed -- --fixture mvp` | Create one synthetic owner, example files/pages and fixture financial states; reject demo roots and live provider destinations |
| `npm run db:migrate -- --environment NAME` | Apply explicit reviewed migrations with the migration role and content-free result |
| `npm run test:suite -- --suite NAME --evidence-dir PATH` | Emit pass/fail/blocked/skipped, source/build/config hashes and redacted evidence references |
| `npm run release:build -- --candidate ID` | Clean frozen build, desktop/image artifacts, hashes, dependency inventory and release manifest |
| `npm run deploy:render -- --environment demo --candidate PATH` | Produce exact configuration/compose/policy bytes without deployment or secret access |
| `npm run deploy:apply -- --environment demo --rendered PATH` | Deploy those immutable bytes through the C01 adapter; verify observed app/OS/image configuration |
| `npm run secrets:bootstrap -- --environment demo --recipient PATH` | Verify the attested recipient, read protected input without echo and persist only sealed envelopes |
| `npm run operate -- status\|drain\|rotate\|restore-check` | Typed target operations with content-free results; no arbitrary remote shell |
| `npm run demo:verify -- --candidate PATH --evidence-dir PATH` | Check the real authorized demo journey and its existing receipts; never silently purchase or join from an ordinary CI run |

The local sequence is doctor → dependency verification → contract checks → local resources → migrations → synthetic seed → desktop/API launch → suites. The demo sequence adds immutable builds, C01 deployment/verification, secret bootstrap, actual supplier pre-funding and route-specific authorization before live actions. Vendor CLI syntax belongs in the reference page so a source update does not silently change these repository command contracts.

The supported `test:suite` names are `native-channel`, `documents`, `chat`, `payments`, `meetings`, `canary`, `faults` and `restore`. Local/CI execution of a provider-dependent case is labelled fixture evidence. Real cases require the demo environment and an explicit test-case authorization record for the bounded external action; running the ordinary suite never silently opts into them.

Drain rejects new paid jobs, stops the attendee, checkpoints encrypted artifacts and waits a bounded interval for known work. Unfinished external actions stay uncertain for reconciliation. Rotation replaces a complete sealed secret generation after recipient verification; never print old/new values. Restore a backup into an isolated environment, check schema and encrypted object inventory, then reconcile uncertain payment/usage operations before enabling paid dispatch. This is an ordinary trusted-store recovery procedure, not protection from hostile rollback.

For this demo, take one encrypted D01 snapshot plus a referenced-object/secret-envelope inventory daily and retain seven days. Keep O01 originals referenced by a retained snapshot until that snapshot expires; then remove unreferenced objects with a verified cleanup pass. Active deletion follows page 03's 24-hour cleanup bound; the UI discloses that already-created ciphertext backups expire within seven days. Retention and restore evidence must record actual expiry behavior, including provider-managed copies. The configured one-owner retained-content quota still applies independently of the larger physical spool disks.

## 6. Acceptance and evidence

Each run records exact source/build/configuration, environment, test case, timestamp, outcome and protected evidence references. Public evidence uses synthetic content. All implementation evidence is currently **Not run**. A candidate is demo-ready only when all required rows below pass on that same candidate or have a documented unchanged artifact boundary.

| Suite | Required observation |
| --- | --- |
| Native identity and channel | Fresh install creates keys; lock/reopen works; wrong C01 app/image/key, replay and tampered frames reject before key release; UI cannot export native keys |
| Files and pages | Owner uploads the supported text/PDF formats, opens originals, replaces a file version, creates/edits/saves/reopens a page; stale expected-parent write preserves the draft and reports conflict |
| Contextual chat | An actual protected I01 answer uses selected source revisions and opens its citations; unauthorized/failed sources do not enter context; reservation and final debit are visible |
| Real payment | Owner signs the exact configured quote intent; authenticated P01 SUCCESS matches the purchase; duplicate observation credits once; one subsequent paid chat consumes the expected service debit |
| Actual meeting | Authorized host admits the visible guest into the qualified real M01 meeting; known spoken phrases yield recorded audio, timestamped transcript and contextual answer; stop/leave and any gaps are evidenced |
| Ordinary-storage canaries | Unique synthetic document, prompt, transcript, meeting URL and secret markers do not appear in edge logs, ordinary D01/O01 exports, backups, host temp files, crash output or diagnostics; ciphertext intentionally retained is identified |
| Fault handling | Interrupted upload/editor save, parser crash, source leave, provider timeout and crash after send-start yield the specified retry/conflict/partial/uncertain result without duplicate credit, blind paid retry or plaintext fallback |

The canary suite inspects the actual demo configuration, including logging agents, browser-profile/temp paths, model/parser scratch, process dumps and stored backups; a source-code search alone is insufficient. A speech process heartbeat is not proof of captured audio. A mocked SUCCESS is not proof of payment. A local suite is not proof of C01 deployment. The final demo report links the real purchase, exactly-once credit transaction, reserved/settled paid chat and actual meeting transcript without exposing private receipt material or content.
