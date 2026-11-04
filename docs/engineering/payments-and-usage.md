# Payments and usage

[Docs home](../README.md) · [Notes and inference](notes-and-inference.md) · [Privacy, keys and sessions](privacy-keys-and-sessions.md)

## Pricing

Calls are free, with or without anyone else. Notes and room recordings cost **25 credits per recorded minute**.
New accounts receive **10,000 credits** (about 6½ hours of notes). Credit packs: 10,000 for 10 USDC,
50,000 for 45 USDC, 100,000 for 80 USDC.

## Status

| Part | State |
| --- | --- |
| Billing account per owner, welcome grant, history | Working. Deleting the account deletes its billing account and history; signing in again opens a new account with the welcome grant |
| Balance and history sealed under `Kservice` (never under owner keys) | Working |
| Charging for notes | Working. When the notes worker writes a note, `billing.charge` takes 25 credits a minute (rounded up, at least one) in the same transaction, under a row lock, as a history entry "Notes, N min". A note finished without notes (nothing was transcribed, or the notes model failed three times) costs nothing, and neither do the live transcript or asking. |
| Minutes charged | The minutes recorded: the seconds of encrypted audio across every segment of the note's recording, rounded up. Time in a call with notes off is free. |
| Used this month | Working. The balance (`GET /v1/credits`) carries `usedThisMonth`: the credits charged since 00:00 UTC on the 1st of the current month, summed from the history's charges by the time each was made. In minutes of notes, that's `usedThisMonth / perMinute`. |
| Admission | Not built: nothing checks the balance before recording or transcribing, and a charge can take it below zero |
| Buying credits (USDC through NEAR Intents 1Click, `P01`) | Not connected; there is no purchase endpoint |

## Design to implement

- **Admission before work.** Transcription now runs during the recording, so the check belongs where notes or
  a room recording start: reserve the maximum cost then, and settle to the actual recorded minutes when the
  notes are written. Reservations and settlements are entries in the sealed billing state, applied under a
  row lock with a version check.
- **Privacy of accounting.** The billing module receives quantities and purchase bindings, never content or
  owner keys. Before payments ship, key billing rows by a random account ID with a separate owner tag rather
  than the clear `owner_id`, and keep amounts as integer strings rather than floating-point numbers.
- **Purchases.** Quote, deposit and settlement follow the 1Click flow in `docs/references/stack-and-provider-setup.md`.
  A purchase credits the account exactly once per settled deposit (idempotent by the provider's ID).
