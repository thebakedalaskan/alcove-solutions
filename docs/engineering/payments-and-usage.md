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
  51,111 credits and 30 USD is 30,000), however small; it's held only when it buys no whole credit. Until the
  deadline the address stays shown, and anything else sent to it is added to what arrived and swapped as a whole.
- **Refunded in part** (some swapped): the whole amount sent, which all reached the treasury, by the first three rules.

Credits are only added for money 1Click says reached the treasury, in amounts that agree with each other. A settled
answer credits only when what came out of the swap (USDC on NEAR) plus what was refunded to the treasury is at least
98.5% of what was sent (1Click's fee and up to 1% slippage, with room to spare), what was sent is above 0 and no more
than the most credits one top-up adds cost (8,000 USD for 10,000,000), and every amount that comes with 1Click's own
decimal rendering of it agrees with it. Anything else credits
nothing: the deposit is `arriving`, logged at error once with the reason, and fails at its deadline so it reaches
support.

## Status

| Part | State |
| --- | --- |
| Billing account per owner, welcome grant, history | Working. Deleting the account deletes its billing account and history; signing in again opens a new account with the welcome grant |
| Balance and history sealed under `Kservice` (never under owner keys) | Working |
| Charging for notes | Working. When the notes worker writes a note, `billing.charge` takes 25 credits a minute (rounded up, at least one) in the same transaction, under a row lock, as a history entry "Notes, N min". A note finished without notes (nothing was transcribed, or the notes model failed three times) costs nothing, and neither do the live transcript, a call's live notes, catching up, asking, or asking about a selection in a document: NEAR AI's requests for those go on Alcove's key, and nobody's credits, the organizer's or whoever is watching's, pay for them. |
| Minutes charged | The minutes recorded: the seconds of encrypted audio across every segment of the note's recording, rounded up. Time in a call with notes off is free. |
| Used this month | Working. The balance (`GET /v1/credits`) carries `usedThisMonth`: the credits charged since 00:00 UTC on the 1st of the current month, summed from the history's charges by the time each was made. In minutes of notes, that's `usedThisMonth / perMinute`. |
| Admission | Not built: nothing checks the balance before recording or transcribing, and a charge can take it below zero |
| Top-up routes (`GET /v1/credits/routes`) | Working. USDC on NEAR, Ethereum, Base, Arbitrum, Solana, Polygon, BNB Chain, Optimism and Avalanche, and USDT on NEAR, Ethereum, Solana, Tron, Polygon, BNB Chain, Optimism and Avalanche, while 1Click lists them, each with its minimum in tokens and in credits, with the tiers, the presets and credits per minute. A server without `TREASURY_INTENTS_ACCOUNT` answers `unavailable` on every top-up endpoint; `ONECLICK_API_KEY` is optional and only lowers 1Click's fee |
| Opening a top-up (`POST /v1/credits/top-ups`) | Working. For a number of credits (refused with `invalid` below the route's minimum in credits, or above 10,000,000), a 1Click quote paying the treasury exactly their price gives a one-off deposit address on the route's chain, open for 24 hours; the deposit is kept sealed under `Kservice` (`deposits`, record kind `deposit`). At most 10 a minute per account per API instance (then `unavailable`); refused with `conflict` while the account has 15 top-ups waiting for a payment to an address that hasn't expired, or has opened 30 in the last 24 hours (cancelled ones count). Both counts are checked in Postgres, again under a lock on the account in the transaction that inserts the deposit, so they hold across instances and concurrent requests. |
| Cancelling a top-up (`POST /v1/credits/top-ups/:id/cancel`) | Working. Only a `waiting` top-up (nothing has reached it) can be cancelled; anything else is refused with `conflict`. It becomes `cancelled`: its address is no longer shown, and it no longer counts toward the 15 waiting or among the open top-ups. 1Click can't cancel a quote, so the address still takes a payment until it expires: a cancelled deposit is watched (every 5 minutes), and a payment that reaches it moves it on and is credited by the usual rules. It still counts toward the 30 a day. In one transaction under the deposit's row lock, so it can't race a credit |
| Crediting a top-up | Working. On `SUCCESS` or `REFUNDED` that passes the checks under Pricing, what was sent is credited by the rules there, in the transaction that marks the deposit `credited`, under its row lock: once, however many checks race. Nothing creditable is `held`; `FAILED` is `failed`, logged at error. A `failed`, `expired` or `cancelled` deposit still credits when 1Click later settles it (logged at warn when it had been given up on) |
| Watching top-ups | Working. The API checks every open deposit with 1Click (no webhook): every 10 s for 15 minutes, every minute until 2 hours, then every 5 minutes; a cancelled one every 5 minutes. Opening a top-up in the app also checks it, at most every 5 s (the slot is claimed in one statement, so requests at once ask 1Click once), and at most 60 times a minute per account. 24 hours after its address expires, 1Click is asked once more: a finished swap is credited as usual, a deposit 1Click says nothing reached is `expired` (a cancelled one stays `cancelled`), and anything else is `failed`, logged at error. If 1Click can't answer then, the deposit stays as it is (never `expired` without 1Click saying nothing arrived), asked about hourly until 1Click answers, logged at error once. A `failed`, `expired` or `cancelled` deposit is asked about hourly until 30 days after its address expired, so a payment 1Click settles late is still credited The schedule thins out over time: an open deposit every 5 minutes for the rest of its first day, then hourly; a cancelled one every 5 minutes for a day, then hourly; and after `give_up_at` (or once failed or expired) hourly for a day, every 6 hours for a week, then daily. Open deposits are claimed before that long tail, so a payment just sent never waits behind it. Wherever this page says "hourly" for a deposit past its deadline, that's this thinning schedule. |
| Adding credits in the app | Working. Plan and credits opens a sheet: choose 10,000, 50,000 or 100,000 credits or your own number (each with its notes time and price, and the discount), then a token and its chain, and get an address (with a QR code) for one payment of exactly that price; the sheet follows it until it's added; while it waits for a payment it can be cancelled there; open and recent top-ups are listed there and open the sheet again, and one waiting for a payment can be cancelled from its row |

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
   `features/billing/oneclick.ts` that 1Click currently lists in `/v0/tokens` (cached for 10 minutes), with its minimum (in
   tokens, and the credits it buys), the tiers, the presets and credits per minute. The app prices a choice from the
   tiers before asking; the server's quote is what counts.
2. **Address.** `POST /v1/credits/top-ups { routeId, credits }` prices the credits (`priceFor`) and asks 1Click for a
   `FLEX_INPUT` quote for exactly that amount of the token, whose recipient and refund target are both the treasury's
   Intents account (fields in [Stack and provider setup › 1Click as built](../references/stack-and-provider-setup.md#1click-as-built)).
   A quote for another amount, whose `minAmountIn` is more than 1.5% below it, whose repeated `quoteRequest` isn't
   what was asked (treasury, `INTENTS`, the route's token, USDC on NEAR, `FLEX_INPUT`, the amount), or whose deadline
   is under an hour or over 7 days away, is refused as unavailable and logged at error (without amounts): a payment
   anywhere in the band earns the full promise. Each route's decimals are pinned in the allowlist; a route 1Click
   lists with other decimals isn't offered (logged at error). A failure to list tokens is remembered for 30 s.
   The deposit's route, address, memo, expiry, the amount asked, the quote's `minAmountIn`, the credits promised and
   the rate they were priced at, and the whole signed quote are sealed in a `deposit` record; its row holds only the
   owner, ID, provider, state and when to look again. The top-up says what to send (`asked`), and shows its address
   while it's `waiting` or `short`, until its expiry: a short payment can be completed at the same address. Once 1Click reports what was deposited, the top-up says
   so (`received`), with the credits it added once settled.
3. **Watching.** The watcher (`watch` in `features/billing/deposits.ts`, run every 5 s by `startWatching`, which `server.ts` starts; one pass at a time)
   claims up to 20 due deposits with `FOR UPDATE SKIP LOCKED`, pushing their next check ahead by a lease longer than
   a worst-case pass (5 rounds of 4, each one 1Click call and up to 8 statements at their 15 s timeouts, half as much
   again: about 17 minutes) so another API instance skips them, then asks 1Click's `/v0/status` about each, 4 at a
   time, and records the answer. `GET /v1/credits/top-ups/:id` checks the same way. Overlapping checks cannot reduce the amount already received or add credits twice. 1Click being down leaves a deposit
   as it was, logged at warn, and it's asked again in a minute. An unknown status is logged at warn and the deposit
   stays as it is (at the deadline it fails); a `SUCCESS` or `REFUNDED` that doesn't read or fails the checks under
   Pricing is logged at error once per reason and the deposit is `arriving`, so its address is no longer shown. An
   `arriving` or `short` deposit never goes back to `waiting`, and a `cancelled` one stays `cancelled` until a payment
   reaches it. At the deadline (24 h after the address expires) 1Click is asked a last time; anything but a finished
   swap gives up on the deposit (below). If 1Click can't answer then, the deposit stays as it is and is asked about
   hourly.
4. **Credit.** When the swap settles, the deposit's state and the balance change in one transaction with the
   deposit row locked (then the billing row), so a deposit credits at most once. The history entry reads
   "Credits added, 25 USDC".

| 1Click status | State | Next |
| --- | --- | --- |
| `PENDING_DEPOSIT` | `waiting` | keep watching |
| `KNOWN_DEPOSIT_TX`, `PROCESSING` | `arriving` | keep watching |
| `INCOMPLETE_DEPOSIT` | `short`: less than the band arrived. The address stays shown with what is left to send: 1Click adds anything else sent to it before its deadline and swaps the total (credited as `SUCCESS`); otherwise it refunds what arrived to the treasury at the deadline, and that is credited then (as `REFUNDED`). Nothing is credited before the money reaches the treasury | keep watching |
| `SUCCESS`, `REFUNDED`, passing the checks under Pricing | `credited`, or `held` when what arrived buys no whole credit | done |
| `SUCCESS`, `REFUNDED` that doesn't read or fails those checks | `arriving` (a `failed` or `expired` one is `failed`), nothing credited | logged at error once per reason; keep watching |
| `FAILED` | `failed` | logged at error; asked about hourly (1Click refunds a failed swap to the treasury, and that's credited) |
| `PENDING_DEPOSIT` at the last check, 24 h after the address expires | `expired` | asked about hourly; credited if 1Click later settles a payment, `failed` if it reports one on its way |
| no answer at the last check | unchanged | asked about hourly until 1Click answers; logged at error once |
| cancelled by the person while `waiting` (`POST /v1/credits/top-ups/:id/cancel`) | `cancelled`: the address is no longer shown. A later `PENDING_DEPOSIT` leaves it `cancelled`; any other status moves it on as for a `waiting` deposit | asked about every 5 minutes until the last check, then hourly; a payment moves it on and the watcher takes it up again at once |
| `arriving` or `short` then, by the deposit's row or by that last answer, a status Alcove doesn't know then, or a doubtful finished swap | `failed` | logged at error; asked about hourly |
| the deposit's record no longer opens at the last check | `failed` | logged at error; not asked about again |
| `failed`, `expired` or `cancelled`, 30 days after the address expired (29 after the last check) | unchanged | not asked about again |

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
- **A failed top-up** (logged at error with its deposit ID and a reason) is one 1Click reported money for that
  wasn't credited: the amounts didn't add up, or
  it was still on its way at the deadline. Support opens its record and 1Click's status as above, and credits by hand
  only what 1Click shows reached the treasury. If 1Click settles it cleanly within 30 days, it's credited by itself.
- **A depeg (accepted risk).** Refunds, and every amount sent, are valued at face (1 token = 1 USD), so while a
  stablecoin trades below 1 USD people can buy credits below cost with it. Alcove accepts this. When one depegs, turn
  top-ups off (take `TREASURY_INTENTS_ACCOUNT` out of the API's settings in `deploy.yml` and redeploy) until it recovers. While they're off nothing is checked
  or credited; once they're on again the watcher picks up every deposit it still watches.

## Upgrade for stablecoin top-ups

Migration `0022_deposits.sql` follows main's `0021_private_call_messages.sql` and adds only the deposits table and its
watcher index. Existing migrations are unchanged. The previous API ignores the new table while the deployment migrates.
Existing sealed billing records keep their shape; credits are positive entries in the existing history format.
