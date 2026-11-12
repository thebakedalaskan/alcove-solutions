# Plans and usage

[Docs home](../README.md) · [Notes and inference](notes-and-inference.md) · [Privacy, keys and sessions](privacy-keys-and-sessions.md)

Every call gets its own workspace and board on every plan, kept afterwards in the Drive. Plans differ only in how much
they bring: notes and storage. Every feature is on every plan.

| | Free | Pro | Team |
| --- | --- | --- | --- |
| Price | $0 | $20 a period | $40 a person a period |
| Calls | Unlimited, up to 10 hours each, 100 people | Same | Same |
| Notes (an estimate: what a call uses varies) | About 5 hours a period | About 50 hours | About 50 hours a person |
| Storage (uploads and call recordings) | 10 GB | 100 GB | 100 GB a person, pooled |
| Largest file | 512 MB | 512 MB, 2 GB once downloads resume | Same as Pro |
| Shared workspaces not tied to a call | As many as you like (storage is the limit) | Same | Same |

A period is 30 days from when the plan began. Pro and Team are built in later phases: this page says what's built now.

Every number is a limit (`apps/api/src/limits.ts`, [Deployment › Changing a limit](deployment-and-acceptance.md#changing-a-limit)),
changeable without a deploy: each plan's notes, storage, files and price; the most workspaces one account makes; what an hour of notes is
reckoned at; when AI stops and when an organizer is told it's close; how long a period and a grace last; a call's longest
and its most people.

## Status

| Part | State |
| --- | --- |
| Free, for every account | Working. A new account is on Free from sign-up; an account from before plans is the first time it's touched after this release, or by upkeep. |
| The AI allowance, metered on every NEAR AI request | Working |
| Notes stopping, the 5-minute warning, the one note written past the allowance | Working |
| Storage per account, recordings included; grace | Working |
| A call's 10 hours and 100 people | Working |
| The USD balance, filled by stablecoin top-ups | Working |
| Buying Pro, renewing, refunds | Not built (phase 2) |
| Teams, licenses, team notes and workspaces | Not built (phase 3) |
| Picking a plan at first sign-in | Not built (phase 4). `Plan.choose` already says who hasn't. |
| Withdrawing the balance | Not built, and not planned yet |

## Notes: the AI allowance

Each plan brings an AI allowance for its period: its minutes of notes at what an hour of notes is reckoned at
(`ai.hour_micro_usd`, $0.50), so Free's 300 minutes are $2.50. The allowance is kept in dollars, sealed, and never
leaves the server: the app shows what's left as time ("About 3 h 20 min of notes left"), an estimate, since what a call
really costs depends on its model, how much is said and what's shared. What's shown is the allowance less what's been
spent, so it only goes down in a period. What's held below (for requests on their way, and for a live call's notes)
counts when the meter decides whether to warn or stop, but isn't shown: it's the most each could cost, and showing it
would make notes left dip while a note is written and rise again once it's charged at what it actually cost. Near the
end, notes can stop while a minute or two still shows; the banner says so. It doesn't carry over: a new period starts the
first time the account is touched after the old one ends, or after its plan changes, with all of its allowance.

**Every request to NEAR AI is paid for** (`features/billing/meter.ts`). `inference.ts`'s `transcribe`, `complete` and
`completeJson` take a required `Meter`, so nothing reaches NEAR AI without naming who pays:

1. Before it's sent, the most the request can cost is **held**: its text at a token a byte, each image at
   `ai.image_tokens`, and the output it asks for at most, at its model's price. It's refused (`plan-limit`, 402) if that
   would take what's left below `ai.stop_micro_usd` ($0.005), or once the allowance is spent.
2. Once NEAR AI answers 200 it's **charged** what NEAR AI says it used (cached input at its cache price), even when what
   came back can't be used: the model did the work. A reply that doesn't say what it used is reckoned (a quarter of its
   characters a token). A Whisper clip is reckoned from its length when NEAR AI doesn't say: 1,500 tokens in for every
   30 seconds, and its words out.
3. A request NEAR AI turned away (not 200), or that never went (its evidence didn't check out), is charged nothing. One
   that timed out once sent is charged what was held. A hold nothing settles within 5 minutes is charged in full the next
   time the meter is touched.

Prices come from NEAR AI's catalog (`GET /v1/models`: `pricing.input` and `pricing.output` in USD a million tokens,
`pricing.input_cache_read` a token), read with the list of models and kept as last listed through an outage
(`features/notes/models.ts` `priceOf`). A model the catalog has never priced is charged at `ai.fallback_input_micro_usd`
and `ai.fallback_output_micro_usd`, logged at warn.

**Who pays:**

| Request | Paid by |
| --- | --- |
| The live transcript, live notes, board ideas and captions in a call, for everyone | The call's organizer |
| Writing a call's notes, reading its shared screens, comparing it with its series | The organizer |
| A room recording's transcript and notes | Whoever records |
| A question or a catch-up in a call | Whoever asks, from their own plan; a guest's, the organizer |
| Asking a note, or every note; asking a series; an agent's questions (MCP) | Whoever asks |
| AI on a document or board (shorter, checklist, what was said, sort into themes) | Whoever the workspace counts against |

Spend is kept by kind (`transcript`, `notes`, `live-notes`, `ideas`, `captions`, `catch-up`, `ask`, `series`,
`documents`) with the allowance, so it can be explained, and logged when a period closes. Every change is made under the
meter's row lock (`ai_meters`), so requests at once on any instance can't spend the same money twice.

### Running out in a call

A call's notes are written once it's over, so while it's live each transcript clip also **reserves** what writing them
will cost at most so far (`drafting.writingAtMost`: the notes and their details from the transcript, a section for each
breakout room, picking moments and reading a frame for every 15 seconds shared, every request at its most output).
The allowance runs down with the call, and notes stop before it's spent rather than after.

- **About to run out:** when what's left would last `ai.warn_seconds` (5 minutes) at this call's own pace (what it has cost
  and will cost to write up, a second of it), the organizer alone is told, once (`CallState.capture.runningOut`).
- **Spent:** notes go off for everyone, as if the organizer had turned them off, and everyone, guests included, sees
  "Notes have stopped" until they close it (`capture.stopped`, reason `notes`). The call goes on. Captions, live notes,
  guests' questions and anything else the organizer pays for are refused; a signed-in person's own questions are theirs.
- **The last note:** when the call ends, its notes are written from what was transcribed before notes stopped. Writing a
  call's notes the first time is never refused, so it may cost more than what was left: that's the only way past an
  allowance, and what it costs over is Alcove's. Writing them again (after correcting the transcript) is refused like
  anything else, and the notes stay as they were.
- **Then nothing:** the allowance stays spent for the rest of the period, even when what the call reserved turns out to
  be more than writing cost; only a bigger allowance (the limits raised, a new period, a bigger plan) lifts it. A call
  scheduled with notes starts without them and says why; turning notes on, starting a room recording, or asking is
  refused with "Your notes for this period have run out. They start again when your plan renews."

## Storage

What an account stores is its own row's `stored_bytes` (its calls' audio and shared screens, its room recordings) and
every workspace it pays for (`workspaces.payer_owner_id`): the shared ones it made, and its calls' own, whose files count
against the organizer whoever adds them, guests included (`features/billing/storage.ts`).

- A file bigger than the payer's plan's file size is refused at its start. A piece that would take the payer past their
  storage is refused (`plan-limit`, "Your storage is full…"), uploads in every workspace they pay for, and call audio and
  shared screens too: then notes stop for everyone, as when the allowance is spent, with reason `storage`. Notes don't come
  on again without 1 MiB free.
- `media.account_day_bytes` still caps what one person uploads in a day, everywhere.
- Workspaces aren't counted against a plan: an account makes as many as it likes, and storage is the only limit. One
  account can make at most `workspaces.max_made` (1,000), an abuse guard that a plan doesn't change.
- An account warns, once, at 80% of its storage (logged with IDs and sizes).

### Over the limit: the grace

An account over its plan's storage (after a plan ends, or at the release that brought plans for one already over Free's)
gets `plan.grace_seconds` (15 days) with everything working as it did. Then upkeep ends the grace: uploads stop everywhere
the account pays for, and notes stop for everyone, as above. Making room, or a bigger plan, lifts it; nothing is ever
deleted for being over, and every workspace stays readable and editable.

## Calls

A call ends at its longest (`call.max_seconds`, 10 hours): `CallState.endsAt` says when, everyone is told 5 minutes
before, and upkeep ends it every 30 seconds (`lifecycle.endOverdue`), writing its notes as when anyone ends it. At most
`call.max_people` (100) are in a call or waiting to be let in: anyone more is refused ("This call is full…") and whoever
hosts is told, at most once a minute. Someone coming back keeps their place.

## Adding money

The balance plans are bought with is filled with USDC or USDT, at face value: a token is a dollar. The person chooses an
amount (the presets are one, three and six periods of Pro, or their own, at least the route's minimum: $5, $20 on
Ethereum, and at most $8,000), and is asked to send exactly that. What's added goes by what was sent; Alcove absorbs
1Click's fee:

- **At least what was asked:** all of it.
- **Under what was asked but within 1Click's band** (at least the quote's `minAmountIn`, 99% of it with 1% slippage):
  exactly what was asked.
- **Below the band**, or a swap refunded in full: 1Click doesn't swap it and refunds it to the treasury at the address's
  deadline. What was sent (or refunded) is added, however small. Until the deadline the address stays shown, and anything
  else sent to it is added to what arrived and swapped as a whole.
- **Refunded in part** (some swapped): the whole amount sent, which all reached the treasury, by the first three rules.

Money is only added for money 1Click says reached the treasury, in amounts that agree with each other. A settled answer is
added only when what came out of the swap (USDC on NEAR) plus what was refunded to the treasury is at least 98.5% of what
was sent (1Click's fee and up to 1% slippage, with room to spare), what was sent is above 0 and no more than $8,000, and
every amount that comes with 1Click's own decimal rendering of it agrees with it. Anything else adds nothing: the deposit
is `arriving`, logged at error once with the reason, and fails at its deadline so it reaches support.

| Part | State |
| --- | --- |
| Balance and history, sealed under `Kservice` (never under owner keys), in `plan_accounts` | Working |
| Top-up routes (`GET /v1/plan/routes`) | Working. USDC on NEAR, Ethereum, Base, Arbitrum, Solana, Polygon, BNB Chain, Optimism and Avalanche, and USDT on NEAR, Ethereum, Solana, Tron, Polygon, BNB Chain, Optimism and Avalanche, while 1Click lists them, each with its minimum. A server without `TREASURY_INTENTS_ACCOUNT` answers `unavailable` on every top-up endpoint; `ONECLICK_API_KEY` is optional and only lowers 1Click's fee |
| Opening a top-up (`POST /v1/plan/top-ups { routeId, microUsd }`) | Working. A 1Click quote paying the treasury exactly that gives a one-off deposit address on the route's chain, open for 24 hours, kept sealed (`deposits`, record kind `deposit`). At most 10 a minute per account per API instance; refused with `conflict` while the account has 15 top-ups waiting for a payment to an address that hasn't expired, or has opened 30 in the last 24 hours (cancelled ones count). Both counts are checked in Postgres, again under a lock on the account in the transaction that inserts the deposit |
| Cancelling a top-up (`POST /v1/plan/top-ups/:id/cancel`) | Working. Only a `waiting` top-up can be cancelled. Its address is no longer shown and it no longer counts toward the 15 waiting. 1Click can't cancel a quote, so a payment that reaches it is still added. It still counts toward the 30 a day |
| Adding a top-up | Working. On `SUCCESS` or `REFUNDED` that passes the checks above, what was sent is added by the rules above, in the transaction that marks the deposit `credited`, under its row lock: once, however many checks race. `FAILED` is `failed`, logged at error. A `failed`, `expired` or `cancelled` deposit is still added when 1Click later settles it |
| Watching top-ups | Working, unchanged: every open deposit is asked about every 10 s for 15 minutes, every minute until 2 hours, then every 5 minutes, thinning out after its deadline (see below) |
| A top-up the previous release settled while this one deployed | Working. It added credits, which no longer count: upkeep adds it again as dollars, once (`creditCarried`, by `billing_cutover`) |
| Adding money in the app | Working. Settings › Plan › Add money opens a sheet: choose $20, $60, $120 or your own, then a token and its chain, and get an address (with a QR code) for one payment of exactly that; the sheet follows it until it's added; while it waits for a payment it can be cancelled there; open and recent top-ups are listed under the balance |

### How a top-up works

1. **Routes.** `GET /v1/plan/routes` lists one route per stablecoin and chain on the allowlist in
   `features/billing/oneclick.ts` that 1Click currently lists in `/v0/tokens` (cached for 10 minutes), with its minimum,
   and the presets.
2. **Address.** `POST /v1/plan/top-ups` asks 1Click for a `FLEX_INPUT` quote for exactly that amount of the token, whose
   recipient and refund target are both the treasury's Intents account (fields in
   [Stack and provider setup › 1Click as built](../references/stack-and-provider-setup.md#1click-as-built)). A quote for
   another amount, whose `minAmountIn` is more than 1.5% below it, whose repeated `quoteRequest` isn't what was asked, or
   whose deadline is under an hour or over 7 days away, is refused as unavailable and logged at error (without amounts).
   Each route's decimals are pinned in the allowlist. The deposit's route, address, memo, expiry, the amount asked, the
   quote's `minAmountIn` and the whole signed quote are sealed in a `deposit` record; its row holds only the owner, ID,
   provider, state and when to look again.
3. **Watching.** The watcher (`watch` in `features/billing/deposits.ts`, run every 5 s by `startWatching`) claims up to 20
   due deposits with `FOR UPDATE SKIP LOCKED`, pushing their next check ahead by a lease longer than a worst-case pass, asks
   1Click's `/v0/status` about each, 4 at a time, and records the answer. `GET /v1/plan/top-ups/:id` checks the same way,
   at most every 5 s. 1Click being down leaves a deposit as it was, logged at warn. An `arriving` or `short` deposit never
   goes back to `waiting`, and a `cancelled` one stays `cancelled` until a payment reaches it. At the deadline (24 h after
   the address expires) 1Click is asked a last time: nothing arrived is `expired`, anything but a finished swap is
   `failed`. A `failed`, `expired` or `cancelled` deposit is asked about on a thinning schedule (hourly for a day, every 6
   hours for a week, then daily) until 30 days after its address expired, so a payment 1Click settles late is still added.
4. **Adding.** When the swap settles, the deposit's state and the balance change in one transaction with the deposit row
   locked (then the plan's row), so a deposit is added at most once. The balance's history reads "Added, 25 USDC".

Logs about a deposit carry its ID, provider, states, counts and durations, never the address, amounts, hashes or the
quote. Deleting an account deletes its deposits; a payment still on its way reaches the treasury and is added to nobody.

## Treasury runbook

The server never holds a key that can move treasury money. By hand, in near.com, signed in as the treasury account:

- **Refunds.** A refund lands in the treasury's Intents balance as the token that was sent, not USDC. Swap these to USDC
  on NEAR from time to time.
- **Withdrawals.** Withdraw USDC from the Intents balance in batches, when topping up NEAR AI, not after every payment:
  each withdrawal costs a flat 0.004615 USDC.
- **A stray payment** (a second payment to a used address, or one after it expired) reaches the treasury as a 1Click
  refund and isn't added. The person gives support the top-up's reference (its deposit ID). Support opens that deposit's
  sealed record (`deposits`, under `Kservice`'s accounting key) to find its address, confirms the payment in 1Click's
  status for it, and adds what reached the treasury to their balance by hand.
- **A failed top-up** (logged at error with its deposit ID and a reason) is one 1Click reported money for that wasn't
  added. Support opens its record and 1Click's status as above, and adds only what 1Click shows reached the treasury. If
  1Click settles it cleanly within 30 days, it's added by itself.
- **A depeg (accepted risk).** Every amount sent is valued at face (1 token = 1 USD). When a stablecoin depegs, turn
  top-ups off (take `TREASURY_INTENTS_ACCOUNT` out of the API's settings in `deploy.yml` and redeploy) until it recovers.

## How it upgrades

- Migration `0026_plans.sql` adds `plan_accounts` (record kind `plan-account`), `ai_meters` (`ai-meter`), and
  `billing_cutover` with the time it ran. `0027_workspace_payers.sql` adds a nullable `payer_owner_id` to
  `workspaces` and backfills who pays from `workspace_authors` and the first admin. The previous release
  ignores all of it while the deploy migrates.
- Credits are gone: every account starts on Free at $0, its old balance ignored. `billing_accounts` is no longer read,
  and goes in a later release.
- An account's plan row is made the first time it's touched, or by upkeep. One already over Free's limits gets the grace
  first. Workspaces the previous release makes while this one deploys, and those whose payer deletes their account, are
  settled by upkeep.
- A deposit record from before keeps its `credits` and `rate` (ignored now); one settled by the previous release has no
  `addedMicroUsd` and is added again as dollars once if it settled after the cutover (above).
- A live call's state from before has no `notes.limit`, and reads as not stopped (`.default`).
