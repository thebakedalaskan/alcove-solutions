# Plans: test matrix

[Docs home](../README.md) · [Plans and usage](plans-and-usage.md)

Every scenario the plans work is tested against, where it's tested, and how it stands. Tests are integration tests over
HTTP (`@alcove/api-http`) against real Postgres, the object store and LiveKit, with the fake NEAR AI (which prices its
models as NEAR AI's catalog does) and the fake 1Click (the "fake money"). Limits are set per test to make a scenario quick:
a minute of notes, an hour's period, a few kilobytes of storage. Rows for later phases say which.

Suites: `billing/meter` (`apps/api/src/features/billing/meter.integration.test.ts`), `billing/plans`, `billing/teams`, `billing/topups`,
`calls/liveNotes`, `calls/callWorkspace`, `recordings/transcripts`, `workspaces/media`, `integration/flows`.

| ID | Scenario | Where | Phase | Status |
| --- | --- | --- | --- | --- |
| **A: signing up** |  |  |  |  |
| A1 | A new account is on Free, with all its notes, $0, and the plans to pick first | billing/plans › a new account starts on Free…; flows › sign-in | 1 | Passes |
| A1′ | The tier screen after the first sign-in | — | 4 | Not built |
| A2 | New account picks Pro with $0: refused, deposit, then buy: Pro's 3,000 minutes, 100 GiB and the whole allowance after spending on Free | billing/plans › Pro › a new account buys Pro once it has the money… | 2 | Passes |
| A3 | New account picks Team: deposit, make a team, buy licenses, the admin takes one on a visit (not by reading the session or plan) | billing/teams › A3: a new account picks Team… | 3 | Passes |
| A4 | An account from before plans: Free from now, credits gone, the plans shown once, 15 days' grace if over Free's storage | billing/plans › accounts from before plans (3 tests) | 1 | Passes |
| A5 | A sign-in from a call link skips the tier screen, which shows on the next load | — | 4 | Not built |
| A6 | Delete the account and sign in again: a fresh Free account | flows › deleting an account | 1 | Passes |
| **B: money** |  |  |  |  |
| B1 | Every 1Click outcome adds dollars at face value: exact, over, within the band, below it, refunded, part refunded, doubtful, late | billing/topups (53 tests) | 1 | Passes |
| B2 | A deposit the previous release settled during the deploy is added as dollars, once | billing/plans › money | 1 | Passes |
| B3 | Cancelling, the 15 waiting, 30 a day and 10 a minute, races between instances | billing/topups | 1 | Passes |
| B4 | Buying with too little balance is refused, nothing changes | billing/plans › Pro › refuses a buy the balance is short for… | 2 | Passes |
| B5 | Buying at a price that changed is refused, nothing charged | billing/plans › Pro › refuses a buy at a price that has changed… | 2 | Passes |
| B6 | Buys at once on two instances never spend twice | billing/plans › Pro › two buys at once on two instances… (both held on the row's lock, then let go) | 2 | Passes |
| **C: Free** |  |  |  |  |
| C1 | 300 minutes a period; renews from when it began; nothing carries over | billing/plans › renews its notes… | 1 | Passes |
| C2 | Free makes as many shared workspaces as it likes, and every one works | billing/plans › makes as many shared workspaces…; workspaces (limits) for `workspaces.max_made` | 1 | Passes |
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
| E6 | An invitee on another plan can still ask after the organizer's stop; a guest can't | billing/meter › after a Free organizer’s notes stop, an invitee on Pro still asks… | 2 | Passes |
| E7 | A room recording runs out the same way | billing/meter › stops a room recording… | 1 | Passes |
| E8 | Two live calls by one organizer both stop | billing/meter › stops every call the organizer has going… | 1 | Passes |
| E9 | Questions at once near the end never spend past the allowance | billing/meter › holds what requests in flight… | 1 | Passes |
| E10 | A bigger allowance lifts the stop; notes come back on | billing/meter › stops notes for everyone… | 1 | Passes |
| E11 | Notes left only goes down: what's held for a call's notes and requests on their way counts for the stop, not for what's shown | billing/meter › says notes left from what was spent… | 1 | Passes |
| **F: Pro** |  |  |  |  |
| F1 | 1 month and 12 months are bought; 13 is refused | billing/plans › Pro › buys 1 to 12 months at a time, and refuses 13 | 2 | Passes |
| F2 | Months run back to back; a refund returns the unstarted ones; with only the running month it's refused | billing/plans › Pro › runs months back to back, refunds… | 2 | Passes |
| F3 | Renew on with the balance: upkeep at the reminder buys the next month (`pro-renewed`); without it `pro-ending`, then Free and `pro-ended`; money added after the reminder renews at the end | billing/plans › Pro › renews from the balance before Pro ends… | 2 | Passes |
| F4 | The reminder before the end and the notice at it, once each; dismissing hides one; another account can't | billing/plans › Pro › tells its owner before Pro ends… | 2 | Passes |
| F5 | Pro ends over Free's storage: the grace (uploads go in), then uploads refused, files readable and deletable; buying Pro lifts it at once; buying in the release grace ends it | billing/plans › Pro › holds storage to Pro’s through the grace… | 2 | Passes |
| F6 | Pro's storage and file size are what's enforced; Pro's files are offered and held at 512 MiB until downloads resume | billing/plans › Pro › holds an account on Pro to Pro’s storage and file size… | 2 | Passes |
| F7 | Support finds an account by its address and adds dollars (`pnpm billing credit`) | billing/plans › support | 2 | Passes |
| **G: Team** | Licenses, invites, visits, alerts, team notes and workspaces, pooled storage |  |  |  |
| G1 | Create a team, buy licenses (1 to 500, at the price shown; a short balance or a changed price refused), the admin takes one on a visit; Team offered from the limits | billing/teams › A3…; G1: offers Team from the limits, and buys 1 to 500 licenses… | 3 | Passes |
| G2 | An invite works once; a second use, an expired one, a made-up one, or someone already on a team is refused; only its hash is kept; upkeep deletes expired ones; only the admin makes one | billing/teams › G2: an invite works once… | 3 | Passes |
| G3 | Joining with licenses takes one; with none, Free and `license-needed` ("ask your admin"), the admin told `licenses-none`, once each; the next visit after more are bought takes one | billing/teams › G3: joining with a license left takes one… | 3 | Passes |
| G4 | The low alert (`licenses-low`, with how many) below 5, once until there are 5 or more again (the browser notification is the app's) | billing/teams › G4: tells the admin once when fewer than 5… | 3 | Passes |
| G5 | Auto-purchase buys a license from the admin's balance when none is left; with the balance short, `licenses-none` | billing/teams › G5: with auto-purchase on… | 3 | Passes |
| G6 | An ended license isn't taken again by `GET /v1/session` or `GET /v1/plan`, only by a visit; Free counts from the license's end meanwhile | billing/teams › G6: an ended license isn’t taken again… | 3 | Passes |
| G7 | Pro→Team: the running month is lost, unstarted months refunded ("Refund: 2 months of Pro, for a team license"), `license-replaced-pro`; Pro can't be bought while licensed | billing/teams › G7: a license replaces Pro at once… | 3 | Passes |
| G8 | An admin without a license still manages the team (invites, buys, auto-purchase, removes); told `licenses-none`, never `license-needed` | billing/teams › G8: an admin without a license still manages the team | 3 | Passes |
| G9 | Unconsumed licenses refunded, never a consumed one; deleting a team refused while others are on it, then its unconsumed licenses refunded | billing/teams › G9: refunds the licenses nobody has taken… | 3 | Passes |
| G10 | A team-visible note opens for licensed members only (read, ask, `teams.notes()`, `received.role` `team`; every change and anything of theirs on it refused with one sentence), only its organizer makes it visible, it stays after the organizer leaves (who can stop it but not start it again off the team), and it goes with the reader's license and with the note | billing/teams › G10: a note made visible to the team opens for licensed members… | 3 | Passes |
| G11 | Ask includes team notes (not another account's, not off a team); @-references go first and send their transcript, at most 5, and a reference to a note you can't open is refused as one that never was, with nothing sent to the model | billing/teams › G11: Ask reads the team’s notes too… | 3 | Passes |
| G12 | The pool = 100 GB × live licenses, shared by everyone licensed; a license ending shrinks it below what's stored: the grace (held to the pool as it was), then uploads refused until there's room | billing/teams › G12: pools 100 GB a live license… | 3 | Passes |
| G12′ | Whole-team vs added-only workspaces (the team edits a whole team's without being added, in their Drive; admins switch it, only on a team's, opening it only with a license there), counted against the pool; out at once when taken off the team, and when a license ends | billing/teams › G12′: a team workspace is the whole team’s or only the people added… | 3 | Passes |
| G13 | Team workspace AI is billed to the member who pressed it; elsewhere to the workspace's payer | billing/teams › G13: AI in a team workspace is paid for by whoever pressed it… | 3 | Passes |
| G14 | A removed member drops to Free (a fresh period) with the grace at a team's storage for a person, loses the team, and their license isn't refunded; a member can leave; the admin can't leave or take themselves off | billing/teams › G14: someone taken off the team drops to Free… | 3 | Passes |
| G15 | Each licensed member has their own 50 hours, the whole of it from when the license is taken | billing/teams › G15: each licensed person has their own notes… | 3 | Passes |
| **H: calls** |  |  |  |  |
| H1 | A call says when it ends, ends at 10 hours, and writes its notes | billing/plans › ends at its longest… | 1 | Passes |
| H2 | The 101st person is refused and whoever hosts is told | billing/plans › turns away anyone past the most people… | 1 | Passes |
| **I: privacy and upgrades** |  |  |  |  |
| I1 | Nothing readable about plans in any row or log: the balance's history label is a canary; a team's name, a member's name and address, a `team-billing` record's fields and its history label are canaries, and an invite's secret is in no row or log | flows › privacy at rest | 1, 3 | Passes |
| I2 | Top-ups stay their owner's | billing/topups › keeps top-ups to their owner | 1 | Passes |
| I2′ | Team, member and invite IDs work only on the caller's own team, as its admin; another account's notice is unknown | billing/teams › I2: team, member and invite IDs… | 3 | Passes |
| I2″ | A note ID (to read, to refer to in Ask, to make visible or not) and a workspace ID (to read, to set who's in it) from a request reach only what the caller can open; another team's notes and workspaces are unknown | billing/teams › I2: a note, a reference or a workspace from a request… | 3 | Passes |
| I3 | Deleting an account deletes its plan and allowance | billing/plans › deleting an account | 1 | Passes |
| I3′ | Deleting an account takes a member off their team; the admin of a team with others on it is refused; an empty team goes with its admin | billing/teams › I3: takes a member off their team… | 3 | Passes |
| I4 | A live call’s state from the previous release reads (no `notes.limit`), as not stopped, and carries on | billing/plans › reads a live call the previous release stored… | 1 | Passes |
| I5 | A `plan-account` record in phase 1's shape (no `pro`, `renew`, `notices`) reads, and Pro is bought on it | billing/plans › Pro › reads a plan the previous release stored… | 2 | Passes |

## Workspaces (changed 12 Nov 2026)

A workspace is made only when someone presses New workspace, and a call has one workspace or none
([Calls and recordings › The call's workspace](calls-and-recordings.md#the-calls-workspace)). The suites below were being
rewritten for it when this was written, so each row is In progress until the suite has run green on the branch.

| ID | Scenario | Where | Phase | Status |
| --- | --- | --- | --- | --- |
| W1 | A call with no workspace has none: opening Workspace, however many at once and whoever does, makes nothing | calls/callWorkspace › which workspace a call uses › is none until its organizer makes or picks one… | 1 | Passes |
| W2 | The organizer's New workspace in a call makes one for it: named after the call, its folder at the top, everyone invited in it, a guest nowhere | calls/callFolders › a call's workspace › is made by the organizer pressing New workspace… | 1 | Passes |
| W3 | Scheduling with `newWorkspace` makes one for the call, or for every call of a series, with everyone invited in it | calls/callWorkspace › … is made as a call is scheduled when its organizer asks… | 1 | Passes |
| W4 | A picked existing workspace gets a folder for each call and lets nobody in | calls/callFolders › … is the workspace chosen when it was scheduled…; calls/callWorkspace › … lets nobody in when the organizer picks one that's there… | 1 | Passes |
| W5 | Only the organizer picks or makes it; a stand-in, someone not yet in the call, and a read-only role are refused | calls/callWorkspace › … refuses whoever isn't in the call yet, and the organizer's last connection, and a stand-in… | 1 | Passes |
| W6 | A pick in a call carries to the series' later calls, never earlier ones | calls/callWorkspace › … comes with the meeting, and the organizer's pick in a call carries to the calls after it… | 1 | Passes |
| W7 | Switching lets the old folder go: removed if empty, a plain ended folder if not; the notes go where the call is | calls/callFolders › … moves with the organizer's pick… | 1 | Passes |
| W8 | A new board, or rooms' boards, with no workspace are refused (`409`), saved boards still open, and the board is made once the organizer makes one | calls/boards-in-calls › … is nowhere in a call with none…; … still opens: a call and a meeting from before any of this… | 1 | Passes |
| W9 | A workspace the organizer can't edit in any more takes no folder and no new board | calls/boards-in-calls › … is refused in a call's workspace the organizer can't edit in any more…; calls/callFolders › … takes no folder when it has no room for one… | 1 | Passes |
| W10 | A call with notes and no workspace ends unfiled (`filed` false), and nothing makes a workspace until the organizer says | calls/callFolders › filing a call's notes › is asked of the organizer… | 1 | Passes |
| W11 | `meetings.file` puts the folder and its note at the top of a workspace they can edit in, or a new one, and lets nobody in to a picked one | calls/callFolders › filing a call's notes › puts them at the top of a workspace…; … is the organizer's alone… | 1 | Passes |
| W12 | A call whose workspace was deleted has none, and the notes can be filed again | calls/callWorkspace › … survives its workspace being deleted…; calls/callFolders › … takes a call whose workspace was deleted as one with none | 1 | Passes |
| W13 | Who's in a workspace made for a call follows its invite; one picked for it doesn't | calls/callFolders › who's in a workspace made for a call | 1 | Passes |
| W14 | An account makes workspaces up to `workspaces.max_made`, however each was made | workspaces/workspaces › … lets an account make as many workspaces as workspaces.max_made says… | 1 | Passes |
| W15 | A call from before this (`viewing`, `made`, a home made by the previous release) reads: everyone has the meeting's workspace | calls/callWorkspace › what the previous release stored › … still opens a call that was viewing another workspace than its home…; calls/callFolders › what the previous release stored | 1 | Passes |
| W16 | Nothing readable in a workspace made for a call (its name, an address) | calls/callFolders › what's kept of a workspace made for a call | 1 | Passes |
| W17 | Delete workspace from the Drive row, the workspace's menu and the call's frame menu, by an admin alone | workspaces/workspaces › … is deleted by an admin alone…; the three menus by hand | 1 | Passes |

## Checked by hand

The app run locally on its own ports and database (`pnpm limits` to make a scenario quick), and Storybook for what a live
call needs. A call with notes wasn't run by hand: it needs a microphone's audio sent to NEAR AI, and the suites above
drive it end to end.

| What | Where | Seen |
| --- | --- | --- |
| Signing up | App › Settings › Plan, light and dark, phone | Free, renews in 30 days, about 5 h of notes, under 1 MB of 10 GB, $0 |
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
- `account/notifications` (phase 2): notification preferences carry `plan`, the browser notification for Pro's notices,
  on unless turned off
- `billing/plans` (phase 3): a notice carries `count` (null for Pro's)
