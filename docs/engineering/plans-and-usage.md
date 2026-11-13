# Plans and usage

[Docs home](../README.md) · [Notes and inference](notes-and-inference.md) · [Privacy, keys and sessions](privacy-keys-and-sessions.md)

Every call gets its own workspace and board on every plan, kept afterwards in the Drive. Plans differ only in how much
they bring: notes and storage. Every feature is on every plan.

| | Free | Pro | Team |
| --- | --- | --- | --- |
| Price | $0 | $20 a month (a period), or $16 a month bought 12 or more at once, from the balance | $40 a person a period, or $32 a period for a license for a year (12 periods, $384) |
| Calls | Unlimited, up to 10 hours each, 100 people | Same | Same |
| Notes (an estimate: what a call uses varies) | About 5 hours a period | About 50 hours | About 50 hours a person |
| More notes this period | 10 hours for $15, from the balance, up to 50 hours at a time | Same | Same |
| Storage (uploads and call recordings) | 10 GB | 100 GB | 100 GB a person, pooled |
| Largest file | 512 MB | 512 MB, 2 GB once downloads resume | Same as Pro |
| Shared workspaces not tied to a call | As many as you like (storage is the limit) | Same | Same |

A period is 30 days from when the plan began; a month of Pro is one period, and so is a team license from when it's
taken (a license for a year is 12 periods, one after another). A change to how long a period is applies from each
account's next one: a period that has begun runs to its end as it began. This page says what's built now.

Every number is a limit (`apps/api/src/limits.ts`, [Deployment › Changing a limit](deployment-and-acceptance.md#changing-a-limit)),
changeable without a deploy: each plan's notes, storage, files and price; Pro's lower price for a year or more, and a team
license's for a year, with how many periods that is; the most
months of Pro one purchase buys and how long before Pro ends its owner is told; more notes for a period, their price and
the most bought at once; the most workspaces one account makes; what an hour of notes is reckoned at; when AI stops and
when an organizer is told it's close; how much of an organizer's allowance guests in one call spend; how long a period
and a grace last; a call's longest, its most people, and how many asks to join it one network may have waiting. A period's length changes from each account's next period: each
account's AI meter keeps the period it's in ([Pro › The plan in force](#pro)).

## Status

| Part | State |
| --- | --- |
| Free, for every account | Working. A new account is on Free from sign-up; an account from before plans is the first time it's touched after this release, or by upkeep. |
| The AI allowance, metered on every NEAR AI request | Working |
| Notes stopping, the 5-minute warning, the one note written past the allowance | Working |
| Storage per account, recordings included; grace | Working |
| A call's 10 hours and 100 people | Working |
| The USD balance, filled by stablecoin top-ups | Working |
| Buying Pro, renewing, refunds, reminders, the grace after Pro | Working (server; see [Pro](#pro)) |
| Pro for a year or more at a lower price; more notes for a period | Working (server; see [Pro](#pro) and [More notes](#more-notes)) |
| A payment that buys what it was for (Pro, more notes or a team's licenses) once it's added | Working (server; see [A payment that buys](#a-payment-that-buys)) |
| Teams, licenses, visits, alerts, the pool (server; see [Team](#team)) | Working |
| A team license for a year, 12 periods at a lower price a period, from the balance or by payment | Working (server; see [Team](#team)) |
| Team notes, Ask across them, team workspaces (server; see [Team](#team)) | Working. Ask's `refs` (@-references) work on the server; the app's Ask, main's palette, has no way to add them |
| Picking a plan at first sign-in | Working. `Plan.choose` is true for every account until the app says the plans were shown (`POST /v1/plan/chosen`, `PlansApi.chose()`); an account from before plans is shown them once. In the app it's the plan choice: Home opens on Plans once, in its place (`apps/web/src/features/plans/PlanChoice.tsx`), and only Home, never a deep link (decided in `features/plans/choice.ts`). Once the plans have been on screen there or on Plans, the app says so, quietly trying again if that fails ([user-flows 16.20](../product/user-flows.md#1620-choose-a-plan)) |
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
first time the account is touched after the old one ends, or after its plan changes, with all of its allowance. More notes
bought for a period ([below](#more-notes)) are part of its allowance, and end with it.

**Every request to NEAR AI is paid for** (`features/billing/meter.ts`). `inference.ts`'s `transcribe`, `complete` and
`completeJson` take a required `Meter`, so nothing reaches NEAR AI without naming who pays:

1. Before it's sent, the most the request can cost is **held**: its text at a token a byte, each image at
   `ai.image_tokens`, and the output it asks for at most, at its model's price. It's refused (`plan-limit`, 402) if that
   would take what's left below `ai.stop_micro_usd` ($0.005), or once the allowance is spent. Only a spent allowance stops
   anything: a request refused because it's too dear for what's left leaves cheaper ones to go.
2. Once NEAR AI answers 200 it's **charged** what NEAR AI says it used (cached input at its cache price), even when what
   came back can't be used: the model did the work. A reply that doesn't say what it used is reckoned (a quarter of its
   characters a token). A Whisper clip is reckoned from its length when NEAR AI doesn't say: 1,500 tokens in for every
   30 seconds, and its words out.
3. A request NEAR AI turned away (not 200), or that never went (its evidence didn't check out), is charged nothing. One
   that timed out once sent is charged what was held. A hold nothing settles within 5 minutes is charged in full the next
   time the meter is touched, and shown so already; answered after all, it's charged what it used instead, never both.

Prices come from NEAR AI's catalog (`GET /v1/models`: `pricing.input` and `pricing.output` in USD a million tokens,
`pricing.input_cache_read` a token), read with the list of models and kept as last listed through an outage
(`features/notes/models.ts` `priceOf`). A request whose model has a price kept never waits on the catalog: it's charged
at that, and the list is read again behind it once it's ten minutes old; only a model never priced waits for the list.
A model the catalog has never priced both ways is charged at `ai.fallback_input_micro_usd` and
`ai.fallback_output_micro_usd`; each time the catalog is read, the models that can be charged without a price (the
default, the speech model and every one offered) are logged at warn, once (`models not priced; charged at the
fallback`, with their IDs), never with every request.

**Who pays:**

| Request | Paid by |
| --- | --- |
| The live transcript, live notes, board ideas and captions in a call, for everyone | The call's organizer; a guest's captions in another language and live notes of their own (from less than everyone's read), the organizer, out of the guests' share (below) |
| Writing a call's notes, reading its shared screens, comparing it with its series | The organizer |
| A room recording's transcript and notes | Whoever records |
| A question or a catch-up in a call | Whoever asks, from their own plan; a guest's, the organizer, out of the guests' share (below), 6 a minute for each guest |
| Asking a note, or every note; asking a series; an agent's questions (MCP) | Whoever asks |
| AI on a document or board (shorter, checklist, what was said, sort into themes) | Whoever asks, from their own plan, in any workspace; a guest's, whoever the workspace counts against, on the default model, out of the guests' share (below) and within a guest's 6 a minute, and none while nobody does |

Spend is kept by kind (`transcript`, `notes`, `live-notes`, `ideas`, `captions`, `catch-up`, `ask`, `series`,
`documents`) with the allowance, so it can be explained, and logged when a period closes. Every change is made under the
meter's row lock (`ai_meters`), so requests at once on any instance can't spend the same money twice.

**Guests' share.** A guest has no plan, so what they ask for in a call (questions, catch-ups, and AI on the call's documents
and boards) is the organizer's, and so is what the call does for a guest alone: captions in another language (each line once
a language, so one already translated costs nothing again), and live notes of their own, which a guest who came late, or
left and came back, gets because they can't read all of everyone's. Every guest in one call spends from one share of the
organizer's allowance for the period, `ai.guests_call_percent` (10%), kept with the allowance by the call's ID (`Bill.guests`
in `meter.ts`, `callMeter`'s `guests` in `calls/recording.ts`): a request that would take them past it is refused ("Guests in
this call have asked as much as the organizer’s plan allows. Sign in to ask from your own plan."; for captions and notes of
their own, "Guests in this call have used as much of the organizer’s plan as it allows them.", and those notes say "These notes
aren’t being updated: …" until there's room again), whichever guest asks, and the organizer's own notes keep the rest.
Everyone's live notes, board ideas and the captions of anyone invited are the call's, for everyone, and the organizer's to pay
for outside the share. A guest here is anyone in the call who isn't invited (`role` guest). On Free that's $0.25 a call, about
30 minutes of notes, which is dozens of questions about a long call at the default model; a guest is also held to 6
questions, catch-ups and asks of AI on a document or board a minute between them, counted by the call and the person their
pass names, so coming back on a new connection doesn't start again (`http/limits.ts › guestAskLimiter`, `calls/routes.ts`,
`workspaces/reader-routes.ts`); their AI on documents and boards goes to the default model. Someone signed in asks from their own plan,
and isn't counted in it. A request that carries no session is a guest's, so a signed-in invitee who leaves theirs off asks
as a guest, within the same share.

### Running out in a call

A call's notes are written once it's over, so while it's live each transcript clip also **reserves** what writing them
will cost at most so far (`drafting.writingAtMost`: the notes and their details from the transcript, a section for each
breakout room, picking moments and reading a frame for every 15 seconds shared, every request at its most output).
The allowance runs down with the call, and notes stop before it's spent rather than after. It's reckoned at the model
the notes will be written with: when the organizer chooses another in the call (**Notes written by**) it's reckoned again
at once, and a dearer one is refused while what's left can't hold it (`plan-limit`, "What’s left of your notes this
period won’t cover writing this call’s notes with that model. Keep the one it has, or choose one that costs less."),
after notes stop too; a cheaper one always goes.

- **About to run out:** when what's left would last `ai.warn_seconds` (5 minutes) at this call's own pace (what it has cost
  and will cost to write up, a second of it), the organizer alone is told, once (`CallState.capture.runningOut`), by
  whichever charge to the call gets there first: a transcript clip, captions, live notes or board ideas (`callMeter` in
  `calls/recording.ts` tells the call as soon as the charge is saved).
- **Spent:** notes go off for everyone, as if the organizer had turned them off (`capture.stopped`, reason `notes`), and
  the call goes on. Notes says Stopped, and over its tabs (or in a banner while Notes is closed) the organizer reads why with
  Get Pro and more hours for this period, which open checkout over the call; everyone else, guests included, reads whose
  notes ran out, with nothing to buy (user-flows 16.9). Captions, live notes,
  guests' questions and anything else the organizer pays for are refused; a signed-in person's own questions are theirs.
  Whichever charge to the call spends it stops the call's notes at once; a clip or captions refused only for being too
  dear for what's left stop nothing.
- **The last note:** when the call ends, its notes are written from what was transcribed before notes stopped. Writing a
  call's notes the first time is never refused, so it may cost more than what was left: that's the only way past an
  allowance, and what it costs over is Alcove's. It's paid from what the call held for it: what it's charged, and what
  its requests hold on their way, come out of that and count on top only once they're past it, so writing the notes
  stops nothing the call held enough for. Writing them again (after correcting the transcript) is refused like anything
  else, and the notes stay as they were.
- **Then nothing:** the allowance stays spent for the rest of the period, even when what the call reserved turns out to
  be more than writing cost; only a bigger allowance (more notes bought, the limits raised, a new period, a bigger plan)
  lifts it. A call scheduled with notes starts without them and says why; turning notes on, starting a room recording,
  or asking is refused with "Your notes for this period have run out. They start again when your plan renews."
- **Whose, in words:** a refusal says whose allowance it is (`whose` on the meter's bill). Someone asking for what the
  organizer pays for (a guest's question, captions, anything the call does) reads "The organizer’s notes for this period
  have run out, and this is paid from them."; AI on a document or board its workspace's payer pays for, "The notes this
  workspace’s AI is paid from have run out for this period.". A request refused only because what's left can't cover it says so instead, and nothing
  stops: "What’s left of your notes this period isn’t enough for this." (the organizer's, or the workspace's, likewise).

## Storage

What an account stores is its own row's `stored_bytes` (its calls' audio and shared screens, its room recordings) and
every workspace it pays for (`workspaces.payer_owner_id`): the shared ones it made, its calls' homes, whose files count
against the organizer whoever adds them, guests included, and any whose payment moved to it (`features/billing/storage.ts`).
A workspace is paid for by its longest-standing admin with an account: for a new one, whoever made it. A home's payer is
the call's organizer whoever's action made it: their scheduling choice, getting the call ready before it starts
(`calls.ready`), the first time anyone opens Workspace in it, or its end with notes (`makeHome`).

### When whoever pays leaves

Only someone in a workspace pays for it. When its payer leaves it, is taken out of it or deletes their account, its payment
moves at once to its longest-standing admin with an account (`settlePayer`, run for that workspace by the change itself, in
its transaction; upkeep's `settlePayers` settles any it missed every 5 minutes, each in a transaction of its own, whatever made
a payer stop being in a workspace). An admin whose account is being deleted at that very moment is passed over, not waited
for. A team's workspace whose payment moves to someone who isn't on its team, or to nobody, stops being the team's then
(`offTeam`, [Team workspaces](#team)).

- **A grace.** For `workspaces.payer_grace_seconds` (15 days) what the workspace held as it moved is on top of the new
  payer's storage (`workspaces.payer_grace_until` and `payer_grace_bytes`, counted at most at what it holds now; on Team, on
  top of the pool): the move refuses none of their uploads and stops none of their notes until then. What's added to it
  meanwhile counts as anything else does. 15 days is `plan.grace_seconds`, so every storage grace gives the same time to
  sort things out (look through its files, delete or move what isn't needed, get Pro, or hand the workspace to someone
  else), and it's a limit of its own so it can change by itself. A grace still running when payment moves again goes on as
  it was, to the same end and over the same bytes, so passing a workspace back and forth makes no more room than moving it
  once. Once it ends, the workspace's files count like any others, with no second grace.
- **Told.** The new payer is told once the move has committed: a `workspace-payer` notice in `Plan.notices`, with the
  workspace's ID and when its files start to count (`until`; null with no grace). The plan never keeps the workspace's name:
  Settings › Plan and the side panel name it from the workspaces they're in ("You now pay for Harbour launch, since whoever
  paid for it isn’t in it any more. Its files count against your storage from Friday 27 November."), and the browser's
  notification says only that the plan changed.
- **Refused.** A payer's leaving, or being taken out, while none of the other admins has an account is refused (`conflict`,
  "You pay for this workspace’s storage, and none of its other admins has an Alcove account to take that on. Make someone
  who has one an admin, then leave."), and nothing changes. Deleting an account is never refused for it: a workspace it paid
  for with no other admin who has an account counts against nobody, and takes no files ("Files can't be added until one of
  this workspace's admins signs in to Alcove."), until upkeep's next pass after one signs in. It counts against them from
  then, with no grace or notice: nothing moved from anyone.
- Logged `workspace payer moved` (the workspace, who from, who to and when its grace ends), `workspace left with nobody to
  pay for it`, and the refusal at info with `why: 'nobody to pay'`.

A call opens the workspace it uses to everyone in it, guests included, so whatever they add there counts against its payer,
and AI a guest asks for there is paid by it (on the default model: anyone signed in pays for their own). So it does that only while the organizer pays for it: its payer is the account the
call is kept in, and the organizer can still edit there (`access.ts › holdersOf`, asked on every request, so a change of
payer or role takes effect at once). A workspace someone else pays for, made the call's by an organizer who can edit there,
opens only for its own people; the Switch workspace question says so ("Its files don’t count against your storage, so it
opens only for its own people."). Its boards go by the same payer: a seat the call gives on a board opens it for anyone only
while the organizer pays for its workspace, asked on every read too, so in one someone else pays for the call seats nobody
on the boards it makes, and nobody can let everyone in on a saved one (`calls/boards.ts › organizerPays`); and the boards it
makes there go by address only to its own people (`access.ts › givenByCall`), never to someone invited from outside it, to
someone let in from the link, or, as rooms close, to anyone outside it. The scheduler says
so when such a workspace is chosen for where a call's notes go ("Its files don’t count against your storage, so its boards
and files open only for its own people.", `WorkspaceSummary.youPay`). A team's pool isn't counted as the organizer's here, though a teammate's
workspace counts against the same pool: AI a guest asks for in a team's workspace is paid by the workspace's payer, so a call
opening one a teammate pays for would spend that teammate's allowance.

- A file bigger than the payer's plan's file size is refused at its start. A piece that would take the payer past their
  storage is refused (`plan-limit`, "Your storage is full…"), uploads in every workspace they pay for, and call audio and
  shared screens too: then notes stop for everyone, as when the allowance is spent, with reason `storage`. Notes don't come
  on again without 1 MiB free.
- `media.account_day_bytes` still caps what one person uploads in a day, everywhere.
- Each refusal logs the plan's limit by its name (`plan.free.file_bytes`, `plan.free.storage_bytes`, …) with what's stored,
  what was being added and what the storage is held to (`held.ts › roomOf`, `roomContext`).
- Workspaces aren't counted against a plan: an account makes as many as it likes, and storage is the only limit. One
  account can make at most `workspaces.max_made` (1,000), an abuse guard that a plan doesn't change.
- An account warns, once, at 80% of its storage (logged with IDs and sizes).

### What others can add

Files anyone adds to a workspace count against its payer, so what others add is held apart from what the payer adds
(`features/workspaces/media.ts › withinLimits`). "Others" is everyone but the payer and, on Team, the people licensed on the
same team, whose pool it is as much as theirs:

- **A day's allowance.** Someone signed in adds at most `media.others_day_bytes` (2 GiB) a day (UTC) to one account's
  storage, through all the workspaces it pays for: four of Free's largest files, more than a person adds to someone else's
  storage on an ordinary day, and five days of it to fill Free. Guests in its calls add at most `media.guests_day_bytes`
  (256 MiB) a day between them: a guest is someone new each time they join, so only the payer stays the same to count
  against, and 256 MiB is still about 80 photos (a guest's file can be no bigger, then). Past it: `409 conflict`, "That’s all you can add today to the storage this
  workspace counts against. You can add more tomorrow." Counted in `media_others_days` (by the payer and the uploader's
  account) and `media_guest_payer_days` (by the payer), sizes and IDs only; upkeep keeps today and yesterday.
- **Room kept for notes.** Others' uploads stop once the payer's room would drop below `media.payer_reserve_bytes`
  (1 GiB), which only the payer's own uploads, notes and recordings use: `402 plan-limit`, "This workspace can’t take more
  files now: the rest of the storage it counts against is kept for notes and recordings." (and once it's full, "This
  workspace can’t take more files: the storage it counts against is full."). 1 GiB is about five hours of a call with a
  screen shared all through (audio at 32 kbps, a shared screen's video at about 400 kbps: some 200 MB an hour) or seventy
  of audio alone, and a tenth of Free's storage, so nobody else's files can stop a payer's notes.
- The words never say whose storage it is or what's left. The log line has the limit's name, the sizes and the reserve.

### Over the limit: the grace

An account over its plan's storage gets `plan.grace_seconds` (15 days) with everything working as it did: when Pro ends
(held to Pro's storage, [below](#pro)), or at the release that brought plans for one already over Free's (no limit until
then; upkeep ends it). Then uploads stop everywhere the account pays for, and notes stop for everyone, as above. Making
room, or buying Pro, lifts it; nothing is ever deleted for being over, and every workspace stays readable and editable.
While both graces run the larger holds, and the plan shows the later end (`Plan.grace`). Buying Pro ends either at once:
only Pro's limits apply on Pro. A workspace whose payment moved to the account adds its own grace on top, whatever the plan
([above](#when-whoever-pays-leaves)); while one runs, `Plan.grace` shows the soonest end there is.

## Calls

A call ends at its longest (`call.max_seconds`, 10 hours): `CallState.endsAt` says when, everyone is told 5 minutes
before, and upkeep ends it every 30 seconds (`lifecycle.endOverdue`), writing its notes as when anyone ends it. At most
`call.max_people` (100) are in a call at once, and only the people in it take places, with those it's letting in by itself,
invited or coming back, each person once (`places.ts › placesTaken`). Asking to be let in takes none, so asks can't fill a
call and keep out whoever's invited: anyone with the link can ask, whatever the call holds, and it's letting someone in who
asked that takes a place, only while there's one. Let in past it is refused ("This call is full: 100 people are in it, the
most a call can have.", `mls.ts › mlsCommit`, under the call's row lock), and they go on asking. Someone invited is let in
by the invite as they join, so that's when they take a place: with none left they're refused in those words and whoever
hosts is told, at most once a minute (`joining.ts › guestJoin`, under the call's row lock, so several joining at once for
the last place can't all take it). Someone coming back keeps their place. So that nobody can fill the list of asks whoever
hosts answers, one network has at most `call.asks_per_address` (10) asks waiting in a call at once: an address, or an IPv6
/64. The call keeps beside each ask only 16 bits of a keyed hash of its network under the call's own key (`Joined.askedFrom`,
state key `call-asks:<id>`), different in every call, which says that two asks may share a network and never which; an ask
past it is refused ("Too many people on your network are already asking to join this call. Try again once the host has
answered them."). An ask counts only while its browser keeps saying it's asking: one quiet for 90 seconds
(`places.ts › admissionFresh`) can't be seen or let in, so it counts for nothing, and upkeep turns it away
(`lifecycle.ts › arrivals`). A reload of someone still asking takes the place of their earlier ask, which is turned away, so
whoever hosts is asked once and it isn't counted twice.

## Pro

Pro is bought from the balance, a month at a time (`features/billing/plans.ts`, routes in `routes.ts`). A month is
`plan.period_seconds` (30 days), and each is a period of its own: Pro's notes (`plan.pro.notes_minutes`, 3,000 minutes),
storage (`plan.pro.storage_bytes`, 100 GiB) and largest file (`plan.pro.file_bytes`, 512 MiB: every plan's file limit
stops there, at its ceiling, the most a file can be downloaded whole, until downloads resume). Free → Pro, and each new
month, starts a fresh period with the whole allowance: nothing carries over, and going past an allowance isn't a debt.

**The plan in force** (`inForce`, read with `planNow`) is Team while a team license is live ([Team](#team)), Pro while a
bought month covers now, and Free otherwise. Free's periods count from
when the account began, or from the end of the last month of Pro, whichever is later, so Free starts afresh when Pro ends,
with or without upkeep. Each runs on from the one before as the AI meter keeps it (its `from` and `to`,
`features/billing/meter-state.ts`), at the length `plan.period_seconds` has when it begins, so changing that limit never
restarts a period that's running, nor gives back an allowance spent in it; an account the meter hasn't seen on Free since
it started counts from the start. Pro's months and a team license's period are kept as they were bought or taken.

**What's offered** (`GET /v1/plan/offers`): the period in days, what Free and Pro bring,
the price of a month (`plan.pro.price_micro_usd`, $20) and the most months one purchase buys (`plan.pro.max_months`, 12).

**A year or more for less** (`offers.pro.yearly`): a month costs `plan.pro.yearly_price_micro_usd` ($16, 20% off) when one
purchase buys at least `plan.pro.yearly_from_months` (12): `{ fromMonths, microUsdPerMonth }`. It's `null`, and every
length is a month's price, while that price is 0, isn't below a month's, or is for more months than one purchase buys. The
app works out its "20% off" from the two prices.

**Buying** (`POST /v1/plan/pro { months, microUsdPerMonth }`) runs in one transaction with the account's `plan_accounts`
row locked, so buys at once on any instance never spend the same money twice:

1. More than `plan.pro.max_months` is refused (`invalid`, "Buy 1 to 12 months at a time.").
2. A price other than the one in force for that many months (the yearly price from `yearly.fromMonths`, a month's below
   it) is refused (`conflict`, "The price of Pro has changed. Look at it again before buying."): the app sends the price
   it showed, so a change in between charges nothing.
3. A balance short of months × price is refused (`conflict`, "Your balance is short of what 3 months of Pro cost ($60).
   Add money first."). Nothing changes. The words never say the balance: they're logged with the refusal, and the balance
   is sealed.
4. The months are added back to back, from the end of the last month bought that hasn't ended, or from now. The balance
   goes down by the total, with "Pro, 3 months" in its history, and any grace ends. Logged `pro bought` with the owner,
   months and amount.

**Refunds** (`POST /v1/plan/pro/refund`): every month that hasn't started goes back to the balance at what was paid for it
("Pro refunded, 2 months"), so a month bought at the yearly price comes back at the yearly price. But the yearly price is for
a year or more: a purchase at it that the refund leaves with fewer than `plan.pro.yearly_from_months` months costs a month's
price (as it was when it was bought) for each of its months kept, and the difference comes off what its months give back,
never past nothing. A year refunded at once returns $172, the 11 months that haven't started at $16 less the $4 more the one
kept costs, not $176; a second year bought after the first, refunded before any of it started, returns all of it, and the
first keeps its price. A month that has started isn't refunded; with none to refund it's `conflict` ("There’s no month of Pro
to refund that hasn’t started…"), and when nothing would come back (two months left of a year, say) it's `conflict` too
("Refunding now would give nothing back…"), with nothing changed. `Plan.pro.refundableMicroUsd` says what a refund would
add, by the same rule. Each month keeps the purchase it was one of, so the record keeps every month of a purchase that has a
month still to come; the rest of the months that have ended go, as before. A refund turns renewing off (`Plan.pro.renew`
false, logged `pro renewing set` with `why: refund`): otherwise upkeep would buy back what was just given back, at the
reminder or at the end, paid for by the refund itself. Pro then ends when the month running now does, with `pro-ended`
(and `pro-ending` first, if its reminder hasn't come yet), unless its owner turns renewing on again or buys more months. A
`pro-renewed` notice about a month refunded is dismissed: Pro no longer runs to its `until`.

**Renewing** (`PUT /v1/plan/renew { renew }`) is off by default. Upkeep (`upkeep` in `plans.ts`, every 5 minutes, by
`plan_accounts.due_at`) looks at an account at the earliest of: its release grace ending; `plan.pro.remind_seconds` (3
days) before Pro ends, never before the last month starts; and Pro's end (the last month's `to`). The record keeps which
end it has reminded about (`reminded`) and handled (`ended`), so each happens once for each end:

- **At the reminder:** when renewing will buy (below), a month is bought after the last at the price in force ("Pro,
  renewed for a month") and the owner told `pro-renewed`. Otherwise they're told `pro-ending`. Logged `pro renewed`, or
  `pro ending` with why not (`off`, `price` or `short`).
- **At the end:** when renewing will buy now (turned on, or money added, since the reminder), a month is bought from
  when upkeep comes, `pro-renewed`: that's the end, or later when upkeep is late, so a month already over is never
  bought, and a late pass buys one month, not one for each it missed. Otherwise the account is on Free and told
  `pro-ended`. Logged `pro ended`, with why not.

Renewing buys only while it's on, the balance has the price in force, and that price is no higher than what a month cost
when the last month was bought (its `monthlyMicroUsd`: a month's price then, so a year bought at $16 a month renews at a
month's $20 as it was, not at $16). A higher price is never taken from the balance without the owner seeing it: Pro isn't
renewed, they're told `pro-ending` at the reminder and `pro-ended` at the end, and the money stays in the balance. Once
they buy at the new price themselves, it's what renewing goes by. A lower price renews, and becomes what it goes by.
Nothing renews while a team license is live: Team is the plan in force, so upkeep marks Pro's end handled without buying
or telling anything (logged `pro ended`, `why: team`), as when a license replaces Pro. That includes a license taken after
Pro ended and before upkeep came, which has no month to replace: upkeep reads the license once it holds the plan's row.

**Notices** (`Plan.notices`, newest first, those not dismissed) are shown in the app and, with `NotificationPrefs.plan`
on (the default), from the browser. `POST /v1/plan/notices/:id/dismiss` hides one; another account's ID, or an unknown
one, is `not-found`. The record keeps the latest 20.

**The grace after Pro.** On Free, for `plan.grace_seconds` after the last month of Pro ended, storage is held to Pro's;
nothing runs for it, so it ends on time without upkeep. `Plan.grace` shows it while the account is over Free's storage.
After it, uploads and notes stop while over Free's storage, as above. Buying Pro again lifts that at once.

`Plan.pro` gives the months running and bought (oldest first), when the last ends, whether renewing is on and what a
refund would add. `Plan.pro.renewal` says whether renewing will buy the next month as Pro ends, as upkeep would decide it
now, and why not when it won't: `buys`, or `off`, `price` (a month costs more than the last did) or `short`; null with no
month of Pro left. The app says Pro is ending by it, so after a price rise Settings and the side panel say so once the
owner is told. The record keeps the months that haven't ended and the latest that has (the grace and Free's periods
count from it).

## More notes

More notes for the period running now, on any plan, bought from the balance in packs (`features/billing/plans.ts`
`buyHours`, the route in `routes.ts`). They don't carry over: the app says "for this period".

**What's offered** (`offers.hours`): a pack's minutes (`plan.hours.pack_minutes`, 600: 10 hours), its price
(`plan.hours.price_micro_usd`, $15) and the most packs one purchase buys (`plan.hours.max_packs`, 5). `null` while a pack's
price is 0: none are offered then, and none can be had for nothing.

**Buying** (`POST /v1/plan/hours { packs, microUsdPerPack, minutesPerPack }`) is what buying Pro is, through the same code
(`purchase`): one transaction with the account's `plan_accounts` row locked, the one lock buying and adding money take, so a
buy of Pro and one of more notes at once never spend the same money twice. The app sends a pack as it showed it, its price
and its minutes: a pack's size is part of its price.

1. None offered is refused (`conflict`, "More notes can’t be bought right now.").
2. More than `plan.hours.max_packs` is refused (`invalid`, "Buy up to 50 hours of notes at a time.").
3. A price a pack other than the one in force is refused (`conflict`, "The price of more notes has changed. Look at it
   again before buying."), and so is a pack of other minutes than the one in force, the same price for fewer hours being a
   dearer pack (`conflict`, "The hours more notes bring have changed. Look at them again before buying.").
4. A balance short of packs × price is refused (`conflict`, "Your balance is short of what 20 hours of notes cost ($30).
   Add money first."). Nothing changes.
5. The minutes go to the period in force (the plan's kind and when its period began), on top of any bought for it already;
   any bought for an earlier period are let go. The balance goes down by the total, with "10 more hours of notes" in its
   history (the hours of the whole purchase: "20 more hours of notes" for two packs). Logged `notes bought` with the owner,
   packs and amount.

The allowance is the period's minutes, the plan's and those bought, at `ai.hour_micro_usd` (`inForce` in `plans.ts` adds
them, and the meter reads it), so `Plan.notes.minutesPerPeriod` rises by exactly what was bought, and `minutesLeft` by it
less anything spent past the allowance already (the one note written past it). A stop the spent allowance caused lifts
once what's left is above `ai.stop_micro_usd` (`notes.stopped` goes false; the meter clears its own stop the next time
it's touched). The server never turns a call's notes on again by itself: the organizer's app does, once the plan has
more. After a purchase made since the stop (Pro or more notes, in checkout or paid from anywhere) it turns them on by
itself and says so, retrying a failure that may pass; when the plan has notes again without a purchase (a new period, a
limit raised), it asks the organizer instead, with Turn notes on, and nothing turns on until they press it. A stop full storage caused stays: more notes don't make room. Buying Pro starts a period of its own,
so more bought on Free don't reach it, and none reach the period after the one they were bought for.


## Team

A team (`features/billing/teams.ts`, routes in `team-routes.ts`) is made by one account, its **admin**, who keeps its
settings whether licensed or not. An account is on one team at most. Its people are `team_members` rows; its name and
who's on it are sealed under the team's own key (it's an owner, as a workspace is), and what it bought under `Kservice`
(`team-billing`). Every change locks the team's row first, then the plans it touches, so takes and purchases at once on
any instance never spend a license or money twice.

**Licenses** are bought by the admin from their own balance (`POST /v1/team/licenses { count, microUsdPerLicense, periods }`),
or with a payment that buys them once it's added ([A payment that buys](#a-payment-that-buys)), through the same code
(`teams.ts › licensesBought`, on the terms in `plans.ts › termsOf`): 1 to `team.max_licenses` (500) at a time ("Buy 1 to
500 licenses at a time."), each for one period (`periods` 1, the default) at `plan.team.price_micro_usd` ($40), or for a
year (below), at the price shown (a changed one is `conflict`, "The price of a team license has changed. Look at it again
before buying."), refused with nothing changed when the balance is short (`conflict`, "Your balance is short of what 2
team licenses cost ($80). Add money first.": what they cost, never the balance, as for Pro). The history says "Team, 3
licenses", or "Team, 1 license"; logged `team licenses bought` with the owner, team, count and periods.
`POST /v1/team/licenses/refund` returns every unconsumed license at what it cost ("Team licenses refunded, 2"): its price a
period for each of its periods, so one for a year nobody took gives back all $384. A taken one isn't refunded.

**A license for a year** (`offers.team.yearly`, `{ periods, microUsdPerLicense }`) is one person for
`plan.team.yearly_periods` (12) periods at `plan.team.yearly_price_micro_usd` ($32, 20% off $40) a period: $384. It's
`null`, and none can be bought, while either is 0, it's for one period, or its price isn't below a license's; the app works
out its "20% off" from the two prices, as for Pro. A purchase is for `periods` 1 at a license's price, or the offer's
`periods` at its price, and costs count × periods × price ("Your balance is short of what 3 team licenses for a year cost
($1152). Add money first."); the history says "Team, 2 licenses for a year". Anything else is `conflict`, with nothing
changed: a year at a period's price, or a length that isn't offered, "The price of a team license for a year has changed.
Look at it again before buying." (6 periods: "…for 6 months…"; one period at the yearly price: "The price of a team license
has changed…"), and a year while none is offered, "Team licenses for a year can’t be bought right now." `periods` under 1
or over 120 is `invalid`. Each license keeps how many periods it's for and its price a period in the `team-billing` record
(`periods`, `microUsd`), and they're taken oldest first whatever they're for. Taken, it's live for its periods ×
`plan.period_seconds` from then, and each of those is a period of its own with all of Team's notes, as each month of a
year of Pro is ([On Team](#team)).

**A license is taken on a visit**, by a member without a live one: signing in (both sign-in handlers), and
`POST /v1/session/visit` (`AuthApi.visit`), which the app sends when it loads, when a tab comes back after 30 minutes or
more, and right after its admin's checkout sees licenses bought (so the buyer's own license is taken then, as Done says). Nothing that only reads (`GET /v1/session`, `GET /v1/plan`, …) takes one, so polling never does. A taken license is
live for its periods × `plan.period_seconds` from then (`licensed_from`, `licensed_until`): one period, or a year's 12; one
that has ended is only replaced by a visit.
On a visit:

1. An unconsumed license is taken, the oldest bought, live for the periods it was bought for: one, or a year's 12.
2. None left, with auto-purchase on (`PUT /v1/team/auto-purchase { on }`), the price no higher than a license last cost
   the team, and the admin's balance enough: one for a period is bought at `plan.team.price_micro_usd` ("Team license,
   bought for a member") and taken. Auto-purchase never buys a license for a year.
3. Otherwise none is: the member stays on their own plan and is told `license-needed` (ask your admin; never the admin
   themselves), `wanted_at` is set, and the admin is told `licenses-none`, once until more are bought. Logged `team license
   wanted, none left`, with why none was bought: `off`, `price` or `short`.

Auto-purchase follows renewing's rule ([Pro](#pro)): a higher price is never taken from the balance without the admin
seeing it. What a license last cost the team is kept in its `team-billing` record: the last bought, by the admin (from
their balance or with a payment) or by auto-purchase, or, before any was, the price when auto-purchase was turned on.
Licenses for a year set it to a license's price for a period as it was when they were bought, not the lower yearly price,
since auto-purchase buys for a period (as Pro's renewing goes by a month's price after a year at the lower one): buying a
year at $32 a period leaves auto-purchase buying at $40.
Once the price is higher, auto-purchase buys nothing and the admin is told `licenses-none`; when they buy licenses at the
new price themselves, as checkout shows it, it's what auto-purchase goes by. A lower price is bought, and becomes what it
goes by.

A license taken replaces Pro at once: the running month ends then (not refunded), every month that hasn't started goes,
and the balance gets back what refunding them would give ([Refunds](#pro): what was paid, less a month's price's
difference on the months kept of a year or more that's left shorter, so a year replaced in its first month gives back
$172, not $176; "Refund: 11 months of Pro, for a team license"), and the member is told `license-replaced-pro` with how
many (none, and no line in the history, when nothing comes back). Pro can't be bought while a license is live
(`conflict`). When a take leaves fewer than `team.low_licenses` (5) unconsumed, the admin is told `licenses-low` with how
many are left, once until there are 5 or more again. These notices are in `Plan.notices` with Pro's (`until` null,
`count` where it says), shown and notified as Pro's are.

**On Team** the plan's kind is `team`, its period the license's, its notes `plan.team.notes_minutes` (3,000) for each
member, metered as their own (a new license is a fresh period, with all of it). A license for a year is that many periods
running on from when it was taken (`plans.ts › planAt`, `periodAt`), as Free's do: each with all of its notes, the one
running as the meter keeps it, each after it at the length `plan.period_seconds` has when it begins, and the last ending
with the license. Its largest file
`plan.team.file_bytes` (512 MiB, as Pro's). Storage is the team's **pool**: `plan.team.storage_bytes` (100 GiB) for
each live license, against what everyone licensed stores (their own and the workspaces they pay for). `Plan.storage` and
`MyTeam.storage` show the pool. When the pool shrinks below what's stored (a license ends, someone leaves or is taken off),
it gets `plan.grace_seconds`, held to the pool as it was; upkeep reckons it at each license's end (`teams.due_at`). After
the grace, uploads and notes stop while it's over, as for an account; it isn't given again until the team has been within
its pool. Free's periods after a license count from its end.

**Invites** (`POST /v1/team/invite`, admin only) are one-time links, `{WEB_ORIGIN}/team/join#<secret>`, for
`team.invite_seconds` (1 day). Only a SHA-256 of the secret is kept (`team_invites`), deleted when it's used and by upkeep
once expired; the secret travels only in POST bodies, and invites, peeks and joins keep no receipt. `POST /v1/team/peek`
says whose team it is; `POST /v1/team/join` joins and takes a license (it's a visit). A used, expired or made-up link is
the same `not-found`; someone on a team already is `conflict`, and the link is left for whoever it was for.

**Leaving.** The admin takes people off (`DELETE /v1/team/members/:id`); a member leaves (`POST /v1/team/leave`). A live
license isn't refunded: they're on Free from then, a fresh period, with `plan.grace_seconds` held to
`plan.team.storage_bytes`. Notes they made visible to the team stay so. The team's workspaces they pay for stop being the
team's (below): they stay theirs, with the people in them, counted against them alone. The admin can't leave or take themselves off, and
deletes the team (`DELETE /v1/team/mine`) once nobody else is on it: its unconsumed licenses go back to their balance, its
workspaces stop being the team's. Deleting the admin's account is refused while anyone else is on the team; once nobody
is, the team goes with it. A member's account going takes their place with it.

`GET /v1/team/mine` is the team as its caller sees it (`MyTeam`): its members with their licenses (`live`, `ended`,
`none`, and when they last wanted one), the pool, and for the admin alone the unconsumed licenses, what refunding them
adds, and auto-purchase. `Plan.team` says which team, the caller's role and whether they're licensed. `GET /v1/team` and
`POST /v1/team/invites` are the people directory's, not a team's.

What a team shares opens only for someone **live-licensed** on it, checked at each request: `teams.licensedOn` (an
account) and `teams.licensedBy` (the addresses workspace access knows people by) are the one place that's asked.

**Team notes.** A note's organizer makes it visible to their team (`PUT /v1/notes/:id/team { visible }` → `{ visible }`):
only the organizer ("Only the organizer can make these notes visible to their team."), once the call has ended ("These
notes can be made visible to your team once the call ends."), and only while live-licensed ("You need a license on a team
to make notes visible to it."); any note of theirs, from before they joined too. It's a `team_notes` row (IDs only) for the
team they're on; saying it again changes nothing. It stays visible after they leave the team; they can still make it not
visible (`visible: false`), licensed or not, but not visible again until they're licensed on a team. It goes with the note,
with their account, and with the team. Notes find it third, after their own and those given to them
(`notes/service.ts › locateToRead`): a live-licensed member of that team can read it (`Note`, audio, shared screens,
progress), ask about it, and Ask across notes reads it. `NoteSummary.teamVisible` says whether it's visible;
`received` is `{ role: 'team', by: the organizer, at: when it was made visible }` for someone who has it only that way.
Everyone else who has the note and adds to its shared notes is told the team reads what they add (`PromotionPreview.team`,
`SharedAudience.team`: its name and how many licensed on it aren't otherwise listed), and the seal they add with covers the
team, so making the note visible, or not, after they looked (under the note's lock, `setTeamVisible`) refuses their add
(`409`) until they've seen who reads it now.
Everything else, every change and anything of the reader's on it (sharing, links and their list, decisions, follow-ups,
questions, transcript lines, writing it again, additions and who'd read them, their own notes on it, Drive exports,
removing it from their notes), goes through `locate`, which refuses a note they have only through the team: `forbidden`,
"This note is visible to your team to read and ask about. Only its organizer changes it." It isn't in their Notes list or
inbox: `GET /v1/team/notes` (`teams.notes()`) lists every note visible to the caller's team, theirs too, newest first, as
`NoteSummary`s (none without a live license).

**Ask across notes** (`POST /v1/notes/ask { question, refs? }`) reads the asker's own notes, those given to them and
their team's visible ones. `refs` are the notes the question @-references: more than 5 is refused ("Refer to 5 notes at
most in one question."); each is opened as anything else is, and one the asker can't open is the same `not-found` as one
that never was, before anything goes to the model; one not written yet is `conflict` ("A note you referred to isn’t
written yet. Ask again once it’s ready."). Referenced notes go first, and send their transcript whatever words they share
with the question; nothing else goes that the search didn't pick. The asker pays, as for any question.

**Team workspaces.** A workspace made by someone live-licensed on a team is the team's (`workspaces.team_id`), counted
against its pool through its maker, who pays for it. It's the team's only while whoever pays for it is on the team: when
they leave the team, are taken off it or delete their account, the team's workspaces they pay for stop being the team's at
once (`teams.ts › leftWith`: `team_id` and `team_access` go null), and so does one that comes to be paid for by someone who
isn't on the team, or by nobody, as its payer is settled (`storage.ts › settlePayer`, [When whoever pays leaves](#when-whoever-pays-leaves)). Each stays with its own
people, counted against whoever pays for it, nobody is in it through the team any more, and nobody can open it to a team
again; one handed to someone else on the team stays the team's. `POST /v1/workspaces { name, access? }`, the Drive's New workspace,
makes it the whole team's (`team_access = 'team'`) unless `access` is `added` (only the people added); off a team,
`access` means nothing. One made in a call, and a call's home made for an organizer on a team, is `added`, so a call's
notes never reach the whole team without someone choosing that. Its admins change it (`PUT /v1/workspaces/:id/team-access { access }` →
`{ changed: true }`): someone else in it is refused ("Only an admin can do that."), a workspace that isn't a team's is
`conflict` ("This workspace isn’t a team’s, so there’s no team to open it to."), and opening it to the whole team takes
an admin live-licensed on that team ("Only someone with a license on its team can open this workspace to the whole
team."). On a whole team's workspace, everyone live-licensed on the team is in it to edit without a member row (one added
as `read` edits too, an admin stays admin): `access.ts › standingIn`, from the addresses that sign in to their accounts.
It's in their Drive, and `WorkspaceTree.teamAccess` / `WorkspaceSummary.teamAccess` say which it is. Anything remembered
of that access ends when their license does, and someone leaving or taken off the team, or the team deleted, moves the
team's workspaces on, so nothing remembered outlasts it and every stream looks again. **AI in a team's workspace**
(documents, boards) is paid for by whoever pressed it, from their own allowance, as in any workspace; a guest, there only by
a seat in a call, falls back to the workspace's payer, on the default model.

## Support

`pnpm --filter @alcove/server billing` (`apps/api/src/billing-cli.ts`, `dist/billing-cli.js` in the image) is support's
way into an account's plan, in whichever database `DATABASE_URL` names. It reads only `DATABASE_URL`, `KSERVICE` (to open
and seal plans), `LIMITS_CACHE_MS` and `LOG_*`, with `KMASTER` where it's set, and none of the API's other settings, so it
runs where `KSERVICE` is at hand: outside a TEE, locally, from `.env`. In production the API runs in Confidential Space, where
`KSERVICE` is sealed in its server keys and opened only inside the VM, so no deploy runs it as a job
([Deployment › Support's billing](deployment-and-acceptance.md#supports-billing)).

`<who>` names the account: a top-up's reference (its deposit ID, which the person gives support), or the account's ID.
Wherever a run is recorded (a job's arguments are kept with its execution and in Cloud Audit Logs, which Alcove can't
delete), an address is never one: only where `KMASTER` is set too, which is locally, does an address name an account, found
as sign-in finds it (its blind index, under the index key derived from `KMASTER`). An address signed in to more than one account (through different providers) is refused, and nothing is done.

- `billing show <who>`: the account, the top-up it was named by and its state, its plan and whether Pro renews, how many
  months of Pro aren't over, whether the balance covers a month of Pro at its price now, how many changes to the balance are
  kept, how many notices wait and how many top-ups it has in each state. What it prints may be kept in a log, so that's all
  it says: what a log may hold, never an amount, a history, a date or an address.
- `billing credit <who> <usd>`: adds dollars (`20`, `4.50`, at most $10,000) to the balance, as "Added by support", logged
  `balance added by support` with the owner and the top-up, never the amount. Named by a top-up's reference, it's that
  top-up's money, added in its place, once: the top-up is never asked about again, and the answer to a check of it already
  on its way to 1Click adds nothing, so a payment 1Click settles for it later can't add it a second time, whichever comes
  first. One given up on with no answer from 1Click reads as failed from then on. Refused by its reference, with nothing
  added: one Alcove still watches (open, or cancelled while its address takes a payment), since what reaches it is added by
  itself; one added already, by itself or by support; one settled with nothing to add; and one past the 30 days it's
  watched for. Anything else, such as a second payment to a used address, is added by the account's ID, which
  `billing show <reference>` says. Locally, with an address, it's the fake money for buying Pro without 1Click.

Every refusal (an amount that isn't one, nobody found, more than one account, a top-up still watched or added already)
exits 1 and logs `billing refused` at warn, with its code or why, never what was typed: it may be an address put in the
wrong place.

## Adding money

The balance plans are bought with is filled with USDC, at face value: a USDC is a dollar. USDT isn't taken (a top-up
opened with it before only USDC was taken still settles and shows as before, its line in the balance's history with the
coins rather than a mark, since there's no USDT mark). The person chooses an
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
| Top-up routes (`GET /v1/plan/routes`) | Working. USDC on NEAR, Ethereum, Solana, Base, Arbitrum, Polygon, BNB Chain, Optimism and Avalanche, in that order, while 1Click lists them, each with its minimum. USDT isn't offered; a USDT top-up opened before still settles and shows as before. A server without `TREASURY_INTENTS_ACCOUNT` answers `unavailable` on every top-up endpoint; `ONECLICK_API_KEY` is optional and only lowers 1Click's fee |
| Opening a top-up (`POST /v1/plan/top-ups { routeId, microUsd, buys }`) | Working. With `buys`, what it's to buy is checked first ([below](#a-payment-that-buys)). A 1Click quote paying the treasury exactly that gives a one-off deposit address on the route's chain, open for 24 hours, kept sealed (`deposits`, record kind `deposit`). At most 10 a minute per account per API instance; refused with `conflict` while the account has 15 top-ups waiting for a payment to an address that hasn't expired, or has opened 30 in the last 24 hours (cancelled ones count). Both counts are checked in Postgres, again under a lock on the account in the transaction that inserts the deposit |
| Cancelling a top-up (`POST /v1/plan/top-ups/:id/cancel`) | Working. Only a `waiting` top-up can be cancelled. Its address is no longer shown and it no longer counts toward the 15 waiting. 1Click can't cancel a quote, so a payment that reaches it is still added. It still counts toward the 30 a day |
| Adding a top-up | Working. On `SUCCESS` or `REFUNDED` that passes the checks above, what was sent is added by the rules above, in the transaction that marks the deposit `credited`, under its row lock: once, however many checks race. What it was opened to buy is bought in that transaction while the payment is live (`waiting`, `arriving` or `short`). `FAILED` is `failed`, logged at error. A `failed`, `expired` or `cancelled` deposit is still added when 1Click later settles it, and buys nothing |
| Watching top-ups | Working, unchanged: every open deposit is asked about every 10 s for 15 minutes, every minute until 2 hours, then every 5 minutes, thinning out after its deadline (see below) |
| A top-up paid for before plans, or settled by the previous release whenever it serves (while this one deploys, or after a rollback) | Working. It added credits, which no longer count: upkeep adds it again as dollars, once, on every pass (`creditCarried`: every `credited` deposit still looked at, under its row's lock, then `check_after` infinity). This release never looks at a deposit again once it's added or held, so the only `credited` ones still looked at are those a release before plans added |
| Adding money in the app | Working. Settings › Plan › Add money opens a sheet: choose $20, $60, $120 or your own, then the network to send USDC on (under Pay with USDC; every route is USDC, so there's no token to pick), and get an address (with a QR code) for one payment of exactly that; the sheet follows it until it's added; while it waits for a payment it can be cancelled there; open and recent top-ups are listed under the balance |

### How a top-up works

1. **Routes.** `GET /v1/plan/routes` lists one route per chain on the allowlist of USDC in
   `features/billing/oneclick.ts` that 1Click currently lists in `/v0/tokens` (cached for 10 minutes), in the allowlist's
   order whatever order 1Click lists them in, with its minimum, and the presets. Add money and checkout offer the networks
   in that order. Offering another token means giving Add money its token choice back first.
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
   locked (then, for licenses, the team's row, then the plan's row), so a deposit is added at most once. The balance's
   history reads "Added, 25 USDC". What the top-up was opened to buy is bought then, in the same transaction
   ([below](#a-payment-that-buys)).

Logs about a deposit carry its ID, provider, states, counts and durations, never the address, amounts, hashes or the
quote. Deleting an account deletes its deposits; a payment still on its way reaches the treasury and is added to nobody.

### A payment that buys

Choosing how many months of Pro (packs of more notes, a team's licenses) and sending the total is one step that survives
closing the window: the top-up says what it's for, and the server buys it once the money is in, whoever is watching.

1. **Opening.** `POST /v1/plan/top-ups { routeId, microUsd, buys }`, with `buys` `{ kind: 'pro', months, microUsdPerMonth }`,
   `{ kind: 'hours', packs, microUsdPerPack, minutesPerPack }` or `{ kind: 'licenses', count, microUsdPerLicense, periods }`
   (`periods` 1 by default, or a year's at the yearly price; `buys` `null`, the default, only adds money). Before anything
   is quoted, `buys` is checked as buying it now would be, but for the balance, with the same refusals and words: past the
   most one purchase buys (`invalid`), a price other than the one in force for it (`conflict`, "The price of Pro has
   changed. Look at it again before buying."), a pack of other minutes (`conflict`), more notes or licenses for a year not
   offered (`conflict`), licenses by anyone but a team's admin (`conflict`, "Only a team’s admin buys its licenses.": a
   team is made before a payment for its licenses is opened). It's sealed in the `deposit` record with what's become of it
   (`purchase`), and `TopUp.purchase` reports it: `{ buys, outcome: 'waiting', why: null }`.
   The app asks for what the balance is short of the total (`max(0, total − balance)`), raised to the route's minimum, and
   opens no payment when the balance covers it.
2. **Buying.** In the transaction that adds the settled deposit, after the money is added and under the same locks (the
   deposit's row, for licenses the team's, then the plan's), it's bought exactly as `buyPro` or `buyHours` would buy it
   from the balance (`purchase` in `plans.ts`), or licenses as `POST /v1/team/licenses` buys them (`licensesBought` in
   `teams.ts`), for the team its owner is the admin of when the money arrives: the balance pays the whole total, what was
   there before and what just arrived, and anything over stays in it. The deposit is settled in that transaction, so the
   purchase is tried once, however many checks race. It's bought only while the payment is live (`waiting`, `arriving` or
   `short`): one 1Click settles after the top-up failed, expired or was cancelled is added to the balance and buys
   nothing, so a payment made again for the same thing (checkout's Get a new address, or checkout opened again after a
   cancel) never buys it twice. Every change to a team locks its row before any plan's (teams.ts), so a payment for
   licenses locks the team's row after the deposit's and before the money is added: deposit, team, plan. Nothing locks a
   team's row after a plan's, nor a deposit's after either, so a payment, a purchase from the balance, a visit taking a
   license and the team being deleted, all at once, take their locks in that one order and wait on one another rather
   than deadlock.
3. **What it says.** `outcome` is `waiting` until the money is added (an expired, failed or cancelled top-up stays
   `waiting` until a late payment's money is), then `bought`, or `refused` with `why` in words for people. A refusal leaves
   the money in the balance, where "Buy with your balance" can use it:
   - the payment arrived after the top-up was cancelled, expired or failed: "Your payment arrived after its address
     closed, so nothing was bought. It’s in your balance.";
   - the price changed: "The price of Pro changed before your payment arrived. It’s in your balance." ("The price of more
     notes changed…" for notes, "The price of a team license changed…" for licenses, "The price of a team license for a
     year changed…" for licenses for a year), or a pack's minutes did: "The hours more notes bring changed before your
     payment arrived. It’s in your balance.";
   - licenses for a year stopped being offered: "Team licenses for a year stopped being offered before your payment
     arrived. It’s in your balance.";
   - less arrived than asked for, and the balance with it is short: "Less arrived than 3 months of Pro cost. It’s in your
     balance." ("Less arrived than 2 team licenses cost…" for licenses, "…than 1 team license for a year costs…" for a
     year);
   - everything arrived but the balance it counted on was spent meanwhile: "Your balance was short of what 1 month of Pro
     costs when your payment arrived. It’s in your balance.";
   - one purchase buys fewer now: "Since your payment was made, one purchase buys at most 6 months of Pro. It’s in your
     balance." ("…at most 2 team licenses…"); more notes not offered any more: "More notes stopped being offered before
     your payment arrived. It’s in your balance.";
   - its owner is no team's admin any more (the team was deleted): "You weren’t a team’s admin when your payment arrived,
     so no licenses were bought. It’s in your balance."

Licenses bought this way are the team's as any bought from the balance: unconsumed until a member takes one on a visit,
refunded while nobody has, and the admin is told again when few or none are left ([Team](#team)).

Logged `top-up bought what it was for` or `top-up didn’t buy what it was for; its money is in the balance`, with the
deposit's ID, provider, what it buys (`pro`, `hours`, `licenses`) and why not (`price`, `short`, `too-many`, `off`,
`not-admin`, and `late` with the state it had then): never an amount. Licenses bought are also logged `team licenses bought`, with the owner, team and count.

## Treasury runbook

The server never holds a key that can move treasury money. By hand, in near.com, signed in as the treasury account:

- **Refunds.** A refund lands in the treasury's Intents balance as the token that was sent, as Intents holds it (Solana's USDC, say), not as USDC on NEAR. Swap these to USDC
  on NEAR from time to time.
- **Withdrawals.** Withdraw USDC from the Intents balance in batches, when topping up NEAR AI, not after every payment:
  each withdrawal costs a flat 0.004615 USDC.
- **A stray payment** (a second payment to a used address, or one after it expired) reaches the treasury as a 1Click
  refund and isn't added. The person gives support the top-up's reference (its deposit ID). Support opens that deposit's
  sealed record (`deposits`, under `Kservice`'s accounting key) to find its address, confirms the payment in 1Click's
  status for it, and adds what reached the treasury to their balance by their account's ID, which `billing show <reference>`
  says: `billing credit <account> <usd>` ([Support](#support)). The top-up's reference adds only its own payment, once.
- **A failed top-up** (logged at error with its deposit ID and a reason) is one 1Click reported money for that wasn't
  added. Support opens its record and 1Click's status as above, and adds only what 1Click shows reached the treasury
  (`billing credit <reference> <usd>`). Until then, if 1Click settles it cleanly within 30 days, it's added by itself, and
  then its reference is refused; once support has added it, it never is, even by a check that was on its way to 1Click as
  support added it, so its money is never added twice. It still reads as failed in the person's list of top-ups, and
  their balance's history says "Added by support".
- **A depeg (accepted risk).** Every amount sent is valued at face (1 token = 1 USD). When a stablecoin depegs, turn
  top-ups off (take `TREASURY_INTENTS_ACCOUNT` out of the API's settings in `deploy.yml` and redeploy) until it recovers.

## How it upgrades

The previous release is `main` at `a221e1f1d`, which runs in Confidential Space and has credits, not plans. The deploy
migrates while it still serves: the migration job runs first, with only `DATABASE_URL`, then the group rolls onto the new
image, a new VM first, and `a221e1f1d`'s VM serves until the new one is healthy
([Confidential Space runbook › Deploying](../../infra/confidential-space/README.md#deploying)). Nothing rolls back past this
release: `a221e1f1d` refuses at start a database that applied migrations it doesn't have
([Rolling back](../../infra/confidential-space/README.md#rolling-back)), so recovery is a fix forward.

**Migrations: `0031` to `0034`.** Four, each in a transaction of its own, all additive, after main's `0029_tee_keys.sql` and
`0030_tls_certificates.sql`, which nothing in them depends on. `a221e1f1d` keeps serving while they run, and ignores
everything they add: its inserts name their columns, so the new ones stay null, and every new foreign key into `owners` is
`SET NULL` or `CASCADE`.

- `0031_plans.sql`: new tables `plan_accounts` (record kind `plan-account`) and `ai_meters` (`ai-meter`).
- `0032_workspace_payers.sql`: nullable `workspaces.payer_owner_id`, `payer_grace_until` and `payer_grace_bytes`, a CHECK
  that the last two are null together, the index `workspaces_payer`, and new tables `media_others_days` and
  `media_guest_payer_days`.
- `0033_teams.sql`: new tables `teams`, `team_members`, `team_invites` and `team_notes`, and nullable `workspaces.team_id`
  and `team_access` (null on every workspace there is) with a partial index. `team_members` keeps no hash of a member's
  address: their name and address are only in their sealed `team-member` record, which their sign-in keeps as their
  account has them.
- `0034_workspace_payers_backfill.sql`: gives every workspace its longest-standing admin with an account as its payer,
  the rule upkeep's `settlePayers` and new workspaces follow. On `a221e1f1d` that's a shared workspace's maker, and a call
  home's organizer. It holds only the rows it writes, which are every workspace's: the previous release's reads go on,
  and its writes to a workspace wait for it (about 1.5 s for 50,000 workspaces). A workspace none of whose admins has an
  account stays unpaid until one signs in.

The two new foreign-key columns are `text`, not a domain, so neither `0032` nor `0033` rewrites `workspaces`. Each holds
its lock on the table (and `0032` its foreign key's on `owners`) while it reads the table twice, to check a new column's
CHECK and to build an index. That grows with the table: under 35 ms a file for 50,000 workspaces, measured on Postgres 17
from cache, where the domain-typed columns rewrote the whole table twice, for up to 3 s each.
`scripts/check-migrations.mjs` now refuses a domain-typed column added to a table that's already there.

**Credits become dollars.**

- `billing_accounts` is no longer read or written. It stays for `a221e1f1d`, and goes in a later release.
- Every account starts on Free at $0. Its credits are ignored, and welcome credits aren't carried.
- Every top-up `a221e1f1d` settled (`credited`), before the deploy or while it still serves, is added once as dollars at
  face value by upkeep (`creditCarried`, at boot and every 5 minutes, 100 a pass). It's then never looked at again
  (`check_after` infinity). Credits spent on notes aren't taken off.
- A `deposit` record from `a221e1f1d` opens as before. Its `credits` and `rate` are ignored, and kept on every save. Its
  `purchase` reads as `null`, so it only adds money. Its `settled.addedMicroUsd` reads as `null` until it's carried.
- A payment to an address `a221e1f1d` handed out is added as dollars: what was sent, or exactly what was asked when it's
  within 1Click's band.

**Accounts and workspaces.**

- An account's `plan-account` row is made the first time it's touched, or by upkeep (100 a pass). It's on Free from
  then, and shown the plans once.
- An account already over Free's 10 GB (its recordings plus the workspaces it now pays for) gets 15 days with no storage
  limit.
- Its AI meter starts at its first AI request, with Free's allowance.
- Workspaces `a221e1f1d` makes while both serve (a call's home, a shared workspace) get a payer within 5 minutes: upkeep
  settles them when the new release starts, then every 5 minutes. Nobody is told, and no grace runs. Until then, on the
  new release, nothing can be uploaded to one, its call doesn't open it to guests, its boards seat nobody, and a guest's
  document AI is refused.
- **Calls and meetings stop opening a workspace someone other than their organizer pays for, from the deploy.** A call
  opens its workspace, and that workspace's boards, to everyone in it only while the organizer pays for the workspace. On
  `a221e1f1d` an organizer could pick a shared workspace a colleague made, and its payer is now that colleague. From the
  deploy such a call opens it only to the workspace's own members: its guests, and invitees who aren't members, lose it.
  That includes calls in progress, whose streams reconnect to the new API and are refused, and meetings already
  scheduled. What such a call makes there from the deploy (its board, each room's board) is given by address only to the
  workspace's own people too; what `a221e1f1d` already gave by address stays given. A call's own home is unaffected,
  since its organizer pays for it. Nothing is deleted.

**Calls in progress.**

- They're metered from the deploy on. A live call's state from `a221e1f1d` reads as not stopped by the plan
  (`notes.limit` `.default`), and its notes are charged from its next transcript clip, against its organizer's fresh Free
  allowance. That first clip may reckon what writing the whole call's notes will cost, which can warn the organizer that
  notes are running out, or stop them at once for a long call with much screen shared. While both serve, a save of the
  call by `a221e1f1d` drops such a stop: the banner can go and the organizer be warned twice, and notes stay off.
- Calls live for more than `call.max_seconds` (10 hours) end shortly after the deploy: within 30 seconds of the new
  release starting, without the 5-minute warning. Their notes are written.
- Asking to be let in no longer takes a place: a call is full only by the people in it, checked as someone is let in,
  and one network has at most `call.asks_per_address` (10) asks waiting in a call, a new limit. A live call's asks from
  `a221e1f1d` have no `askedFrom` (a keyed hash of the network an ask came from): they read as null (`.default`), count
  against no network's limit, and are written with it as null the next time the call is saved. While both serve,
  `a221e1f1d` still counts fresh asks among a call's places when it takes a join, so it can turn someone away that this
  release would let ask; it ignores `askedFrom`, and saves the asks it keeps without it.
- A live call's `call-notes` record has a new flag, `guests`: its last refresh didn't work because guests had used their
  share of the organizer's plan. A record without it, from `a221e1f1d` or written by it while both serve, reads as false
  (`.default`), so a view that failed before says what it always did.

**Tabs opened before the deploy see errors until they reload.**

- The new API has no `/v1/credits/*`. In an old tab the balance and Add credits show nothing, and an open top-up sheet
  stops following its payment, then says nothing arrived once its address expires; the payment is still added. Delete
  account loses its warning that a payment is on its way.
- An old tab can't save notification settings: every Alert tick, and turning browser notifications on or off, fails with
  "Some of that input isn't valid." The request now requires `plan`. It isn't given a default: that would accept both the
  old group without it and the new one with it, two shapes on the wire, and a default of on would turn plan alerts back
  on for someone who turned them off in a new tab.
- An old tab can't open a note it has only through a team ("Couldn't open this call").
- A reload fixes all of these.

**While both serve,** `a221e1f1d` can't open a deposit this release opened or settled: its `/v1/credits/top-ups` fails
for that person. Its watcher never settles one, so nothing is added twice; one it claims waits about 17 minutes for the
new watcher, unless its owner's own check settles it first.

**Deposits this release writes don't open in `a221e1f1d`,** which knows nothing of Pro, more notes, teams or who pays for
a workspace either. Nothing rolls back to it past this release (above), so that holds only while its VM still serves.

**Keys.** Plans seal their records (`plan-account`, `ai-meter`, `team-billing`, deposits) under `KSERVICE`'s accounting key,
as credits did, so the TEE changes nothing of them: inside it, `KSERVICE` is the one in the server keys, carried over from
the old one ([Privacy › Moving to confidential computing](privacy-keys-and-sessions.md#moving-to-confidential-computing)).
Carrying the old keys over checks the old `KSERVICE` against accounts' plans as well as their credits from before plans
(`serverKeys.ts`, `opensAccounting` in `features/billing/plans.ts`), so it's refused on a database whose plans it doesn't
open. Blind indexes plans make (a guest's uploads, the workspaces an address made) use the index key the server keeps, as
everything else does. Support's billing CLI has no job in production: [Support](#support).

**Before deploying,** check production:

```sql
-- How big workspaces is: 0032 and 0033 each read it twice under their locks.
SELECT pg_size_pretty(pg_relation_size('workspaces')) AS heap, pg_size_pretty(pg_total_relation_size('workspaces')) AS total;
-- Top-ups still waiting on a payment, which old tabs stop following: deploy at 0, or accept the reloads.
SELECT count(*) FROM deposits WHERE state IN ('waiting', 'arriving', 'short') AND give_up_at > now();
-- Calls live for more than 10 hours, which end at once. If any matter, raise call.max_seconds in service_limits first
-- (a221e1f1d ignores names it doesn't know), and lower it again after.
SELECT count(*) FROM calls WHERE state = 'live' AND started_at < now() - interval '10 hours';
```

Once `0034` has run, live calls whose workspace their organizer doesn't pay for:

```sql
SELECT count(*) FROM workspace_calls c
JOIN calls k ON k.call_id = c.call_id AND k.state = 'live'
JOIN workspaces w ON w.owner_id = c.owner_id
WHERE w.payer_owner_id IS DISTINCT FROM k.owner_id;
```

**Local databases** that applied these migrations before they shipped (under the plans branches' numbers, or as `0029` to
`0032` before main's `0029_tee_keys.sql` and `0030_tls_certificates.sql` took those numbers, or before `0031_plans.sql` lost
`ai_meters.version`, `0032` and `0033` their domain-typed columns, and `0033` `team_members.email_index`) are refused by
`migrate.ts`: start them over (`pnpm db:reset`). Neither main nor production has run them.

**Licenses for a year** (after `main` at `f5cf148e5`, the previous release for them) need no migration: what's new is in
sealed records, the contract and the limits.

- A `team-billing` record's licenses have `periods` (`.default(1)`): one the previous release wrote, or a license it bought,
  reads as a license for one period at its `microUsd`, which is what it was, so taking, refunding and
  `MyTeam.licenses.refundableMicroUsd` read as before. It's written with `periods: 1` the next time the team's record is
  saved.
- A `deposit` record's licenses (`purchase.buys`) have `periods` (`.default(1)`): a payment for licenses opened on the
  previous release buys licenses for one period at the price it was opened at, as it would have.
- `PurchaseSchema`'s licenses and `POST /v1/team/licenses` take `periods`, 1 when it's left out, so a tab opened before the
  deploy buys licenses for a period, from the balance or by payment, as before. It ignores `PlanOffers.team.yearly`.
- The new limits, `plan.team.yearly_periods` (12) and `plan.team.yearly_price_micro_usd` ($32), have defaults: no row is
  needed.
- **While both serve,** the previous release reads a license for a year as a license for one period: a visit it serves
  takes it for one period, a refund it makes gives back one period's price ($32, not $384), and anything it saves of that
  team's record (a visit, a purchase, a refund, auto-purchase, upkeep reckoning the pool) drops every license's `periods`,
  leaving each a license for one period at the lower price. For a member already on one, its plan's period is the whole
  license, and a meter it touches keeps that as one period, which this release then runs to its end: a year's notes in one
  allowance. So that none is sold before the previous release has stopped serving, set `plan.team.yearly_price_micro_usd`
  to 0 in `service_limits` before deploying (the previous release ignores names it doesn't know, and the new one offers no
  license for a year at 0), and delete that row once the previous release's VM is gone.
