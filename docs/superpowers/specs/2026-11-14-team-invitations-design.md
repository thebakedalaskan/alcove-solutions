# Teams anyone can join: free teams, invitations and their email

Design, 2026-11-14. The user approved it in conversation the same day:

- **A team is free to start.** Joining one changes nobody's plan. Team licenses are the upgrade, and they are what share
  the team's notes, workspaces and storage (option 1 of three: the others were "each other's Team page" and "only paid
  teams take invitations").
- **Alcove sends the invitation email itself**, through Resend, and it's a beautiful one.
- **Someone already on Alcove gets the email and an invitation in the app**: Team appears in their side panel with a
  count, and the Team page opens on the invitation.
- **Pro and a free team:** joining changes nothing; a license taken later replaces Pro and gives back what's left of it.

The user saw these calls and didn't object, so they stand: Pro refunded by the day; anyone on a team can invite;
invitations last 30 days; Not now tells nobody; "buy one for whoever joins later" ticked when upgrading; the team made at
your first invitation; no plan picker for someone joining a team; still one team per person.

After a builder's read, my calls (the user hasn't seen them): one link per team, its admin's (3.4); Start a team free
everywhere, checkout only for Upgrade (4.10); per-address email caps and a one-click way to stop invitation emails (5.1);
an inviter's invitations end when they leave (3.3); the previous release keeps reading every record (10).

## 1. Why

Today, on 14 Nov 2026:

- Invite people, Invite, Remind and Invite all open your own mail app with a `mailto:` draft (`features/team/People.tsx`).
  Alcove sends no email of its own anywhere ("needs a decision before it can ship: an email provider",
  `2026-11-03-app-redesign-design.md`).
- Your company page isn't a team anyone belongs to. `features/meetings/people.ts` works it out for each person from their
  email domain and the people they've met. A Gmail account has no company and so no Team page. Your invite link
  (`/invite#…`, PR #335) only makes new accounts: someone already on Alcove sees "You're on Alcove already … nothing to do
  here".
- The paid Team plan is a real team (`features/billing/teams/teams.ts`) that any account can join, but only through a
  one-time link its admin copies (`/team/join#…`, a day). It has no email or in-app invitation either, and a team only
  starts at checkout, with licenses bought.

The user's words: "If I invite someone, they should get an email to join. If they're already on Alcove they still get the
email, but they should also have a notification in the app: maybe the Team section appears in the navbar for them, with a
notification saying they've been invited to join a team."

## 2. Goals, non-goals, anti-goals

**Goals**
- One meaning of "your team": a `teams` row. Free to make, any address can be on it, with an admin and members.
- Inviting from the Team page puts people on your team, whether or not they're on Alcove yet.
- Alcove emails every invitation. Someone already on Alcove also finds it in the app.
- Someone already on Alcove can join, by invitation or by a link.
- Upgrading a team is buying its licenses. Nobody pays twice for Pro and a license.
- The email is beautiful and private: no tracking, nothing fetched from outside, nothing readable kept at rest.
- It feels like a mature product: every state says what it is and what to do, in place, with nothing to work out.

**Non-goals**
- More than one team per person. It stays one, and joining another asks first.
- Handing a team's admin role to someone else.
- Bounce and complaint webhooks, marketing email, digests, a welcome email.
- Changing what licenses share, or any price.
- Real-time pushes of a new invitation to an open tab (the app looks again, below).

**Anti-goals**: what would make this a failure even if it works.
- An inviter learns that someone said no, or that an address has an account, or is on another team.
- Anything readable about who's invited is stored, logged or put in a URL: addresses, names, team names.
- A team is made for someone without the screen saying so before they press.
- A second kind of team beside the `teams` row, such as a "company team" people join.
- Teams that exist today stop working: their licenses, members, notes and workspaces carry on as they are.
- The email loads anything from a server, or wraps links through a tracker.

## 3. The model

### 3.1 A team

A team is a `teams` row as today: an owner of its own, whose key seals its name and who's on it, with one admin (who made
it) and members. An account is on one team at most. What changes:

- **It's free to make.** `POST /v1/team/new { name }` already makes one without buying anything. It's now also made for you
  by your first invitation (3.3) and by someone joining from your link (3.4), named after your company page
  (`Team.name`, such as "Vandelay"), or "<your first name>'s team" at a personal address. The admin can rename it.
- **Its tier** is derived, never stored: `team` while anyone on it has a live license or licenses bought for it wait to be
  taken, otherwise `free`. `MyTeam.tier` says which. So a team upgraded by a payment that lands while nobody's there reads
  Team at once.
- **On a free team** everyone stays on their own plan, Free or Pro, for their own notes and storage. They see each other on
  the Team page. What a team shares (notes made visible to it, Ask across them, whole-team workspaces, the pool) still
  opens only for someone live-licensed on it (`teams.licensedOn`, `teams.licensedBy`), unchanged.
- **Upgrading** is buying licenses (unchanged). Each member takes one on their next visit (unchanged); the team is on Team
  from the moment they're bought.
- **A license kept.** Someone who leaves, or is taken off, while their license runs has it kept for them by the team until
  it would have ended (sealed in its `team-billing` record, by a keyed hash of the team and their account): back on the
  team before then, by any way in, they have that one again, as it was, instead of taking or buying another. So leaving and
  joining again never spends a license twice.

### 3.2 Who can do what

| | Admin | Member |
| --- | --- | --- |
| Invite by email, copy the team's link | yes | yes |
| Make a new link (the old one stops working) | yes | no |
| Resend or cancel an invitation | any | their own |
| Rename the team | yes | no |
| Remove someone | yes | no |
| Upgrade: buy and refund licenses, auto-purchase | yes | no: "Ask Sam to upgrade" |
| Leave | no: deletes it once nobody else is on it | yes |

### 3.3 An invitation

An invitation is a stored record that someone on a team asked one address to join it:

- It has the team, the address, who invited them, when it was made and when it was last emailed, and when it runs out.
- It runs out after `team.invitation_seconds` (30 days). Resend emails it again and starts the 30 days again.
- One per address per team: inviting an address again refreshes the one there is.
- It ends when it's used, cancelled, runs out (upkeep deletes it), or its team is deleted (cascade), and when whoever
  invited them leaves the team, is taken off it or deletes their account: what they asked goes with them, and its link
  stops working. The admin can invite them again.
- Each invitation has its own link, `/invite#<secret>`, which only its email carries. The secret is derived from the team's
  root and the invitation's ID (as your link's is from your root, `inviteLinkSecret`), so Resend's email carries the same
  link every time, and nothing but its hash is kept. Anyone holding it can use it once: it doesn't need to be the
  address it was sent to (people have more than one account).
- In the app, the account whose sign-in addresses include the invited address sees it, through a blind index of the
  address (purpose `team-invitee`, never joinable with `identities.email_index`). Accepting it there needs no link.
- **Not now** puts it aside for the invitee only: it leaves their count, stays on their Team page as put aside, and stays
  "Invited" on the team's list until it runs out. Nobody is told: what they put aside is kept in their own sealed profile,
  never on the invitation, and the route keeps no receipt.

### 3.4 The team's link

A team has **one invite link**, its admin's (the invite link from #335, `/invite#<secret>`, the same until it's made
again). Everyone on the team copies that one link, and only the admin can make a new one, which stops the old one for
everybody: one press shuts a link that went too far. Whoever opens it, new to Alcove or not, can join the team.

- With no team, your own link is yours as today: someone joining from it makes your team then (3.1), with you as its admin,
  so your link becomes the team's.
- A member's own link leads nowhere while they're on someone else's team (the same `not-found` as any dead link). It works
  again if they leave.
- Taking someone off the team, deleting it, and its admin deleting it to join another make its link again, in the same
  transaction: a link someone taken off copied can't put them back, and a deleted team's link leads nowhere, even to a team
  made anew for its admin.
- "Joined from your link" (`invite_link_joins`, `POST /v1/team/link/joined`) goes: they're on your team instead.
- Anyone with a company page or a team has a link to copy (today only a company page does).

## 4. Flows

Copy is the copy to build. Names are the demo's: Sam invites; Vandelay is Sam's team; Lumen is another.

### 4.1 Invite people

The popover on a company page or a team's page (People.tsx `InvitePeople`):

- Its label is **Invite people to Vandelay**: the team's name, or on a company page with no team, the name the team will
  take.
- On a company page with no team, a line under the field says once, quietly: **Alcove emails them. This starts Vandelay,
  a free team, with you as its admin.**
- Rows: people at your company not on the team (the directory, or colleagues you meet), each with who they are, as today.
  Any whole address typed counts, at any domain. Someone on the team isn't offered ("Ken is on Vandelay."). Someone
  invited is ticked off with "Invited", and pressing them offers Resend.
- **Invite 3** sends. No mail app opens. The toast: **Invited Priya, Ken and 1 other to Vandelay.** (It never claims an
  email went: one may wait for the next day, or the address may have stopped Alcove's emails, which nobody is told.)
- The foot keeps **Copy link** (the team's link, or yours with no team) and, for the admin or with no team, **Make a new
  link** (asked in place, as now).
- Over today's limit, the first ones asked are invited, up to what's left, and the answer says how many weren't (`over`), for
  the toast to say. Refused, said in the toast, only when none are left today: **You've invited 20 people today. Invite
  more tomorrow, or copy your link.** (the limit, `team.invitations_per_day`); your own address, **That's you.** (in the
  list, as now). The app sends 50 at most.

Every Invite, Remind and Invite all button on the page does the same thing for its people (Remind becomes **Resend**).
`invitation()`, `openEmail` and every `mailto:` go.

### 4.2 Who's invited, on the team's page

Under the team's people, a section **Invited** lists each invitation, newest first:

- The person as the directory knows them (or the address), **Invited by Sam · 2 days ago** (**Invited 2 days ago** if by
  you), and **Runs out in 3 days** in its last week.
- **Resend**, for whoever invited them and the admin: sends it again, once a day at most and at most 3 times in 30 days
  (**Sent today** or **Sent 3 times** until then, disabled: `resendWhy` says which, `recent` or `most`, with `sends`, this
  team's own count), and starts the 30 days again. Toast: **Sent Priya's invitation again.** `madeAt` says when they were
  first invited.
- **Cancel**, the same people: asked in place (TeamAsk), **Cancel Priya's invitation?** / **Their link stops working.**,
  **Cancel invitation** / **Keep it**.
- Empty: the section isn't there.

When someone joins, they're on the team's line and rows like everyone else, with **Joined today** on their row.

### 4.3 New to Alcove: from the email

1. The email (section 5): **Join Vandelay**.
2. `/invite#<secret>` (Invited.tsx): the team's evening, JoinCard: the team's faces (up to 4), **Sam invited you to join
   Vandelay**, **Priya, Ken and 3 others are on it. Alcove is for calls: each one gets its notes and a workspace of its
   own.**, and the ways in (WaysIn), and See what Alcove does as now.
3. Signing in makes the account, then joins the team at once (they pressed Join in the email), then the arrival goes on as
   from the welcome page, **without the plan picker** (`POST /v1/plan/chosen`: someone joining a team doesn't choose a
   plan), to Home, with the toast **You're on Vandelay.**
4. An invitation that's been used, cancelled or ran out: **This invitation has ended** / **Ask Sam to invite you again.**,
   with Open Alcove. (Sam is named when the link still says who: the invitation's gone, so this says **Ask whoever invited
   you to invite you again.**)

### 4.4 Already on Alcove: in the app

- The app reads your invitations (`GET /v1/team/invitations`) when it loads, every minute while it's open, and when the
  window comes back, as Drive's tags are read (`places.ts`).
- **The side panel shows Team** while you have any invitation, even with no company and no team, with a count of those not
  put aside: a count says something waits on you. The phone's tab bar shows Team too.
- **A toast, once per invitation in this browser**: **Sam invited you to join Vandelay**, with **View**, which opens Team.
  (What's been toasted is a per-viewer convenience in localStorage, read and written in try/catch.)
- **The Team page opens on it.** With no team: the Team evening shows one JoinCard per invitation, newest first:

  ```
       (Sam)(Priya)(Ken)
       Sam invited you to join Vandelay
       Priya, Ken and 3 others are on it.
       [ Join Vandelay ]   Not now
  ```

  With a company page and no team, the card stands at the top of the company page's water. On a team, it's a Notice at the
  top of the team's water: **Sam invited you to join Vandelay.**, **Join Vandelay**, **Not now**.
- **Join**: you're on Vandelay at once (taking a license if there's one, as any join does), the page is Vandelay's, and the
  toast says **You're on Vandelay.**
- **Not now**: the card goes quiet, under **Put aside** with Join still there, and leaves the count.

### 4.5 Opening a link while signed in

Your email link or a team's link, opened while signed in, shows the same card on `/invite`: **Sam invited you to join
Vandelay** (an email link), **Join Vandelay on Alcove** (a team's link: anyone on the team may have shared it, so it names
the team, with its faces) or **Sam asked you to join them on Alcove** (the link of someone with no team yet), with **Join
Vandelay** (or **Join Sam**) and **Not now** (to Home). Your own link, or your team's, says **This is your team's invite
link** (**This is your invite link** with no team). Nothing says "nothing to do here" any more. Signed out, the same titles
head the card with the ways in. An email link opened by the person it's to, signed in, carries the invitation's ID
(`InvitePeek.invitationId`), so Not now puts it aside there too; for anyone else holding it, it's null. Opened by someone on
its team already, it's theirs (`yours`), and joining their own team by it is refused, **You're on that team already.**,
leaving it for whoever it's for.

### 4.6 Already on a team

Joining another team asks in place first, on the card:
- A member of Lumen: **Joining Vandelay takes you off Lumen.** / **Leave Lumen and join**.
- Lumen's admin, alone on it: **Joining Vandelay deletes Lumen, which only you are on, and its invitations.** /
  **Delete Lumen and join**. Unconsumed licenses go back to your balance, as deleting does.
- Lumen's admin, with others on it: **You admin Lumen, and 3 others are on it. You can join Vandelay once nobody else is
  on Lumen.** Join is disabled; Not now stays.

On the server it's one transaction: leave (or delete) and join, so nobody is ever left between teams. A live license on the
team you leave isn't refunded, as leaving does today.

### 4.7 A free team's page

OnTeam.tsx, for a team whose tier is `free`:
- The sky: its name, then **Free · 5 people** (on Team: **Team · 5 people**, as the page says today).
- Admin: **Invite people** and **Upgrade** (the one filled button is Invite people until someone else is on the team, then
  Upgrade). Members: **Invite people**.
- The water starts with what the tier means, once: **Vandelay is on Free.** / **Upgrading gives everyone on it a license:
  the team's notes and workspaces open to everyone, and storage is pooled.** with **Upgrade** for the admin, or **Ask Sam
  to upgrade** for members (then **Sam's been asked**, for `team.upgrade_ask_seconds`, 7 days).
- Then the people, Invited (4.2), and, at a company, **At Vandelay, not on the team yet**: colleagues not on it, each with
  Invite, and Invite all, as the company page's lists are.
- Team notes and workspaces show what they'd hold, saying they need Team, never a blank.
- The admin's **Rename** (an IconButton beside the name, a popover with the name in TeamName's box): **Rename team**.
- A member without a license on a free team is told nothing about licenses: the caution about a missing license
  (`NoLicense` in the side panel, the notice at the top of the water) is only for a team on Team with none left for you
  (`license-needed`).

### 4.8 Upgrading

- The admin's Upgrade opens checkout on Team for the team they have (no naming step): licenses for everyone on it without
  one, at least 1, Monthly or Yearly, and **Buy one for each person who joins later** ticked (auto-purchase, carried with
  the purchase, `autoPurchase`, and set in the transaction that buys the licenses, from the balance or as a payment's money
  arrives). Pay as today. Auto-purchase buys at most `team.auto_purchase_per_day` (10) licenses for one team in a UTC day:
  past it, whoever needs one is told to ask, and the admin that none are left, as when the balance is short.
- Licenses bought answer every ask to upgrade: the asks go.
- The admin is told licenses are low (`licenses-low`) only by what's spare, the unconsumed less those spoken for by people
  on the team without one, and never while auto-purchase is on: an upgrade sized to the team says nothing.
- Done: **Vandelay is on Team** / **Everyone gets their license the next time they open Alcove.**
- **Ask Sam to upgrade** (members, free teams) tells the admin once: a plan notice `upgrade-asked`, **Ken asked you to
  upgrade Vandelay.**, with Upgrade, shown and notified as plan notices are. The name is the app's, from `MyTeam.members`
  by the notice's `memberId`; the notice keeps no name.

### 4.9 Pro, licenses and refunds

- Joining a free team changes nothing about your plan. On Pro you stay on Pro and pay for it as before.
- A license taken while on Pro replaces Pro at once, as today, but **what's left of the running month comes back too, by
  the day**: `replacedByLicense` gives back the unstarted months (unchanged), plus the running month's price × the part
  of it not yet used, less the yearly difference `refundOf` owes, taken only from a purchase that still has months to
  come, as `refundOf` takes it. A purchase with none to come that's had fewer than its yearly months (bought at a
  month's price, or refunded, which took the difference then) reckons its running month at a month's price and owes
  nothing again: a year at $16 refunded a day into its third month ($132 back), then a license a week later, gives back
  $20 × 22/30 = $14.666666. The notice `license-replaced-pro` carries the amount (`microUsd`): **Vandelay covers your
  plan now. The rest of your Pro, $12.40, went back to your balance.** (nothing came back, for Pro Alcove gave:
  **Vandelay covers your plan now, in place of Pro.**). History: **Refund: the rest of Pro, for a team license**.
- Leaving or being taken off a team with a live license: Free from then, a fresh period, with the grace held to Team's
  storage (unchanged), and the license kept for them until it would have ended (3.1).
- A team whose licenses end and aren't bought again goes back to Free: everyone's on their own plan, and what it shared
  stays, closed until it's upgraded again (unchanged rules; the page says **Vandelay is on Free. What it shared opens again
  when it's upgraded.**).

### 4.10 Starting a team

**Start a team is free everywhere**: Plans' Team card (and the plan choice a new account sees, which is the same card), and
the welcome page's Start a team (after signing in). It names the team in place (TeamName, the company page's name filled
in at a company), makes it (`api.teams.create`), and goes to its page, where Invite people and Upgrade are. Nobody buys
licenses for a team that doesn't exist yet: checkout on Team is only an existing team's Upgrade (4.8), so checkout's naming
step and its "team just started" Done go. Someone with no company page has no Team page until they start a team, are on
one, or are invited.

## 5. The email

### 5.1 Sending

- **Provider:** Resend, REST (`POST https://api.resend.com/emails`), from the API, never the browser. No SDK: the API
  calls its other providers with `fetch` and parses replies with zod, and so does this (`providers/resend.ts`).
- **From** `Alcove <invites@mail.alcove.solutions>`, **Reply-To** the inviter's address. Subdomain `mail.alcove.solutions`:
  its records live under it, so the root's Cloudflare email routing, SPF and DMARC (`p=quarantine`, relaxed alignment)
  stay as they are.
- **Config:** `RESEND_API_KEY` (a send-only key restricted to `mail.alcove.solutions`; Secret Manager
  `alcove-resend-api-key` in production, read at startup like the others), `MAIL_FROM`, and `RESEND_API_URL` (default
  `https://api.resend.com`; the tests point it at a stand-in). Without a key, nothing is sent: the outbox row is dropped
  with `mail not sent: no provider` at info, and the in-app invitation and the link work as ever.
- **An outbox**, so a slow or failing Resend never fails an invitation: inviting writes a `mail_outbox` row in its own
  transaction, sealed (5.4), for every invitation made or sent again, whatever will become of it, and a sender sends due rows
  right after the commit and on every upkeep pass. Whether one goes is the sender's to decide as it claims it (stopped, an
  address's caps, the day's), never the request's, so nothing a request answers, nor how long it takes, says. Sent (2xx):
  the row is deleted. 429 or 5xx or no answer: tried again with backoff (honouring `retry-after`), at most 8 times over a
  day, then dropped at warn. Any other 4xx: dropped at error, with Resend's error name. Each send carries an
  `Idempotency-Key` (the row's ID), so a retry never sends twice.
- **Limits** (dynamic, `platform/limits.ts`): `team.invitations_per_day` (20 an account: invitations and resends),
  `team.invitation_seconds` (30 days), `team.invitation_resend_seconds` (a day), `team.upgrade_ask_seconds` (7 days),
  `mail.per_day` (90, all of Alcove: Resend's free plan sends 100 a day), and for each address
  `mail.address_per_day` (1 invitation email a day from all of Alcove) and `mail.address_per_team` (3 from one team in
  `team.invitation_seconds`; cancelling and inviting again doesn't reset it). Deleting a team takes none of what these count
  with it: a mailbox's emails that day still count, and a team made anew counts only its own sends.
  An address is taken in its canonical form for these and for stops (lower-cased; a `+tag` dropped at any domain; at
  gmail.com and googlemail.com its dots dropped and the domain gmail.com), so every way of writing one mailbox shares them;
  the email still goes to the address as typed, and the app still finds an invitation by the address exactly. What the caps
  count is a send log of its own, `mail_sends`, by keyed hashes of the address and the team, with no key to `teams`. Past
  `mail.per_day`, rows wait for the next UTC day; past an address's caps, no email goes. Either way the invitation is
  already there in the app. `team.auto_purchase_per_day` (10) is the most licenses auto-purchase buys for one team in a day.
- **Stopping them**: every invitation email says, in its foot, **Don't want invitations from Alcove? Stop them.**, a link
  to `/stop-email#<token>` (a public page with one button, **Stop invitation emails**, and then **Alcove won't email you
  invitations again.**), and carries `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
  (RFC 8058) pointing at `POST /v1/mail/stop`. The token is an HMAC of the address's canonical form under a
  `KSERVICE`-derived
  key, so nobody can stop someone else's, and stopping one way of writing a mailbox stops them all. A stopped address's
  blind index (purpose `mail-stop`) is kept in `mail_stops`; its
  invitations are still made and still show in the app, and are never emailed. Nobody is told it stopped.
- **Tracking stays off**: the domain is created with open and click tracking off, and nothing in the email is wrapped.

### 5.2 What it says

- Subject: **Sam invited you to join Vandelay on Alcove**, with at most 40 characters of the team's name (the last an
  ellipsis); the body has it whole.
- Names are whatever someone typed, so in the subject, the HTML and the text each `.`, `:` and `@` in a person's or a team's
  name is followed by a zero-width space: no mail app makes a link of "evil.com" in one. The link, and the inviter's address
  in the foot, are as they are.
- Preheader (hidden): **Priya, Ken and 3 others are on it. Join them on Alcove.**
- Heading: **Sam invited you to join Vandelay**
- **Alcove is for calls: each one gets its notes and a workspace of its own.**
- The team's faces in arches (initials, up to 4), and **Priya, Ken and 3 others are on Vandelay.** (just Sam: **Sam is
  on Vandelay.**)
- The button: **Join Vandelay**, then **Or open this link:** and the whole link, so it works where buttons don't.
- Foot: **Sam Kowalski (sam@vandelay.industries) invited you. The invitation runs out in 30 days. If you weren't
  expecting it, you can ignore this email.**, **Don't want invitations from Alcove? Stop them.** (5.1) and **Alcove ·
  alcove.solutions**.
- A plain-text part with the same words and the link.

### 5.3 How it looks

Alcove's evening, as an email can carry it:
- Table layout, inline styles, 560px wide on a desktop and the full width on a phone, with a 16px gutter.
- A wide evening sky with the low sun on the horizon at the top, drawn from the Team page's evening (`Horizon`, moment
  `team`), and the Alcove mark. Both are PNGs at twice their size, attached inline (`content_id`), so nothing is fetched
  from a server when it's opened.
- No web fonts: loading one is a fetch from a server each time it's opened. The heading's stack starts with Newsreader (for
  anyone who has it) and goes on through Iowan Old Style, Palatino and Georgia; everything else is Hanken Grotesk, then the
  system sans. People in arches, never circles. The button is a solid `sun` fill with `on-sun` text, as in the app.
- Light by day; dark under `prefers-color-scheme: dark` (Apple Mail, iOS) with the night's colours, and colours that
  survive Gmail's own darkening.
- Checked in Storybook (an Emails story, the real template in an iframe at desktop and phone widths, light and dark) and by
  sending it to Resend's test address and to a real inbox the user chooses.
- The template is plain TypeScript building HTML and text from plain data (no React on the server), in a package both the
  API and Storybook can import (`packages/mail`, recorded in the folder map). Its images are base64 in its source
  (generated from PNGs by a script kept beside them), since the API's bundle carries no files of a package's.

### 5.4 Privacy

- An outbox row is sealed with a key of its own derived from `KSERVICE` (label `alcove/mail-outbox/v1`), header binding its
  ID: the recipient, subject, both bodies, the reply-to, and the send it is (`mail_sends`, or none when the team's own cap
  held it back). It's deleted once sent or dropped. Logs carry its ID, the HTTP
  status and Resend's error name, never an address or a word of it.
- Resend sees the recipient, the inviter's name and address, the team's name and the members' first names and initials in
  it, and the invitation's link, and keeps them 30 days (every plan). Documented in Privacy, keys and sessions as a
  processor, with what it sees. The link is that invitation's alone, and stops working once it's used or cancelled.

## 6. The server

### 6.1 Storage (migration `0038_team_invitations.sql`, additive)

- `team_invitations`: `invitation_id` (PK), `team_id` (FK `teams` ON DELETE CASCADE), `invited_by` (FK `team_members`
  ON DELETE CASCADE), `invitee_index bytea` (the blind index), `secret_sha256 bytea UNIQUE`, `ciphertext bytea` (sealed
  under the team's key, kind `team-invitation`, header binding team and invitation: the address and when it was first
  made), `expires_at timestamptz`, `sent_at timestamptz`, UNIQUE (`team_id`, `invitee_index`), an index on
  `invitee_index`, `expires_at` and `invited_by`. Nothing says whether it was put aside: that's in the invitee's own sealed
  profile (`putAside`, the IDs they put aside, `.default([])`), which a read forgets of each that's no invitation to them.
- `mail_outbox`: `mail_id` (PK), `send_after timestamptz`, `attempts int default 0`, `ciphertext bytea`.
- `mail_days`: `day date` (PK), `sent int`: how many went that UTC day, for `mail.per_day`.
- `mail_stops`: `address_index bytea` (PK, blind index `mail-stop`), `created_at`.
- `mail_sends`: `send_id` (PK), `address_index bytea` (blind index `mail-address` of the canonical address), `sender_index
  bytea` (blind index `mail-sender` of the team's ID), `sent_at`, `emailed_at` (when its email went, set as the sender takes
  it). No key to `teams`: what the caps count outlasts a team. Upkeep keeps `team.invitation_seconds` of it, a day at least.
- The team's `team-billing` record gains `kept` (licenses kept for people who left with them, by a keyed hash under
  `HKDF(Kservice, "alcove/team-kept-license/v1")`) and `autoBought` (the day's count), each with a default, so the previous
  release reads past them. A payment's licenses (`deposit` record) gain `autoPurchase`, null by default.
- The upgrade asks (who asked, when, whether the admin dismissed it) live in the team's `team-billing` record (zod ignores
  keys it doesn't know, so the previous release still reads it), and the admin's `upgrade-asked` notices are made from them
  when the plan is read: no new notice kind is stored in the plan-account record, which the previous release parses with
  its own list of kinds.
- No backfill: nothing exists yet.

### 6.2 Routes (the contract, `packages/api`)

People (`/v1/team…`, the directory's, unchanged paths):
- `GET /v1/team` → `Team | null` (company): `members[].invited` now means a live invitation to your team for them.
- `POST /v1/team/invites` (`inviteToTeam`) goes.
- `POST /v1/team/link` → `InviteLink` `{ link }` (no `joined`): the team's link (its admin's) on a team, your own with no
  team; refused only with neither a company page nor a team.
- `POST /v1/team/link/new` → `InviteLink`: the admin, or with no team; refused for a member (`forbidden`).
- `POST /v1/team/link/peek { secret }` (public, rate-limited) → `InvitePeek`: `{ kind: 'link' | 'invitation', from: Person,
  yours: boolean, team: { name, people, faces } | null, invitationId: ID | null }`, for either kind of secret (looked up as a
  link, then as an invitation); `invitationId` is an invitation's own ID to the person it's to, signed in, and `yours` is
  also true for someone on an invitation's team; `not-found` for anything that leads nowhere.
- `POST /v1/team/link/joined` goes.

Teams (`/v1/team/…`):
- `GET /v1/team/mine` → `MyTeam` with `tier` and `invitations: TeamInvitation[]` (every member sees them; each with `madeAt`,
  `resendAt`, `resendWhy` and `sends`, from this team's own sends alone).
- `POST /v1/team/new { name }` (unchanged).
- `PUT /v1/team/name { name }` → `MyTeam` (admin).
- `POST /v1/team/invitations { emails }` → `{ team: MyTeam, invited: number, already: number, over: number }`: makes your
  team first if you have none (3.1), skips anyone on it, refreshes anyone invited, and invites in the order asked up to
  what's left of today's limit (`over`, the rest).
- `POST /v1/team/invitations/:id/resend` → `MyTeam`; `DELETE /v1/team/invitations/:id` → `MyTeam`.
- `GET /v1/team/invitations` → `InvitationForYou[]`: those to your addresses, not run out, newest first.
- `POST /v1/team/invitations/:id/accept { leave }` → `MyTeam`; `POST /v1/team/invitations/:id/put-aside` → `void`, keeping
  no receipt.
- `POST /v1/team/join { secret, leave }` → `MyTeam`: an invitation's link or someone's invite link.
- `POST /v1/team/upgrade-ask` → `void` (a member of a free team).
- `POST /v1/team/licenses { count, microUsdPerLicense, periods, autoPurchase? }`, and a payment's licenses
  `{ …, autoPurchase }`: auto-purchase set with the licenses bought.
- `POST /v1/mail/stop { token }` (public, rate-limited, no receipt; also the one-click `List-Unsubscribe-Post` target) →
  `void`, the same answer for any token, valid or not.
- `POST /v1/team/invite` and `POST /v1/team/peek` (the one-time links) go; `/v1/team/join`'s body changes (above).

`leave: true` is what the card's in-place question sends. Without it, someone on a team gets `conflict` naming the team they
are on, and nothing changes. Inviting, Resend, Cancel, accepting, joining and renaming keep their receipts by IDs and counts
alone: the answer's shape, with no name or address and not the team's name, so a retry answers as the app expects and a
receipt names nobody for its day.

### 6.3 Rules

- Every query is scoped: an invitation is read for its team's members, or for an account only through its addresses'
  blind index, or through its secret. An ID from a request that isn't yours is the same `not-found` as one that never was.
  Cross-owner tests for every new ID.
- Accepting checks the invitation is to one of your addresses; joining by secret checks the secret; both lock the team's
  row first, then your account's, as `join` does now, so two at once never put someone on two teams. Nobody joins the team
  they're on by an invitation (`conflict`, "You're on that team already."), and the invitation is left unused.
- Inviting holds the team's row, so two people inviting one address at once make one invitation, and reads the inviter's
  place again once it's held (taken off meanwhile: `conflict`). Whatever two changes at once still run into is a `conflict`
  to try again, never a failure of Alcove's.
- Inviting an address on the team already counts as `already`; an address of yours is refused (`invalid`, "That's you.");
  with none of today's invitations left, the whole request is refused (`conflict`) and nothing changes.
- A whole email address is required (the contract's address schema); at most 50 in one request.
- Joining a team whose tier is `team` takes a license on the spot if one is there (it's a visit), as `join` does now.

### 6.4 Upkeep

Upkeep deletes invitations that ran out, the sends the caps no longer count, and the release before's one-time links
(`team_invites`) once they've run out, as it can still make them while a deploy rolls; sends the outbox, and drops rows past
their tries. It never deletes what's still live. Each pass logs counts only.

### 6.5 Logging and errors

`team invitations made` (team, count, made, again, held, over, already), `team invitation accepted` / `put aside` /
`cancelled` / `resent`, `team joined from a link` (`kind`), `team license given back`, `team license wanted, none left` (why:
`off`, `price`, `daily`, `short`), `invite link made again` (why), `mail sent` / `mail retried` / `mail dropped` (mail ID,
status, Resend's error name; why: `held`, `stopped`, `address`, `refused`, `tries`, `unreadable`), `team upgrade asked`.
Never an address, a name or a team's name.

## 7. The app

- `places.ts`: Team shows with a company page, a team, or an invitation; a `team` count of invitations not put aside.
- `features/team/`: Invite people (4.1), Invited (4.2), the invitation card (4.4–4.6), the free team's head and water
  (4.7), Rename, Upgrade and Ask to upgrade (4.8). The folder holds at most 20 files, so this is likely a subfolder or two
  (`invitations/`), recorded in the folder map.
- `Invited.tsx` (the `/invite` page): both kinds of secret, the new card states (4.3–4.6), the join on arrival and the
  skipped plan picker.
- Gone: `invitation()`, `openEmail`, every `mailto:`, `useMarkInvited`, `useTeamAtThirdInvite` and `teamDoor.ts` (an
  invitation makes a team now; the door was Team offered at the third invite), `StartTeam.tsx` and the company page's
  Start a team row (`TeamStartRow`) (inviting starts one), the `/team/join` route and `Join.tsx`, `invite.ts` and
  `TeamInvite` (the one-time links), the hero's "X joined from your link".
- Checkout: Team for a team that exists skips naming (4.8); Done for a team just started offers Invite people, not a
  one-time link.
- The side panel's plan foot: no `NoLicense` caution on a free team (4.7).

The kit (`packages/ui`) gets what's missing and reusable: the invitation card's states on `JoinCard`, a row for an
invitation, a free tier line for `TeamLine`'s sky. AGENTS.md's component list says what's added and removed.

## 8. Storybook

- The stand-in (`apps/storybook/src/api`) implements every new method with scenarios: a company page with no team, a free
  team (admin and member), invitations pending, an account with invitations and no team, one on a team, a solo admin, an
  admin with others, an upgrade.
- Stories for each new part and page state, light and dark, phone and wide, and the email (5.3).
- Journeys renumbered with `docs/product/user-flows.md` flow 10: invite by email; an existing account's Team appears and
  joins; a new account from the email; Not now; Resend and Cancel; upgrade from Free; joining while on a team.
- Journeys that test the one-time links or "joined from your link" are rewritten or deleted.

## 9. Docs

`docs/product/user-flows.md` (flow 10, and 16's team parts), `docs/product/overview.md` (Team, and the two "Alcove sends no
email" rows), `docs/design/pages.md` (Team, the invite page), `docs/engineering/plans-and-usage.md` (Team: free teams,
invitations, refunds by the day), `privacy-keys-and-sessions.md` (invitations, the outbox, Resend), `data-and-storage.md`
(the new tables), `logging-and-errors.md` if it lists events, `docs/engineering/folder-ownership.md` (`packages/mail`,
new subfolders), `infra/` (the Resend secret, the domain), and AGENTS.md.

## 10. How it upgrades

- Migration 0038 only adds tables. The previous release never reads them, so it keeps serving while the deploy migrates.
- `team_invites` (the one-time links) and `invite_link_joins` stop being read or written; a later release drops them. Rows
  left in them expire or mean nothing. The limit `team.invite_seconds` goes; a stored override for it is ignored.
- The profile's `invited` list stops being read, but the stored profile keeps writing it as it was for one release: the
  previous release requires the field, and it runs beside this one while the deploy rolls. A later release removes it.
- New stored fields all have defaults, and the previous release reads past them, but a record it saves drops them: a team's
  `kept` licenses, its `autoBought` count and its `asks` (someone back on the team then takes or is bought a license as
  anyone joining does; the day's count starts again; an ask can be made again); a payment's `autoPurchase` (auto-purchase
  stays as it is); and the profile's `putAside`, which any profile it saves drops (a setting changed, or a sign-in that
  writes the profile whole), so what was put aside comes back into the count.
- `PlanNoticeSchema` gains `microUsd` and `memberId`, both `.nullable().default(null)` in the stored notice schema, so
  notices from before read as they were. `license-replaced-pro` notices from before have `count` and no `microUsd`: the
  app says them as before ("N months of Pro went back to your balance"), and one with neither says "…in place of Pro".
  No record the previous release parses gains a value it doesn't know (upgrade asks: 6.1).
- Teams from before are paid teams with an admin, members and licenses: they read as tier `team` while a license is live or
  licenses wait for it, `free` otherwise, which is what they are.
- `team_invites` rows the previous release makes during the deploy lead nowhere here, and upkeep deletes each once it's run
  out.
- The previous release's app, open in a tab, calls `/v1/team/invite`, `/v1/team/peek`, `/v1/team/link/joined` and
  `/v1/team/invites`, which now 404, so those presses say "Something went wrong" until the tab reloads. Two more fail there
  until it reloads: its Copy link, as its `InviteLink` schema requires the `joined` the link no longer has; and, for a free
  team's admin with an ask to upgrade, reading the plan, as its notice schema doesn't know `upgrade-asked`. Acceptable for a
  release; nothing stored is harmed.

## 11. Rollout

1. Resend: the domain `mail.alcove.solutions` (us-east-1, tracking off), its records added to Cloudflare by API, verified.
   A send-only key restricted to it, put in Secret Manager as `alcove-resend-api-key`, and granted to the attested
   identity as the others are.
2. One pull request, reviewed once at the end, merged when CI passes and the domain is verified, then deployed.
3. After the deploy: an invitation from production to an inbox the user names, checked in Resend (`delivered`) and by eye;
   the live bundle has the new copy.
4. The user deletes the setup key and the send-only key that was printed in a session log.

## 12. Approaches considered

- **A team, free to start** (chosen). One meaning of team, any address, upgrade by licenses. The biggest change: a team
  no longer starts at checkout, and the company page becomes a team once you invite someone.
- **Each other's Team page.** Accepting connects two people's pages; nothing is shared. Cheaper, but two people you invite
  never see each other, so it isn't a team.
- **Only paid teams take invitations.** The smallest change, but there's no team without paying, which is the gap the
  user hit.
- For the email: **Resend** (chosen: 3,000 a month free, a domain of our own, tracking off by default, inline images) over
  Postmark (100 a month free), Brevo (its name on every email, logs kept for ever), sending from the inviter's own Gmail
  (Google's "send email as you" permission, a big ask in a privacy app).

## 13. Left to the builder

Exact component and file names; where the upgrade-ask's last time is kept (6.1); backoff timings; the email's spacing,
image size and dark palette within 5.3; whether the invitation card and the put-aside list are one component; which
journeys are rewritten and which deleted. Anything here that turns out to change what the user sees comes back to me first.
