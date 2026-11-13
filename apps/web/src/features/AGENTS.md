# Web feature ownership

Read the repository rules and `docs/engineering/folder-ownership.md` first.

- `call` owns the running session. Its subfeatures are `session`, `media`, `screen-sharing`, `layout`, `stage`,
  `chat`, `attention`, `timer`, `notes`, `rooms`, `workspace`, `boards`, `playback` and `floating`. Add code to its
  owner; no loose source at the root. `InCall.tsx` composes: each lifecycle is a hook and each part of the screen a
  component in its subfeature (at most 10 effects and 15 pieces of state in any one).
- `calls` owns making/scheduling/listing/entering a call. Its subfeatures are `flow`, `scheduling`, `lobby`,
  `ringing` and `list`. Keep it distinct from running-call behavior.
- Code another feature needs lives with its owner, never in a page folder because that page used it first; made-up
  example content is `examples/`, notifications are `notifications/`, signing in and out is `account/`.
- Router files declare routes (loaders, guards, search schemas) and render a feature page; they hold no state, effects
  or refs. Session composition connects stores/hooks and
  presentation; resource creation, subscriptions, timers and cleanup belong to explicit lifecycle modules.
- A new effect must state what it owns and dispose that resource in the same owner. Preserve reference-counted
  connections and current-state closures; moving an effect must preserve its dependencies and ordering.
- Keep backend access through `lib/api.ts`, each feature's queries in its own `queries.ts` (keys in `queryKeys.ts`,
  which imports nothing), live state in
  its `LiveStore` and reads through `useLive`. Do not mirror snapshots or create a second connection owner.
- Use owning-file imports, with no folder barrels, forwarding aliases or generic helper buckets. Reusable visuals
  belong in `@alcove/ui`; feature-owned presentation stays here. Update every existing consumer of a moved file.
- Files: `PascalCase.tsx` for a component, `camelCase.ts(x)` otherwise; folders kebab-case; at most 20 files each.
- Behavior, markup, accessibility, light/dark styling and reduced-motion behavior survive a structural move.
- Run `pnpm check:structure`, web build/typecheck and the repository checks; document affected manual call paths.
- Prefer graph discovery, but inspect its excluded-directory report. If it skipped `call/media`, use the documented
  owner path and source search rather than treating an empty graph result as missing implementation.
- A feature behind a feature flag shows on `useFeatureFlag(name)` from `~/lib/featureFlags`, waiting while it's `undefined`;
  something set up once and kept, such as the call's room, reads the flags once as it starts and passes their names on
  ([docs/engineering/feature-flags.md](../../../../docs/engineering/feature-flags.md)); the server checks it too.
