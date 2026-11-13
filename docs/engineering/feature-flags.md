# Feature flags

A feature flag shows something new to some people before everyone: a control, an endpoint, a whole page or feature. Build
it behind a flag, switch it on for hand-picked people first, then release it to everyone with one command and no deploy.
Making it unconditional in the code comes later, in its own pull request.

- **A flag only switches something on.** There is no "off for this person". A flag is on for someone when *any* of these
  says so: it's on for everyone; it's granted to a group they're in; it's granted to them.
- **Grants add up.** One flag can be granted to several groups and several people at once, for example the group
  `internal` plus two people outside it: everyone in `internal`, and those two, have it.
- **The server decides.** The API works out which flags are on for whoever asks, and refuses a flagged endpoint when its
  flag is off for them. Hiding something in the app is only what people see; anyone can call the API directly.
- **People are addresses, hashed.** A group member or a person granted a flag is the keyed hash of their email, with a
  purpose of its own (`blindIndex(indexKey, 'flag-email', …)`, `flagHash` in `feature-flags.ts`): no other table holds it,
  so a flag's rows join to no account, share or workspace, and an operator who switches a flag for an address learns
  nothing about whose account it is. Nothing readable is stored. A grant follows the address: you can grant someone before
  they sign up, and it applies the moment they do. The API hashes the address of whoever asks the same way, from their
  opened profile. Deleting an account removes its address from every group and grant (unless another account signs in
  with the same address).

Where it lives: the names in `packages/api/src/feature-flags/names.ts`; the server side in `apps/api/src/feature-flags.ts`; the endpoint
`GET /v1/feature-flags` in `apps/api/src/http/system-routes.ts`; `useFeatureFlag` in `apps/web/src/lib/queries.ts`; the commands in
`apps/api/src/featureFlagCommands.ts`, which the CLI (`apps/api/src/feature-flags-cli.ts`) and the operator route
(`POST /v1/operator/feature-flags`, in `system-routes.ts`) both run; the tables in [Data and storage](data-and-storage.md).

## Building a feature behind a flag

1. **Name it.** Add an entry to `FEATURE_FLAGS` in `packages/api/src/feature-flags/names.ts`, dotted and lowercase like
   limits, with underscores between words (`board.templates`, `call.screen_share_quality`), and a one-line description of
   what it switches on. The database can only switch on a name listed there.
2. **Gate it on the server.** In every handler the feature adds, before doing anything:

   ```ts
   requireFeatureFlag(await featureFlagsFor(d, owner), 'board.templates');
   ```

   `featureFlagsFor` resolves once per request (per `Owner` object) and reads from the instance's cached copy. `requireFeatureFlag` refuses
   with `404 not-found` ("That isn't here."), logged at info with the flag's name, so to someone without the flag the
   feature doesn't exist. For a route someone not signed in can reach, pass `undefined` for the owner: only flags on for
   everyone count.
3. **Show it in the app.**

   ```tsx
   const templates = useFeatureFlag('board.templates'); // undefined while loading, then true or false
   if (templates === undefined) return null;     // or a skeleton: never treat "loading" as off, so nothing flashes
   ```

   For a whole route, wait on `undefined` the same way before deciding between the page and not-found. If the flags can't be
   read, `useFeatureFlag` says `false` rather than leaving the page waiting. The app asks again
   every minute and when the window gets focus, and afresh after signing in or out.

   Something that's set up once and lives on, such as a call's media room, reads the flags once as it starts instead, and
   passes on their names, not booleans, so that retiring a flag still finds every check. It can't wait long: the call's
   room takes what the lobby read, or waits at most 1.5 s, and is then without them for that call, saying so in the log
   ([Calls and recordings › Video quality](calls-and-recordings.md)).
4. **Show it in Storybook.** The stand-in API answers `featureFlags.on()` from the scenario's `World.featureFlags`. Give a scenario the
   flag (`featureFlags: ['board.templates']`) and add the stories that show the feature; scenarios without it are the "off" case.
5. **Test it.** In the feature's integration suite: refused while off, allowed once granted, using the functions the CLI
   uses (`setEveryone`, `createGroup`, `addMembers`, `grantGroup`, `grantPerson` from `apps/api/src/feature-flags.ts`).
   `FEATURE_FLAGS_CACHE_MS` is 0 in tests, so a change is seen on the next request.

## Switching flags: the `feature-flags` CLI

Every command works against whichever database `DATABASE_URL` names, and needs `KMASTER` to hash addresses (the index key
derives from it), so the CLI is for a database whose `KMASTER` is at hand. Locally both come from `.env`:

```
pnpm --filter @alcove/server feature-flags list
pnpm --filter @alcove/server feature-flags everyone <feature-flag> on|off
pnpm --filter @alcove/server feature-flags groups
pnpm --filter @alcove/server feature-flags group create <group>
pnpm --filter @alcove/server feature-flags group delete <group>
pnpm --filter @alcove/server feature-flags group add <group> <email>…
pnpm --filter @alcove/server feature-flags group remove <group> <email>…
pnpm --filter @alcove/server feature-flags group members <group> [<email>]
pnpm --filter @alcove/server feature-flags grant <feature-flag> group <group>
pnpm --filter @alcove/server feature-flags revoke <feature-flag> group <group>
pnpm --filter @alcove/server feature-flags grant <feature-flag> person <email>…
pnpm --filter @alcove/server feature-flags revoke <feature-flag> person <email>…
```

- `list`: every flag in code with its description, whether it's on for everyone, which groups have it and how many people
  have it directly; then any name in the database that isn't a flag any more.
- A group's name is lowercase letters, digits and dashes (`staff`, `beta-testers`, `internal`). Deleting a group deletes its
  members and every grant to it.
- The database holds no addresses, so `group members <group>` gives a count; add an address to ask whether it's in.
- Nothing it prints or logs repeats an address you typed: it says flags, groups and counts ("on for 2 of 2 addresses").

Each instance reads the flags again every 30 seconds (`FEATURE_FLAGS_CACHE_MS`), so a change is in force everywhere within that,
with no restart. Each instance logs `feature flag changed` (with the flag, whether it's on for everyone, how many groups have
it, how many people have it directly and how many through those groups) when it sees one.

### In production

Production flags are switched through the API itself, which hashes addresses where nothing outside it can see them:
`POST /v1/operator/feature-flags` takes a command's words and answers with the lines the CLI would print for them, from the
same commands. It isn't part of the app's API: operators call it with curl and a token. It's off, answering 404 as if it
weren't there, until the API has `OPERATOR_TOKEN_SHA256`, the SHA-256 of that token as 64 lowercase hex characters. Any other
token gets 401, compared in constant time. Make a token, and the hash the API is given:

```
TOKEN=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')
printf %s "$TOKEN" | shasum -a 256 | cut -d' ' -f1
```

Then send the command's words as JSON, 1 to 100 of them, each at most 320 characters:

```
curl -sS https://api.alcove.solutions/v1/operator/feature-flags -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"words":["group","add","staff","ann@vandelay.test"]}'
{"lines":["Added 1 of 1 to staff."]}
```

Words it can't run (a name that isn't a flag, no such group, words that aren't a command) are refused with the API's usual
error, `{ code, message, requestId }`, whose message is what the CLI would print. It takes 30 requests a minute from an
address, and, unlike the app's routes, needs no `Origin` (the body must still be JSON). The addresses you send are hashed
inside the API, under flags' own purpose, and kept nowhere else: not in a row, an argument list or a log line, and the
hash stored joins to nothing but a flag. It logs `operator feature flags` with the command (`unknown` for words that
aren't one) and whether it ran, and nothing else.

Flags' hashes had the `email` purpose before (the hash `identities` holds); a group member or person grant made then no
longer matches anyone. Production had none when that changed, so nothing was converted: add such an address again with
the commands above.

## Releasing and retiring a flag

Two separate steps, so a release never waits on code:

1. **Release:** `feature-flags everyone <feature-flag> on`. Everyone, signed in or not, has it within 30 seconds.
2. **Retire, later, in one pull request:** delete the flag's name from `FEATURE_FLAGS`. The typecheck now fails at every check that
   used it, in the API and the app. Fix each by keeping the "on" path: delete `requireFeatureFlag`, delete the `useFeatureFlag` check and
   whatever showed while it was off. Remove it from Storybook's scenarios. Once that's deployed, its rows are unknown names,
   ignored with `feature flag ignored` at warn; clear them from Cloud SQL's console:

   ```sql
   DELETE FROM feature_flags_everyone WHERE name = '<feature-flag>';
   DELETE FROM feature_flag_group_grants WHERE feature_flag = '<feature-flag>';
   DELETE FROM feature_flag_person_grants WHERE feature_flag = '<feature-flag>';
   ```

Don't switch a released flag back off for everyone, or delete its rows, before step 2 is deployed: that hides the feature
again. Deleting rows can only ever take a feature away from people; the name in code is what the checks depend on.

## What flags aren't for

- **Turning something off** for some people: flags only switch on.
- **Keeping an old flow alive** beside its replacement (AGENTS.md › No backwards compatibility). A flag gates something new.
- **Numbers** that change while the service runs: those are limits ([Deployment › Changing a limit](deployment-and-acceptance.md#changing-a-limit)).
- **Payloads, percentages, experiments or analytics.** Not built.
- **Groups that come from the product** (a workspace's members, a company's domain). Not built yet; a new kind of group
  would be a new way of answering "which groups is this person in" in `feature-flags.ts`.

Inside the confidential VM the key addresses are hashed with exists only there, so nothing outside the API can switch a flag
for a person or a group: the operator route does it inside the VM. The Cloud Run job `alcove-feature-flags`, which ran the CLI
with the old `KMASTER` bound, was deleted on 2026-11-13 with that master, which nothing outside the VM has any more.
