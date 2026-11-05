# Payments and usage

[Docs home](../README.md) · [Notes and inference](notes-and-inference.md) · [Privacy, keys and sessions](privacy-keys-and-sessions.md)

## Pricing

Calls are free, with or without anyone else. Notes and room recordings cost **25 credits per recorded minute**.
New accounts receive **10,000 credits** (about 6½ hours of notes). More credits are bought by sending USDC or
USDT, any amount from the route's minimum (5 USD, 20 on Ethereum). The rate is a tier picked by what one deposit
sent, applied to what reached the treasury, rounded down to whole credits (`TIERS` in `billing.ts`):

| Sent in one deposit | Credits per USD |
| --- | --- |
| under 45 USD | 1,000 |
| 45 to under 80 USD | 1,111.11… (10,000/9) |
| 80 USD and over | 1,250 |

So 10 USDC buys 10,000 credits, 45 buys about 50,000 and 80 about 100,000, less the swap's fee (a few credits).

## Status

| Part | State |
| --- | --- |
| Billing account per owner, welcome grant, history | Working. Deleting the account deletes its billing account and history; signing in again opens a new account with the welcome grant |
| Balance and history sealed under `Kservice` (never under owner keys) | Working |
| Charging for notes | Working. When the notes worker writes a note, `billing.charge` takes 25 credits a minute (rounded up, at least one) in the same transaction, under a row lock, as a history entry "Notes, N min". A note finished without notes (nothing was transcribed, or the notes model failed three times) costs nothing, and neither do the live transcript or asking. |
| Minutes charged | The minutes recorded: the seconds of encrypted audio across every segment of the note's recording, rounded up. Time in a call with notes off is free. |
| Used this month | Working. The balance (`GET /v1/credits`) carries `usedThisMonth`: the credits charged since 00:00 UTC on the 1st of the current month, summed from the history's charges by the time each was made. In minutes of notes, that's `usedThisMonth / perMinute`. |
| Admission | Not built: nothing checks the balance before recording or transcribing, and a charge can take it below zero |
| Top-up routes (`GET /v1/credits/routes`) | Working. USDC on NEAR, Ethereum, Base, Arbitrum, Solana, Polygon, BNB Chain, Optimism and Avalanche, and USDT on NEAR, Ethereum, Solana, Tron, Polygon, BNB Chain, Optimism and Avalanche, while 1Click lists them, with the tiers. A server without `ONECLICK_API_KEY` and `TREASURY_INTENTS_ACCOUNT` answers `unavailable` on every top-up endpoint |
| Opening a top-up (`POST /v1/credits/top-ups`) | Working. A 1Click quote paying the treasury gives a one-off deposit address on the route's chain, open for 24 hours; the deposit is kept sealed under `Kservice` (`deposits`, record kind `deposit`) |
| Crediting a top-up | Working. On `SUCCESS` or `REFUNDED`, what reached the treasury (the USDC out, plus a refund of at least 1 USD) is credited at the tier's rate, in the transaction that marks the deposit `credited`, under its row lock: once, however many checks race. Nothing creditable is `held`; `FAILED` is `failed`, logged at error |
| Watching top-ups | Working. The API checks every open deposit with 1Click (no webhook): every 10 s for 15 minutes, every minute until 2 hours, then every 5 minutes. Opening a top-up in the app also checks it, at most every 5 s. 24 hours after its address expires, 1Click is asked once more: a finished swap is credited as usual, a deposit nothing reached is `expired`, and one still arriving (or whose record no longer opens) is `failed` |
| Adding credits in the app | Not built |

## Design to implement

- **Admission before work.** Transcription now runs during the recording, so the check belongs where notes or
  a room recording start: reserve the maximum cost then, and settle to the actual recorded minutes when the
  notes are written. Reservations and settlements are entries in the sealed billing state, applied under a
  row lock with a version check.
- **Privacy of accounting.** The billing module receives quantities and purchase bindings, never content or
  owner keys. Before payments ship, key billing rows by a random account ID with a separate owner tag rather
  than the clear `owner_id`, and keep amounts as integer strings rather than floating-point numbers.

## How a top-up works

1. **Routes.** `GET /v1/credits/routes` lists one route per stablecoin and chain on the allowlist in
   `payments/oneclick.ts` that 1Click currently lists in `/v0/tokens` (cached for 10 minutes), with its minimum, and
   the tiers.
2. **Address.** `POST /v1/credits/top-ups { routeId }` asks 1Click for a quote whose recipient and refund target are
   both the treasury's Intents account (fields in [Stack and provider setup › 1Click as built](../references/stack-and-provider-setup.md#1click-as-built)).
   The deposit's route, address, memo, expiry and the whole signed quote are sealed in a `deposit` record; its row
   holds only the owner, ID, provider, state and when to look again. The top-up shows its address only while money
   can still be sent to it (`waiting`, `short`). An address is for one payment.
3. **Watching.** The watcher (`watch` in `modules/deposits.ts`, run every 5 s from `server.ts`, one pass at a time)
   claims up to 20 due deposits with `FOR UPDATE SKIP LOCKED`, pushing their next check a minute ahead so another
   API instance skips them, then asks 1Click's `/v0/status` about each, 4 at a time, and records the answer. `GET /v1/credits/top-ups/:id`
   checks the same way. 1Click being down leaves a deposit as it was, logged at warn, and it's asked again in a
   minute. An unknown status is logged at warn and the deposit stays open. At the deadline (24 h after the address
   expires) 1Click is asked a last time; anything but a finished swap gives up on the deposit (below).
4. **Credit.** When the swap settles, the deposit's state and the balance change in one transaction with the
   deposit row locked (then the billing row), so a deposit credits at most once. The history entry reads
   "Credits added, 25 USDC".

| 1Click status | State | Next |
| --- | --- | --- |
| `PENDING_DEPOSIT` | `waiting` | keep watching |
| `KNOWN_DEPOSIT_TX`, `PROCESSING` | `arriving` | keep watching |
| `INCOMPLETE_DEPOSIT` | `short` | keep watching |
| `SUCCESS`, `REFUNDED` | `credited`, or `held` when nothing creditable arrived (a refund under 1 USD) | done |
| `FAILED` | `failed` | done; logged at error |
| none at the last check, 24 h after the address expires (or 1Click can't answer it) | `expired` | done |
| still `arriving` or `short` then, or the deposit's record no longer opens | `failed` | done; logged at error |

Logs about a deposit carry its ID, provider, states, counts and durations, never the address, amounts, hashes or
the quote. Deleting an account deletes its deposits; a payment still on its way reaches the treasury and is
credited to nobody.

## Treasury runbook

The server never holds a key that can move treasury money. By hand, in near.com, signed in as the treasury account:

- **Refunds.** A refund lands in the treasury's Intents balance as the token that was sent, not USDC. Swap these to
  USDC on NEAR from time to time.
- **Withdrawals.** Withdraw USDC from the Intents balance in batches, when topping up NEAR AI, not after every
  payment: each withdrawal costs a flat 0.004615 USDC.
- **A stray payment** (a second payment to a used address, or one after it expired) reaches the treasury as a 1Click
  refund and isn't credited. The person gives support the top-up's reference (its deposit ID). Support opens that
  deposit's sealed record (`deposits`, under `Kservice`'s accounting key) to find its address, confirms the payment
  in 1Click's status for it, and adds the credits by hand at the tier's rate.
