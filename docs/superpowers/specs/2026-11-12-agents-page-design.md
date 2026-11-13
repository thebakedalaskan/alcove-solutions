# Agents, a place of its own

The design is approved as drawn on the canvas. Its boards are in `docs/design/canvas/`: `Agents.dc.html` (the page, every
state through `#step=`), `StepsAgents.dc.html` (every journey, frame by frame), `data-agents.js` (the catalogue, copy,
levels, steps and journeys) and `page-agents.css` (its styles, `agt-` there). Preview it with the kit's instructions in
`docs/design/canvas.md`. Where this spec and the board disagree, this spec wins; where either and the app's rules disagree,
`AGENTS.md` wins.

## What changes

1. **A place in the side panel.** Agents, after Team, at `/agents`, counting connected agents (a quiet count, as Team's).
   The phone's tab bar keeps its five; on a phone Agents opens from Settings › Connections, and the page's head has a way
   back to Settings there.
2. **The page, on the evening.** A new `agents` moment: Team's the other way round, the sun low on the right just past the
   end of the line. The sky is about 41% of the window (49% on the first day, about 75% while an agent asks). Title
   **Agents** at the top left. Hero: **Connect your agent** with the line *Ask it about your calls, and let it book them. It
   can do only what you allow.* on the first day; **Your agents** once one is connected.
3. **Agents stand on the horizon as windows** (people are arches; agents are square windows with rounded tops). Connected
   ones first, solid, with their name and when they were last used under them; then a half-place gap; then the agents
   people use that aren't connected yet, dashed: Claude, ChatGPT, Cursor, VS Code, Claude Code, Codex; then **Another
   agent** (a plug). A connection's kind comes from its name, client-side and for display only (client names are untrusted):
   /claude code/i → Claude Code, /claude/i → Claude, /chatgpt|openai/i → ChatGPT, /cursor/i → Cursor, /visual studio
   code|vs ?code/i → VS Code, /codex/i → Codex; a token is a key; anything else a bot. An agent whose access ends within 3
   days says **Ends tomorrow** (or the day) in caution under its name, with a caution dot on its window.
4. **Each window opens a popover** under it, with a caret, sliding to stay in the page (a sheet on a phone). One action
   each; no numbered steps, no floating links, no lines of facts.
   - **Connect** (not connected): title **Connect Claude**, one line, the address or command in a quiet mono well when it
     needs one, one full-width filled button:
     | Kind | Line | Well | Button |
     |---|---|---|---|
     | Claude, ChatGPT | Paste this address into Claude’s connectors. | the MCP address | **Copy and open Claude** ↗ (copies, opens `https://claude.ai/settings/connectors` or `https://chatgpt.com/#settings/Connectors` in a new tab) |
     | Cursor, VS Code | Cursor asks to add Alcove. Then you choose what it can do, here. | none | **Add to Cursor** ↗ (`cursor://anysphere.cursor-deeplink/mcp/install?name=alcove&config=` + base64 of `{"url":"<address>"}`; VS Code: `vscode:mcp/install?` + URI-encoded `{"name":"alcove","type":"http","url":"<address>"}`) |
     | Claude Code | Run this in your terminal, then /mcp in Claude Code to sign in. | `claude mcp add --transport http alcove <address>` | **Copy command** |
     | Codex | Run this in your terminal. Codex opens Alcove to sign in. | `codex mcp add alcove --url <address> && codex mcp login alcove` | **Copy command** |
     | Another agent | Any agent that works with MCP connects with this address. | the address | **Copy address**, then a foot row: *A script that can’t sign in?* **Create a token** → |
     Pressed, the button becomes **Waiting for Claude** (three dots, fading with reduced motion) in its place. While a
     popover waits, connections are polled every 3 s; when a new one appears, the popover becomes **Claude is
     connected** (a tick on the window), *Ask it something in Claude, like:* and a well with “What did we decide about the
     launch?” and a copy icon.
   - **Create a token** (from Another agent, with a way back): Name, **Lasts** 7 / 30 / 90 days (30 chosen), **What it can
     do** as the permission chips (reading chosen), *It gets readable information from Alcove.*, full-width **Create
     token**. Made: its name and *Until 4 Dec*, *Copy it into your script now, with Alcove’s address. It won’t show again.*,
     the token masked in a well with a copy icon, the address in a well with a copy icon, **Done**. The token lives in that
     view only.
   - **A connected agent**: its mark, name and *Used 4 min ago* (*Token · used Mon* for a token, *Not used yet*); while it's
     ending, *Its access ends tomorrow* in caution and a full-width secondary **Keep it 30 more days**. **What it can do**
     with **Saved** beside it after a change, the seven permission chips (pressing one changes it at once; the last one
     can't be taken away: a toast says to disconnect instead). Foot: **Disconnect** (quiet) and *Until 20 Nov*.
     Disconnect asks in place: **Disconnect Claude?** *It stops working at once. To use it again, connect it again.*
     **Keep Claude** (filled) and **Disconnect**.
5. **Allowing happens on Agents.** `/connect?request=…` signed in goes to `/agents?request=…` (replace). Signed out, it
   keeps today's sign-in and comes back. On Agents, the sky grows and asks, with the agent's window and your arch standing
   together on the horizon (instead of the line), joined by a dashed rose line with a plug in a rose circle; the window is
   outlined in rose (a decision waiting on you):
   - **Claude wants to use your Alcove** (Newsreader, 32–44px).
   - A quiet panel of rows, one per part of Alcove the agent asked for, each with its level at the right edge, which opens
     a menu of levels with what each allows: **Notes** Off / Read / Read and edit; **Calls** Off / See / See and book;
     **Calendar** Off / See; **Share or delete notes**: two switches, **Share notes** and **Delete notes**, off. Levels map to
     scopes (`notes:read`, `+notes:write`; `meetings:read`, `+meetings:write`; `calendar:read`; `notes:share`,
     `notes:delete`), only ever the ones requested.
   - *Claude gets readable information from Alcove, under its maker’s own policies.*
   - **Allow** (filled, disabled while nothing is chosen) and **Cancel**.
   - *Only allow this if you just added Alcove to Claude. It lasts 30 days.*
   Allowed: the line closes (solid, a tick), **Claude is connected**, *Taking you back to Claude…*, and after about 1.2 s the
   browser goes to the agent's redirect. Cancel declines (the agent gets `access_denied`) and the page returns to normal.
   A request that ended: **This request ended**, *It waited too long, or was answered in another tab. Start again from
   Claude.*, **Show me how** (opens that agent's Connect popover; Another agent for unknown names).
6. **On the water.** Left: **What your agents did** with *Only you see this* (a lock), grouped by day (Today, Yesterday,
   Mon 2 Nov), each row a tinted mark by kind, a sentence (*Claude booked* **Onboarding review**, the object a link to the
   note or call), a quiet second line, and the time in a fixed column; **Show more** continues it. Reading is neutral; a
   booked call takes `sun-text`; a follow-up `horizon`; a decision `rose`. Empty: a dashed window with a bot, **Nothing
   yet**, *What your agents read and change in Alcove shows here, newest first.* Right: **Ask your agent**, four example
   questions, each saying which connected agents (not tokens) can do it (*Claude and Cursor can do this*, with a tick) or
   what it needs (*Needs book calls*), with a copy icon.
7. **States.** Loading: three dashed windows that breathe. Failed: **Your agents didn’t load** with *Alcove couldn’t reach
   the server.* and **Try again**. Offline: **You’re offline**, *Your agents keep working. This page catches up when
   you’re back.* Signed-out and missing-request states of `/connect` stay as they are.
8. **Settings › Connections.** The Agents panel becomes one row: the agent tile, **Agents**, *Claude, Cursor and Weekly
   digest are connected.* (or *Use Alcove from your AI assistant, with only what you allow.*), and **Open Agents** →
   (**Connect an agent** → when none). Making tokens and the address move to the Agents page; delete what moved.

## The contract (done in the base commit)

`packages/api/src/agents`: `AgentsApi.update(id, { scopes?, renew? })` → the connection as it now is;
`AgentsApi.activity({ before?, limit? })` → `{ items: AgentActivity[], next }`. `AgentActivity` is `{ id, connectionId, at,
tool, noteId, noteTitle, meetingId, meetingTitle, meetingStartsAt, count }`; `AGENT_TOOLS` lists every MCP tool.
`@alcove/api-http` calls `PATCH /v1/agents/:id` and `GET /v1/agents/activity?limit=&before=`. The Storybook stand-in has
minimal versions to extend.

## The server

- **Update.** `PATCH /v1/agents/:id` (owner-scoped, 404 for another account's ID). `scopes` reseals the grant's info with the
  new scopes (at least one, from `AGENT_SCOPES`); every MCP request reads them afresh, so tool discovery and checks change
  from the next request. `renew` sets the grant's `expires_at` to now + 30 days when that's later, and moves its personal
  and refresh tokens' `expires_at` (consumed refresh hashes too, so replay detection lasts) to the same time, in one
  transaction under the grant's row lock. OAuth refresh: a `scope` parameter no longer has to equal the grant's scopes;
  unknown scope names still fail; the issued scope is the grant's current scopes.
- **Activity.** Migration `0027_agent_activity.sql`: `agent_activity (owner_id, grant_id, id, created_at, body_ciphertext)`,
  FK `(owner_id, grant_id)` → `agent_grants` ON DELETE CASCADE (disconnecting deletes what it did), index on
  `(owner_id, created_at DESC, id)` and on `created_at`. Each completed tool call (in `register` in `mcp/tools.ts`, added to
  `pending` so keys outlive it) seals `{ tool, noteId?, meetingId?, count? }` under a per-owner state key with header
  `{ v: 1, kind: 'agent-activity', ownerId, activityId }`. A failure to record logs at warn and never fails the tool.
  Upkeep removes rows over 30 days old and keeps at most 1,000 per account. Listing opens a page, resolves note titles
  from `notes.list(o)` and calls from `meetings.get(o, id)` (null when it's gone or not yours any more), never trusting a
  stored title. Nothing readable in any column; log IDs, counts and tools only.
- **Tests** (integration, real HTTP through `@alcove/api-http`, beside the feature): narrowing scopes removes tools from
  discovery and refuses their calls; widening adds them; empty scopes are refused; renew extends `expiresAt` and a refresh
  token keeps working past the old expiry; another account's ID gets 404 for update; activity records `get_note` with the
  note's title, `schedule_call` with the call's title and time, `list_notes` with a count; a note deleted afterwards reads
  back with a null title; activity is owner-scoped; revoking deletes it; account deletion empties `agent_activity` (add it
  to the table list in `flows.integration.test.ts`); a canary title never appears in a database dump of `agent_activity`;
  upkeep removes old rows.

## Where the code goes

- `packages/ui`: the parts, stateless (`components/agents.tsx`, beside the existing ones): the window (`AgentWindow`: a mark
  by kind, solid / dashed / asking / allowed, with a caution dot or a tick), a place on the line with its name and line,
  the popover's head, line, well (with or without a copy icon), action and waiting row, the foot row, the asked-in-place
  block, the levels panel with its menus (`AgentLevels`), the pair on the horizon (`AgentPair`, with the person's
  `Avatar`), an activity row, an example-question row, and the empty window. Styles in `styles/agents.css` with the page's
  `ag-` prefix (the existing `ac-agent-` parts stay where they're still used; delete the ones nothing uses any more).
  The `agents` moment in `horizon.tsx` (`Moment`, `MOMENTS`, `SCENES`, `LIFE`, `LANES`) and `horizon.css`; new icons in
  the `Icon` map (sparkle, chat, pointer, code, square terminal, terminal, plug, unplug, hourglass, book, calendar check,
  list). Stories for each part in `apps/storybook/stories/components`.
- `apps/web`: `routes/_app/agents.tsx` (search: `request`), `features/agents/` (the catalogue and name matching, the line,
  each popover, the question, the water), queries and mutations in `lib/queries.ts` (`q.agentActivity`, `useUpdateAgent`,
  polling while waiting), the place in `features/shell/places.ts` with its count, Settings' row, and `/connect` sending
  signed-in people to `/agents`.
- `apps/storybook`: the stand-in's connections (Claude and Cursor signed in, Weekly digest as a token), activity, an
  ending connection, a consent request from Claude; `stories/pages/Agents.stories.tsx` with every state;
  `stories/journeys/14-agent-access.stories.tsx` rewritten to the canvas's journeys; Settings' and Connect's stories updated.
- Docs in the same change: `docs/product/user-flows.md` (2 the side panel, 11 Settings, 14 Agent access), `docs/design/pages.md`
  (the frame, an Agents section, Settings, Connecting an agent), `docs/design/principles.md` (the moment table, visitors),
  `AGENTS.md` (the new parts and `styles/agents.css`'s `ag-`), `docs/engineering/agents-and-mcp.md` (update, renew,
  activity, consent in the app), and the canvas boards already copied in.

## Stored data

Migration 0027 only adds a table. Grants written by the previous release open unchanged (`GrantInfo` is not changed). A
previous release reading a grant whose scopes were changed here sees the new scopes, which it already accepts.
