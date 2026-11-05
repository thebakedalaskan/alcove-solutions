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

## Where things are

| What | Where |
|---|---|
| The rules every change follows | [AGENTS.md](../../AGENTS.md#design-system) |
| Tokens: colour, type, radii, shadows, motion | `packages/ui/src/styles.css` |
| Components | `packages/ui/src/components/`, with their styles in `packages/ui/src/styles/` |
| The scene behind every page | `packages/ui/src/components/horizon.tsx` and `styles/horizon.css` |
| What each page does, feature by feature | [docs/product/user-flows.md](../product/user-flows.md) |
| The canonical canvas: Home, Notes, a note, a series, Team, Record and Settings as boards, with each page's journeys (a series has none yet) | [canvas/](canvas/) |

## The one rule that holds it together

The canvas and the app show the same thing. When a page changes in the app, its board in [canvas/](canvas/) changes in the
same pull request. When a design is built, the boards are brought in line with what was built and copied into the repo.
