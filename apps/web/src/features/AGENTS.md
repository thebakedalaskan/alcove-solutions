# Web feature ownership

Read the repository rules and `docs/engineering/folder-ownership.md` first.

- `call` owns the running session. Its subfeatures are `session`, `media`, `screen-sharing`, `layout`,
  `notes`, `rooms`, `workspace`, `boards` and `playback`. Add code to its owner; no loose source at the root.
- `calls` owns making/scheduling/listing/entering a call. Its subfeatures are `flow`, `scheduling`, `lobby`,
  `ringing` and `list`. Keep it distinct from running-call behavior.
- Router files declare routes and delegate to feature pages. Session composition connects stores/hooks and
  presentation; resource creation, subscriptions, timers and cleanup belong to explicit lifecycle modules.
- A new effect must state what it owns and dispose that resource in the same owner. Preserve reference-counted
  connections and current-state closures; moving an effect must preserve its dependencies and ordering.
- Keep backend access through `lib/api.ts`, query/mutation definitions through `lib/queries.ts`, live state in
  its `LiveStore` and reads through `useLive`. Do not mirror snapshots or create a second connection owner.
- Use owning-file imports, with no folder barrels, forwarding aliases or generic helper buckets. Reusable visuals
  belong in `@alcove/ui`; feature-owned presentation stays here. Update every existing consumer of a moved file.
- Behavior, markup, accessibility, light/dark styling and reduced-motion behavior survive a structural move.
  No unit/component/browser/Storybook tests or new stories for this refactor.
- Run `pnpm check:structure`, web build/typecheck and the repository checks; document affected manual call paths.
- Prefer graph discovery, but inspect its excluded-directory report. If it skipped `call/media`, use the documented
  owner path and source search rather than treating an empty graph result as missing implementation.
- A feature behind a feature flag shows on `useFeatureFlag(name)` from `~/lib/queries`, waiting while it's `undefined`
  ([docs/engineering/feature-flags.md](../../../../docs/engineering/feature-flags.md)); the server checks it too.
