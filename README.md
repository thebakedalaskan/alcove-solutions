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

**Status:** real Google sign-in with Google Calendar (Microsoft and SSO are still demo identities, with a
sample calendar and company directory), single-participant calls with real media, encrypted notes
recordings, a live transcript and written notes from NEAR AI Cloud's verified private inference, asking
about a call, sharing notes with everyone invited, credits charged for notes, CI and a deploy pipeline.
Multi-party calls, invite emails, credit purchases and confidential compute are next; see the roadmap.

## Running the app

The app lives in a pnpm + Turborepo monorepo (see `AGENTS.md` for the full rules). You need Node 24,
pnpm and Docker.

```
cp .env.example .env   # then fill in KMASTER and KSERVICE; Google and NEAR AI are optional
pnpm install
pnpm dev               # Postgres + RustFS in Docker, API on :8787, web app on http://localhost:3000
pnpm check             # test policy, strict typing, typecheck, integration tests, builds
```

- `apps/web`: TanStack Start, React 19, Tailwind v4, Motion
- `apps/api`: the API (Hono, Postgres, S3-compatible objects, sessions and sealed records)
- `packages/ui`: the Alcove design system
- `packages/api`: the contract (zod schemas + `AlcoveApi`); `packages/api-http`: the browser client
- `infra/` and `.github/`: deployment guide, GCP bootstrap, CI, deploy pipeline, branch ruleset

Sign in with **Continue with Microsoft** to be Art Vandelay, with a sample calendar and a company directory
already filled in. **Use single sign-on** with an address at example.com (or vandelay.industries) to be a
second person, for example to see notes shared with someone; nothing checks it, so real addresses are refused. Both are demo identities. **Continue with Google** signs in your own Google account
and shows your Google Calendar; it needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from a Google web
OAuth client with `$API_URL/v1/auth/google/callback` as a redirect URI. With `NEAR_AI_API_KEY` set, calls
and room recordings get a live transcript and written notes; without it, recordings are kept and their
notes wait. Calls need camera and microphone permission; everything else is in `docs/`. After a change to
`apps/api/migrations/`, run `pnpm db:reset`.
