# Plans and checkout: the frontend, end to end

Status: approved design (the canvas), building. 12 November 2026.

The design is the canvas **Plans and checkout**, copied into the repo at
[docs/design/canvas/plans/](../../design/canvas/plans/) (open it as [canvas.md](../../design/canvas.md) says, with its own
`support.js`). Its boards are the source of truth for how everything looks and moves:

| Board | What it shows |
|---|---|
| `Plans.dc.html` (+ `page-plans.css`, `data-plans.js`) | The Plans page, round 3: the calm sky, three light cards whose facts line up (subgrid), Pro lifted with a warm edge |
| `Checkout.dc.html` | The checkout window in every stage, desktop and phone |
| `PayMotion.dc.html` | Paying, in motion: the sun rises as the payment lands (slow-motion switch) |
| `Side.dc.html` | The side panel's foot by plan: Free's row and meter, Pro's calm row with its small sun, ending, waiting |
| `Settings.dc.html` | Settings › Plan by plan (`#step=plFree`, `plLow`, `plOut`, `plPro`, `plEnding`, `plEnded`, `plTeam`, `plWaiting`) |
| `CallOut.dc.html` | A call when notes run out: the organizer's two ways to more, an invitee's explanation, checkout over the call |
| `Doors.dc.html` | Where checkout shows, and why: every door into it |
| `StepsPlans.dc.html` | Every journey, frame by frame |

The backend is a friend's, in two open pull requests stacked into `release/plans`: **#274** (phase 1: metering, the AI
allowance, the dollar balance, Free's storage limit, workspaces made on purpose) and **#279** (phase 2: Pro bought from the
balance, renew, refunds, notices). Read `docs/engineering/plans-and-usage.md` on this branch first: it is how the backend
behaves. This build is the branch `plans/frontend`, stacked on `plans/phase-2`.

## Ground rules

1. **The UI looks like the canvas, not like phase 2's UI.** Phase 2's Settings › Plan (`PlanCards.tsx`, the side panel's
   `sb-upgrade`/`sb-notes`, `PlanBanners.tsx`'s Upgrade link) is replaced. Keep only what the canvas never drew: Renew from
   balance, Refund, the plan's notices, the balance with Add money and its open top-ups, the storage grace notes, the call's
   "ends at" banner, the 100-people refusal, and everything about workspaces and filing a call's notes (phase 1). Restyle the
   kept pieces in the canvas's language.
2. **Every number comes from the server** (`GET /v1/plan`, `GET /v1/plan/offers`, `GET /v1/plan/routes`). The canvas's demo
   prices ($15/$12, 24 months, 5 h, 10 GB a month) are not real: Pro is `offers.pro.microUsdPerMonth` ($20 today), bought 1 to
   `offers.pro.maxMonths` (12) at a time; notes are minutes a period; storage is a total, not a month.
3. **Show only what's real.** Team has no offer yet (phase 3): the Plans page shows Free and Pro, and grows a third card when
   the offers carry Team. No workspace limit exists: nothing says "one shared workspace". Pro's largest file is
   `offers.pro.fileBytes` (512 MB today).
4. Everything in AGENTS.md holds: strict types, `@alcove/ui` for anything reusable, tokens only, one filled button per view,
   no green, sentence case, light and dark, 390 to 2000 wide, reduced motion, Storybook stories and journeys for every state,
   docs kept true.

## The backend additions (this branch)

The design needs three things phase 2 doesn't have. They are built here, each in its own commit, in `features/billing`, with
integration tests and docs, so the friend can review them apart:

### 1. A lower price for a year or more

`PlanOffers.pro.yearly: { fromMonths, microUsdPerMonth } | null`. Limits `plan.pro.yearly_from_months` (12) and
`plan.pro.yearly_price_micro_usd` ($16, 20% off $20). `buyPro(months, microUsdPerMonth)` checks the price **for that many
months**: the yearly price when `months >= fromMonths`, else the monthly one; anything else is the existing "price has
changed" conflict. History says "Pro, 12 months". A yearly price of 0 or not below the monthly price means no yearly offer
(`yearly: null`).

### 2. More notes this period (the hours add-on)

`PlanOffers.hours: { minutes, microUsd, maxPacks } | null` (limits `plan.hours.pack_minutes` 600, `plan.hours.price_micro_usd`
$15, `plan.hours.max_packs` 5; a price of 0 turns it off). `buyHours(packs, microUsdPerPack)` →
`POST /v1/plan/hours { packs, microUsdPerPack }`: on any plan, adds `packs × minutes` of notes to **this period's** allowance
(they don't carry over: say "for this period"), takes `packs × price` from the balance under the plan row's lock, history
"10 more hours of notes", and lifts `notes.stopped` when it was the allowance that stopped them (not storage). Refused as
buyPro is: past `maxPacks`, a changed price, a short balance. `Plan.notes.minutesPerPeriod` includes what was bought, so the
meter stays true.

### 3. A payment that buys what it was for

`POST /v1/plan/top-ups { routeId, microUsd, buys }` with `buys: { kind: 'pro', months, microUsdPerMonth } |
{ kind: 'hours', packs, microUsdPerPack } | null`. It's sealed in the deposit record (default `null` for records from
before). In the transaction that adds a settled deposit to the balance, under the same locks, the server then buys it, exactly
as `buyPro`/`buyHours` would. `TopUp.purchase: { buys, outcome: 'waiting' | 'bought' | 'refused', why: string | null } | null`
says how it went; a refusal (the price changed, too little arrived) leaves the money in the balance and says why in words for
people. This is what makes "choose how many months, then send the total" one step that survives closing the window.

The checkout asks for **what the balance is short of**, never the whole price when there's money already: `max(0, total −
balance)`, raised to the route's minimum when it's below it (the extra stays in the balance). When the balance covers it,
there is no payment: Buy takes it from the balance at once.

## The screens

Classes and tokens: the canvas's CSS names map to the app's tokens as `docs/design/building.md` says (`--press`→`sun`,
`--on-press`→`on-sun`, `--now`→`sun-text`, `--focus`→`horizon`, `--notes`→`rose`, `--raised`→`surface-raised`,
`--well`→`sunk`, `--line-strong`→`line-control`). New page styles go in `packages/ui/src/styles/plans.css` with the prefix `pl-`
(free in the kit); the side panel's foot stays in `shell.css` (`sb-`); Settings' rows in `settings.css` (`set-`).

### The Plans page (`/plans`)

`routes/_app/plans.tsx` → `features/plans/Plans.tsx`, on `Evening` with a new moment **`plans`** (just after sunset: a long
low glow, no Horizon sun; the page draws the last sliver of the sun itself, behind the cycle switch; add the moment to
`horizon.tsx`, its `LIFE`, and the canvas with `tools/sync-life.py`). Reached from: the side panel's foot (See plans), Settings ›
Plan (See plans), the welcome page's Plans (after sign-in), and checkout's Compare plans. The side panel's foot row is the
place you're on while on Plans (`is-on`), like a nav row.

- **Top:** "Plans" (`dusk-title`) at the page's top left, search and you at the right, as every page.
- **The sky:** the **Monthly / Yearly · 20% off** switch centred, the sun's sliver on the horizon under it. The switch exists
  only when `offers.pro.yearly` does; its "20% off" is worked out from the two prices. Default Yearly.
- **The cards** (`PlanCards`, `PlanCard` in `packages/ui/src/components/plans.tsx`): Free and Pro (Team when offered), light
  cards (surface, hairline, radius 20) on the water. Each card's parts share rows with the others' (CSS subgrid), so the name
  row, sub, price, bill line, button and every fact line up across cards. Pro is raised (`surface-raised`, `line-control`,
  shadow) with a 2px warm top edge (`sun-glow`), and carries the page's one filled button.
  - Name (17px 600) with a "Your plan" chip (`sun-text` on `sun-soft`) on the plan you're on (not Free's: its button area
    says it), Team with four small arches at the name row's end.
  - Sub: Free "For a few calls a month", Pro "For one person", Team "For 3 people or more".
  - Price: Newsreader 46px (`$0`, `$20` / `$16`), then "a month" / "a person a month".
  - Bill line: Yearly "$192 for 12 months. **You save $48.**" (`sun-text`, 600); Monthly "For as many months as you
    choose. **Or $16 for a year or more.**"; Free "Nothing to pay."
  - Button: Free "Your plan" with a tick, inert, outlined (on Pro or Team: a quiet line "Where you're back to if a plan ends").
    Pro "Get Pro" (primary on Free; secondary "Extend" on Pro, primary only when Pro is ending). Team "Get Team" secondary.
  - Facts, one row each with its icon (notes, upload/hard drive, file): from the offers, e.g. "About 5 hours of notes a
    month" + "Back to 5 hours on the 1st of each period", "10 GB of storage", "Files up to 512 MB"; Pro "About 50 hours of
    notes a month", "100 GB of storage", "Files up to 512 MB". Round hours as the server's text does ("About 5 hours").
  - A last line on Free: "Out of notes before the period ends? 10 more hours are $15." (from `offers.hours`; absent when
    null).
- **Under the cards:** "On every plan", centred, then one row of chips: Calls up to 10 hours, 100 people · A workspace and
  board per call · Ask across your notes · Confidential compute · Invitees get the notes free. Then the paying line with a
  wallet icon: "**Pay in USDC** from any wallet or exchange, for 1 to 12 months at a time. Nothing renews by itself, and when a
  plan ends you're back on Free with nothing lost." (the 12 is `maxMonths`; "Nothing renews by itself" stays true: renewing
  is an opt-in, off by default).
- Phone (≤860): cards stack; the switch sits centred on the sky.

### The checkout window

One window over wherever you are (`features/plans/CheckoutHost.tsx` + the kit's `CheckoutWindow` and parts in
`components/checkout.tsx`), opened by `useCheckout().open({ plan: 'pro' | 'hours', months?, from })` from a
`CheckoutProvider` at the app's root, so the call, Settings, Plans, the side panel and any door open the same thing. In a call
it opens in your theme (`ThemeScope`). It's a `Modal` sized as the canvas (944×672 max, two columns: the step on the left, what
you're buying on the right); on a phone it fills the screen with the summary as one line on top.

**Steps:** Choose → Pay → Done (the numbered pills at the head). Titles: "Get Pro", "Extend Pro" (on Pro), "More notes".

**Choose:**
- *How long* (Pro): cards for 1, 3, 6 and 12 months (lengths ≤ `maxMonths`; 24 if the limit allows), each with its total and
  per-month price; a bracket "20% off" over the lengths at or past `yearly.fromMonths`. "Another length" opens a stepper (1 to
  `maxMonths`). Opens on 12 months when Yearly was chosen on Plans (or the yearly offer exists), else 1.
- *How many hours* (hours): 1 pack (10 hours) up to `maxPacks`, as cards.
- *Pay with USDC on*: the networks of `routes` (USDC only, in the canvas's order: Base, Solana, Ethereum, Arbitrum, Polygon,
  NEAR, Optimism, Avalanche, BNB Chain), each with its `CryptoMark`; a network whose minimum is above $5 shows "From 20". Shown
  only when a payment is needed (the balance doesn't cover the total).
- A network's minimum above what's needed is no refusal: the amount asked is raised to it and the summary says the rest stays
  in the balance.
- Foot: "Compare plans" (quiet, when opened away from Plans) and the one filled button: **Get the address** when money is
  needed, **Buy with your balance** when the balance covers it (no Pay step: straight to Done).

**The summary** (right): the plan's small arched window (the canvas's `pl-win`, Pro's sunset, Team's with people, the hours'
last light), the name ("Pro", "10 hours of notes"), who it's for ("For Art Vandelay" — the signed-in name; "Added to the 6 days
you have left" when extending; "For this period" for hours), the lines ("12 months at $20 — $240", "A year or more: 20% off —
−$48" in `sun-text`), "Your balance — −$5" when there's money, **Total** (24px 600, tabular) "187.00 USDC" = what to send,
"Pro until Thursday 4 November 2027" (counted from now, or from `pro.until` when extending), and the foot line "Priced in US
dollars. 1 USDC is 1 dollar, so you send exactly the total."

**Pay** (a top-up with `buys`):
- Status chip "Waiting for your payment" with moving dots, "Open until tomorrow 16:12" (`expiresAt`).
- "Send exactly" **187.00 USDC** with a copy button; "USDC on Base" with both marks.
- The QR code (`QrCode`, the USDC mark in its centre) and the address in IBM Plex Mono with its first six and last four
  characters bold, Copy address, "After you paste it, check the first and last characters.", "Made for this payment" tag.
- On a phone: **Open in wallet** (the one filled button there; an EIP-681/Solana Pay link where the network has one, else
  copy), and no QR.
- Caution note: "Only send USDC on Base. Anything else may be lost. Sending from an exchange? Add its withdrawal fee on top."
- Foot: "You can close this. Pro starts as soon as your payment arrives." · Cancel payment (asks first, in the foot: "Cancel
  this payment? Its address stops showing here. A payment already sent to it still counts when it arrives." — Cancel payment /
  **Keep waiting**) · Close.
- Closing leaves it running: the side panel's foot says "Waiting for 187 USDC", Settings lists it under the balance, and
  opening checkout again (or the row) reopens this payment, not a new one.

**Seen** (`arriving`): "Payment seen" chip; "**187.00** USDC arrived on Base" with the amount counting up (650 ms, cubic out,
only when it changes while you watch); "Starting Pro. This takes a minute or two."; the track Sent → Seen on Base → Pro starts
with the moving glint; "You can close this. It finishes by itself."

**Done** (`purchase.outcome === 'bought'`, or a balance buy): the tick drawing in, "You're on Pro" / "Pro runs to 10 Nov
2027" / "10 more hours of notes" in Newsreader, "Until Thursday 4 November 2027.", the receipt row (amount, network, date, the
balance entry's reference) with **Receipt** (a printable receipt), "Nothing renews by itself. Alcove reminds you before it
ends." (or, with Renew on, "Renews from your balance."), **Done** (or "Back to the call" from a call).

**The edge states** (each a state with a story):
- *Less arrived* (`short`): caution chip "Less than asked arrived", "Send the rest" **44.00**, "100.00 of 144.00 USDC arrived.",
  same address tag, and the info note "If you don't, the 100 USDC that arrived stays in your balance."
- *More arrived*: Done says "You sent 150.00 USDC, 6.00 more than asked: it's in your balance."
- *Bought refused* (`purchase.outcome === 'refused'`): the money is in the balance; say `why` and offer **Buy with your
  balance** at today's price, or fewer months.
- *Address closed* (`expired`, nothing arrived): "Nothing arrived in 24 hours", "So nothing was charged…", **Get a new
  address**.
- *Failed*: "Something went wrong with this payment" with the reference for support (`RequestRef`).
- *Price changed* (409 on buy or start): "The price of Pro has changed. Look at it again before buying." and the window
  re-reads the offers.
- *Payments off* (`routes` unavailable): Choose says paying isn't available right now; a balance that covers it can still buy.
- *Offline*: the button waits with the app's offline line.

**Motion** (the canvas's `PayMotion`): one move per change, about half a second, transform and opacity only. Waiting: the
summary's sun on its horizon, its glow breathing, the QR's listening ring. Seen: the sun lifts (`translateY(22%)`), the amount
counts up, the track's glint runs. Done: the sun clears the horizon (`-34%`), the dawn layer warms the sky, the glints widen,
the tick pops and draws. Each stage's content rises in (8px, 0.42 s). Reduced motion: every state shows at once, the dots and
glints fade. Storybook keeps the slow-motion switch (`--pm`).

### The side panel's foot (`Sidebar.tsx`, `shell.css`)

Under "Confidential compute":
- **Free:** "**About 1 h 26 min** of notes left" (`sun-text` when under an hour; "No notes left until 1 Dec" in caution when
  stopped), the meter, then a row "Free plan" · **See plans ›** (opens Plans). No "Upgrade to Pro" link.
- **Pro / Team:** a row like the places: the small sun mark (a 12px half sun on a 16px hairline, in the icon column, lined up
  with the shield), "Pro" in Newsreader 18px over "Until 4 Nov 2027" (12.5px ink-2), a chevron; opens Settings › Plan. No
  box, no glow.
- **Ending** (a `pro-ending` notice): the same row, its sun half set, "Ends in 6 days · Extend" in `sun-text` 600; opens
  checkout to extend.
- **Waiting** (an open top-up with `buys`): dots + "Waiting for 187 USDC" (`horizon`), the row "Pro, 12 months" · Open.
- `pro-renewed` / `pro-ended` notices: one short line above the row until dismissed (as phase 2), in the canvas's style.

### Settings › Plan (`features/settings/Plan.tsx`)

The canvas's Plan group, plus what it missed:
- **The plan row:** "Free" / "Pro" / "Team" with its help ("Every feature, with about 5 hours of notes and 10 GB of storage";
  "Until Thursday 4 November 2027. Nothing renews by itself…"; ending in `sun-text`; ended "Pro ended on Tuesday 3 November.
  Nothing was deleted…"), controls **See plans** (quiet) and **Get Pro** / **Extend** (secondary; primary only when out of notes
  or ending).
- **Notes left this period:** the big number with the `SunLine`, help "Back to 5 hours on 1 December. Calls without notes are
  free." (warm when under an hour, caution when stopped).
- **Storage:** "2.4 GB of 10 GB", help "Uploads and call recordings. Files up to 512 MB." (+ the grace notes as phase 2 had
  them, restyled).
- **More notes** (Free, when `offers.hours`): "10 hours for $15, for this period" with **Add 10 hours** (opens checkout for
  hours).
- **Pro** (kept from phase 2, restyled): Renew from balance (switch, saved state) and Refund N months (asks in place).
- **Balance and payments:** the balance with **Add money** (phase 2's sheet, kept, restyled to the canvas's address/QR parts),
  open top-ups (Open / ×), then the history as the canvas's payments list (each entry's network mark when it has one, label,
  amount and date, **Receipt**).
- The plan's notices at the top of the group (kept), in the canvas's style.

### The doors (`Doors.dc.html`)

1. **The welcome page:** a Plans section with Free and Pro as small cards on the cove and **Start free** / **Get Pro**. Get Pro
   signs in, then opens Plans with checkout open on Pro (`/plans?checkout=pro`, kept through sign-in).
2. **The side panel, always:** above.
3. **An hour left:** one toast, once a period, when notes left drop under 60 minutes: "1 hour of notes left this period" with
   **Get Pro** (opens checkout). The foot's number turns warm.
4. **Notes run out in a call:** the call's banner (`PlanBanners.tsx`, the kit's `CallBanner`) for the organizer: "Notes stopped at
   this period's 5 hours" / "The call carries on. Notes start again the moment you have more." with **Get Pro** (primary) and
   **Add 10 hours · $15** (when offered), both opening checkout **over the call**; the Notes panel's pill "Stopped" and its
   caution bar say the same (the canvas's `CallOut`). Invitees: "Notes stopped" / "Art's notes for this period are used up, and
   the call carries on. What was written before stays." with nothing to buy. When the payment lands, notes start again and a
   toast says "You're on Pro. Notes are on again."; the Notes panel marks "Notes on again · 47:32" in `rec`.
5. **Starting or scheduling a call with none left:** the flow's Notes switch row says "None left until 1 December" (caution) with
   **Get Pro** and "Start without notes".
6. **Storage full / a file too big:** an upload refused for storage says "Your storage is full. Pro has 100 GB." with **Get
   Pro** (Free) or **Make room** (Drive); a file over the plan's size says its limit and offers nothing (Pro's is the same today).
7. **Pro ending:** the notices and the side panel's ending row (above), and the browser notification phase 2 sends.

Dropped for now, because the backend doesn't limit them: the second shared workspace, and Team at the third invite (until
phase 3).

## Storybook

Every component gets a story; every page state a scenario; every journey a numbered journey (number them as
`docs/product/user-flows.md` does, continuing its sections). The stand-in (`apps/storybook/src/api`) implements the three
additions, plays a top-up through waiting → arriving → credited → bought on a timer, and has scenarios for: Free (with and
without balance), low, out, waiting, Pro, ending, ended, renewed, short payment, over payment, refused buy, expired, failed,
payments off. Keep a **Paying, in motion** story with the slow-motion switch.

## Docs

`docs/product/user-flows.md` (Plans, checkout, the doors), `docs/design/pages.md` (a Plans section; Settings › Plan; the side
panel's foot), AGENTS.md's component list (every new kit component), `docs/engineering/plans-and-usage.md` (the three
additions, and buying in the app), `docs/engineering/plans-test-matrix.md` (new rows), `docs/design/canvas/plans/README.md`.

## Out of scope

Team buying (phase 3), picking a plan at first sign-in (phase 4, `Plan.choose`), withdrawals, card payments.
