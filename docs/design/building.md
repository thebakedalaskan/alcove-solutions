# Building a design in the app

How a canvas becomes a page in the app without losing what made it good, or anything the old page did. Read
[AGENTS.md](../../AGENTS.md) first: its rules apply to every change, and the build checks the ones about types, logging,
tests and migrations. Then read the design's canvas, and the page's section of
[docs/product/user-flows.md](../product/user-flows.md), which lists every feature the page has to keep.

## The rules of a build

- **Keep every feature.** Everything the page does today still works. Moving it is fine; dropping it isn't. That includes
  states the canvas doesn't draw: loading, offline, errors, permissions, someone on their own, the first day, a note still
  being written. Give each the new look.
- **Real data only.** A design shows planned features as if they exist; the app shows only what's real. If the design shows
  something the API doesn't have, either:
  - add it properly: `packages/api` first, then the server and `@alcove/api-http`, additive migrations only, with an
    integration test, the privacy rules, and a cross-owner test for any new ID
  - or leave it out, and change the design so nothing looks missing
  Never show an invented number. "3 meetings this month" went from Team because Alcove only reads a week of calendar ahead;
  it became "2 meetings coming up".
- **The kit first.** Use `@alcove/ui` components before writing markup. Anything reusable you need goes into
  `packages/ui`, not into the page.
- **Delete what it replaces.** A page's old styles, components and tests of removed behaviour go in the same change. No
  shims, no "kept for now".
- **Storybook follows.** The page's stories in [apps/storybook](../../apps/storybook/README.md) change in the same pull
  request: a story for each state, in the scenario that reaches it (add a scenario to the stand-in when none does), and its
  journeys. The canvas doesn't have to follow; copy the design's boards into [canvas/](canvas/) so the next design can start
  from them (see [canvas.md](canvas.md#once-its-built)).

## Put the page on the evening

```tsx
import { Evening } from '@alcove/ui';

export function Billing() {
  return (
    <Evening moment="settings" className="bl">
      <header className="bl-band" style={{ '--d': 0 }}>...</header>
      <div className="bl-page" style={{ '--d': 1 }}>...</div>
    </Evening>
  );
}
```

- `Evening` draws `Horizon` behind the page, out to the frame's edges: the sky, sea, sun, clouds, stars and everything that
  passes through. It puts your page in `.dusk-in`, centred, up to 1480px plus `--page-x` on each side.
- The children of `.dusk-in` rise in as the page opens, in the order set by `--d`.
- Set the horizon on your page's class, in its stylesheet: `.bl { --hz: 136px; }`, with a phone value in
  `@media (max-width: 860px)`.
- Move the sun if the page needs it: `.bl .hz { --hz-sun-x: -300px; --hz-sun-r: 40px; }`.
- The scene's colours, moments and visitors live in `horizon.tsx` and `horizon.css`. Don't change them for one page. A new
  moment goes into `Moment`, `MOMENTS`, `SCENES`, `LIFE` and `LANES` in `horizon.tsx`, and its colours into `horizon.css`.
  On the canvas it goes into `scene.js`; then run the sync tool.
- Search and you sit at the top right, outside the page. Keep your title clear of them with `--top-room`, as `.hm-top`
  does. A page with its own search hides both the top one and the phone's, as Notes does:
  `.main:has(> .main-in > .nt) .top-find` and `.shell:has(> .main > .main-in > .nt) .ph-end > :first-child`.
- A page that's always night, like Record, scopes its root `.dark` and adds itself to the selector in `styles.css` that
  darkens the whole document (`:root:has(.dusk.rec)`). That keeps search, the phone's bars and anything that opens at night
  too.

## From the canvas to the code

| On the canvas | In the app |
|---|---|
| `--press`, `--on-press` | `--sun`, `--on-sun` |
| `--notes` | `--rose` |
| `--focus` | `--horizon` |
| `--now` | `--sun-text` |
| `--well` | `--sunk` |
| `--raised` | `--surface-raised` |
| `--line-strong` | `--line-control` |
| `--ground`, `--surface`, `--line`, `--ink`, `--ink-2`, `--ink-3` | The same names |
| `--serif`, `--sans` | `--font-display`, `--font-sans` |
| `b-press` | `<Button variant="primary">`, the one filled button |
| `b-tint`, `b-line` | `<Button variant="secondary">`, a surface fill with a `line-control` ring. On the canvas `b-line` is a bare ring and `b-tint` an ink tint; the app tints a button only where the view already has its filled one, as with Ask on Notes and Get started on the welcome page |
| `b-quiet` | `<Button variant="quiet">` |
| `b-lg`, `b-sm` | `size="lg"`, `size="sm"`. The app's buttons are taller: 44, 52 and 36px against the canvas's 40, 46 and 32 |
| `--rec`, `--caution`, `--rec-soft`, `--caution-soft` (from `tokens.js`; some boards still set their own, such as Team's `--tm-caution`) | The same names |
| `--tint`, a tile's or row's colour for its kind | `--tint`, set the same way |
| `--ease` | `--ease-out` |
| `.clamp1`, `.clamp2` | `ac-clamp-1`, `ac-clamp-2` |
| `.i`, an icon | `Icon` |
| `.tn` | `tabular-nums` |
| `--sky`, `--sun-core`, `--sun-edge`, `--sun-dim`, `--sun-glow`, the canvas's scene | Horizon's own `--hz-*` variables. The canvas's `--sun-glow` is not the app's |
| The `Faces` part | `Avatar` and `Faces`, and `GhostArch` for someone not yet on Alcove |
| The `Scene` part on `.pg-stage` | `<Evening moment="...">` |
| `.pg-in` | `.dusk-in` |
| `@container page (max-width: 860px)` | `@media (max-width: 860px)` |
| `calc(30 * var(--vh, 1vh))` | `30vh` |

- The canvas's page prefixes aren't the app's: `tm-` is `tp-`, `rc-` is `rec-`, `st2-` is `set-`, `nt-page` is `nt`.
- Styles go in the page's own stylesheet in `packages/ui/src/styles/`, with its own class prefix, imported from
  `styles.css` after `horizon.css` (or `.dusk`'s default `--hz` wins). Name it in AGENTS.md's design system list.
- Use the tokens for every colour, radius, shadow, duration and easing. There's no raw hex in the app.
- Truncate with `ac-clamp-1` and `ac-clamp-2`. Don't set `display: block` on a clamped element: it cancels the clamp.
- Icons come from `Icon`. Add a name to its map if one's missing.

## Check it in a real browser

Open the page's stories in Storybook (`pnpm storybook`): the real page on the demo world, in each scenario, with the
toolbar's theme, connection and viewports. Run the app itself with `pnpm dev` too: locally, the Microsoft button is a demo
sign-in, as Art Vandelay, with a sample day of calls. Then look at the page yourself:

- Dark and light.
- Every width in the [checklist](principles.md#before-you-show-anything).
- The first day, and every real state.
- Every popover and modal opened from where it's used.
- Keyboard focus, visible and in order.
- Reduced motion: a still picture, nothing passing through.
- No console errors, no horizontal overflow, nothing overlapping.

Then open the canvas board beside it at 1440×900 and fix the differences. Measure again after each fix; a fix in one place
often moves another.

Some states are hard to reach with real data, such as offline, a failed save, or a note being written. In Storybook a
scenario reaches them (`offline`, `writing`, ...); when none does, add one to its stand-in API rather than changing API
responses by hand. Never fake them in the app's code.

**Running it locally:**

- Every local API needs its own database and its own bucket, as a pair: `DATABASE_URL` and `OBJECTS_BUCKET` in `.env`, and
  `TEST_DATABASE_URL` for tests. The API's upkeep deletes objects in its bucket that its own database doesn't know, so two
  databases on one bucket delete each other's recordings.
- `pnpm dev`, `pnpm test` and the `db:*` scripts run `docker compose up`. Docker must be able to see the folder you run them
  from. From a checkout it can't see, compose recreates the shared LiveKit with an empty config and stops it.
  - The sign of this is `calls.join` failing across unrelated tests.
  - Run the integration tests as `node scripts/check-tests.mjs`, then `pnpm exec vitest run` in `apps/api`.

## Review before it merges

A page that looks right can still lose things. Before merging, have someone who didn't build it, a person or a fresh agent,
read the change against the old page and look for real bugs:

- a feature or state that went missing
- a way to lose data, such as a recording stranded or a save that claims to have worked
- a privacy leak: something readable in a URL, log or error, or another owner's data
- focus that falls to the page, or a control the keyboard can't reach
- something deleted that another page still uses

Fix every must-fix before merging. The reviews of the redesigned pages caught several:

- a failed Finish that left a recording stranded
- account deletion queued offline and run by itself on reconnect
- audio that kept playing after leaving a note

## Docs

- Update the page's section of [user-flows.md](../product/user-flows.md) to say what it does now.
- Update the page's stories and journeys in [apps/storybook](../../apps/storybook/README.md), whose journeys are numbered
  as user-flows.md is.
- Update AGENTS.md wherever a component or stylesheet it names changed.
- Update [pages.md](pages.md) if the page's design changed: its moment, its job, its layout.
