# Payments and usage

[Docs home](../README.md) · [Notes and inference](notes-and-inference.md) · [Privacy, keys and sessions](privacy-keys-and-sessions.md)

## Pricing

Calls are free, with or without anyone else. Notes and room recordings cost **25 credits per recorded minute**.
New accounts receive **10,000 credits** (about 6½ hours of notes). More credits are bought with USDC or USDT: the
person chooses how many credits (10,000, 50,000, 100,000 or their own number, at least what the route's minimum of
5 USD, 20 on Ethereum, buys), and is asked to send exactly their price. The rate is the tier of the credits bought
(`TIERS` in `billing.ts`); the price is the credits at that rate, rounded up to a millionth of a USD (`priceFor`):

| Credits in one top-up | Credits per USD | So |
| --- | --- | --- |
| under 50,000 | 1,000 | 10,000 for 10 USD, 46,000 for 46 |
| 50,000 to 99,999 | 1,111.11… (10,000/9) | 50,000 for 45 USD (10% off) |
| 100,000 and over | 1,250 | 100,000 for 80 USD (20% off) |

What's credited goes by what was sent, at face value; Alcove absorbs 1Click's fee:

- **At least what was asked:** the credits promised, plus the excess at the rate they were priced at.
- **Under what was asked but within 1Click's band** (at least the quote's `minAmountIn`, 99% of it with 1% slippage):
  exactly the credits promised.
- **Below the band**, or a swap refunded in full: 1Click doesn't swap it and refunds it to the treasury at the
  address's deadline. It's credited as what it buys by itself (`creditsForUsd`: the best tier it reaches, so 46 USD is
  51,111 credits and 30 USD is 30,000); a refund under 1 USD is held. Addresses take one payment: there's no "send
  the rest".
- **Refunded in part** (some swapped): the whole amount sent, which all reached the treasury, by the first three rules.

## Status

| Part | State |
| --- | --- |
| Billing account per owner, welcome grant, history | Working. Deleting the account deletes its billing account and history; signing in again opens a new account with the welcome grant |
| Balance and history sealed under `Kservice` (never under owner keys) | Working |
| Charging for notes | Working. When the notes worker writes a note, `billing.charge` takes 25 credits a minute (rounded up, at least one) in the same transaction, under a row lock, as a history entry "Notes, N min". A note finished without notes (nothing was transcribed, or the notes model failed three times) costs nothing, and neither do the live transcript or asking. |
| Minutes charged | The minutes recorded: the seconds of encrypted audio across every segment of the note's recording, rounded up. Time in a call with notes off is free. |
| Used this month | Working. The balance (`GET /v1/credits`) carries `usedThisMonth`: the credits charged since 00:00 UTC on the 1st of the current month, summed from the history's charges by the time each was made. In minutes of notes, that's `usedThisMonth / perMinute`. |
| Admission | Not built: nothing checks the balance before recording or transcribing, and a charge can take it below zero |
| Top-up routes (`GET /v1/credits/routes`) | Working. USDC on NEAR, Ethereum, Base, Arbitrum, Solana, Polygon, BNB Chain, Optimism and Avalanche, and USDT on NEAR, Ethereum, Solana, Tron, Polygon, BNB Chain, Optimism and Avalanche, while 1Click lists them, each with its minimum in tokens and in credits, with the tiers, the presets and credits per minute. A server without `ONECLICK_API_KEY` and `TREASURY_INTENTS_ACCOUNT` answers `unavailable` on every top-up endpoint |
| Opening a top-up (`POST /v1/credits/top-ups`) | Working. For a number of credits (refused with `invalid` below the route's minimum in credits, or above 10,000,000), a 1Click quote paying the treasury exactly their price gives a one-off deposit address on the route's chain, open for 24 hours; the deposit is kept sealed under `Kservice` (`deposits`, record kind `deposit`). At most 10 a minute per account (then `unavailable`), and refused with `conflict` while the account has 5 top-ups waiting for a payment to an address that hasn't expired |
| Crediting a top-up | Working. On `SUCCESS` or `REFUNDED`, what was sent is credited by the rules under Pricing, in the transaction that marks the deposit `credited`, under its row lock: once, however many checks race. Nothing creditable is `held`; `FAILED` is `failed`, logged at error |
| Watching top-ups | Working. The API checks every open deposit with 1Click (no webhook): every 10 s for 15 minutes, every minute until 2 hours, then every 5 minutes. Opening a top-up in the app also checks it, at most every 5 s. 24 hours after its address expires, 1Click is asked once more: a finished swap is credited as usual, a deposit nothing reached is `expired`, and one arriving or short by its row or by that last answer, or with a status Alcove doesn't know (or whose record no longer opens), is `failed`. If 1Click can't answer then, it's watched 6 hours more from then, once |
| Adding credits in the app | Working. Plan and credits opens a sheet: choose 10,000, 50,000 or 100,000 credits or your own number (each with its notes time and price, and the discount), then a token and its chain, and get an address (with a QR code) for one payment of exactly that price; the sheet follows it until it's added; open and recent top-ups are listed there and open the sheet again |

## Design to implement

- **Admission before work.** Transcription now runs during the recording, so the check belongs where notes or
  a room recording start: reserve the maximum cost then, and settle to the actual recorded minutes when the
  notes are written. Reservations and settlements are entries in the sealed billing state, applied under a
  row lock with a version check.
- **Privacy of accounting.** The billing module receives quantities and purchase bindings, never content or
  owner keys. Payments now ship with billing rows keyed by the clear `owner_id`; keying them by a random account
  ID with a separate owner tag is a flagged follow-up. Keep amounts as integer strings rather than floating-point
  numbers.

## How a top-up works

1. **Routes.** `GET /v1/credits/routes` lists one route per stablecoin and chain on the allowlist in
   `payments/oneclick.ts` that 1Click currently lists in `/v0/tokens` (cached for 10 minutes), with its minimum (in
   tokens, and the credits it buys), the tiers, the presets and credits per minute. The app prices a choice from the
   tiers before asking; the server's quote is what counts.
2. **Address.** `POST /v1/credits/top-ups { routeId, credits }` prices the credits (`priceFor`) and asks 1Click for a
   `FLEX_INPUT` quote for exactly that amount of the token, whose recipient and refund target are both the treasury's
   Intents account (fields in [Stack and provider setup › 1Click as built](../references/stack-and-provider-setup.md#1click-as-built)).
   A quote for another amount, or whose `minAmountIn` is more than 1.5% below it, is refused as unavailable and
   logged at error (without amounts): a payment anywhere in the band earns the full promise.
   The deposit's route, address, memo, expiry, the amount asked, the quote's `minAmountIn`, the credits promised and
   the rate they were priced at, and the whole signed quote are sealed in a `deposit` record; its row holds only the
   owner, ID, provider, state and when to look again. The top-up says what to send (`asked`), and shows its address
   only while it's `waiting`: an address is for one payment. Once 1Click reports what was deposited, the top-up says
   so (`received`), with the credits it added once settled.
3. **Watching.** The watcher (`watch` in `modules/deposits.ts`, run every 5 s from `server.ts`, one pass at a time)
   claims up to 20 due deposits with `FOR UPDATE SKIP LOCKED`, pushing their next check two minutes ahead (longer than a pass
   can take) so another API instance skips them, then asks 1Click's `/v0/status` about each, 4 at a time, and records the answer. `GET /v1/credits/top-ups/:id`
   checks the same way. 1Click being down leaves a deposit as it was, logged at warn, and it's asked again in a
   minute. An unknown status is logged at warn and the deposit stays as it is (at the deadline it fails); a `SUCCESS` or `REFUNDED` whose
   swap details don't read is logged at warn and the deposit is `arriving`, so its address is no longer shown. An
   `arriving` or `short` deposit never goes back to `waiting`. At the deadline (24 h after the address
   expires) 1Click is asked a last time; anything but a finished swap gives up on the deposit (below). If 1Click
   can't answer then, the deadline moves to 6 hours from then, once (marked in the sealed record), and it gives up after that.
4. **Credit.** When the swap settles, the deposit's state and the balance change in one transaction with the
   deposit row locked (then the billing row), so a deposit credits at most once. The history entry reads
   "Credits added, 25 USDC".

| 1Click status | State | Next |
| --- | --- | --- |
| `PENDING_DEPOSIT` | `waiting` | keep watching |
| `KNOWN_DEPOSIT_TX`, `PROCESSING` | `arriving` | keep watching |
| `INCOMPLETE_DEPOSIT` | `short`: less than the band arrived; the address is no longer shown, and 1Click refunds it to the treasury at the deadline | keep watching |
| `SUCCESS`, `REFUNDED` | `credited`, or `held` when nothing creditable arrived (a refund under 1 USD) | done |
| `FAILED` | `failed` | done; logged at error |
| none at the last check, 24 h after the address expires (or 1Click can't answer it, 6 h after that) | `expired` | done |
| `arriving` or `short` then, by the deposit's row or by that last answer, a status Alcove doesn't know then, or the deposit's record no longer opens | `failed` | done; logged at error |

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
  in 1Click's status for it, and adds the credits by hand as what it buys by itself (`creditsForUsd`).
