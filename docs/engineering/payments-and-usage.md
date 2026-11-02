# Payments and usage

[Docs home](../README.md) · [Notes and inference](notes-and-inference.md) · [Privacy, keys and sessions](privacy-keys-and-sessions.md)

## Pricing

Calls are free, with or without anyone else. Notes and room recordings cost **25 credits per recorded minute**.
New accounts receive **10,000 credits** (about 6½ hours of notes). Credit packs: 10,000 for 10 USDC,
50,000 for 45 USDC, 100,000 for 80 USDC.

## Status

| Part | State |
| --- | --- |
| Billing account per owner, welcome grant, history | Working |
| Balance and history sealed under `Kservice` (never under owner keys) | Working |
| Charging for notes | Not yet: charges are applied when the notes worker writes a note |
| Buying credits (USDC through NEAR Intents 1Click, `P01`) | Not connected; `POST /v1/credits/purchases` returns `503 unavailable` |

## Design to implement

- **Admission before work.** The notes worker reserves the maximum cost of a job before calling inference, and
  settles to the actual recorded minutes afterwards. Reservations and settlements are entries in the sealed
  billing state, applied under a row lock with a version check.
- **Privacy of accounting.** The billing module receives quantities and purchase bindings, never content or
  owner keys. Before payments ship, key billing rows by a random account ID with a separate owner tag rather
  than the clear `owner_id`, and keep amounts as integer strings rather than floating-point numbers.
- **Purchases.** Quote, deposit and settlement follow the 1Click flow in `docs/references/stack-and-provider-setup.md`.
  A purchase credits the account exactly once per settled deposit (idempotent by the provider's ID).
