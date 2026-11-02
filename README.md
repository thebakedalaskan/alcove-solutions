# The Privacy Suite

A personal desktop workspace for confidential documents, private chat, Google Meet transcripts and prepaid processing.

Start with the **[MVP build guide](docs/README.md)**. It links the complete product scope, seven engineering contracts, payment and privacy flows, deployment/acceptance plan, implementation backlog and provider references.

| Section | Contents |
| --- | --- |
| [Product](docs/product/overview.md) | MVP goals and owner journeys |
| [Engineering](docs/engineering/system-architecture.md) | Architecture, keys/sessions, files, chat, meetings, payment and deployment |
| [Delivery](docs/delivery/build-plan.md) | Build order, decisions and [35 tasks / 105 acceptance criteria](docs/delivery/tasks.md) |
| [References](docs/references/stack-and-provider-setup.md) | Concrete stack choices, provider setup and primary sources |

This repository currently contains the implementation plan. Software implementation, deployment and live-provider acceptance remain **Not run**. The confidentiality boundary and accepted provider assumptions are documented explicitly in the guide and engineering contracts.

## Running the app

The frontend lives in a pnpm + Turborepo monorepo (see `AGENTS.md` for the full rules).

```
pnpm install
pnpm dev        # http://localhost:3000, mock backend in the browser
pnpm check      # test policy, strict typing, typecheck, integration tests, build
```

- `apps/web`: TanStack Start, React 19, Tailwind v4, Motion
- `packages/ui`: the Alcove design system
- `packages/api`: the backend contract (zod schemas + `AlcoveApi`)
- `packages/api-mock` / `packages/api-http`: mock and real implementations

Switch to a real backend with `VITE_ALCOVE_API=http VITE_ALCOVE_API_URL=https://…` (see
`apps/web/.env.example`). With the mock, add `?scenario=fresh`, `?scenario=demo` or
`?scenario=signed-out` to any URL, or use the gear button, to change the account's state.
