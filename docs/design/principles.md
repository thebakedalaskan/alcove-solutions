# Design principles

How Alcove looks and why. Read this before designing anything: a page, a flow, a component, a canvas. The rules in
[AGENTS.md](../../AGENTS.md#design-system) are what every change follows; this says what they're for, so you can make the
calls they don't cover. [pages.md](pages.md) shows each page made this way.

## What we're designing

Alcove is private video calls with AI notes, written in confidential compute so that Alcove itself can't read them. It's
for teams and for people on their own. Design should make that promise visible and quiet: the product shows how a note was
made and who has it, and otherwise gets out of the way.

People come to Alcove to do one of a few things: start a call, find what was said, record a conversation in the room, or
see who's on the team. Every page is built around the one thing you came to do there.

## One evening

Every page in the frame is a moment of the same evening, drawn behind the page by `Horizon`
(`packages/ui/src/evening/horizon.tsx`): a sky, a sea, and the horizon where they meet. The sky is only as tall as the
page is one action. A page that's mostly one action is mostly sky; a page you read or manage is mostly water.

| Page | Moment | Sky, as a share of the window |
|---|---|---|
| After the call | Night, in both themes, looking out of the welcome page's cove: stars, a crescent moon high on the right, and a rose glow on the horizon with its light on the bay. No sun. | Most of it |
| Record | Night, in both themes. The recorder is the sun: a dark disc with the last of the light on its rim. | Over half (55%, 68% on the first day) |
| Home | The sunset. The sun sits half risen in the middle, under Start a call. | About half (45%, 352 to 540px) |
| Team | The sun low and to the left, behind the people standing on the horizon. | 40% |
| Agents | Team's the other way round: the sun low and to the right, just past the end of the line of agents. | About 41% (49% on the first day, about 75% while an agent asks, and 56% once it's answered) |
| Calls | Just after sunset. The sun has gone and only its glow is left; stars come out after dark. | A short band (13%, 112 to 128px) |
| Plans | The last of the sunset: a long low glow, and only a sliver of the sun, which the page draws under its Monthly / Yearly switch. No clouds. | 270px (300px on a phone) |
| A call's page | A slim band over the title and its line; the call plays on its own night stage, on the water. | 158px (196px on a phone) |
| Settings | The last of the light. | 136px |

A call isn't part of the evening: it's always night, on the call stage. The page it leaves you on has no frame, like the
join page, but stands on the evening's night.

Things sit on the water, under the horizon. The colours of each moment, the clouds, the stars and what passes through are in
`packages/ui/src/evening/horizon.css`. A page sets where its horizon is (`--hz`) and, if it needs to, where its sun is.
Record also restyles its sun, because the recorder takes its place.

## The seven principles

### 1. One job, in the middle

Each page has one thing you came to do, and it sits on the sky, centred and big: Start a call on Home, the search line on
Calls, Start recording on Record, the people on Team, your agents on Agents. Everything else comes after it, on the water.

Don't promote whatever happens to be next: Home doesn't lead with the next calendar event (see
[product rules](#product-rules-that-shape-screens)).

### 2. The sky is as tall as the page is one action

Set `--hz` from what the page is for, not from what fits. If a page gains a second job, it's probably two pages. The sky can
grow for a moment when the page asks you something: Settings' sky rises to hold the sign-out question, when recordings
haven't uploaded yet, and Agents' to hold an agent asking to use your Alcove.

### 3. Things sit on the water, not in boxes

- Panels only where content needs grouping. Inside them, hairlines and space, never a card per row.
- Every row action sits in a fixed column, so things line up down the page.
- A link belongs to the list it acts on (View all, at the end of Recent notes' heading), never floating on its own.
- The logo appears once per screen: in the side panel, or in the top bar on a phone. It's branding, never a status light.

The failure this guards against is the look of a generated UI: boxes scattered everywhere, random squares, buttons that don't
line up, the logo in several places, a link floating with nothing near it.

### 4. Shape and colour by kind

Colour carries meaning, so each colour means one thing:

| Colour | Means |
|---|---|
| `rose` | A decision waiting on someone's answer |
| `horizon` | A follow-up, information, links, focus |
| `sun-text`, `sun-soft` | Time, now, a highlight, warmth |
| `rec` | Notes being taken, or recording. Nothing else. |
| `caution` | A problem |

A tile says its kind with an icon, a colour and a word (Decision, Follow-up). Anything said in a call links back to its
moment with a chip that shows the time (`6:12`) and opens the note there. A list kept to one line a row, like For you on
Home, lets the mark and its colour say the kind, and the words themselves open the moment. There is no green anywhere.

Cutting text isn't the same as removing the design. A list stripped to words reads as a spreadsheet; it still needs icons,
colour per kind and shape.

### 5. One filled button per view

`sun` is the only colour you can press. It's navy by day and cream by night, a solid fill with `on-sun` text and no shadow,
so it never glows against the page. Each view has at most one filled button: the thing you came to do. Everything else is
secondary, quiet or a link.

- The side panel's Start a call is a row like the places under it, its camera in a warm circle (`sun-soft` behind
  `sun-text`). It's neither filled nor shaded, so a page's own action is the one filled button in view and the place
  you're on is the one shaded row in the panel.
- When a call is about to start, Join takes the filled button from Start now.
- A page you read or adjust, like Settings, may have none at rest, and fills a button only when something needs doing.
- When a page asks a question, the answer that loses nothing is the filled one.

### 6. Say it once, say it short

- Each fact appears once. No sentence headline above cards that repeat it, no lede, no explaining paragraph.
- Labels go when the button already says it.
- Sentence case everywhere. No uppercase labels or eyebrows.
- One display face for a page's title and hero, one face for everything else (see [Type](#type)).

### 7. Alive, quietly

The scene moves a little so the page feels awake, and once in a while something passes through it (see
[Motion](#motion)). Anything else that moves has a reason: something arrived, something finished, you pointed at it.

## Colour

The palette is called Blue Hour. Its tokens are in `packages/ui/src/styles.css`, light on `:root` and dark on `.dark`; never
write a colour value in the app (illustrations and the call stage are the only exceptions).

Why it looks like this: the logo is an arched window at sunset, and its sky walks from violet through rose to gold. An earlier
palette pressed with the orange end of that walk at several times the logo's chroma, so every button shouted against the dark
page. Blue Hour takes the page and the pressable colour from the logo's own sky and keeps the warmth for highlights.

| Role | Tokens |
|---|---|
| The page and what sits on it | `ground`, `surface`, `surface-raised`, `sunk` |
| The focus ring | `focus` |
| The frame around every screen, dark in both themes | `frame` |
| Hairlines | `line`, `line-control` |
| Text | `ink`, `ink-2`, `ink-3` |
| The one thing you press | `sun`, `on-sun` |
| Warmth and highlights | `sun-text`, `sun-soft`, `sun-glow` |
| Meaning | `rose`, `horizon`, `rec`, `caution`, each with a `-soft`; `caution-text` for small caution text out on the scene |
| Someone with no portrait: their arch and its initial, pale in both themes as portraits are, never a gap at night | `arch-fill`, `arch-ink` |
| The call stage, always night | `stage`, `stage-tile`, `stage-raised`, `stage-ink`, `stage-ink-2`, `speak`, `stage-point` (pointers on a shared screen) |
| Drawing on the evening | `dusk-sun`, `dusk-haze` |
| Illustration, tour art and covers only | `dawn-1` to `dawn-4`, `gold`, the `cover-*` gradients |
| A highlight or comment in a document | `hl` |
| Code in a document, by what each word is: its own palette, no green | `code-keyword`, `code-string`, `code-number`, `code-name`, `code-comment` |

- One named exception, from the approved plans canvas ([canvas/plans](canvas/plans/README.md)): the side panel's
  notes-left meter runs from `rose` through `sun-text` to `gold`, the walk of the logo's own sky. It says how much of the
  period's notes is left and nothing more: not a decision waiting, and not illustration. It turns `sun-text` under an hour.
- Every screen works in light and dark. Design both, and don't simply invert: check contrast (4.5:1 for text) in each.
- The side panel is dark in both themes. The call is night in both, but for your side in it and a board on its stage,
  which take your theme. Record and the page a call leaves you on are night in both.
- `.light` and `.dark` on any element scope one theme to that part of a page.

## Type

| Face | For | Where it's set |
|---|---|---|
| Newsreader | A page's title and its hero: the date on Home, Start a call, Calls and its search, a company name on Team, what an agent asks on Agents | `font-display` |
| Hanken Grotesk | Everything else: rows, buttons, labels, times, numbers. Digits line up with `tabular-nums` (`ac-mono` sets it) | `font-sans` |
| IBM Plex Mono | Code and hashes only | `font-mono` |

The shared type classes in `styles.css`: `ac-display-xl` (76px), `ac-display-l` (56px), `ac-display-m` (40px) and
`ac-display-s` (28px) in Newsreader, then `ac-title` (18px semibold), `ac-body-l` (18px), `ac-body` (15px), `ac-body-s`
(13.5px), `ac-label` (14px semibold), `ac-caption` (12px) and `ac-data` (13px, tabular). Page stylesheets set their own sizes
from the same steps: a hero runs 36 to 56px, a page title 22 to 28px, panel headings 15px semibold, row text 14.5 to 15px,
meta 13px.

When a page's hero is a number that stays put, such as the minutes of notes left, it's the hero and takes Newsreader. A
number that changes while you look, such as a timer or a count, takes Hanken Grotesk with `tabular-nums`, so its digits
don't jump.

Four places take Newsreader without being a page's title or hero. They're named exceptions, because they're the approved
plans canvas's look ([canvas/plans](canvas/plans/README.md)): the plan's name in the side panel's foot (Pro, Team),
checkout's headlines (`CheckoutBig`: "You're on Pro", "Nothing arrived in 24 hours", which Add money's payment says with
the same parts), a receipt's title (`PaymentReceipt`), and the plans' prices, on Plans and on the welcome page. Nothing
else does: a new place for Newsreader is a design decision, not a style.

In the light theme, `ink-3` doesn't reach 4.5:1 out on the sky or the sea. Meta text on the scene uses `ink-2`; `ink-3` is
for text on `surface` and `ground`. Warm `sun-text` on the light sky is kept large or put on an icon. Small caution text out
on the scene (Waiting for a license on Team's water) takes `caution-text`, which by day is deep enough to read there.

Truncate with `ac-clamp-1` or `ac-clamp-2` rather than `nowrap`, so long text can't widen a column. Don't also set
`display: block` on it: that cancels the clamp.

## Icons and illustration

- Icons are Lucide, through `Icon` in `@alcove/ui`, one stroke family at 1.8. Add a name to its map rather than drawing an SVG.
- Tile and toolbar actions are icon buttons with a tooltip, not text labels.
- People appear in an arch, never a circle: `Avatar` and `Faces`. Someone who isn't on Alcove yet is a dashed `GhostArch`.
  A photo someone cut to a circle before giving it to their sign-in provider is drawn larger, so it fills the arch too.
- The scene is drawn flat, each shape one colour: a sun disc, stripes of glitter, strokes of chop, silhouettes. Draw the
  sunset; don't wash a gradient over the page. Gradients are only the sky, the sea and the glow around the sun.
- Anything empty gets a designed empty state, never blank space: `EmptyState`, which draws `EmptyArch`, with a title and
  one line. Inside a small panel, the words alone are enough (`art={null}`).

## Layout

- Signed in, every page sits in the frame: a dark side panel on the left and the page under a rounded edge, scrolling
  beneath it. Search and you sit at the top right of every page. A top nav with a hero reads as a website; don't.
- Page headers are modest. The page's atmosphere is the scene behind it, not a hero above the content.
- Every page runs to the same width, 1760px plus the page's side padding (`--page-max` and `--page-x`, the same on every
  page), so going from page to page leaves the title, search and you where they were. Don't centre a narrow column on a
  wide screen.
- A page's title sits at its top left, in the same place and the same face on every page (`dusk-top`, `dusk-title`):
  Home's date, Calls, Drive, Record, Team and Agents. A note puts the way back first and its own name larger, and Settings starts
  with you in your arch, both from the same left edge.
- Grids wrap and lists go to one column on a phone.
- The breakpoints, widest first:
  - 1320px: Home's widgets stack
  - 1241px: narrower than this, Calls' rows tighten their columns
  - 1240px and 1000px: Settings tightens, then its index becomes a strip
  - a page under 1000px wide (a window under about 1256px with the side panel open): Team's admin cards fold under its
    people
  - 1180px: the welcome page's top bar drops its links
  - 1100px: the top search becomes an icon, and Calls' rail narrows, its counts stepping back
  - 860px: the side panel becomes a top bar and a tab bar, with Record standing up out of it

## Scales

Everything comes from the tokens in `styles.css`. Don't invent values.

| Scale | Steps |
|---|---|
| Spacing | `space-1` 4px, `space-2` 8, `space-3` 12, `space-4` 16, `space-5` 20, `space-6` 24, `space-8` 32, `space-12` 48, `space-16` 64, `space-24` 96, `space-32` 128 |
| Radii | `radius-xs` 5px, `radius-sm` 9, `radius-md` 13, `radius-lg` 22, `radius-xl` 32, `radius-pill` and `radius-arch` for pills and arches |
| Shadows | `shadow-1` (a hairline lift), `shadow-2` (a card), `shadow-3` (a window). Filled buttons have none |
| Durations | `duration-1` 140ms, `duration-2` 240ms, `duration-3` 420ms, `duration-4` 900ms, `duration-5` 2.4s; for a page taking another's place, `duration-page-1` to `duration-page-4` (Motion, below) |
| Easing | `ease-out` for things arriving, `ease-in-out` for things moving, `ease-in` for things leaving; `ease-expo` and `ease-soft` for a page taking another's place |
| Buttons | 44px tall, 52px `lg`, 36px `sm`, 30px `xs`; icon buttons 36px. The focus ring is a 2px outline in `focus` |

Corners nest. A rounded shape near the corner of another, such as a button in the dock or a row's highlight in a menu, takes
the outer radius less the gap between them (`calc(var(--radius-lg) - 6px)` in a popover padded by 6px), so the two curves
stay the same distance apart all the way round. Write it as that `calc()` rather than a number, so it follows the container.
A shape flush with its container's edge takes the container's radius, or the container clips it. A split control (a button
and its chevron) is one shape: it fills as one, and never shows half of itself with two square corners.

## Motion

- Anything that loops animates only `transform` and `opacity`, on plain elements, so the browser runs it off the main
  thread. A Home left open all day must cost next to nothing. A one-off change can animate more, briefly: the side panel
  sliding away, Settings' sky growing.
- Use long cycles. The browser recalculates styles at each animation's iteration boundary, so 45 glints on 5-second loops woke
  it about 300 times in 10 seconds; the same glints with several uneven pulses in one 34 to 56-second loop woke it about 50.
- The resting state of every animated element is the still picture. With reduced motion, the global stylesheet runs every
  animation once in a millisecond, so anything that only appears now and then must rest hidden at `opacity: 0`, and
  `Horizon` sends no visitors at all.
- What says something is on its way never rests, or it reads as a broken icon. With reduced motion, `Spinner` keeps turning
  at half speed, as the system's own spinners do, since a ring that stands still or only fades still reads as broken; `Dots`
  stop rising and fade slowly in and out instead (`kit.css`).
- What passes through comes at random, one at a time: something quick every 22 to 60 seconds, a ship every 2.5 to 6
  minutes. A ship is sometimes already out there when the page opens. What comes depends on the moment (`LIFE` in
  `horizon.tsx`):

  | Moment | Quick | Slow |
  |---|---|---|
  | Home | Gulls, a fish, a shoal, a flying fish, a marlin, dolphins, a whale's tail | Six kinds of boat and ship, and a balloon in the corner |
  | Team | Gulls, a fish, a shoal, a flying fish, dolphins | Five kinds of boat and ship |
  | Agents | The same as Team: gulls, a fish, a shoal, a flying fish, dolphins | Five kinds of boat and ship |
  | Calls | Gulls, a shooting star, a fish, a shoal | A sailing boat, a fishing boat, a freighter |
  | Plans | Gulls, a shooting star, a fish, a shoal | A sailing boat, a fishing boat, a freighter |
  | A note | A shooting star, only in the dark | Nothing |
  | Settings | Nothing | A sailing boat, a freighter |
  | Record | A shooting star, a fish, a whale's tail | A sailing boat, a tall ship, a fishing boat |
  | After the call | A shooting star | Nothing |
- Pages rise in as they open, staggered by `--d`. Use the shared helpers (`CountUp`, `Words`, `CheckDraw`, `Dots`, `Reveal`,
  `RevealGroup`, the `EASE` curves) and the `duration-*` and `ease-*` tokens.
- A page taking another's place (a call's own page, and Home or the notes after it) moves on a slower clock of its own, so
  nothing cuts and nothing hurries: `duration-page-1` 340ms for what goes (a fade, `ease-in`), `duration-page-2` 500ms for
  what it takes the place of easing back and its smaller parts coming in, `duration-page-3` 600ms for it fading, rising or
  sliding in, and `duration-page-4` 1.1s for the scene behind it settling (`ease-expo`, a long settle). A whole page fading in
  over another takes `ease-soft`, which starts gentler than `ease-out`, so it doesn't flash in. `EASE` and `DURATION` in
  `motion.tsx` hold the same values for motion/react and the Web Animations API.

## Copy

- Plain and specific: say what happens. No marketing taglines, no slogans.
- The promise in the product's own words: "Written in confidential compute", "Alcove can't read them", "Confidential compute
  · verified", "Hardware verified 11:58". No hedging or status caveats in the UI; the engineering docs say what's built.
  The call's shield, the side panel's check, Home's badge, the join page, the page a call leaves you on and Settings ›
  Privacy say Confidential compute, adding "· verified" and the time only when this browser's check of the server
  passed. A check that didn't pass blocks nothing and is no caveat: it says why ("Not verified. The token has expired.")
  only where the check's details are (Settings › Privacy, the shield's card, pointing at the side panel's check), beside a
  shield without its tick, which never sits beside a negative.
- Times read `6:12`, `Thu 17:55`, `Yesterday`. Durations read `1 h 12 min`.
- People: use names or "they". Demo data uses made-up people only (the demo company is Vandelay Industries); never a real
  person's name.
- In a design, show every planned feature as if it exists. Never "Coming soon". In the app, show only what's real (see
  [building.md](building.md)).

## Product rules that shape screens

- Home is for starting a call and for what's yours. People join calls from their calendar, so a call only comes near the
  top of Home in its last few minutes, as a slim line with Join. A calendar block with nobody else on it isn't a call, so
  it's never offered or listed as one: Upcoming counts such blocks, says so when they're all there is, and shows them,
  slim and hatched, only when asked.
- Whether a call has notes is set when it's scheduled. Mid-call only the organizer turns notes on; others ask, like raising a
  hand. Notes go to everyone invited, and anyone with them can share them afterwards.
- Camera and video appear only on the join screen and in a call: never on onboarding, Home or an illustration elsewhere.
- Never a stacked modal form (a title field, then a day, then a time, then guests...). Questions go one at a time inside one
  modal, with smart defaults, and no window ever opens over another.
- No FAQs. Onboarding is short: one illustration, a title, one line, one button.
- Sign-in is Google, Microsoft or company SSO. There's no key management, recovery, admin console or retention setting to design.

## What reviews have taught us

These came up in design reviews. They're the fastest way to see what "right" means here.

| Said in review | What to do |
|---|---|
| "It sort of feels like AI slop": misaligned buttons, the logo in too many places, a link floating in the middle of nowhere, boxes scattered everywhere | Fixed columns, hairlines and space, the logo once, links attached to their lists |
| "The orange buttons pop out A LOT on the dark background" | Press with the palette's own sky (`sun`); keep warmth for highlights |
| "Your eyes are drawn very quickly to the very red / orange sun" | Put the brightest thing where the page's action is, and make it calm |
| "I don't like how you just made it dimmer" | When something isn't working, change what it is, not its strength |
| "There's a lot of text still" | Each fact once; cut ledes and labels the button already says |
| "It just looks like a table" | Cutting text isn't removing design: icons, colour per kind, shape |
| "For an app, it makes more sense to have a left sidebar" | The frame: side panel, rounded page, search and you top right |
| "Show what happens when I click different items. How do I get to each state?" | Every design shows its journeys (see [canvas.md](canvas.md)) |
| "This is a great start but we can't have it looking exactly like [a reference]" | Keep it; change a few visible details. Don't throw out what was liked |
| "Subtle but alive" | The scene moves a little; visitors are rare and one at a time |
| Gusts on the water, birds that didn't flap, a balloon that stayed too long | Removed gusts; gulls beat their wings in three poses; the balloon stays in the corner for about 40 seconds |
| A muted microphone with two round corners and two square ones; 12px buttons in a 22px dock | Corners nest: inside a rounded shape, the radius is the outer one less the gap (Scales, above) |

## Before you show anything

- Dark and light.
- 390, 1024, 1440, and 1920 to 2000 wide.
- The first-day empty state, and every other real state: loading, offline, errors, nothing yet, a lot.
- Every menu, popover and modal opened from where it's used, over the screen it belongs to.
- No overlap, no stacking bugs, no horizontal scroll, no console errors.
- Corners nest: every button, row highlight and inner panel follows the curve of the shape it sits in, hovered and pressed too.
- Keyboard focus visible and in order; reduced motion shows a still picture, but a spinner still turns, at half speed, and
  dots fade slowly in and out.
- One filled button per view, each fact once, no green.
