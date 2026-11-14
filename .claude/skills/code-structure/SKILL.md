---
name: code-structure
description: Use when adding, moving or splitting files in the Alcove repo, deciding where new code goes, or when `pnpm check:structure` (scripts/check-structure.mjs) reports a violation — a folder over 20 files, files sharing a prefix, a feature importing one above it, shared code importing a feature, an import cycle, a route holding state, a component owning too many effects or too much state, or a misnamed file. Shows the fix for each rule.
---

# Code structure in Alcove

`scripts/check-structure.mjs` enforces where code lives, which way it may depend, how big a folder grows and how files are
named. It runs in `pnpm check:structure`, `pnpm typecheck`, `pnpm check` and CI. `node scripts/check-structure.mjs <path> …`
shows one area. The map of owners, and why each rule exists, is `docs/engineering/folder-ownership.md`.

Never make a check pass by weakening it, adding an exception or hiding code in a bucket. If a rule is wrong for a real
case, the fix is a decision: change the map, the scoped `AGENTS.md` and the check together, and say why.

## Where new code goes

1. **Server:** the feature whose data or behaviour it is (`apps/api/src/features/<owner>/`, in its subfolder if it has
   one). Shared homes hold only what features build on: `platform` (config, db, objects, log, errors, limits, flags),
   `keys` (sealing, owner and server keys, sessions, signed passes), `tee`, `inference`, `providers` (Google, LiveKit),
   `http` (request infrastructure), `live` (realtime transport, document workers), `edge` (TLS and the web app's files).
   `apps/api/src` itself holds only composition and build entries.
2. **Web:** the feature that shows it (`apps/web/src/features/<owner>/`, in the call's or calls' subfeature). Its data
   access goes in that feature's `queries.ts`. `lib/` is only for what every feature shares (the API client, the query
   client, logging, keyboard and time helpers). Code another feature needs stays with its owner and is imported from
   there; it never lives in a page folder just because that page used it first.
3. **UI kit:** the area folder in `packages/ui/src` for what it shows, its CSS beside it (see `packages/ui/AGENTS.md`).
4. **Contract:** `packages/api/src/<feature>/`. **Storybook:** a folder per area; journeys per section of
   `docs/product/user-flows.md`.

## Moving and renaming: always with the script

```bash
node scripts/move-files.mjs --dry apps/api/src/features/notes/drive-oauth.ts apps/api/src/features/notes/drive-exports/oauth.ts
node scripts/move-files.mjs <from> <to> [<from> <to> …]     # or --map moves.json, a list of [from, to]
```

It moves with `git mv` and rewrites, in every package: imports, `import()`, CSS `@import`, relative path strings that name
a moved file, `scripts/ci-test-times.json` keys, and path mentions in docs and comments. It prints what it can't decide:
`new URL(…, import.meta.url)` in a moved file (check it by hand; an esbuild entry's dist path is relative to `dist/`), and
old file names mentioned on their own. Then run `pnpm check:structure` and `pnpm typecheck`.

## Each failure, and its fix

### "holds N files (at most 20)"

Group the files that change together into subfolders named for what they do (`boards/`, `chat/`, `offline/`), not for what
they are (`components/`, `hooks/`, `types/`). Look for what imports what, and for shared prefixes. Record each new
subfolder in `folder-ownership.md`. In `call/` and `calls/` a new subfeature also goes in the check's `callHomes`.

### "N files start with "x": that's an x/ folder"

```text
notes/drive-artifacts.ts  notes/drive-oauth.ts  notes/drive-provider.ts  notes/drive-routes.ts …
→ notes/drive-exports/artifacts.ts  oauth.ts  provider.ts  routes.ts …
```

Drop the prefix inside the folder; the folder says it. Words of the folder's own name don't count (`Chat*.tsx` in `chat/`).

### "the X feature may not import Y" (server)

Server features import only those before them: `profile → billing → workspaces → meetings → recordings → notes → calls →
agents → account → operator`. Pick the fix that matches why the import exists:

```ts
// 1. Pass it in. The caller, higher up, already knows; the lower feature takes a value or a function.
// ✗ workspaces/access.ts: import { seatOfViewer } from '../calls/participants';
// ✓ workspaces/access.ts: export async function canOpen(o: Owner, id: string, seated: (callId: string) => Promise<boolean>)
//   calls/workspace/…:    canOpen(o, id, (callId) => isSeated(o, callId))

// 2. Move it down to the feature that owns its data, so both sides import it from there.

// 3. Move a shared constant or type down (or into @alcove/api when it's on the wire).
// ✗ billing/storage.ts: import { TREE_NOTICE } from '../workspaces/access';

// 4. Compose above the features: a flow that reaches into everything (signing in, deleting an account) lives in
//    `account`, the top feature, or in app.ts / start.ts / maintenance.ts.
```

Tests (`*.integration.test.ts`) may import any feature.

### "X/ is shared and never imports a feature"

Shared homes are what features build on. When shared code needs feature behaviour, the composition passes it in:

```ts
// ✗ live/room.ts: import { canRead } from '../features/workspaces/access';
// ✓ live/room.ts takes `canRead` in its options; start.ts (composition) builds the room with workspaces' function.
```

### "an import cycle of N files ties together A, B"

The message prints one loop. Find the edge in it that points up the dependency direction (or out of a shared home), and
fix that edge with one of the four patterns above. Type-only imports don't count toward a cycle; runtime ones do.

### "lib/ … never imports one" (web)

`lib/` is shared by every feature. Move the feature's piece into the feature, or pass it in from the feature that calls.

### "useState … in a route file"

A route file declares the route (loader, `beforeLoad`, `validateSearch`) and renders its feature's page component.
Move the component, with its state, effects and refs, into the feature:

```tsx
// routes/record.live.tsx
export const Route = createFileRoute('/record/live')({ validateSearch: LiveSearch, component: LiveRecordPage });
// features/record/LiveRecordPage.tsx holds what the route used to.
```

### "X owns N effects (at most 10)"

Each effect is a lifecycle: something started that must stop. Give each lifecycle a hook in the subfeature that owns it,
with explicit inputs and its own cleanup, and keep the component as the composition that calls the hooks:

```ts
// features/call/timer/useTimerSound.ts
export function useTimerSound(timer: CallTimerView | undefined, muted: boolean): void {
  useEffect(() => {
    if (!timer?.running || muted) return;
    const stop = scheduleChime(timer.endsAt);
    return stop;
  }, [timer?.running, timer?.endsAt, muted]);
}
```

Keep effect order where it matters (connections before subscriptions), reference counting, and closures that read the
current state. One hook per lifecycle; a single `useEverything` hook only moves the problem.

### "X keeps N pieces of state (at most 15)"

A component holding that much state is several components in one. Find the parts of the screen that each use only some of
it (a panel, a dialog, a row of controls), and give each a component in its subfeature, with the state it alone uses and
props for what it shares. State that several parts change together can become one `useReducer`. Keep shared state where
it's read, and pass handlers down rather than lifting everything to the top.

### Naming

API, packages, Storybook helpers and every folder: `kebab-case`. Web app: `PascalCase.tsx` for a file whose main export
is a component, `camelCase.ts(x)` for anything else (`useCallTimer.ts`, `queries.ts`). Story files: `PascalCase` for what
they show, `NN-kebab-case` for a journey. Rename with `move-files.mjs`.

### "index files", "wildcard re-export", "helper bucket"

Import the file that owns the thing. Only package entries (`packages/*/src/index.ts`) re-export, and only they are index
files. A folder called `utils`, `common`, `misc` or `helpers` says nothing: name it for its responsibility, or put each
piece with its owner.
