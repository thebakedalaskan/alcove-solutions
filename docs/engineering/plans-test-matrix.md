# Plans: test matrix

[Docs home](../README.md) · [Plans and usage](plans-and-usage.md)

Every scenario the plans work is tested against, where it's tested, and how it stands. Tests are integration tests over
HTTP (`@alcove/api-http`) against real Postgres, the object store and LiveKit, with the fake NEAR AI (which prices its
models as NEAR AI's catalog does) and the fake 1Click (the "fake money"). Limits are set per test to make a scenario quick:
a minute of notes, an hour's period, a few kilobytes of storage. Rows for later phases say which.

Suites: `billing/meter` (`apps/api/src/features/billing/meter.integration.test.ts`), `billing/plans`, `billing/topups`,
`calls/liveNotes`, `calls/callWorkspace`, `recordings/transcripts`, `workspaces/media`, `integration/flows`.

| ID | Scenario | Where | Phase | Status |
| --- | --- | --- | --- | --- |
| **A: signing up** |  |  |  |  |
| A1 | A new account is on Free, with all its notes, $0, and the plans to pick first | billing/plans › a new account starts on Free…; flows › sign-in | 1 | Passes |
| A1′ | The tier screen after the first sign-in | — | 4 | Not built |
| A2 | New account picks Pro with $0: deposit, then buy | — | 2 | Not built |
| A3 | New account picks Team: buy licenses, the admin takes one | — | 3 | Not built |
| A4 | An account from before plans: Free from now, credits gone, the plans shown once, 15 days' grace if over Free | billing/plans › accounts from before plans (3 tests) | 1 | Passes |
| A5 | A sign-in from a call link skips the tier screen, which shows on the next load | — | 4 | Not built |
| A6 | Delete the account and sign in again: a fresh Free account | flows › deleting an account | 1 | Passes |
| **B: money** |  |  |  |  |
| B1 | Every 1Click outcome adds dollars at face value: exact, over, within the band, below it, refunded, part refunded, doubtful, late | billing/topups (53 tests) | 1 | Passes |
| B2 | A deposit the previous release settled during the deploy is added as dollars, once | billing/plans › money | 1 | Passes |
| B3 | Cancelling, the 15 waiting, 30 a day and 10 a minute, races between instances | billing/topups | 1 | Passes |
| B4 | Buying with too little balance is refused, nothing changes | — | 2 | Not built |
| B5 | Buying at a price that changed is refused | — | 2 | Not built |
| B6 | Buys at once on two instances never spend twice | — | 2 | Not built |
| **C: Free** |  |  |  |  |
| C1 | 300 minutes a period; renews from when it began; nothing carries over | billing/plans › renews its notes… | 1 | Passes |
| C2 | One shared workspace; a second is refused; joining others and a call's own are fine | billing/plans › makes one shared workspace…; by hand | 1 | Passes |
| C3 | A file over the plan's size is refused; storage fills and refuses, counted against whoever made the workspace | billing/plans › takes files…; workspaces/media (limits); by hand | 1 | Passes |
| C4 | Call recordings count; full storage stops notes for everyone (reason storage), and notes need 1 MiB to come back | billing/plans › counts call recordings… | 1 | Passes |
| **D: metering** |  |  |  |  |
| D1 | Each request charges the right payer: organizer (transcript, captions, live notes, notes), asker (ask, catch-up, ask a note, ask all), organizer for a guest, workspace's maker for document AI | billing/meter › who pays; calls/liveNotes; calls/callWorkspace; recordings/transcripts; flows | 1 | Passes |
| D2 | A reply without usage is reckoned and charged | billing/meter › charges what NEAR AI says… | 1 | Passes |
| D3 | A request NEAR AI turned away costs nothing | billing/meter › charges nothing for a request NEAR AI turned away | 1 | Passes |
| D3′ | A request that timed out once sent is charged what was held | — | 1 | Not tested: the fake can't time out after receiving |
| D4 | A model the catalog doesn't price is charged at the fallback | — | 1 | Not tested: no unpriced model can be chosen; covered by reading `meter.ts` |
| D5 | A dearer model spends more for the same question | billing/meter › charges at the price of the model that answered… | 1 | Passes |
| D6 | No request reaches NEAR AI without a payer | `Meter` is a required argument of `transcribe`, `complete` and `completeJson`: the typecheck refuses one without | 1 | Enforced by the compiler |
| **E: running out** |  |  |  |  |
| E1 | The organizer alone is warned, at the call's pace | billing/meter › tells the organizer alone… | 1 | Passes |
| E2 | Spent: notes off for everyone, guests included, banner until closed, the call goes on | billing/meter › stops notes for everyone…; the banner's × by hand | 1 | Passes |
| E3 | Then transcription, the organizer's AI and a guest's questions are refused; notes can't come back on | billing/meter › stops notes for everyone… | 1 | Passes |
| E4 | The last note covers only what was said before the stop, and may go past the allowance | billing/meter › stops notes for everyone… | 1 | Passes |
| E5 | Then nothing: the next call starts without notes, saying why; asks and room recordings are refused | billing/meter › stops notes for everyone… | 1 | Passes |
| E6 | An invitee on another plan can still ask after the organizer's stop | — | 2 | Needs a second plan (a Pro invitee) |
| E7 | A room recording runs out the same way | billing/meter › stops a room recording… | 1 | Passes |
| E8 | Two live calls by one organizer both stop | billing/meter › stops every call the organizer has going… | 1 | Passes |
| E9 | Questions at once near the end never spend past the allowance | billing/meter › holds what requests in flight… | 1 | Passes |
| E10 | A bigger allowance lifts the stop; notes come back on | billing/meter › stops notes for everyone… | 1 | Passes |
| E11 | Notes left only goes down: what's held for a call's notes and requests on their way counts for the stop, not for what's shown | billing/meter › says notes left from what was spent… | 1 | Passes |
| **F: Pro** | Buying 1–12 months, refunds, renewing, reminders, expiry into grace | — | 2 | Not built |
| **G: Team** | Licenses, invites, visits, alerts, team notes and workspaces, pooled storage | — | 3 | Not built |
| **H: calls** |  |  |  |  |
| H1 | A call says when it ends, ends at 10 hours, and writes its notes | billing/plans › ends at its longest… | 1 | Passes |
| H2 | The 101st person is refused and whoever hosts is told | billing/plans › turns away anyone past the most people… | 1 | Passes |
| **I: privacy and upgrades** |  |  |  |  |
| I1 | Nothing readable about plans in any row or log: the balance's history label is a canary | flows › privacy at rest | 1 | Passes |
| I2 | Top-ups stay their owner's | billing/topups › keeps top-ups to their owner | 1 | Passes |
| I3 | Deleting an account deletes its plan and allowance | billing/plans › deleting an account | 1 | Passes |
| I4 | A live call’s state from the previous release reads (no `notes.limit`), as not stopped, and carries on | billing/plans › reads a live call the previous release stored… | 1 | Passes |

## Checked by hand

The app run locally on its own ports and database (`pnpm limits` to make a scenario quick), and Storybook for what a live
call needs. A call with notes wasn't run by hand: it needs a microphone's audio sent to NEAR AI, and the suites above
drive it end to end.

| What | Where | Seen |
| --- | --- | --- |
| Signing up | App › Settings › Plan, light and dark, phone | Free, renews in 30 days, about 5 h of notes, under 1 MB of 10 GB, 0 of 1 shared workspaces, $0 |
| A second shared workspace | App › Drive | Refused: "Free has one shared workspace, and you have it. Move to Pro for as many as you like." |
| Storage full (`plan.free.storage_bytes` 1 KiB) | App › a workspace | An upload is refused: "Your storage is full. Delete something, or move to a plan with more room." |
| The side panel | App and Storybook | Upgrade to Pro above "About 5 h of notes left", on Free only |
| Notes have stopped | Storybook › Calls › Notes, wide and phone | Drops from the top; × closes it, and it stays closed through a reload in that tab |
| About 5 minutes left, and the call's end | Storybook › Calls | The organizer's banner; everyone's "This call ends at…" |

## Found along the way

- The welcome page still said "400 minutes of notes" (the old credits' welcome). It says about 5 hours a month now.
- `limitsNow` read the limits through the pool inside transactions. Uploads started at once ran the pool dry: each
  transaction held a connection and waited for another to read the limits. It now reads on the caller's connection,
  under a savepoint, so a failed read leaves the transaction going on what was in force.
- The call's card, for anyone with the link, said why notes stopped. It says only that they're off now (calls/capture,
  billing/meter).
- Notes in the call offered Turn on with no word of why notes were off. Notes and what's captured now say why, in the
  banner's words; Turn on stays, as it works again once the plan has notes.
- A refused upload leaves its document with an empty picture block, as before plans. Free's storage limit makes that
  more likely: not changed here.

## Changed by this work

These suites tested credits: their charges are removed (AGENTS.md: removed behaviour's tests go) or now check who pays.

- `calls/liveNotes` › "is the organizer's to pay for, whoever is watching, as the notes at the end are"
- `calls/callWorkspace` › asking Alcove about a selection "…is paid for by whoever the workspace counts against"
- `recordings/transcripts` › writing notes again pays for every answer the model gave
- `notes/keep`, `calls/calls`, `meetings/connections`: credit assertions removed
- `workspaces/media`: the file and storage limits are the plan's (`plan.free.file_bytes`, `plan.free.storage_bytes`),
  storage is per account, and the 80% warning is the account's
- `integration/flows` › plans (was credits)
