---
name: strict-typescript
description: Use when writing or changing any TypeScript in the Alcove repo, or when `pnpm typecheck` reports a strict-typing violation (any, `as` assertion, non-null `!`, @ts-ignore). Shows the replacement pattern for each banned escape hatch.
---

# Strict TypeScript in Alcove

`scripts/check-types.mjs` rejects `any`, type assertions (except `as const`), non-null assertions and
`@ts-*` / lint-disable comments. `tsc` runs with `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns` and the
unused checks. Never work around a violation. Use the matching pattern below.

Run `pnpm typecheck` after every change. It runs the guard first, then `tsc` in each package.

## Untrusted data: parse it

```ts
// ✗ const db = JSON.parse(raw) as DB;
// ✓
const parsed = DBSchema.safeParse(JSON.parse(raw));
if (parsed.success) return parsed.data;
```

All domain types come from zod schemas in `packages/api/src/types.ts` and `live.ts`
(`export type Meeting = z.infer<typeof MeetingSchema>`). A new API shape starts as a schema.
The HTTP client parses every response with one (`req(MeetingSchema, 'GET', ...)`).

## Errors

```ts
// ✗ catch (e) { toast((e as Error).message) }
// ✓
catch (e) { toast(errorMessage(e)); }          // from @alcove/api
if (errorCode(e) === 'network') retry();
```

## DOM events

```ts
// ✗ (e.target as HTMLElement).closest('input')
// ✓
const inField = e.target instanceof Element && !!e.target.closest('input,textarea');
```

## Maybe-missing values

```ts
// ✗ const me = state.participants.find((p) => p.isMe)!;
// ✓
const me = selfIn(state);
if (!me) return null;

// ✗ DAYS[i]!
// ✓
const dayAt = (i: number): Date => DAYS[i] ?? new Date();

// ✗ guests.map((g) => g.person!)
// ✓
guests.flatMap((g) => (g.person ? [g.person] : []));
```

## Narrowing unions

```ts
// ✗ LIVE_ITEMS[step.tag as 'act0' | 'act1']
// ✓
if (step.tag === 'act0' || step.tag === 'act1') LIVE_ITEMS[step.tag];

// ✗ 'kind' in line
// ✓ give the union a discriminant and switch on it
if (line.kind === 'screen') ...
```

## Literals and lookups

```ts
// ✗ [{ icon: 'mic' }].map((b) => <Icon name={b.icon as IconName} />)
// ✓
([{ icon: 'mic' }] satisfies { icon: IconName }[]).map((b) => <Icon name={b.icon} />);

// ✗ ({ long: …, bob: … })[p.style as 'long']
// ✓
const backs: Partial<Record<PortraitHair, ReactNode>> = { long: …, bob: … };
const back = backs[p.style];
```

## Env, storage, search params

```ts
// ✗ (import.meta.env.VITE_ALCOVE_API ?? 'mock') as 'mock' | 'http'
// ✓
const mode: 'mock' | 'http' = import.meta.env.VITE_ALCOVE_API === 'http' ? 'http' : 'mock';

// ✓ search params come in as Record<string, unknown>
validateSearch: (s: Record<string, unknown>): { id?: string | undefined } => {
  const id = s['id'];
  return { id: typeof id === 'string' ? id : undefined };
}
```

## Module-level mutable state

```ts
// ✗ export const sessions = { call: null as CallRef | null };
// ✓
export const sessions: { call: CallRef | null } = { call: null };
```

## CSS custom properties

`packages/ui/src/css-vars.ts` augments `React.CSSProperties` with `--*` keys, so
`style={{ '--i': 2 }}` type-checks without a cast.

## Optional props under exactOptionalPropertyTypes

If callers may pass `undefined` explicitly, say so: `meetingId?: string | undefined`.
