# Connect agents to Alcove

Alcove exposes a remote MCP server at `$API_URL/mcp`. An agent acts with a person's explicitly granted permissions and their current Alcove access. Browser sessions and agent credentials are separate. This guide describes the implementation; it does not establish which commit is deployed.

Agents have a page of their own, **Agents** (`/agents`), in the side panel after Team; on a phone it opens from **Settings › Connections**. Connecting an agent, making a token, changing what each can do, keeping one longer, disconnecting and what they did all live there. It shows the address before any connection exists: `agents.endpoint()` (`GET /v1/agents/endpoint`, signed in only, read by `q.agentEndpoint()`) returns the same `API_URL`-derived address that OAuth uses as its resource and that a new token's one-time view repeats. It is not a secret and grants nothing.

## Connect with OAuth

Use the MCP URL of the environment you want. Production's configured URL is `https://api.alcove.solutions/mcp`; it is available only after this feature is deployed there. For local work with the normal web proxy it is `http://localhost:3000/api/mcp`.

In Codex CLI:

```sh
codex mcp add alcove --url https://api.alcove.solutions/mcp
codex mcp login alcove --scopes notes:read,notes:write,meetings:read,meetings:write,calendar:read
```

The browser that opens goes to Alcove. Signed in, the request opens in the app, on the Agents page (`/connect?request=…` goes on to `/agents?request=…`); signed out, Alcove asks you to sign in first and then shows it there. Review the requesting client's name, where allowing sends the browser back to (`redirectHost`, the host of the callback it asked for, which it registered: a client chooses its own name, so the page never treats that as proof of who it is), and each permission it asked for, choose what to allow (never more than it asked for), and press **Allow**; **Cancel** declines, and the client gets `access_denied`. Nothing is authorized before that step, and the decision is bound to the account the page showed. If the client needs an explicit registration choice, `codex mcp login alcove --oauth-client-registration dcr` selects the supported public-client registration flow. Alcove does not fetch Client ID Metadata Documents or advertise CIMD support. Codex supports DCR when advertised ([official connection documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)).

Other clients that support Streamable HTTP and OAuth authorization code with PKCE S256 can use the same URL. They must send the exact MCP resource URL as `resource` during authorization and code exchange. Alcove publishes protected-resource and authorization-server metadata and allows HTTPS redirects or HTTP loopback callbacks. IP-literal loopback callbacks may vary their port; the host, path and query must still match.

OAuth access tokens last up to one hour. Refresh tokens rotate when used. A connection lasts 30 days from when it was allowed, or from when it was last kept longer on the Agents page ([below](#change-what-an-agent-can-do-or-keep-it-longer)); connect again after that. Reusing an already-consumed refresh token revokes the entire connection, until the end that token had (the connection's, unless it has been kept longer since), so clients must serialize refreshes and persist their replacement tokens safely.

A refresh may send `scope`. A permission name Alcove doesn't know fails with `invalid_scope`, and spends nothing; otherwise the tokens issued carry what the connection can do now, whatever was asked for, and the response's `scope` says what that is. So a client that keeps sending the scope string it was first given goes on refreshing after its permissions were narrowed or widened.

## Connect with a personal token

1. In Alcove, open **Agents**, press **Another agent**, then **Create a token**.
2. Name it, choose permissions and how long it lasts (7, 30 or 90 days; 30 by default).
3. Copy the token from the one-time view into the client's private credential store, with the address shown beside it. It cannot be displayed again.
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
| `notes:write` | `propose_decision`, `update_decision`, `add_follow_up`, `update_follow_up`, `add_question`, `update_question`, `correct_transcript`, `rewrite_note`, `add_personal_note`, `edit_personal_note`, `remove_personal_note` |
| `notes:share` | `share_note` |
| `notes:delete` | `delete_note` |
| `meetings:read` | `list_meetings`, `get_meeting`, `find_people` |
| `meetings:write` | `schedule_call`, `update_call`, `cancel_call`, `respond_to_invite`, `schedule_next_call`, `start_call` |
| `calendar:read` | `get_calendar`, `get_availability` |

List tools accept `limit` (1–100, default 25) and `offset`; follow `nextOffset` while it is present. Inputs and results use the API's field names, except that follow-ups are named as the app names them, where the API says actions: `followUps`, `suggestedFollowUps`, `openFollowUps`, `totalFollowUps` and `followUpId`. Use returned IDs rather than inventing them, and send timestamps with their UTC offset or `Z`.

Once it connects, the server tells an agent what Alcove's words mean (`instructions`, in the answer to `initialize` or `server/discover`): one note for each call that kept notes, a note's three lists, the two views of calls, answering an invitation, and to use the IDs the list and get tools return. It's put together for each request from the connection's permissions, so it names only tools the connection has (`instructionsFor` in `features/agents/mcp/tools.ts`).

Writes return acknowledgments and IDs, not a full note or meeting. Use a read tool if that content is needed and the person granted reading. Sharing and deletion each need their own permission. Scheduling can send real Google invitations when the account has connected its calendar. Asking the notes service uses the account's normal inference and billing rules.

There are no tools for account administration, granting more credentials, connecting calendars, joining live media, recording, raw audio/screen images, or workspace-document editing. An agent's read access includes readable content: its provider's privacy policies apply once content is returned to it. Confidential inference inside Alcove does not make an external agent private.

### A note's entries

A note keeps three kinds of entry, in the call's part and in each breakout room's (`rooms`), and the tools name them as Alcove shows them ([Notes and inference › Decisions and follow-ups](notes-and-inference.md#decisions-and-follow-ups) has who may do what):

- **Decided** (`decisions`): `propose_decision` adds one, proposed until it's confirmed, by the organizer or by someone invited who didn't write its words. `update_decision` confirms, rejects, reopens, supersedes, rewords or disputes one; confirming says the words that were read (`seen`).
- **Follow-ups** (`followUps`): `add_follow_up` puts one straight onto the checklist, as **Add a follow-up** in Alcove does (both are `notes.proposeAction`). Who it's for (`owner`, by address) must have the notes, and takes it on themselves: until then who and when are only suggestions. `update_follow_up` ticks, rewords, dates or gives one to someone, by its `followUpId`; taking one on, or giving it to yourself, says what was read (`seen`: its words and date). `suggestedFollowUps` are the ones the notes suggested, waiting for someone to add or dismiss them in Alcove; no tool does that.
- **Still open** (`questions`): `add_question` adds one (`notes.addQuestion`; the app has no way to), and anyone with the notes says it was answered, or opens it again, with `update_question`.

Each one added has whoever added it as its first change (`proposed`), which also keeps it when the notes are written again; it can rest on up to three lines of the part it goes in. The same words again in that part add nothing, so a retry is safe, and a part holds at most 60 of each (`409 conflict`). The answer is an acknowledgment, never the words. `get_note` gives a note with its entries named this way, and `list_notes` counts follow-ups as `openFollowUps` and `totalFollowUps`, so no tool says "action".

### Calls

`list_meetings` has two views:

- `upcoming` (the default): the calls the person organizes and the ones they're invited to that haven't ended, soonest first, each as `get_meeting` reads it, with its join link (`url`).
- `past`: the calls that happened, newest first. Their own that ended (`meetings.past`), and the ones they were invited to that kept notes, which Alcove knows only by their notes, since an invitation goes once its call is over (the app's Calls page lists past calls from their notes too). Both come in one shape: `meetingId` (their own call's; null for someone else's, which `get_meeting` can't read once it's over), `noteId` (null for a call that kept none), `title`, `startsAt` (the time their own call was set for; when the recording started, for one they were invited to), `minutes` (how long it ran, at least one; null when not known), `organizer`, `role` (`organizer` or `invited`) and `people` (everyone invited besides the organizer; for someone else's call, those who still have its notes). Notes shared with them afterwards, which `list_notes` lists, and their team's aren't calls they were in.

`respond_to_invite` says whether the person is coming to a call someone else organized and invited them to (`yes`, `maybe` or `no`), as answering the invitation in Alcove does: it doesn't join a call, answer one that's ringing or tell Google Calendar, and their own call isn't an invitation (`404 not-found`).

## Change what an agent can do, or keep it longer

On the Agents page, a connected agent shows what it can do as the seven permissions above, and pressing one changes it at once: `agents.update(id, { scopes })` (`PATCH /v1/agents/:id`) seals the connection's permissions again with the new ones. Every MCP request reads its connection afresh, so discovery and checks follow from the agent's next request, on every API instance. At least one permission stays, and only names from the list above; to take the last one away, disconnect instead. An agent can't change its own.

An agent whose access ends within three days says so, with **Keep it 30 more days**: `agents.update(id, { renew: true })` moves the connection's end to 30 days from now when that's later, with its personal token or the refresh token it hasn't used yet, and keeps its OAuth client registered at least that long, or every refresh once the registration's 90 days were up would fail as `invalid_client`. Access tokens keep their hour and are refreshed as usual. A refresh token it has already used keeps the end it had, so reusing it before then still revokes the connection, and afterwards is only refused; upkeep deletes every credential past its end, so a connection kept longer doesn't pile up its token history (it would reach the 4,096 a connection may hold after about 170 days of hourly refreshes). Either change, or both sent together, is one transaction under the connection's row lock, which refreshing, redeeming a code and disconnecting take first too, and the answer is the connection as it now is. Another account's connection, or one that has ended, is `404 not-found` ("That connection is no longer available."). Changes share the account's budget for making tokens and allowing agents, 30 a minute. None keeps a request receipt: the answer names the agent, which a receipt would keep for a day after it was disconnected. Each change is logged with its IDs, how many permissions it now has and whether it was kept longer.

## What your agents did

Each tool call an agent completes is kept for its owner alone, in `agent_activity`: which tool, the note or call it was about by ID, and how many it found. The IDs come from what the call was asked (`noteId`, `meetingId`), or for `schedule_call`, `schedule_next_call` and `start_call` from the call it made, not the one it followed. The count is how many `list_notes`, `list_meetings`, `find_people` and `get_inbox` found, and how many events `get_calendar` read, in all, not the page they returned; each of those tools says what it counts where it answers. `ask_notes` and `get_availability` keep no count. Nothing else is kept: no title, name, search text or anything said. The row's columns are the account, the connection, the row's ID and when; the rest is sealed under the account's own state key `agent-activity`, as an `agent-activity` record bound to the account and the row ([Privacy, keys and sessions › Records and envelopes](privacy-keys-and-sessions.md#records-and-envelopes)). A refused call isn't kept, and failing to keep one logs a warning and never fails the call.

`agents.activity({ limit, before })` (`GET /v1/agents/activity?limit=&before=`, signed in only, `cache-control: no-store`) lists it newest first, 40 at a time by default and at most 100, for the connections that still work: one that has run out lists nothing before upkeep deletes it. `next` is an opaque cursor for the page after (the last row's time, to the microsecond, and its ID), or null at the end. Reading it has a budget of its own, 60 a minute for each account, since the Agents page reads each page it shows again every minute.

Titles are read as it's listed, from what the owner can open then, and never stored. Only each note's or call's sealed manifest is read: the owner's own notes and calls on a page together, then each of other people's (a note given to them, a call they're invited to that isn't over) by the same check reading it takes, four at a time. Nothing asks Google, and no other part of a note or call is opened. A note or call that's gone, or isn't theirs any more, reads with a null title, logged at debug; one that fails otherwise, such as a record that doesn't pass its check, is logged at that failure's own level. A call still offering times has no start. A row of a tool a later release no longer offers still opens, and isn't listed. A row of a tool that was renamed is listed under its new name: `propose_action`, `update_action` and `answer_call` read as `add_follow_up`, `update_follow_up` and `respond_to_invite`.

It goes with its connection, so when it's disconnected, runs out or is revoked by a reused refresh token, and with the account. Upkeep deletes it after 30 days, and past each connection's newest 1,000, so one busy agent can't push out what another did; that's its own step of upkeep (`agentActivity` in what it returns), after the connections that ran out are deleted.

## Safe retries

For `schedule_call`, `start_call`, `schedule_next_call` and `add_personal_note`, generate an `operationId` from 16 random bytes encoded as 22 base64url characters. Keep it with the intended tool arguments and reuse it for an identical retry only.

Alcove durably reserves that ID before writing. Reusing it with different arguments conflicts; a completed identical retry returns the same created resource after checking current access. A concurrent request or a crash after the write can leave it pending. On that conflict, inspect current calls/notes before creating another operation. Do not retry with a fresh ID blindly. This avoids duplicate creations; it does not promise exactly-once delivery by an external calendar provider. Records expire within 24 hours, so later retries also require inspecting current state first.

Explicit-state tools such as editing a task or setting an RSVP can be repeated with the same desired state. Tool annotations help clients present actions; permissions and domain checks enforce them on the server.

## Disconnect and troubleshoot

**Agents**, the agent, then **Disconnect** physically removes the connection, access/refresh hashes, codes, its operation records and what it did. The next MCP request fails, across API instances. Signing out of a browser does not disconnect its agents. Deleting an account removes all its connections.

- **401:** Missing, expired, revoked or otherwise invalid credential. Reconnect.
- **403:** Wrong Origin/Host, missing permission, or a consent account changed. Use the configured server URL, and review the connection again.
- **Tool not found:** The connection may not have that permission. Its owner can add it on the Agents page, and the agent has it from its next request; an agent cannot upgrade itself.
- **Pending/conflicting operation:** Inspect the existing result before starting a new operation.
- **No notes or calendar data:** The agent sees only this account's current access. A disconnected calendar and a note whose sharing was removed remain unavailable.
- **Expired consent:** Start linking from the client again. Consent requests last ten minutes and can be answered once.

Every HTTP response has a request ID. Supply that ID when reporting a problem, without including a token, the authorization callback URL, or private note text. Expected tool failures return safe error codes and messages; unexpected internal errors reveal no internal details.

## Operations and upgrades

The endpoint is part of the API image, not a separate process. Deployment needs to route `/mcp`, `/oauth/*` and `/.well-known/*` to the API. OAuth uses configured `API_URL` as issuer and audience, never a client-supplied Host. API URLs with a path need RFC8414/RFC9728 well-known discovery paths routed before that path; the local Vite proxy handles them.

Migration `0017_agent_grants.sql` adds grant, hashed-credential, sealed OAuth client/request/code, and operation tables. It changes no prior table or sealed record. The preceding API release can keep serving during the additive migration. Account-owned rows cascade on deletion. Periodic upkeep physically removes expired records. Global registered-client metadata is sealed under the separate agents service key; it has a finite lifetime and contains no account content.

Migration `0027_agent_activity.sql` only adds `agent_activity`, keyed by account and row, whose connection is a foreign key that deletes it with the connection. Connections the previous release wrote open unchanged: changing one seals the same record, with the same header and fields, under new permissions or a later end, which the previous release reads as its own. While it still serves during the deploy, the tool calls it answers aren't kept, and a refresh it answers that sends `scope` must still name exactly the connection's permissions.

Renaming `propose_action`, `update_action` and `answer_call` to `add_follow_up`, `update_follow_up` and `respond_to_invite` takes no migration. Rows of `agent_activity` the previous release sealed under the old names keep their header and open as they did, and `features/agents/activity.ts` reads them under the new names; while it still serves, the previous release leaves rows under the new names out of the list, as it does any tool it doesn't know. No other stored record names one of them: operation receipts are kept only for the tools that make something, none of which was renamed. A client that calls an old name gets "tool not found" from this release, and from the previous one a new name, while both serve during the deploy; listing the tools again finds what's there. A question an agent adds is an ordinary open question with `proposed` as its first change, which the previous release already reads; follow-ups an agent added as suggestions before this release stay suggestions until someone adds or dismisses them in Alcove.

Integration tests run actual SDK clients over HTTP against real Postgres and object storage. They cover scope filtering, the server's instructions, domain flows (a note's three kinds of entry, a call's invitation, both views of calls with a call someone was invited to that kept notes), retry conflicts, invalid credentials, cross-account access, OAuth binding/refresh replay, revocation, expiry, changing and renewing a connection and refreshing after it (its client's registration, used refresh tokens, a change racing a disconnect), the activity record (titles read from manifests when listed, with nothing asked of Google, pages, owner scoping, its budget, upkeep per connection, rows sealed under a renamed tool), persistence and leakage. No browser-test framework is required or allowed.
