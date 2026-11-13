# Plans phase 1: payments review

[Docs home](../README.md) · [Plans and usage](plans-and-usage.md) · [Plans: test matrix](plans-test-matrix.md)

A review of phase 1 (PR #274) from the payments side: ways to abuse it, running out, adding money, and anything else that
costs Alcove money or makes paying worse for people. The issues below were found on 12 Nov 2026. The larger ones are fixed in
the commit that added this page; the smaller ones are still open, each with where it is and a suggested fix.

## Outstanding smaller issues

Not fixed. The first two are the most worth doing before release.

1. **A request that runs past 5 minutes is charged twice.** A request's hold lasts `HOLD_MS` (5 minutes) from `begin`.
   When the request settles after that, `locked()` first charges the expired hold in full as lost
   (`features/billing/meter.ts`, the `lost` sweep), and then `settle` charges what it really used. A `lost()` after a
   timeout charges the hold twice. This can happen: writing a call's notes allows 240 s (`drafting.ts`, `what: 'notes'`),
   plus up to about 65 s of evidence checks (`evidence.ts`: 15 s, 30 s, 20 s), plus a second attempt when the key was
   refused. That's also the biggest hold there is. Fix: in `settle`, if the hold is no longer in `m.holds`, charge
   `cost − heldNano` (which can be negative) instead of `cost`. D3′ in the test matrix isn't tested either.

2. **Once notes stop, they stay off for the whole period, even with allowance left.** `stopped` is set when allowance −
   spent − holds − call reserves ≤ `ai.stop_micro_usd`, and only a bigger allowance clears it (`meter.ts`, `begin`,
   `settle` and `locked`). Holds and reserves are the most a request or a call's notes could cost. At the default model
   ($0.30 in, $1.20 out per million tokens), an hour of call with an hour of screen sharing reserves about $0.38, 15% of
   Free's $2.50, mostly 1,200 output tokens per frame that real reads don't use. When the note is written for less and
   the reserve is released, the account stays stopped and Settings says "None". A burst of asks whose holds briefly fill
   the allowance does the same. For Pro, that's paid allowance lost. Separately, a note deleted (or a job cancelled) before
   its notes are written never calls `close()` (`notes/writer.ts`, the `drop` and `stopped` paths), so its reserve sits
   for `SOURCE_GONE_MS` (24 hours) and can trigger the stop by itself. Suggested fix: make the stop permanent only on
   `spentNano`; when holds or reserves are what's in the way, refuse the request without stopping (a live call already
   keeps its own `notes.limit.stoppedAt`, so notes don't come back mid-call). Call `close()` when a notes job is dropped
   or cancelled. The docs call the current behavior intended, so this needs a product decision.

3. **Other people can still spend your plan, more slowly now.**
   - AI on a document or board is paid by the workspace's payer, whoever asks (`workspaces/documents.ts`,
     `workspaceMeter`). Any editor, including a guest seated in a call, gets 20 a minute (`ask-selection`, `sortLimiter`).
     Undecided whether to limit it more (for example a per-workspace cap on asks by anyone but the payer).
   - Files anyone adds to a workspace count against its payer (item 4).
   - Guests' questions are capped per guest (below), in each API process. A guest who leaves and joins again starts
     over with a new identity: that's deliberate, since the cap is there to slow one person down, not to limit a call.
   - Main's #275 ("everyone in the call can open and edit its workspace and boards, guests too") widened the first two.
     With main merged, a call opens its workspace to everyone in it only while the organizer edits there and pays for it
     (`access.ts › holdersOf`), so that way is closed. Boards are still open: a board the call makes (the main board and
     the rooms' boards, in the call's home) seats everyone in the call, or the room, while the organizer can edit there, and
     a saved board someone lets everyone in to seats them on that person's word (`calls/boards.ts`: `stillTheCalls`,
     `madeMain`, `makeRoomBoards`, `letInHere`). When the home is a workspace someone else pays for (an existing one chosen
     when the call was scheduled), a guest's files and AI on those boards count against that payer. Fix: seat everyone on
     a board the call makes only while the organizer pays too, as `holdersOf` does, or refuse files and AI to someone who
     has a document only through a call's seat unless that call's organizer pays for the workspace.
   - The reverse also works: someone whose own notes have run out can still use document AI in a workspace someone
     else pays for, or ask as a guest.

4. **Someone else's uploads can fill your storage in a day.** Fixed since (D2): someone else adds at most
   `media.others_day_bytes` a day to your storage, guests in your calls `media.guests_day_bytes` between them, and nobody
   but you reaches into the last `media.payer_reserve_bytes`, kept for your notes and recordings
   ([Plans and usage › What others can add](plans-and-usage.md#what-others-can-add)). As it was found: files anyone adds to a workspace count against its payer,
   guests' in a call's workspace included. The only cap is per uploader, `media.account_day_bytes` (20 GiB a day), which
   is more than Free's 10 GiB, and a guest's identity is random for each person in each call (`upload-guest`), so joining
   again starts a new day. A full account can't upload anywhere, and its calls' notes stop. Low odds (it takes someone set
   on it), but a big effect, so it was left for a follow-up. Lowering `media.account_day_bytes` for everyone was tried and
   dropped: it caps people's uploads into their own storage too.
   What the fix would look like: limit what *others* add to an account's storage, separately from what you add to your own.
   - In `features/workspaces/media.ts`, `withinLimits` and `countDay` already know the uploader (`Uploader`) and the payer
     (`allowedIn`). An upload is "someone else's" when the uploader isn't the payer; a guest's always is.
   - Uploads into your own storage keep `media.account_day_bytes` as now.
   - Uploads into someone else's get a new, lower limit, for example `media.others_day_bytes` at 3 GiB, plus about 1 GiB
     an hour counted in the process, checked in `withinLimits` (not in the route, which doesn't know the payer).
   - To survive guests rejoining, count it against the payer rather than the uploader: a migration adding a table such
     as `media_payer_days (payer_owner_id, day, bytes)`, pruned with `pruneUploadDays`, so all of a payer's incoming files
     from others share one daily cap however many identities send them. Telling the payer when others pass 80% of it,
     and warning before storage fills, would go with it.

5. **Taking over a workspace can stop the new payer's notes at once.** Fixed since (D1): the new payer gets
   `workspaces.payer_grace_seconds` before its files count, is told, and a payer's leaving is refused while no other admin
   has an account ([Plans and usage › When whoever pays leaves](plans-and-usage.md#when-whoever-pays-leaves)). As it was
   found: when a payer leaves, the workspace counts against
   the admin in charge now (fixed below). If its files push them over their storage, their uploads and notes stop
   immediately, with no grace. Options: a grace for the new payer, or refuse to let a payer leave or be removed until
   someone else agrees to pay.

6. **The one overdraft can go past the reserve.** A call's first note write is never refused, which is bounded by what
   the call reserved. It can go further when the notes job retries (each attempt runs at `final`), or when breakout rooms
   open: the reserve jumps in one step, and the stop only follows on the next clip. With a model at $10/$50 per million
   tokens, 10 rooms adds about $4 at once. This happens once per call per period; accepted, but worth knowing.

7. **Video calls aren't metered.** Calls run on LiveKit Cloud, billed by participant-minutes and bandwidth. Free allows
   unlimited calls of up to 10 hours and 100 people, back to back: one Free account can use 60,000 participant-minutes
   per call. No plan limits it.

8. **Deleting an account and signing up again gives a fresh allowance immediately.** It's a new owner with a new meter.
   This is the general multi-account problem of any free tier, only quicker.

9. **Add money works in phase 1, but there's nothing to buy.** There are no withdrawals either. That's fine only while
   `release/plans` ships with all four phases.

10. **The deposit band costs up to about 3% of a top-up.** A payment within the band (up to 1.5% short) adds the full
   amount asked, and up to 1.5% more can go on 1Click's fee and slippage: up to $240 on an $8,000 top-up. That's harmless
   while the balance can't leave Alcove. If phase 2 refunds ever pay out to a wallet, it becomes arbitrage: send 98.5%,
   get 100% added, ask for a refund.

11. **Carrying paid credits over is generous, by choice.** Every top-up paid for before plans is added again at face
    value (fixed below), even if its credits were spent on notes. Welcome credits aren't carried. Converting only what's
    left would need `billing_accounts`' balance and history, split into paid and welcome.

12. **Settings and the stop disagree while a call is live.** Settings shows notes left from what's been spent, but
    `notesBlocked` also counts what live calls hold. With one call running, Settings can say "About 12 min" while a second
    call or a room recording is refused with "Your notes for this period have run out."

13. **During the deploy, a top-up this release settles can't be opened by the previous one.** Fixed since: the deposit
    record is read loose, so every save keeps what this release doesn't read. As it was found: `apply` saves a deposit's
    record through this release's `DepositRecord`, which drops the `credits` and `rate` the previous release requires. If
    this release settles a top-up the previous one opened, the previous release's top-up list for that account fails until
    the deploy finishes. Fix: save records the way `creditCarried` does (`Kept`, which keeps every field).

## Larger issues addressed

Fixed in the commit that added this page, with integration tests (rows B2′ and C5–C7 in the
[test matrix](plans-test-matrix.md)).

1. **Credits people already paid for disappeared.** Top-ups have been live in production since #175 (9 Nov 2026). Plans
   ignore `billing_accounts`, and `creditCarried` only re-added deposits settled in the day after the cutover, so anyone
   who paid before the release would start at $0. Now `creditCarried` (`features/billing/deposits.ts`) adds as dollars
   every `credited` deposit that has no `addedMicroUsd`, whenever it was settled (since, without the day's window or
   `billing_cutover`: a previous release serving after a rollback settles top-ups too). The old query also
   had no way to move past rows it had already looked at (`LIMIT 100`, and the marker is inside the ciphertext), so with
   more than 100 deposits some were never reached. Each deposit is now looked at once, then its `check_after` is set to
   infinity, which nothing else reads for a `credited` deposit. A record saved again keeps every field, including the
   `credits` and `rate` the previous release requires, so that release can still open it while this one deploys. A record
   that can't be opened is logged at error once (for support to add by hand) and doesn't hold up the ones after it. No
   migration. Before release, check what's affected in production: `SELECT count(*) FROM deposits WHERE state = 'credited'`.

2. **You kept paying for a workspace after leaving it.** Leaving, or being taken out by another admin, didn't change
   `workspaces.payer_owner_id`, so the workspace's files filled the old payer's storage and its document AI spent their
   notes, with no way for them to see or delete either. It could also be used on purpose: spare accounts make
   workspaces, add one account as admin, then leave. Now `settlePayers` (`features/billing/storage.ts`) moves any
   workspace whose payer isn't in it any more to its longest-standing admin with an account (since D1, with a grace and
   a notice, and a payer's leaving is refused while none has one). Taking anyone out of a workspace runs it for that workspace at once (`dropMember` in
   `features/workspaces/service.ts`: leaving, being taken out, and a call's invite), and upkeep runs it for every
   workspace every 5 minutes, which catches any other way a payer stops being in one. That also fixes workspaces the
   `0030` backfill gave to a maker who had already left. Upkeep only writes workspaces whose payer changes.

3. **A workspace nobody paid for had no storage limit.** With `media.workspace_bytes` gone, a workspace with a null
   payer was checked against nothing (`allowedIn` in `features/workspaces/media.ts`). `settlePayers` only picks an admin
   who has an account, and deleting an account promotes the longest-standing member, who may be an invitee who never
   signed up. So the payer stayed null for good, and the other members could upload 20 GiB a day each, counted against
   nobody. Now a workspace with no payer takes no files: `409 conflict`, "Files can't be added until one of this
   workspace's admins signs in to Alcove." (the People sheet marks who's an admin; a workspace can have several). Files
   are taken again from upkeep's next pass (every 5 minutes) after an admin signs in. Settling it on the upload itself
   was tried and dropped: it updates the workspace row inside an upload's transaction, which holds that row shared, so
   two uploads at once could deadlock. Document AI there already falls back to whoever asks.

4. **Guests could spend an organizer's notes at 20 questions a minute each.** Now a guest's questions and catch-ups in
   a call are limited to 6 a minute per guest (`guestAskLimiter` in `http/limits.ts`, applied in
   `features/calls/routes.ts`). Someone signed in pays for their own and keeps 20 a minute. There's deliberately no cap
   for a whole call: a 100-person call asks a lot, and that's normal.
