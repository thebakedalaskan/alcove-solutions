# Design

How Alcove is designed, and how to design for it: for people and for agents. Read these before you design or restyle
anything, whether it's a page, a flow, a component or a design canvas.

1. [Principles](principles.md): the look and why it looks that way. That covers One evening, the seven principles, colour,
   type, icons, layout, motion and copy, the product rules that shape screens, what reviews have taught us, and the
   checklist for before you show anything.
2. [The evening, page by page](pages.md): how each page is designed, and where its code and its board live.
3. [Making a design canvas](canvas.md): how to design something new as a canvas on claude.ai. It covers the kit, page boards,
   journey boards, the traps, checking, and publishing as you go.
4. [Building a design in the app](building.md): how a canvas becomes a page, without losing a feature or inventing data.
5. [Storybook](../../apps/storybook/README.md): what's built, as the app renders it. Every foundation, component, page and
   journey, in each of its states, light and dark, phone and wide.

## Where things are

| What | Where |
|---|---|
| The rules every change follows | [AGENTS.md](../../AGENTS.md#design-system) |
| Tokens: colour, type, radii, shadows, motion | `packages/ui/src/styles.css` |
| Components | `packages/ui/src/`, a folder per area with each component's styles beside it ([its map](../../packages/ui/AGENTS.md)) |
| The scene behind every page | `packages/ui/src/evening/horizon.tsx` and `evening/horizon.css` |
| What each page does, feature by feature | [docs/product/user-flows.md](../product/user-flows.md) |
| What's built: the foundations, every component, page and journey, on made-up data (`pnpm storybook`) | [apps/storybook](../../apps/storybook/README.md) |
| The canvas every new design starts from: Home, Notes, a note, a series, Team, Record, Settings and Agents as boards, with each page's journeys (a series has none yet) | [canvas/](canvas/) |

## The one rule that holds it together

Storybook is the record of what's built, and it can't drift: it renders the app's own components and pages. When a page
or a component changes, its stories change in the same pull request: the page's scenarios (add one for a state none of
them reaches) and its journeys. The canvas is for new ideas: a design is explored there before it's built, and its boards
don't have to follow the app afterwards. Storybook's demo world starts from the canvas's, so both tell the same story.
