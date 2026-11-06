# Connect agents to Alcove

Alcove exposes a remote MCP server at `$API_URL/mcp`. An agent acts with a person's explicitly granted permissions and their current Alcove access. Browser sessions and agent credentials are separate. This guide describes the implementation; it does not establish which commit is deployed.

## Connect with OAuth

Use the MCP URL of the environment you want. Production's configured URL is `https://api.alcove.solutions/mcp`; it is available only after this feature is deployed there. For local work with the normal web proxy it is `http://localhost:3000/api/mcp`.

In Codex CLI:

```sh
codex mcp add alcove --url https://api.alcove.solutions/mcp
codex mcp login alcove --scopes notes:read,notes:write,meetings:read,meetings:write,calendar:read
```

Sign in to Alcove in the browser that opens. Review the requesting client's name, the account, and each permission; press **Allow selected access**. Nothing is authorized before that step. If the client needs an explicit registration choice, `codex mcp login alcove --oauth-client-registration dcr` selects the supported public-client registration flow. Alcove does not fetch Client ID Metadata Documents or advertise CIMD support. Codex supports DCR when advertised ([official connection documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)).

Other clients that support Streamable HTTP and OAuth authorization code with PKCE S256 can use the same URL. They must send the exact MCP resource URL as `resource` during authorization and code exchange. Alcove publishes protected-resource and authorization-server metadata and allows HTTPS redirects or HTTP loopback callbacks. IP-literal loopback callbacks may vary their port; the host, path and query must still match.

OAuth access tokens last up to one hour. Refresh tokens rotate when used. The connection has a fixed 30-day expiry; sign in again to reconnect after that. Reusing an already-consumed refresh token revokes the entire connection, so clients must serialize refreshes and persist their replacement tokens safely.

## Connect with a personal token

1. In Alcove, open **Settings → Agents → Create a token**.
2. Name the connection, choose permissions and an expiry (1–90 days, 30 by default).
3. Copy the token from the one-time view into the client's private credential store. It cannot be displayed again.
4. Configure the same MCP URL and an `Authorization: Bearer <token>` header. Keep the value out of URLs, source files, screenshots and chat messages.

Codex can read it from an environment variable:

```sh
codex mcp add alcove --url https://api.alcove.solutions/mcp --bearer-token-env-var ALCOVE_AGENT_TOKEN
```

Set `ALCOVE_AGENT_TOKEN` through your shell or environment's secret store before starting Codex. Do not put its value in the command line or commit it. An equivalent configuration is:

```toml
[mcp_servers.alcove]
url = "https://api.alcove.solutions/mcp"
bearer_token_env_var = "ALCOVE_AGENT_TOKEN"
```

Keep credentials local to the intended account/environment. Connecting a new MCP server changes the tools available to subsequent client sessions; it does not prove this chat has connected a live account. Personal tokens do not refresh. If one is lost or disclosed, disconnect it and create another.

## Tools and permissions

Discovery lists only the tools that the connection is allowed to use. Permissions do not bypass note sharing, transcript retention, organizer rights, or personal-entry ownership.

| Permission | Tools |
| --- | --- |
| `notes:read` | `list_notes`, `get_note`, `ask_note`, `ask_notes`, `get_inbox`, `get_personal_notes` |
| `notes:write` | `propose_decision`, `update_decision`, `propose_action`, `update_action`, `update_question`, `correct_transcript`, `rewrite_note`, `add_personal_note`, `edit_personal_note`, `remove_personal_note` |
| `notes:share` | `share_note` |
| `notes:delete` | `delete_note` |
| `meetings:read` | `list_meetings`, `get_meeting`, `find_people` |
| `meetings:write` | `schedule_call`, `update_call`, `cancel_call`, `answer_call`, `schedule_next_call`, `start_call` |
| `calendar:read` | `get_calendar`, `get_availability` |

List tools accept `limit` (1–100, default 25) and `offset`; follow `nextOffset` while it is present. `list_meetings` defaults to upcoming calls and also accepts `view: "past"`. Tool schemas expose the existing API field names. Use returned IDs rather than inventing them, and send timestamps with their UTC offset or `Z`.

Writes return acknowledgments and IDs, not a full note or meeting. Use a read tool if that content is needed and the person granted reading. Sharing and deletion each need their own permission. Scheduling can send real Google invitations when the account has connected its calendar. Asking the notes service uses the account's normal inference and billing rules.

There are no tools for account administration, granting more credentials, connecting calendars, joining live media, recording, raw audio/screen images, or workspace-document editing. An agent's read access includes readable content: its provider's privacy policies apply once content is returned to it. Confidential inference inside Alcove does not make an external agent private.

## Safe retries

For `schedule_call`, `start_call`, `schedule_next_call` and `add_personal_note`, generate an `operationId` from 16 random bytes encoded as 22 base64url characters. Keep it with the intended tool arguments and reuse it for an identical retry only.

Alcove durably reserves that ID before writing. Reusing it with different arguments conflicts; a completed identical retry returns the same created resource after checking current access. A concurrent request or a crash after the write can leave it pending. On that conflict, inspect current calls/notes before creating another operation. Do not retry with a fresh ID blindly. This avoids duplicate creations; it does not promise exactly-once delivery by an external calendar provider. Records expire within 24 hours, so later retries also require inspecting current state first.

Explicit-state tools such as editing a task or setting an RSVP can be repeated with the same desired state. Tool annotations help clients present actions; permissions and domain checks enforce them on the server.

## Disconnect and troubleshoot

**Settings → Agents → Disconnect** physically removes the connection, access/refresh hashes, codes and its operation records. The next MCP request fails, across API instances. Signing out of a browser does not disconnect its agents. Deleting an account removes all its connections.

- **401:** Missing, expired, revoked or otherwise invalid credential. Reconnect.
- **403:** Wrong Origin/Host, missing permission, or a consent account changed. Use the configured server URL, and review the connection again.
- **Tool not found:** The connection may not have that scope. Check Settings and reconnect with the needed permission; an agent cannot upgrade itself.
- **Pending/conflicting operation:** Inspect the existing result before starting a new operation.
- **No notes or calendar data:** The agent sees only this account's current access. A disconnected calendar and a note whose sharing was removed remain unavailable.
- **Expired consent:** Start linking from the client again. Consent requests last ten minutes and can be answered once.

Every HTTP response has a request ID. Supply that ID when reporting a problem, without including a token, the authorization callback URL, or private note text. Expected tool failures return safe error codes and messages; unexpected internal errors reveal no internal details.

## Operations and upgrades

The endpoint is part of the API image, not a separate process. Deployment needs to route `/mcp`, `/oauth/*` and `/.well-known/*` to the API. OAuth uses configured `API_URL` as issuer and audience, never a client-supplied Host. API URLs with a path need RFC8414/RFC9728 well-known discovery paths routed before that path; the local Vite proxy handles them.

Migration `0017_agent_grants.sql` adds grant, hashed-credential, sealed OAuth client/request/code, and operation tables. It changes no prior table or sealed record. The preceding API release can keep serving during the additive migration. Account-owned rows cascade on deletion. Periodic upkeep physically removes expired records. Global registered-client metadata is sealed under the separate agents service key; it has a finite lifetime and contains no account content.

Integration tests run actual SDK clients over HTTP against real Postgres and object storage. They cover scope filtering, domain flows, retry conflicts, invalid credentials, cross-account access, OAuth binding/refresh replay, revocation, expiry, persistence and leakage. No browser-test framework is required or allowed.
