# Alcove docs

Alcove is private video calls with confidential AI notes built in: no bots in the meeting, no recording
behind people's backs, and notes only the people in the call can read.

## Read in this order

1. **Product.** [Overview](product/overview.md) (why, what, current status) and [User flows](product/user-flows.md).
2. **Architecture.** [System architecture](engineering/system-architecture.md) and
   [Privacy, keys and sessions](engineering/privacy-keys-and-sessions.md): the trust model, every key, and what is still visible.
3. **How it works.** [Data and storage](engineering/data-and-storage.md),
   [Calls and recordings](engineering/calls-and-recordings.md), [Notes and inference](engineering/notes-and-inference.md),
   [Payments and usage](engineering/payments-and-usage.md).
4. **Shipping.** [Deployment and acceptance](engineering/deployment-and-acceptance.md) and [infra/README.md](../infra/README.md).
5. **Planning.** [Roadmap](delivery/roadmap.md) and [Decisions and provider assumptions](delivery/decisions-and-provider-assumptions.md).
6. **Background.** [Stack and provider setup](references/stack-and-provider-setup.md) and [Source evidence](references/source-evidence.md),
   written for the earlier desktop design; still the reference for NEAR AI, Phala and 1Click details.

Design work lives in [`design/`](design/) (interactive prototypes) and [`brand/`](brand/).
Rules for anyone changing the code, people or agents, are in [`AGENTS.md`](../AGENTS.md).

## Provider boundaries

| ID | Provider | Role | Status |
| --- | --- | --- | --- |
| `C01` | Confidential compute (Phala TDX or a GCP confidential VM) | Runs the API as the trusted plaintext endpoint | Required before production |
| `I01` | NEAR AI Cloud | Transcription and note writing, end-to-end encrypted requests | Key configured, not called |
| `P01` | NEAR Intents 1Click | USDC credit purchases | Not connected |
| `D01` | Postgres | Ciphertext rows | Working (local); Cloud SQL prepared |
| `O01` | S3-compatible store | Ciphertext objects | Working (RustFS); R2 prepared |
