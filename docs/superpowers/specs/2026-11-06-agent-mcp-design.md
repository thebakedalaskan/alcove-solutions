# Agent access and MCP

## Outcome

A person connects an MCP client to Alcove, explicitly chooses permissions, and can then ask their agent to find and manage their notes, follow-ups and calls. A connection is a revocable delegation of that person's existing access. It is never an administrator, a browser session, or a new route around note-sharing rules.

The user requested both this specification and its end-to-end implementation. Implementation choices below are the builder's decisions. They do not claim a separate product approval or a production deployment.

## Connection experience

- The remote Streamable HTTP endpoint is `$API_URL/mcp`. Use the official TypeScript SDK, a new server per HTTP request, and JSON responses. Clients using initialize use its JSON-enabled WebStandard transport; current discovery uses its request handler with subscriptions disabled. Neither path keeps a stream of account keys alive.
- Browser linking uses OAuth authorization code with PKCE S256. A client registers its name and exact redirect URIs, discovers the authorization server, and opens its authorization endpoint. Alcove directs the browser to `/connect?request=<random-id>`. After ordinary sign-in, the person sees the client's untrusted name, requested capabilities, the content disclosure, and Allow / Cancel. Nothing is granted before Allow.
- Settings has an Agents section listing connections, permissions, expiry, last use, and Disconnect. It also creates a named personal token for clients that accept an Authorization header, shown once with Copy. Tokens expire in 1–90 days (30 by default). An OAuth connection expires after 30 days.
- The disclosure says: “Your agent can receive readable information from Alcove. Its provider handles that information under its own policies.” Permissions to share or delete are separate choices, never implied by reading or editing.
- Connected clients operate independently of browser sign-out. Disconnect and account deletion end their access immediately on the next request. Disconnect physically deletes the delegation and its credentials.
- Consent preview identifies the current account from the server, and the decision explicitly binds that owner ID. If another tab switches accounts before Allow, the server refuses the stale approval; it never grants access to an account different from the one shown.

## Permissions

The exact scope names are `notes:read`, `notes:write`, `notes:share`, `notes:delete`, `meetings:read`, `meetings:write`, and `calendar:read`. Read permissions are the default for a personal token. An OAuth request names its scopes; the person may grant a subset, never a superset. Empty or unknown scopes are refused.

Every tool checks the scope before reading content or making a change. Tool discovery exposes only the granted tools. Permissions are checked afresh on every HTTP request. Resource IDs are opaque IDs returned by tools; no tool accepts an account/owner ID. Shared-note access is evaluated at the time of every operation, including transcript retention and changes to sharing. A scope never gives more rights than the person has in Alcove.

Write results are minimal acknowledgments and opaque resource IDs (and the call link for a created call). Never return the domain module's full Note/Meeting/PersonalNotes result: a write-only connection must not gain read access through a mutation response or a retry. Reading the changed content requires its read scope and a separate read tool.

## Tool surface

Names use snake_case and concrete descriptions. Inputs reuse the contract's zod schemas; opaque IDs and bounded search text are validated. Lists take bounded `limit` and `offset`, return items and `nextOffset`, and have deterministic order inherited from their domain API. Responses include structured JSON and a text representation for existing clients. Read and destructive annotations reflect actual side effects.

| Scope | Tools |
| --- | --- |
| `notes:read` | `list_notes`, `get_note`, `ask_note`, `ask_notes`, `get_inbox`, `get_personal_notes` |
| `notes:write` | `propose_decision`, `update_decision`, `propose_action`, `update_action`, `update_question`, `correct_transcript`, `rewrite_note`, `add_personal_note`, `edit_personal_note`, `remove_personal_note` |
| `notes:share` | `share_note` |
| `notes:delete` | `delete_note` |
| `meetings:read` | `list_meetings`, `get_meeting`, `find_people` |
| `meetings:write` | `schedule_call`, `update_call`, `cancel_call`, `answer_call`, `schedule_next_call`, `start_call` |
| `calendar:read` | `get_calendar`, `get_availability` |

Scheduling can send real Google Calendar invitations when connected; descriptions say so. No tool connects Google, changes account settings, creates credentials, joins a live call, starts recording, accesses raw audio/screen images, or edits workspace documents in this version. Those are independent permissions and flows. Calls return their usable Alcove links beside IDs.

Writes that can create duplicates (scheduling, instant calls, scheduling next calls, personal entries) accept a caller-generated 22-character base64url `operationId`. Reserve a durable pending operation before executing, keyed by owner, connection and operation ID, with a keyed commitment to canonical arguments. Serialize concurrent uses or safely refuse one still pending, and reject reuse with different arguments. Complete it with a sealed opaque result ID/link; retain it no longer than 24 hours or the grant's life. A crash after a domain commit can leave an uncertain pending operation: never rerun it blindly, return a conflict asking the agent to inspect current calls/notes first. This is duplicate prevention, not a promise of exactly-once external calendar delivery. Never retain copies of note contents, and recheck resource access on successful retries. Explicit-state updates remain naturally idempotent. Rate-limit expensive inference and all mutations, with bounded request size and execution time.

## OAuth and token requirements

- Issuer is configured `API_URL` without a trailing slash; resource/audience is exactly `$API_URL/mcp`. Never derive either from an untrusted Host header.
- Publish protected-resource metadata at `/.well-known/oauth-protected-resource/mcp` and authorization-server metadata at `/.well-known/oauth-authorization-server`. A 401 advertises the exact metadata URL. Metadata names authorization, token, registration, and revocation endpoints; grants `authorization_code` and `refresh_token`; token authentication `none`; S256; and supported scopes.
- Support dynamic public-client registration for interoperability with existing Codex/Claude and SDK clients. Store bounded client metadata sealed; allow HTTPS redirect URIs, or HTTP only on loopback. No credentials or fragments. Require exact redirect equality, with RFC8252's port exception only for IP-literal loopback callbacks. Do not fetch arbitrary client metadata URLs or claim CIMD support in this version.
- Authorization requests have random 256-bit opaque IDs, ten-minute lifetime, encrypted client/redirect/resource/state/challenge/scopes, and no account until approved. A logged-in person's browser may inspect one only for consent. Invalid clients or redirects are refused locally and never redirected. Cancel returns `access_denied` only to a validated redirect.
- Codes are random 256-bit values, stored only as hashes, last at most 60 seconds after approval, and are consumed once in a database transaction. Bind to client, exact redirect, resource, approved scopes, and S256 challenge. Validate verifier syntax and compare its SHA256 in constant time. Return `iss` with authorization responses.
- Access tokens are opaque, hashed at rest, last at most one hour and never beyond their grant. Refresh tokens rotate on every use and last no longer than the fixed grant expiry. Consumed refresh hashes remain only until grant expiry to detect replay; replay revokes the entire grant. Invalid clients, wrong audiences, expired/replayed codes, and scope escalation fail closed.
- Revocation accepts a bearer token in the request body, validates its client where supplied, physically deletes the grant and all token hashes, and returns no existence oracle. Personal tokens have no refresh token.
- Never put access/refresh tokens in URLs, logs, browser storage, or operation receipts. Browser token creation and consent routes are cookie-authenticated, Origin-checked mutations excluded from general response receipts. Token and authorization responses use `Cache-Control: no-store` and `Pragma: no-cache`.

## Architecture and storage

Add contract schemas in `packages/api/src/agents.ts`, plus `AlcoveApi.agents`, the HTTP implementation and the stand-in implementation. Browser methods are `list`, `createToken`, `revoke`, `authorization`, and `decide`. Inputs and outputs must be zod parsed. Keep the app's backend boundary and queries module.

Browser routes: `GET /v1/agents`, `POST /v1/agents/tokens`, `DELETE /v1/agents/:id`, `GET /v1/agents/authorization/:id`, `POST /v1/agents/authorization/:id`. Public OAuth routes live under `/oauth`; MCP is outside `/v1`. Existing cookie authentication and CSRF policy remain in place.

Backend responsibilities:

- `agents/contracts`: the API contract above. A connection has id, name, kind (`token` or `oauth`), scopes, createdAt, expiresAt, nullable lastUsedAt. Token creation returns connection, token and endpoint. Consent preview returns clientName, scopes and expiry. Decision returns a validated redirect URL.
- `modules/agents.ts` (split storage/OAuth if warranted): encrypted delegations, credential verification, issuance, consent, refresh, revocation and cleanup. Export `authenticateAgent(d, token): Promise<AgentPrincipal>` with `{ owner: Owner, connection: AgentConnection }`; `requireScope(principal, scope): void`. `resourceUrl(d): string` returns the canonical MCP audience.
- `mcp/server.ts`: HTTP gate and official SDK. Authenticate before SDK parsing; only Bearer credentials, no cookie fallback. Check a present Origin against the configured web/API origins, allow absent Origin for native clients, and reject an unexpected Host except test/development loopback transport. Bound bodies to 64 KiB; unsupported methods return 405. Wipe request-owned key arrays after the complete JSON response is produced.
- Request cancellation never wipes keys under a domain operation still using them. The SDK receives a 90-second abort signal; an operation already running finishes within its existing database/provider deadlines before key disposal. This is not a forced 90-second mutation rollback.
- `mcp/tools.ts`: tool registration around existing `modules/notes`, `meetings`, `calendar`, `people` and the personal-note routes' helpers. Use domain functions that enforce access; never reach encrypted manifests or use internal server readers. Sanitize every exception before the SDK can expose its message. Log structured IDs, tool name, duration, outcome and request ID, never input/output or credential material. Return safe `isError` results for application failures.

Add a forward-only migration after 0016. Grant rows are account-owned with cascade deletion; token and operation rows reference their grant with cascade deletion. Global OAuth client/request metadata is sealed with a distinct `serviceKey(..., 'agents')`; grant metadata uses an owner state key and header `{v:1,kind:'agent-grant',ownerId,grantId}`. New OAuth client/request/operation record headers bind every storage location. Only opaque IDs, hashes, timestamps, expiry and protocol states are clear. Metadata has finite expiry, row counts and rate limits; maintenance physically removes expired rows. Existing data remains readable and the previous API release keeps serving throughout migration.

## Verification and delivery

Use real API HTTP and the official MCP client against real Postgres/object storage; no browser, component or unit tests. Sign in through the real application flow. Exercise token creation, metadata/discovery, scope-filtered tools, note reads/mutations/sharing, schedules/updates/cancellation, idempotency under concurrency, OAuth consent/PKCE/token/refresh/replay, disconnect, cross-account/foreign IDs, sharing removal, expiry, two API instances, account deletion, and canaries absent from database/object/log dumps. Include invalid requests and privacy-safe internal failures.

Run the repository's policy guards, typecheck, integration tests and build. Check UI light/dark and narrow/wide by manual browser inspection only. Provide a short setup guide for Codex OAuth, Codex bearer-token configuration and generic SDK clients. Do not silently edit a user's global MCP configuration or store their new token in a committed file. Local verification does not claim production deployment or that a live account has been connected.

Primary references: [SDK HTTP](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md), [authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), [tools](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/tools.md), [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
