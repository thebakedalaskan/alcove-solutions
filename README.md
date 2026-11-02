# Alcove (the-privacy-suite)

Private video calls with confidential AI notes built in. No note-taker bots in the meeting, no recording
behind people's backs: notes are a service of the call, written where the operator can't read them.

Start with the **[docs](docs/README.md)**.

| Section | Contents |
| --- | --- |
| [Product](docs/product/overview.md) | Why, what, current status, [user flows](docs/product/user-flows.md) |
| [Engineering](docs/engineering/system-architecture.md) | Architecture, [privacy and keys](docs/engineering/privacy-keys-and-sessions.md), storage, calls, notes, payments, deployment |
| [Roadmap](docs/delivery/roadmap.md) | Done and next |
| [Deploying](infra/README.md) | GCP + Cloudflare setup, CI/CD, merge rules |

**Status:** a working local stack with passkey accounts, single-participant calls with real media,
encrypted notes recordings, CI and a prepared deploy pipeline. Transcription and note writing (NEAR AI),
multi-party end-to-end encrypted calls and confidential compute are next; see the roadmap.

## Running the app

The app lives in a pnpm + Turborepo monorepo (see `AGENTS.md` for the full rules). You need Node 24,
pnpm and Docker.

```
cp .env.example .env   # then fill in KSERVICE (and NEAR_AI_API_KEY if you have one)
pnpm install
pnpm dev               # Postgres + RustFS in Docker, API on :8787, web app on http://localhost:3000
pnpm check             # test policy, strict typing, typecheck, integration tests, builds
```

- `apps/web`: TanStack Start, React 19, Tailwind v4, Motion
- `apps/api`: the API (Hono, Postgres, S3-compatible objects, WebAuthn with PRF)
- `packages/ui`: the Alcove design system
- `packages/api`: the contract (zod schemas + `AlcoveApi`); `packages/api-http`: the browser client
- `infra/` and `.github/`: deployment guide, GCP bootstrap, CI, deploy pipeline, branch ruleset

Use a browser with passkey support (current Chrome, Edge or Safari). Calls need camera and microphone
permission; everything else is in `docs/`.
